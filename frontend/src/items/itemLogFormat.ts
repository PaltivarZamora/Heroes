import { rolledItemDisplayName, rolledItemRarityColor } from './display'
import type { RolledItem } from './types'
import type { FormattedLogLine } from '../session/gameLog'
import type { ReferenceCatalog } from '../town/catalog'
import type { GameSession, Hero } from '../session/types'
import { EQUIPMENT_SLOT_IDS, BACKPACK_SIZE } from './types'
import { normalizeHeroInventory } from './state'

export function findHeroItemByUid(hero: Hero, uid: string): RolledItem | null {
  const live = normalizeHeroInventory(hero)
  for (const slotId of EQUIPMENT_SLOT_IDS) {
    const item = live.equipment[slotId]
    if (item?.uid === uid) {
      return item
    }
  }
  for (let i = 0; i < BACKPACK_SIZE; i++) {
    const item = live.backpack[i]
    if (item?.uid === uid) {
      return item
    }
  }
  return null
}

export function resolveLogItem(
  session: GameSession,
  heroId: string,
  itemUid: string,
  fallbackName: string,
  catalog: ReferenceCatalog | null,
): { name: string; color: string | null } {
  const hero = session.heroes.find((row) => row.id === heroId)
  const item =
    hero && catalog ? findHeroItemByUid(hero, itemUid) : null
  const name =
    item && catalog
      ? rolledItemDisplayName(catalog, item)
      : fallbackName
  const color =
    item && catalog ? rolledItemRarityColor(catalog, item) : null
  return { name, color }
}

function lineWithColoredItems(
  prefix: string,
  lead: string,
  parts: Array<{ name: string; color: string | null }>,
  joiner: string,
  tail: string,
): FormattedLogLine {
  const segments: Array<{ text: string; color?: string }> = [
    { text: prefix + lead },
  ]
  parts.forEach((part, index) => {
    if (index > 0) {
      segments.push({ text: joiner })
    }
    segments.push(
      part.color
        ? { text: part.name, color: part.color }
        : { text: part.name },
    )
  })
  if (tail) {
    segments.push({ text: tail })
  }
  const text =
    prefix +
    lead +
    parts.map((part) => part.name).join(joiner) +
    tail
  return { text, segments }
}

export function formatItemPickedUpLog(
  session: GameSession,
  catalog: ReferenceCatalog | null,
  day: number,
  heroId: string,
  itemUid: string,
  itemName: string,
): FormattedLogLine {
  const prefix = `Day ${day}: `
  const part = resolveLogItem(session, heroId, itemUid, itemName, catalog)
  return lineWithColoredItems(prefix, 'Picked up ', [part], '', '')
}

export function formatQuestRewardItemLog(
  session: GameSession,
  catalog: ReferenceCatalog | null,
  day: number,
  heroId: string,
  itemUid: string,
  itemName: string,
): FormattedLogLine {
  const prefix = `Day ${day}: `
  const part = resolveLogItem(session, heroId, itemUid, itemName, catalog)
  return lineWithColoredItems(prefix, 'Quest reward: ', [part], '', '')
}

export function formatTookItemsLog(
  session: GameSession,
  catalog: ReferenceCatalog | null,
  day: number,
  heroId: string,
  items: Array<{ uid: string; name: string }>,
): FormattedLogLine {
  const prefix = `Day ${day}: `
  const parts = items.map((row) =>
    resolveLogItem(session, heroId, row.uid, row.name, catalog),
  )
  return lineWithColoredItems(prefix, 'Took ', parts, ', ', '')
}

export function formatPlainItemLog(day: number, text: string): FormattedLogLine {
  return { text: `Day ${day}: ${text}` }
}

export function onScreenPickedUpMessage(
  catalog: ReferenceCatalog,
  item: RolledItem,
): string {
  return `Picked up ${rolledItemDisplayName(catalog, item)}`
}

export function onScreenBackpackFullGround(
  catalog: ReferenceCatalog,
  item: RolledItem,
): string {
  return `Backpack full: ${rolledItemDisplayName(catalog, item)} left on the ground`
}

export function onScreenBackpackFullChest(
  catalog: ReferenceCatalog,
  item: RolledItem,
): string {
  return `Backpack full: chest left open (${rolledItemDisplayName(catalog, item)})`
}

export const QUEST_REWARD_NO_ROOM = 'No room for the quest reward'
