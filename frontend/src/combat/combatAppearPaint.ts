import type { CSSProperties } from 'react'
import type { BattleAnimSettings } from './battleAnimConfig'
import { battleUnitSheetFps } from './battleAnimConfig'
import type { UnitRow } from '../town/catalog'
import { unitSpriteScalePct } from '../town/catalog'
import type { CombatSide } from './battle'
import type { FootprintCode } from './footprint'
import type { BattleUnitFrame, BattleUnitSheetSet } from './battleUnitSheet'
import { battleUnitStandScaleReference } from './battleUnitSheet'
import type { ScheduledMidBattleAppear } from './battleAppear'
import { appearMotionProgress } from './battleAppear'
import {
  combatBattleUnitSpriteScale,
  combatBattleUnitTargetRestHeight,
  stackArtBox,
} from './combatStackArtBox'

export type AppearPaintTransform = {
  offsetY: number
  appearSheetFrame: BattleUnitFrame | null
}

/** Shared rise foot-line mask: battlefield coords, both sheet and static paths. */
export function appearRiseFootClipStyle(restFootY: number): CSSProperties {
  const y = Math.max(0, restFootY)
  return {
    position: 'absolute',
    left: 0,
    top: 0,
    width: '100%',
    height: y,
    overflow: 'hidden',
    pointerEvents: 'none',
  }
}

/** Rain only: fall from above the battlefield (not per-hex). */
export function appearRainFallDistancePx(
  fieldHeightPx: number,
  hexPx: number,
): number {
  const fromTop = fieldHeightPx * 0.45
  const fromHex = hexPx * 4
  return Math.max(fromTop, fromHex)
}

/**
 * Drawn body height at the stack foot (same scale as battle Stand / static stack art).
 * Used for rise — one body below the foot line, not screen-relative distance.
 */
export function appearRiseBodyHeightPx(
  hexPx: number,
  footprint: FootprintCode,
  side: CombatSide,
  set: BattleUnitSheetSet | null | undefined,
  settings: BattleAnimSettings,
  unit: UnitRow | null | undefined,
): number {
  const drawPct = unit ? unitSpriteScalePct(unit) : 100
  const ref = set ? battleUnitStandScaleReference(set) : null
  if (ref) {
    const scale = combatBattleUnitSpriteScale(
      hexPx,
      footprint,
      side,
      ref.restHeight,
      ref.frameWidth,
      settings,
      drawPct,
    )
    return ref.restHeight * scale
  }
  const box = stackArtBox({ x: 0, y: hexPx }, hexPx, footprint, side)
  const targetRest = combatBattleUnitTargetRestHeight(
    box.height,
    hexPx,
    settings.spriteScalePct,
  )
  return targetRest * (drawPct / 100)
}

export function resolveAppearPaintTransform(
  row: ScheduledMidBattleAppear,
  scheduled: ScheduledMidBattleAppear[],
  paintNowMs: number,
  hexPx: number,
  fieldHeightPx: number,
  riseBodyHeightPx: number,
  set: BattleUnitSheetSet | null | undefined,
  settings: BattleAnimSettings,
): AppearPaintTransform | null {
  const progress = appearMotionProgress(row.stackId, paintNowMs, scheduled)
  if (progress >= 1) {
    return null
  }
  if (row.kind === 'sheet' && set?.appearSheet) {
    const sheet = set.appearSheet
    const started = row.startMs
    const elapsed = Math.max(0, paintNowMs - started)
    const fps = battleUnitSheetFps(settings, 'Appear')
    const frameMs = 1000 / Math.max(1, fps)
    const idx = Math.min(
      sheet.frames.length - 1,
      Math.floor(elapsed / frameMs),
    )
    const frame = sheet.frames[idx] ?? sheet.frames[0] ?? null
    return {
      offsetY: 0,
      appearSheetFrame: frame,
    }
  }
  if (row.kind === 'rise') {
    const body = Math.max(1, riseBodyHeightPx)
    return {
      offsetY: (1 - progress) * body,
      appearSheetFrame: null,
    }
  }
  if (row.kind === 'rain') {
    const fall = appearRainFallDistancePx(fieldHeightPx, hexPx)
    return {
      offsetY: -(1 - progress) * fall,
      appearSheetFrame: null,
    }
  }
  return null
}