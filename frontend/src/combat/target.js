import { hexDistance } from '../hex/pathfinding';
import { shapeIsUntargeted, shapePulsesOnMove, unitAttackShape, unitAutoTarget, unitById, unitIsStationary, } from '../town/catalog';
import { attackIconFor, attackRangeFrom, isValidAttackTarget, } from './attack';
import { isHeroStack, stackMoveSpeed, stackMaxRange } from './battle';
import { combatMovementReachable, combatPathSteps, footprintSpecFor, groundEffectMovementBlockKeys, hexKey, landingOccupiedForMover, moveKindForUnit, occupiedForMover, stackOccupyingHex, stopOnlyForMover, } from './movement';
import { deathKnightShadowMoveAdjust } from './shadow';
import { isHealAllyTarget } from './factory';
import { tombstoneOccupancyBodies } from './tombstone';
import { breathHexes, hasLineOfSight, previewImpactKeys } from './shapes';
import { isSiegeEngineWallTarget, isUntargetableStack, isValidSiegeWallAttackStand, openBridgeMoatKeys, } from './siege';
import { pickNearestUnitAnySide, isVanished, isMagicAttackSilenced } from './condition';
/**
 * Pointy-top, y-down: 0° east, then 60° clockwise.
 * Matches honeycomb-grid POINTY neighbor angles.
 */
const WEDGE_NEIGHBORS = [
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: -1, r: 1 },
    { q: -1, r: 0 },
    { q: 0, r: -1 },
    { q: 1, r: -1 },
];
const CENTER_FRAC = 0.42;
export function pointerHexZone(dx, dy, hexSize) {
    if (Math.hypot(dx, dy) < hexSize * CENTER_FRAC) {
        return 'center';
    }
    const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    return (Math.floor((deg + 30) / 60) % 6);
}
function wedgeNeighbor(hover, zone) {
    const delta = WEDGE_NEIGHBORS[zone] ?? WEDGE_NEIGHBORS[0];
    return { q: hover.q + delta.q, r: hover.r + delta.r };
}
function usesDirectionWedges(shape) {
    return shape === 'single' || shape === 'cleave' || shape === 'breath';
}
/** Hex the stack will occupy after walking `steps` (current hex if none). */
export function actingStand(origin, steps) {
    const last = steps[steps.length - 1];
    return last ?? { q: origin.q, r: origin.r };
}
function moverStats(stack, battle, catalog, tiles, heroes) {
    const unit = unitById(catalog, stack.unitId);
    const kind = moveKindForUnit(unit, catalog);
    const tombs = tombstoneOccupancyBodies(battle.tombstones);
    // Tombstones block landing only — units may path through them.
    const occupied = occupiedForMover(battle.stacks, catalog, stack.id, kind);
    const landOccupied = landingOccupiedForMover(battle.stacks, catalog, stack.id, tombs);
    const budget = unitIsStationary(unit)
        ? 0
        : (stackMoveSpeed(stack, catalog) ?? 0);
    const from = { q: stack.q, r: stack.r };
    const spec = footprintSpecFor(stack, catalog);
    const passableMoat = openBridgeMoatKeys(battle, catalog, tiles);
    const stopOnly = stopOnlyForMover(battle, catalog, tiles, kind);
    const costAdjust = deathKnightShadowMoveAdjust(battle, catalog, heroes, stack.side, kind);
    const geBlocks = groundEffectMovementBlockKeys(battle);
    return {
        unit,
        kind,
        occupied,
        landOccupied,
        budget,
        from,
        spec,
        passableMoat,
        stopOnly,
        costAdjust,
        geBlocks,
    };
}
function impactFrom(attacker, stand, aim, battle, catalog, tiles) {
    const spec = unitAttackShape(unitById(catalog, attacker.unitId));
    // charge_line: corridor is from the pre-move hex through the target — not
    // from the post-walk stand (that would collapse the preview to 1 hex).
    if (spec.shape === 'charge_line') {
        return previewImpactKeys(attacker, aim, battle, catalog, tiles, { q: attacker.q, r: attacker.r });
    }
    const ghost = { ...attacker, q: stand.q, r: stand.r };
    return previewImpactKeys(ghost, aim, battle, catalog, tiles);
}
function inMaxRange(from, hex, maxRange) {
    const dist = hexDistance(from, hex);
    return dist >= 1 && dist <= maxRange;
}
/** Fewest-steps hex this stack can stand on and still be in attack range. */
export function bestAttackStand(attacker, target, reachable, catalog, tiles, stacks, allowFriendly = false) {
    if (attacker.id === target.id) {
        return null;
    }
    if (!allowFriendly && attacker.side === target.side) {
        return null;
    }
    if (isUntargetableStack(target, catalog) || isVanished(target, catalog)) {
        return null;
    }
    const wallTarget = isSiegeEngineWallTarget(target, catalog);
    const aim = { q: target.q, r: target.r };
    let best = null;
    let bestSteps = Infinity;
    for (const [key, steps] of reachable) {
        const [qs, rs] = key.split(',');
        const from = { q: Number(qs), r: Number(rs) };
        if (wallTarget &&
            !isValidSiegeWallAttackStand(from, tiles, stacks, catalog)) {
            continue;
        }
        if (!attackRangeFrom(from, target, catalog, attacker)) {
            continue;
        }
        if (!hasLineOfSight(from, aim, tiles, stacks, catalog)) {
            continue;
        }
        if (steps.length < bestSteps) {
            best = from;
            bestSteps = steps.length;
        }
    }
    return best;
}
function breathHitsTarget(from, target, rows) {
    return breathHexes(from, target, rows).some((hex) => hex.q === target.q && hex.r === target.r);
}
/**
 * Closest reachable hex to the target from which Breath still hits it.
 * Prefer adjacency when the movement budget can get there.
 */
