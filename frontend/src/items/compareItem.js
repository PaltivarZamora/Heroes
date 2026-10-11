import { rolledItemSlotTypeId } from './display';
/** `item` stat amt minus the item currently equipped in the same slot (0 if empty). */
export function compareItem(catalog, hero, item) {
    const slotId = rolledItemSlotTypeId(catalog, item);
    const worn = slotId != null ? (hero.equipment[slotId] ?? null) : null;
    const wornAmt = new Map();
    if (worn) {
        for (const line of worn.stats) {
            wornAmt.set(line.statId, line.amt);
        }
    }
    const deltas = {};
    for (const line of item.stats) {
        deltas[line.statId] = line.amt - (wornAmt.get(line.statId) ?? 0);
    }
    return deltas;
}
/** Stats present on the worn piece but not on `item` (for swap preview). */
export function wornOnlyStatLines(catalog, hero, item) {
    const slotId = rolledItemSlotTypeId(catalog, item);
    const worn = slotId != null ? (hero.equipment[slotId] ?? null) : null;
    if (!worn || worn.uid === item.uid) {
        return [];
    }
    const onItem = new Set(item.stats.map((row) => row.statId));
    return worn.stats.filter((row) => !onItem.has(row.statId));
}
