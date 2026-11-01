import {
  unitAttackShape,
  unitById,
  type ReferenceCatalog,
} from '../town/catalog'
import type { CombatStack, CombatTile } from './battle'
import { isVanished } from './condition'
import { minFootprintHexDistance } from './occupancy'
import { pullRangeOk } from './pullTarget'
import { hasLineOfSight } from './shapes'
import { isUntargetableStack } from './siege'

/** Main attack was a ranged shot outside melee / below min_range. */
export function qualifiesForExtraShots(
  attacker: CombatStack,
  mainTarget: CombatStack,
  catalog: ReferenceCatalog,
): boolean {
  const unit = unitById(catalog, attacker.unitId)
  if (unitAttackShape(unit).shape === 'charge_line') {
    return false
  }
  if ((unit?.max_range ?? 1) <= 1) {
    return false
  }
  if (mainTarget.side === attacker.side || mainTarget.qty <= 0) {
    return false
  }
  const dist = minFootprintHexDistance(
    { q: attacker.q, r: attacker.r },
    attacker,
    mainTarget,
    catalog,
  )
  if (dist <= 1) {
    return false
  }
  const minR = unit?.min_range ?? 0
  if (minR > 0 && dist < minR) {
    return false
  }
  return true
}

export function pickRandomExtraShotTarget(
  attacker: CombatStack,
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  random: () => number,
): CombatStack | null {
  const pool = stacks.filter(
    (row) =>
      row.side !== attacker.side &&
      row.qty > 0 &&
      !isUntargetableStack(row, catalog) &&
      !isVanished(row, catalog) &&
      pullRangeOk(attacker, row, catalog, attacker) &&
      hasLineOfSight(
        attacker,
        { q: row.q, r: row.r },
        tiles,
        stacks,
        catalog,
      ),
  )
  if (pool.length === 0) {
    return null
  }
  return pool[Math.floor(random() * pool.length)] ?? null
}