function bestBreathStand(attacker, target, reachable, catalog, tiles, stacks) {
    if (attacker.side === target.side || attacker.id === target.id) {
        return null;
    }
    if (isUntargetableStack(target, catalog)) {
        return null;
    }
    const rows = unitAttackShape(unitById(catalog, attacker.unitId)).rows;
    const aim = { q: target.q, r: target.r };
    const wallTarget = isSiegeEngineWallTarget(target, catalog);
    let best = null;
    let bestDist = Infinity;
    let bestSteps = Infinity;
    for (const [key, steps] of reachable) {
        const [qs, rs] = key.split(',');
        const from = { q: Number(qs), r: Number(rs) };
        if (wallTarget &&
            !isValidSiegeWallAttackStand(from, tiles, stacks, catalog)) {
            continue;
        }
        if (!attackRangeFrom(from, target, catalog, attacker)) {
            continue;
        }
        if (!hasLineOfSight(from, aim, tiles, stacks, catalog)) {
            continue;
        }
        if (!breathHitsTarget(from, aim, rows)) {
            continue;
        }
        const dist = hexDistance(from, aim);
        if (dist < bestDist || (dist === bestDist && steps.length < bestSteps)) {
            best = from;
            bestDist = dist;
            bestSteps = steps.length;
        }
    }
    return best;
}
function bestRangeStand(reachable, aim, maxRange, tiles, stacks, catalog) {
    let best = null;
    let bestSteps = Infinity;
    for (const [key, steps] of reachable) {
        const [qs, rs] = key.split(',');
        const from = { q: Number(qs), r: Number(rs) };
        if (!inMaxRange(from, aim, maxRange)) {
            continue;
        }
        if (!hasLineOfSight(from, aim, tiles, stacks, catalog)) {
            continue;
        }
        if (steps.length < bestSteps) {
            best = from;
            bestSteps = steps.length;
        }
    }
    return best;
}
export function canStrikeThisTurn(attacker, battle, tiles, catalog, heroes) {
    if (isMagicAttackSilenced(attacker, catalog)) {
        return false;
    }
    const unit = unitById(catalog, attacker.unitId);
    const spec = unitAttackShape(unit);
    if (unitAutoTarget(unit)) {
        return battle.stacks.some((row) => isValidAttackTarget(attacker, row, catalog, tiles, battle.stacks));
    }
    if (shapePulsesOnMove(spec.shape)) {
        return false;
    }
    if (shapeIsUntargeted(spec.shape)) {
        return battle.stacks.some((row) => row.side !== attacker.side &&
            row.qty > 0 &&
            !isUntargetableStack(row, catalog) &&
            hasLineOfSight({ q: attacker.q, r: attacker.r }, { q: row.q, r: row.r }, tiles, battle.stacks, catalog));
    }
    const { costAdjust } = moverStats(attacker, battle, catalog, tiles, heroes);
    const reachable = combatMovementReachable(attacker, battle, tiles, catalog, costAdjust);
    if (spec.shape === 'line') {
        // LINE is stay-and-shoot from the current hex (Centaur-style). Do not
        // treat it like Beam's "walk into range, then fire."
        return battle.stacks.some((row) => {
            if (row.qty <= 0 ||
                row.side === attacker.side ||
                isHeroStack(row) ||
                isUntargetableStack(row, catalog)) {
                return false;
            }
            return (attackRangeFrom(attacker, row, catalog, attacker) &&
                hasLineOfSight({ q: attacker.q, r: attacker.r }, { q: row.q, r: row.r }, tiles, battle.stacks, catalog));
        });
    }
    if (spec.shape === 'beam') {
        const maxRange = stackMaxRange(attacker, catalog);
        return battle.stacks.some((row) => {
            if (row.qty <= 0 ||
                row.side === attacker.side ||
                isHeroStack(row) ||
                isUntargetableStack(row, catalog)) {
                return false;
            }
            return (bestRangeStand(reachable, { q: row.q, r: row.r }, maxRange, tiles, battle.stacks, catalog) != null);
        });
    }
    if (spec.shape === 'aoe') {
        const maxRange = stackMaxRange(attacker, catalog);
        return tiles.some((tile) => bestRangeStand(reachable, { q: tile.q, r: tile.r }, maxRange, tiles, battle.stacks, catalog) != null);
    }
    if (spec.shape === 'breath') {
        return battle.stacks.some((row) => bestBreathStand(attacker, row, reachable, catalog, tiles, battle.stacks) != null);
    }
    return battle.stacks.some((row) => bestAttackStand(attacker, row, reachable, catalog, tiles, battle.stacks) != null);
}
function attackHover(attacker, aim, steps, targetId, battle, catalog, tiles, icon) {
    if (isMagicAttackSilenced(attacker, catalog)) {
        return {
            icon: 'invalid',
            q: aim.q,
            r: aim.r,
            steps: [],
            attackTargetId: null,
            fire: false,
            afterMove: null,
            impactKeys: [],
            aimHex: aim,
            label: 'Silenced',
        };
    }
    const unit = unitById(catalog, attacker.unitId);
    const stand = actingStand({ q: attacker.q, r: attacker.r }, steps);
    return {
        icon: icon ?? attackIconFor(unit),
        q: aim.q,
        r: aim.r,
        steps,
        attackTargetId: targetId,
        fire: true,
        afterMove: null,
        impactKeys: impactFrom(attacker, stand, aim, battle, catalog, tiles),
        aimHex: aim,
    };
}
function stayHover(from, extra) {
    return {
        icon: 'move',
        q: from.q,
        r: from.r,
        steps: [],
        attackTargetId: null,
        fire: false,
        afterMove: extra?.afterMove ?? null,
        impactKeys: extra?.impactKeys ?? [],
    };
}
/**
 * Walk steps this turn toward `hover`: the exact reachable path if the hex
 * is in budget, otherwise the shortest path truncated at remaining Speed.
 */
