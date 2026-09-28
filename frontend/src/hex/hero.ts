import { type Grid, type Hex } from 'honeycomb-grid'
import { findPathOnBoard, findPathToward } from './pathfinding'
import { getTile, isPassable } from './world'
import { hexTransitionMoveCost } from './terrainTransition'
import { getCachedCatalog, heroInteractCost } from '../town/catalog'
import { boatEnterCost, canSailOnto } from './boat'
import type { GameSession } from '../session/types'

/** Player 1's first hero, per the locked marker scheme. */
export const HERO_MARKER_LABEL = 'X1'

/** Player 1 color (HoMM-style red). */
export const PLAYER_1_COLOR = 0xc62828

export const MAX_MOVEMENT_POINTS = 10

export const MOVE_STEP_MS = 90

export const CLICK_PAN_THRESHOLD_PX = 6

export type Axial = { q: number; r: number }

export function roundMovement(n: number): number {
  return Math.round(n * 100) / 100
}

export function spendMovement(remaining: number, cost: number): number {
  return roundMovement(remaining - cost)
}

/** Hero-meet cost: still fires if remaining < cost, never goes below 0. */
export function spendHeroInteract(remaining: number): number {
  return roundMovement(Math.max(0, remaining - heroInteractCost(getCachedCatalog())))
}

export function formatMp(n: number): string {
  const rounded = roundMovement(n)
  const one = Math.round(rounded * 10) / 10
  if (Math.abs(one - rounded) < 1e-9) {
    return one.toFixed(1)
  }
  return rounded.toFixed(2)
}

export function formatMovementPoints(
  remaining: number,
  max = MAX_MOVEMENT_POINTS,
): string {
  return `${formatMp(remaining)}/${formatMp(max)}`
}

/**
 * First passable hex on the loaded map (no fixed start coordinate).
 * Prefer an interior hex when possible.
 */
export function findPassableStart(grid: Grid<Hex>): Axial {
  let interior: Hex | undefined
  let any: Hex | undefined
  grid.forEach((hex) => {
    if (!isPassable(hex.q, hex.r)) {
      return
    }
    if (!any) {
      any = hex
    }
    const neighbors = [
      { q: hex.q + 1, r: hex.r },
      { q: hex.q + 1, r: hex.r - 1 },
      { q: hex.q, r: hex.r - 1 },
      { q: hex.q - 1, r: hex.r },
      { q: hex.q - 1, r: hex.r + 1 },
      { q: hex.q, r: hex.r + 1 },
    ]
    const rim = neighbors.some((n) => getTile(n.q, n.r) == null)
    if (!rim && !interior) {
      interior = hex
    }
  })
  const pick = interior ?? any
  if (pick) {
    return { q: pick.q, r: pick.r }
  }
  return { q: 0, r: 0 }
}

/**
 * A* path to the clicked hex, then walk as far as remaining movement allows.
 * Stops before an unaffordable hex (no partial entry).
 */
export function movementSteps(
  grid: Grid<Hex>,
  from: Axial,
  to: Axial,
  remaining: number,
  blocked?: ReadonlySet<string>,
): Hex[] {
  if (remaining <= 1e-9 || (from.q === to.q && from.r === to.r)) {
    return []
  }
  const path = findPathToward(from, to, blocked)
  if (!path || path.length <= 1) {
    return []
  }
  const steps: Hex[] = []
  let mp = remaining
  for (let i = 1; i < path.length; i++) {
    const hex = grid.getHex(path[i]) ?? grid.createHex(path[i])
    if (!hex) {
      break
    }
    const tile = getTile(hex.q, hex.r)
    if (!tile || tile.blocked) {
      break
    }
    const cost = hexTransitionMoveCost(getCachedCatalog(), hex.q, hex.r)
    if (cost == null || mp + 1e-9 < cost) {
      break
    }
    steps.push(hex)
    mp = spendMovement(mp, cost)
  }
  return steps
}

/**
 * Boarded sail path: Water + Shallow at flat 1 MP; other boats block.
 */
