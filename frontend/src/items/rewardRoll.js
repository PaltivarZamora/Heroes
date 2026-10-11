import { mapCfg } from '../town/catalog';
import { apiItemToRolled, rollItemsFromServer } from './api';
import { allocateItemUid } from './state';
let warnedPct = false;
let warnedRarity = false;
function warnOnce(kind, message) {
    if (kind === 'pct' && !warnedPct) {
        warnedPct = true;
        console.warn(`[items] ${message}`);
    }
    if (kind === 'rarity' && !warnedRarity) {
        warnedRarity = true;
        console.warn(`[items] ${message}`);
    }
}
export function mapConfigRewardPct(catalog) {
    const raw = mapCfg(catalog, 'item_reward_pct');
    if (raw == null) {
        warnOnce('pct', 'map_config.item_reward_pct missing');
        return null;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
        warnOnce('pct', 'map_config.item_reward_pct not numeric');
        return null;
    }
    return n;
}
function parseWeightMap(raw) {
    const out = new Map();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return out;
    }
    for (const [key, value] of Object.entries(raw)) {
        const id = Number(key);
        const weight = Number(value);
        if (Number.isFinite(id) && id > 0 && Number.isFinite(weight) && weight > 0) {
            out.set(Math.floor(id), Math.floor(weight));
        }
    }
    return out;
}
export function rarityWeightsForTier(catalog, configKey, tier) {
    const raw = mapCfg(catalog, configKey);
    if (raw == null) {
        warnOnce('rarity', `map_config.${configKey} missing`);
        return null;
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        warnOnce('rarity', `map_config.${configKey} is not an object`);
        return null;
    }
    const tierKey = String(Math.max(1, Math.floor(tier)));
    const tierRaw = raw[tierKey];
    const weights = parseWeightMap(tierRaw);
    if (weights.size === 0) {
        return null;
    }
    return weights;
}
export function pickWeightedRarityId(rng, weights) {
    let sum = 0;
    for (const w of weights.values()) {
        sum += w;
    }
    if (sum <= 0) {
        return null;
    }
    let roll = rng() * sum;
    for (const [id, weight] of weights) {
        roll -= weight;
        if (roll < 0) {
            return id;
        }
    }
    return [...weights.keys()][0] ?? null;
}
export function rollItemRewardPct(rng, pct) {
    return rng() * 100 < pct;
}
export async function rollSessionItemReward(session, catalog, configKey, tier, rng = Math.random) {
    const pct = mapConfigRewardPct(catalog);
    if (pct == null || !rollItemRewardPct(rng, pct)) {
        return { session, item: null };
    }
    const weights = rarityWeightsForTier(catalog, configKey, tier);
    if (!weights) {
        return { session, item: null };
    }
    const rarityId = pickWeightedRarityId(rng, weights);
    if (rarityId == null) {
        return { session, item: null };
    }
    const seed = Math.floor(rng() * 0x7fffffff);
    const rolled = await rollItemsFromServer(1, seed, rarityId);
    const row = rolled.items[0];
    if (!row) {
        return { session, item: null };
    }
    const withUid = allocateItemUid(session);
    return {
        session: withUid.session,
        item: apiItemToRolled(row, withUid.uid),
    };
}
