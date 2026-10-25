import type { ReferenceCatalog } from '../town/catalog'
import { unitAttackShape, unitById } from '../town/catalog'
import { applyStackHeal } from './attack'
import type { CombatBattle } from './battle'
import { isHeroStack, stackMaxHealth } from './battle'

/** Start of stack's own turn: heal front creature by % of missing HP. */
export function applyUnitRegenAtTurnStart(
  battle: CombatBattle,
  stackId: string,
  catalog: ReferenceCatalog,
): { battle: CombatBattle; lines: string[] } {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || stack.qty <= 0 || isHeroStack(stack)) {
    return { battle, lines: [] }
  }
  const pct = unitAttackShape(unitById(catalog, stack.unitId)).regenPct
  if (pct == null || pct <= 0) {
    return { battle, lines: [] }
  }
  const full = stackMaxHealth(stack, catalog)
  const missing = Math.max(0, full - stack.topHealth)
  if (missing <= 0) {
    return { battle, lines: [] }
  }
  const amount = Math.max(1, Math.floor((missing * pct) / 100))
  const healed = applyStackHeal(stack, amount, full)
  if (healed.healed <= 0) {
    return { battle, lines: [] }
  }
  const name = unitById(catalog, stack.unitId)?.name ?? 'Unit'
  const stacks = battle.stacks.map((row) =>
    row.id === stack.id ? healed.stack : row,
  )
  return {
    battle: { ...battle, stacks },
    lines: [`${name} regenerates ${healed.healed} HP.`],
  }
}
