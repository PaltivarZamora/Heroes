import type { Dispatch, SetStateAction } from 'react'
import type { BattleAnimSettings } from './battleAnimConfig'
import { battleHitSettings } from './battleAnimConfig'
import { logBattleReactionTest } from './battleAnimConfig'
import { appendBattleAnimCombatLog } from './battleAnimLogBridge'
import type { BattleUnitSheetSet } from './battleUnitSheet'
import {
  beginBattleUnitMoveSound,
  playBattleUnitHitSoundIfPresent,
  playBattleUnitSoundOnce,
  stopBattleUnitMoveSound,
  warnBattleUnitSoundMissing,
} from './battleUnitSound'
import type { CombatStack } from './battle'
import { isHeroStack } from './battle'
import type { CombatTombstone } from './battle'
import {
  defaultStackVisual,
  restoreIdleStackVisual,
  sleepMs,
  type StackBattleVisual,
} from './combatUnitAnimVisual'
import { updateSession } from '../session/store'
import type { ReferenceCatalog } from '../town/catalog'
import { combatStackFootprint } from './movement'
import {
  stackArtBox,
  stackArtBoxFoot,
} from './combatStackArtBox'
import type { CombatSide } from './battle'
import {
  battleUnitDieSheetDrawable,
  battleUnitHasOwnDrawableDieSheet,
  battleUnitSheetForUnit,
  flipBattleUnitForSide,
  reportBattleUnitDieNotDrawable,
} from './battleUnitSheet'
import { unitById } from '../town/catalog'
import {
  battleUnitHasHitSheet,
  formatProceduralHitDevLog,
  rollProceduralHitMotion,
  type ProceduralHitMotion,
} from './proceduralBattleHit'
import {
  applyDieFallbackScheduleVisual,
  dieFallbackEffectNames,
  formatDieFallbackCombatLogLine,
  pickRandomLoadedDieFallbackEffect,
  runBattleDieFallbackAfterHit,
  runBattleDieFallbackTimeline,
  tryPrimeDieFallbackSchedule,
  type DieFallbackEffectSheet,
} from './battleDieFallbackEffect'

type MoveAnchor = { q: number; r: number; x: number; y: number }

export function buildBattleMovePathFeet(
  anchors: MoveAnchor[],
  hexPx: number,
  footOffsetPct: number,
  footprint: import('./footprint').FootprintCode,
  side: CombatSide,
  startQ: number,
  startR: number,
  steps: Array<{ q: number; r: number }>,
): Array<{ x: number; y: number }> {
  const feet: Array<{ x: number; y: number }> = []
  const add = (q: number, r: number) => {
    const anchor = anchors.find((row) => row.q === q && row.r === r)
    if (!anchor) {
      return
    }
    const box = stackArtBox(anchor, hexPx, footprint, side)
    feet.push({
      x: stackArtBoxFoot(box, hexPx, footOffsetPct).footX,
      y: stackArtBoxFoot(box, hexPx, footOffsetPct).footY,
    })
  }
  add(startQ, startR)
  for (const step of steps) {
    add(step.q, step.r)
  }
  return feet
}

async function sleepUntilMs(
  targetMs: number,
  isCancelled?: () => boolean,
): Promise<void> {
  while (performance.now() < targetMs) {
    if (isCancelled?.()) {
      return
    }
    await sleepMs(Math.min(32, targetMs - performance.now()), isCancelled)
  }
}

export async function beginBattleMovePathVisual(opts: {
  stackId: string
  pathFeet: Array<{ x: number; y: number }>
  settings: BattleAnimSettings
  moveStem: string | null
  movePartnerStem?: string | null
  useMoveSheet: boolean
  moveFrameCount: number
  setStackVisuals: Dispatch<SetStateAction<Record<string, StackBattleVisual>>>
}): Promise<number> {
  if (opts.pathFeet.length < 2) {
    return performance.now()
  }
  const startedMs = performance.now()
  const first = opts.pathFeet[0]!
  const second = opts.pathFeet[1]!
  opts.setStackVisuals((prev) => ({
    ...prev,
    [opts.stackId]: {
      kind: opts.useMoveSheet ? 'Move' : 'idle',
      startedMs,
      frameOffset: defaultStackVisual(opts.moveFrameCount).frameOffset,
      flipX: second.x < first.x,
      slide: {
        startedMs,
        pathFeet: opts.pathFeet,
        secPerHex: opts.settings.moveSecPerHex,
      },
    },
  }))
  if (opts.useMoveSheet && opts.moveStem) {
    const soundStart = await beginBattleUnitMoveSound(
      opts.moveStem,
      opts.movePartnerStem,
    )
    if (soundStart === 'missing') {
      updateSession((current) =>
        warnBattleUnitSoundMissing(current, `${opts.moveStem}_Move.mp3`),
      )
    }
  }
  return startedMs
}

