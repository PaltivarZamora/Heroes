import { HERO_STAT_KEYS } from '../town/catalog';
import { energyRegenStatId, heroColumnForStatKey, manaRegenStatId, statById, } from '../town/statCatalog';
import { EQUIPMENT_SLOT_IDS } from './types';
function addHeroStat(target, key, amt) {
    target[key] = (target[key] ?? 0) + amt;
}
export function bonusesFromRolledItem(catalog, item) {
    const hero = {};
    let manaRegen = 0;
    let energyRegen = 0;
    const manaRegenId = manaRegenStatId(catalog);
    const energyRegenId = energyRegenStatId(catalog);
    for (const line of item.stats) {
        const stat = statById(catalog, line.statId);
        const column = stat ? heroColumnForStatKey(stat.key) : null;
        if (column) {
            addHeroStat(hero, column, line.amt);
            continue;
        }
        if (manaRegenId != null && line.statId === manaRegenId) {
            manaRegen += line.amt;
        }
        else if (energyRegenId != null && line.statId === energyRegenId) {
            energyRegen += line.amt;
        }
    }
    return { hero, manaRegen, energyRegen };
}
export function equippedItemBonuses(catalog, hero) {
    const heroBonus = {};
    let manaRegen = 0;
    let energyRegen = 0;
    for (const slotId of EQUIPMENT_SLOT_IDS) {
        const item = hero.equipment[slotId];
        if (!item) {
            continue;
        }
        const part = bonusesFromRolledItem(catalog, item);
        for (const key of HERO_STAT_KEYS) {
            const amt = part.hero[key];
            if (amt) {
                addHeroStat(heroBonus, key, amt);
            }
        }
        manaRegen += part.manaRegen;
        energyRegen += part.energyRegen;
    }
    return { hero: heroBonus, manaRegen, energyRegen };
}
export function mergeHeroStats(base, bonus) {
    const out = { ...base };
    for (const key of HERO_STAT_KEYS) {
        out[key] += bonus[key] ?? 0;
    }
    return out;
}
