import { unitById } from '../town/catalog';
import { missingPassiveStatKey, passiveStatNumber, passiveStatSourceValue, passiveStatString, requirePassiveStats, } from '../town/heroPassiveStats';
import { applyStackDamage, applyStackHeal, heroForSide, } from './attack';
import { isHeroStack, mergeUnitDeaths, stackMaxHealth, } from './battle';
import { frozenTownCount, isTempleUnit } from './heroArmyPassives';
import { hexDistance } from '../hex/pathfinding';
import { occupancyKey } from './occupancy';
import { isHeroClass } from './shadow';
import { isCreatureArmyUnit } from './siege';
import { removeTombstone, stackFromTombstone, syncTombstonesFromWipes, } from './tombstone';
export { isTempleUnit };
export function frontDeficit(stack, catalog) {
    const max = stackMaxHealth(stack, catalog);
    return Math.max(0, max - stack.topHealth);
}
export function isDamagedCreature(stack, catalog) {
    return (stack.qty > 0 &&
        !isHeroStack(stack) &&
        !stack.indestructible &&
        isCreatureArmyUnit(unitById(catalog, stack.unitId)) &&
        frontDeficit(stack, catalog) > 0);
}
/**
 * Most-injured damaged creature on `side` (front-HP deficit, then id).
 * Shared by Cleric waterfall and Shaman Nature totem single-target heal.
 */
export function pickMostInjuredDamagedCreature(stacks, catalog, side, matches) {
    const candidates = stacks
        .filter((row) => row.side === side &&
        isDamagedCreature(row, catalog) &&
        (matches?.(row) ?? true))
        .sort((a, b) => {
        const da = frontDeficit(a, catalog);
        const db = frontDeficit(b, catalog);
        if (db !== da) {
            return db - da;
        }
        return a.id.localeCompare(b.id);
    });
    return candidates[0] ?? null;
}
function stackLabel(catalog, stack) {
    return `${stack.qty} ${unitById(catalog, stack.unitId)?.name ?? 'unit'}`;
}
function matchesTownFilter(catalog, unitId, filter) {
    if (!filter) {
        return isTempleUnit(catalog, unitId);
    }
    const needle = filter.trim().toLowerCase();
    if (needle === 'temple') {
        return isTempleUnit(catalog, unitId);
    }
    const unit = unitById(catalog, unitId);
    const townId = catalog.town.find((row) => row.name.trim().toLowerCase() === needle)?.id;
    return townId != null && unit?.town_id === townId;
}
function templeStackCountForHeal(battle, catalog, side, filter, opening) {
    // Prefer battle-start frozen stack count (same as Barbarian/Paladin).
    if (battle.armyTownCounts?.temple != null) {
        return frozenTownCount(battle.armyTownCounts, 'temple', side);
    }
    if (opening) {
        let n = 0;
        for (const row of opening) {
            if (row.side !== side || row.qty <= 0) {
                continue;
            }
            if (matchesTownFilter(catalog, row.unitId, filter)) {
                n += 1;
            }
        }
        return n;
    }
    let n = 0;
    for (const row of battle.stacks) {
        if (row.side !== side ||
            row.qty <= 0 ||
            isHeroStack(row) ||
            !matchesTownFilter(catalog, row.unitId, filter)) {
            continue;
        }
        n += 1;
    }
    return n;
}
function liveQtyForOpening(battle, opening) {
    const live = battle.stacks.find((row) => row.id === opening.id);
    if (live && live.qty > 0) {
        return live.qty;
    }
    return 0;
}
/** INT × Temple stack count, most-hurt-first front-HP heal (end of round). */
function applyClericHealPool(battle, catalog, hero, side) {
    const stats = requirePassiveStats(catalog, hero, 'Cleric end of round heal');
    if (!stats) {
        return { battle, lines: [], healKeys: [] };
    }
    const healTown = passiveStatString(stats, 'heal_town_filter');
    const healStat = passiveStatString(stats, 'heal_stat_source');
    const stackCount = templeStackCountForHeal(battle, catalog, side, healTown ?? 'Temple');
    const statValue = passiveStatSourceValue(catalog, hero, healStat ?? 'INT');
    let pool = Math.max(0, Math.floor(statValue * stackCount));
    if (pool <= 0) {
        return { battle, lines: [], healKeys: [] };
    }
    let stacks = [...battle.stacks];
    let totalHealed = 0;
    const healLines = [];
    const healKeys = [];
    while (pool > 0) {
        const candidates = stacks
            .filter((row) => row.side === side &&
            matchesTownFilter(catalog, row.unitId, healTown ?? 'Temple') &&
            isDamagedCreature(row, catalog))
            .sort((a, b) => {
            const da = frontDeficit(a, catalog);
            const db = frontDeficit(b, catalog);
            if (db !== da) {
                return db - da;
            }
            return a.id.localeCompare(b.id);
        });
        const target = candidates[0];
        if (!target) {
            break;
        }
        const full = stackMaxHealth(target, catalog);
        const need = frontDeficit(target, catalog);
        const spend = Math.min(pool, need);
        if (spend <= 0) {
            break;
        }
        const live = stacks.find((row) => row.id === target.id) ?? target;
        const healed = applyStackHeal(live, spend, full);
        if (healed.healed <= 0) {
            break;
        }
        pool -= healed.healed;
        totalHealed += healed.healed;
        stacks = stacks.map((row) => (row.id === live.id ? healed.stack : row));
        healKeys.push(occupancyKey(live.q, live.r));
        healLines.push(`Cleric: healed ${stackLabel(catalog, healed.stack)} for ${healed.healed}.`);
    }
    if (totalHealed <= 0) {
        return { battle, lines: [], healKeys: [] };
    }
    return {
        battle: { ...battle, stacks },
        lines: [
            `Cleric: Temple grace restores ${totalHealed} HP (pool ${Math.floor(statValue)}×${stackCount} stacks).`,
            ...healLines,
        ],
        healKeys: [...new Set(healKeys)],
    };
}
/**
 * Cleric end-of-battle: 1% chance to fully resurrect one Temple stack that
 * took casualties. Heal pool runs at end of round instead.
 */
