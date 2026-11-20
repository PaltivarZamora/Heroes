import type { ReferenceCatalog } from '../town/catalog'
import { unitById } from '../town/catalog'
import type { CombatBattle, CombatStack } from './battle'
import { isHeroStack } from './battle'
import { isTemporaryUnit } from '../town/unitTags'

/** Drop surviving battle-only summons before army writeback or mob/garrison sync. */
export function battleWithoutTemporaryStacks(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
): CombatBattle {
  const stacks = battle.stacks.filter((stack) => {
    if (stack.qty <= 0 || isHeroStack(stack)) {
      return true
    }
    const unit = unitById(catalog, stack.unitId)
    return !isTemporaryUnit(catalog, unit)
  })
  if (stacks.length === battle.stacks.length) {
    return battle
  }
  return { ...battle, stacks }
}

export function isTemporaryStack(
  catalog: ReferenceCatalog,
  stack: CombatStack,
): boolean {
  if (stack.qty <= 0 || isHeroStack(stack)) {
    return false
  }
  return isTemporaryUnit(catalog, unitById(catalog, stack.unitId))
}