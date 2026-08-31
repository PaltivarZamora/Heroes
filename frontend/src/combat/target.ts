import type { Axial } from '../hex/hero'
import type { ReferenceCatalog } from '../town/catalog'
import { unitById } from '../town/catalog'
import {
  attackIconFor,
  attackRangeFrom,
  type AttackIconKind,
} from './attack'
import type { CombatBattle, CombatStack, CombatTile } from './battle'
import {
  combatPathSteps,
  combatReachable,
  hexKey,
  moveKindForUnit,
  occupiedHexes,
  stackOccupyingHex,
} from './movement'

export type TargetIconKind = 'move' | AttackIconKind

export type CombatHover = {
  icon: TargetIconKind
  q: number
  r: number
  steps: Axial[]
  attackTargetId: string | null
}

function moverStats(
  stack: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
) {
  const unit = unitById(catalog, stack.unitId)
  const kind = moveKindForUnit(unit, catalog)
  const occupied = occupiedHexes(battle.stacks, catalog, stack.id)
  const budget = unit?.speed ?? 0
  const from = { q: stack.q, r: stack.r }
  return { unit, kind, occupied, budget, from }
}

/** Fewest-steps hex this stack can stand on and still be in attack range. */
export function bestAttackStand(
  attacker: CombatStack,
  target: CombatStack,
  reachable: Map<string, Axial[]>,
  catalog: ReferenceCatalog,
): Axial | null {
  if (attacker.side === target.side || attacker.id === target.id) {
    return null
  }
  let best: Axial | null = null
  let bestSteps = Infinity
  for (const [key, steps] of reachable) {
    const [qs, rs] = key.split(',')
    const from = { q: Number(qs), r: Number(rs) }
    if (!attackRangeFrom(from, target, catalog, attacker.unitId)) {
      continue
    }
    if (steps.length < bestSteps) {
      best = from
      bestSteps = steps.length
    }
  }
  return best
}

export function canStrikeThisTurn(
  attacker: CombatStack,
  battle: CombatBattle,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
): boolean {
  const { kind, occupied, budget, from } = moverStats(
    attacker,
    battle,
    catalog,
  )
  const reachable = combatReachable(from, budget, tiles, kind, occupied)
  return battle.stacks.some(
    (row) => bestAttackStand(attacker, row, reachable, catalog) != null,
  )
}

export function combatHover(
  attacker: CombatStack,
  hover: Axial,
  battle: CombatBattle,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
): CombatHover | null {
  const { unit, kind, occupied, budget, from } = moverStats(
    attacker,
    battle,
    catalog,
  )
  const occupant = stackOccupyingHex(
    battle.stacks,
    hover.q,
    hover.r,
    catalog,
  )
  const enemy =
    occupant && occupant.side !== attacker.side && occupant.id !== attacker.id
      ? occupant
      : null
  const reachable = combatReachable(from, budget, tiles, kind, occupied)

  if (enemy) {
    const stand = bestAttackStand(attacker, enemy, reachable, catalog)
    if (stand) {
      return {
        icon: attackIconFor(unit),
        q: enemy.q,
        r: enemy.r,
        steps: reachable.get(hexKey(stand.q, stand.r)) ?? [],
        attackTargetId: enemy.id,
      }
    }
    const steps = combatPathSteps(from, hover, budget, tiles, kind, occupied)
    if (steps.length === 0) {
      return null
    }
    return {
      icon: 'move',
      q: enemy.q,
      r: enemy.r,
      steps,
      attackTargetId: null,
    }
  }

  if (occupant) {
    return null
  }
  const steps = reachable.get(hexKey(hover.q, hover.r))
  if (!steps || steps.length === 0) {
    return null
  }
  return {
    icon: 'move',
    q: hover.q,
    r: hover.r,
    steps,
    attackTargetId: null,
  }
}
