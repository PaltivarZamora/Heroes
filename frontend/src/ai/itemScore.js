import { heroPoolRegenProfile } from '../items/heroRegen';
import { aiCfgRaw } from '../town/catalog';
import { energyRegenStatId, heroColumnForStatKey, manaRegenStatId, statById, } from '../town/statCatalog';
import { rolledItemSlotTypeId } from '../items/display';
let warnedStatWeights = false;
function warnStatWeightsOnce() {
    if (!warnedStatWeights) {
        warnedStatWeights = true;
        console.warn('[ai-items] ai_config.ai_item_stat_weight missing');
    }
}
function aiItemStatWeight(catalog, statId) {
    const raw = aiCfgRaw(catalog, 'ai_item_stat_weight');
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
        warnStatWeightsOnce();
        return 1;
    }
    const rec = raw;
    const w = rec[String(statId)] ?? rec[statId];
    const n = Number(w);
    return Number.isFinite(n) ? n : 1;
}
export function statUsefulToHero(catalog, hero, statId) {
    const profile = heroPoolRegenProfile(catalog, hero);
    const manaRegenId = manaRegenStatId(catalog);
    const energyRegenId = energyRegenStatId(catalog);
    if (manaRegenId != null && statId === manaRegenId) {
        return profile.mana;
    }
    if (energyRegenId != null && statId === energyRegenId) {
        return profile.energy;
    }
    const stat = statById(catalog, statId);
    if (!stat) {
        return false;
    }
    const column = heroColumnForStatKey(stat.key);
    if (column === 'strength') {
        return profile.energy;
    }
    if (column === 'intel') {
        return profile.mana;
    }
    return column != null;
}
/** BR S9-44 — weighted sum over useful stats on a hero-owned item. */
export function scoreItemForHero(catalog, hero, item) {
    let total = 0;
    for (const line of item.stats) {
        if (!statUsefulToHero(catalog, hero, line.statId)) {
            continue;
        }
        total += line.amt * aiItemStatWeight(catalog, line.statId);
    }
    return total;
}
export function itemSlotUpgradeGain(catalog, hero, item) {
    const slotId = rolledItemSlotTypeId(catalog, item);
    if (slotId == null) {
        return 0;
    }
    const worn = hero.equipment[slotId];
    const nextScore = scoreItemForHero(catalog, hero, item);
    const wornScore = worn ? scoreItemForHero(catalog, hero, worn) : 0;
    if (nextScore <= wornScore) {
        return 0;
    }
    return nextScore - wornScore;
}
