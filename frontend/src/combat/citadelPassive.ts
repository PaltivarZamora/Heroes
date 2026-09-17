import type { Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import type { CombatBattle, CombatSide, CombatStack } from './battle'
import {
  citadelHumanoidChancePct,
  citadelPassiveUnitTagId,
  frozenTagCount,
  isCitadelUnit,
} from './armyTags'
import { isHeroClass } from './shadow'

/** Knight: passive_stats per_unit_pct × filter units, capped at stat × cap_multiplier. */
export function knightBonusChancePct(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  battle: CombatBattle,
  side: CombatSide,
): number {
  if (!isHeroClass(catalog, hero, 'Knight')) {
    return 0
  }
  const tagId = citadelPassiveUnitTagId(catalog, hero)
  const count = frozenTagCount(battle.armyTagCounts, tagId, side)
  return citadelHumanoidChancePct(catalog, hero, count)
}

/** Monk: same shape as Knight; constants from that hero's passive_stats. */
export function monkSuppressChancePct(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  battle: CombatBattle,
  side: CombatSide,
): number {
  if (!isHeroClass(catalog, hero, 'Monk')) {
    return 0
  }
  const tagId = citadelPassiveUnitTagId(catalog, hero)
  const count = frozenTagCount(battle.armyTagCounts, tagId, side)
  return citadelHumanoidChancePct(catalog, hero, count)
}

export function citadelUnitGetsPassives(
  catalog: ReferenceCatalog,
  stack: CombatStack | null | undefined,
): boolean {
  return stack != null && isCitadelUnit(catalog, stack.unitId)
}
