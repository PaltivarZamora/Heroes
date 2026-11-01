import type { BattleIdleSettings } from './battleAnimConfig'
import type { MoveKind } from './movement'
import type { BattleUnitAnimKind, BattleUnitAnimSheet, BattleUnitFrame, BattleUnitSheetSet } from './battleUnitSheet'
import type { UnitRow } from '../town/catalog'

const STAND_KINDS: BattleUnitAnimKind[] = ['Move', 'Attack', 'Hit', 'Die', 'Idle']

export type ProceduralIdleMotion = {
  phaseRad: number
  periodSec: number
}

export function battleUnitHasIdleSheet(set: BattleUnitSheetSet | null | undefined): boolean {
  return Boolean(set?.sheets.Idle)
}

/** Stand (or first loop frame) when there is no Idle sheet — same art as procedural idle base. */
export function battleProceduralIdleStand(
  set: BattleUnitSheetSet,
): { frame: BattleUnitFrame; sheet: BattleUnitAnimSheet; sheetKind: BattleUnitAnimKind } | null {
  for (const kind of STAND_KINDS) {
    const sheet = set.sheets[kind]
    if (!sheet) {
      continue
    }
    if (sheet.stand) {
      return { frame: sheet.stand, sheet, sheetKind: kind }
    }
    if (sheet.frames.length > 0) {
      return { frame: sheet.frames[0]!, sheet, sheetKind: kind }
    }
  }
  return null
}

function hashStackId(stackId: string): number {
  let h = 2166136261
  for (let i = 0; i < stackId.length; i += 1) {
    h ^= stackId.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function proceduralIdleMotionForStack(
  stackId: string,
  basePeriodSec: number,
): ProceduralIdleMotion {
  const h = hashStackId(stackId)
  const phaseRad = ((h & 0xffff) / 0xffff) * Math.PI * 2
  const jitter = 0.75 + ((h >>> 16) & 0xffff) / 0xffff * 0.5
  return { phaseRad, periodSec: basePeriodSec * jitter }
}

export function proceduralIdleEligible(
  set: BattleUnitSheetSet | null | undefined,
  unit: UnitRow | null | undefined,
  idleSettings: BattleIdleSettings,
): boolean {
  if (!idleSettings.enabled || !set?.animated) {
    return false
  }
  if (unit?.stationary === true) {
    return false
  }
  return !battleUnitHasIdleSheet(set)
}

export function idleWave(nowMs: number, motion: ProceduralIdleMotion): number {
  const tSec = nowMs / 1000
  return Math.sin((tSec * (Math.PI * 2)) / motion.periodSec + motion.phaseRad)
}

export type ProceduralIdleMotionAdjust = {
  scaleYMult: number
  offsetX: number
  offsetY: number
  /** Local Y offset so scaleY(breath) keeps the foot planted when anchor is not at the foot. */
  spriteOffsetY: number
}

/**
 * Compensate vertical scale about `anchorY` (0=top, 1=bottom) so the foot (y=1) stays fixed.
 * `displayHeight` is the rendered height at breath multiplier 1.
 */
export function proceduralIdleBreathFootPlantSpriteOffsetY(
  scaleYMult: number,
  displayHeight: number,
  anchorY: number,
): number {
  if (Math.abs(scaleYMult - 1) < 0.0001 || displayHeight <= 0) {
    return 0
  }
  return -(1 - anchorY) * displayHeight * (scaleYMult - 1)
}

/** Shared breath / bob / drift from battle_idle_* config. */
export function proceduralIdleMotionAdjust(
  nowMs: number,
  motion: ProceduralIdleMotion,
  moveKind: MoveKind,
  hexPx: number,
  settings: BattleIdleSettings,
  footPlant?: { displayHeight: number; anchorY: number },
): ProceduralIdleMotionAdjust | null {
  if (!settings.enabled) {
    return null
  }
  const wave = idleWave(nowMs, motion)
  if (moveKind === 'flying') {
    const bobPx = hexPx * (settings.bobPct / 100)
    const up = bobPx * (0.5 - 0.5 * wave)
    return { scaleYMult: 1, offsetX: 0, offsetY: -up, spriteOffsetY: 0 }
  }
  if (moveKind === 'hover') {
    const driftPx = hexPx * (settings.driftPct / 100)
    return {
      scaleYMult: 1,
      offsetX: driftPx * wave,
      offsetY: 0,
      spriteOffsetY: 0,
    }
  }
  const breath = settings.breathPct / 100
  const scaleYMult = 1 + breath * wave
  const spriteOffsetY =
    footPlant != null
      ? proceduralIdleBreathFootPlantSpriteOffsetY(
          scaleYMult,
          footPlant.displayHeight,
          footPlant.anchorY,
        )
      : 0
  return { scaleYMult, offsetX: 0, offsetY: 0, spriteOffsetY }
}

/** CSS transform fragment (before flip); origin is the sprite foot anchor. */
export function proceduralIdleTransformCss(
  nowMs: number,
  motion: ProceduralIdleMotion,
  moveKind: MoveKind,
  hexPx: number,
  settings: BattleIdleSettings,
): string | undefined {
  const adj = proceduralIdleMotionAdjust(
    nowMs,
    motion,
    moveKind,
    hexPx,
    settings,
  )
  if (!adj) {
    return undefined
  }
  if (adj.offsetY !== 0) {
    return `translateY(${adj.offsetY}px)`
  }
  if (adj.offsetX !== 0) {
    return `translateX(${adj.offsetX}px)`
  }
  if (adj.scaleYMult !== 1) {
    // transform-origin is the sprite foot anchor (see CombatBattleUnitArt).
    return `scaleY(${adj.scaleYMult})`
  }
  return undefined
}
