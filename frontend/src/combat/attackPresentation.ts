import type { Dispatch, SetStateAction } from 'react'
import { stackMaxRange, stackUsesRangedProjectileVisuals } from './battle'
import type { CombatBattle, CombatStack, CombatTombstone } from './battle'
import type { BattleAnimSettings } from './battleAnimConfig'
import { battleHitSettings } from './battleAnimConfig'
import { battleIdleSettings } from './battleAnimConfig'
import { stackArtBox, stackArtBoxFoot } from './combatStackArtBox'
import { combatStackFootprint } from './movement'
import { occupancyKey, stackFootprint } from './occupancy'
import { appendBattleAnimCombatLog } from './battleAnimLogBridge'
import {
  beginBattleTimeline,
  endBattleTimeline,
} from './battleHangWatchdog'
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
  type CombatImpactVisual,
  type CombatProjectileVisual,
  type CombatShapeVisual,
  type StackBattleVisual,
} from './combatUnitAnimVisual'
import { playBattleUnitSoundOnce } from './battleUnitSound'
import {
  computeProjectileFlightEndpoints,
  computeProjectileFlightToHex,
  computeReachEffectPlacement,
  loadBattleImpactEffectArt,
  loadBattleProjectileArt,
  projectileDisplayHeightPx,
  unitProjectileRow,
  warnProjectileArtUnavailable,
  PROJECTILE_ASSET_DIR,
  type BattleProjectileArt,
} from './battleProjectile'
import type { ProjectileRow } from '../town/catalog'
import {
  runBattleHitReactionPhase,
  runBattleWipedDeathAnim,
} from './combatUnitAnimPlayback'
import type { DieFallbackEffectSheet } from './battleDieFallbackEffect'
import type { ReferenceCatalog } from '../town/catalog'
import { unitAttackShape, unitById } from '../town/catalog'
import { closestHexOnTargetFootprint } from './actionOrigin'
import {
  effectiveProjectileRow,
  reachEffectOriginToAimDistance,
  shapeVisualBoxPx,
  shapeVisualPlacement,
  usesBeamLineFlight,
  usesCatalogPerTargetFlight,
  usesChainFlight,
  usesRangedAoeFlight,
  usesReachVisual,
  usesShapeVisual,
  warnProjectileVisualModeMissing,
} from './attackVisualTiming'

