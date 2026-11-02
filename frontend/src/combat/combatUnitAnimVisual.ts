import type { BattleAnimSettings, BattleIdleSettings } from './battleAnimConfig'
import type { FootprintCode } from './footprint'
import { stackArtBox, stackArtBoxFoot } from './combatStackArtBox'
import type { BattleUnitAnimKind, BattleUnitSheetSet } from './battleUnitSheet'
import { frameAtProgress } from './battleUnitSheet'
import type { ProceduralHitMotion } from './proceduralBattleHit'
import type { DieFallbackFxSchedule } from './battleDieFallbackEffect'
import { battleUnitHasHitSheet, pickProceduralHitFrame } from './proceduralBattleHit'
import {
  battleProceduralIdleStand,
  battleUnitHasIdleSheet,
  proceduralIdleEligible,
  proceduralIdleMotionForStack,
  type ProceduralIdleMotion,
} from './proceduralBattleIdle'
import type { CombatSide, CombatStack } from './battle'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import { unitById } from '../town/catalog'

export type StackBattleVisualKind = BattleUnitAnimKind | 'idle'

export type StackBattleVisual = {
  kind: StackBattleVisualKind
  startedMs: number
  /** When set, overrides default side-based horizontal flip (Attack faces target). */
  flipX?: boolean
  /** Looping anims (idle/move) start on a random frame index. */
  frameOffset: number
  /** Slide between hex anchors (move). */
  slide?: {
    startedMs: number
    /** Whole-path slide: foot at each hex centre in order. */
    pathFeet?: Array<{ x: number; y: number }>
    secPerHex?: number
    /** Single-segment slide (one hex). */
    fromX?: number
    fromY?: number
    toX?: number
    toY?: number
    durationMs?: number
  }
  /** Hold last die frame instead of tombstone art. */
  dieHoldFrame?: boolean
  /** Override grid position (attack wind-up stand). */
  footOverride?: { x: number; y: number }
  /** Procedural idle when no Idle sheet (phase/period fixed for this stack). */
  proceduralIdle?: ProceduralIdleMotion
  /** Procedural Hit when no Hit sheet (rolled per hit). */
  proceduralHit?: ProceduralHitMotion
  /** Shared die FX when the unit has no Die sheet. */
  dieFallbackFx?: DieFallbackFxSchedule
  /** Static _Dead.png corpse after die fallback (or tomb without Die sheet). */
  corpseBody?: boolean
}

export type CombatProjectileVisual = {
  id: string
  fromX: number
  fromY: number
  toX: number
  toY: number
  startedMs: number
  durationMs: number
  /** Render height in px from scale_pct × hex height. */
  displayHeightPx: number
  flipY: boolean
  /** null = drawn streak fallback */
  staticUrl: string | null
  sheetFrames: import('./battleUnitSheet').BattleUnitFrame[] | null
  sheetLoop: boolean
  animFps: number
}

export type CombatShapeVisual = {
  id: string
  x: number
  y: number
  startedMs: number
  durationMs: number
  displayWidthPx: number
  displayHeightPx: number
  angleDeg: number
  flipY: boolean
  rotate: boolean
  frames: import('./battleUnitSheet').BattleUnitFrame[]
  animFps: number
}

export type CombatImpactVisual = {
  id: string
  x: number
  y: number
  startedMs: number
  durationMs: number
  displayHeightPx: number
  frames: import('./battleUnitSheet').BattleUnitFrame[]
  animFps: number
}

export function randomIdleFrameOffset(frameCount: number): number {
  if (frameCount <= 1) {
    return 0
  }
  return Math.floor(Math.random() * frameCount)
}

export function defaultStackVisual(
  frameCount: number,
  proceduralIdle?: ProceduralIdleMotion,
): StackBattleVisual {
  return {
    kind: 'idle',
    startedMs: performance.now(),
    frameOffset: randomIdleFrameOffset(frameCount),
    proceduralIdle,
  }
}

export function attachProceduralIdleToVisual(
  visual: StackBattleVisual,
  stackId: string,
  set: BattleUnitSheetSet | null | undefined,
  unit: UnitRow | null | undefined,
  idleSettings: BattleIdleSettings,
): StackBattleVisual {
  if (!proceduralIdleEligible(set, unit, idleSettings)) {
    const { proceduralIdle: _drop, ...rest } = visual
    return rest
  }
  return {
    ...visual,
    proceduralIdle: proceduralIdleMotionForStack(stackId, idleSettings.periodSec),
  }
}