function stepsToward(hover, reachable, from, budget, tiles, kind, occupied, spec, passableMoat, stopOnly, landOccupied, costAdjust, movementBlockKeys) {
    const exact = reachable.get(hexKey(hover.q, hover.r));
    if (exact != null && exact.length > 0) {
        return exact;
    }
    const truncated = combatPathSteps(from, hover, budget, tiles, kind, occupied, spec, passableMoat, stopOnly, landOccupied, costAdjust, movementBlockKeys);
    return truncated.length > 0 ? truncated : null;
}
/**
 * Among hexes reachable this turn, pick the one that gets closest to `goal`.
 * Used when a direct path onto/toward an occupied enemy hex fails.
 */
export function bestApproachToward(from, goal, reachable) {
    const startDist = hexDistance(from, goal);
    let best = null;
    let bestDist = startDist;
    let bestLen = Infinity;
    for (const [key, steps] of reachable) {
        if (steps.length === 0) {
            continue;
        }
        const [qs, rs] = key.split(',');
        const hex = { q: Number(qs), r: Number(rs) };
        const dist = hexDistance(hex, goal);
        if (dist < bestDist || (dist === bestDist && steps.length < bestLen)) {
            best = { hex, steps };
            bestDist = dist;
            bestLen = steps.length;
        }
    }
    if (!best || bestDist >= startDist) {
        return null;
    }
    return best;
}
function moveTowardHover(from, steps) {
    const dest = actingStand(from, steps);
    return {
        icon: 'move',
        q: dest.q,
        r: dest.r,
        steps,
        attackTargetId: null,
        fire: false,
        afterMove: null,
        impactKeys: [],
    };
}
export function combatHover(attacker, hover, battle, tiles, catalog, zone = 'center', heroes) {
    const { unit, kind, occupied, landOccupied, budget, from, spec, passableMoat, stopOnly, costAdjust, geBlocks } = moverStats(attacker, battle, catalog, tiles, heroes);
    if (unitAutoTarget(unit)) {
        return null;
    }
    const shape = unitAttackShape(unit);
    const occupant = stackOccupyingHex(battle.stacks, hover.q, hover.r, catalog);
    const isSelf = occupant?.id === attacker.id;
    if (occupant &&
        !isSelf &&
        isUntargetableStack(occupant, catalog)) {
        return null;
    }
    const enemy = occupant && !isSelf && occupant.side !== attacker.side ? occupant : null;
    const healAlly = occupant && !isSelf && isHealAllyTarget(attacker, occupant, catalog)
        ? occupant
        : null;
    const strikeTarget = enemy ?? healAlly;
    const reachable = combatMovementReachable(attacker, battle, tiles, catalog, costAdjust);
    const maxRange = stackMaxRange(attacker, catalog);
    if (isSelf) {
        if (shapePulsesOnMove(shape.shape)) {
            return stayHover(from, {
                afterMove: 'pulse',
                impactKeys: impactFrom(attacker, from, from, battle, catalog, tiles),
            });
        }
        if (shapeIsUntargeted(shape.shape)) {
            return attackHover(attacker, hover, [], null, battle, catalog, tiles);
        }
        if (!usesDirectionWedges(shape.shape)) {
            return unitIsStationary(unit) ? null : stayHover(from);
        }
    }
    if (usesDirectionWedges(shape.shape) && !(occupant && !isSelf)) {
        const steps = reachable.get(hexKey(hover.q, hover.r));
        if (steps == null) {
            const toward = stepsToward(hover, reachable, from, budget, tiles, kind, occupied, spec, passableMoat, stopOnly, landOccupied, costAdjust, geBlocks);
            return toward ? moveTowardHover(from, toward) : null;
        }
        const moveOnly = () => ({
            icon: 'move',
            q: hover.q,
            r: hover.r,
            steps,
            attackTargetId: null,
            fire: false,
            afterMove: null,
            impactKeys: [],
        });
        if (zone === 'center') {
            return unitIsStationary(unit) ? null : moveOnly();
        }
        const neighbor = wedgeNeighbor(hover, zone);
        const foe = stackOccupyingHex(battle.stacks, neighbor.q, neighbor.r, catalog);
        const aim = foe ? { q: foe.q, r: foe.r } : neighbor;
        const validFoe = foe != null &&
            foe.qty > 0 &&
            (foe.side !== attacker.side || isHealAllyTarget(attacker, foe, catalog)) &&
            !isUntargetableStack(foe, catalog) &&
            attackRangeFrom(hover, foe, catalog, attacker) &&
            hasLineOfSight(hover, { q: foe.q, r: foe.r }, tiles, battle.stacks, catalog) &&
            (shape.shape !== 'breath' ||
                breathHitsTarget(hover, aim, shape.rows));
        if (!validFoe || !foe) {
            return moveOnly();
        }
        if (isSiegeEngineWallTarget(foe, catalog) &&
            !isValidSiegeWallAttackStand(hover, tiles, battle.stacks, catalog)) {
            return {
                icon: 'invalid',
                q: hover.q,
                r: hover.r,
                steps,
                attackTargetId: null,
                fire: false,
                afterMove: null,
                impactKeys: [],
                label: "Can't Stand Here",
            };
        }
        if (isMagicAttackSilenced(attacker, catalog)) {
            return {
                icon: 'invalid',
                q: hover.q,
                r: hover.r,
                steps: [],
                attackTargetId: null,
                fire: false,
                afterMove: null,
                impactKeys: [],
                label: 'Silenced',
            };
        }
        return {
            icon: attackIconFor(unit),
            q: hover.q,
            r: hover.r,
            steps,
            attackTargetId: foe.id,
            fire: true,
            afterMove: null,
            impactKeys: impactFrom(attacker, hover, aim, battle, catalog, tiles),
            aimHex: aim,
            arrowDeg: zone * 60,
            allowFriendly: isHealAllyTarget(attacker, foe, catalog),
        };
    }
    if (shape.shape === 'aoe') {
        const stand = bestRangeStand(reachable, hover, maxRange, tiles, battle.stacks, catalog);
        if (stand) {
            const enemyId = occupant && occupant.side !== attacker.side ? occupant.id : null;
            return attackHover(attacker, hover, reachable.get(hexKey(stand.q, stand.r)) ?? [], enemyId, battle, catalog, tiles, 'aoe');
        }
    }
    // LINE: fire from the current hex only (full pierce line). Never walk into
    // range then shoot — that Beam-style path made ranged piercers close first.
    // (Pangolin uses charge_line: walk-then-pierce, not this branch.)
    if (shape.shape === 'line' && strikeTarget) {
        const aim = { q: strikeTarget.q, r: strikeTarget.r };
        const canFireNow = attackRangeFrom(from, strikeTarget, catalog, attacker) &&
            hasLineOfSight(from, aim, tiles, battle.stacks, catalog);
        if (canFireNow) {
            return {
                ...attackHover(attacker, aim, [], strikeTarget.id, battle, catalog, tiles),
                allowFriendly: healAlly != null,
            };
        }
        if (enemy) {
            const approach = bestApproachToward(from, { q: enemy.q, r: enemy.r }, reachable);
            return approach ? moveTowardHover(from, approach.steps) : null;
        }
        return null;
    }
    if (shapePulsesOnMove(shape.shape)) {
        // Occupied enemy hex: fall through to attack/approach handling below.
        if (!(occupant && !isSelf)) {
            const steps = stepsToward(hover, reachable, from, budget, tiles, kind, occupied, spec, passableMoat, stopOnly, landOccupied, costAdjust, geBlocks);
            if (!steps) {
                return null;
            }
            const dest = actingStand(from, steps);
            return {
                icon: 'move',
                q: dest.q,
                r: dest.r,
                steps,
                attackTargetId: null,
                fire: false,
                afterMove: 'pulse',
                impactKeys: impactFrom(attacker, dest, dest, battle, catalog, tiles),
            };
        }
    }
    if (shapeIsUntargeted(shape.shape)) {
        if (enemy && hasLineOfSight(from, { q: enemy.q, r: enemy.r }, tiles, battle.stacks, catalog)) {
            return attackHover(attacker, hover, [], enemy.id, battle, catalog, tiles);
        }
        const steps = stepsToward(hover, reachable, from, budget, tiles, kind, occupied, spec, passableMoat, stopOnly, landOccupied, costAdjust, geBlocks);
        return steps ? moveTowardHover(from, steps) : null;
    }
    if (strikeTarget) {
        const stand = shape.shape === 'breath' && enemy
            ? bestBreathStand(attacker, enemy, reachable, catalog, tiles, battle.stacks)
            : bestAttackStand(attacker, strikeTarget, reachable, catalog, tiles, battle.stacks, healAlly != null);
        if (stand) {
            return {
                ...attackHover(attacker, { q: strikeTarget.q, r: strikeTarget.r }, reachable.get(hexKey(stand.q, stand.r)) ?? [], strikeTarget.id, battle, catalog, tiles),
                allowFriendly: healAlly != null,
            };
        }
        if (enemy && isSiegeEngineWallTarget(enemy, catalog)) {
            return {
                icon: 'invalid',
                q: enemy.q,
                r: enemy.r,
                steps: [],
                attackTargetId: null,
                fire: false,
                afterMove: null,
                impactKeys: [],
                label: "Can't Stand Here",
            };
        }
        if (enemy) {
            const steps = combatPathSteps(from, hover, budget, tiles, kind, occupied, spec, passableMoat, stopOnly, landOccupied, costAdjust, geBlocks);
            if (steps.length > 0) {
                return {
                    icon: 'move',
                    q: enemy.q,
                    r: enemy.r,
                    steps,
                    attackTargetId: null,
                    fire: false,
                    afterMove: null,
                    impactKeys: [],
                };
            }
            // Direct path onto the enemy hex failed (allies / footprint). Still walk closer.
            const approach = bestApproachToward(from, { q: enemy.q, r: enemy.r }, reachable);
            return approach ? moveTowardHover(from, approach.steps) : null;
        }
    }
    // Beams never fire at empty ground (Thor Construct regression). Unit aims
    // are handled above via strikeTarget / bestAttackStand. LINE is stay-and-shoot
    // from the current hex (see dedicated branch above).
    if (occupant && !isSelf) {
        return null;
    }
    const steps = stepsToward(hover, reachable, from, budget, tiles, kind, occupied, spec, passableMoat, stopOnly, landOccupied, costAdjust, geBlocks);
    return steps ? moveTowardHover(from, steps) : null;
}
/**
 * Confuse: path (if needed) then strike the nearest living unit, any side.
 * Null when no victim or none reachable this turn.
 */
