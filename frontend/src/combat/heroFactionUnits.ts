import { logConfigOnce } from '../session/configLog'
import type { Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import { unitById } from '../town/catalog'
import type { CombatBattle, CombatSide, CombatStack } from './battle'
import { isHeroStack } from './battle'

export function heroClassTownId(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): number | null {
  if (!hero?.class_id) {
    return null
  }
  const row = catalog.hero_type.find((entry) => entry.id === hero.class_id)
  const townId = row?.town_id
  return townId != null && townId > 0 ? townId : null
}

export function isUnitOfTownId(
  catalog: ReferenceCatalog,
  unitId: number,
  townId: number | null | undefined,
): boolean {
  if (townId == null || townId <= 0) {
    return false
  }
  const unit = unitById(catalog, unitId)
  return unit?.town_id === townId
}

/** Units belonging to this hero class's faction town (`hero_type.town_id`). */
export function isUnitOfHeroFaction(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  unitId: number,
): boolean {
  return isUnitOfTownId(catalog, unitId, heroClassTownId(catalog, hero))
}

const warnedLegacyTownFilter = new Set<string>()

/**
 * Resolve optional passive_stats town filter to a town id.
 * Number (or numeric string) = explicit town id; absent = hero's own faction town.
 */
export function passiveTownIdFromFilter(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  filter: unknown,
): number | null {
  const own = heroClassTownId(catalog, hero)
  if (filter == null || filter === '') {
    return own
  }
  if (typeof filter === 'number' && Number.isFinite(filter) && filter > 0) {
    return Math.floor(filter)
  }
  const asNum = Number(filter)
  if (Number.isFinite(asNum) && asNum > 0) {
    return Math.floor(asNum)
  }
  if (typeof filter === 'string') {
    const legacy = filter.trim()
    if (legacy.length > 0) {
      const warnKey = `${hero?.class_id ?? 0}:${legacy}`
      if (!warnedLegacyTownFilter.has(warnKey)) {
        warnedLegacyTownFilter.add(warnKey)
        logConfigOnce(
          `passive_town_filter:${warnKey}`,
          `[passive_town_filter] legacy town name "${legacy}" ignored for hero_type.id=${hero?.class_id ?? '?'}; use town id or omit for own town`,
        )
      }
    }
  }
  return own
}

export function countFactionStacks(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  side: CombatSide,
  townId: number | null,
): number {
  if (townId == null || townId <= 0) {
    return 0
  }
  let total = 0
  for (const stack of stacks) {
    if (stack.side !== side || stack.qty <= 0 || isHeroStack(stack)) {
      continue
    }
    if (isUnitOfTownId(catalog, stack.unitId, townId)) {
      total += 1
    }
  }
  return total
}

export function frozenFactionStackCount(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  side: CombatSide,
  townId: number | null,
): number {
  if (townId == null || townId <= 0) {
    return 0
  }
  const frozen = battle.armyTownCounts?.[townId]?.[side]
  if (frozen != null) {
    return Math.max(0, frozen)
  }
  return countFactionStacks(battle.stacks, catalog, side, townId)
}
