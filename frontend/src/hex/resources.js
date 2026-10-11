import { getCachedCatalog, startingStockpileFor } from '../town/catalog';
/**
 * Marker letters by resource id. Keep in sync with `resource` table /
 * Heroes_Schema confirmed ids (1=Gold, 5=Aether, 6=Amber, 7=Brimstone,
 * 8=Crystal, 9=Ichor, 10=Tar).
 */
const MARKERS_BY_ID = {
    1: 'G',
    5: 'E',
    6: 'A',
    7: 'B',
    8: 'C',
    9: 'I',
    10: 'T',
};
export const GOLD_RESOURCE_ID = 1;
/** Fallback before catalog load — names/ids match the live `resource` table. */
const FALLBACK_RESOURCES = [
    { id: 1, name: 'Gold', marker: 'G' },
    { id: 5, name: 'Aether', marker: 'E' },
    { id: 6, name: 'Amber', marker: 'A' },
    { id: 7, name: 'Brimstone', marker: 'B' },
    { id: 8, name: 'Crystal', marker: 'C' },
    { id: 9, name: 'Ichor', marker: 'I' },
    { id: 10, name: 'Tar', marker: 'T' },
];
/** Live binding: catalog load replaces names from the resource table. */
export let RESOURCES = FALLBACK_RESOURCES;
/** Neutral / unclaimed mine and pickup marker fill. */
export const NEUTRAL_OBJECT_COLOR = 0x9e9e9e;
export function applyResourceCatalog(rows) {
    const next = rows
        .filter((row) => Number.isInteger(row.id) && typeof row.name === 'string' && row.name)
        .sort((a, b) => a.id - b.id)
        .map((row) => ({
        id: row.id,
        name: row.name,
        marker: MARKERS_BY_ID[row.id] ?? row.name.charAt(0).toUpperCase(),
    }));
    if (next.length > 0) {
        RESOURCES = next;
    }
}
export function resourceById(id) {
    return RESOURCES.find((resource) => resource.id === id);
}
/**
 * Resolve a cost JSONB key to `resource.id`.
 * Prefer numeric id keys (`"1"`, `"6"`) — same shape as `building.cost` /
 * `unit.cost`. Name keys remain accepted for legacy rows.
 */
export function costKeyToResourceId(key) {
    const trimmed = key.trim();
    if (!trimmed) {
        return null;
    }
    const asNumber = Number(trimmed);
    if (Number.isInteger(asNumber) && asNumber > 0) {
        return asNumber;
    }
    const byName = RESOURCES.find((resource) => resource.name.toLowerCase() === trimmed.toLowerCase());
    return byName ? byName.id : null;
}
export function emptyWallet() {
    const wallet = {};
    const catalog = getCachedCatalog();
    for (const resource of RESOURCES) {
        wallet[resource.id] = {
            weeklyIncome: 0,
            stockpile: startingStockpileFor(catalog, resource),
        };
    }
    return wallet;
}
/** Thousands separators for any displayed resource quantity. */
export function formatAmount(n) {
    return Math.round(n).toLocaleString('en-US');
}
export function formatResourceLine(resource, entry) {
    const weekly = entry?.weeklyIncome ?? 0;
    const stockpile = entry?.stockpile ?? 0;
    return `${resource.name} (${formatAmount(weekly)}/wk) ${formatAmount(stockpile)}`;
}
export function formatResourceLines(wallet) {
    return RESOURCES.map((resource) => formatResourceLine(resource, wallet[resource.id]));
}
export function isKnownResourceId(id) {
    return typeof id === 'number' && RESOURCES.some((resource) => resource.id === id);
}
export function snapshotWallet(wallet) {
    const next = emptyWallet();
    for (const resource of RESOURCES) {
        const entry = wallet[resource.id];
        if (entry) {
            next[resource.id] = { ...entry };
        }
    }
    return next;
}
export function canAfford(wallet, cost) {
    for (const [key, amount] of Object.entries(cost)) {
        const id = costKeyToResourceId(key);
        const resource = id != null ? resourceById(id) : undefined;
        if (id == null || !resource) {
            return `Unknown resource in cost: ${key}`;
        }
        const have = wallet[id]?.stockpile ?? 0;
        if (have < amount) {
            return `Not enough ${resource.name} (need ${formatAmount(amount)}, have ${formatAmount(have)})`;
        }
    }
    return null;
}
export function deductCost(wallet, cost) {
    const next = snapshotWallet(wallet);
    for (const [key, amount] of Object.entries(cost)) {
        const id = costKeyToResourceId(key);
        if (id != null && next[id]) {
            next[id].stockpile -= amount;
        }
    }
    return next;
}
