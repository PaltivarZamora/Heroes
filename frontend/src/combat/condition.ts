import type { Axial } from '../hex/hero'
import { hexDistance } from '../hex/pathfinding'
import type { ReferenceCatalog } from '../town/catalog'
import {
  conditionName,
  unitAttackShape,
  unitById,
  unitHasTag,
  unitIsStationary,
} from '../town/catalog'
import type { CombatBattle, CombatStack, CombatTile } from './battle'
import { isHeroStack, stackMoveSpeed, stackDefense, stackResistance, scaleBySignedPct } from './battle'
import { chanceRollLog, rollChancePct } from './combatLog'
import {
  combatReachable,
  footprintSpecFor,
  hexKey,
  landingOccupiedForMover,
  moveKindForUnit,
  occupiedForMover,
  stopOnlyForMover,
} from './movement'
import { isCreatureArmyUnit, openBridgeMoatKeys, isUntargetableStack } from './siege'
import { tombstoneOccupancyBodies } from './tombstone'

export const FEAR_CONDITION_ID = 1
export const STUN_CONDITION_ID = 2
export const CONFUSE_CONDITION_ID = 3
export const SILENCE_CONDITION_ID = 4
export const BLIND_CONDITION_ID = 5
export const TAUNT_CONDITION_ID = 6
export const VANISH_CONDITION_ID = 9
/** BR S7-4: Slow — Speed −33% while active (duration from source ability). */
export const SLOW_CONDITION_ID = 12
export const POLYMORPH_ART_FILENAME = 'Polymorph_1.png'

/** Blind: attacks from the afflicted stack miss this often. */
export const BLIND_MISS_PCT = 50

/** Flat Speed reduction while Slow is active (not stat-scaled). */
export const SLOW_SPEED_REDUCTION_PCT = 33