export function confusedAttackIntent(stack, battle, catalog, tiles, random = Math.random) {
    if (isMagicAttackSilenced(stack, catalog)) {
        return null;
    }
    const target = pickNearestUnitAnySide(stack, battle, catalog, random);
    if (!target) {
        return null;
    }
    const unit = unitById(catalog, stack.unitId);
    const shape = unitAttackShape(unit);
    const from = { q: stack.q, r: stack.r };
    const reachable = combatMovementReachable(stack, battle, tiles, catalog);
    // LINE: stay-and-shoot — never relocate before the confused strike.
    if (shape.shape === 'line') {
        if (!attackRangeFrom(stack, target, catalog, stack) ||
            !hasLineOfSight(from, { q: target.q, r: target.r }, tiles, battle.stacks, catalog)) {
            return null;
        }
        return {
            icon: attackIconFor(unit),
            q: from.q,
            r: from.r,
            steps: [],
            attackTargetId: target.id,
            fire: true,
            afterMove: null,
            impactKeys: [],
            aimHex: { q: target.q, r: target.r },
            allowFriendly: true,
        };
    }
    const stand = bestAttackStand(stack, target, reachable, catalog, tiles, battle.stacks, true);
    if (!stand) {
        return null;
    }
    const steps = reachable.get(hexKey(stand.q, stand.r)) ?? [];
    return {
        icon: attackIconFor(unit),
        q: stand.q,
        r: stand.r,
        steps,
        attackTargetId: target.id,
        fire: true,
        afterMove: null,
        impactKeys: [],
        aimHex: { q: target.q, r: target.r },
        allowFriendly: true,
    };
}