export async function awaitBattleMovePathWaypoint(
  pathStartedMs: number,
  secPerHex: number,
  waypointIndex: number,
  isCancelled?: () => boolean,
): Promise<void> {
  if (waypointIndex <= 0) {
    return
  }
  const targetMs = pathStartedMs + waypointIndex * secPerHex * 1000
  await sleepUntilMs(targetMs, isCancelled)
}

export async function endBattleMovePathVisual(opts: {
  stackId: string
  idleFrameCount: number
  useMoveSheet: boolean
  setStackVisuals: Dispatch<SetStateAction<Record<string, StackBattleVisual>>>
}): Promise<void> {
  if (opts.useMoveSheet) {
    stopBattleUnitMoveSound(200)
  }
  opts.setStackVisuals((prev) => ({
    ...prev,
    [opts.stackId]: restoreIdleStackVisual(
      opts.stackId,
      opts.idleFrameCount,
      prev,
    ),
  }))
}

export function stackUsesBattleAnim(
  stack: CombatStack,
  catalog: ReferenceCatalog | null | undefined,
  sheets: Map<number, BattleUnitSheetSet | null>,
): boolean {
  if (!catalog || stack.qty <= 0) {
    return false
  }
  return Boolean(sheets.get(stack.unitId)?.animated)
}

/** Battle sprite layer (incl. procedural Hit on a stack wiped mid-beat, before tomb). */
export function stackShowsBattleSprites(
  stack: CombatStack,
  catalog: ReferenceCatalog | null | undefined,
  sheets: Map<number, BattleUnitSheetSet | null>,
  visual: StackBattleVisual | undefined,
  paintNowMs?: number,
): boolean {
  if (!catalog || isHeroStack(stack)) {
    return false
  }
  if (!sheets.get(stack.unitId)?.animated) {
    return false
  }
  if (
    visual?.dieFallbackFx &&
    paintNowMs != null &&
    paintNowMs >= visual.dieFallbackFx.diePhaseStartMs
  ) {
    return false
  }
  if (stack.qty > 0) {
    return true
  }
  if (!visual) {
    return false
  }
  if (visual.kind === 'idle' && !visual.slide) {
    return false
  }
  return (
    visual.kind === 'Hit' ||
    visual.kind === 'Die' ||
    visual.kind === 'Attack' ||
    visual.kind === 'Move'
  )
}

/** Hide the static footprint box chrome while battle sheets load or when sprites draw. */
export function stackHidesFootprintBoxChrome(
  stack: CombatStack,
  catalog: ReferenceCatalog | null | undefined,
  sheets: Map<number, BattleUnitSheetSet | null>,
  sheetsPreloadActive: boolean,
  visual?: StackBattleVisual,
): boolean {
  if (!catalog || isHeroStack(stack)) {
    return false
  }
  if (stackShowsBattleSprites(stack, catalog, sheets, visual)) {
    return true
  }
  if (stack.qty <= 0) {
    return false
  }
  if (!sheetsPreloadActive) {
    return false
  }
  return !sheets.has(stack.unitId)
}

function resolveTargetFoot(
  before: CombatStack | undefined,
  catalog: ReferenceCatalog,
  hexPx: number,
  footOffsetPct: number,
  anchors: MoveAnchor[],
): { x: number; y: number } {
  if (!before || hexPx <= 0 || anchors.length === 0) {
    return { x: 0, y: 0 }
  }
  const anchor = anchors.find((row) => row.q === before.q && row.r === before.r)
  if (!anchor) {
    return { x: 0, y: 0 }
  }
  const footprint = combatStackFootprint(before, catalog)
  const box = stackArtBox(anchor, hexPx, footprint, before.side)
  const foot = stackArtBoxFoot(box, hexPx, footOffsetPct)
  return { x: foot.footX, y: foot.footY }
}

