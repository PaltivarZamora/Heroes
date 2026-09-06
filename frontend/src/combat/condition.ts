import type { Axial } from '../hex/hero'
import type { ReferenceCatalog } from '../town/catalog'
import {
  conditionName,
  unitAttackShape,
  unitById,
  unitHasTag,
  unitIsStationary,
} from '../town/catalog'
import type { CombatBattle, CombatStack, CombatTile } from './battle'
import { isHeroStack, stackMoveSpeed, stackDefense, stackResistance } from './battle'
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
export const POLYMORPH_ART_FILENAME = 'Polymorph_1.png'

export type ConditionExtra = {
  roundTick?: boolean
  breaksOnDamage?: boolean
  breakChancePctStat?: number
}

export type InflictSpec = {
  conditionId: number
  resistStat: 'resistance' | 'defense' | null
  duration: number
  requiredTag?: number | null
  extra?: ConditionExtra
}

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

export function polymorphConditionId(catalog: ReferenceCatalog): number {
  const named = catalog.condition.find(
    (row) => row.value.trim().toLowerCase() === 'polymorph',
  )
  return named?.id ?? 0
}

export function isPolymorphed(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): boolean {
  const id = polymorphConditionId(catalog)
  return id > 0 && conditionRemaining(stack, id) > 0
}

export function polymorphConditionName(catalog: ReferenceCatalog): string {
  const id = polymorphConditionId(catalog)
  if (id > 0) {
    return conditionName(catalog, id)
  }
  return 'Polymorph'
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

export function clearCondition(
  stack: CombatStack,
  conditionId: number,
): CombatStack {
  const conditions = { ...(stack.conditions ?? {}) }
  delete conditions[conditionId]
  const conditionExtra = { ...(stack.conditionExtra ?? {}) }
  delete conditionExtra[conditionId]
  return { ...stack, conditions, conditionExtra }
}

export function consumeCondition(
  stack: CombatStack,
  conditionId: number,
): CombatStack {
  const left = conditionRemaining(stack, conditionId) - 1
  if (left <= 0) {
    return clearCondition(stack, conditionId)
  }
  return {
    ...stack,
    conditions: { ...(stack.conditions ?? {}), [conditionId]: left },
  }
}

export function liveResistance(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  stat: 'resistance' | 'defense',
): number {
  const base =
    stat === 'defense'
      ? stackDefense(stack, catalog)
      : stackResistance(stack, catalog)
  const pct =
    stat === 'defense'
      ? (stack.mitigationPct?.defense ?? 0)
      : (stack.mitigationPct?.resistance ?? 0)
  if (!pct) {
    return Math.max(0, base)
  }
  return Math.max(0, Math.floor((base * (100 + pct)) / 100))
}

function canReceiveCondition(
  target: CombatStack,
  catalog: ReferenceCatalog,
  requiredTag?: number | null,
): boolean {
  if (
    target.indestructible ||
    isHeroStack(target) ||
    !isCreatureArmyUnit(unitById(catalog, target.unitId))
  ) {
    return false
  }
  if (requiredTag != null && requiredTag > 0) {
    return unitHasTag(unitById(catalog, target.unitId), requiredTag)
  }
  return true
}

export function tryInflictSpec(
  target: CombatStack,
  catalog: ReferenceCatalog,
  spec: InflictSpec,
  random: () => number = Math.random,
): { stack: CombatStack; lines: string[] } {
  if (spec.conditionId <= 0 || !canReceiveCondition(target, catalog, spec.requiredTag)) {
    return { stack: target, lines: [] }
  }
  const name = unitById(catalog, target.unitId)?.name ?? 'Unknown'
  const label = conditionName(catalog, spec.conditionId)
  if (spec.resistStat) {
    const chance = Math.min(100, liveResistance(target, catalog, spec.resistStat))
    if (Math.floor(random() * 100) < chance) {
      return {
        stack: target,
        lines: [`${target.qty} ${name} resisted ${label}.`],
      }
    }
  }
  const duration = Math.max(1, spec.duration)
  let next: CombatStack = {
    ...target,
    conditions: { ...(target.conditions ?? {}), [spec.conditionId]: duration },
  }
  if (spec.extra) {
    next = {
      ...next,
      conditionExtra: {
        ...(target.conditionExtra ?? {}),
        [spec.conditionId]: spec.extra,
      },
    }
  }
  return {
    stack: next,
    lines: [`${target.qty} ${name} are afflicted with ${label}.`],
  }
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
  return tryInflictSpec(
    target,
    catalog,
    {
      conditionId,
      resistStat: spec.resistStat,
      duration: spec.conditionDuration,
    },
    random,
  )
}

export function applyBreaksOnDamage(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): { stack: CombatStack; lines: string[] } {
  const extra = stack.conditionExtra ?? {}
  const lines: string[] = []
  let next = stack
  for (const [rawId, spec] of Object.entries(extra)) {
    if (!spec?.breaksOnDamage) {
      continue
    }
    const conditionId = Number(rawId)
    if (!Number.isInteger(conditionId) || conditionRemaining(next, conditionId) <= 0) {
      continue
    }
    const name = unitById(catalog, next.unitId)?.name ?? 'Unknown'
    const label = conditionName(catalog, conditionId)
    lines.push(`${next.qty} ${name} break free of ${label}.`)
    next = clearCondition(next, conditionId)
  }
  return { stack: next, lines }
}

export function tickRoundConditions(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  random: () => number,
): { stacks: CombatStack[]; lines: string[] } {
  const lines: string[] = []
  const next = stacks.map((stack) => {
    let live = stack
    for (const [rawId, spec] of Object.entries(stack.conditionExtra ?? {})) {
      if (!spec?.roundTick) {
        continue
      }
      const conditionId = Number(rawId)
      if (!Number.isInteger(conditionId) || conditionRemaining(live, conditionId) <= 0) {
        continue
      }
      const name = unitById(catalog, live.unitId)?.name ?? 'Unknown'
      const label = conditionName(catalog, conditionId)
      if (spec.breakChancePctStat != null) {
        const chance = Math.min(
          100,
          Math.floor(liveResistance(live, catalog, 'resistance') * spec.breakChancePctStat),
        )
        if (Math.floor(random() * 100) < chance) {
          lines.push(`${live.qty} ${name} break free of ${label}.`)
          live = clearCondition(live, conditionId)
          continue
        }
      }
      const left = conditionRemaining(live, conditionId) - 1
      if (left <= 0) {
        lines.push(`${label} fades from ${live.qty} ${name}.`)
        live = clearCondition(live, conditionId)
      } else {
        live = {
          ...live,
          conditions: { ...(live.conditions ?? {}), [conditionId]: left },
        }
      }
    }
    return live
  })
  return { stacks: next, lines }
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
  const speed = stackMoveSpeed(stack, catalog) ?? 0
  if (!unit || unitIsStationary(unit) || speed <= 0) {
    return []
  }
  const kind = moveKindForUnit(unit, catalog)
  const occupied = occupiedForMover(battle.stacks, catalog, stack.id, kind)
  const reachable = combatReachable(
    { q: stack.q, r: stack.r },
    speed,
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
