import type { ReferenceCatalog } from '../town/catalog'
import {
  isHeroStack,
  type CombatBattle,
  type CombatSide,
  type CombatStack,
} from './battle'
import { occupancyKey, stackFootprint } from './occupancy'

/** Evasion % from passive smoke-style zones (friendly to caster only). */
export function zoneEvasionPctForStack(
  battle: CombatBattle,
  target: CombatStack,
  catalog: ReferenceCatalog,
): number {
  if (target.qty <= 0 || isHeroStack(target)) {
    return 0
  }
  const keys = new Set(
    stackFootprint(target, catalog).map((hex) => occupancyKey(hex.q, hex.r)),
  )
  let best = 0
  for (const zone of battle.groundEffects ?? []) {
    if (zone.mechanicType !== 'passive_zone') {
      continue
    }
    if (zone.effect !== 'evasion_pct_stat') {
      continue
    }
    if (zone.casterSide !== target.side) {
      continue
    }
    if (zone.evasionPct <= 0) {
      continue
    }
    if (!zone.hexKeys.some((key) => keys.has(key))) {
      continue
    }
    best = Math.max(best, zone.evasionPct)
  }
  return best
}

/**
 * Hidden zones are invisible to the opposing side's UI.
 * Caster always sees their own (Rod: useful when watching AI).
 * AI pathing must never read groundEffects for decisions.
 */
export function visibleGroundEffects(
  battle: CombatBattle,
  viewerSide: CombatSide,
) {
  return (battle.groundEffects ?? []).filter(
    (row) => !row.hidden || row.casterSide === viewerSide,
  )
}
