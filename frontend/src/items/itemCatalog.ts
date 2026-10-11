import type { ReferenceCatalog } from '../town/catalog'
import { parseStatTags } from '../town/statCatalog'

export type RarityRow = {
  id: number
  name: string
  color: string
  weight: number
}

export type ItemKindRow = {
  id: number
  name: string
}

export type ItemTypeRow = {
  id: number
  name: string
  kind_id: number
  stat_tags: number[]
  description: string | null
}

export type ItemTemplateRow = {
  id: number
  name: string
  slot_type_id: number
  cat_type_id: number
  sub_cat_type_id: number | null
  variations: number
  image_path: string
  flippable: boolean
}

export type ItemAdjRow = {
  id: number
  name: string
  tags: number[]
}

export type ItemReferenceCatalog = {
  rarity: RarityRow[]
  item_kind: ItemKindRow[]
  item_type: ItemTypeRow[]
  item: ItemTemplateRow[]
  item_adj: ItemAdjRow[]
}

function asInt(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.floor(n) : fallback
}

export function asRarities(raw: unknown): RarityRow[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .map((row) => {
      const rec = row as Record<string, unknown>
      return {
        id: asInt(rec.id),
        name: String(rec.name ?? ''),
        color: String(rec.color ?? '#ffffff'),
        weight: asInt(rec.weight),
      }
    })
    .filter((row) => row.id > 0)
    .sort((a, b) => a.id - b.id)
}

export function asItemTypes(raw: unknown): ItemTypeRow[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .map((row) => {
      const rec = row as Record<string, unknown>
      const desc = rec.description
      return {
        id: asInt(rec.id),
        name: String(rec.name ?? ''),
        kind_id: asInt(rec.kind_id),
        stat_tags: parseStatTags(rec.stat_tags),
        description:
          desc == null || desc === '' ? null : String(desc),
      }
    })
    .filter((row) => row.id > 0)
}

export function asItemTemplates(raw: unknown): ItemTemplateRow[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .map((row) => {
      const rec = row as Record<string, unknown>
      const sub = rec.sub_cat_type_id
      return {
        id: asInt(rec.id),
        name: String(rec.name ?? ''),
        slot_type_id: asInt(rec.slot_type_id),
        cat_type_id: asInt(rec.cat_type_id),
        sub_cat_type_id:
          sub == null || sub === '' ? null : asInt(sub) || null,
        variations: Math.max(1, asInt(rec.variations, 1)),
        image_path: String(rec.image_path ?? ''),
        flippable: Boolean(rec.flippable),
      }
    })
    .filter((row) => row.id > 0)
}

export function asItemAdjs(raw: unknown): ItemAdjRow[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw
    .map((row) => {
      const rec = row as Record<string, unknown>
      return {
        id: asInt(rec.id),
        name: String(rec.name ?? ''),
        tags: parseStatTags(rec.tags),
      }
    })
    .filter((row) => row.id > 0)
}

export function auditItemSlotTypes(catalog: ReferenceCatalog): void {
  const slotIds = new Set(
    catalog.item_type.filter((row) => row.kind_id === 1).map((row) => row.id),
  )
  for (const item of catalog.item) {
    if (!slotIds.has(item.slot_type_id)) {
      console.warn(
        `[items] item.id=${item.id} slot_type_id=${item.slot_type_id} is not a kind-1 slot row`,
      )
    }
  }
}

export function itemTemplateById(
  catalog: ReferenceCatalog,
  itemId: number,
): ItemTemplateRow | undefined {
  return catalog.item.find((row) => row.id === itemId)
}

export function itemTypeById(
  catalog: ReferenceCatalog,
  typeId: number,
): ItemTypeRow | undefined {
  return catalog.item_type.find((row) => row.id === typeId)
}

export function rarityById(
  catalog: ReferenceCatalog,
  rarityId: number,
): RarityRow | undefined {
  return catalog.rarity.find((row) => row.id === rarityId)
}

export function itemAdjById(
  catalog: ReferenceCatalog,
  adjId: number | null,
): ItemAdjRow | undefined {
  if (adjId == null) {
    return undefined
  }
  return catalog.item_adj.find((row) => row.id === adjId)
}
