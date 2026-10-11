import type { GameSession, Hero } from '../session/types'
import {
  heroResourcePools,
  type ReferenceCatalog,
} from '../town/catalog'
import { rolledItemSlotTypeId } from './display'
import type { ItemLocation, RolledItem } from './types'
import { BACKPACK_SIZE, EQUIPMENT_SLOT_IDS } from './types'
import { normalizeHeroInventory } from './state'

export function parseItemLocation(text: string): ItemLocation | null {
  const trimmed = text.trim().toLowerCase()
  const bp = /^bp:(\d+)$/.exec(trimmed)
  if (bp) {
    const index = Number(bp[1])
    if (Number.isInteger(index) && index >= 0 && index < BACKPACK_SIZE) {
      return { kind: 'backpack', index }
    }
    return null
  }
  const eq = /^eq:(\d+)$/.exec(trimmed)
  if (eq) {
    const slotId = Number(eq[1])
    if (EQUIPMENT_SLOT_IDS.includes(slotId as (typeof EQUIPMENT_SLOT_IDS)[number])) {
      return { kind: 'equipment', slotId }
    }
  }
  return null
}

function readAt(hero: Hero, loc: ItemLocation): RolledItem | null {
  if (loc.kind === 'backpack') {
    return hero.backpack[loc.index] ?? null
  }
  return hero.equipment[loc.slotId] ?? null
}

function writeAt(
  hero: Hero,
  loc: ItemLocation,
  item: RolledItem | null,
): Hero {
  if (loc.kind === 'backpack') {
    const backpack = [...hero.backpack]
    backpack[loc.index] = item
    return { ...hero, backpack }
  }
  return {
    ...hero,
    equipment: { ...hero.equipment, [loc.slotId]: item },
  }
}

function canEquipInSlot(
  catalog: ReferenceCatalog,
  item: RolledItem,
  slotId: number,
): boolean {
  const need = rolledItemSlotTypeId(catalog, item)
  return need != null && need === slotId
}

function clampHeroPools(catalog: ReferenceCatalog, hero: Hero): Hero {
  const pools = heroResourcePools(catalog, hero)
  return {
    ...hero,
    current_mana: Math.min(hero.current_mana, pools.current_mana),
    current_energy: Math.min(hero.current_energy, pools.current_energy),
  }
}

export function moveHeroItem(
  session: GameSession,
  catalog: ReferenceCatalog,
  heroId: string,
  from: ItemLocation,
  to: ItemLocation,
  inCombat: boolean,
): { session: GameSession; ok: true } | { session: GameSession; ok: false; message: string } {
  if (inCombat) {
    return { session, ok: false, message: 'Cannot move items during combat' }
  }
  if (
    (from.kind === 'backpack' &&
      to.kind === 'backpack' &&
      from.index === to.index) ||
    (from.kind === 'equipment' &&
      to.kind === 'equipment' &&
      from.slotId === to.slotId)
  ) {
    return { session, ok: true }
  }

  const heroIndex = session.heroes.findIndex((row) => row.id === heroId)
  if (heroIndex < 0) {
    return { session, ok: false, message: 'Hero not found' }
  }
  let hero = normalizeHeroInventory(session.heroes[heroIndex])
  const moving = readAt(hero, from)
  if (!moving) {
    return { session, ok: false, message: 'Nothing to move in source slot' }
  }

  if (to.kind === 'equipment' && !canEquipInSlot(catalog, moving, to.slotId)) {
    return { session, ok: false, message: 'Wrong slot for this item' }
  }

  const target = readAt(hero, to)
  if (!target) {
    hero = writeAt(writeAt(hero, from, null), to, moving)
    hero = clampHeroPools(catalog, hero)
    const heroes = [...session.heroes]
    heroes[heroIndex] = hero
    return { session: { ...session, heroes }, ok: true }
  }

  if (from.kind === 'equipment' && !canEquipInSlot(catalog, target, from.slotId)) {
    return {
      session,
      ok: false,
      message:
        to.kind === 'backpack'
          ? 'Wrong slot'
          : 'Swapped item cannot go in that equipment slot',
    }
  }
  if (to.kind === 'equipment' && !canEquipInSlot(catalog, moving, to.slotId)) {
    return { session, ok: false, message: 'Wrong slot for this item' }
  }

  hero = writeAt(hero, from, target)
  hero = writeAt(hero, to, moving)
  hero = clampHeroPools(catalog, hero)
  const heroes = [...session.heroes]
  heroes[heroIndex] = hero
  return { session: { ...session, heroes }, ok: true }
}