export function defaultIdleVisualForStack(
  stack: CombatStack,
  set: BattleUnitSheetSet | null | undefined,
  unit: UnitRow | null | undefined,
  idleSettings: BattleIdleSettings,
): StackBattleVisual {
  const frameCount = set?.sheets.Idle?.frames.length ?? 1
  return attachProceduralIdleToVisual(
    defaultStackVisual(frameCount),
    stack.id,
    set,
    unit,
    idleSettings,
  )
}

export function restoreIdleStackVisual(
  stackId: string,
  idleFrameCount: number,
  prev: Record<string, StackBattleVisual>,
): StackBattleVisual {
  return defaultStackVisual(idleFrameCount, prev[stackId]?.proceduralIdle)
}

/** Seed Idle without clobbering Move / Attack / Hit / Die in progress. */
export function mergeIdleSeedVisuals(
  prev: Record<string, StackBattleVisual>,
  seeds: Record<string, StackBattleVisual>,
): Record<string, StackBattleVisual> {
  const next = { ...prev }
  for (const [id, vis] of Object.entries(seeds)) {
    const cur = next[id]
    if (!cur || cur.kind === 'idle') {
      next[id] = vis
    }
  }
  return next
}

export function idleVisualsForLivingStacks(
  stacks: CombatStack[],
  sheets: Map<number, BattleUnitSheetSet | null>,
  usesAnim: (stack: CombatStack) => boolean,
  catalog: ReferenceCatalog,
  idleSettings: BattleIdleSettings,
): Record<string, StackBattleVisual> {
  const out: Record<string, StackBattleVisual> = {}
  for (const stack of stacks) {
    if (stack.qty <= 0 || !usesAnim(stack)) {
      continue
    }
    const set = sheets.get(stack.unitId)
    const unit = unitById(catalog, stack.unitId)
    out[stack.id] = defaultIdleVisualForStack(stack, set, unit, idleSettings)
  }
  return out
}

export function progressForTimedAnim(
  startedMs: number,
  durationMs: number,
  now = performance.now(),
): number {
  if (durationMs <= 0) {
    return 1
  }
  return Math.min(1, Math.max(0, (now - startedMs) / durationMs))
}

export function slideFootPosition(
  slide: NonNullable<StackBattleVisual['slide']>,
  now = performance.now(),
): { x: number; y: number } {
  const pathFeet = slide.pathFeet
  if (pathFeet && pathFeet.length >= 2 && slide.secPerHex != null) {
    const perMs = slide.secPerHex * 1000
    const elapsed = now - slide.startedMs
    if (elapsed <= 0) {
      return pathFeet[0]!
    }
    const last = pathFeet.length - 1
    const seg = Math.floor(elapsed / perMs)
    if (seg >= last) {
      return pathFeet[last]!
    }
    const t = (elapsed - seg * perMs) / perMs
    const a = pathFeet[seg]!
    const b = pathFeet[seg + 1]!
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    }
  }
  const fromX = slide.fromX ?? 0
  const fromY = slide.fromY ?? 0
  const toX = slide.toX ?? fromX
  const toY = slide.toY ?? fromY
  const durationMs = slide.durationMs ?? 0
  const t = progressForTimedAnim(slide.startedMs, durationMs, now)
  return {
    x: fromX + (toX - fromX) * t,
    y: fromY + (toY - fromY) * t,
  }
}

/** Horizontal flip while sliding: face direction of current path segment. */
export function travelFlipXForSlide(
  slide: NonNullable<StackBattleVisual['slide']>,
  now = performance.now(),
): boolean {
  const pathFeet = slide.pathFeet
  if (pathFeet && pathFeet.length >= 2 && slide.secPerHex != null) {
    const perMs = slide.secPerHex * 1000
    const elapsed = Math.max(0, now - slide.startedMs)
    const seg = Math.min(
      pathFeet.length - 2,
      Math.floor(elapsed / perMs),
    )
    const a = pathFeet[seg]!
    const b = pathFeet[seg + 1]!
    return b.x < a.x
  }
  const fromX = slide.fromX ?? 0
  const toX = slide.toX ?? fromX
  return toX < fromX
}

