import { isPassable, isWalkable } from './world';
import { getCachedCatalog } from '../town/catalog';
import { hexTransitionMoveCost } from './terrainTransition';
import { mobPathRingKeys } from './mobAggro';
import { getSession } from '../session/store';
const AXIAL_NEIGHBORS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
];
/** Six axial step vectors (pointy-top). Lines along ±dir are the same axis. */
export function axialNeighborDirs() {
    return AXIAL_NEIGHBORS;
}
/** Catalog move_cost 99: enter by dumping remaining MP, not a literal 99 cost. */
const DUMP_REMAINING_MOVE_COST = 99;
/** Cheapest walkable terrain — admissible A* heuristic scale. */
const MIN_STEP_COST = 0.9;
function key(q, r) {
    return `${q},${r}`;
}
/** Terrain walkable, and not occupied by a map object this path. */
function isPathHexOpen(q, r, blocked, ignoreFog = false) {
    if (ignoreFog ? !isPassable(q, r) : !isWalkable(q, r)) {
        return false;
    }
    if (blocked?.has(key(q, r))) {
        return false;
    }
    // Base terrain may be impassable even if the assigned chunk tile isn't.
    if (hexTransitionMoveCost(getCachedCatalog(), q, r) == null) {
        return false;
    }
    return true;
}
/**
 * Enter cost for pathfinding — hex/`terrain` table move_cost (isolated helper).
 */
