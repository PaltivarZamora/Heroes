import {
  chestGold,
  chestXp,
} from '../hex/townFootprint'
import {
  formatAmount,
  GOLD_RESOURCE_ID,
  resourceById,
} from '../hex/resources'
import { canGiveItemToHero, giveItemToHero } from '../items/give'
import { rolledItemDisplayName } from '../items/display'
import type { ReferenceCatalog } from '../town/catalog'
import {
  findChestById,
  openChest,
  removeChest,
  updateChest,
} from './accessors'
import {
  logChestLeftOpen,
  logItemPickedUp,
} from './gameLog'
import {
  onScreenBackpackFullChest,
  onScreenPickedUpMessage,
} from '../items/itemLogFormat'
import type { GameSession } from './types'
import {
  awardHeroXp,
  levelUpNoticeForAward,
  type LevelUpNotice,
} from './xp'

export type ChestClaimChoice = 'xp' | 'loot' | 'leave'

export type ChestClaimResult = {
  session: GameSession
  /** Result title after XP/Loot; null for Leave. */
  message: string | null
  /** Extra body lines (loot items listed separately). */
  messageLines: string[] | null
  levelUpNotice: LevelUpNotice | null
}

function formatLootLines(
  gold: number,
  loot: Array<{ resource_id: number; qty: number }>,
): string[] {
  const parts: string[] = []
  if (gold > 0) {
    parts.push(`${formatAmount(gold)} Gold`)
  }
  for (const entry of loot) {
    const name = resourceById(entry.resource_id)?.name ?? `#${entry.resource_id}`
    parts.push(`${formatAmount(entry.qty)} ${name}`)
  }
  return parts
}

function heroPlayerId(session: GameSession, heroId: string): string | null {
  return session.heroes.find((row) => row.id === heroId)?.player_id ?? null
}

function claimChestItemLoot(
  session: GameSession,
  catalog: ReferenceCatalog,
  featureId: string,
  heroId: string,
  chest: Extract<import('./types').MapFeature, { kind: 'chest' }>,
): ChestClaimResult {
  if (!chest.item) {
    return { session, message: null, messageLines: null, levelUpNotice: null }
  }
  const itemName = rolledItemDisplayName(catalog, chest.item)
  const playerId = heroPlayerId(session, heroId)
  const given = giveItemToHero(session, catalog, heroId, chest.item)
  if (given.ok) {
    let next = removeChest(given.session, featureId)
    if (playerId) {
      next = logItemPickedUp(
        next,
        playerId,
        heroId,
        chest.item.uid,
        itemName,
      )
    }
    return {
      session: next,
      message: onScreenPickedUpMessage(catalog, chest.item),
      messageLines: null,
      levelUpNotice: null,
    }
  }
  let next = updateChest(given.session, featureId, (row) => ({ ...row, open: true }))
  if (playerId) {
    next = logChestLeftOpen(next, playerId, heroId, itemName)
  }
  return {
    session: next,
    message: onScreenBackpackFullChest(catalog, chest.item),
    messageLines: null,
    levelUpNotice: null,
  }
}

/** Open chest still holding an item — retry give only (no XP/Loot prompt). */
export function tryOpenChestItemGive(
  session: GameSession,
  catalog: ReferenceCatalog,
  featureId: string,
  heroId: string,
): ChestClaimResult {
  const chest = findChestById(session, featureId)
  if (
    !chest?.item ||
    !chest.open ||
    !session.heroes.some((row) => row.id === heroId)
  ) {
    return { session, message: null, messageLines: null, levelUpNotice: null }
  }
  return claimChestItemLoot(session, catalog, featureId, heroId, chest)
}

/**
 * Apply XP / Loot / Leave for a closed chest (BR S9-3 + S9-41).
 * Loot = item if present, else resources.
 */
export function claimChest(
  session: GameSession,
  catalog: ReferenceCatalog,
  featureId: string,
  heroId: string,
  choice: ChestClaimChoice,
): ChestClaimResult {
  const chest = findChestById(session, featureId)
  if (!chest || !session.heroes.some((row) => row.id === heroId)) {
    return { session, message: null, messageLines: null, levelUpNotice: null }
  }
  let next = openChest(session, featureId)
  if (choice === 'leave') {
    return { session: next, message: null, messageLines: null, levelUpNotice: null }
  }

  if (choice === 'xp') {
    const xp = chestXp(catalog, chest.level)
    const award = awardHeroXp(next, catalog, heroId, xp)
    next = removeChest(award.session, featureId)
    return {
      session: next,
      message: `${formatAmount(award.awarded)} XP`,
      messageLines: null,
      levelUpNotice: levelUpNoticeForAward(catalog, award),
    }
  }

  if (chest.item) {
    const itemResult = claimChestItemLoot(next, catalog, featureId, heroId, chest)
    return itemResult
  }

  const gold = chestGold(catalog, chest.level)
  const loot = chest.loot
  const hero = next.heroes.find((row) => row.id === heroId)
  const playerId = hero?.player_id
  if (playerId) {
    next = {
      ...next,
      players: next.players.map((player) => {
        if (player.id !== playerId) {
          return player
        }
        const resources = { ...player.resources }
        if (gold > 0) {
          resources[GOLD_RESOURCE_ID] = (resources[GOLD_RESOURCE_ID] ?? 0) + gold
        }
        for (const entry of loot) {
          resources[entry.resource_id] =
            (resources[entry.resource_id] ?? 0) + entry.qty
        }
        return { ...player, resources }
      }),
    }
  }
  next = removeChest(next, featureId)
  const lootLines = formatLootLines(gold, loot)
  return {
    session: next,
    message: null,
    messageLines: lootLines.length > 0 ? lootLines : null,
    levelUpNotice: null,
  }
}

export function chestMapTooltip(
  catalog: ReferenceCatalog,
  chest: Extract<
    import('./types').MapFeature,
    { kind: 'chest' }
  >,
): string {
  if (chest.open && chest.item) {
    return `Open Chest: ${rolledItemDisplayName(catalog, chest.item)}`
  }
  return chest.name
}

export function aiChestChoice(
  session: GameSession,
  catalog: ReferenceCatalog,
  playerId: string,
  heroId: string,
  featureId: string,
): ChestClaimChoice {
  const chest = findChestById(session, featureId)
  if (chest?.item && !chest.open) {
    if (canGiveItemToHero(session, catalog, heroId, chest.item)) {
      return 'loot'
    }
    return 'xp'
  }
  const heroes = session.heroes.filter((row) => row.player_id === playerId)
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero || heroes.length === 0) {
    return 'loot'
  }
  const maxLevel = heroes.reduce(
    (best, row) => Math.max(best, row.current_level),
    0,
  )
  if (hero.current_level >= maxLevel) {
    return 'xp'
  }
  return 'loot'
}
