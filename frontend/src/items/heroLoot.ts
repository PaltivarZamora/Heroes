import type { GameSession, Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import { giveItemToHero } from './give'
import type { RolledItem } from './types'
import { EQUIPMENT_SLOT_IDS } from './types'
import { normalizeHeroInventory } from './state'

type ListedItem = {
  item: RolledItem
  kind: 'backpack' | 'equipment'
  index: number
}

function listHeroItems(_catalog: ReferenceCatalog, hero: Hero): ListedItem[] {
  const live = normalizeHeroInventory(hero)
  const out: ListedItem[] = []
  for (let i = 0; i < live.backpack.length; i++) {
    const item = live.backpack[i]
    if (item) {
      out.push({ item, kind: 'backpack', index: i })
    }
  }
  for (const slotId of EQUIPMENT_SLOT_IDS) {
    const item = live.equipment[slotId]
    if (item) {
      out.push({ item, kind: 'equipment', index: slotId })
    }
  }
  out.sort((a, b) => {
    if (a.item.rarityId !== b.item.rarityId) {
      return b.item.rarityId - a.item.rarityId
    }
    if (a.kind !== b.kind) {
      return a.kind === 'backpack' ? -1 : 1
    }
    return a.index - b.index
  })
  return out
}

function removeListedItem(hero: Hero, entry: ListedItem): Hero {
  if (entry.kind === 'backpack') {
    const backpack = [...hero.backpack]
    backpack[entry.index] = null
    return { ...hero, backpack }
  }
  return {
    ...hero,
    equipment: { ...hero.equipment, [entry.index]: null },
  }
}

/**
 * Transfer loser's items to winner (BR S9-41 §5). Returns updated session and names taken.
 */
export function transferDefeatedHeroItems(
  session: GameSession,
  catalog: ReferenceCatalog,
  winnerId: string,
  loserId: string,
): { session: GameSession; taken: RolledItem[] } {
  const loserIndex = session.heroes.findIndex((row) => row.id === loserId)
  const winnerIndex = session.heroes.findIndex((row) => row.id === winnerId)
  if (loserIndex < 0 || winnerIndex < 0) {
    return { session, taken: [] }
  }
  let loser = normalizeHeroInventory(session.heroes[loserIndex])
  let next = session
  const taken: RolledItem[] = []
  for (const entry of listHeroItems(catalog, loser)) {
    const attempt = giveItemToHero(next, catalog, winnerId, entry.item)
    if (!attempt.ok) {
      continue
    }
    next = attempt.session
    taken.push(entry.item)
    loser = removeListedItem(loser, entry)
  }
  const heroes = [...next.heroes]
  heroes[loserIndex] = loser
  return { session: { ...next, heroes }, taken }
}
