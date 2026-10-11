import { equippedItemBonuses } from './bonuses';
import { energyRegenStatId, heroColumnForStatKey, isStatGroup, manaRegenStatId, statById, statGroupMembers, } from '../town/statCatalog';
import { itemTypeById } from './itemCatalog';
import { rolledItemDisplayName, rolledItemRarityColor, } from './display';
import { EQUIPMENT_SLOT_IDS } from './types';
import { compareItem, wornOnlyStatLines } from './compareItem';
export function inventorySlotTypeName(catalog, slotId) {
    return itemTypeById(catalog, slotId)?.name ?? `Slot ${slotId}`;
}
export function inventoryEmptySlotTooltip(catalog, slotId) {
    const row = itemTypeById(catalog, slotId);
    const desc = row?.description?.trim();
    if (desc) {
        return desc;
    }
    return row?.name ?? `Slot ${slotId}`;
}
function formatSignedStat(amt, name) {
    if (amt === 0) {
        return `-- ${name}`;
    }
    const sign = amt > 0 ? '+' : '';
    return `${sign}${amt} ${name}`;
}
function bonusForStatId(catalog, bonuses, statId) {
    const stat = statById(catalog, statId);
    if (!stat) {
        return 0;
    }
    const column = heroColumnForStatKey(stat.key);
    if (column) {
        return bonuses.hero[column] ?? 0;
    }
    const manaRegenId = manaRegenStatId(catalog);
    const energyRegenId = energyRegenStatId(catalog);
    if (manaRegenId != null && statId === manaRegenId) {
        return bonuses.manaRegen;
    }
    if (energyRegenId != null && statId === energyRegenId) {
        return bonuses.energyRegen;
    }
    return 0;
}
const groupedMemberIds = (catalog) => {
    const ids = new Set();
    for (const row of catalog.stat) {
        if (isStatGroup(row)) {
            for (const id of row.tags) {
                ids.add(id);
            }
        }
    }
    return ids;
};
/** Summary stat lines (equipped totals) in catalog `sort_order`. */
export function equippedSummaryStatLines(catalog, hero) {
    const bonuses = equippedItemBonuses(catalog, hero);
    const members = groupedMemberIds(catalog);
    const rows = [...catalog.stat].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    const lines = [];
    for (const row of rows) {
        if (isStatGroup(row)) {
            const parts = statGroupMembers(catalog, row).map((member) => formatSignedStat(bonusForStatId(catalog, bonuses, member.id), member.name));
            if (parts.length > 0) {
                lines.push(parts.join(', '));
            }
            continue;
        }
        if (members.has(row.id)) {
            continue;
        }
        lines.push(formatSignedStat(bonusForStatId(catalog, bonuses, row.id), row.name));
    }
    return lines;
}
export function inventoryItemDetailLines(catalog, hero, item, withCompare) {
    const deltas = withCompare ? compareItem(catalog, hero, item) : {};
    const lines = [];
    for (const line of item.stats) {
        const stat = statById(catalog, line.statId);
        const name = stat?.name ?? `Stat ${line.statId}`;
        const left = formatSignedStat(line.amt, name);
        if (!withCompare) {
            lines.push({ left, compare: null, compareTone: null });
            continue;
        }
        const delta = deltas[line.statId] ?? 0;
        if (delta === 0) {
            lines.push({ left, compare: null, compareTone: null });
            continue;
        }
        const sign = delta > 0 ? '+' : '';
        lines.push({
            left,
            compare: `(${sign}${delta})`,
            compareTone: delta > 0 ? 'gain' : 'loss',
        });
    }
    if (withCompare) {
        for (const row of wornOnlyStatLines(catalog, hero, item)) {
            const stat = statById(catalog, row.statId);
            const name = stat?.name ?? `Stat ${row.statId}`;
            lines.push({
                left: `-- ${name}`,
                compare: `(-${row.amt})`,
                compareTone: 'loss',
            });
        }
    }
    return lines;
}
export function inventorySlotSummaryLines(catalog, hero) {
    return EQUIPMENT_SLOT_IDS.map((slotId) => {
        const item = hero.equipment[slotId] ?? null;
        const slotName = inventorySlotTypeName(catalog, slotId);
        if (!item) {
            return { text: `${slotName} - Empty` };
        }
        return {
            text: rolledItemDisplayName(catalog, item),
            color: rolledItemRarityColor(catalog, item),
        };
    });
}
