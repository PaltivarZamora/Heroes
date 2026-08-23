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

export function hexDistance(from: Axial, to: Axial): number {
  const dq = from.q - to.q
  const dr = from.r - to.r
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}

/**
 * Lowest-cost path between two passable hexes. Returns null if none.
 * Path includes start and destination. Cost is paid on entering a hex.
 */
export function findPath(from: Axial, to: Axial): Axial[] | null {
  if (from.q === to.q && from.r === to.r) {
    return [from]
  }
  if (!isWalkable(from.q, from.r) || !isWalkable(to.q, to.r)) {
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
      if (!isWalkable(next.q, next.r)) {
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
