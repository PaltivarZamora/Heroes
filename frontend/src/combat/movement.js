import { spendMovement } from '../hex/hero';
import { findPathOnBoard, reachableWithin } from '../hex/pathfinding';
import { DUMP_REMAINING_MOVE_COST, moveTypeValue, unitAttackShape, unitById, unitIsStationary, } from '../town/catalog';
import { stackMoveSpeed } from './battle';
import { closedDrawbridgeKeys, openBridgeMoatKeys } from './siege';
import { hasLineOfSight } from './shapes';
import { tombstoneOccupancyBodies } from './tombstone';
import { combatBodyFootprint, footprintAlong, footprintFits, occupancyKey, occupiedHexes, stackFootprint, } from './occupancy';
export { combatBodySize as combatStackCells, combatBodyFootprint as combatStackFootprint, occupiedHexes, stackFootprint, stackOccupyingHex, } from './occupancy';
export function hexKey(q, r) {
    return occupancyKey(q, r);
}
export function moveKindForUnit(unit, catalog) {
    // Null move_type_id = non-mover (stationary). Not an error; pathing is
    // gated by unitIsStationary. Treat as ground for any residual cost checks.
    if (unit?.move_type_id == null) {
        return 'ground';
    }
    // Prefer move_type.value (stable under id renumber).
    const value = moveTypeValue(catalog, unit.move_type_id).toLowerCase();
    if (value.includes('fly')) {
        return 'flying';
    }
    if (value.includes('hover')) {
        return 'hover';
    }
    return 'ground';
}
export function moveVerb(kind) {
    if (kind === 'flying') {
        return 'flew';
    }
    if (kind === 'hover') {
        return 'hovered';
    }
    return 'moved';
}
function isAirborne(kind) {
    return kind === 'flying' || kind === 'hover';
}
/**
 * Traversal cost. Null = cannot cross this hex mid-path.
 * Flying/Hover may cross `is_blocked` terrain and ground-effect blockers
 * (Void, Barricade, etc.), including ones that also block LOS — landing is
 * still forbidden via combatCanLandOn.
 * `movementBlockKeys` covers live ground-effect stamps when tile.blocked
 * is stale (hover used to close over the map-init tile array).
 */
export function combatEnterCost(tile, kind, passableMoatKeys, movementBlockKeys) {
    if (!tile) {
        return null;
    }
    // Naval water (BR S9-12): Walkers cannot enter; Fly/Hover traverse.
    if (tile.navalKind === 'water') {
        if (kind === 'flying' || kind === 'hover') {
            return 1;
        }
        return null;
    }
    const blocked = tile.blocked ||
        (movementBlockKeys?.has(hexKey(tile.q, tile.r)) ?? false);
    if (blocked) {
        if (isAirborne(kind)) {
            return 1;
        }
        return null;
    }
    if (passableMoatKeys?.has(hexKey(tile.q, tile.r))) {
        return 1;
    }
    if (isAirborne(kind)) {
        return 1;
    }
    return tile.movementCostMultiplier;
}
/**
 * `is_blocked` / GE movement blockers are never a legal landing, for any
 * move type — Flying/Hover may path over them but cannot stop there.
 * Naval water: only Hover may land (Flyers pass through only).
 */