export function applyClericEndOfBattlePassive(battle, catalog, hero, side, opening, random = Math.random) {
    if (!isHeroClass(catalog, hero, 'Cleric') || !hero) {
        return { battle, lines: [] };
    }
    const stats = requirePassiveStats(catalog, hero, 'Cleric end of battle');
    if (!stats) {
        return { battle, lines: [] };
    }
    const rezTown = passiveStatString(stats, 'rez_town_filter');
    const rezChance = passiveStatNumber(stats, 'rez_chance_pct');
    if (rezChance == null) {
        missingPassiveStatKey(catalog, hero, 'rez_chance_pct', 'Cleric rez');
        return { battle, lines: [] };
    }
    if (rezChance <= 0 || random() * 100 >= rezChance) {
        return { battle, lines: [] };
    }
    const eligible = opening.filter((row) => {
        if (row.side !== side || row.qty <= 0) {
            return false;
        }
        if (!matchesTownFilter(catalog, row.unitId, rezTown ?? 'Temple')) {
            return false;
        }
        return liveQtyForOpening(battle, row) < row.qty;
    });
    if (eligible.length === 0) {
        return { battle, lines: [] };
    }
    const pick = eligible[Math.min(eligible.length - 1, Math.floor(random() * eligible.length))];
    return fullResurrectTempleStack(battle, catalog, pick);
}
function fullResurrectTempleStack(battle, catalog, opening) {
    const fullHp = Math.max(1, unitById(catalog, opening.unitId)?.health ?? 1);
    const name = unitById(catalog, opening.unitId)?.name ?? 'unit';
    const live = battle.stacks.find((row) => row.id === opening.id);
    if (live && live.qty > 0) {
        const restored = {
            ...live,
            qty: opening.qty,
            topHealth: fullHp,
            startingQty: Math.max(live.startingQty, opening.qty),
        };
        return {
            battle: {
                ...battle,
                stacks: battle.stacks.map((row) => row.id === live.id ? restored : row),
            },
            lines: [
                `Cleric: fully resurrected ${opening.qty} ${name} (was ${live.qty}).`,
            ],
        };
    }
    const tomb = (battle.tombstones ?? []).find((row) => row.id === opening.id) ??
        (battle.tombstones ?? []).find((row) => row.side === opening.side &&
            row.slot === opening.slot &&
            row.unitId === opening.unitId);
    if (tomb) {
        const raised = stackFromTombstone(tomb, catalog, opening.qty);
        const restored = {
            ...raised,
            qty: opening.qty,
            topHealth: fullHp,
            startingQty: Math.max(tomb.startingQty, opening.qty),
            hasActedThisRound: true,
        };
        let next = removeTombstone(battle, tomb.id);
        next = { ...next, stacks: [...next.stacks, restored] };
        return {
            battle: next,
            lines: [
                `Cleric: fully resurrected ${opening.qty} ${name} from the fallen.`,
            ],
        };
    }
    const restored = {
        id: opening.id,
        side: opening.side,
        slot: opening.slot,
        unitId: opening.unitId,
        qty: opening.qty,
        topHealth: fullHp,
        startingQty: opening.qty,
        q: 0,
        r: 0,
        hasActedThisRound: true,
        retaliationsLeft: 0,
    };
    return {
        battle: { ...battle, stacks: [...battle.stacks, restored] },
        lines: [`Cleric: fully resurrected ${opening.qty} ${name}.`],
    };
}
/**
 * Paladin end-of-round execute — retained but unused (S7-1). Kept for restore.
 */
