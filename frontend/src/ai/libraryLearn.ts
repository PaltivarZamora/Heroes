import { canAfford } from '../hex/resources'
import {
  ensureLibraryOffers,
  findTownAt,
  learnLibraryAbility,
  visitingHeroId,
  walletFromSession,
} from '../session/accessors'
import { getSession, updateSession } from '../session/store'
import type { GameSession, Hero, Player, Town } from '../session/types'
import {
  buildingById,
  getCachedCatalog,
  isLibraryBuilding,
  libraryGoldCost,
  type ReferenceCatalog,
} from '../town/catalog'
import {
  firstLearnableAbility,
  goldCostForLevel,
} from '../town/libraryRules'
import { appendAiTrace } from './trace'

function libraryState(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
) {
  return (
    session.building_states.find((row) => {
      if (row.town_id !== townId || row.level < 1 || row.building_id == null) {
        return false
      }
      const building = buildingById(catalog, row.building_id)
      return building != null && isLibraryBuilding(building)
    }) ?? null
  )
}

export function ensurePlayerLibraryOffers(playerId: string): void {
  const catalog = getCachedCatalog()
  if (!catalog) {
    return
  }
  updateSession((session) => {
    let current = session
    for (const town of session.towns) {
      if (town.player_id !== playerId) {
        continue
      }
      const library = libraryState(current, catalog, town.id)
      if (!library) {
        continue
      }
      current = ensureLibraryOffers(
        current,
        catalog,
        town.id,
        town.town_type_id,
        library.slot_num,
      )
    }
    return current
  })
}

export function firstAffordableLearn(
  session: GameSession,
  catalog: ReferenceCatalog,
  player: Player,
  hero: Hero,
  town: Town,
) {
  if (town.player_id !== player.id) {
    return null
  }
  const library = libraryState(session, catalog, town.id)
  if (!library) {
    return null
  }
  const ability = firstLearnableAbility(
    catalog,
    hero,
    library.level,
    library.offered_abilities,
  )
  if (!ability) {
    return null
  }
  const cost = goldCostForLevel(ability.level_id)
  if (canAfford(walletFromSession(session), cost)) {
    return ability
  }
  return null
}

/**
 * If this AI hero is visiting an owned town, learn offered Library abilities
 * in UI order via the same `learnLibraryAbility` action a human uses.
 */
export function decideAndApplyLibraryLearn(player: Player, hero: Hero): void {
  const catalog = getCachedCatalog()
  if (!catalog) {
    return
  }
  ensurePlayerLibraryOffers(player.id)
  const session = getSession()
  const live = session.heroes.find((row) => row.id === hero.id) ?? hero
  const town = findTownAt(session, live.position.q, live.position.r)
  if (!town || town.player_id !== player.id) {
    return
  }
  if (visitingHeroId(session, town) !== live.id) {
    return
  }

  const learned: string[] = []
  let failed: string | null = null
  for (let n = 0; n < 16; n += 1) {
    const current = getSession()
    const visitor = current.heroes.find((row) => row.id === live.id)
    if (!visitor) {
      break
    }
    const ability = firstAffordableLearn(
      current,
      catalog,
      player,
      visitor,
      town,
    )
    if (!ability) {
      break
    }
    let error: string | null = null
    updateSession((row) => {
      const result = learnLibraryAbility(
        row,
        catalog,
        town.id,
        visitor.id,
        ability.id,
      )
      error = result.error
      return result.error ? row : result.session
    })
    if (error) {
      failed = error
      break
    }
    const gold = libraryGoldCost(catalog, ability.level_id)
    learned.push(`${ability.name} (${gold} Gold)`)
  }

  if (learned.length === 0 && !failed) {
    return
  }
  appendAiTrace(
    [
      `AI library_learn — ${live.name} in ${town.name}`,
      learned.length > 0
        ? `  learned ${learned.join(', ')}`
        : '  none learned',
      failed ? `  FAILED ${failed}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  )
}