export type ConditionExtra = {
  roundTick?: boolean
  /** Decrement duration once per hit taken (Taunt), not per round. */
  hitTick?: boolean
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

export function stunConditionId(catalog: ReferenceCatalog): number {
  const named = catalog.condition.find(
    (row) => row.value.trim().toLowerCase() === 'stun',
  )
  return named?.id ?? STUN_CONDITION_ID
}

export function isStunned(
  stack: CombatStack,
  catalog?: ReferenceCatalog,
): boolean {
  const id = catalog ? stunConditionId(catalog) : STUN_CONDITION_ID
  return conditionRemaining(stack, id) > 0
}

export function slowConditionId(catalog: ReferenceCatalog): number {
  const named = catalog.condition.find(
    (row) => row.value.trim().toLowerCase() === 'slow',
  )
  return named?.id ?? SLOW_CONDITION_ID
}

/** Slow: effective Speed reduced by SLOW_SPEED_REDUCTION_PCT while active. */
export function isSlowed(
  stack: CombatStack,
  catalog?: ReferenceCatalog,
): boolean {
  const id = catalog ? slowConditionId(catalog) : SLOW_CONDITION_ID
  return conditionRemaining(stack, id) > 0
}

export function confuseConditionId(catalog: ReferenceCatalog): number {
  const named = catalog.condition.find(
    (row) => row.value.trim().toLowerCase() === 'confuse',
  )
  return named?.id ?? CONFUSE_CONDITION_ID
}

/** Confuse: next action is a forced attack on the nearest unit (any side). */
export function isConfused(
  stack: CombatStack,
  catalog?: ReferenceCatalog,
): boolean {
  const id = catalog ? confuseConditionId(catalog) : CONFUSE_CONDITION_ID
  return conditionRemaining(stack, id) > 0
}

export function silenceConditionId(catalog: ReferenceCatalog): number {
  const named = catalog.condition.find(
    (row) => row.value.trim().toLowerCase() === 'silence',
  )
  return named?.id ?? SILENCE_CONDITION_ID
}

/**
 * Silence condition or Rift self-silence. Blocks Magic-type unit attacks
 * (and magic retaliation); Physical attacks and movement still work.
 */
export function isSilenced(
  stack: CombatStack,
  catalog?: ReferenceCatalog,
): boolean {
  if (stack.silenced === true) {
    return true
  }
  const id = catalog ? silenceConditionId(catalog) : SILENCE_CONDITION_ID
  return conditionRemaining(stack, id) > 0
}

/** True when this stack cannot fire its unit attack because of Silence. */
export function isMagicAttackSilenced(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): boolean {
  if (!isSilenced(stack, catalog)) {
    return false
  }
  const unit = unitById(catalog, stack.unitId)
  return (unit?.dmg_type ?? '').trim().toLowerCase() === 'magic'
}

export function vanishConditionId(catalog: ReferenceCatalog): number {
  const named = catalog.condition.find(
    (row) => row.value.trim().toLowerCase() === 'vanish',
  )
  return named?.id ?? VANISH_CONDITION_ID
}

/** Vanish: blocks direct single-target selection; AOE still hits. */
export function isVanished(
  stack: CombatStack,
  catalog?: ReferenceCatalog,
): boolean {
  const id = catalog ? vanishConditionId(catalog) : VANISH_CONDITION_ID
  return conditionRemaining(stack, id) > 0
}

export function blindConditionId(catalog: ReferenceCatalog): number {
  const named = catalog.condition.find(
    (row) => row.value.trim().toLowerCase() === 'blind',
  )
  return named?.id ?? BLIND_CONDITION_ID
}

/** Blind: afflicted stack's outgoing attacks have a miss chance. */
export function isBlinded(
  stack: CombatStack,
  catalog?: ReferenceCatalog,
): boolean {
  const id = catalog ? blindConditionId(catalog) : BLIND_CONDITION_ID
  return conditionRemaining(stack, id) > 0
}

export function tauntConditionId(catalog: ReferenceCatalog): number {
  const named = catalog.condition.find(
    (row) => row.value.trim().toLowerCase() === 'taunt',
  )
  return named?.id ?? TAUNT_CONDITION_ID
}

/** True while this stack is the active Taunt bait (condition on the taunter). */
export function isTaunting(
  stack: CombatStack,
  catalog?: ReferenceCatalog,
): boolean {
  const id = catalog ? tauntConditionId(catalog) : TAUNT_CONDITION_ID
  return conditionRemaining(stack, id) > 0
}

/**
 * Living taunting stack among `candidates` (usually the deciding unit's
 * enemies). Null if none — normal targeting applies.
 */
export function findTauntingStack(
  candidates: readonly CombatStack[],
  catalog: ReferenceCatalog,
): CombatStack | null {
  for (const row of candidates) {
    if (row.qty > 0 && isTaunting(row, catalog)) {
      return row
    }
  }
  return null
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

/** Beneficial conditions Cleanse / Mass Dispel leave alone. */
const POSITIVE_CONDITION_NAMES = new Set([
  'immunity',
  'vanish',
  'hyper focus',
])

export function isNegativeCondition(
  catalog: ReferenceCatalog,
  conditionId: number,
): boolean {
  const name = conditionName(catalog, conditionId).trim().toLowerCase()
  return name.length > 0 && !POSITIVE_CONDITION_NAMES.has(name)
}

export function hasNegativeCondition(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): boolean {
  for (const [rawId, left] of Object.entries(stack.conditions ?? {})) {
    if ((left ?? 0) <= 0) {
      continue
    }
    const id = Number(rawId)
    if (Number.isInteger(id) && isNegativeCondition(catalog, id)) {
      return true
    }
  }
  return false
}

/** Strip every active negative condition; returns cleared labels. */
export function clearNegativeConditions(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): { stack: CombatStack; cleared: string[] } {
  const cleared: string[] = []
  let next = stack
  for (const [rawId, left] of Object.entries(stack.conditions ?? {})) {
    if ((left ?? 0) <= 0) {
      continue
    }
    const id = Number(rawId)
    if (!Number.isInteger(id) || !isNegativeCondition(catalog, id)) {
      continue
    }
    cleared.push(conditionName(catalog, id))
    next = clearCondition(next, id)
  }
  return { stack: next, cleared }
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
  return scaleBySignedPct(base, pct)
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
  // Hyper Focus: block any condition once, then consume the buff.
  const focusLeft = target.conditionImmunityUsesLeft ?? 0
  if (focusLeft > 0) {
    const left = focusLeft - 1
    return {
      stack: {
        ...target,
        conditionImmunityUsesLeft: left > 0 ? left : undefined,
      },
      lines: [
        `${target.qty} ${name} shrug off ${label} (Hyper Focus${left > 0 ? ` — ${left} left` : ''}).`,
      ],
    }
  }
  if (spec.resistStat) {
    const chance = Math.min(100, liveResistance(target, catalog, spec.resistStat))
    if (Math.floor(random() * 100) < chance) {
      return {
        stack: target,
        lines: [
          `${target.qty} ${name}: ${chance}% ${spec.resistStat} vs ${label} — resisted!`,
        ],
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
  // Weeping Angel / similar: chance_pct gates the condition when it is not an
  // Assassin-style extra-attack roll (extra_attack_on_attack_only).
  if (
    !spec.extraAttackOnAttackOnly &&
    spec.chancePct != null &&
    spec.chancePct < 100
  ) {
    const chance = spec.chancePct
    const triggered = rollChancePct(chance, random)
    const label = conditionName(catalog, conditionId)
    const rollLine = chanceRollLog(
      unitById(catalog, striker.unitId)?.name ?? 'Attacker',
      chance,
      triggered,
      { action: `to inflict ${label}` },
    )
    if (!triggered) {
      return { stack: target, lines: [rollLine] }
    }
    const inflicted = tryInflictSpec(
      target,
      catalog,
      {
        conditionId,
        resistStat: spec.resistStat,
        duration: spec.conditionDuration,
      },
      random,
    )
    return {
      stack: inflicted.stack,
      lines: [rollLine, ...inflicted.lines],
    }
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

/** Taunt-style conditions: one hit taken consumes one duration charge. */
export function applyHitTickConditions(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): { stack: CombatStack; lines: string[] } {
  const extra = stack.conditionExtra ?? {}
  const lines: string[] = []
  let next = stack
  for (const [rawId, spec] of Object.entries(extra)) {
    if (!spec?.hitTick) {
      continue
    }
    const conditionId = Number(rawId)
    if (!Number.isInteger(conditionId) || conditionRemaining(next, conditionId) <= 0) {
      continue
    }
    const before = conditionRemaining(next, conditionId)
    next = consumeCondition(next, conditionId)
    if (before > 0 && conditionRemaining(next, conditionId) <= 0) {
      const name = unitById(catalog, next.unitId)?.name ?? 'Unknown'
      const label = conditionName(catalog, conditionId)
      lines.push(`${next.qty} ${name} are no longer under ${label}.`)
    }
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
        if (chance > 0) {
          const triggered = Math.floor(random() * 100) < chance
          lines.push(
            chanceRollLog(`${live.qty} ${name}`, chance, triggered, {
              action: `to break free of ${label}`,
            }),
          )
          if (triggered) {
            live = clearCondition(live, conditionId)
            continue
          }
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
  const tombs = tombstoneOccupancyBodies(battle.tombstones)
  const occupied = occupiedForMover(battle.stacks, catalog, stack.id, kind)
  const landOccupied = landingOccupiedForMover(
    battle.stacks,
    catalog,
    stack.id,
    tombs,
  )
  const reachable = combatReachable(
    { q: stack.q, r: stack.r },
    speed,
    tiles,
    kind,
    occupied,
    footprintSpecFor(stack, catalog),
    openBridgeMoatKeys(battle, catalog, tiles),
    stopOnlyForMover(battle, catalog, tiles, kind),
    landOccupied,
  )
  const here = hexKey(stack.q, stack.r)
  const options = [...reachable.entries()].filter(([key]) => key !== here)
  if (options.length === 0) {
    return []
  }
  const i = Math.min(options.length - 1, Math.floor(random() * options.length))
  return options[i]?.[1] ?? []
}

/**
 * Nearest living stack (friend or foe) by hex distance. Ties broken randomly.
 * Heroes and untargetable stacks are eligible only if living and not self.
 */
export function pickNearestUnitAnySide(
  stack: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  random: () => number = Math.random,
): CombatStack | null {
  const candidates: CombatStack[] = []
  let bestDist = Infinity
  for (const row of battle.stacks) {
    if (row.id === stack.id || row.qty <= 0 || isHeroStack(row)) {
      continue
    }
    if (isUntargetableStack(row, catalog) || isVanished(row, catalog)) {
      continue
    }
    const dist = hexDistance(
      { q: stack.q, r: stack.r },
      { q: row.q, r: row.r },
    )
    if (dist < 1) {
      continue
    }
    if (dist < bestDist) {
      bestDist = dist
      candidates.length = 0
      candidates.push(row)
    } else if (dist === bestDist) {
      candidates.push(row)
    }
  }
  if (candidates.length === 0) {
    return null
  }
  const i = Math.min(
    candidates.length - 1,
    Math.floor(random() * candidates.length),
  )
  return candidates[i] ?? null
}

/**
 * Forced Retreat: path toward battle-start hex with no Speed budget.
 * If the exact start is unreachable, land as close as possible.
 */
export function pickRetreatSteps(
  stack: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): Axial[] {
  const start = stack.startHex
  const unit = unitById(catalog, stack.unitId)
  if (!start || !unit || unitIsStationary(unit) || isHeroStack(stack)) {
    return []
  }
  if (stack.q === start.q && stack.r === start.r) {
    return []
  }
  const kind = moveKindForUnit(unit, catalog)
  const tombs = tombstoneOccupancyBodies(battle.tombstones)
  const occupied = occupiedForMover(battle.stacks, catalog, stack.id, kind)
  const landOccupied = landingOccupiedForMover(
    battle.stacks,
    catalog,
    stack.id,
    tombs,
  )
  // Ignore normal movement points — walk the full path this turn.
  const REACH_BUDGET = 999
  const reachable = combatReachable(
    { q: stack.q, r: stack.r },
    REACH_BUDGET,
    tiles,
    kind,
    occupied,
    footprintSpecFor(stack, catalog),
    openBridgeMoatKeys(battle, catalog, tiles),
    stopOnlyForMover(battle, catalog, tiles, kind),
    landOccupied,
  )
  const startKey = hexKey(start.q, start.r)
  const exact = reachable.get(startKey)
  if (exact) {
    return exact
  }
  let bestSteps: Axial[] = []
  let bestDist = Infinity
  let bestLen = Infinity
  for (const [key, steps] of reachable) {
    const comma = key.indexOf(',')
    const q = Number(key.slice(0, comma))
    const r = Number(key.slice(comma + 1))
    if (!Number.isFinite(q) || !Number.isFinite(r)) {
      continue
    }
    const dist = hexDistance({ q, r }, start)
    if (dist < bestDist || (dist === bestDist && steps.length < bestLen)) {
      bestDist = dist
      bestLen = steps.length
      bestSteps = steps
    }
  }
  return bestSteps
}
