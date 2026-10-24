import type { Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import {
  missingPassiveStatKey,
  passiveStatNumber,
  passiveStatSourceValue,
  passiveStatString,
  requirePassiveStats,
} from '../town/heroPassiveStats'
import { hasPassiveKey, PASSIVE_KEY } from '../town/heroPassiveKey'

/**
 * Monk: flat STR × stat_multiplier % chance to reflect retaliation damage.
 */
export function monkReflectRetaliationChancePct(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): number {
  if (!hasPassiveKey(catalog, hero, PASSIVE_KEY.MONK_REFLECT_RETALIATION) || !hero) {
    return 0
  }
  return flatStatChancePct(catalog, hero, 'Monk reflect retaliation')
}

/**
 * Knight: flat STR × stat_multiplier % chance to retaliate a second time.
 */
export function knightDoubleRetaliationChancePct(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): number {
  if (!hasPassiveKey(catalog, hero, PASSIVE_KEY.KNIGHT_DOUBLE_RETALIATION) || !hero) {
    return 0
  }
  return flatStatChancePct(catalog, hero, 'Knight double retaliation')
}

function flatStatChancePct(
  catalog: ReferenceCatalog,
  hero: Hero,
  context: string,
): number {
  const stats = requirePassiveStats(catalog, hero, context)
  if (!stats) {
    return 0
  }
  const mult = passiveStatNumber(stats, 'stat_multiplier')
  if (mult == null) {
    missingPassiveStatKey(catalog, hero, 'stat_multiplier', context)
    return 0
  }
  const source = passiveStatString(stats, 'stat_source') ?? 'STR'
  const base = passiveStatSourceValue(catalog, hero, source)
  return Math.max(0, base * mult)
}
