import { type Grid, type Hex } from 'honeycomb-grid'
import { findPath } from './pathfinding'
import { getTile, isPassable } from './world'

/** Player 1's first hero, per the locked marker scheme. */
export const HERO_MARKER_LABEL = 'X1'

/** Player 1 color (HoMM-style red). */
export const PLAYER_1_COLOR = 0xc62828

export const MAX_MOVEMENT_POINTS = 10

/** Flat extra cost when a hero-to-hero interaction actually triggers. */
export const HERO_INTERACT_COST = 0.25

/** Offset col/row — map center on Small 36×36; moved if that hex is impassable. */
export const HERO_START_OFFSET = { col: 18, row: 18 }

/** Hex-distance radius of always-on vision (BR 2-3a). */
export const VISION_RANGE = 4

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
  return roundMovement(Math.max(0, remaining - HERO_INTERACT_COST))
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

export function findPassableStart(grid: Grid<Hex>): Axial {
  const preferred = grid.getHex(HERO_START_OFFSET)
  if (preferred && isPassable(preferred.q, preferred.r)) {
    return { q: preferred.q, r: preferred.r }
  }
  let best: Hex | undefined
  let bestDist = Infinity
  grid.forEach((hex) => {
    if (!isPassable(hex.q, hex.r)) {
      return
    }
    const dist =
      Math.abs(hex.col - HERO_START_OFFSET.col) +
      Math.abs(hex.row - HERO_START_OFFSET.row)
    if (dist < bestDist) {
      bestDist = dist
      best = hex
    }
  })
  if (best) {
    return { q: best.q, r: best.r }
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
  const path = findPath(from, to, blocked)
  if (!path || path.length <= 1) {
    return []
  }
  const steps: Hex[] = []
  let mp = remaining
  for (let i = 1; i < path.length; i++) {
    const hex = grid.getHex(path[i])
    if (!hex) {
      break
    }
    const tile = getTile(hex.q, hex.r)
    if (!tile || tile.blocked) {
      break
    }
    const cost = tile.movementCostMultiplier
    if (cost == null || mp + 1e-9 < cost) {
      break
    }
    steps.push(hex)
    mp = spendMovement(mp, cost)
  }
  return steps
}