export function sailMovementSteps(
  grid: Grid<Hex>,
  from: Axial,
  to: Axial,
  remaining: number,
  session: GameSession,
  moverBoatId: string,
  moverPlayerId?: string | null,
): Hex[] {
  if (remaining <= 1e-9 || (from.q === to.q && from.r === to.r)) {
    return []
  }
  const path = findPathOnBoard(
    from,
    to,
    boatEnterCost,
    undefined,
    (q, r) =>
      (q === from.q && r === from.r) ||
      canSailOnto(session, q, r, moverBoatId, moverPlayerId),
  )
  if (!path || path.length <= 1) {
    return []
  }
  const steps: Hex[] = []
  let mp = remaining
  for (let i = 1; i < path.length; i++) {
    const hex = grid.getHex(path[i]) ?? grid.createHex(path[i])
    if (!hex) {
      break
    }
    const cost = boatEnterCost(hex.q, hex.r)
    if (cost == null || mp + 1e-9 < cost) {
      break
    }
    if (!canSailOnto(session, hex.q, hex.r, moverBoatId, moverPlayerId)) {
      break
    }
    steps.push(hex)
    mp = spendMovement(mp, cost)
  }
  return steps
}

/**
 * Land path onto an empty boat hex (walkOnto). Boat hex costs 1 MP even when
 * deep Water would otherwise be impassable on foot.
 */
export function boardBoatMovementSteps(
  grid: Grid<Hex>,
  from: Axial,
  boat: Axial,
  remaining: number,
  blocked?: ReadonlySet<string>,
): Hex[] {
  if (remaining <= 1e-9 || (from.q === boat.q && from.r === boat.r)) {
    return []
  }
  const boatKey = `${boat.q},${boat.r}`
  const enterCost = (q: number, r: number): number | null => {
    if (q === boat.q && r === boat.r) {
      return 1
    }
    return hexTransitionMoveCost(getCachedCatalog(), q, r)
  }
  const canEnter = (q: number, r: number): boolean => {
    if (q === from.q && r === from.r) {
      return true
    }
    if (q === boat.q && r === boat.r) {
      return true
    }
    if (blocked?.has(`${q},${r}`)) {
      return false
    }
    const tile = getTile(q, r)
    if (!tile || tile.blocked) {
      return false
    }
    return enterCost(q, r) != null
  }
  const path = findPathOnBoard(from, boat, enterCost, blocked, canEnter)
  if (!path || path.length <= 1) {
    return []
  }
  const steps: Hex[] = []
  let mp = remaining
  for (let i = 1; i < path.length; i++) {
    const hex = grid.getHex(path[i]) ?? grid.createHex(path[i])
    if (!hex) {
      break
    }
    const key = `${hex.q},${hex.r}`
    const cost = enterCost(hex.q, hex.r)
    if (cost == null || mp + 1e-9 < cost) {
      break
    }
    if (key !== boatKey) {
      const tile = getTile(hex.q, hex.r)
      if (!tile || tile.blocked) {
        break
      }
    }
    steps.push(hex)
    mp = spendMovement(mp, cost)
  }
  return steps
}

/** Exact-reach leg for world-map waypoint staging. */
export function resolveWorldWaypointLeg(
  grid: Grid<Hex>,
  from: Axial,
  to: Axial,
  remaining: number,
  blocked?: ReadonlySet<string>,
): { steps: Axial[]; remaining: number } | null {
  if (remaining <= 1e-9 || (from.q === to.q && from.r === to.r)) {
    return null
  }
  const hexes = movementSteps(grid, from, to, remaining, blocked)
  if (hexes.length === 0) {
    return null
  }
  const last = hexes[hexes.length - 1]
  if (!last || last.q !== to.q || last.r !== to.r) {
    return null
  }
  let mp = remaining
  const steps: Axial[] = []
  for (const hex of hexes) {
    const cost = hexTransitionMoveCost(getCachedCatalog(), hex.q, hex.r)
    if (cost == null) {
      return null
    }
    steps.push({ q: hex.q, r: hex.r })
    mp = spendMovement(mp, cost)
  }
  return { steps, remaining: mp }
}