export function applyPaladinPooledExecute(battle, catalog, heroes, side) {
    const hero = heroForSide(side, heroes);
    if (!isHeroClass(catalog, hero, 'Paladin') || !hero) {
        return { battle, lines: [], hitKeys: [] };
    }
    let templeCount = 0;
    for (const stack of battle.stacks) {
        if (stack.side === side &&
            stack.qty > 0 &&
            !isHeroStack(stack) &&
            isTempleUnit(catalog, stack.unitId)) {
            templeCount += stack.qty;
        }
    }
    const intel = passiveStatSourceValue(catalog, hero, 'INT');
    let pool = Math.max(0, Math.floor(intel * templeCount));
    if (pool <= 0) {
        return { battle, lines: [], hitKeys: [] };
    }
    let stacks = [...battle.stacks];
    let unitDeaths = { ...(battle.unitDeaths ?? {}) };
    const lines = [];
    const hitKeys = [];
    let kills = 0;
    while (pool > 0) {
        const candidates = stacks
            .filter((row) => row.side !== side && isDamagedCreature(row, catalog))
            .sort((a, b) => {
            const da = frontDeficit(a, catalog);
            const db = frontDeficit(b, catalog);
            if (db !== da) {
                return db - da;
            }
            if (a.topHealth !== b.topHealth) {
                return a.topHealth - b.topHealth;
            }
            return a.id.localeCompare(b.id);
        });
        const target = candidates[0];
        if (!target) {
            break;
        }
        const live = stacks.find((row) => row.id === target.id) ?? target;
        const spend = Math.max(1, live.topHealth);
        if (spend > pool) {
            break;
        }
        const full = stackMaxHealth(live, catalog);
        const applied = applyStackDamage(live, spend, full, false);
        pool -= spend;
        kills += applied.killed;
        unitDeaths = mergeUnitDeaths(unitDeaths, live.unitId, applied.killed);
        hitKeys.push(occupancyKey(live.q, live.r));
        const name = unitById(catalog, live.unitId)?.name ?? 'unit';
        if (applied.stack == null || applied.stack.qty <= 0) {
            stacks = stacks.filter((row) => row.id !== live.id);
            lines.push(`Paladin: smote the last of ${name}.`);
        }
        else {
            stacks = stacks.map((row) => row.id === live.id ? applied.stack : row);
            lines.push(`Paladin: executed 1 ${name} (${applied.stack.qty} remain).`);
        }
    }
    if (kills <= 0) {
        return { battle, lines: [], hitKeys: [] };
    }
    const synced = syncTombstonesFromWipes(battle, { ...battle, stacks, unitDeaths }, catalog);
    return {
        battle: synced,
        lines: [
            `Paladin: Temple judgment claims ${kills} enem${kills === 1 ? 'y' : 'ies'} (pool ${Math.floor(intel)}×${templeCount}).`,
            ...lines,
        ],
        hitKeys: [...new Set(hitKeys)],
    };
}
/** End-of-round Temple: Cleric heal pool when heal_timing is end_of_round. */
export function applyTempleEndOfRoundPassives(battle, catalog, heroes) {
    let next = battle;
    const lines = [];
    const healKeys = [];
    for (const side of ['atk', 'def']) {
        const hero = heroForSide(side, heroes);
        if (!isHeroClass(catalog, hero, 'Cleric') || !hero) {
            continue;
        }
        const stats = requirePassiveStats(catalog, hero, 'Cleric heal timing');
        const timing = (passiveStatString(stats, 'heal_timing') ?? 'end_of_round')
            .trim()
            .toLowerCase();
        // heal_timing must be live-read — do not hardcode the call site alone.
        if (timing !== 'end_of_round') {
            continue;
        }
        const healed = applyClericHealPool(next, catalog, hero, side);
        next = healed.battle;
        lines.push(...healed.lines);
        healKeys.push(...healed.healKeys);
    }
    return {
        battle: next,
        lines,
        hitKeys: [],
        healKeys: [...new Set(healKeys)],
    };
}
/**
 * High Priestess: after a kill-triggering attack, fully heal the single
 * most-injured Temple stack on the attacker's side (once per attack).
 * HP top-off only — never restores quantity / revives dead creatures.
 */
