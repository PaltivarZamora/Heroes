import { defineHex, Grid, Orientation, rectangle, type Hex } from 'honeycomb-grid'
import type { Axial } from '../hex/hero'
import { neighborHexes } from '../hex/pathfinding'
import { HEX_SCALES } from '../hex/hexScale'
import { pickTerrainVariantIndex } from '../hex/terrainTextures'
import type { ReferenceCatalog } from '../town/catalog'
import { terrainByName, terrainIsRandomEligible } from '../town/catalog'
import { getTile } from '../hex/world'
import type { CombatTile } from './battle'

export const COMBAT_COLUMNS = 15
export const COMBAT_ROWS = 11
export const COMBAT_HEX_SIZE = HEX_SCALES.Large
/** 0-based offset column: one in from the left edge. */
export const ATTACKER_COL = 1
/** 0-based offset column: one in from the right edge. */
export const DEFENDER_COL = COMBAT_COLUMNS - 2
/** Outer-edge column for the attacker Hero portrait. */
export const ATTACKER_HERO_COL = 0
/** Outer-edge column for the defender Hero portrait. */
export const DEFENDER_HERO_COL = COMBAT_COLUMNS - 1
/** First row (top) — both Heroes share this row. */
export const HERO_ROW = 0

/** Siege zones, 0-based. Brief columns 1–15 map here as 0–14. */
export const SIEGE_MOAT_COL = 10
export const SIEGE_WALL_COL = 11
export const SIEGE_INTERIOR_COL_START = 12
export const SIEGE_CATAPULT_COL = 0
export const SIEGE_CATAPULT_ROW = COMBAT_ROWS - 1
const SIEGE_STONE_FLOOR = 'Stone_Path'

const SIEGE_MOAT_TERRAIN = 'Moat'

/** 0-based row → column delta from SIEGE_WALL_COL. +1 right, −1 left. */
const WALL_COL_OFFSET_BY_ROW = [1, 0, 0, -1, -1, -2, -1, -1, 0, 0, 1]

/** 0-based row → column delta from SIEGE_MOAT_COL. Independent of the wall table. */
const MOAT_COL_OFFSET_BY_ROW = [1, 0, 0, -1, -1, -2, -1, -1, 0, 0, 1]

export function siegeWallColForRow(row: number): number {
  return SIEGE_WALL_COL + (WALL_COL_OFFSET_BY_ROW[row] ?? 0)
}

export function siegeMoatColForRow(row: number): number {
  return SIEGE_MOAT_COL + (MOAT_COL_OFFSET_BY_ROW[row] ?? 0)
}

/** Wall + town interior are town floor. Moat is placed per-row (tapered). */
export function siegeTileTerrain(
  col: number,
  row: number,
  sampled: string,
): string {
  if (col === siegeMoatColForRow(row)) {
    return SIEGE_MOAT_TERRAIN
  }
  if (
    col === siegeWallColForRow(row) ||
    col >= SIEGE_WALL_COL ||
    col >= SIEGE_INTERIOR_COL_START
  ) {
    return SIEGE_STONE_FLOOR
  }
  return sampled
}

const COMBAT_GRID_PADDING = 28

export function armySlotRow(slotIndex: number): number {
  return slotIndex * 2
}

function measureCombatGrid(grid: Grid<Hex>) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  grid.forEach((hex) => {
    for (const corner of hex.corners) {
      minX = Math.min(minX, corner.x)
      minY = Math.min(minY, corner.y)
      maxX = Math.max(maxX, corner.x)
      maxY = Math.max(maxY, corner.y)
    }
  })
  const pad = COMBAT_GRID_PADDING
  return {
    offsetX: pad - minX,
    offsetY: pad - minY,
    canvasWidth: Math.ceil(maxX - minX + pad * 2),
    canvasHeight: Math.ceil(maxY - minY + pad * 2),
  }
}

/** Combat-only pointy hexes. World map keeps its own flat-top factory. */
export function createCombatHexGrid(width: number, height: number, hexSize: number) {
  const Hex = defineHex({
    dimensions: hexSize,
    orientation: Orientation.POINTY,
    origin: 'topLeft',
  })
  const grid = new Grid(Hex, rectangle({ width, height }))
  return { grid, layout: measureCombatGrid(grid), width, height }
}

