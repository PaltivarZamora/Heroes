import { getTile, isPassable, isWalkable } from './world'
import type { Axial } from './hero'

const AXIAL_NEIGHBORS: Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

/** Catalog move_cost 99: enter by dumping remaining MP, not a literal 99 cost. */
const DUMP_REMAINING_MOVE_COST = 99

/** Cheapest walkable terrain — admissible A* heuristic scale. */
const MIN_STEP_COST = 0.9

function key(q: number, r: number): string {
  return `${q},${r}`
}

/** Terrain walkable, and not occupied by a map object this path. */
function isPathHexOpen(
  q: number,
  r: number,
  blocked?: ReadonlySet<string>,
  ignoreFog = false,
): boolean {
  if (ignoreFog ? !isPassable(q, r) : !isWalkable(q, r)) {
    return false
  }
  return !blocked?.has(key(q, r))
}

function terrainEnterCost(q: number, r: number): number | null {
  const tile = getTile(q, r)
  if (!tile || tile.blocked) {
    return null
  }
  return tile.movementCostMultiplier
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
    if (!tile || tile.blocked) {
      return Infinity
    }
    const step = tile.movementCostMultiplier
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
 * Same A* as World `findPath`, with caller-supplied enter cost / walkability.
 * Path includes start and destination. Cost is paid on entering a hex.
 */
export function findPathOnBoard(
  from: Axial,
  to: Axial,
  enterCost: (q: number, r: number) => number | null,
  blocked?: ReadonlySet<string>,
  canEnter?: (q: number, r: number) => boolean,
): Axial[] | null {
  if (from.q === to.q && from.r === to.r) {
    return [from]
  }
  const allowed = (q: number, r: number) => {
    if (canEnter) {
      return canEnter(q, r)
    }
    if (blocked?.has(key(q, r))) {
      return false
    }
    return enterCost(q, r) != null
  }
  if (!allowed(to.q, to.r)) {
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

    for (const next of neighborHexes(current)) {
      if (!allowed(next.q, next.r)) {
        continue
      }
      const cost = enterCost(next.q, next.r)
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

/**
 * Lowest-cost path between two passable hexes. Returns null if none.
 * Path includes start and destination. Cost is paid on entering a hex.
 * `blocked` is other heroes, towns, and resource nodes for this path only —
 * not baked into terrain. Callers omit the destination when that hex is a
 * walk-onto target (town, mine, or pickup). Heroes are never omitted.
 * Default stays in explored fog; pass `ignoreFog` for player hover/click.
 */
export function findPath(
  from: Axial,
  to: Axial,
  blocked?: ReadonlySet<string>,
  ignoreFog = false,
): Axial[] | null {
  if (from.q === to.q && from.r === to.r) {
    return [from]
  }
  const open = (q: number, r: number) => isPathHexOpen(q, r, blocked, ignoreFog)
  if (!open(to.q, to.r)) {
    return null
  }
  return findPathOnBoard(
    from,
    to,
    terrainEnterCost,
    blocked,
    (q, r) => (q === from.q && r === from.r) || open(q, r),
  )
}

/**
 * Player hover/click: path through fog, or as close as passable terrain allows.
 * AI still uses `findPath` (explored only).
 */
export function findPathToward(
  from: Axial,
  to: Axial,
  blocked?: ReadonlySet<string>,
): Axial[] | null {
  const direct = findPath(from, to, blocked, true)
  if (direct) {
    return direct
  }
  const startKey = key(from.q, from.r)
  const goalDist = hexDistance(from, to)
  if (goalDist <= 0) {
    return [from]
  }
  const cameFrom = new Map<string, Axial>()
  const gScore = new Map<string, number>([[startKey, 0]])
  const posByKey = new Map<string, Axial>([[startKey, from]])
  const open = new Map<string, Axial>([[startKey, from]])
  while (open.size > 0) {
    let bestKey = ''
    let bestG = Infinity
    let current: Axial | undefined
    for (const [openKey, node] of open) {
      const g = gScore.get(openKey) ?? Infinity
      if (g < bestG) {
        bestG = g
        bestKey = openKey
        current = node
      }
    }
    if (!current) {
      break
    }
    open.delete(bestKey)
    for (const next of neighborHexes(current)) {
      const nextKey = key(next.q, next.r)
      if (blocked?.has(nextKey) && nextKey !== startKey) {
        continue
      }
      const cost = terrainEnterCost(next.q, next.r)
      if (cost == null) {
        continue
      }
      const tentative = bestG + cost
      if (tentative + 1e-9 >= (gScore.get(nextKey) ?? Infinity)) {
        continue
      }
      cameFrom.set(nextKey, current)
      gScore.set(nextKey, tentative)
      posByKey.set(nextKey, next)
      open.set(nextKey, next)
    }
  }
  let best: Axial | null = null
  let bestDist = goalDist
  let bestCost = Infinity
  for (const [hexKey, pos] of posByKey) {
    if (hexKey === startKey) {
      continue
    }
    const dist = hexDistance(pos, to)
    const cost = gScore.get(hexKey) ?? Infinity
    if (dist + 1e-9 < bestDist || (Math.abs(dist - bestDist) < 1e-9 && cost < bestCost)) {
      bestDist = dist
      bestCost = cost
      best = pos
    }
  }
  return best ? reconstruct(cameFrom, best) : null
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

/**
 * Every hex reachable within `budget`, paying `enterCost` on entry.
 * Start hex is omitted. Paths include the start. `blocked` hexes cannot
 * be entered (the origin is allowed even if listed). `stopOnly` hexes
 * can be entered as a destination but are not used as transit.
 */
export function reachableWithin(
  from: Axial,
  budget: number,
  enterCost: (q: number, r: number) => number | null,
  blocked?: ReadonlySet<string>,
  stopOnly?: ReadonlySet<string>,
): Map<string, Axial[]> {
  const startKey = key(from.q, from.r)
  const cameFrom = new Map<string, Axial>()
  const gScore = new Map<string, number>([[startKey, 0]])
  const posByKey = new Map<string, Axial>([[startKey, from]])
  const open = new Map<string, Axial>([[startKey, from]])

  while (open.size > 0) {
    let bestKey = ''
    let bestG = Infinity
    let current: Axial | undefined
    for (const [openKey, node] of open) {
      const g = gScore.get(openKey) ?? Infinity
      if (g < bestG) {
        bestG = g
        bestKey = openKey
        current = node
      }
    }
    if (!current) {
      break
    }
    open.delete(bestKey)
    if (stopOnly?.has(bestKey) && bestKey !== startKey) {
      continue
    }

    for (const next of neighborHexes(current)) {
      const nextKey = key(next.q, next.r)
      if (blocked?.has(nextKey) && nextKey !== startKey) {
        continue
      }
      const cost = enterCost(next.q, next.r)
      if (cost == null) {
        continue
      }
      const remaining = budget - bestG
      const stepCost =
        cost === DUMP_REMAINING_MOVE_COST
          ? remaining > 1e-9
            ? remaining
            : null
          : cost
      if (stepCost == null) {
        continue
      }
      const tentative = bestG + stepCost
      if (tentative - 1e-9 > budget) {
        continue
      }
      if (tentative + 1e-9 >= (gScore.get(nextKey) ?? Infinity)) {
        continue
      }
      cameFrom.set(nextKey, current)
      gScore.set(nextKey, tentative)
      posByKey.set(nextKey, next)
      open.set(nextKey, next)
    }
  }

  const paths = new Map<string, Axial[]>()
  for (const [hexKey, pos] of posByKey) {
    if (hexKey === startKey) {
      continue
    }
    paths.set(hexKey, reconstruct(cameFrom, pos))
  }
  return paths
}
