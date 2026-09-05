import type { Axial } from '../hex/hero'
import type { ReferenceCatalog } from '../town/catalog'
import {
  conditionName,
  unitAttackShape,
  unitById,
  unitIsStationary,
} from '../town/catalog'
import type { CombatBattle, CombatStack, CombatTile } from './battle'
import { isHeroStack } from './battle'
import {
  combatReachable,
  footprintSpecFor,
  hexKey,
  moveKindForUnit,
  occupiedForMover,
  stopOnlyForMover,
} from './movement'
import { isCreatureArmyUnit, openBridgeMoatKeys } from './siege'

export const FEAR_CONDITION_ID = 1

export function conditionRemaining(
  stack: CombatStack,
  conditionId: number,
): number {
  return stack.conditions?.[conditionId] ?? 0
}

export function fearConditionId(catalog: ReferenceCatalog): number {
  const named = catalog.condition.find(
    (row) => row.value.trim().toLowerCase() === 'fear',
  )
  return named?.id ?? FEAR_CONDITION_ID
}

export function isFeared(
  stack: CombatStack,
  catalog?: ReferenceCatalog,
): boolean {
  const id = catalog ? fearConditionId(catalog) : FEAR_CONDITION_ID
  return conditionRemaining(stack, id) > 0
}

export function applyConsumedCondition(
  battle: CombatBattle,
  stackId: string,
  conditionId: number,
): CombatBattle {
  return {
    ...battle,
    stacks: battle.stacks.map((row) =>
      row.id === stackId ? consumeCondition(row, conditionId) : row,
    ),
  }
}

export function consumeCondition(
  stack: CombatStack,
  conditionId: number,
): CombatStack {
  const left = conditionRemaining(stack, conditionId) - 1
  const next = { ...(stack.conditions ?? {}) }
  if (left <= 0) {
    delete next[conditionId]
  } else {
    next[conditionId] = left
  }
  return { ...stack, conditions: next }
}

function liveResistance(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  stat: 'resistance' | 'defense',
): number {
  const unit = unitById(catalog, stack.unitId)
  const base = stat === 'defense' ? (unit?.defense ?? 0) : (unit?.resistance ?? 0)
  const pct =
    stat === 'defense'
      ? (stack.mitigationPct?.defense ?? 0)
      : (stack.mitigationPct?.resistance ?? 0)
  if (!pct) {
    return Math.max(0, base)
  }
  return Math.max(0, Math.floor((base * (100 + pct)) / 100))
}

export function tryInflictCondition(
  striker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
  random: () => number = Math.random,
): { stack: CombatStack; lines: string[] } {
  const spec = unitAttackShape(unitById(catalog, striker.unitId))
  const conditionId = spec.inflictsCondition
  if (conditionId == null || conditionId <= 0) {
    return { stack: target, lines: [] }
  }
  if (
    target.indestructible ||
    isHeroStack(target) ||
    !isCreatureArmyUnit(unitById(catalog, target.unitId))
  ) {
    return { stack: target, lines: [] }
  }
  const name = unitById(catalog, target.unitId)?.name ?? 'Unknown'
  const label = conditionName(catalog, conditionId)
  if (spec.resistStat) {
    const chance = Math.min(100, liveResistance(target, catalog, spec.resistStat))
    if (Math.floor(random() * 100) < chance) {
      return {
        stack: target,
        lines: [`${target.qty} ${name} resisted ${label}.`],
      }
    }
  }
  const duration = Math.max(1, spec.conditionDuration)
  const conditions = {
    ...(target.conditions ?? {}),
    [conditionId]: duration,
  }
  return {
    stack: { ...target, conditions },
    lines: [`${target.qty} ${name} are afflicted with ${label}.`],
  }
}

/** Random legal flee path, or empty if boxed in. Shooter-style pick-from-pool. */
export function pickFleeSteps(
  stack: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  random: () => number = Math.random,
): Axial[] {
  const unit = unitById(catalog, stack.unitId)
  if (!unit || unitIsStationary(unit) || (unit.speed ?? 0) <= 0) {
    return []
  }
  const kind = moveKindForUnit(unit, catalog)
  const occupied = occupiedForMover(battle.stacks, catalog, stack.id, kind)
  const reachable = combatReachable(
    { q: stack.q, r: stack.r },
    unit.speed ?? 0,
    tiles,
    kind,
    occupied,
    footprintSpecFor(stack, catalog),
    openBridgeMoatKeys(battle, catalog, tiles),
    stopOnlyForMover(battle, catalog, tiles, kind),
  )
  const here = hexKey(stack.q, stack.r)
  const options = [...reachable.entries()].filter(([key]) => key !== here)
  if (options.length === 0) {
    return []
  }
  const i = Math.min(options.length - 1, Math.floor(random() * options.length))
  return options[i]?.[1] ?? []
}