export async function runBattleHitReactionPhase(opts: {
  stackId: string
  set: BattleUnitSheetSet
  settings: BattleAnimSettings
  sideFlipX: boolean
  proceduralHit: ProceduralHitMotion | null
  setStackVisuals: Dispatch<SetStateAction<Record<string, StackBattleVisual>>>
  isCancelled?: () => boolean
  unitName?: string
  actionStartedMs?: number
}): Promise<boolean> {
  const hasHitSheet = battleUnitHasHitSheet(opts.set)
  if (!hasHitSheet && !opts.proceduralHit) {
    return false
  }
  const hitSheet = opts.set.sheets.Hit
  const durationMs = opts.settings.hitSec * 1000
  const sheet = hasHitSheet ? hitSheet! : null
  const soundPct =
    sheet && Number.isFinite(sheet.soundStartPct) && sheet.soundStartPct >= 0
      ? sheet.soundStartPct
      : 0
  const soundDelayMs = durationMs * soundPct
  const startedMs = opts.actionStartedMs ?? performance.now()
  opts.setStackVisuals((prev) => {
    const dieFallbackFx = prev[opts.stackId]?.dieFallbackFx
    return {
      ...prev,
      [opts.stackId]: {
        kind: 'Hit',
        startedMs,
        frameOffset: 0,
        flipX: opts.sideFlipX,
        ...(opts.proceduralHit ? { proceduralHit: opts.proceduralHit } : {}),
        ...(dieFallbackFx ? { dieFallbackFx } : {}),
      },
    }
  })
  if (opts.proceduralHit) {
    appendBattleAnimCombatLog(
      formatProceduralHitDevLog(
        opts.unitName ?? opts.stackId,
        opts.proceduralHit,
        opts.sideFlipX,
      ),
    )
  }
  await sleepMs(soundDelayMs, opts.isCancelled)
  const soundHandle =
    !hasHitSheet && opts.proceduralHit
      ? await playBattleUnitHitSoundIfPresent(
          opts.set.stem,
          opts.set.partnerSoundStem ?? null,
        )
      : await playBattleUnitSoundOnce(
          opts.set.stem,
          'Hit',
          opts.unitName
            ? { unitName: opts.unitName, actionStartedMs: startedMs }
            : undefined,
          opts.set.partnerSoundStem ?? null,
        )
  if (!soundHandle && !(!hasHitSheet && opts.proceduralHit)) {
    updateSession((current) =>
      warnBattleUnitSoundMissing(current, `${opts.set.stem}_Hit.mp3`),
    )
  }
  const animTailMs = Math.max(0, durationMs - soundDelayMs)
  await sleepMs(animTailMs, opts.isCancelled)
  return true
}

export async function runBattleDieReactionPhase(opts: {
  stackId: string
  set: BattleUnitSheetSet
  settings: BattleAnimSettings
  sideFlipX: boolean
  setStackVisuals: Dispatch<SetStateAction<Record<string, StackBattleVisual>>>
  isCancelled?: () => boolean
  unitName?: string
  onLogged?: (detail: string) => void
}): Promise<boolean> {
  const dieSheet = opts.set.sheets.Die
  if (!dieSheet) {
    return false
  }
  if (!battleUnitDieSheetDrawable(dieSheet)) {
    updateSession((current) =>
      reportBattleUnitDieNotDrawable(current, opts.set.stem),
    )
    opts.onLogged?.('Die: sheet not drawable, sound skipped')
    return false
  }
  const durationMs = opts.settings.dieSec * 1000
  const soundPct =
    Number.isFinite(dieSheet!.soundStartPct) && dieSheet!.soundStartPct >= 0
      ? dieSheet!.soundStartPct
      : 0
  const soundDelayMs = durationMs * soundPct
  const startedMs = performance.now()
  opts.setStackVisuals((prev) => ({
    ...prev,
    [opts.stackId]: {
      kind: 'Die',
      startedMs,
      frameOffset: 0,
      flipX: opts.sideFlipX,
    },
  }))
  await sleepMs(soundDelayMs, opts.isCancelled)
  const soundHandle = await playBattleUnitSoundOnce(
    opts.set.stem,
    'Die',
    opts.unitName
      ? { unitName: opts.unitName, actionStartedMs: startedMs }
      : undefined,
    opts.set.partnerSoundStem ?? null,
  )
  const soundOk = soundHandle != null
  if (!soundOk) {
    updateSession((current) =>
      warnBattleUnitSoundMissing(current, `${opts.set.stem}_Die.mp3`),
    )
  }
  const animTailMs = Math.max(0, durationMs - soundDelayMs)
  await Promise.all([
    sleepMs(animTailMs, opts.isCancelled),
    soundHandle ? soundHandle.waitUntilDone() : Promise.resolve(),
  ])
  opts.setStackVisuals((prev) => ({
    ...prev,
    [opts.stackId]: {
      kind: 'Die',
      startedMs,
      frameOffset: 0,
      dieHoldFrame: true,
      flipX: opts.sideFlipX,
    },
  }))
  opts.onLogged?.(
    `Die: sheet found, sound ${soundOk ? 'played' : 'missing'}, last frame held`,
  )
  return true
}

