import { canGiveItemToHero, giveItemToHero } from '../items/give'
import { moveHeroItem } from '../items/move'
import { rolledItemSlotTypeId } from '../items/display'
import { normalizeHeroInventory } from '../items/state'
import type { ItemLocation, RolledItem } from '../items/types'
import { BACKPACK_SIZE, EQUIPMENT_SLOT_IDS } from '../items/types'
import type { GameSession, Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import { itemSlotUpgradeGain, scoreItemForHero } from './itemScore'

type OwnedItem = {
  item: RolledItem
  loc: ItemLocation
}

function listOwnedItems(hero: Hero): OwnedItem[] {
  const live = normalizeHeroInventory(hero)
  const out: OwnedItem[] = []
  for (let i = 0; i < BACKPACK_SIZE; i++) {
    const item = live.backpack[i]
    if (item) {
      out.push({ item, loc: { kind: 'backpack', index: i } })
    }
  }
  for (const slotId of EQUIPMENT_SLOT_IDS) {
    const item = live.equipment[slotId]
    if (item) {
      out.push({ item, loc: { kind: 'equipment', slotId } })
    }
  }
  return out
}

function heroById(session: GameSession, heroId: string): Hero | null {
  return session.heroes.find((row) => row.id === heroId) ?? null
}

function writeHero(session: GameSession, hero: Hero): GameSession {
  return {
    ...session,
    heroes: session.heroes.map((row) => (row.id === hero.id ? hero : row)),
  }
}

function transferBackpackItem(
  session: GameSession,
  catalog: ReferenceCatalog,
  fromId: string,
  bpIndex: number,
  toId: string,
): GameSession {
  const fromIndex = session.heroes.findIndex((row) => row.id === fromId)
  const toIndex = session.heroes.findIndex((row) => row.id === toId)
  if (fromIndex < 0 || toIndex < 0) {
    return session
  }
  let fromHero = normalizeHeroInventory(session.heroes[fromIndex])
  const item = fromHero.backpack[bpIndex]
  if (!item) {
    return session
  }
  if (!canGiveItemToHero(session, catalog, toId, item)) {
    return session
  }
  const backpack = [...fromHero.backpack]
  backpack[bpIndex] = null
  fromHero = { ...fromHero, backpack }
  let next = writeHero(session, fromHero)
  const given = giveItemToHero(next, catalog, toId, item)
  if (!given.ok) {
    return session
  }
  return given.session
}

/** Highest-scoring held piece per slot; swap only on strict improvement (S9-40 move). */
export function equipBestItemsForHero(
  session: GameSession,
  catalog: ReferenceCatalog,
  heroId: string,
): GameSession {
  let next = session
  let changed = true
  let guard = 0
  while (changed && guard < 48) {
    guard += 1
    changed = false
    const hero = heroById(next, heroId)
    if (!hero) {
      return next
    }
    const owned = listOwnedItems(hero)
    for (const slotId of EQUIPMENT_SLOT_IDS) {
      let best: OwnedItem | null = null
      let bestScore = -Infinity
      for (const entry of owned) {
        const slotType = rolledItemSlotTypeId(catalog, entry.item)
        if (slotType !== slotId) {
          continue
        }
        const s = scoreItemForHero(catalog, hero, entry.item)
        if (s > bestScore) {
          bestScore = s
          best = entry
        }
      }
      if (!best) {
        continue
      }
      const worn = hero.equipment[slotId]
      const wornScore = worn ? scoreItemForHero(catalog, hero, worn) : 0
      if (bestScore <= wornScore) {
        continue
      }
      const to: ItemLocation = { kind: 'equipment', slotId }
      if (
        best.loc.kind === 'equipment' &&
        best.loc.slotId === slotId &&
        best.item.uid === worn?.uid
      ) {
        continue
      }
      const moved = moveHeroItem(next, catalog, heroId, best.loc, to, false)
      if (moved.ok) {
        next = moved.session
        changed = true
        break
      }
    }
  }
  return next
}

function handoffGainForRecipient(
  catalog: ReferenceCatalog,
  recipient: Hero,
  item: RolledItem,
): number {
  return itemSlotUpgradeGain(catalog, recipient, item)
}

/** Backpack-only trades when two allied heroes meet (BR S9-44 §2b). */
export function handoffItemsBetweenAlliedHeroes(
  session: GameSession,
  catalog: ReferenceCatalog,
  heroA: Hero,
  heroB: Hero,
): GameSession {
  if (heroA.player_id !== heroB.player_id) {
    return session
  }
  let next = session
  const tryDirection = (fromId: string, toId: string): void => {
    const from = heroById(next, fromId)
    const to = heroById(next, toId)
    if (!from || !to) {
      return
    }
    const donor = normalizeHeroInventory(from)
    for (let i = 0; i < BACKPACK_SIZE; i++) {
      const item = donor.backpack[i]
      if (!item) {
        continue
      }
      const gainFrom = handoffGainForRecipient(catalog, from, item)
      const gainTo = handoffGainForRecipient(catalog, to, item)
      if (gainTo <= 0 || gainTo <= gainFrom) {
        continue
      }
      if (!canGiveItemToHero(next, catalog, toId, item)) {
        continue
      }
      next = transferBackpackItem(next, catalog, fromId, i, toId)
    }
  }
  tryDirection(heroA.id, heroB.id)
  tryDirection(heroB.id, heroA.id)
  next = equipBestItemsForHero(next, catalog, heroA.id)
  next = equipBestItemsForHero(next, catalog, heroB.id)
  return next
}

export function runAiItemMaintenanceForPlayer(
  session: GameSession,
  catalog: ReferenceCatalog,
  playerId: string,
  heroIds?: string[],
): GameSession {
  const ids =
    heroIds ??
    session.heroes.filter((row) => row.player_id === playerId).map((row) => row.id)
  let next = session
  for (const id of ids) {
    next = equipBestItemsForHero(next, catalog, id)
  }
  return next
}
