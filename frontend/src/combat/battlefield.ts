import { defineHex, Grid, Orientation, rectangle, type Hex } from 'honeycomb-grid'
import type { Axial } from '../hex/hero'
import { HEX_SCALES } from '../hex/hexScale'
import { getTile } from '../hex/world'
import type { ReferenceCatalog } from '../town/catalog'
import { hexTerrainByName } from '../town/catalog'
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
const SIEGE_FLOOR_TERRAIN = 'Siege Floor'
const SIEGE_MOAT_TERRAIN = 'Moat'

/** Reserved for future battle-prop sampling (larger than terrain halves). */
export const WORLD_PROP_SAMPLE_RADIUS = 2

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
  // Interior follows the per-row wall column — a fixed SIEGE_WALL_COL left a
  // standable gap on bowed rows (and wrong attack stands at the tapered ends).
  if (col >= siegeWallColForRow(row)) {
    return SIEGE_FLOOR_TERRAIN
  }
  return sampled
}

/** Attacker-side of the tapered wall on this row (col strictly left of wall). */
export function isSiegeExteriorCol(col: number, row: number): boolean {
  return col < siegeWallColForRow(row)
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

/** Combat battlefield — pointy-top (matches world map). */
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

function worldTerrainAt(pos: Axial): string | null {
  const name = getTile(pos.q, pos.r)?.terrain?.trim()
  return name && name.length > 0 ? name : null
}

function u32(n: number): number {
  return n >>> 0
}

function unit01(seed: number, a: number, b: number): number {
  let h = u32(
    Math.imul(seed, 0x9e3779b1) ^
      Math.imul(a + 0x7f4a7c15, 0x85ebca6b) ^
      Math.imul(b + 0x165667b1, 0xc2b2ae35),
  )
  h = u32((h ^ (h >>> 16)) * 0x7feb352d)
  h = u32((h ^ (h >>> 15)) * 0x846ca68b)
  h = u32(h ^ (h >>> 16))
  return h / 4294967296
}

const AXIAL_NEIGHBORS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
] as const

/**
 * Terrain for one combat side = the world hex that fighter occupies.
 * Adjacent fallback only if that hex has no tile — never radius-random.
 */
function sideTerrainFromWorld(
  origin: Axial,
  catalog: ReferenceCatalog,
): string {
  const exact = worldTerrainAt(origin)
  if (exact) {
    return exact
  }
  for (const d of AXIAL_NEIGHBORS) {
    const near = worldTerrainAt({ q: origin.q + d.q, r: origin.r + d.r })
    if (near) {
      return near
    }
  }
  return (
    catalog.terrain.find((t) => t.is_seedable)?.name ??
    'Grass'
  )
}

/**
 * Irregular left/right battlefield from each fighter's world hex terrain
 * (attacker hex → left, defender hex → right). Transition uses a seed-varying
 * slope + multi-frequency wave. Same atk/def terrain is fine. Absorb after.
 */
