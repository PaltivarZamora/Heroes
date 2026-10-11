import type { OpeningStack } from '../combat/resolve'
import { isCreatureArmyUnit } from '../combat/siege'
import type { CombatSide } from '../combat/battle'
import { unitById, type ReferenceCatalog } from '../town/catalog'
import { partsArmyValue, type XpValuePart } from './xp'

export function creatureOpeningSideValue(
  catalog: ReferenceCatalog,
  opening: readonly OpeningStack[],
  side: CombatSide,
): number {
  const parts: XpValuePart[] = opening
    .filter((row) => row.side === side)
    .filter((row) => {
      const unit = unitById(catalog, row.unitId)
      return unit != null && isCreatureArmyUnit(unit)
    })
    .map((row) => ({ unitId: row.unitId, qty: row.qty }))
  return partsArmyValue(catalog, parts)
}
