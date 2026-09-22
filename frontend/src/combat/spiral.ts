import type { Axial } from '../hex/hero'
import { hexDistance } from '../hex/pathfinding'
import type { Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import { unitAttackShape, unitById } from '../town/catalog'
import type { CombatBattle, CombatTile } from './battle'
import { chanceRollLog, rollChancePct } from './combatLog'
import {
  filterFirePlaceableHexKeys,
  placeFireOnHexKeys,
} from './groundEffect'
import { occupancyKey } from './occupancy'

/**
 * Pointy-top clockwise neighbor deltas (0° east → SE → SW → W → NW → NE).
 * Matches target.ts WEDGE_NEIGHBORS / honeycomb-grid POINTY order.
 */
const CLOCKWISE_DIRS: Axial[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
]

function dirIndexToward(from: Axial, to: Axial): number {
  const dq = to.q - from.q
  const dr = to.r - from.r
  let best = 0
  let bestDot = Number.NEGATIVE_INFINITY
  for (let i = 0; i < CLOCKWISE_DIRS.length; i += 1) {
    const d = CLOCKWISE_DIRS[i]!
    const dot = d.q * dq + d.r * dr
    if (dot > bestDot) {
      bestDot = dot
      best = i
    }
  }
  return best
}

/**
 * Clockwise spiral hexes around `center`, oriented from center→attacker
 * (starts on the attacker-facing ring hex, then walks clockwise).
 * Center is first; then ring 1…radius. Hard-capped by `radius`.
 */
export function spiralHexOrder(
  center: Axial,
  radius: number,
  fromAttacker: Axial,
  board?: ReadonlySet<string>,
): Axial[] {
  const maxR = Math.max(0, Math.floor(radius))
  const out: Axial[] = [center]
  if (maxR <= 0) {
    return out
  }
  const startDir = dirIndexToward(center, fromAttacker)
  for (let ring = 1; ring <= maxR; ring += 1) {
    const start = CLOCKWISE_DIRS[startDir]!
    let hex: Axial = {
      q: center.q + start.q * ring,
      r: center.r + start.r * ring,
    }
    for (let side = 0; side < 6; side += 1) {
      // Walk the ring clockwise: after starting on startDir, step along
      // startDir+2 (the next edge direction in cube spiral convention).
      const walk = CLOCKWISE_DIRS[(startDir + 2 + side) % 6]!
      for (let step = 0; step < ring; step += 1) {
        const onBoard = !board || board.has(occupancyKey(hex.q, hex.r))
        if (onBoard && hexDistance(center, hex) === ring) {
          out.push(hex)
        }
        hex = { q: hex.q + walk.q, r: hex.r + walk.r }
      }
    }
  }
  return out
}

/**
 * Pyromaniac SPIRAL: after the primary single-target hit, place Fire on the
 * target hex at 100%, then clockwise with chance −decay each hex. Stop on
 * failed roll or Fire fizzle (Water/Shallows/Swamp).
 */
export function applySpiralFireFromAttacker(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  caster: Hero | null | undefined,
  attackerId: string,
  targetHex: Axial,
  tiles: CombatTile[],
  random: () => number = Math.random,
): { battle: CombatBattle; tiles?: CombatTile[]; lines: string[] } {
  const attacker = battle.stacks.find((row) => row.id === attackerId)
  if (!attacker) {
    return { battle, lines: [] }
  }
  const spec = unitAttackShape(unitById(catalog, attacker.unitId))
  if (spec.shape !== 'spiral') {
    return { battle, lines: [] }
  }
  const decay = Math.max(1, spec.spiralChanceDecayPct ?? 10)
  const radius = Math.max(0, spec.radius ?? 2)
  const fizzleTerrainIds = spec.fizzleTerrainIds
  const board = new Set(tiles.map((tile) => occupancyKey(tile.q, tile.r)))
  const order = spiralHexOrder(
    targetHex,
    radius,
    { q: attacker.q, r: attacker.r },
    board,
  )
  const label = unitById(catalog, attacker.unitId)?.name ?? 'Spiral'
  const lines: string[] = []
  let chance = 100
  let next = battle
  let nextTiles = tiles
  let placed = 0
  for (let i = 0; i < order.length; i += 1) {
    const hex = order[i]!
    const key = occupancyKey(hex.q, hex.r)
    const placeable = filterFirePlaceableHexKeys(
      [key],
      nextTiles,
      catalog,
      fizzleTerrainIds,
    )
    if (placeable.length === 0) {
      lines.push(
        chanceRollLog(label, chance, false, {
          action: 'to place Fire',
          fail: 'fizzled (terrain) — spiral stops.',
        }),
      )
      break
    }
    const triggered = i === 0 ? true : rollChancePct(chance, random)
    if (i === 0) {
      lines.push(`${label} spiral: Fire on target hex (100%).`)
    } else {
      lines.push(
        chanceRollLog(label, chance, triggered, {
          action: 'to place Fire',
        }),
      )
    }
    if (!triggered) {
      break
    }
    const fire = placeFireOnHexKeys(
      next,
      catalog,
      caster,
      attacker.side,
      [key],
      nextTiles,
      null,
      fizzleTerrainIds,
    )
    next = fire.battle
    if (fire.tiles) {
      nextTiles = fire.tiles
    }
    if (fire.placedKeys.length === 0) {
      break
    }
    placed += 1
    chance = Math.max(0, chance - decay)
  }
  if (placed > 1) {
    lines.push(`${label} spiral: Fire on ${placed} hexes.`)
  }
  return {
    battle: next,
    tiles: nextTiles !== tiles ? nextTiles : undefined,
    lines,
  }
}