export function applyHighPriestessHealOnKill(stacks, attacker, catalog) {
    const candidates = stacks
        .filter((row) => row.side === attacker.side &&
        row.qty > 0 &&
        !isHeroStack(row) &&
        !row.indestructible &&
        isTempleUnit(catalog, row.unitId) &&
        isCreatureArmyUnit(unitById(catalog, row.unitId)) &&
        frontDeficit(row, catalog) > 0)
        .sort((a, b) => {
        const da = frontDeficit(a, catalog);
        const db = frontDeficit(b, catalog);
        if (db !== da) {
            return db - da;
        }
        return a.id.localeCompare(b.id);
    });
    const target = candidates[0];
    if (!target) {
        return { stacks, lines: [], healKeys: [] };
    }
    const full = stackMaxHealth(target, catalog);
    const need = frontDeficit(target, catalog);
    const healed = applyStackHeal(target, need, full);
    if (healed.healed <= 0) {
        return { stacks, lines: [], healKeys: [] };
    }
    const name = unitById(catalog, healed.stack.unitId)?.name ?? 'unit';
    return {
        stacks: stacks.map((row) => row.id === target.id ? healed.stack : row),
        lines: [`High Priestess: ${healed.stack.qty} ${name} heal to full.`],
        healKeys: [occupancyKey(target.q, target.r)],
    };
}
/**
 * Divine Aura Master: +1 effective attack qty per Temple ally stack within
 * aura radius (not including self). Stack size does not matter — each stack
 * contributes a flat +1.
 */
export function auraExtraQty(attacker, stacks, catalog, radius) {
    if (radius < 1) {
        return 0;
    }
    let extra = 0;
    for (const row of stacks) {
        if (row.id === attacker.id ||
            row.side !== attacker.side ||
            row.qty <= 0 ||
            isHeroStack(row) ||
            !isTempleUnit(catalog, row.unitId) ||
            !isCreatureArmyUnit(unitById(catalog, row.unitId))) {
            continue;
        }
        const dist = hexDistance({ q: attacker.q, r: attacker.r }, { q: row.q, r: row.r });
        if (dist <= radius) {
            extra += 1;
        }
    }
    return extra;
}
/** Battlefield hex keys inside an aura radius (inclusive of the caster hex). */
export function auraRadiusHexKeys(center, radius, tiles) {
    if (radius < 1) {
        return [];
    }
    const keys = [];
    for (const tile of tiles) {
        if (hexDistance(center, { q: tile.q, r: tile.r }) <= radius) {
            keys.push(occupancyKey(tile.q, tile.r));
        }
    }
    return keys;
}
