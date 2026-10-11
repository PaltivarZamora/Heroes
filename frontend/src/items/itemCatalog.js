import { parseStatTags } from '../town/statCatalog';
function asInt(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : fallback;
}
export function asRarities(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .map((row) => {
        const rec = row;
        return {
            id: asInt(rec.id),
            name: String(rec.name ?? ''),
            color: String(rec.color ?? '#ffffff'),
            weight: asInt(rec.weight),
        };
    })
        .filter((row) => row.id > 0)
        .sort((a, b) => a.id - b.id);
}
export function asItemTypes(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .map((row) => {
        const rec = row;
        const desc = rec.description;
        return {
            id: asInt(rec.id),
            name: String(rec.name ?? ''),
            kind_id: asInt(rec.kind_id),
            stat_tags: parseStatTags(rec.stat_tags),
            description: desc == null || desc === '' ? null : String(desc),
        };
    })
        .filter((row) => row.id > 0);
}
export function asItemTemplates(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .map((row) => {
        const rec = row;
        const sub = rec.sub_cat_type_id;
        return {
            id: asInt(rec.id),
            name: String(rec.name ?? ''),
            slot_type_id: asInt(rec.slot_type_id),
            cat_type_id: asInt(rec.cat_type_id),
            sub_cat_type_id: sub == null || sub === '' ? null : asInt(sub) || null,
            variations: Math.max(1, asInt(rec.variations, 1)),
            image_path: String(rec.image_path ?? ''),
            flippable: Boolean(rec.flippable),
        };
    })
        .filter((row) => row.id > 0);
}
export function asItemAdjs(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .map((row) => {
        const rec = row;
        return {
            id: asInt(rec.id),
            name: String(rec.name ?? ''),
            tags: parseStatTags(rec.tags),
        };
    })
        .filter((row) => row.id > 0);
}
export function auditItemSlotTypes(catalog) {
    const slotIds = new Set(catalog.item_type.filter((row) => row.kind_id === 1).map((row) => row.id));
    for (const item of catalog.item) {
        if (!slotIds.has(item.slot_type_id)) {
            console.warn(`[items] item.id=${item.id} slot_type_id=${item.slot_type_id} is not a kind-1 slot row`);
        }
    }
}
export function itemTemplateById(catalog, itemId) {
    return catalog.item.find((row) => row.id === itemId);
}
export function itemTypeById(catalog, typeId) {
    return catalog.item_type.find((row) => row.id === typeId);
}
export function rarityById(catalog, rarityId) {
    return catalog.rarity.find((row) => row.id === rarityId);
}
export function itemAdjById(catalog, adjId) {
    if (adjId == null) {
        return undefined;
    }
    return catalog.item_adj.find((row) => row.id === adjId);
}
