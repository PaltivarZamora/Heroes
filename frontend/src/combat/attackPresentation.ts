import type { Dispatch, SetStateAction } from 'react'
import { stackMaxRange } from './battle'
import type { CombatBattle, CombatStack, CombatTombstone } from './battle'
import type { BattleAnimSettings } from './battleAnimConfig'
import { battleHitSettings } from './battleAnimConfig'
import { battleIdleSettings } from './battleAnimConfig'
import { combatBattleUnitSpriteScale, stackArtBox, stackArtBoxFoot } from './combatStackArtBox'
import { combatStackFootprint } from './movement'
import { appendBattleAnimCombatLog } from './battleAnimLogBridge'
import type { AttackAnimPhase, HitFlashColor } from './attack'

type AttackResolved = NonNullable<
  ReturnType<typeof import('./attack').resolveAttack>
>
import type { BattleUnitSheetSet } from './battleUnitSheet'
import {
  battleAttackFlipTowardTarget,
  battleUnitSheetForUnit,
  flipBattleUnitForSide,
} from './battleUnitSheet'
import {
  battleUnitHasHitSheet,
  rollProceduralHitMotion,
} from './proceduralBattleHit'
import {
  defaultIdleVisualForStack,
  projectileDurationMs,
  sleepMs,
  type CombatProjectileVisual,
  type StackBattleVisual,
} from './combatUnitAnimVisual'
import { playBattleUnitSoundOnce } from './battleUnitSound'
import {
  runBattleHitReactionPhase,
  runBattleWipedDeathAnim,
} from './combatUnitAnimPlayback'
import type { DieFallbackEffectSheet } from './battleDieFallbackEffect'
import type { ReferenceCatalog } from '../town/catalog'
import { unitById } from '../town/catalog'

export type AttackExchange = {
  strikerId: string
  targetIds: string[]
  beforeStacks: CombatStack[]
  strikeStacks: CombatStack[]
  strikeTombstones: CombatTombstone[]
  hitKeys: string[]
}

type HexAnchor = { q: number; r: number; x: number; y: number }

function cloneStacks(stacks: CombatStack[]): CombatStack[] {
  return stacks.map((row) => ({ ...row }))
}

export function cloneBattleForAttackDisplay(
  battle: CombatBattle,
  beforeStacks: CombatStack[],
): CombatBattle {
  return {
    ...battle,
    stacks: cloneStacks(beforeStacks),
    tombstones: [...(battle.tombstones ?? [])],
  }
}

/** HP/qty/tombstones from base battle; hex positions from resolve (post-move stand, pull, etc.). */
export function preAttackDisplayStacks(
  baseBattle: CombatBattle,
  resolved: AttackResolved,
): CombatStack[] {
  const posById = new Map(
    resolved.battle.stacks.map((row) => [row.id, { q: row.q, r: row.r }]),
  )
  return baseBattle.stacks.map((row) => {
    const pos = posById.get(row.id)
    if (!pos) {
      return { ...row }
    }
    return { ...row, q: pos.q, r: pos.r }
  })
}

export function buildAttackExchanges(
  phases: AttackAnimPhase[],
  beforeStacks: CombatStack[],
  fallback: AttackExchange,
): AttackExchange[] {
  if (phases.length === 0) {
    return [fallback]
  }
  const out: AttackExchange[] = []
  let prev = beforeStacks
  for (let i = 0; i < phases.length; i += 1) {
    const phase = phases[i]!
    out.push({
      strikerId: phase.attackerId,
      targetIds: [...phase.targetStackIds],
      beforeStacks: prev,
      strikeStacks: phase.strikeStacks,
      strikeTombstones: phase.strikeTombstones,
      hitKeys: phase.hitKeys,
    })
    prev = phase.strikeStacks
    if (i + 1 < phases.length) {
      const next = phases[i + 1]!
      const retaliator = phase.strikeStacks.find(
        (row) => row.id === next.attackerId,
      )
      const striker = phase.strikeStacks.find(
        (row) => row.id === phase.attackerId,
      )
      const retaliatorTomb = phase.strikeTombstones.some(
        (row) => row.id === next.attackerId,
      )
      const strikerTomb = phase.strikeTombstones.some(
        (row) => row.id === phase.attackerId,
      )
      if (
        !retaliator ||
        retaliator.qty <= 0 ||
        retaliatorTomb ||
        !striker ||
        striker.qty <= 0 ||
        strikerTomb
      ) {
        break
      }
    }
  }
  return out.length > 0 ? out : [fallback]
}