export type AttackExchange = {
  strikerId: string
  targetIds: string[]
  beforeStacks: CombatStack[]
  strikeStacks: CombatStack[]
  strikeTombstones: CombatTombstone[]
  hitKeys: string[]
  isRetaliation?: boolean
  beamPathHexes?: import('../hex/hero').Axial[]
  beamAimTargetId?: string | null
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
      isRetaliation: phase.isRetaliation,
      beamPathHexes: phase.beamPathHexes?.map((hex) => ({ ...hex })),
      beamAimTargetId: phase.beamAimTargetId,
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

function hitFlashKeysForTarget(
  targetId: string,
  beforeStacks: CombatStack[],
  hitKeys: string[],
  catalog: ReferenceCatalog,
): string[] {
  const before = beforeStacks.find((row) => row.id === targetId)
  if (!before) {
    return []
  }
  const footprint = new Set(
    stackFootprint(before, catalog).map((hex) => occupancyKey(hex.q, hex.r)),
  )
  return hitKeys.filter((key) => footprint.has(key))
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

function targetFootPx(
  stack: CombatStack,
  anchors: HexAnchor[],
  hexPx: number,
  footOffsetPct: number,
  catalog: ReferenceCatalog,
): { x: number; y: number } {
  const anchor = anchors.find((row) => row.q === stack.q && row.r === stack.r)
  if (!anchor) {
    return { x: 0, y: 0 }
  }
  const foot = stackArtBoxFoot(
    stackArtBox(
      anchor,
      hexPx,
      combatStackFootprint(stack, catalog),
      stack.side,
    ),
    hexPx,
    footOffsetPct,
  )
  return { x: foot.footX, y: foot.footY }
}

function animSheetDurationMs(
  frameCount: number,
  fps: number,
): number {
  return (frameCount / Math.max(1, fps)) * 1000
}

function shapeHitStartDelayMs(row: ProjectileRow, durationMs: number): number {
  const pct = Math.min(100, Math.max(0, row.hit_pct ?? 50))
  return durationMs * (pct / 100)
}

async function spawnImpactVisual(opts: {
  id: string
  x: number
  y: number
  effectName: string
  displayHeightPx: number
  animFps: number
  setImpacts: Dispatch<SetStateAction<CombatImpactVisual[]>>
  isCancelled?: () => boolean
}): Promise<void> {
  const impactArt = await loadBattleImpactEffectArt(opts.effectName)
  if (!impactArt) {
    return
  }
  const startedMs = performance.now()
  const durationMs = impactArt.durationMs(opts.animFps)
  opts.setImpacts((prev) => [
    ...prev,
    {
      id: opts.id,
      x: opts.x,
      y: opts.y,
      startedMs,
      durationMs,
      displayHeightPx: opts.displayHeightPx,
      frames: impactArt.frames,
      animFps: opts.animFps,
    },
  ])
  void sleepMs(durationMs, opts.isCancelled).then(() => {
    opts.setImpacts((prev) => prev.filter((row) => row.id !== opts.id))
  })
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
  setImpacts: Dispatch<SetStateAction<CombatImpactVisual[]>>
  setShapeVisuals: Dispatch<SetStateAction<CombatShapeVisual[]>>
  projectileArtByRowId?: Map<number, BattleProjectileArt | null>
  onHitFlash: (keys: string[]) => void
  isCancelled?: () => boolean
  /** Tomb wiped in-beat (orphan fallback) — mark known so field effect does not re-run. */
  onWipeAnimated?: (stackId: string) => void
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
    const rangedVisual = stackUsesRangedProjectileVisuals(striker, opts.catalog)
    const ranged = rangedVisual && targetFoot != null
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

    type TargetFlightPlan = {
      targetId: string
      travelMs: number
      projId: string
      fromX: number
      fromY: number
      toX: number
      toY: number
      displayHeightPx: number
      staticUrl: string | null
      sheetFrames: import('./battleUnitSheet').BattleUnitFrame[] | null
      sheetLoop: boolean
      impactEffect: string | null
    }

    const strikerUnit = unitById(opts.catalog, striker.unitId)
    const attackShape = strikerUnit
      ? unitAttackShape(strikerUnit).shape
      : 'single'
    const rawProjectileRow = unitProjectileRow(opts.catalog, striker.unitId)
    const effectiveRow = strikerUnit
      ? effectiveProjectileRow(
          opts.catalog,
          striker.unitId,
          attackShape,
          maxRange,
        )
      : null
    const projectileMismatch =
      rawProjectileRow != null && effectiveRow == null
    const aimHex =
      targetBefore != null
        ? closestHexOnTargetFootprint(
            striker,
            targetBefore,
            opts.catalog,
          )
        : { q: striker.q, r: striker.r }

    const shapeMode =
      effectiveRow != null && usesShapeVisual(effectiveRow, attackShape)
    const reachEligible =
      !exchange.isRetaliation &&
      !ranged &&
      effectiveRow != null &&
      usesReachVisual(effectiveRow, strikerUnit, attackShape) &&
      targetBefore != null &&
      reachEffectOriginToAimDistance(striker, targetBefore, opts.catalog) > 1
    const chainMode =
      effectiveRow != null && usesChainFlight(effectiveRow, attackShape)
    const beamMode =
      effectiveRow != null && usesBeamLineFlight(effectiveRow, attackShape)
    const beamVisual =
      attackShape === 'beam' && exchange.isRetaliation !== true
    const beamPathHexes = exchange.beamPathHexes
    const beamEndHex =
      beamPathHexes && beamPathHexes.length > 0
        ? beamPathHexes[beamPathHexes.length - 1]!
        : null
    const rangedAoeMode =
      effectiveRow != null &&
      usesRangedAoeFlight(effectiveRow, attackShape, maxRange)
    const catalogPerTargetFlight =
      effectiveRow != null &&
      usesCatalogPerTargetFlight(effectiveRow, attackShape, maxRange)
    const legacyPerTargetRanged =
      ranged &&
      attackShape !== 'beam' &&
      targetFoot != null &&
      !shapeMode &&
      !chainMode &&
      !beamMode &&
      !rangedAoeMode &&
      !catalogPerTargetFlight &&
      !projectileMismatch &&
      effectiveRow == null &&
      rawProjectileRow == null

    let projectileArt: BattleProjectileArt | null = null
    if (effectiveRow) {
      projectileArt =
        opts.projectileArtByRowId?.get(effectiveRow.id) ??
        (await loadBattleProjectileArt(effectiveRow))
      if (!projectileArt && strikerUnit) {
        warnProjectileArtUnavailable(
          strikerUnit.name,
          effectiveRow.name,
          `${PROJECTILE_ASSET_DIR}/${effectiveRow.name}.png`,
        )
      }
    }

    const reachMode =
      reachEligible &&
      projectileArt?.frames != null &&
      projectileArt.frames.length > 0

    if (
      ranged &&
      strikerUnit &&
      effectiveRow != null &&
      !shapeMode &&
      !reachMode &&
      !chainMode &&
      !beamMode &&
      !rangedAoeMode &&
      !catalogPerTargetFlight &&
      !legacyPerTargetRanged
    ) {
      warnProjectileVisualModeMissing(strikerUnit, effectiveRow, attackShape)
    }

    const flightRow = effectiveRow
    const scalePct = flightRow?.scale_pct ?? rawProjectileRow?.scale_pct ?? 100
    const projFrameH =
      projectileArt?.restHeight ??
      attackSheet?.restHeight ??
      set?.sheets.Idle?.restHeight ??
      64
    const projDisplayHeightPx = projectileDisplayHeightPx(
      opts.hexPx,
      scalePct,
      projFrameH,
    )

    const makeFlightPlan = (
      targetId: string,
      fromStack: CombatStack,
      toStack: CombatStack,
      suffix: string,
    ): TargetFlightPlan => {
      const endpoints =
        flightRow != null
          ? computeProjectileFlightEndpoints({
              striker: fromStack,
              target: toStack,
              catalog: opts.catalog,
              anchors: opts.anchors,
              hexPx: opts.hexPx,
              footOffsetPct: opts.settings.footOffsetPct,
              row: flightRow,
            })
          : null
      const toFp = targetFootPx(
        toStack,
        opts.anchors,
        opts.hexPx,
        opts.settings.footOffsetPct,
        opts.catalog,
      )
      const fromFp =
        fromStack.id === striker.id
          ? attackerFoot
          : targetFootPx(
              fromStack,
              opts.anchors,
              opts.hexPx,
              opts.settings.footOffsetPct,
              opts.catalog,
            )
      const fromX = endpoints?.fromX ?? fromFp.x
      const fromY = endpoints?.fromY ?? fromFp.y
      const toX = endpoints?.toX ?? toFp.x
      const toY = endpoints?.toY ?? toFp.y
      const travelMs = projectileDurationMs(
        fromX,
        fromY,
        toX,
        toY,
        opts.hexPx,
        opts.settings.projectileHexPerSec,
      )
      return {
        targetId,
        travelMs,
        projId: `proj:${striker.id}:${suffix}:${actionStartedMs}`,
        fromX,
        fromY,
        toX,
        toY,
        displayHeightPx: projDisplayHeightPx,
        staticUrl: projectileArt?.frames
          ? null
          : projectileArt?.staticUrl ?? null,
        sheetFrames: projectileArt?.frames ?? null,
        sheetLoop: projectileArt?.loop ?? true,
        impactEffect: flightRow?.impact_effect ?? null,
      }
    }

    const makeBeamHopToHex = (
      fromStack: CombatStack,
      endHex: import('../hex/hero').Axial,
      suffix: string,
      impactEffect: string | null,
    ): TargetFlightPlan => {
      const endpoints = computeProjectileFlightToHex({
        striker: fromStack,
        endHex,
        catalog: opts.catalog,
        anchors: opts.anchors,
        hexPx: opts.hexPx,
        footOffsetPct: opts.settings.footOffsetPct,
        row: flightRow,
        aimHex,
      })
      const fromFp =
        fromStack.id === striker.id
          ? attackerFoot
          : targetFootPx(
              fromStack,
              opts.anchors,
              opts.hexPx,
              opts.settings.footOffsetPct,
              opts.catalog,
            )
      const endAnchor = opts.anchors.find(
        (row) => row.q === endHex.q && row.r === endHex.r,
      )
      const fromX = endpoints?.fromX ?? fromFp.x
      const fromY = endpoints?.fromY ?? fromFp.y
      const toX = endpoints?.toX ?? endAnchor?.x ?? fromFp.x
      const toY = endpoints?.toY ?? endAnchor?.y ?? fromFp.y
      const travelMs = projectileDurationMs(
        fromX,
        fromY,
        toX,
        toY,
        opts.hexPx,
        opts.settings.projectileHexPerSec,
      )
      return {
        targetId: suffix,
        travelMs,
        projId: `proj:${striker.id}:${suffix}:${actionStartedMs}`,
        fromX,
        fromY,
        toX,
        toY,
        displayHeightPx: projDisplayHeightPx,
        staticUrl: projectileArt?.frames
          ? null
          : projectileArt?.staticUrl ?? null,
        sheetFrames: projectileArt?.frames ?? null,
        sheetLoop: projectileArt?.loop ?? true,
        impactEffect,
      }
    }

    const flightPlans: TargetFlightPlan[] = []
    let rangedAoePlan: TargetFlightPlan | null = null

    if (legacyPerTargetRanged || catalogPerTargetFlight) {
      for (const targetId of exchange.targetIds) {
        const before = stackRow(exchange.beforeStacks, targetId)
        if (!before) {
          continue
        }
        flightPlans.push(makeFlightPlan(targetId, striker, before, targetId))
      }
    } else if (rangedAoeMode && targetBefore) {
      rangedAoePlan = makeFlightPlan(
        exchange.targetIds[0] ?? targetBefore.id,
        striker,
        targetBefore,
        'aoe',
      )
    }

    let shapeDurationMs = 0
    let shapeHitDelay = 0
    let reachDurationMs = 0
    let reachHitDelay = 0
    let reachImpactX = 0
    let reachImpactY = 0
    let reachImpactHeightPx = 0
    const reachAnimFps =
      projectileArt?.animFps && projectileArt.animFps > 0
        ? projectileArt.animFps
        : opts.settings.moveFps
    if (
      shapeMode &&
      strikerUnit &&
      effectiveRow &&
      projectileArt?.frames &&
      projectileArt.frames.length > 0
    ) {
      shapeDurationMs = animSheetDurationMs(
        projectileArt.frames.length,
        opts.settings.moveFps,
      )
      shapeHitDelay = shapeHitStartDelayMs(effectiveRow, shapeDurationMs)
    }
    if (reachMode && effectiveRow && projectileArt?.frames) {
      reachDurationMs = animSheetDurationMs(
        projectileArt.frames.length,
        reachAnimFps,
      )
      reachHitDelay = shapeHitStartDelayMs(effectiveRow, reachDurationMs)
      const reachFrame = projectileArt.frames[0]!
      const placement = computeReachEffectPlacement({
        striker,
        target: targetBefore!,
        catalog: opts.catalog,
        anchors: opts.anchors,
        hexPx: opts.hexPx,
        footOffsetPct: opts.settings.footOffsetPct,
        row: effectiveRow,
        frameWidth: reachFrame.w,
        frameHeight: reachFrame.h,
      })
      if (placement) {
        reachImpactX = placement.impactX
        reachImpactY = placement.impactY
        reachImpactHeightPx = placement.displayHeightPx
      } else {
        reachDurationMs = 0
      }
    }

    const strikeAtMs = actionStartedMs + strikeMs
    await waitClip(Math.max(0, strikeAtMs - performance.now()))
    scheduleStrikerIdle()
    const launchMs = performance.now()

    const pushProjectile = (plan: TargetFlightPlan) => {
      opts.setProjectiles((prev) => [
        ...prev,
        {
          id: plan.projId,
          fromX: plan.fromX,
          fromY: plan.fromY,
          toX: plan.toX,
          toY: plan.toY,
          startedMs: launchMs,
          durationMs: plan.travelMs,
          displayHeightPx: plan.displayHeightPx,
          flipY: plan.toX < plan.fromX,
          staticUrl:
            plan.sheetFrames && plan.sheetFrames.length > 0
              ? null
              : plan.staticUrl,
          sheetFrames: plan.sheetFrames,
          sheetLoop: plan.sheetLoop,
          animFps: opts.settings.moveFps,
        },
      ])
    }

    if (shapeMode && strikerUnit && effectiveRow && projectileArt?.frames) {
      const shapeModePlacement =
        attackShape === 'breath' ||
        attackShape === 'cleave' ||
        attackShape === 'pulse' ||
        attackShape === 'aoe'
          ? attackShape
          : 'aoe'
      const placement = shapeVisualPlacement({
        mode: shapeModePlacement,
        striker,
        primaryTarget: targetBefore,
        aimHex,
        catalog: opts.catalog,
        anchors: opts.anchors,
        hexPx: opts.hexPx,
        footOffsetPct: opts.settings.footOffsetPct,
      })
      const box = shapeVisualBoxPx(
        opts.catalog,
        strikerUnit,
        attackShape,
        opts.hexPx,
      )
      const shapeId = `shape:${striker.id}:${launchMs}`
      opts.setShapeVisuals((prev) => [
        ...prev,
        {
          id: shapeId,
          x: placement.x,
          y: placement.y,
          startedMs: launchMs,
          durationMs: shapeDurationMs,
          displayWidthPx: box.width,
          displayHeightPx: box.height,
          angleDeg: placement.angleDeg,
          flipY: placement.flipY,
          rotate: placement.rotate,
          frames: projectileArt.frames!,
          animFps: opts.settings.moveFps,
        },
      ])
      void sleepMs(shapeDurationMs, opts.isCancelled).then(() => {
        opts.setShapeVisuals((prev) => prev.filter((row) => row.id !== shapeId))
      })
    }

    if (
      reachMode &&
      effectiveRow &&
      projectileArt?.frames &&
      targetBefore &&
      reachDurationMs > 0
    ) {
      const reachFrame = projectileArt.frames[0]!
      const placement = computeReachEffectPlacement({
        striker,
        target: targetBefore,
        catalog: opts.catalog,
        anchors: opts.anchors,
        hexPx: opts.hexPx,
        footOffsetPct: opts.settings.footOffsetPct,
        row: effectiveRow,
        frameWidth: reachFrame.w,
        frameHeight: reachFrame.h,
      })
      if (placement) {
        const shapeId = `reach:${striker.id}:${launchMs}`
        opts.setShapeVisuals((prev) => [
          ...prev,
          {
            id: shapeId,
            x: placement.x,
            y: placement.y,
            startedMs: launchMs,
            durationMs: reachDurationMs,
            displayWidthPx: placement.displayWidthPx,
            displayHeightPx: placement.displayHeightPx,
            angleDeg: placement.angleDeg,
            flipY: placement.flipY,
            rotate: placement.rotate,
            frames: projectileArt.frames!,
            animFps: reachAnimFps,
            pinAnchorX: placement.pinAnchorX,
            pinAnchorY: placement.pinAnchorY,
          },
        ])
        void sleepMs(reachDurationMs, opts.isCancelled).then(() => {
          opts.setShapeVisuals((prev) =>
            prev.filter((row) => row.id !== shapeId),
          )
        })
      }
    }

    if (legacyPerTargetRanged || catalogPerTargetFlight) {
      for (const plan of flightPlans) {
        pushProjectile(plan)
      }
    } else if (rangedAoePlan) {
      pushProjectile(rangedAoePlan)
    }

    let displayPushed = false
    const pushStrikeDisplayOnce = () => {
      if (displayPushed) {
        return
      }
      displayPushed = true
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
    }
    const pushChainHopStrikeDisplay = (targetId: string) => {
      pushDisplay(
        applyStrikeToDisplay(display, exchange.strikeStacks, [targetId]),
      )
      const hopKeys = hitFlashKeysForTarget(
        targetId,
        exchange.beforeStacks,
        exchange.hitKeys,
        opts.catalog,
      )
      if (hopKeys.length > 0) {
        opts.onHitFlash(hopKeys)
      }
    }

    const reactionWaits: Promise<void>[] = []
    const defenderHitWaits: Promise<void>[] = []

    const runTargetReaction = async (args: {
      targetId: string
      delayMs: number
      plan: TargetFlightPlan | null
      playImpact: boolean
      /** Chain hop: strike display + flash for this target only. */
      chainHop?: boolean
    }) => {
      await waitClip(args.delayMs)
      if (opts.isCancelled?.()) {
        return
      }
      const before = stackRow(exchange.beforeStacks, args.targetId)
      const wiped = isWipedTarget(
        args.targetId,
        before,
        exchange.strikeStacks,
        exchange.strikeTombstones,
      )
      const tFoot = before
        ? targetFootPx(
            before,
            opts.anchors,
            opts.hexPx,
            opts.settings.footOffsetPct,
            opts.catalog,
          )
        : { x: attackerFoot.x, y: attackerFoot.y }
      if (args.plan) {
        opts.setProjectiles((prev) =>
          prev.filter((row) => row.id !== args.plan!.projId),
        )
        if (args.playImpact && args.plan.impactEffect) {
          await spawnImpactVisual({
            id: `imp:${args.plan.projId}`,
            x: args.plan.toX,
            y: args.plan.toY,
            effectName: args.plan.impactEffect,
            displayHeightPx: args.plan.displayHeightPx,
            animFps: opts.settings.moveFps,
            setImpacts: opts.setImpacts,
            isCancelled: opts.isCancelled,
          })
        }
      }
      if (args.chainHop) {
        pushChainHopStrikeDisplay(args.targetId)
      } else {
        pushStrikeDisplayOnce()
      }
      await runTargetBeat({
        stackId: args.targetId,
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
          pushDisplay(removeStackFromDisplay(display, args.targetId, tomb))
        },
        isCancelled: opts.isCancelled,
        hexPx: opts.hexPx,
        attackerFootX: attackerFoot.x,
        attackerFootY: attackerFoot.y,
        targetFoot: tFoot,
        hitOrigin: { x: attackerFoot.x, y: attackerFoot.y },
      })
    }

    if (beamVisual && beamPathHexes && beamEndHex) {
      const beamWait = (async () => {
        const victimIds = exchange.targetIds.filter((targetId) => {
          const before = stackRow(exchange.beforeStacks, targetId)
          return before != null && before.side !== striker.side
        })
        let hopFrom = striker
        const flySegment = async (plan: TargetFlightPlan) => {
          const segLaunch = performance.now()
          opts.setProjectiles((prev) => [
            ...prev,
            {
              id: plan.projId,
              fromX: plan.fromX,
              fromY: plan.fromY,
              toX: plan.toX,
              toY: plan.toY,
              startedMs: segLaunch,
              durationMs: plan.travelMs,
              displayHeightPx: plan.displayHeightPx,
              flipY: plan.toX < plan.fromX,
              staticUrl:
                plan.sheetFrames && plan.sheetFrames.length > 0
                  ? null
                  : plan.staticUrl,
              sheetFrames: plan.sheetFrames,
              sheetLoop: plan.sheetLoop,
              animFps: opts.settings.moveFps,
            },
          ])
          await waitClip(plan.travelMs)
          if (opts.isCancelled?.()) {
            return false
          }
          opts.setProjectiles((prev) =>
            prev.filter((row) => row.id !== plan.projId),
          )
          return true
        }
        for (const targetId of victimIds) {
          const before = stackRow(exchange.beforeStacks, targetId)
          if (!before) {
            continue
          }
          const plan = makeFlightPlan(
            targetId,
            hopFrom,
            before,
            `beam:${targetId}`,
          )
          if (!(await flySegment(plan))) {
            return
          }
          await runTargetReaction({
            targetId,
            delayMs: 0,
            plan,
            playImpact: true,
            chainHop: true,
          })
          hopFrom = before
        }
        const tailPlan = makeBeamHopToHex(
          hopFrom,
          beamEndHex,
          'beam:tail',
          null,
        )
        await flySegment(tailPlan)
      })()
      reactionWaits.push(beamWait)
      for (const targetId of exchange.targetIds) {
        const before = stackRow(exchange.beforeStacks, targetId)
        if (!before || before.side === striker.side) {
          continue
        }
        defenderHitWaits.push(beamWait)
      }
    } else if (chainMode && effectiveRow) {
      const chainWait = (async () => {
        let hopFrom = striker
        for (const targetId of exchange.targetIds) {
          const before = stackRow(exchange.beforeStacks, targetId)
          if (!before) {
            continue
          }
          const plan = makeFlightPlan(
            targetId,
            hopFrom,
            before,
            `chain:${targetId}`,
          )
          const segLaunch = performance.now()
          opts.setProjectiles((prev) => [
            ...prev,
            {
              id: plan.projId,
              fromX: plan.fromX,
              fromY: plan.fromY,
              toX: plan.toX,
              toY: plan.toY,
              startedMs: segLaunch,
              durationMs: plan.travelMs,
              displayHeightPx: plan.displayHeightPx,
              flipY: plan.toX < plan.fromX,
              staticUrl:
                plan.sheetFrames && plan.sheetFrames.length > 0
                  ? null
                  : plan.staticUrl,
              sheetFrames: plan.sheetFrames,
              sheetLoop: plan.sheetLoop,
              animFps: opts.settings.moveFps,
            },
          ])
          await waitClip(plan.travelMs)
          if (opts.isCancelled?.()) {
            return
          }
          await runTargetReaction({
            targetId,
            delayMs: 0,
            plan,
            playImpact: true,
            chainHop: true,
          })
          hopFrom = before
        }
      })()
      reactionWaits.push(chainWait)
      for (const targetId of exchange.targetIds) {
        const before = stackRow(exchange.beforeStacks, targetId)
        if (!before || before.side === striker.side) {
          continue
        }
        defenderHitWaits.push(chainWait)
      }
    } else if (rangedAoeMode && rangedAoePlan && strikerUnit) {
      const aoeWait = (async () => {
        await waitClip(rangedAoePlan.travelMs)
        if (opts.isCancelled?.()) {
          return
        }
        opts.setProjectiles((prev) =>
          prev.filter((row) => row.id !== rangedAoePlan!.projId),
        )
        const aimAnchor = opts.anchors.find(
          (row) => row.q === aimHex.q && row.r === aimHex.r,
        )
        const impactX = aimAnchor?.x ?? rangedAoePlan.toX
        const impactY = aimAnchor?.y ?? rangedAoePlan.toY
        const box = shapeVisualBoxPx(
          opts.catalog,
          strikerUnit,
          'aoe',
          opts.hexPx,
        )
        if (rangedAoePlan.impactEffect) {
          await spawnImpactVisual({
            id: `imp:${rangedAoePlan.projId}`,
            x: impactX,
            y: impactY,
            effectName: rangedAoePlan.impactEffect,
            displayHeightPx: box.height,
            animFps: opts.settings.moveFps,
            setImpacts: opts.setImpacts,
            isCancelled: opts.isCancelled,
          })
        }
        pushStrikeDisplayOnce()
        for (const targetId of exchange.targetIds) {
          const before = stackRow(exchange.beforeStacks, targetId)
          const wiped = isWipedTarget(
            targetId,
            before,
            exchange.strikeStacks,
            exchange.strikeTombstones,
          )
          const tFoot = before
            ? targetFootPx(
                before,
                opts.anchors,
                opts.hexPx,
                opts.settings.footOffsetPct,
                opts.catalog,
              )
            : { x: attackerFoot.x, y: attackerFoot.y }
          await runTargetBeat({
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
            targetFoot: tFoot,
            hitOrigin: { x: attackerFoot.x, y: attackerFoot.y },
          })
        }
      })()
      reactionWaits.push(aoeWait)
      for (const targetId of exchange.targetIds) {
        const before = stackRow(exchange.beforeStacks, targetId)
        if (!before || before.side === striker.side) {
          continue
        }
        defenderHitWaits.push(aoeWait)
      }
    } else if (!beamVisual) {
      for (const targetId of exchange.targetIds) {
        const before = stackRow(exchange.beforeStacks, targetId)
        const plan = flightPlans.find((row) => row.targetId === targetId) ?? null
        let delayMs = 0
        let impactPlan: TargetFlightPlan | null = null
        let playImpact = true
        if (shapeMode) {
          delayMs = shapeHitDelay
        } else if (reachMode) {
          delayMs = reachHitDelay
        } else if (plan) {
          delayMs = plan.travelMs
          impactPlan = plan
        }

        const reaction = runTargetReaction({
          targetId,
          delayMs,
          plan: impactPlan,
          playImpact,
        })
        reactionWaits.push(reaction)
        if (before && before.side !== striker.side) {
          defenderHitWaits.push(reaction)
        }
      }
      if (reachMode && effectiveRow?.impact_effect && reachDurationMs > 0) {
        const impactWait = (async () => {
          await waitClip(reachHitDelay)
          if (opts.isCancelled?.()) {
            return
          }
          await spawnImpactVisual({
            id: `imp:reach:${striker.id}:${launchMs}`,
            x: reachImpactX,
            y: reachImpactY,
            effectName: effectiveRow.impact_effect!,
            displayHeightPx: reachImpactHeightPx,
            animFps: opts.settings.moveFps,
            setImpacts: opts.setImpacts,
            isCancelled: opts.isCancelled,
          })
        })()
        reactionWaits.push(impactWait)
      }
    }

    const immediateMeleeDisplay =
      !shapeMode &&
      !reachMode &&
      !chainMode &&
      !beamVisual &&
      !rangedAoeMode &&
      !legacyPerTargetRanged &&
      !catalogPerTargetFlight
    if (immediateMeleeDisplay) {
      pushStrikeDisplayOnce()
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

    const priorTombIds = new Set(
      (ex === 0
        ? (opts.display.tombstones ?? [])
        : opts.exchanges[ex - 1]!.strikeTombstones
      ).map((tomb) => tomb.id),
    )
    const targetSet = new Set(exchange.targetIds)
    for (const tomb of exchange.strikeTombstones) {
      if (priorTombIds.has(tomb.id) || targetSet.has(tomb.id)) {
        continue
      }
      const unitName =
        unitById(opts.catalog, tomb.unitId)?.name ?? `unit ${tomb.unitId}`
      appendBattleAnimCombatLog(
        `[Dev] Orphan exchange wipe: ${unitName} (${tomb.id}) — playing Die in-beat.`,
      )
      const before = stackRow(exchange.beforeStacks, tomb.id)
      const tFoot = before
        ? targetFootPx(
            before,
            opts.anchors,
            opts.hexPx,
            opts.settings.footOffsetPct,
            opts.catalog,
          )
        : { x: attackerFoot.x, y: attackerFoot.y }
      await runTargetBeat({
        stackId: tomb.id,
        wiped: true,
        before,
        strikeTombs: exchange.strikeTombstones,
        catalog: opts.catalog,
        settings: opts.settings,
        sheets: opts.sheets,
        dieFallbackEffects: opts.dieFallbackEffects,
        setStackVisuals: opts.setStackVisuals,
        beatMs,
        onDieStart: (tombstone) => {
          pushDisplay(removeStackFromDisplay(display, tomb.id, tombstone))
        },
        isCancelled: opts.isCancelled,
        hexPx: opts.hexPx,
        attackerFootX: attackerFoot.x,
        attackerFootY: attackerFoot.y,
        targetFoot: tFoot,
        hitOrigin: { x: attackerFoot.x, y: attackerFoot.y },
      })
      opts.onWipeAnimated?.(tomb.id)
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
  opts.setProjectiles([])
  opts.setImpacts([])
  opts.setShapeVisuals([])
}

async function runTargetBeat(
  opts: Parameters<typeof runTargetBeatBody>[0],
): Promise<void> {
  const timeline = beginBattleTimeline(
    opts.wiped ? 'die-beat' : 'hit-beat',
    opts.stackId,
  )
  try {
    await runTargetBeatBody(opts)
  } finally {
    endBattleTimeline(timeline)
  }
}

async function runTargetBeatBody(opts: {
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
      unitId,
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
      dieFxAnchor: opts.before
        ? {
            q: opts.before.q,
            r: opts.before.r,
            side: opts.before.side,
            unitId: opts.before.unitId,
          }
        : tomb
          ? {
              q: tomb.q,
              r: tomb.r,
              side: tomb.side,
              unitId: tomb.unitId,
            }
          : undefined,
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
