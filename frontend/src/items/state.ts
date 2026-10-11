import type { GameSession, Hero } from '../session/types'
import type { HeroEquipment, RolledItem } from './types'
import { BACKPACK_SIZE, EQUIPMENT_SLOT_IDS } from './types'

export function emptyEquipment(): HeroEquipment {
  const out: HeroEquipment = {}
  for (const id of EQUIPMENT_SLOT_IDS) {
    out[id] = null
  }
  return out
}

export function emptyBackpack(): Array<RolledItem | null> {
  return Array.from({ length: BACKPACK_SIZE }, () => null)
}

export function emptyHeroInventory(): Pick<Hero, 'equipment' | 'backpack'> {
  return {
    equipment: emptyEquipment(),
    backpack: emptyBackpack(),
  }
}

function asRolledItem(value: unknown): RolledItem | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const rec = value as Record<string, unknown>
  const uid = String(rec.uid ?? '').trim()
  const itemId = Number(rec.itemId)
  const rarityId = Number(rec.rarityId)
  const variation = Number(rec.variation)
  if (!uid || !Number.isFinite(itemId) || !Number.isFinite(rarityId)) {
    return null
  }
  const statsRaw = rec.stats
  const stats: RolledItem['stats'] = []
  if (Array.isArray(statsRaw)) {
    for (const row of statsRaw) {
      if (!row || typeof row !== 'object') {
        continue
      }
      const line = row as Record<string, unknown>
      const statId = Number(line.statId)
      const amt = Number(line.amt)
      if (Number.isFinite(statId) && Number.isFinite(amt)) {
        stats.push({ statId: Math.floor(statId), amt: Math.floor(amt) })
      }
    }
  }
  const adjRaw = rec.adjId
  const adjId =
    adjRaw == null || adjRaw === ''
      ? null
      : Number.isFinite(Number(adjRaw))
        ? Math.floor(Number(adjRaw))
        : null
  return {
    uid,
    itemId: Math.floor(itemId),
    rarityId: Math.floor(rarityId),
    adjId,
    variation: Number.isFinite(variation) ? Math.max(1, Math.floor(variation)) : 1,
    stats,
  }
}

export function normalizeHeroInventory(hero: Hero): Hero {
  const equipment = emptyEquipment()
  const rawEq = hero.equipment
  if (rawEq && typeof rawEq === 'object') {
    for (const slotId of EQUIPMENT_SLOT_IDS) {
      const item = asRolledItem((rawEq as Record<string, unknown>)[String(slotId)])
      equipment[slotId] = item
    }
  }
  const backpack = emptyBackpack()
  const rawBp = hero.backpack
  if (Array.isArray(rawBp)) {
    for (let i = 0; i < BACKPACK_SIZE; i++) {
      backpack[i] = asRolledItem(rawBp[i])
    }
  }
  return { ...hero, equipment, backpack }
}

export function normalizeSessionItems(session: GameSession): GameSession {
  const nextNo =
    typeof session.next_item_no === 'number' && session.next_item_no > 0
      ? Math.floor(session.next_item_no)
      : 1
  return {
    ...session,
    next_item_no: nextNo,
    heroes: session.heroes.map((hero) => normalizeHeroInventory(hero)),
    features: (session.features ?? []).map((row) =>
      row.kind === 'chest' ? { ...row, item: row.item ?? null } : row,
    ),
  }
}

export function allocateItemUid(session: GameSession): {
  session: GameSession
  uid: string
} {
  const no = session.next_item_no ?? 1
  return {
    session: { ...session, next_item_no: no + 1 },
    uid: `i${no}`,
  }
}

export function firstEmptyBackpackIndex(hero: Hero): number | null {
  for (let i = 0; i < BACKPACK_SIZE; i++) {
    if (!hero.backpack[i]) {
      return i
    }
  }
  return null
}