function logBeatStart(unitName: string, kind: 'Attack' | 'Hit' | 'Die', ms: number) {
  appendBattleAnimCombatLog(
    `${unitName} ${kind} start at ${Math.max(0, Math.round(ms))}ms`,
  )
}

function sheetSet(
  unitId: number,
  catalog: ReferenceCatalog,
  sheets: Map<number, BattleUnitSheetSet | null>,
): BattleUnitSheetSet | null {
  const cached = sheets.get(unitId)
  if (cached) {
    return cached
  }
  const unit = unitById(catalog, unitId)
  return unit ? battleUnitSheetForUnit(catalog, unit) : null
}

function stackRow(
  stacks: CombatStack[],
  id: string,
): CombatStack | null {
  return stacks.find((row) => row.id === id) ?? null
}

function isWipedTarget(
  id: string,
  before: CombatStack | null,
  strikeStacks: CombatStack[],
  strikeTombs: CombatTombstone[],
): boolean {
  if (strikeTombs.some((row) => row.id === id)) {
    return true
  }
  const after = strikeStacks.find((row) => row.id === id)
  return (
    before != null &&
    before.qty > 0 &&
    (after == null || after.qty <= 0)
  )
}

function applyStrikeToDisplay(
  display: CombatBattle,
  strikeStacks: CombatStack[],
  targetIds: string[],
): CombatBattle {
  const ids = new Set(targetIds)
  let stacks = display.stacks.map((row) => {
    if (!ids.has(row.id)) {
      return row
    }
    const next = strikeStacks.find((s) => s.id === row.id)
    return next ? { ...next } : { ...row, qty: 0, topHealth: 0 }
  })
  for (const id of ids) {
    if (stacks.some((row) => row.id === id)) {
      continue
    }
    const next = strikeStacks.find((s) => s.id === id)
    if (next && next.qty > 0) {
      stacks = [...stacks, { ...next }]
    }
  }
  return { ...display, stacks }
}

function removeStackFromDisplay(
  display: CombatBattle,
  stackId: string,
  tomb: CombatTombstone | null,
): CombatBattle {
  const stacks = display.stacks.filter((row) => row.id !== stackId)
  const tombstones =
    tomb != null
      ? [...(display.tombstones ?? []), tomb]
      : display.tombstones ?? []
  return { ...display, stacks, tombstones }
}

function idleVisual(
  stack: CombatStack,
  sheets: Map<number, BattleUnitSheetSet | null>,
  catalog: ReferenceCatalog,
): StackBattleVisual {
  const set = sheets.get(stack.unitId)
  const unit = unitById(catalog, stack.unitId)
  return {
    ...defaultIdleVisualForStack(
      stack,
      set,
      unit,
      battleIdleSettings(catalog),
    ),
    flipX: flipBattleUnitForSide(stack.side),
  }
}

