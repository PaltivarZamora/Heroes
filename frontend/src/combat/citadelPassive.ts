import type { Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import type { CombatBattle, CombatSide, CombatStack } from './battle'
import {
  citadelHumanoidChancePct,
  frozenTagCount,
  HUMANOID_TAG,
  isCitadelUnit,
  knightCapPctStat,
  monkCapPctStat,
} from './armyTags'
import { isHeroClass } from './shadow'

/** Knight: 0.25% × Humanoids, capped at STR × cap_pct_stat (default 2). */
export function knightBonusChancePct(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  battle: CombatBattle,
  side: CombatSide,
): number {
  if (!isHeroClass(catalog, hero, 'Knight')) {
    return 0
  }
  const count = frozenTagCount(battle.armyTagCounts, HUMANOID_TAG, side)
  return citadelHumanoidChancePct(
    catalog,
    hero,
    count,
    knightCapPctStat(catalog, hero),
  )
}

/** Monk: 0.25% × Humanoids, capped at STR × cap_pct_stat (default 3). */
export function monkSuppressChancePct(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  battle: CombatBattle,
  side: CombatSide,
): number {
  if (!isHeroClass(catalog, hero, 'Monk')) {
    return 0
  }
  const count = frozenTagCount(battle.armyTagCounts, HUMANOID_TAG, side)
  return citadelHumanoidChancePct(
    catalog,
    hero,
    count,
    monkCapPctStat(catalog, hero),
  )
}

export function citadelUnitGetsPassives(
  catalog: ReferenceCatalog,
  stack: CombatStack | null | undefined,
): boolean {
  return stack != null && isCitadelUnit(catalog, stack.unitId)
}