/** Foot anchor for battle unit art / stack chrome (hex anchor + slide override). */
export function combatUnitDrawFootPosition(
  hexAnchor: { x: number; y: number },
  hexPx: number,
  footOffsetPct: number,
  footprint: FootprintCode,
  side: CombatSide,
  visual: StackBattleVisual | undefined,
  now = performance.now(),
): { footX: number; footY: number } {
  const box = stackArtBox(hexAnchor, hexPx, footprint, side)
  let { footX, footY } = stackArtBoxFoot(box, hexPx, footOffsetPct)
  if (visual?.footOverride) {
    footX = visual.footOverride.x
    footY = visual.footOverride.y
  }
  if (visual?.slide) {
    const pos = slideFootPosition(visual.slide, now)
    footX = pos.x
    footY = pos.y
  }
  return { footX, footY }
}

export function isDieCorpseVisual(
  visual: StackBattleVisual | undefined,
): boolean {
  return Boolean(visual && (visual.kind === 'Die' || visual.dieHoldFrame))
}

export function pickVisualFrame(
  set: BattleUnitSheetSet,
  visual: StackBattleVisual,
  settings: BattleAnimSettings,
  now = performance.now(),
): { frame: ReturnType<typeof frameAtProgress>; sheetKind: BattleUnitAnimKind } | null {
  const kind: BattleUnitAnimKind =
    visual.kind === 'idle' ? 'Idle' : (visual.kind as BattleUnitAnimKind)
  if (visual.kind === 'idle' && !visual.slide && !battleUnitHasIdleSheet(set)) {
    const stand = battleProceduralIdleStand(set)
    if (!stand) {
      return null
    }
    return { frame: stand.frame, sheetKind: stand.sheetKind }
  }
  if (visual.kind === 'Hit' && !battleUnitHasHitSheet(set)) {
    if (!visual.proceduralHit) {
      return null
    }
    return pickProceduralHitFrame(set)
  }
  const sheet = set.sheets[kind] ?? set.sheets.Idle
  if (!sheet) {
    return null
  }
  if (visual.slide && (kind === 'Move' || visual.kind === 'Move')) {
    const moveSheet = set.sheets.Move ?? sheet
    const frame = frameAtProgress(
      moveSheet,
      0,
      settings.animFps,
      visual.startedMs,
      visual.frameOffset,
    )
    return { frame, sheetKind: 'Move' }
  }
  if (visual.slide && visual.kind === 'idle') {
    const idleSheet = set.sheets.Idle ?? sheet
    const frame = frameAtProgress(
      idleSheet,
      0,
      settings.animFps,
      visual.startedMs,
      visual.frameOffset,
    )
    return { frame, sheetKind: 'Idle' }
  }
  let progress = 0
  let durationMs = 1000
  if (kind === 'Move') {
    durationMs = settings.moveSecPerHex * 1000
    if (visual.slide?.durationMs != null) {
      progress = progressForTimedAnim(
        visual.slide.startedMs,
        visual.slide.durationMs,
        now,
      )
    } else if (visual.slide?.secPerHex != null) {
      progress = 0
    }
  } else if (kind === 'Attack') {
    durationMs = settings.attackSec * 1000
    progress = progressForTimedAnim(visual.startedMs, durationMs, now)
  } else if (kind === 'Hit') {
    durationMs = settings.hitSec * 1000
    progress = progressForTimedAnim(visual.startedMs, durationMs, now)
  } else if (kind === 'Die') {
    durationMs = settings.dieSec * 1000
    progress = progressForTimedAnim(visual.startedMs, durationMs, now)
    if (visual.dieHoldFrame && progress >= 1) {
      progress = 1
    }
  }
  let frame = frameAtProgress(
    sheet,
    progress,
    settings.animFps,
    visual.startedMs,
    visual.frameOffset,
  )
  if (kind === 'Die' && visual.dieHoldFrame && !sheet.loop && progress >= 1) {
    const loopFrames = sheet.frames
    if (loopFrames.length > 0) {
      frame = loopFrames[loopFrames.length - 1]!
    } else if (sheet.stand) {
      frame = sheet.stand
    }
  }
  return { frame, sheetKind: kind }
}

export function sleepMs(ms: number, isCancelled?: () => boolean): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const start = performance.now()
    const tick = () => {
      if (isCancelled?.()) {
        resolve()
        return
      }
      if (performance.now() - start >= ms) {
        resolve()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

export function hexDistancePx(
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  return Math.hypot(bx - ax, by - ay)
}

export function projectileDurationMs(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  hexPx: number,
  hexPerSec: number,
): number {
  const distHex = hexDistancePx(fromX, fromY, toX, toY) / Math.max(1, hexPx)
  return (distHex / Math.max(0.01, hexPerSec)) * 1000
}

export function flipBattleUnit(side: CombatSide): boolean {
  return side === 'def'
}