/** Horizontal center and bottom edge of a hex, in layout pixels. */
export function hexFloorAnchor(hex: Hex, offsetX: number, offsetY: number) {
  const corners = hex.corners
  let x = 0
  let bottom = -Infinity
  for (const corner of corners) {
    x += corner.x
    if (corner.y > bottom) {
      bottom = corner.y
    }
  }
  return { x: x / corners.length + offsetX, y: bottom + offsetY }
}

export function neighborhoodTerrains(a: Axial, b: Axial): string[] {
  const seen = new Set<string>()
  const addAt = (pos: Axial) => {
    const tile = getTile(pos.q, pos.r)
    if (tile) {
      seen.add(tile.terrain)
    }
    for (const n of neighborHexes(pos)) {
      const around = getTile(n.q, n.r)
      if (around) {
        seen.add(around.terrain)
      }
    }
  }
  addAt(a)
  addAt(b)
  return [...seen]
}

export function pickCombatTerrain(
  pool: readonly string[],
  seed: number,
  q: number,
  r: number,
  catalog?: ReferenceCatalog | null,
): string {
  const eligible = pool.filter((name) =>
    terrainIsRandomEligible(terrainByName(catalog, name)),
  )
  const fallback = (catalog?.terrain_type ?? [])
    .filter(terrainIsRandomEligible)
    .map((row) => row.name)
  const list =
    eligible.length > 0
      ? eligible
      : fallback.length > 0
        ? fallback
        : (['Grass'] as const)
  const index = pickTerrainVariantIndex(
    seed,
    q,
    r,
    list.map(() => ({ weight: 1 })),
  )
  return list[index] ?? 'Grass'
}

export function combatEncounterSeed(
  mapSeed: number,
  attacker: Axial,
  defender: Axial,
): number {
  return (
    (mapSeed ^
      (attacker.q * 73856093) ^
      (attacker.r * 19349663) ^
      (defender.q * 83492791) ^
      (defender.r * 50331653)) >>>
    0
  )
}

const BARRIER_COUNT_MIN = 5
const BARRIER_COUNT_MAX = 8

function u32(n: number): number {
  return n >>> 0
}

function barrierRand(seed: number, n: number): number {
  let h = u32(
    Math.imul(seed, 0x9e3779b1) ^ Math.imul(n + 0x7f4a7c15, 0x85ebca6b),
  )
  h = u32((h ^ (h >>> 16)) * 0x7feb352d)
  h = u32((h ^ (h >>> 15)) * 0x846ca68b)
  return u32(h ^ (h >>> 16))
}

/**
 * Overlay 5–8 Barrier hexes after terrain is assigned. Skips army
 * placement columns so starting stacks are never boxed in.
 */
export function applyCombatBarriers(
  tiles: CombatTile[],
  colByKey: ReadonlyMap<string, number>,
  reservedCols: readonly number[],
  seed: number,
  catalog: ReferenceCatalog,
): CombatTile[] {
  const reserved = new Set(reservedCols)
  const eligible: number[] = []
  for (let i = 0; i < tiles.length; i += 1) {
    const tile = tiles[i]!
    const col = colByKey.get(`${tile.q},${tile.r}`)
    if (col == null || reserved.has(col)) {
      continue
    }
    eligible.push(i)
  }
  if (eligible.length === 0) {
    return tiles
  }
  for (let i = eligible.length - 1; i > 0; i -= 1) {
    const j = barrierRand(seed, i + 1) % (i + 1)
    const tmp = eligible[i]!
    eligible[i] = eligible[j]!
    eligible[j] = tmp
  }
  const span = BARRIER_COUNT_MAX - BARRIER_COUNT_MIN + 1
  const count = Math.min(
    eligible.length,
    BARRIER_COUNT_MIN + (barrierRand(seed, 0) % span),
  )
  const barrier = terrainByName(catalog, 'Barrier')
  const next = tiles.slice()
  for (let n = 0; n < count; n += 1) {
    const i = eligible[n]!
    const tile = next[i]!
    next[i] = {
      ...tile,
      terrain: barrier?.name ?? 'Barrier',
      movementCostMultiplier: barrier?.move_cost ?? null,
      blocked: barrier?.is_blocked ?? true,
      blocksLos: barrier?.blocks_los ?? true,
    }
  }
  return next
}
