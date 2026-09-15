import type { Axial } from './hero'

/** Generic multi-leg movement plan (battle + world map). */
export type WaypointPlan = {
  origin: Axial
  /** Player-chosen intermediate (and possibly final) hexes in order. */
  waypoints: Axial[]
  /** Walk steps from origin through all waypoints (origin excluded). */
  steps: Axial[]
  /** Current end of the planned path (stands here before the next leg). */
  end: Axial
  /** Movement budget left after completing all planned steps. */
  remaining: number
  /** Remaining budget after each waypoint (same length as `waypoints`). */
  remainingAfterWaypoints: number[]
}

export type WaypointLegResult = {
  /** Steps from leg start to destination (must end on the destination). */
  steps: Axial[]
  /** Budget left after these steps. */
  remaining: number
}

export type ResolveWaypointLeg = (
  from: Axial,
  to: Axial,
  budget: number,
) => WaypointLegResult | null

export function createWaypointPlan(
  origin: Axial,
  budget: number,
): WaypointPlan {
  return {
    origin: { q: origin.q, r: origin.r },
    waypoints: [],
    steps: [],
    end: { q: origin.q, r: origin.r },
    remaining: budget,
    remainingAfterWaypoints: [],
  }
}

function sameHex(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r
}

/**
 * Append a waypoint if a full-budget leg can reach it exactly.
 * Returns null when the hex is unreachable / unaffordable / duplicate.
 */
export function tryAppendWaypoint(
  plan: WaypointPlan,
  next: Axial,
  resolveLeg: ResolveWaypointLeg,
): WaypointPlan | null {
  if (sameHex(plan.end, next)) {
    return null
  }
  if (plan.remaining <= 1e-9) {
    return null
  }
  const leg = resolveLeg(plan.end, next, plan.remaining)
  if (!leg || leg.steps.length === 0) {
    return null
  }
  const last = leg.steps[leg.steps.length - 1]
  if (!last || !sameHex(last, next)) {
    return null
  }
  return {
    origin: plan.origin,
    waypoints: [...plan.waypoints, { q: next.q, r: next.r }],
    steps: [...plan.steps, ...leg.steps],
    end: { q: next.q, r: next.r },
    remaining: leg.remaining,
    remainingAfterWaypoints: [...plan.remainingAfterWaypoints, leg.remaining],
  }
}

/** Hex keys for preview drawing (planned walk steps). */
export function waypointStepKeys(plan: WaypointPlan | null | undefined): string[] {
  if (!plan) {
    return []
  }
  return plan.steps.map((hex) => `${hex.q},${hex.r}`)
}