async function runBattleWipedDeathAnim(opts: {
  stackId: string
  set: BattleUnitSheetSet | null
  catalog: ReferenceCatalog
  settings: BattleAnimSettings
  sideFlipX: boolean
  setStackVisuals: Dispatch<SetStateAction<Record<string, StackBattleVisual>>>
  dieFallbackEffects: Map<string, DieFallbackEffectSheet | null>
  isCancelled?: () => boolean
  unitName?: string
  onLogged?: (detail: string) => void
  strikeKill: boolean
  proceduralHit: ProceduralHitMotion | null
  onDieStart?: () => void
}): Promise<void> {
  const hasDieSheet = battleUnitHasOwnDrawableDieSheet(opts.set)
  const hasHitSheet = opts.set ? battleUnitHasHitSheet(opts.set) : false
  let hitStartMs: number | null = null
  let primedSchedule: ReturnType<typeof tryPrimeDieFallbackSchedule> = null

  if (
    opts.strikeKill &&
    opts.set &&
    (hasHitSheet || opts.proceduralHit)
  ) {
    hitStartMs = performance.now()
    if (!hasDieSheet) {
      primedSchedule = tryPrimeDieFallbackSchedule(
        opts.catalog,
        opts.settings,
        opts.dieFallbackEffects,
        hitStartMs,
      )
      if (primedSchedule) {
        applyDieFallbackScheduleVisual(
          opts.setStackVisuals,
          opts.stackId,
          primedSchedule.schedule,
        )
        const logLine = formatDieFallbackCombatLogLine(
          opts.unitName ?? opts.stackId,
          primedSchedule.effect.name,
          primedSchedule.effect,
        )
        opts.onLogged?.(logLine)
        appendBattleAnimCombatLog(logLine)
      } else if (dieFallbackEffectNames(opts.catalog).length > 0) {
        const pickName =
          dieFallbackEffectNames(opts.catalog)[0] ?? 'Effect_Die_Skull'
        const logLine = formatDieFallbackCombatLogLine(
          opts.unitName ?? opts.stackId,
          pickName,
          opts.dieFallbackEffects.get(pickName),
        )
        opts.onLogged?.(logLine)
        appendBattleAnimCombatLog(logLine)
      }
    }
    const hitPlayed = await runBattleHitReactionPhase({
      stackId: opts.stackId,
      set: opts.set,
      settings: opts.settings,
      sideFlipX: opts.sideFlipX,
      proceduralHit: opts.proceduralHit,
      setStackVisuals: opts.setStackVisuals,
      isCancelled: opts.isCancelled,
      unitName: opts.unitName,
      actionStartedMs: hitStartMs,
    })
    if (hitPlayed) {
      opts.onLogged?.('Hit: played before Die on killing blow')
    }
  }

  if (hasDieSheet && opts.set) {
    opts.onDieStart?.()
    await runBattleDieReactionPhase({
      stackId: opts.stackId,
      set: opts.set,
      settings: opts.settings,
      sideFlipX: opts.sideFlipX,
      setStackVisuals: opts.setStackVisuals,
      isCancelled: opts.isCancelled,
      unitName: opts.unitName,
      onLogged: opts.onLogged,
    })
    return
  }

  if (primedSchedule) {
    await runBattleDieFallbackAfterHit({
      stackId: opts.stackId,
      catalog: opts.catalog,
      settings: opts.settings,
      schedule: primedSchedule.schedule,
      setStackVisuals: opts.setStackVisuals,
      onDieStart: opts.onDieStart,
      isCancelled: opts.isCancelled,
    })
    return
  }

  const effect = pickRandomLoadedDieFallbackEffect(
    opts.catalog,
    opts.dieFallbackEffects,
  )
  if (effect) {
    const logLine = formatDieFallbackCombatLogLine(
      opts.unitName ?? opts.stackId,
      effect.name,
      effect,
    )
    opts.onLogged?.(logLine)
    appendBattleAnimCombatLog(logLine)
  }
  const played = await runBattleDieFallbackTimeline({
    stackId: opts.stackId,
    catalog: opts.catalog,
    settings: opts.settings,
    loadedEffects: opts.dieFallbackEffects,
    setStackVisuals: opts.setStackVisuals,
    hitPhaseStartMs: null,
    onDieStart: opts.onDieStart,
    isCancelled: opts.isCancelled,
  })
  if (!played) {
    opts.onDieStart?.()
    opts.onLogged?.('Die: fallback unavailable, tombstone only')
  }
}