export function generateCombatHexTerrainField(
  grid: Grid<Hex>,
  attacker: Axial,
  defender: Axial,
  seed: number,
  catalog: ReferenceCatalog,
): Array<{
  q: number
  r: number
  col: number
  row: number
  terrain: string
  chunkId: number
}> {
  const atk = sideTerrainFromWorld(attacker, catalog)
  const def = sideTerrainFromWorld(defender, catalog)

  const centerCol = Math.floor(COMBAT_COLUMNS / 2)
  const midRow = (COMBAT_ROWS - 1) / 2
  // Lateral shift and diagonal slope both vary fight-to-fight.
  const baseOffset = (unit01(seed, 11, 22) - 0.5) * 5 // ~-2.5..+2.5
  const slope = (unit01(seed, 33, 44) - 0.5) * 0.85 // cols per row from mid
  const amp1 = 1.6 + unit01(seed, 55, 66) * 2.4 // 1.6..4.0
  const amp2 = 0.7 + unit01(seed, 77, 88) * 1.6 // 0.7..2.3
  const freq1 = 0.45 + unit01(seed, 91, 17) * 0.55
  const freq2 = 1.1 + unit01(seed, 19, 23) * 1.2
  const phase1 = unit01(seed, 29, 31) * Math.PI * 2
  const phase2 = unit01(seed, 37, 43) * Math.PI * 2

  type Cell = {
    q: number
    r: number
    col: number
    row: number
    terrain: string
    chunkId: number
  }
  const cells: Cell[] = []
  const byKey = new Map<string, Cell>()

  grid.forEach((hex) => {
    const rowFromMid = hex.row - midRow
    const wave =
      amp1 * Math.sin(hex.row * freq1 + phase1) +
      amp2 * Math.sin(hex.row * freq2 + phase2) +
      (unit01(seed, hex.row, 99) - 0.5) * 1.4
    const thresh = centerCol + baseOffset + slope * rowFromMid + wave
    const useAtk = def === atk || hex.col + 0.5 < thresh
    const terrain = useAtk ? atk : def
    const chunkId = useAtk ? 1 : 2
    const cell: Cell = {
      q: hex.q,
      r: hex.r,
      col: hex.col,
      row: hex.row,
      terrain,
      chunkId,
    }
    cells.push(cell)
    byKey.set(`${hex.q},${hex.r}`, cell)
  })

  absorbCombatField(byKey, catalog)
  return cells
}

/** Same family as world TerrainChunks absorb (tips / thin corridors). */
function absorbCombatField(
  byKey: Map<string, { terrain: string; chunkId: number; q: number; r: number }>,
  catalog: ReferenceCatalog,
): void {
  const guard = byKey.size
  for (let i = 0; i < guard; i++) {
    let changed = false
    for (const cell of byKey.values()) {
      const tallies = new Map<string, number>()
      const chunkByTerrain = new Map<string, number>()
      for (const d of AXIAL_NEIGHBORS) {
        const n = byKey.get(`${cell.q + d.q},${cell.r + d.r}`)
        if (!n) {
          continue
        }
        tallies.set(n.terrain, (tallies.get(n.terrain) ?? 0) + 1)
        if (!chunkByTerrain.has(n.terrain)) {
          chunkByTerrain.set(n.terrain, n.chunkId)
        }
      }
      const same = tallies.get(cell.terrain) ?? 0
      let bestForeign = 0
      let bestName: string | null = null
      for (const [name, count] of tallies) {
        if (name === cell.terrain) {
          continue
        }
        if (count > bestForeign) {
          bestForeign = count
          bestName = name
        }
      }
      const weak = same === 0 || (same <= 2 && bestForeign >= 3)
      if (!weak || !bestName) {
        continue
      }
      if (!hexTerrainByName(catalog, bestName)) {
        continue
      }
      cell.terrain = bestName
      cell.chunkId = chunkByTerrain.get(bestName) ?? cell.chunkId
      changed = true
    }
    if (!changed) {
      return
    }
  }
}

/** Build CombatTiles from the hex-terrain field (+ optional siege overlays). */
export function combatTilesFromHexField(
  field: ReturnType<typeof generateCombatHexTerrainField>,
  catalog: ReferenceCatalog,
  siege: boolean,
): CombatTile[] {
  return field.map((cell) => {
    const sampled = cell.terrain
    const terrain = siege
      ? siegeTileTerrain(cell.col, cell.row, sampled)
      : sampled
    const hexRow = hexTerrainByName(catalog, terrain)
    if (hexRow) {
      const blocked = hexRow.is_blocker || hexRow.move_cost == null
      return {
        q: cell.q,
        r: cell.r,
        col: cell.col,
        row: cell.row,
        terrain,
        movementCostMultiplier: hexRow.move_cost,
        blocked,
        blocksLos: hexRow.is_blocker,
        chunkId: cell.chunkId,
      }
    }
    // Unknown name (should not happen once all combat terrains are in `terrain`).
    return {
      q: cell.q,
      r: cell.r,
      col: cell.col,
      row: cell.row,
      terrain,
      movementCostMultiplier: null,
      blocked: true,
      blocksLos: false,
      chunkId: cell.chunkId,
    }
  })
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