function terrainEnterCost(q, r) {
    return hexTransitionMoveCost(getCachedCatalog(), q, r);
}
export function hexDistance(from, to) {
    const dq = from.q - to.q;
    const dr = from.r - to.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
export function neighborHexes(at) {
    return AXIAL_NEIGHBORS.map((delta) => ({
        q: at.q + delta.q,
        r: at.r + delta.r,
    }));
}
function pathEnterCost(path) {
    let cost = 0;
    for (let i = 1; i < path.length; i++) {
        const step = terrainEnterCost(path[i].q, path[i].r);
        if (step == null) {
            return Infinity;
        }
        cost += step;
    }
    return cost;
}
/**
 * Cheapest walkable hex next to `target` (never `target` itself).
 * The mover's current hex is allowed even if it would otherwise look blocked.
 */
function withMobRings(blocked, dest, from) {
    const merged = new Set(blocked);
    const destKey = key(dest.q, dest.r);
    const startKey = key(from.q, from.r);
    for (const hexKey of mobPathRingKeys(getSession())) {
        if (hexKey === destKey || hexKey === startKey) {
            continue;
        }
        merged.add(hexKey);
    }
    return merged;
}
/**
 * Prefer a path that stays out of every mob's 1-hex ring. The destination
 * itself is allowed (attacking that mob, or a click inside the ring).
 * If the only route enters a ring, that path is returned and `risky` is set.
 */
export function findPathAvoidingMobRings(from, to, blocked, ignoreFog = false) {
    const safe = findPath(from, to, withMobRings(blocked, to, from), ignoreFog);
    if (safe) {
        return { path: safe, risky: false };
    }
    const path = findPath(from, to, blocked, ignoreFog);
    return path ? { path, risky: true } : null;
}
export function approachHex(from, target, blocked) {
    let best = null;
    let bestCost = Infinity;
    let bestDist = Infinity;
    let bestRisky = true;
    for (const next of neighborHexes(target)) {
        const here = next.q === from.q && next.r === from.r;
        if (!here && !isPathHexOpen(next.q, next.r, blocked)) {
            continue;
        }
        if (here) {
            return next;
        }
        const planned = findPathAvoidingMobRings(from, next, blocked);
        if (!planned) {
            continue;
        }
        const cost = pathEnterCost(planned.path);
        const dist = hexDistance(from, next);
        const better = (bestRisky && !planned.risky) ||
            (bestRisky === planned.risky &&
                (cost + 1e-9 < bestCost ||
                    (Math.abs(cost - bestCost) < 1e-9 && dist < bestDist)));
        if (better) {
            bestCost = cost;
            bestDist = dist;
            bestRisky = planned.risky;
            best = next;
        }
    }
    return best;
}
/**
 * Same A* as World `findPath`, with caller-supplied enter cost / walkability.
 * Path includes start and destination. Cost is paid on entering a hex.
 */
export function findPathOnBoard(from, to, enterCost, blocked, canEnter) {
    if (from.q === to.q && from.r === to.r) {
        return [from];
    }
    const allowed = (q, r) => {
        if (canEnter) {
            return canEnter(q, r);
        }
        if (blocked?.has(key(q, r))) {
            return false;
        }
        return enterCost(q, r) != null;
    };
    if (!allowed(to.q, to.r)) {
        return null;
    }
    const startKey = key(from.q, from.r);
    const goalKey = key(to.q, to.r);
    const cameFrom = new Map();
    const gScore = new Map([[startKey, 0]]);
    const fScore = new Map([
        [startKey, MIN_STEP_COST * hexDistance(from, to)],
    ]);
    const open = new Map([[startKey, from]]);
    while (open.size > 0) {
        let bestKey = '';
        let bestF = Infinity;
        let current;
        for (const [openKey, node] of open) {
            const f = fScore.get(openKey) ?? Infinity;
            if (f < bestF) {
                bestF = f;
                bestKey = openKey;
                current = node;
            }
        }
        if (!current) {
            break;
        }
        if (bestKey === goalKey) {
            return reconstruct(cameFrom, current);
        }
        open.delete(bestKey);
        for (const next of neighborHexes(current)) {
            if (!allowed(next.q, next.r)) {
                continue;
            }
            const cost = enterCost(next.q, next.r);
            if (cost == null) {
                continue;
            }
            const nextKey = key(next.q, next.r);
            const tentative = (gScore.get(bestKey) ?? Infinity) + cost;
            if (tentative + 1e-9 >= (gScore.get(nextKey) ?? Infinity)) {
                continue;
            }
            cameFrom.set(nextKey, current);
            gScore.set(nextKey, tentative);
            fScore.set(nextKey, tentative + MIN_STEP_COST * hexDistance(next, to));
            open.set(nextKey, next);
        }
    }
    return null;
}
/**
 * Lowest-cost path between two passable hexes. Returns null if none.
 * Path includes start and destination. Cost is paid on entering a hex.
 * `blocked` is other heroes, towns, resource nodes, and fountains for this
 * path only — not baked into terrain. Callers omit the destination when that
 * hex is a walk-onto target (town, mine, pickup, or fountain). Heroes are
 * never omitted.
 * Default stays in explored fog; pass `ignoreFog` only for rare
 * debug/admin tools — player movement never ignores fog.
 */
export function findPath(from, to, blocked, ignoreFog = false) {
    if (from.q === to.q && from.r === to.r) {
        return [from];
    }
    const open = (q, r) => isPathHexOpen(q, r, blocked, ignoreFog);
    if (!open(to.q, to.r)) {
        return null;
    }
    return findPathOnBoard(from, to, terrainEnterCost, blocked, (q, r) => (q === from.q && r === from.r) || open(q, r));
}
/**
 * Player hover/click: path toward the goal without entering Fog of War.
 * If the goal is unexplored/unreachable, approach as close as explored
 * passable terrain allows. AI still uses `findPath` (explored only).
 */
export function findPathToward(from, to, blocked) {
    const direct = findPath(from, to, blocked, false);
    if (direct) {
        return direct;
    }
    const startKey = key(from.q, from.r);
    const goalDist = hexDistance(from, to);
    if (goalDist <= 0) {
        return [from];
    }
    const cameFrom = new Map();
    const gScore = new Map([[startKey, 0]]);
    const posByKey = new Map([[startKey, from]]);
    const open = new Map([[startKey, from]]);
    while (open.size > 0) {
        let bestKey = '';
        let bestG = Infinity;
        let current;
        for (const [openKey, node] of open) {
            const g = gScore.get(openKey) ?? Infinity;
            if (g < bestG) {
                bestG = g;
                bestKey = openKey;
                current = node;
            }
        }
        if (!current) {
            break;
        }
        open.delete(bestKey);
        for (const next of neighborHexes(current)) {
            const nextKey = key(next.q, next.r);
            if (blocked?.has(nextKey) && nextKey !== startKey) {
                continue;
            }
            // Stay in explored fog — never path into or through unexplored hexes.
            if (!isPathHexOpen(next.q, next.r, blocked, false)) {
                continue;
            }
            const cost = terrainEnterCost(next.q, next.r);
            if (cost == null) {
                continue;
            }
            const tentative = bestG + cost;
            if (tentative + 1e-9 >= (gScore.get(nextKey) ?? Infinity)) {
                continue;
            }
            cameFrom.set(nextKey, current);
            gScore.set(nextKey, tentative);
            posByKey.set(nextKey, next);
            open.set(nextKey, next);
        }
    }
    let best = null;
    let bestDist = goalDist;
    let bestCost = Infinity;
    for (const [hexKey, pos] of posByKey) {
        if (hexKey === startKey) {
            continue;
        }
        const dist = hexDistance(pos, to);
        const cost = gScore.get(hexKey) ?? Infinity;
        if (dist + 1e-9 < bestDist || (Math.abs(dist - bestDist) < 1e-9 && cost < bestCost)) {
            bestDist = dist;
            bestCost = cost;
            best = pos;
        }
    }
    return best ? reconstruct(cameFrom, best) : null;
}
function reconstruct(cameFrom, end) {
    const path = [end];
    let cursor = end;
    let cursorKey = key(cursor.q, cursor.r);
    while (cameFrom.has(cursorKey)) {
        cursor = cameFrom.get(cursorKey);
        path.push(cursor);
        cursorKey = key(cursor.q, cursor.r);
    }
    path.reverse();
    return path;
}
/**
 * Every hex reachable within `budget`, paying `enterCost` on entry.
 * Start hex is omitted. Paths include the start. `blocked` hexes cannot
 * be entered (the origin is allowed even if listed). `stopOnly` hexes
 * can be entered as a destination but are not used as transit.
 */
export function reachableWithin(from, budget, enterCost, blocked, stopOnly) {
    const startKey = key(from.q, from.r);
    const cameFrom = new Map();
    const gScore = new Map([[startKey, 0]]);
    const posByKey = new Map([[startKey, from]]);
    const open = new Map([[startKey, from]]);
    while (open.size > 0) {
        let bestKey = '';
        let bestG = Infinity;
        let current;
        for (const [openKey, node] of open) {
            const g = gScore.get(openKey) ?? Infinity;
            if (g < bestG) {
                bestG = g;
                bestKey = openKey;
                current = node;
            }
        }
        if (!current) {
            break;
        }
        open.delete(bestKey);
        if (stopOnly?.has(bestKey) && bestKey !== startKey) {
            continue;
        }
        for (const next of neighborHexes(current)) {
            const nextKey = key(next.q, next.r);
            if (blocked?.has(nextKey) && nextKey !== startKey) {
                continue;
            }
            const cost = enterCost(next.q, next.r);
            if (cost == null) {
                continue;
            }
            const remaining = budget - bestG;
            const stepCost = cost === DUMP_REMAINING_MOVE_COST
                ? remaining > 1e-9
                    ? remaining
                    : null
                : cost;
            if (stepCost == null) {
                continue;
            }
            const tentative = bestG + stepCost;
            if (tentative - 1e-9 > budget) {
                continue;
            }
            if (tentative + 1e-9 >= (gScore.get(nextKey) ?? Infinity)) {
                continue;
            }
            cameFrom.set(nextKey, current);
            gScore.set(nextKey, tentative);
            posByKey.set(nextKey, next);
            open.set(nextKey, next);
        }
    }
    const paths = new Map();
    for (const [hexKey, pos] of posByKey) {
        if (hexKey === startKey) {
            continue;
        }
        paths.set(hexKey, reconstruct(cameFrom, pos));
    }
    return paths;
}