async function runTargetReactionAnims(opts: {
  beforeStacks: CombatStack[]
  afterStacks: CombatStack[]
  tombstones: CombatTombstone[]
  targetIds: string[]
  catalog: ReferenceCatalog
  settings: BattleAnimSettings
  sheets: Map<number, BattleUnitSheetSet | null>
  dieFallbackEffects: Map<string, DieFallbackEffectSheet | null>
  setStackVisuals: Dispatch<SetStateAction<Record<string, StackBattleVisual>>>
  isCancelled?: () => boolean
  attackerFootX?: number | null
  attackerFootY?: number | null
  hexPx?: number
  anchors?: MoveAnchor[]
}): Promise<void> {
  const uniqueTargets = [...new Set(opts.targetIds)]
  await Promise.all(
    uniqueTargets.map((id) =>
      runOneTargetReactionAnim({
        stackId: id,
        beforeStacks: opts.beforeStacks,
        afterStacks: opts.afterStacks,
        tombstones: opts.tombstones,
        catalog: opts.catalog,
        settings: opts.settings,
        sheets: opts.sheets,
        dieFallbackEffects: opts.dieFallbackEffects,
        setStackVisuals: opts.setStackVisuals,
        isCancelled: opts.isCancelled,
        attackerFootX: opts.attackerFootX ?? null,
        attackerFootY: opts.attackerFootY ?? null,
        hexPx: opts.hexPx ?? 0,
        anchors: opts.anchors ?? [],
      }),
    ),
  )
}

async function runOneTargetReactionAnim(opts: {
  stackId: string
  beforeStacks: CombatStack[]
  afterStacks: CombatStack[]
  tombstones: CombatTombstone[]
  catalog: ReferenceCatalog
  settings: BattleAnimSettings
  sheets: Map<number, BattleUnitSheetSet | null>
  dieFallbackEffects: Map<string, DieFallbackEffectSheet | null>
  setStackVisuals: Dispatch<SetStateAction<Record<string, StackBattleVisual>>>
  isCancelled?: () => boolean
  attackerFootX: number | null
  attackerFootY: number | null
  hexPx: number
  anchors: MoveAnchor[]
}): Promise<void> {
  const living = opts.afterStacks.find((row) => row.id === opts.stackId)
  const before = opts.beforeStacks.find((row) => row.id === opts.stackId)
  const tomb = opts.tombstones.find((row) => row.id === opts.stackId)
  const unitId = living?.unitId ?? tomb?.unitId ?? before?.unitId
  const unitName =
    unitId != null
      ? (unitById(opts.catalog, unitId)?.name ?? `unit ${unitId}`)
      : opts.stackId
  const logReaction = (detail: string) => {
    updateSession((current) =>
      logBattleReactionTest(current, `${unitName} ${detail}`),
    )
  }
  if (unitId == null) {
    logReaction('reaction skipped: no unit id')
    return
  }
  let set = opts.sheets.get(unitId) ?? null
  if (!set) {
    const unit = unitById(opts.catalog, unitId)
    set = unit ? battleUnitSheetForUnit(opts.catalog, unit) : null
  }
  if (!set) {
    const wipedEarly =
      Boolean(tomb) ||
      (before != null && (living == null || living.qty <= 0))
    if (wipedEarly) {
      await runBattleWipedDeathAnim({
        stackId: opts.stackId,
        set: null,
        catalog: opts.catalog,
        settings: opts.settings,
        sideFlipX: flipBattleUnitForSide(
          tomb?.side ?? before?.side ?? 'def',
        ),
        setStackVisuals: opts.setStackVisuals,
        dieFallbackEffects: opts.dieFallbackEffects,
        isCancelled: opts.isCancelled,
        unitName,
        onLogged: logReaction,
        strikeKill: before != null,
        proceduralHit: null,
      })
    } else {
      logReaction('reaction skipped: no sheet set loaded')
    }
    return
  }
  const wiped =
    Boolean(tomb) ||
    (before != null && (living == null || living.qty <= 0))
  const strikeKill = wiped && before != null
  const hasHitSheet = battleUnitHasHitSheet(set)
  const unit = unitById(opts.catalog, unitId)
  const hitSettings = battleHitSettings(opts.catalog)
  const targetFoot = resolveTargetFoot(
    before,
    opts.catalog,
    opts.hexPx,
    opts.settings.footOffsetPct,
    opts.anchors,
  )
  const originFoot = {
    x: opts.attackerFootX ?? targetFoot.x,
    y: opts.attackerFootY ?? targetFoot.y,
  }
  const proceduralHit =
    !hasHitSheet && unit && set.animated
      ? rollProceduralHitMotion(
          hitSettings,
          unit,
          opts.hexPx,
          originFoot,
          targetFoot,
        )
      : null
  if (!wiped) {
    appendBattleAnimCombatLog(
      `${unitName} (${set.stem}) Die sound skipped: stack survived`,
    )
  }
  const stackSide =
    tomb?.side ?? before?.side ?? living?.side ?? ('def' as const)
  const sideFlipX = flipBattleUnitForSide(stackSide)

  if (strikeKill || wiped) {
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
      onLogged: logReaction,
      strikeKill,
      proceduralHit,
    })
    return
  }

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
    logReaction('Hit: sheet missing, sound skipped')
    return
  }
  logReaction('Hit: sheet found, sound played')
  opts.setStackVisuals((prev) => ({
    ...prev,
    [opts.stackId]: restoreIdleStackVisual(
      opts.stackId,
      set.sheets.Idle?.frames.length ?? 1,
      prev,
    ),
  }))
}

