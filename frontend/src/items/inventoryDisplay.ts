import { equippedItemBonuses } from './bonuses'
import type { Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import {
  energyRegenStatId,
  heroColumnForStatKey,
  isStatGroup,
  manaRegenStatId,
  statById,
  statGroupMembers,
} from '../town/statCatalog'
import { itemTypeById } from './itemCatalog'
import {
  rolledItemDisplayName,
  rolledItemRarityColor,
} from './display'
import type { RolledItem } from './types'
import { EQUIPMENT_SLOT_IDS } from './types'
import { compareItem, wornOnlyStatLines } from './compareItem'

export function inventorySlotTypeName(
  catalog: ReferenceCatalog,
  slotId: number,
): string {
  return itemTypeById(catalog, slotId)?.name ?? `Slot ${slotId}`
}

export function inventoryEmptySlotTooltip(
  catalog: ReferenceCatalog,
  slotId: number,
): string {
  const row = itemTypeById(catalog, slotId)
  const desc = row?.description?.trim()
  if (desc) {
    return desc
  }
  return row?.name ?? `Slot ${slotId}`
}

function formatSignedStat(amt: number, name: string): string {
  if (amt === 0) {
    return `-- ${name}`
  }
  const sign = amt > 0 ? '+' : ''
  return `${sign}${amt} ${name}`
}

function bonusForStatId(
  catalog: ReferenceCatalog,
  bonuses: ReturnType<typeof equippedItemBonuses>,
  statId: number,
): number {
  const stat = statById(catalog, statId)
  if (!stat) {
    return 0
  }
  const column = heroColumnForStatKey(stat.key)
  if (column) {
    return bonuses.hero[column] ?? 0
  }
  const manaRegenId = manaRegenStatId(catalog)
  const energyRegenId = energyRegenStatId(catalog)
  if (manaRegenId != null && statId === manaRegenId) {
    return bonuses.manaRegen
  }
  if (energyRegenId != null && statId === energyRegenId) {
    return bonuses.energyRegen
  }
  return 0
}

const groupedMemberIds = (catalog: ReferenceCatalog): Set<number> => {
  const ids = new Set<number>()
  for (const row of catalog.stat) {
    if (isStatGroup(row)) {
      for (const id of row.tags) {
        ids.add(id)
      }
    }
  }
  return ids
}

/** Summary stat lines (equipped totals) in catalog `sort_order`. */
export function equippedSummaryStatLines(
  catalog: ReferenceCatalog,
  hero: Hero,
): string[] {
  const bonuses = equippedItemBonuses(catalog, hero)
  const members = groupedMemberIds(catalog)
  const rows = [...catalog.stat].sort(
    (a, b) => a.sort_order - b.sort_order || a.id - b.id,
  )
  const lines: string[] = []
  for (const row of rows) {
    if (isStatGroup(row)) {
      const parts = statGroupMembers(catalog, row).map((member) =>
        formatSignedStat(
          bonusForStatId(catalog, bonuses, member.id),
          member.name,
        ),
      )
      if (parts.length > 0) {
        lines.push(parts.join(', '))
      }
      continue
    }
    if (members.has(row.id)) {
      continue
    }
    lines.push(
      formatSignedStat(bonusForStatId(catalog, bonuses, row.id), row.name),
    )
  }
  return lines
}

export type InventoryDetailStatLine = {
  left: string
  compare: string | null
  compareTone: 'gain' | 'loss' | null
}

export function inventoryItemDetailLines(
  catalog: ReferenceCatalog,
  hero: Hero,
  item: RolledItem,
  withCompare: boolean,
): InventoryDetailStatLine[] {
  const deltas = withCompare ? compareItem(catalog, hero, item) : {}
  const lines: InventoryDetailStatLine[] = []
  for (const line of item.stats) {
    const stat = statById(catalog, line.statId)
    const name = stat?.name ?? `Stat ${line.statId}`
    const left = formatSignedStat(line.amt, name)
    if (!withCompare) {
      lines.push({ left, compare: null, compareTone: null })
      continue
    }
    const delta = deltas[line.statId] ?? 0
    if (delta === 0) {
      lines.push({ left, compare: null, compareTone: null })
      continue
    }
    const sign = delta > 0 ? '+' : ''
    lines.push({
      left,
      compare: `(${sign}${delta})`,
      compareTone: delta > 0 ? 'gain' : 'loss',
    })
  }
  if (withCompare) {
    for (const row of wornOnlyStatLines(catalog, hero, item)) {
      const stat = statById(catalog, row.statId)
      const name = stat?.name ?? `Stat ${row.statId}`
      lines.push({
        left: `-- ${name}`,
        compare: `(-${row.amt})`,
        compareTone: 'loss',
      })
    }
  }
  return lines
}

export function inventorySlotSummaryLines(
  catalog: ReferenceCatalog,
  hero: Hero,
): Array<{ text: string; color?: string }> {
  return EQUIPMENT_SLOT_IDS.map((slotId) => {
    const item = hero.equipment[slotId] ?? null
    const slotName = inventorySlotTypeName(catalog, slotId)
    if (!item) {
      return { text: `${slotName} - Empty` }
    }
    return {
      text: rolledItemDisplayName(catalog, item),
      color: rolledItemRarityColor(catalog, item),
    }
  })
}
