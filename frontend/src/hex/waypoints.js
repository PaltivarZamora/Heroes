export function createWaypointPlan(origin, budget) {
    return {
        origin: { q: origin.q, r: origin.r },
        waypoints: [],
        steps: [],
        end: { q: origin.q, r: origin.r },
        remaining: budget,
        remainingAfterWaypoints: [],
    };
}
function sameHex(a, b) {
    return a.q === b.q && a.r === b.r;
}
/**
 * Append a waypoint if a full-budget leg can reach it exactly.
 * Returns null when the hex is unreachable / unaffordable / duplicate.
 */
export function tryAppendWaypoint(plan, next, resolveLeg) {
    if (sameHex(plan.end, next)) {
        return null;
    }
    if (plan.remaining <= 1e-9) {
        return null;
    }
    const leg = resolveLeg(plan.end, next, plan.remaining);
    if (!leg || leg.steps.length === 0) {
        return null;
    }
    const last = leg.steps[leg.steps.length - 1];
    if (!last || !sameHex(last, next)) {
        return null;
    }
    return {
        origin: plan.origin,
        waypoints: [...plan.waypoints, { q: next.q, r: next.r }],
        steps: [...plan.steps, ...leg.steps],
        end: { q: next.q, r: next.r },
        remaining: leg.remaining,
        remainingAfterWaypoints: [...plan.remainingAfterWaypoints, leg.remaining],
    };
}
/** Hex keys for preview drawing (planned walk steps). */
export function waypointStepKeys(plan) {
    if (!plan) {
        return [];
    }
    return plan.steps.map((hex) => `${hex.q},${hex.r}`);
}
