import type { ReferenceCatalog } from '../town/catalog'
import { statById } from '../town/statCatalog'
import {
  itemAdjById,
  itemTemplateById,
  itemTypeById,
  rarityById,
} from './itemCatalog'
import type { RolledItem } from './types'

export function itemVariationFileName(
  imagePath: string,
  variation: number,
): string {
  const trimmed = imagePath.trim()
  if (!trimmed) {
    return ''
  }
  const dot = trimmed.lastIndexOf('.')
  if (dot < 0) {
    return `${trimmed}_${variation}`
  }
  const base = trimmed.slice(0, dot)
  const ext = trimmed.slice(dot)
  return `${base}_${variation}${ext}`
}

export function itemImageUrl(slotFolder: string, fileName: string): string {
  const folder = slotFolder.trim()
  const file = fileName.trim()
  if (!folder || !file) {
    return ''
  }
  return `/assets/items/${folder}/${file}`
}

export function rolledItemDisplayName(
  catalog: ReferenceCatalog,
  item: RolledItem,
): string {
  const template = itemTemplateById(catalog, item.itemId)
  const base = template?.name ?? `Item ${item.itemId}`
  const adj = itemAdjById(catalog, item.adjId)
  if (!adj?.name) {
    return base
  }
  return `${adj.name} ${base}`
}

export function rolledItemRarityColor(
  catalog: ReferenceCatalog,
  item: RolledItem,
): string {
  return rarityById(catalog, item.rarityId)?.color ?? '#e8e8e8'
}

export function rolledItemRarityName(
  catalog: ReferenceCatalog,
  item: RolledItem,
): string {
  return rarityById(catalog, item.rarityId)?.name ?? `Rarity ${item.rarityId}`
}

export function rolledItemArtUrl(
  catalog: ReferenceCatalog,
  item: RolledItem,
): string {
  const template = itemTemplateById(catalog, item.itemId)
  if (!template) {
    return ''
  }
  const slot = itemTypeById(catalog, template.slot_type_id)
  const file = itemVariationFileName(template.image_path, item.variation)
  if (!slot?.name || !file) {
    return ''
  }
  return itemImageUrl(slot.name, file)
}

export function rolledItemPicturePath(
  catalog: ReferenceCatalog,
  item: RolledItem,
): string {
  const template = itemTemplateById(catalog, item.itemId)
  if (!template) {
    return ''
  }
  const slot = itemTypeById(catalog, template.slot_type_id)
  const file = itemVariationFileName(template.image_path, item.variation)
  if (!slot?.name || !file) {
    return file
  }
  return `items/${slot.name}/${file}`
}

export function rolledItemStatLines(
  catalog: ReferenceCatalog,
  item: RolledItem,
): string[] {
  return item.stats.map((line) => {
    const stat = statById(catalog, line.statId)
    const label = stat?.name ?? `Stat ${line.statId}`
    return `+${line.amt} ${label}`
  })
}

export function rolledItemSlotTypeId(
  catalog: ReferenceCatalog,
  item: RolledItem,
): number | null {
  return itemTemplateById(catalog, item.itemId)?.slot_type_id ?? null
}