export async function runAttackBeatPresentation(opts: {
  exchanges: AttackExchange[]
  display: CombatBattle
  onDisplayChange: (next: CombatBattle) => void
  catalog: ReferenceCatalog
  settings: BattleAnimSettings
  sheets: Map<number, BattleUnitSheetSet | null>
  dieFallbackEffects: Map<string, DieFallbackEffectSheet | null>
  anchors: HexAnchor[]
  hexPx: number
  hitColor: HitFlashColor
  setStackVisuals: Dispatch<SetStateAction<Record<string, StackBattleVisual>>>
  setProjectiles: Dispatch<SetStateAction<CombatProjectileVisual[]>>
  onHitFlash: (keys: string[]) => void
  isCancelled?: () => boolean
}): Promise<void> {
  let display = opts.display
  const beatListStartedMs = performance.now()
  const beatMs = () => performance.now() - beatListStartedMs
  const pushDisplay = (next: CombatBattle) => {
    display = next
    opts.onDisplayChange(next)
  }

  const waitClip = async (ms: number) => {
    await sleepMs(ms, opts.isCancelled)
  }

  for (let ex = 0; ex < opts.exchanges.length; ex += 1) {
    const exchange = opts.exchanges[ex]!
    const striker =
      stackRow(exchange.beforeStacks, exchange.strikerId) ??
      stackRow(exchange.strikeStacks, exchange.strikerId)
    if (!striker || striker.qty <= 0) {
      continue
    }
    const primaryTargetId = exchange.targetIds[0]
    const targetBefore = primaryTargetId
      ? stackRow(exchange.beforeStacks, primaryTargetId)
      : null
    const strikerAnchor = opts.anchors.find(
      (row) => row.q === striker.q && row.r === striker.r,
    )
    const targetAnchor =
      targetBefore != null
        ? opts.anchors.find(
            (row) => row.q === targetBefore.q && row.r === targetBefore.r,
          )
        : null
    const strikerFootprint = combatStackFootprint(striker, opts.catalog)
    const attackerFoot = strikerAnchor
      ? (() => {
          const foot = stackArtBoxFoot(
            stackArtBox(
              strikerAnchor,
              opts.hexPx,
              strikerFootprint,
              striker.side,
            ),
            opts.hexPx,
            opts.settings.footOffsetPct,
          )
          return { x: foot.footX, y: foot.footY }
        })()
      : { x: 0, y: 0 }
    const targetFoot =
      targetBefore != null && targetAnchor != null
        ? (() => {
            const foot = stackArtBoxFoot(
              stackArtBox(
                targetAnchor,
                opts.hexPx,
                combatStackFootprint(targetBefore, opts.catalog),
                targetBefore.side,
              ),
              opts.hexPx,
              opts.settings.footOffsetPct,
            )
            return { x: foot.footX, y: foot.footY }
          })()
        : null
    const set = sheetSet(striker.unitId, opts.catalog, opts.sheets)
    const attackSheet = set?.sheets.Attack
    const attackMs = opts.settings.attackSec * 1000
    const soundPct = attackSheet?.soundStartPct ?? 0
    const strikeMs = attackMs * soundPct
    const maxRange = stackMaxRange(striker, opts.catalog)
    const ranged = maxRange > 1 && targetFoot != null
    const strikerName =
      unitById(opts.catalog, striker.unitId)?.name ?? String(striker.unitId)
    const actionStartedMs = performance.now()
    logBeatStart(strikerName, 'Attack', beatMs())
    const attackFlipX = battleAttackFlipTowardTarget(attackerFoot, targetFoot)
    if (set?.animated && attackSheet) {
      opts.setStackVisuals((prev) => ({
        ...prev,
        [striker.id]: {
          kind: 'Attack',
          startedMs: actionStartedMs,
          frameOffset: 0,
          ...(attackFlipX !== undefined ? { flipX: attackFlipX } : {}),
        },
      }))
    } else if (attackFlipX !== undefined) {
      opts.setStackVisuals((prev) => ({
        ...prev,
        [striker.id]: {
          kind: 'idle',
          startedMs: actionStartedMs,
          frameOffset: 0,
          flipX: attackFlipX,
        },
      }))
    }
    void (async () => {
      await sleepMs(strikeMs, opts.isCancelled)
      if (!opts.isCancelled?.() && set?.stem) {
        void playBattleUnitSoundOnce(
          set.stem,
          'Attack',
          undefined,
          set.partnerSoundStem ?? null,
        )
      }
    })()
    let timeToStrike = strikeMs
    if (ranged && targetFoot && set) {
      const travelMs = projectileDurationMs(
        attackerFoot.x,
        attackerFoot.y,
        targetFoot.x,
        targetFoot.y,
        opts.hexPx,
        opts.settings.projectileHexPerSec,
      )
      timeToStrike = strikeMs + travelMs
      const projId = `proj:${striker.id}:${actionStartedMs}`
      const restH =
        attackSheet?.restHeight ?? set.sheets.Idle?.restHeight ?? 64
      const attackFrameW =
        attackSheet?.stand?.w ?? attackSheet?.frames[0]?.w ?? restH
      const scale = combatBattleUnitSpriteScale(
        opts.hexPx,
        strikerFootprint,
        striker.side,
        restH,
        attackFrameW,
        opts.settings,
      )
      const displayHeightPx = scale * restH
      opts.setProjectiles((prev) => [
        ...prev,
        {
          id: projId,
          fromX: attackerFoot.x,
          fromY: attackerFoot.y,
          toX: targetFoot.x,
          toY: targetFoot.y,
          startedMs: performance.now(),
          durationMs: travelMs,
          imageUrl: set.projectileUrl,
          displayHeightPx,
        },
      ])
      await waitClip(timeToStrike)
      opts.setProjectiles((prev) => prev.filter((row) => row.id !== projId))
    } else {
      await waitClip(timeToStrike)
    }

    pushDisplay(
      applyStrikeToDisplay(
        display,
        exchange.strikeStacks,
        exchange.targetIds,
      ),
    )
    if (exchange.hitKeys.length > 0) {
      opts.onHitFlash(exchange.hitKeys)
    }

    const reactionWaits: Promise<void>[] = []
    const defenderHitWaits: Promise<void>[] = []

    const scheduleStrikerIdle = () => {
      void (async () => {
        const elapsed = performance.now() - actionStartedMs
        await waitClip(Math.max(0, attackMs - elapsed))
        if (opts.isCancelled?.()) {
          return
        }
        opts.setStackVisuals((prev) => ({
          ...prev,
          [striker.id]: idleVisual(striker, opts.sheets, opts.catalog),
        }))
      })()
    }
    scheduleStrikerIdle()

    for (const targetId of exchange.targetIds) {
      const before = stackRow(exchange.beforeStacks, targetId)
      const wiped = isWipedTarget(
        targetId,
        before,
        exchange.strikeStacks,
        exchange.strikeTombstones,
      )
      const targetFoot = before
        ? (() => {
            const anchor = opts.anchors.find(
              (row) => row.q === before.q && row.r === before.r,
            )
            if (!anchor) {
              return { x: attackerFoot.x, y: attackerFoot.y }
            }
            const foot = stackArtBoxFoot(
              stackArtBox(
                anchor,
                opts.hexPx,
                combatStackFootprint(before, opts.catalog),
                before.side,
              ),
              opts.hexPx,
              opts.settings.footOffsetPct,
            )
            return { x: foot.footX, y: foot.footY }
          })()
        : { x: attackerFoot.x, y: attackerFoot.y }
      const hitOrigin = { x: attackerFoot.x, y: attackerFoot.y }
      reactionWaits.push(
        runTargetBeat({
          stackId: targetId,
          wiped,
          before,
          strikeTombs: exchange.strikeTombstones,
          catalog: opts.catalog,
          settings: opts.settings,
          sheets: opts.sheets,
          dieFallbackEffects: opts.dieFallbackEffects,
          setStackVisuals: opts.setStackVisuals,
          beatMs,
          onDieStart: (tomb) => {
            pushDisplay(removeStackFromDisplay(display, targetId, tomb))
          },
          isCancelled: opts.isCancelled,
          hexPx: opts.hexPx,
          attackerFootX: attackerFoot.x,
          attackerFootY: attackerFoot.y,
          targetFoot,
          hitOrigin,
        }),
      )
      if (!wiped && before && before.side !== striker.side) {
        defenderHitWaits.push(reactionWaits[reactionWaits.length - 1]!)
      }
    }

    const strikerClipWait = (async () => {
      const elapsed = performance.now() - actionStartedMs
      await waitClip(Math.max(0, attackMs - elapsed))
    })()

    if (ex + 1 < opts.exchanges.length) {
      if (defenderHitWaits.length > 0) {
        await Promise.all(defenderHitWaits)
      } else {
        await Promise.all(reactionWaits)
      }
    } else {
      await Promise.all([strikerClipWait, ...reactionWaits])
    }
  }

  const idleStacks = display.stacks.filter((row) => row.qty > 0)
  opts.setStackVisuals((prev) => {
    const next = { ...prev }
    for (const stack of idleStacks) {
      next[stack.id] = idleVisual(stack, opts.sheets, opts.catalog)
    }
    for (const tomb of display.tombstones ?? []) {
      const vis = next[tomb.id]
      if (vis?.kind === 'Die' && !vis.dieHoldFrame) {
        next[tomb.id] = { ...vis, dieHoldFrame: true }
      }
    }
    return next
  })
}

