export type RolledItemStatLine = {
  statId: number
  amt: number
}

/** One rolled item instance in save game / hero inventory. */
export type RolledItem = {
  uid: string
  itemId: number
  rarityId: number
  adjId: number | null
  variation: number
  stats: RolledItemStatLine[]
}

export type HeroEquipment = Record<number, RolledItem | null>

export const EQUIPMENT_SLOT_IDS = [1, 2, 3, 4, 5, 6] as const
export const BACKPACK_SIZE = 15

export type ItemLocation =
  | { kind: 'equipment'; slotId: number }
  | { kind: 'backpack'; index: number }
