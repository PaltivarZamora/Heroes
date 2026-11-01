import type { BattleHitSettings } from './battleAnimConfig'
import type {
  BattleHitDirection,
  BattleHitReactionRow,
  BattleHitTiltPivot,
} from '../town/catalog'
import type { BattleUnitAnimKind, BattleUnitSheetSet } from './battleUnitSheet'
import { battleProceduralIdleStand } from './proceduralBattleIdle'
import type { UnitRow } from '../town/catalog'

export type ProceduralHitMotion = {
  direction: BattleHitDirection
  awaySignX: 1 | -1
  stationaryShake: boolean
  knockbackPx: number
  /** Squash amount as scale delta (scaleY = 1 − squashFactor × env). */
  squashFactor: number
  liftPx: number
  tiltDeg: number
  tiltPivot: BattleHitTiltPivot
}

export function battleUnitHasHitSheet(set: BattleUnitSheetSet | null | undefined): boolean {
  const hit = set?.sheets.Hit
  if (!hit) {
    return false
  }
  return hit.frames.length > 0 || hit.stand != null
}

function randomBetween(min: number, max: number): number {
  if (max <= min) {
    return min
  }
  return min + Math.random() * (max - min)
}

/** Screen-space hit line: above / below / level (±30° from horizontal). */
export function hitReactionDirection(
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
): BattleHitDirection {
  const dx = Math.abs(targetX - originX)
  const dy = targetY - originY
  const horiz = Math.max(dx, 1e-6)
  const angleDeg = Math.abs((Math.atan2(dy, horiz) * 180) / Math.PI)
  if (angleDeg <= 30) {
    return 'level'
  }
  // Screen y increases downward: origin above target → smaller originY → dy > 0.
  return dy > 0 ? 'above' : 'below'
}

function reactionRowForDirection(
  settings: BattleHitSettings,
  direction: BattleHitDirection,
): BattleHitReactionRow | null {
  return (
    settings.byDirection.get(direction) ??
    settings.byDirection.get('level') ??
    null
  )
}

export function rollProceduralHitMotion(
  settings: BattleHitSettings,
  unit: UnitRow,
  hexPx: number,
  originFoot: { x: number; y: number },
  targetFoot: { x: number; y: number },
): ProceduralHitMotion | null {
  if (!settings.enabled) {
    return null
  }
  const awaySignX: 1 | -1 = targetFoot.x >= originFoot.x ? 1 : -1
  const direction = hitReactionDirection(
    originFoot.x,
    originFoot.y,
    targetFoot.x,
    targetFoot.y,
  )
  const row = reactionRowForDirection(settings, direction)
  if (!row) {
    return null
  }
  if (unit.stationary === true) {
    return {
      direction,
      awaySignX,
      stationaryShake: true,
      knockbackPx: 0,
      squashFactor: 0,
      liftPx: 0,
      tiltDeg: 0,
      tiltPivot: 'feet',
    }
  }
  const knockbackPct = randomBetween(row.knockback_min, row.knockback_max)
  const squashPct = randomBetween(row.squash_min, row.squash_max)
  const liftPct = randomBetween(row.lift_min, row.lift_max)
  const tiltRoll = randomBetween(row.tilt_min, row.tilt_max)
  return {
    direction,
    awaySignX,
    stationaryShake: false,
    knockbackPx: hexPx * (knockbackPct / 100),
    squashFactor: squashPct / 100,
    liftPx: hexPx * (liftPct / 100),
    tiltDeg: tiltRoll,
    tiltPivot: row.tilt_pivot,
  }
}

function easeOutCubic(t: number): number {
  const u = Math.min(1, Math.max(0, t))
  return 1 - (1 - u) ** 3
}

function easeInOutCubic(t: number): number {
  const u = Math.min(1, Math.max(0, t))
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2
}

/** 0 at rest → 1 at peak impact → 0 at end; peak at ~25% of hit duration. */
export function proceduralHitEnvelope(progress: number): number {
  const t = Math.min(1, Math.max(0, progress))
  const outEnd = 0.25
  if (t <= outEnd) {
    return easeOutCubic(t / outEnd)
  }
  return 1 - easeInOutCubic((t - outEnd) / (1 - outEnd))
}

export function proceduralHitTransformCss(
  startedMs: number,
  hitSec: number,
  nowMs: number,
  motion: ProceduralHitMotion,
  hexPx: number,
): string | undefined {
  const durationMs = hitSec * 1000
  const progress =
    durationMs <= 0 ? 1 : Math.min(1, Math.max(0, (nowMs - startedMs) / durationMs))
  if (motion.stationaryShake) {
    const amp = hexPx * 0.012
    const wobble = Math.sin(progress * Math.PI * 2 * 5) * (1 - progress * 0.35)
    return `translateX(${amp * wobble}px)`
  }
  const env = proceduralHitEnvelope(progress)
  const tx = motion.awaySignX * motion.knockbackPx * env
  const ty = -motion.liftPx * env
  const scaleY = 1 - motion.squashFactor * env
  // +tiltDeg = lean back; screen-space tip away from attacker (±X from awaySignX).
  const screenTilt = -motion.tiltDeg * motion.awaySignX
  const rot = screenTilt * env
  const parts: string[] = []
  if (Math.abs(tx) > 0.01) {
    parts.push(`translateX(${tx}px)`)
  }
  if (Math.abs(ty) > 0.01) {
    parts.push(`translateY(${ty}px)`)
  }
  if (Math.abs(scaleY - 1) > 0.0001) {
    parts.push(`scaleY(${scaleY})`)
  }
  if (Math.abs(rot) > 0.01) {
    parts.push(`rotate(${rot}deg)`)
  }
  return parts.length > 0 ? parts.join(' ') : undefined
}

export function proceduralHitTransformOrigin(
  motion: ProceduralHitMotion,
  anchorX: number,
  anchorY: number,
): string {
  if (motion.stationaryShake || motion.tiltPivot === 'feet') {
    return `${anchorX * 100}% ${anchorY * 100}%`
  }
  return '50% 50%'
}

export function formatProceduralHitDevLog(
  unitName: string,
  motion: ProceduralHitMotion,
  facingFlipX: boolean,
): string {
  const fromSide = motion.awaySignX === 1 ? 'left' : 'right'
  const facing = facingFlipX ? 'left' : 'right'
  const knockback = Math.round(motion.knockbackPx * 10) / 10
  const squash = Math.round(motion.squashFactor * 1000) / 10
  const lift = Math.round(motion.liftPx * 10) / 10
  const tilt = Math.round(motion.tiltDeg * 10) / 10
  return `${unitName} Hit ${motion.direction} from ${fromSide}: knockback ${knockback}, squash ${squash}, lift ${lift}, tilt ${tilt} (facing ${facing})`
}

export function pickProceduralHitFrame(
  set: BattleUnitSheetSet,
): { frame: import('./battleUnitSheet').BattleUnitFrame; sheetKind: BattleUnitAnimKind } | null {
  return battleProceduralIdleStand(set)
}
