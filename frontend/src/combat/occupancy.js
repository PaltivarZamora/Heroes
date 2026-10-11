import { unitById, unitFootprint } from '../town/catalog';
import { isHeroStack } from './battle';
import { footprintHexes as shapeFootprintHexes, } from './footprint';
export function occupancyKey(q, r) {
    return `${q},${r}`;
}
/** Inward along-row direction: attacker +q, defender −q. */
export function footprintAlong(side) {
    return side === 'def' ? -1 : 1;
}
/**
 * @deprecated Prefer footprintAlong — kept for call sites that still build Axial steps.
 * Extra hexes extend toward the field center along ±q.
 */
export function footprintStep(side) {
    return side === 'def' ? { q: -1, r: 0 } : { q: 1, r: 0 };
}
export function footprintHexes(origin, codeOrSize, alongOrStep = 1) {
    const code = typeof codeOrSize === 'number'
        ? codeOrSize <= 1
            ? '1x1'
            : codeOrSize === 2
                ? '2x1'
                : '1x1'
        : codeOrSize;
    const along = typeof alongOrStep === 'number'
        ? alongOrStep
        : alongOrStep.q < 0
            ? -1
            : 1;
    return shapeFootprintHexes(origin, code, along);
}
export function combatBodyFootprint(stack, catalog) {
    if (isHeroStack(stack)) {
        return '1x1';
    }
    return unitFootprint(unitById(catalog, stack.unitId));
}
/** @deprecated Use combatBodyFootprint — returns hex count for legacy art sizing. */
export function combatBodySize(stack, catalog) {
    return footprintHexes({ q: stack.q, r: stack.r }, combatBodyFootprint(stack, catalog), footprintAlong(stack.side)).length;
}
export function stackFootprint(stack, catalog) {
    return footprintHexes({ q: stack.q, r: stack.r }, combatBodyFootprint(stack, catalog), footprintAlong(stack.side));
}
export function bodyFromStack(stack, catalog) {
    return { id: stack.id, hexes: stackFootprint(stack, catalog) };
}
export function occupiedFromBodies(bodies, exceptId) {
    const blocked = new Set();
    for (const body of bodies) {
        if (body.id === exceptId) {
            continue;
        }
        for (const hex of body.hexes) {
            blocked.add(occupancyKey(hex.q, hex.r));
        }
    }
    return blocked;
}
function stackName(stack, catalog) {
    return (unitById(catalog, stack.unitId)?.name ?? '').trim().toLowerCase();
}
/** Drawbridge never occupies — units must be able to stop on it. */
function occupiesHex(stack, catalog, ignoreWalls = false) {
    const name = stackName(stack, catalog);
    if (name === 'drawbridge') {
        return false;
    }
    if (ignoreWalls && (name === 'wall' || name === 'shooter')) {
        return false;
    }
    return true;
}
export function occupiedHexes(stacks, catalog, exceptId, extras = [], ignoreWalls = false) {
    return occupiedFromBodies([
        ...stacks
            .filter((stack) => occupiesHex(stack, catalog, ignoreWalls))
            .map((stack) => bodyFromStack(stack, catalog)),
        ...extras,
    ], exceptId);
}
/** Drop later stacks whose footprint overlaps an earlier body. */
export function stacksWithoutOverlap(stacks, catalog, extras = []) {
    const kept = [];
    for (const stack of stacks) {
        const occupied = occupiedHexes(kept, catalog, undefined, extras);
        const blocked = stackFootprint(stack, catalog).some((hex) => occupied.has(occupancyKey(hex.q, hex.r)));
        if (!blocked) {
            kept.push(stack);
        }
    }
    return kept;
}
export function occupyingBody(bodies, q, r) {
    const key = occupancyKey(q, r);
    return (bodies.find((body) => body.hexes.some((hex) => occupancyKey(hex.q, hex.r) === key)) ?? null);
}
export function stackOccupyingHex(stacks, q, r, catalog, extras = []) {
    const bodies = [
        ...stacks
            .filter((stack) => occupiesHex(stack, catalog, false))
            .map((stack) => bodyFromStack(stack, catalog)),
        ...extras,
    ];
    const hit = occupyingBody(bodies, q, r);
    if (!hit) {
        return null;
    }
    return stacks.find((stack) => stack.id === hit.id) ?? null;
}
/** True if every hex of the footprint can be stood on. */
export function footprintFits(origin, codeOrSize, alongOrStep, occupied, enterCost, ignore) {
    for (const hex of footprintHexes(origin, codeOrSize, alongOrStep)) {
        const key = occupancyKey(hex.q, hex.r);
        if (enterCost(hex.q, hex.r) == null) {
            return false;
        }
        if (ignore?.has(key)) {
            continue;
        }
        if (occupied.has(key)) {
            return false;
        }
    }
    return true;
}