/** Die animation for tombstones created outside an attack reaction (hazards, spells, etc.). */
export async function runWipeDieAnimsForTombs(opts: {
  tombs: CombatTombstone[]
  catalog: ReferenceCatalog
  settings: BattleAnimSettings
  sheets: Map<number, BattleUnitSheetSet | null>
  dieFallbackEffects: Map<string, DieFallbackEffectSheet | null>
  setStackVisuals: Dispatch<SetStateAction<Record<string, StackBattleVisual>>>
  isCancelled?: () => boolean
}): Promise<void> {
  const ids = opts.tombs.map((t) => t.id)
  await runTargetReactionAnims({
    beforeStacks: [],
    afterStacks: [],
    tombstones: opts.tombs,
    targetIds: ids,
    catalog: opts.catalog,
    settings: opts.settings,
    sheets: opts.sheets,
    dieFallbackEffects: opts.dieFallbackEffects,
    setStackVisuals: opts.setStackVisuals,
    isCancelled: opts.isCancelled,
  })
}

export function anyTargetReactionAnimNeeded(
  targetIds: string[],
  beforeStacks: CombatStack[],
  afterStacks: CombatStack[],
  tombstones: CombatTombstone[],
  sheets: Map<number, BattleUnitSheetSet | null>,
  catalog?: ReferenceCatalog,
): boolean {
  for (const id of targetIds) {
    const living = afterStacks.find((row) => row.id === id)
    const before = beforeStacks.find((row) => row.id === id)
    const tomb = tombstones.find((row) => row.id === id)
    const unitId = living?.unitId ?? tomb?.unitId ?? before?.unitId
    if (unitId == null) {
      continue
    }
    let set = sheets.get(unitId) ?? null
    if (!set && catalog) {
      const unit = unitById(catalog, unitId)
      set = unit ? battleUnitSheetForUnit(catalog, unit) : null
    }
    const wiped = Boolean(tomb) || (before != null && (living == null || living.qty <= 0))
    if (!set && catalog && wiped) {
      if (dieFallbackEffectNames(catalog).length > 0) {
        return true
      }
      continue
    }
    if (!set) {
      continue
    }
    const strikeKill = wiped && before != null
    const unit = catalog ? unitById(catalog, unitId) : null
    if (strikeKill) {
      if (
        battleUnitHasHitSheet(set) ||
        (unit && set.animated && battleHitSettings(catalog).enabled)
      ) {
        return true
      }
    }
    if (wiped && battleUnitHasOwnDrawableDieSheet(set)) {
      return true
    }
    if (wiped && catalog && dieFallbackEffectNames(catalog).length > 0) {
      return true
    }
    if (!wiped && (battleUnitHasHitSheet(set) || battleHitSettings(catalog).enabled)) {
      return true
    }
  }
  return false
}

export { runTargetReactionAnims, runBattleWipedDeathAnim }
