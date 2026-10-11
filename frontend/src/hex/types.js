function numericId(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return undefined;
}
const MARKER_TO_RESOURCE_ID = {
    g: 1,
    w: 2,
    o: 3,
    i: 4,
    c: 5,
    s: 6,
    a: 7,
    e: 8,
    n: 9,
    b: 10,
};
function resourceIdFromMarker(marker) {
    if (!marker) {
        return undefined;
    }
    return MARKER_TO_RESOURCE_ID[marker.trim().toLowerCase()];
}
/** Accept camelCase, snake_case, a numeric resource field, or the map marker. */
export function mapObjectResourceId(obj) {
    const extra = obj;
    return (numericId(obj.resourceId) ??
        numericId(extra.resource_id) ??
        numericId(extra.resource) ??
        resourceIdFromMarker(obj.marker));
}
export function mapObjectTownTypeId(obj) {
    const extra = obj;
    return numericId(obj.townTypeId) ?? numericId(extra.town_type_id);
}
export function mapObjectChestLevel(obj) {
    const extra = obj;
    return numericId(obj.level) ?? numericId(extra.Level);
}
export function mapObjectChestItem(obj) {
    const raw = obj.chestItem ??
        obj.chest_item;
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const itemId = numericId(raw.itemId);
    const rarityId = numericId(raw.rarityId);
    const variation = numericId(raw.variation) ?? 1;
    if (itemId == null || rarityId == null) {
        return null;
    }
    const stats = [];
    const statsRaw = raw.stats;
    if (Array.isArray(statsRaw)) {
        for (const line of statsRaw) {
            const statId = numericId(line?.statId);
            const amt = numericId(line?.amt);
            if (statId != null && amt != null) {
                stats.push({ statId, amt });
            }
        }
    }
    const adjId = numericId(raw.adjId) ?? null;
    return {
        itemId,
        rarityId,
        adjId,
        variation,
        stats,
    };
}
export function mapObjectChestLoot(obj) {
    const raw = obj.loot;
    if (!Array.isArray(raw)) {
        return [];
    }
    const out = [];
    for (const entry of raw) {
        const rec = entry;
        const resourceId = numericId(rec.resourceId) ?? numericId(rec.resource_id);
        const qty = numericId(rec.qty);
        if (resourceId == null || qty == null || qty <= 0) {
            continue;
        }
        out.push({ resource_id: resourceId, qty });
    }
    return out;
}
export function mapObjectGuard(obj) {
    const extra = obj;
    const q = numericId(obj.guardQ) ?? numericId(extra.guard_q);
    const r = numericId(obj.guardR) ?? numericId(extra.guard_r);
    if (q == null || r == null) {
        return null;
    }
    return { q, r };
}
export function mapObjectSignTextId(obj) {
    const extra = obj;
    return numericId(obj.signTextId) ?? numericId(extra.sign_text_id);
}
export function mapObjectAbilityIds(obj) {
    const extra = obj;
    const raw = obj.abilityIds ?? extra.ability_ids;
    if (!Array.isArray(raw)) {
        return [];
    }
    const out = [];
    for (const entry of raw) {
        const id = numericId(entry);
        if (id != null && id > 0) {
            out.push(id);
        }
    }
    return out;
}
export function mapObjectLaunch(obj) {
    const extra = obj;
    const q = numericId(obj.launchQ) ?? numericId(extra.launch_q);
    const r = numericId(obj.launchR) ?? numericId(extra.launch_r);
    if (q == null || r == null) {
        return null;
    }
    return { q, r };
}
export function mapObjectLinkedTown(obj) {
    const extra = obj;
    const q = numericId(obj.linkedTownQ) ?? numericId(extra.linked_town_q);
    const r = numericId(obj.linkedTownR) ?? numericId(extra.linked_town_r);
    if (q == null || r == null) {
        return null;
    }
    return { q, r };
}
