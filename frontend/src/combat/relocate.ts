import type { Axial } from '../hex/hero'
import { hexDistance } from '../hex/pathfinding'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import { unitById, unitFootprint } from '../town/catalog'
import {
  isHeroStack,
  moveStack,
  type CombatBattle,
  type CombatSide,
  type CombatStack,
  type CombatTile,
} from './battle'
import { combatCanLandOn, combatEnterCost, moveKindForUnit } from './movement'
import {
  footprintFits,
  footprintAlong,
  occupancyKey,
  occupiedHexes,
} from './occupancy'
import { incomingDir } from './shapes'
import { tombstoneOccupancyBodies } from './tombstone'

function asFinite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function asDistRange(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null
  }
  const a = asFinite(value[0])
  const b = asFinite(value[1])
  if (a == null || b == null) {
    return null
  }
  const lo = Math.max(0, Math.floor(Math.min(a, b)))
  const hi = Math.max(0, Math.floor(Math.max(a, b)))
  return [lo, hi]
}

export function landableHexes(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  stack: CombatStack,
  unit: UnitRow,
): Axial[] {
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
  return tiles
    .filter((tile) =>
      footprintFits(
        { q: tile.q, r: tile.r },
        code,
        along,
        occupied,
        enterCost,
      ),
    )
    .map((tile) => ({ q: tile.q, r: tile.r }))
}

function pickAtDistance(
  from: Axial,
  candidates: Axial[],
  minDist: number,
  maxDist: number,
  random: () => number,
): Axial | null {
  const pool = candidates.filter((hex) => {
    const d = hexDistance(from, hex)
    return d >= minDist && d <= maxDist
  })
  if (pool.length === 0) {
    return null
  }
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? null
}

/**
 * General forced relocation: prefer `move_dist_range`, then `move_dist_fallback`,
 * then any open hex. No open hex → leave unit in place.
 */
export function relocateRandom(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  stackId: string,
  stats: Record<string, unknown>,
  random: () => number = Math.random,
): { battle: CombatBattle; moved: boolean; to: Axial | null } {
  if (stats.move_type !== 'random') {
    return { battle, moved: false, to: null }
  }
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || stack.qty <= 0 || isHeroStack(stack)) {
    return { battle, moved: false, to: null }
  }
  const unit = unitById(catalog, stack.unitId)
  if (!unit) {
    return { battle, moved: false, to: null }
  }
  const from = { q: stack.q, r: stack.r }
  const open = landableHexes(battle, catalog, tiles, stack, unit).filter(
    (hex) => occupancyKey(hex.q, hex.r) !== occupancyKey(from.q, from.r),
  )
  if (open.length === 0) {
    return { battle, moved: false, to: null }
  }
  const range = asDistRange(stats.move_dist_range)
  let pick: Axial | null = null
  if (range) {
    pick = pickAtDistance(from, open, range[0], range[1], random)
  }
  if (!pick) {
    const fallback = asFinite(stats.move_dist_fallback)
    if (fallback != null && fallback > 0) {
      const d = Math.floor(fallback)
      pick = pickAtDistance(from, open, d, d, random)
    }
  }
  if (!pick) {
    pick = open[Math.min(open.length - 1, Math.floor(random() * open.length))] ?? null
  }
  if (!pick) {
    return { battle, moved: false, to: null }
  }
  return {
    battle: moveStack(battle, stackId, pick.q, pick.r),
    moved: true,
    to: pick,
  }
}

/**
 * Instant relocate toward `goal` (exact if open, else nearest landable).
 * Used by Chronomancer retaliation teleport.
 */
export function relocateNearestTo(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  stackId: string,
  goal: Axial,
): { battle: CombatBattle; moved: boolean; to: Axial | null } {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || stack.qty <= 0 || isHeroStack(stack)) {
    return { battle, moved: false, to: null }
  }
  const unit = unitById(catalog, stack.unitId)
  if (!unit) {
    return { battle, moved: false, to: null }
  }
  const open = landableHexes(battle, catalog, tiles, stack, unit)
  if (open.length === 0) {
    return { battle, moved: false, to: null }
  }
  let best = open[0]!
  let bestDist = hexDistance(best, goal)
  for (const hex of open) {
    const dist = hexDistance(hex, goal)
    if (
      dist < bestDist ||
      (dist === bestDist &&
        (hex.q < best.q || (hex.q === best.q && hex.r < best.r)))
    ) {
      best = hex
      bestDist = dist
    }
  }
  if (best.q === stack.q && best.r === stack.r) {
    return { battle, moved: false, to: best }
  }
  return {
    battle: moveStack(battle, stackId, best.q, best.r),
    moved: true,
    to: best,
  }
}

/** Aimed teleport: land `stackId` on `to` if footprint fits. */
export function relocateToHex(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  stackId: string,
  to: Axial,
): { battle: CombatBattle; moved: boolean } {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || stack.qty <= 0 || isHeroStack(stack)) {
    return { battle, moved: false }
  }
  const unit = unitById(catalog, stack.unitId)
  if (!unit) {
    return { battle, moved: false }
  }
  const open = landableHexes(battle, catalog, tiles, stack, unit)
  if (!open.some((hex) => hex.q === to.q && hex.r === to.r)) {
    return { battle, moved: false }
  }
  if (stack.q === to.q && stack.r === to.r) {
    return { battle, moved: false }
  }
  return {
    battle: moveStack(battle, stackId, to.q, to.r),
    moved: true,
  }
}

/**
 * Push Back: walk `distance` steps away from `from` along the caster→target
 * line. Stops at the farthest landable hex if blocked early.
 */
export function relocateAwayFrom(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  stackId: string,
  from: Axial,
  distance: number,
): { battle: CombatBattle; moved: boolean; to: Axial | null; steps: number } {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || stack.qty <= 0 || isHeroStack(stack) || distance <= 0) {
    return { battle, moved: false, to: null, steps: 0 }
  }
  const unit = unitById(catalog, stack.unitId)
  if (!unit) {
    return { battle, moved: false, to: null, steps: 0 }
  }
  const dir = incomingDir(from, { q: stack.q, r: stack.r })
  const open = new Set(
    landableHexes(battle, catalog, tiles, stack, unit).map((hex) =>
      occupancyKey(hex.q, hex.r),
    ),
  )
  let cur = { q: stack.q, r: stack.r }
  let lastGood: Axial | null = null
  let steps = 0
  for (let i = 0; i < distance; i += 1) {
    const next = { q: cur.q + dir.q, r: cur.r + dir.r }
    if (!open.has(occupancyKey(next.q, next.r))) {
      break
    }
    cur = next
    lastGood = next
    steps += 1
  }
  if (!lastGood || (lastGood.q === stack.q && lastGood.r === stack.r)) {
    return { battle, moved: false, to: null, steps: 0 }
  }
  return {
    battle: moveStack(battle, stackId, lastGood.q, lastGood.r),
    moved: true,
    to: lastGood,
    steps,
  }
}

export type { CombatSide }
