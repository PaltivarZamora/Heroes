import { applyFireGroundDamage } from './groundEffect';
import { applyMoatEntryDamage } from './moat';
/**
 * Moat + Fire/Storm. Call at turn-start, walk entry, and turn-end
 * (skip turn-end when walk entry already applied hazards this action).
 * Moat damage comes from ground_effect (siege stamp); Fire/Storm from zones.
 * Mud Sprite absorb growth is turn-start only — see applyTerrainGrowth.
 */
export function applyStandingHazards(battle, stackId, catalog, tiles, heroes, random = Math.random) {
    const moat = applyMoatEntryDamage(battle, stackId, catalog, tiles);
    const fire = applyFireGroundDamage(moat.battle, stackId, catalog, tiles, heroes, random);
    return {
        battle: fire.battle,
        lines: [...moat.lines, ...fire.lines],
        hitKeys: [...new Set([...moat.hitKeys, ...fire.hitKeys])],
        fireDamage: fire.damage,
        fireHits: fire.damage > 0 ? 1 : 0,
        fireKilled: fire.killed,
        fireLabel: fire.label,
        moatLines: moat.lines,
    };
}
