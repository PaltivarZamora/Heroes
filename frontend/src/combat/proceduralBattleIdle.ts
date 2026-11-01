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

/** CSS transform fragment (before flip); origin is the sprite foot anchor. */
export function proceduralIdleTransformCss(
  nowMs: number,
  motion: ProceduralIdleMotion,
  moveKind: MoveKind,
  hexPx: number,
  settings: BattleIdleSettings,
): string | undefined {
  if (!settings.enabled) {
    return undefined
  }
  const wave = idleWave(nowMs, motion)
  if (moveKind === 'flying') {
    const bobPx = hexPx * (settings.bobPct / 100)
    const up = bobPx * (0.5 - 0.5 * wave)
    return `translateY(${-up}px)`
  }
  if (moveKind === 'hover') {
    const driftPx = hexPx * (settings.driftPct / 100)
    return `translateX(${driftPx * wave}px)`
  }
  const breath = settings.breathPct / 100
  const scaleY = 1 + breath * wave
  return `scaleY(${scaleY})`
}
