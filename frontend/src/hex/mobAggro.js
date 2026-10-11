import { slotsArmyValue } from '../ai/armyAlloc';
import { mapCfgNumber } from '../town/catalog';
const NEIGHBORS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
];
function hexDistance(a, b) {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
function key(q, r) {
    return `${q},${r}`;
}
/** 0 turns ambushes off. Reads the difficulty-merged map config. */
export function mobAggroRange(catalog) {
    return Math.max(0, Math.floor(mapCfgNumber(catalog, 'mob_aggro_range', null, 1)));
}
export function mobAggroRatio(catalog) {
    return Math.max(0, mapCfgNumber(catalog, 'mob_aggro_ratio', null, 1.33));
}
/**
 * Aggressive when the mob's army value is at least the hero's times
 * `mob_aggro_ratio` (same qty × avg dmg × health as surrender).
 * Range 0 makes every mob passive.
 */
export function mobIsAggressive(session, catalog, hero, mob) {
    if (!catalog || mobAggroRange(catalog) <= 0) {
        return false;
    }
    const heroValue = slotsArmyValue(session, catalog, hero.army.slots_1_to_6);
    const mobValue = slotsArmyValue(session, catalog, mob.slots_1_to_6);
    return mobValue >= heroValue * mobAggroRatio(catalog);
}
/** Nearest aggressive mob whose ring contains `hex`, if the hero just entered it. */
export function ambushMobOnHex(session, catalog, hero, hex) {
    const range = mobAggroRange(catalog);
    if (!catalog || range <= 0) {
        return null;
    }
    let best = null;
    let bestDist = Infinity;
    for (const mob of session.mobs) {
        const dist = hexDistance(hex, mob.position);
        if (dist > range || !mobIsAggressive(session, catalog, hero, mob)) {
            continue;
        }
        if (dist < bestDist ||
            (dist === bestDist && best != null && mob.id < best.id)) {
            best = mob;
            bestDist = dist;
        }
    }
    return best;
}
/**
 * Path preview red: hex is inside an aggressive mob's ambush ring.
 * The path end is not red only when that hex is the deliberate approach to
 * `attackMob` (click-to-attack). Passive mobs never count.
 */
export function pathStepShowsAmbushDanger(session, catalog, hero, hex, opts) {
    const range = mobAggroRange(catalog);
    if (!catalog || range <= 0) {
        return false;
    }
    for (const mob of session.mobs) {
        if (!mobIsAggressive(session, catalog, hero, mob)) {
            continue;
        }
        if (hexDistance(hex, mob.position) > range) {
            continue;
        }
        if (opts?.isPathEnd && opts.attackMob?.id === mob.id) {
            continue;
        }
        return true;
    }
    return false;
}
/** Pathing ring is 1 hex, including the mob's own hex. Not the aggro range. */
export function mobPathRingKeys(session) {
    const keys = new Set();
    for (const mob of session.mobs) {
        keys.add(key(mob.position.q, mob.position.r));
        for (const step of NEIGHBORS) {
            keys.add(key(mob.position.q + step.q, mob.position.r + step.r));
        }
    }
    return keys;
}
