import { aiFleeRatio } from '../ai/weights';
import { appendAiTrace } from '../ai/trace';
import { hexDistance, neighborHexes } from '../hex/pathfinding';
import { findPath } from '../hex/pathfinding';
import { GOLD_RESOURCE_ID } from '../hex/resources';
import { isExplored } from '../hex/world';
import { isPassable, getTile } from '../hex/world';
import { visitingHeroId } from '../session/accessors';
import { combatConfigNumber, combatConfigRollPercent, } from '../town/catalog';
import { unitById } from '../town/catalog';
import { isHeroStack } from './battle';
import { isCreatureArmyUnit } from './siege';
import { partsArmyValue } from '../session/xp';
function posKey(position) {
    return `${position.q},${position.r}`;
}
function isMapEdgeHex(q, r) {
    for (const n of neighborHexes({ q, r })) {
        if (!getTile(n.q, n.r)) {
            return true;
        }
    }
    return false;
}
function pathBlockedHexes(session, mover) {
    const blocked = new Set();
    const add = (q, r) => {
        if (q === mover.position.q && r === mover.position.r) {
            return;
        }
        if (!isExplored(q, r)) {
            return;
        }
        blocked.add(posKey({ q, r }));
    };
    for (const hero of session.heroes) {
        if (hero.flight || hero.id === mover.id) {
            continue;
        }
        add(hero.position.q, hero.position.r);
    }
    for (const town of session.towns) {
        add(town.position.q, town.position.r);
    }
    for (const node of session.nodes) {
        if (node.kind === 'pickup' && node.collected) {
            continue;
        }
        add(node.position.q, node.position.r);
    }
    for (const feature of session.features ?? []) {
        add(feature.position.q, feature.position.r);
    }
    return blocked;
}
function townHeroSlotFree(session, town, playerId, exceptHeroId) {
    if (town.player_id !== playerId) {
        return false;
    }
    const occupantId = visitingHeroId(session, town);
    if (!occupantId || occupantId === exceptHeroId) {
        return true;
    }
    const occupant = session.heroes.find((row) => row.id === occupantId);
    return occupant == null || occupant.player_id !== playerId;
}
function findWalkableOutsideTown(townPos, occupied) {
    const tryHex = (hex) => {
        const key = posKey(hex);
        return (isPassable(hex.q, hex.r) &&
            !occupied.has(key) &&
            !isMapEdgeHex(hex.q, hex.r));
    };
    const ring1 = neighborHexes(townPos);
    for (const hex of ring1) {
        if (tryHex(hex)) {
            return hex;
        }
    }
    const seen = new Set([posKey(townPos), ...ring1.map(posKey)]);
    let frontier = ring1.flatMap((hex) => neighborHexes(hex));
    for (let dist = 2; dist <= 6; dist += 1) {
        const nextFrontier = [];
        for (const hex of frontier) {
            const key = posKey(hex);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            if (tryHex(hex)) {
                return hex;
            }
            nextFrontier.push(...neighborHexes(hex));
        }
        frontier = nextFrontier;
    }
    return null;
}
export function nearestFriendlyTown(session, hero) {
    const owned = session.towns.filter((town) => town.player_id === hero.player_id);
    if (owned.length === 0) {
        return null;
    }
    const blocked = pathBlockedHexes(session, hero);
    const from = hero.position;
    let best = null;
    let bestPath = Infinity;
    let bestLine = Infinity;
    for (const town of owned) {
        const path = findPath(from, town.position, blocked, false);
        const steps = path ? Math.max(0, path.length - 1) : Infinity;
        const line = hexDistance(from, town.position);
        if (steps < bestPath ||
            (steps === bestPath && line < bestLine) ||
            (steps === bestPath && line === bestLine && best && town.name < best.name)) {
            bestPath = steps;
            bestLine = line;
            best = town;
        }
    }
    return best;
}
export function placementAfterEscape(session, hero, town) {
    const occupied = new Set();
    for (const other of session.heroes) {
        if (other.id === hero.id || other.flight) {
            continue;
        }
        occupied.add(posKey(other.position));
    }
    if (townHeroSlotFree(session, town, hero.player_id, hero.id)) {
        return { ...town.position };
    }
    const outside = findWalkableOutsideTown(town.position, occupied);
    return outside ?? { ...town.position };
}
export function playerOwnsFriendlyTown(session, playerId) {
    return session.towns.some((town) => town.player_id === playerId);
}
/** True when this side is the siege defender (no flee / surrender). */
export function isSiegeDefenceSide(side, siegeTownId) {
    return Boolean(siegeTownId) && side === 'def';
}
function livingCreatureParts(battle, catalog, side) {
    const parts = [];
    for (const stack of battle.stacks) {
        if (stack.side !== side ||
            stack.qty <= 0 ||
            isHeroStack(stack) ||
            !isCreatureArmyUnit(unitById(catalog, stack.unitId))) {
            continue;
        }
        parts.push({ unitId: stack.unitId, qty: stack.qty });
    }
    return parts;
}
export function sideArmyValueInBattle(battle, catalog, side) {
    return partsArmyValue(catalog, livingCreatureParts(battle, catalog, side));
}
export function baseSurrenderOfferGold(battle, catalog, side) {
    const armyValue = sideArmyValueInBattle(battle, catalog, side);
    const pct = combatConfigNumber(catalog, 'surrender_cost_pct', 50) / 100;
    const raw = armyValue * pct;
    return Math.max(0, Math.round(raw / 10) * 10);
}
export function escalateSurrenderOffer(catalog, previousGold, random) {
    const bumpPct = combatConfigRollPercent(catalog, 'surrender_escalate_pct', 40, random);
    return Math.max(0, Math.round((previousGold * (1 + bumpPct / 100)) / 10) * 10);
}
export function surrenderCostMap(goldAmount) {
    return { [GOLD_RESOURCE_ID]: Math.max(0, Math.floor(goldAmount)) };
}
export function playerGoldStockpile(session, playerId) {
    const player = session.players.find((row) => row.id === playerId);
    return Math.max(0, Math.floor(player?.resources[GOLD_RESOURCE_ID] ?? 0));
}
export function cappedSurrenderGold(session, playerId, gold) {
    return Math.min(gold, playerGoldStockpile(session, playerId));
}
export function applyFleeLossesToBattle(battle, catalog, fleeingSide, random) {
    const stacks = battle.stacks.map((stack) => {
        if (stack.side !== fleeingSide ||
            stack.qty <= 0 ||
            isHeroStack(stack) ||
            stack.summonSeq != null) {
            return stack;
        }
        const lossPct = combatConfigRollPercent(catalog, 'flee_loss_pct', 75, random);
        const lost = Math.floor(stack.qty * (lossPct / 100));
        const nextQty = Math.max(0, stack.qty - lost);
        if (nextQty <= 0) {
            return { ...stack, qty: 0, topHealth: 0 };
        }
        const maxHp = unitById(catalog, stack.unitId)?.health ?? stack.topHealth;
        return {
            ...stack,
            qty: nextQty,
            topHealth: Math.min(stack.topHealth, maxHp),
        };
    });
    return { ...battle, stacks };
}
export function aiAcceptsSurrenderOffer(catalog, battle, acceptingSide, offeredGold) {
    const enemySide = acceptingSide === 'atk' ? 'def' : 'atk';
    const enemyRemain = sideArmyValueInBattle(battle, catalog, enemySide);
    const ownRemain = sideArmyValueInBattle(battle, catalog, acceptingSide);
    const expectedGain = enemyRemain - ownRemain;
    const accept = offeredGold >= expectedGain;
    appendAiTrace(`AI combat_surrender — side=${acceptingSide} offer=${offeredGold} expectedGain=${expectedGain.toFixed(0)} (${enemyRemain.toFixed(0)} enemy − ${ownRemain.toFixed(0)} own) → ${accept ? 'accept' : 'decline'}`);
    return accept;
}
export function aiShouldTryCombatEscape(catalog, battle, side) {
    const enemySide = side === 'atk' ? 'def' : 'atk';
    const own = sideArmyValueInBattle(battle, catalog, side);
    const enemy = sideArmyValueInBattle(battle, catalog, enemySide);
    if (!(enemy > 0)) {
        return false;
    }
    const ratio = aiFleeRatio(catalog);
    return own < ratio * enemy;
}
export function aiPrefersSurrenderOverFlee(hero) {
    return (hero?.current_level ?? 1) >= 5;
}
export function canAffordCost(session, playerId, cost) {
    const gold = cost[GOLD_RESOURCE_ID] ?? 0;
    return playerGoldStockpile(session, playerId) >= gold;
}
