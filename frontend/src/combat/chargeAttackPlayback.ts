import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import { unitById } from '../town/catalog'
import { basicPartnerForAdvanced } from '../town/unitUpgrade'
import { logConfigOnce } from '../session/configLog'

export type ChargeLoopFrames = readonly [loopStart: number, loopEnd: number]

export type ChargeAttackPhase = 'windup' | 'loop' | 'recover'

export type ChargeAttackVisual = {
  loopStart: number
  loopEnd: number
  phase: ChargeAttackPhase
  phaseStartedMs: number
}

/** Catalog value for this unit, else basic partner when Attack sheet is borrowed. */
export function unitChargeLoopFrames(
  catalog: ReferenceCatalog,
  unit: UnitRow | null | undefined,
): ChargeLoopFrames | null {
  if (!unit) {
    return null
  }
  if (unit.charge_loop_frames) {
    return unit.charge_loop_frames
  }
  const partner = basicPartnerForAdvanced(catalog, unit)
  return partner?.charge_loop_frames ?? null
}

export function chargeLoopFramesValid(
  loop: ChargeLoopFrames,
  attackFrameCount: number,
): boolean {
  if (attackFrameCount <= 0) {
    return false
  }
  const [loopStart, loopEnd] = loop
  if (loopStart < 0 || loopEnd < loopStart) {
    return false
  }
  if (loopEnd >= attackFrameCount) {
    return false
  }
  return true
}

const warnedChargeLoopUnits = new Set<number>()

export function warnChargeLoopFramesFallback(
  unitId: number,
  unitName: string,
  reason: string,
): void {
  if (warnedChargeLoopUnits.has(unitId)) {
    return
  }
  warnedChargeLoopUnits.add(unitId)
  logConfigOnce(
    `charge_loop_frames:${unitId}`,
    `[Dev] charge_loop_frames: unit ${unitId} (${unitName}) — ${reason}; using legacy charge Attack playback.`,
  )
}

export function chargePhaseDurationMs(
  phase: ChargeAttackPhase,
  loop: ChargeLoopFrames,
  attackFrameCount: number,
  moveFps: number,
): number {
  if (moveFps <= 0 || attackFrameCount <= 0) {
    return 0
  }
  const [loopStart, loopEnd] = loop
  const msPerFrame = 1000 / moveFps
  if (phase === 'windup') {
    return loopStart > 0 ? loopStart * msPerFrame : 0
  }
  if (phase === 'recover') {
    const recoverFrames = Math.max(0, attackFrameCount - 1 - loopEnd)
    return recoverFrames * msPerFrame
  }
  return 0
}

export function chargeSlideDurationMs(
  hexCount: number,
  secPerHex: number,
): number {
  if (hexCount <= 0 || secPerHex <= 0) {
    return 0
  }
  return hexCount * secPerHex * 1000
}

export function chargeBeatDurationMs(
  loop: ChargeLoopFrames,
  attackFrameCount: number,
  moveFps: number,
  slideHexCount: number,
  secPerHex: number,
): number {
  return (
    chargePhaseDurationMs('windup', loop, attackFrameCount, moveFps) +
    chargeSlideDurationMs(slideHexCount, secPerHex) +
    chargePhaseDurationMs('recover', loop, attackFrameCount, moveFps)
  )
}

export function chargeAttackFrameIndex(
  phase: ChargeAttackPhase,
  loop: ChargeLoopFrames,
  attackFrameCount: number,
  phaseStartedMs: number,
  moveFps: number,
  now = performance.now(),
): number {
  if (attackFrameCount <= 0) {
    return 0
  }
  const [loopStart, loopEnd] = loop
  const elapsedFrames = Math.max(
    0,
    Math.floor(((now - phaseStartedMs) / 1000) * moveFps),
  )
  if (phase === 'windup') {
    if (loopStart <= 0) {
      return 0
    }
    return Math.min(loopStart - 1, elapsedFrames)
  }
  if (phase === 'loop') {
    const span = loopEnd - loopStart + 1
    if (span <= 0) {
      return loopStart
    }
    return loopStart + (elapsedFrames % span)
  }
  const recoverStart = loopEnd + 1
  const last = attackFrameCount - 1
  if (recoverStart > last) {
    return last
  }
  return Math.min(last, recoverStart + elapsedFrames)
}

export function chargeUnitName(
  catalog: ReferenceCatalog,
  unitId: number,
): string {
  return unitById(catalog, unitId)?.name ?? `unit ${unitId}`
}