export function combatCanLandOn(tile, kind, passableMoatKeys, movementBlockKeys) {
    if (!tile) {
        return false;
    }
    if (tile.navalKind === 'water') {
        return kind === 'hover';
    }
    if (tile.blocked ||
        (movementBlockKeys?.has(hexKey(tile.q, tile.r)) ?? false)) {
        return false;
    }
    return combatEnterCost(tile, kind, passableMoatKeys, movementBlockKeys) != null;
}
/** Hexes from ground effects that block walking (Void, Barricade, …). */
export function groundEffectMovementBlockKeys(battle) {
    const keys = new Set();
    for (const zone of battle.groundEffects ?? []) {
        if (zone.blocksMovement !== true) {
            continue;
        }
        for (const key of zone.hexKeys) {
            keys.add(key);
        }
    }
    return keys;
}
export function occupiedForMover(stacks, catalog, exceptId, kind, extras = []) {
    // Flying/Hover may path through Wall/Shooter hexes, but must not land on them.
    return occupiedHexes(stacks, catalog, exceptId, extras, isAirborne(kind));
}
/** Landing occupancy always counts Wall/Shooter bodies. */
export function landingOccupiedForMover(stacks, catalog, exceptId, extras = []) {
    return occupiedHexes(stacks, catalog, exceptId, extras, false);
}
export function stopOnlyForMover(battle, catalog, tiles, kind) {
    if (isAirborne(kind)) {
        return new Set();
    }
    return closedDrawbridgeKeys(battle.stacks, catalog, tiles, battle.siegeGate);
}
function tileMap(tiles) {
    return new Map(tiles.map((tile) => [hexKey(tile.q, tile.r), tile]));
}
function stackEnterCost(tiles, kind, passableMoatKeys, movementBlockKeys) {
    return (q, r) => combatEnterCost(tiles.get(hexKey(q, r)), kind, passableMoatKeys, movementBlockKeys);
}
export function footprintSpecFor(stack, catalog) {
    const code = combatBodyFootprint(stack, catalog);
    const along = footprintAlong(stack.side);
    const ignore = new Set(stackFootprint(stack, catalog).map((hex) => hexKey(hex.q, hex.r)));
    return { code, along, ignore };
}
function standFits(origin, enterCost, occupied, spec) {
    return footprintFits(origin, spec?.code ?? '1x1', spec?.along ?? 1, occupied, enterCost, spec?.ignore);
}
function landFits(origin, tiles, kind, occupied, spec, passableMoatKeys, movementBlockKeys) {
    const landCost = (q, r) => {
        const tile = tiles.get(hexKey(q, r));
        if (!combatCanLandOn(tile, kind, passableMoatKeys, movementBlockKeys)) {
            return null;
        }
        return combatEnterCost(tile, kind, passableMoatKeys, movementBlockKeys);
    };
    return footprintFits(origin, spec?.code ?? '1x1', spec?.along ?? 1, occupied, landCost, spec?.ignore);
}
function withCostAdjust(base, adjust) {
    if (!adjust) {
        return base;
    }
    return (q, r) => {
        const cost = base(q, r);
        if (cost == null || cost === DUMP_REMAINING_MOVE_COST) {
            return cost;
        }
        return adjust(q, r, cost);
    };
}
export function combatPathSteps(from, to, budget, tiles, kind, occupied, spec, passableMoatKeys, stopOnlyKeys, landOccupied, costAdjust, movementBlockKeys) {
    if (budget <= 1e-9 || (from.q === to.q && from.r === to.r)) {
        return [];
    }
    const tilesByKey = tileMap(tiles);
    const enterCost = withCostAdjust(stackEnterCost(tilesByKey, kind, passableMoatKeys, movementBlockKeys), costAdjust);
    const destKey = hexKey(to.q, to.r);
    const destOccupied = occupied.has(destKey);
    const blocked = new Set(occupied);
    if (destOccupied) {
        blocked.delete(destKey);
    }
    if (stopOnlyKeys) {
        for (const key of stopOnlyKeys) {
            if (key !== destKey) {
                blocked.add(key);
            }
        }
    }
    const path = findPathOnBoard(from, to, enterCost, blocked);
    if (!path || path.length <= 1) {
        return [];
    }
    let body = path.slice(1);
    if (destOccupied) {
        const last = body[body.length - 1];
        if (last && hexKey(last.q, last.r) === destKey) {
            body = body.slice(0, -1);
        }
    }
    // Transit uses path occupancy; landing may forbid extra no-stop hexes.
    const landingOccupied = landOccupied ?? occupied;
    const steps = [];
    let mp = budget;
    for (const hex of body) {
        const cost = enterCost(hex.q, hex.r);
        if (cost == null) {
            break;
        }
        if (cost === DUMP_REMAINING_MOVE_COST) {
            if (mp <= 1e-9) {
                break;
            }
            if (!standFits(hex, enterCost, occupied, spec)) {
                break;
            }
            if (!landFits(hex, tilesByKey, kind, landingOccupied, spec, passableMoatKeys, movementBlockKeys)) {
                break;
            }
            steps.push(hex);
            break;
        }
        if (mp + 1e-9 < cost) {
            break;
        }
        if (!standFits(hex, enterCost, occupied, spec)) {
            break;
        }
        steps.push(hex);
        mp = spendMovement(mp, cost);
    }
    while (steps.length > 0) {
        const last = steps[steps.length - 1];
        if (last &&
            landFits(last, tilesByKey, kind, landingOccupied, spec, passableMoatKeys, movementBlockKeys)) {
            break;
        }
        steps.pop();
    }
    return steps;
}
/** Exact-reach leg for waypoint staging (null if the dest cannot be afforded). */
export function resolveCombatWaypointLeg(from, to, budget, tiles, kind, occupied, spec, passableMoatKeys, stopOnlyKeys, landOccupied, costAdjust, movementBlockKeys) {
    if (from.q === to.q && from.r === to.r) {
        return null;
    }
    const steps = combatPathSteps(from, to, budget, tiles, kind, occupied, spec, passableMoatKeys, stopOnlyKeys, landOccupied, costAdjust, movementBlockKeys);
    if (steps.length === 0) {
        return null;
    }
    const last = steps[steps.length - 1];
    if (!last || last.q !== to.q || last.r !== to.r) {
        return null;
    }
    const tilesByKey = tileMap(tiles);
    const enterCost = withCostAdjust(stackEnterCost(tilesByKey, kind, passableMoatKeys, movementBlockKeys), costAdjust);
    let mp = budget;
    for (const hex of steps) {
        const cost = enterCost(hex.q, hex.r);
        if (cost == null) {
            return null;
        }
        if (cost === DUMP_REMAINING_MOVE_COST) {
            mp = 0;
            break;
        }
        mp = spendMovement(mp, cost);
    }
    return { steps, remaining: mp };
}
/**
 * Hexes this stack can stand on this turn, including its current hex
 * (empty step list). Values are the walk steps from the origin.
 */