async function runTargetBeat(opts: {
  stackId: string
  wiped: boolean
  before: CombatStack | null
  strikeTombs: CombatTombstone[]
  catalog: ReferenceCatalog
  settings: BattleAnimSettings
  sheets: Map<number, BattleUnitSheetSet | null>
  dieFallbackEffects: Map<string, DieFallbackEffectSheet | null>
  setStackVisuals: Dispatch<SetStateAction<Record<string, StackBattleVisual>>>
  beatMs: () => number
  onDieStart: (tomb: CombatTombstone | null) => void
  isCancelled?: () => boolean
  hexPx: number
  attackerFootX: number
  attackerFootY: number
  targetFoot: { x: number; y: number }
  hitOrigin: { x: number; y: number }
}): Promise<void> {
  const unitId =
    opts.before?.unitId ??
    opts.strikeTombs.find((row) => row.id === opts.stackId)?.unitId
  if (unitId == null) {
    return
  }
  const unitName =
    unitById(opts.catalog, unitId)?.name ?? `unit ${unitId}`
  const unit = unitById(opts.catalog, unitId)
  const set = sheetSet(unitId, opts.catalog, opts.sheets)
  const side =
    opts.before?.side ??
    opts.strikeTombs.find((row) => row.id === opts.stackId)?.side ??
    'def'
  const sideFlipX = flipBattleUnitForSide(side)
  const hasHitSheet = set ? battleUnitHasHitSheet(set) : false
  const hitSettings = battleHitSettings(opts.catalog)
  const proceduralHit =
    set && !hasHitSheet && set.animated && unit
      ? rollProceduralHitMotion(
          hitSettings,
          unit,
          opts.hexPx,
          opts.hitOrigin,
          opts.targetFoot,
        )
      : null

  if (opts.wiped) {
    if (hasHitSheet || proceduralHit) {
      logBeatStart(unitName, 'Hit', opts.beatMs())
    }
    logBeatStart(unitName, 'Die', opts.beatMs())
    const tomb =
      opts.strikeTombs.find((row) => row.id === opts.stackId) ?? null
    await runBattleWipedDeathAnim({
      stackId: opts.stackId,
      set,
      catalog: opts.catalog,
      settings: opts.settings,
      sideFlipX,
      setStackVisuals: opts.setStackVisuals,
      dieFallbackEffects: opts.dieFallbackEffects,
      isCancelled: opts.isCancelled,
      unitName,
      strikeKill: opts.before != null,
      proceduralHit,
      onDieStart: () => opts.onDieStart(tomb),
    })
    return
  }

  if (!set) {
    return
  }

  logBeatStart(unitName, 'Hit', opts.beatMs())
  const hitPlayed = await runBattleHitReactionPhase({
    stackId: opts.stackId,
    set,
    settings: opts.settings,
    sideFlipX,
    proceduralHit,
    setStackVisuals: opts.setStackVisuals,
    isCancelled: opts.isCancelled,
    unitName,
  })
  if (!hitPlayed) {
    await sleepMs(Math.min(200, opts.settings.hitSec * 1000), opts.isCancelled)
    return
  }
  if (opts.before && opts.before.qty > 0) {
    const living = opts.before
    opts.setStackVisuals((prev) => ({
      ...prev,
      [opts.stackId]: idleVisual(living, opts.sheets, opts.catalog),
    }))
  }
}
