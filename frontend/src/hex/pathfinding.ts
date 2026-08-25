import { getTile, isWalkable } from './world'
import type { Axial } from './hero'

const AXIAL_NEIGHBORS: Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

/** Cheapest walkable terrain — admissible A* heuristic scale. */
const MIN_STEP_COST = 0.9

function key(q: number, r: number): string {
  return `${q},${r}`
}

/** Terrain/fog walkable, and not occupied by a map object this path. */
function isPathHexOpen(
  q: number,
  r: number,
  blocked?: ReadonlySet<string>,
): boolean {
  if (!isWalkable(q, r)) {
    return false
  }
  return !blocked?.has(key(q, r))
}

export function hexDistance(from: Axial, to: Axial): number {
  const dq = from.q - to.q
  const dr = from.r - to.r
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}

export function neighborHexes(at: Axial): Axial[] {
  return AXIAL_NEIGHBORS.map((delta) => ({
    q: at.q + delta.q,
    r: at.r + delta.r,
  }))
}

function pathEnterCost(path: Axial[]): number {
  let cost = 0
  for (let i = 1; i < path.length; i++) {
    const tile = getTile(path[i].q, path[i].r)
    const step = tile?.movementCostMultiplier
    if (step == null) {
      return Infinity
    }
    cost += step
  }
  return cost
}

/**
 * Cheapest walkable hex next to `target` (never `target` itself).
 * The mover's current hex is allowed even if it would otherwise look blocked.
 */
export function approachHex(
  from: Axial,
  target: Axial,
  blocked?: ReadonlySet<string>,
): Axial | null {
  let best: Axial | null = null
  let bestCost = Infinity
  let bestDist = Infinity
  for (const next of neighborHexes(target)) {
    const here = next.q === from.q && next.r === from.r
    if (!here && !isPathHexOpen(next.q, next.r, blocked)) {
      continue
    }
    if (here) {
      return next
    }
    const path = findPath(from, next, blocked)
    if (!path) {
      continue
    }
    const cost = pathEnterCost(path)
    const dist = hexDistance(from, next)
    if (cost + 1e-9 < bestCost || (Math.abs(cost - bestCost) < 1e-9 && dist < bestDist)) {
      bestCost = cost
      bestDist = dist
      best = next
    }
  }
  return best
}

/**
 * Lowest-cost path between two passable hexes. Returns null if none.
 * Path includes start and destination. Cost is paid on entering a hex.
 * `blocked` is other heroes, towns, and resource nodes for this path only —
 * not baked into terrain. Callers omit the destination when that hex is a
 * walk-onto target (town, mine, or pickup). Heroes are never omitted.
 */
export function findPath(
  from: Axial,
  to: Axial,
  blocked?: ReadonlySet<string>,
): Axial[] | null {
  if (from.q === to.q && from.r === to.r) {
    return [from]
  }
  if (!isWalkable(from.q, from.r) || !isPathHexOpen(to.q, to.r, blocked)) {
    return null
  }

  const startKey = key(from.q, from.r)
  const goalKey = key(to.q, to.r)
  const cameFrom = new Map<string, Axial>()
  const gScore = new Map<string, number>([[startKey, 0]])
  const fScore = new Map<string, number>([
    [startKey, MIN_STEP_COST * hexDistance(from, to)],
  ])
  const open = new Map<string, Axial>([[startKey, from]])

  while (open.size > 0) {
    let bestKey = ''
    let bestF = Infinity
    let current: Axial | undefined
    for (const [openKey, node] of open) {
      const f = fScore.get(openKey) ?? Infinity
      if (f < bestF) {
        bestF = f
        bestKey = openKey
        current = node
      }
    }
    if (!current) {
      break
    }
    if (bestKey === goalKey) {
      return reconstruct(cameFrom, current)
    }
    open.delete(bestKey)

    for (const delta of AXIAL_NEIGHBORS) {
      const next = { q: current.q + delta.q, r: current.r + delta.r }
      if (!isPathHexOpen(next.q, next.r, blocked)) {
        continue
      }
      const tile = getTile(next.q, next.r)
      const cost = tile?.movementCostMultiplier
      if (cost == null) {
        continue
      }
      const nextKey = key(next.q, next.r)
      const tentative = (gScore.get(bestKey) ?? Infinity) + cost
      if (tentative + 1e-9 >= (gScore.get(nextKey) ?? Infinity)) {
        continue
      }
      cameFrom.set(nextKey, current)
      gScore.set(nextKey, tentative)
      fScore.set(nextKey, tentative + MIN_STEP_COST * hexDistance(next, to))
      open.set(nextKey, next)
    }
  }
  return null
}

function reconstruct(cameFrom: Map<string, Axial>, end: Axial): Axial[] {
  const path: Axial[] = [end]
  let cursor = end
  let cursorKey = key(cursor.q, cursor.r)
  while (cameFrom.has(cursorKey)) {
    cursor = cameFrom.get(cursorKey)!
    path.push(cursor)
    cursorKey = key(cursor.q, cursor.r)
  }
  path.reverse()
  return path
}
