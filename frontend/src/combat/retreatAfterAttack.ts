import {
  unitAttackShape,
  unitById,
  type ReferenceCatalog,
} from '../town/catalog'
import type { CombatBattle, CombatTile } from './battle'
import { relocateNearestTo } from './relocate'

function stackName(catalog: ReferenceCatalog, unitId: number): string {
  return unitById(catalog, unitId)?.name ?? 'Unknown'
}

/** Record where the stack stood when its activation began (move-then-attack retreat). */
export function snapshotTurnStartHex(
  battle: CombatBattle,
  stackId: string,
): CombatBattle {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || stack.qty <= 0) {
    return battle
  }
  return {
    ...battle,
    stacks: battle.stacks.map((row) =>
      row.id === stackId
        ? { ...row, turnStartHex: { q: row.q, r: row.r } }
        : row,
    ),
  }
}

export function snapshotActiveTurnStartHex(battle: CombatBattle): CombatBattle {
  const id = battle.order[battle.activeIndex]
  if (!id) {
    return battle
  }
  return snapshotTurnStartHex(battle, id)
}

export function tryRetreatAfterAttack(
  battle: CombatBattle,
  stackId: string,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): { battle: CombatBattle; line: string | null } {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || stack.qty <= 0) {
    return { battle, line: null }
  }
  const spec = unitAttackShape(unitById(catalog, stack.unitId))
  if (!spec.retreatAfterAttack) {
    return { battle, line: null }
  }
  const goal = stack.turnStartHex ?? { q: stack.q, r: stack.r }
  if (stack.q === goal.q && stack.r === goal.r) {
    return { battle, line: null }
  }
  const moved = relocateNearestTo(battle, catalog, tiles, stackId, goal)
  if (!moved.moved || !moved.to) {
    return { battle, line: null }
  }
  const name = stackName(catalog, stack.unitId)
  return {
    battle: {
      ...moved.battle,
      stacks: moved.battle.stacks.map((row) =>
        row.id === stackId
          ? {
              ...row,
              q: moved.to!.q,
              r: moved.to!.r,
              movedThisTurn: undefined,
            }
          : row,
      ),
    },
    line: `${name} retreats`,
  }
}
