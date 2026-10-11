import { unitById, unitHasTag } from '../town/catalog';
import { TAG_FACTION_CITADEL, unitHasNamedTag } from '../town/unitTags';
import { missingPassiveStatKey, passiveStatNumber, passiveStatSourceValue, passiveStatString, requirePassiveStats, } from '../town/heroPassiveStats';
/** unit_tag.id — Humanoid (Citadel Knight/Monk scale; reusable). */
export const HUMANOID_TAG = 2;
/**
 * Sum stack quantities with `tagId` on one side (or both when `side` omitted).
 * Heroes are skipped; only tagged creature stacks count.
 */
export function countUnitsWithTag(stacks, catalog, tagId, side) {
    let total = 0;
    for (const stack of stacks) {
        if (side != null && stack.side !== side) {
            continue;
        }
        if (stack.qty <= 0 || stack.heroId) {
            continue;
        }
        const unit = unitById(catalog, stack.unitId);
        if (!unitHasTag(unit, tagId)) {
            continue;
        }
        total += stack.qty;
    }
    return total;
}
/** Snapshot tag counts for both sides — call once when the battle opens. */
export function freezeArmyTagCounts(stacks, catalog, tagIds) {
    const out = {};
    for (const tagId of tagIds) {
        out[tagId] = {
            atk: countUnitsWithTag(stacks, catalog, tagId, 'atk'),
            def: countUnitsWithTag(stacks, catalog, tagId, 'def'),
        };
    }
    return out;
}
export function frozenTagCount(counts, tagId, side) {
    return Math.max(0, counts?.[tagId]?.[side] ?? 0);
}
export function isCitadelUnit(catalog, unitId) {
    const unit = unitById(catalog, unitId);
    if (!unit?.town_id) {
        return false;
    }
    return unitHasNamedTag(catalog, unit, TAG_FACTION_CITADEL);
}
function tagIdByFilterName(catalog, name) {
    if (!name) {
        return null;
    }
    const needle = name.trim().toLowerCase();
    return (catalog.unit_tag.find((row) => row.value.trim().toLowerCase() === needle)
        ?.id ?? null);
}
/**
 * Citadel passives: min(humanoids × per_unit_pct, stat × cap_multiplier).
 * Constants from hero_type.passive_stats (BR S7-2).
 */
export function citadelHumanoidChancePct(catalog, hero, humanoidCount) {
    if (!hero) {
        return 0;
    }
    const stats = requirePassiveStats(catalog, hero, 'citadel chance');
    if (!stats) {
        return 0;
    }
    const per = passiveStatNumber(stats, 'per_unit_pct');
    const capMult = passiveStatNumber(stats, 'cap_multiplier');
    if (per == null) {
        missingPassiveStatKey(catalog, hero, 'per_unit_pct', 'citadel chance');
        return 0;
    }
    if (capMult == null) {
        missingPassiveStatKey(catalog, hero, 'cap_multiplier', 'citadel chance');
        return 0;
    }
    const source = passiveStatString(stats, 'stat_source');
    const statValue = passiveStatSourceValue(catalog, hero, source ?? 'STR');
    const raw = Math.max(0, humanoidCount * per);
    const cap = Math.max(0, statValue * capMult);
    return Math.min(raw, cap);
}
/** Tag id for Knight/Monk unit_filter (default Humanoid when key absent). */
export function citadelPassiveUnitTagId(catalog, hero) {
    const stats = hero ? requirePassiveStats(catalog, hero, 'citadel unit_filter') : null;
    const filter = passiveStatString(stats, 'unit_filter');
    const fromFilter = tagIdByFilterName(catalog, filter);
    if (fromFilter != null) {
        return fromFilter;
    }
    if (hero && filter == null) {
        missingPassiveStatKey(catalog, hero, 'unit_filter', 'citadel unit_filter');
    }
    return HUMANOID_TAG;
}
export function knightCapPctStat(catalog, hero) {
    const stats = hero ? requirePassiveStats(catalog, hero, 'knight cap') : null;
    const n = passiveStatNumber(stats, 'cap_multiplier');
    if (n == null && hero) {
        missingPassiveStatKey(catalog, hero, 'cap_multiplier', 'knight cap');
    }
    return n ?? 0;
}
export function monkCapPctStat(catalog, hero) {
    const stats = hero ? requirePassiveStats(catalog, hero, 'monk cap') : null;
    const n = passiveStatNumber(stats, 'cap_multiplier');
    if (n == null && hero) {
        missingPassiveStatKey(catalog, hero, 'cap_multiplier', 'monk cap');
    }
    return n ?? 0;
}
