import { neighborHexes } from '../hex/pathfinding'
import type { ReferenceCatalog } from '../town/catalog'
import {
  retaliationCharges,
  unitAttackShape,
  unitById,
  unitFootprint,
} from '../town/catalog'
import {
  insertIntoRemainingInitiative,
  isHeroStack,
  type CombatBattle,
  type CombatStack,
  type CombatTile,
} from './battle'
import { combatCanLandOn, combatEnterCost, moveKindForUnit } from './movement'
import {
  footprintFits,
  footprintAlong,
  occupiedHexes,
} from './occupancy'
import { tombstoneOccupancyBodies } from './tombstone'

function nextSplitId(stacks: CombatStack[], side: CombatStack['side']): string {
  let n = 1
  let id = `combat-${side}-split-${n}`
  while (stacks.some((row) => row.id === id)) {
    n += 1
    id = `combat-${side}-split-${n}`
  }
  return id
}

/**
 * Mud Golem: before acting, split qty in half onto an adjacent open hex.
 * Never split on the turn a stack was created (summon or prior split).
 * Qty 1 never splits. Odd qty: floor half goes to the new stack.
 */
export function tryAutoSplitOnTurn(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  stackId: string,
): { battle: CombatBattle; lines: string[] } | null {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || stack.qty <= 1 || isHeroStack(stack)) {
    return null
  }
  const unit = unitById(catalog, stack.unitId)
  if (!unit) {
    return null
  }
  const abilities = unitAttackShape(unit)
  if (!abilities.autoSplitOnTurn) {
    return null
  }
  // Skip the creation turn (summon or split). Prefer spawnedRound; if missing
  // on a skipFirstTurn unit, treat as ineligible this turn (safe default).
  if (abilities.skipFirstTurn) {
    if (stack.spawnedRound == null || stack.spawnedRound === battle.round) {
      return null
    }
  }
  const splitQty = Math.floor(stack.qty / 2)
  if (splitQty <= 0) {
    return null
  }
  const remainQty = stack.qty - splitQty
  const occupied = occupiedHexes(
    battle.stacks,
    catalog,
    stack.id,
    tombstoneOccupancyBodies(battle.tombstones),
  )
  const kind = moveKindForUnit(unit, catalog)
  const enterCost = (q: number, r: number) => {
    const tile = tiles.find((row) => row.q === q && row.r === r)
    if (!combatCanLandOn(tile, kind)) {
      return null
    }
    return combatEnterCost(tile, kind)
  }
  const code = unitFootprint(unit)
  const along = footprintAlong(stack.side)
  const open = neighborHexes({ q: stack.q, r: stack.r }).filter((hex) =>
    footprintFits(hex, code, along, occupied, enterCost),
  )
  if (open.length === 0) {
    return null
  }
  const at = open[Math.floor(Math.random() * open.length)]!
  const childId = nextSplitId(battle.stacks, stack.side)
  const child: CombatStack = {
    ...stack,
    id: childId,
    qty: splitQty,
    startingQty: splitQty,
    topHealth: Math.max(1, unit.health),
    q: at.q,
    r: at.r,
    hasActedThisRound: false,
    retaliationsLeft: retaliationCharges(unit),
    // New stack — must wait until its own next turn before splitting.
    spawnedRound: battle.round,
    startHex: { q: at.q, r: at.r },
    summonSeq: (stack.summonSeq ?? 0) + 1000,
  }
  let next: CombatBattle = {
    ...battle,
    stacks: [
      ...battle.stacks.map((row) =>
        row.id === stack.id
          ? { ...row, qty: remainQty, startingQty: Math.max(row.startingQty, remainQty) }
          : row,
      ),
      child,
    ],
  }
  if (unit.speed != null) {
    next = {
      ...next,
      order: next.order.includes(childId) ? next.order : [...next.order, childId],
    }
    next = insertIntoRemainingInitiative(next, catalog, childId)
  }
  return {
    battle: next,
    lines: [
      `${remainQty} ${unit.name} split into ${remainQty} and ${splitQty} ${unit.name}.`,
    ],
  }
}
