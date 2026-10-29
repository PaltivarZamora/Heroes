import {
  unitAttackShape,
  unitById,
  type ReferenceCatalog,
} from '../town/catalog'
import type { CombatBattle, CombatStack } from './battle'
import {
  clearCondition,
  conditionRemaining,
  vanishConditionId,
} from './condition'

export function clearVanishOnAttack(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): CombatStack {
  const id = vanishConditionId(catalog)
  if (conditionRemaining(stack, id) <= 0) {
    return stack
  }
  return clearCondition(stack, id)
}

export function tryVanishOnMoveNoAttack(
  battle: CombatBattle,
  stackId: string,
  catalog: ReferenceCatalog,
): { battle: CombatBattle; lines: string[] } {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || stack.qty <= 0 || stack.movedThisTurn !== true) {
    return { battle, lines: [] }
  }
  if (stack.attackedThisTurn === true) {
    return { battle, lines: [] }
  }
  const spec = unitAttackShape(unitById(catalog, stack.unitId))
  if (!spec.vanishOnMoveNoAttack) {
    return { battle, lines: [] }
  }
  const id = vanishConditionId(catalog)
  const name = unitById(catalog, stack.unitId)?.name ?? 'Unknown'
  const next: CombatStack = {
    ...stack,
    conditions: { ...(stack.conditions ?? {}), [id]: 1 },
    conditionExtra: {
      ...(stack.conditionExtra ?? {}),
      [id]: { roundTick: true },
    },
  }
  return {
    battle: {
      ...battle,
      stacks: battle.stacks.map((row) => (row.id === stackId ? next : row)),
    },
    lines: [`${name} vanishes`],
  }
}
