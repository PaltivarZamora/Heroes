import type { Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import {
  missingPassiveStatKey,
  passiveStatNumber,
  passiveStatSourceValue,
  passiveStatString,
  requirePassiveStats,
} from '../town/heroPassiveStats'
import { isHeroClass } from './shadow'

/**
 * Monk S7-6: flat STR × stat_multiplier % chance to reflect retaliation
 * damage onto the retaliator. No unit-tag / town / stack scaling, uncapped.
 * Only the original attacker's Monk is checked per retaliation instance.
 */
export function monkReflectRetaliationChancePct(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): number {
  return flatStatChancePct(catalog, hero, 'Monk', 'Monk reflect retaliation')
}

/**
 * Knight S7-7: flat STR × stat_multiplier % chance to retaliate a second
 * time. No unit-tag / town / stack scaling, uncapped. Fires on the
 * retaliator's side (defending), not the attacker's.
 */
export function knightDoubleRetaliationChancePct(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): number {
  return flatStatChancePct(catalog, hero, 'Knight', 'Knight double retaliation')
}

function flatStatChancePct(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  className: 'Monk' | 'Knight',
  context: string,
): number {
  if (!isHeroClass(catalog, hero, className) || !hero) {
    return 0
  }
  const stats = requirePassiveStats(catalog, hero, context)
  if (!stats) {
    return 0
  }
  const mult = passiveStatNumber(stats, 'stat_multiplier')
  if (mult == null) {
    missingPassiveStatKey(catalog, hero, 'stat_multiplier', className)
    return 0
  }
  const source = passiveStatString(stats, 'stat_source') ?? 'STR'
  const base = passiveStatSourceValue(catalog, hero, source)
  return Math.max(0, base * mult)
}
