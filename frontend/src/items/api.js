export async function rollItemsFromServer(count, seed, rarityId) {
    const params = new URLSearchParams({
        count: String(count),
        seed: String(seed),
    });
    if (rarityId != null && rarityId > 0) {
        params.set('rarityId', String(rarityId));
    }
    const response = await fetch(`/api/items/roll?${params}`);
    if (!response.ok) {
        throw new Error(`Item roll failed (${response.status})`);
    }
    return (await response.json());
}
export async function rollDebugItemsFromServer(count, seed, rarityId) {
    const params = new URLSearchParams({
        count: String(count),
        seed: String(seed),
    });
    if (rarityId != null && rarityId > 0) {
        params.set('rarityId', String(rarityId));
    }
    const response = await fetch(`/api/debug/items/roll?${params}`);
    if (!response.ok) {
        throw new Error(`Debug item roll failed (${response.status})`);
    }
    return (await response.json());
}
export function apiItemToRolled(row, uid) {
    return {
        uid,
        itemId: row.itemId,
        rarityId: row.rarityId,
        adjId: row.adjId,
        variation: row.variation,
        stats: row.stats.map((line) => ({
            statId: line.statId,
            amt: line.amt,
        })),
    };
}