export function combatReachable(from, budget, tiles, kind, occupied, spec, passableMoatKeys, stopOnlyKeys, landOccupied, costAdjust, movementBlockKeys) {
    const tilesByKey = tileMap(tiles);
    const enterCost = withCostAdjust(stackEnterCost(tilesByKey, kind, passableMoatKeys, movementBlockKeys), costAdjust);
    const paths = reachableWithin(from, budget, enterCost, occupied, stopOnlyKeys);
    const landingOccupied = landOccupied ?? occupied;
    const out = new Map();
    out.set(hexKey(from.q, from.r), []);
    for (const [key, path] of paths) {
        const steps = path.slice(1);
        // Transit: path occupancy only (tombstones are passable mid-path).
        if (steps.some((hex) => !standFits(hex, enterCost, occupied, spec))) {
            continue;
        }
        const dest = steps[steps.length - 1];
        if (dest &&
            !landFits(dest, tilesByKey, kind, landingOccupied, spec, passableMoatKeys, movementBlockKeys)) {
            continue;
        }
        out.set(key, steps);
    }
    return out;
}
/**
 * Blink movement: any landable hex with LOS (no Speed distance budget).
 * Steps are a single teleport hop to the destination.
 */
export function combatBlinkReachable(from, tiles, kind, occupied, stacks, catalog, spec, passableMoatKeys, landOccupied, requireLos = true, movementBlockKeys) {
    const tilesByKey = tileMap(tiles);
    const enterCost = stackEnterCost(tilesByKey, kind, passableMoatKeys, movementBlockKeys);
    const landingOccupied = landOccupied ?? occupied;
    const out = new Map();
    out.set(hexKey(from.q, from.r), []);
    for (const tile of tiles) {
        const dest = { q: tile.q, r: tile.r };
        const key = hexKey(dest.q, dest.r);
        if (dest.q === from.q && dest.r === from.r) {
            continue;
        }
        if (requireLos &&
            !hasLineOfSight(from, dest, tiles, stacks, catalog)) {
            continue;
        }
        if (!landFits(dest, tilesByKey, kind, landingOccupied, spec, passableMoatKeys, movementBlockKeys)) {
            continue;
        }
        if (!standFits(dest, enterCost, landingOccupied, spec)) {
            continue;
        }
        out.set(key, [dest]);
    }
    return out;
}
/** Walk budget reach, or blink LOS destinations when the unit has blink_movement. */
export function combatMovementReachable(stack, battle, tiles, catalog, costAdjust) {
    const unit = unitById(catalog, stack.unitId);
    if (unitIsStationary(unit) || unit?.speed == null) {
        const here = hexKey(stack.q, stack.r);
        return new Map([[here, []]]);
    }
    const kind = moveKindForUnit(unit, catalog);
    const tombs = tombstoneOccupancyBodies(battle.tombstones);
    const occupied = occupiedForMover(battle.stacks, catalog, stack.id, kind);
    const landOccupied = landingOccupiedForMover(battle.stacks, catalog, stack.id, tombs);
    const from = { q: stack.q, r: stack.r };
    const spec = footprintSpecFor(stack, catalog);
    const passable = openBridgeMoatKeys(battle, catalog, tiles);
    const stopOnly = stopOnlyForMover(battle, catalog, tiles, kind);
    const geBlocks = groundEffectMovementBlockKeys(battle);
    const abilities = unitAttackShape(unit);
    if (abilities.blinkMovement) {
        return combatBlinkReachable(from, tiles, kind, occupied, battle.stacks, catalog, spec, passable, landOccupied, 
        // Blink is LOS-constrained (requires_los); never unrestricted like Shadow Step.
        true, geBlocks);
    }
    return combatReachable(from, stackMoveSpeed(stack, catalog) ?? 0, tiles, kind, occupied, spec, passable, stopOnly, landOccupied, costAdjust, geBlocks);
}
export function canCombatStep(stack, battle, tiles, catalog, costAdjust) {
    const unit = unitById(catalog, stack.unitId);
    if (unitIsStationary(unit) || unit?.speed == null) {
        return false;
    }
    if ((stackMoveSpeed(stack, catalog) ?? 0) <= 0) {
        return false;
    }
    const reach = combatMovementReachable(stack, battle, tiles, catalog, costAdjust);
    return reach.size > 1;
}
export function movementLogLine(stack, catalog, spaces) {
    const unit = unitById(catalog, stack.unitId);
    const name = unit?.name ?? 'Unknown';
    const verb = moveVerb(moveKindForUnit(unit, catalog));
    return `${stack.qty} ${name} ${verb} ${spaces} spaces.`;
}
