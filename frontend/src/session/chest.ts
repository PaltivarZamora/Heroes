import {
  chestGold,
  chestXp,
} from '../hex/townFootprint'
import {
  formatAmount,
  GOLD_RESOURCE_ID,
  resourceById,
} from '../hex/resources'
import type { ReferenceCatalog } from '../town/catalog'
import {
  findChestById,
  openChest,
  removeChest,
} from './accessors'
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

/**
 * Apply XP / Loot / Leave for a chest (BR S9-3). AI and human share this path.
 * Max-level heroes still receive XP via {@link awardHeroXp} (no level gain).
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

  // Loot
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

/** AI XP vs Loot rule: XP if highest-level hero (and not max level); else Loot. */
export function aiChestChoice(
  session: GameSession,
  catalog: ReferenceCatalog,
  playerId: string,
  heroId: string,
): 'xp' | 'loot' {
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero) {
    return 'loot'
  }
  const maxLevel = catalog.levels.reduce(
    (max, row) => (row.id > max ? row.id : max),
    1,
  )
  if (hero.current_level >= maxLevel) {
    return 'loot'
  }
  const own = session.heroes.filter((row) => row.player_id === playerId)
  const highest = own.reduce(
    (best, row) => (row.current_level > best.current_level ? row : best),
    own[0] ?? hero,
  )
  return highest.id === hero.id ? 'xp' : 'loot'
}
