import { defineHex, Grid, Orientation, rectangle, type Hex } from 'honeycomb-grid'
import type { Axial } from '../hex/hero'
import { neighborHexes } from '../hex/pathfinding'
import { HEX_SCALES } from '../hex/hexScale'
import { pickTerrainVariantIndex } from '../hex/terrainTextures'
import type { TerrainType } from '../hex/types'
import { getTile } from '../hex/world'

export const COMBAT_COLUMNS = 15
export const COMBAT_ROWS = 11
export const COMBAT_HEX_SIZE = HEX_SCALES.Medium
/** 0-based offset column: one in from the left edge. */
export const ATTACKER_COL = 1
/** 0-based offset column: one in from the right edge. */
export const DEFENDER_COL = COMBAT_COLUMNS - 2

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

export function neighborhoodTerrains(a: Axial, b: Axial): TerrainType[] {
  const seen = new Set<TerrainType>()
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
  pool: readonly TerrainType[],
  seed: number,
  q: number,
  r: number,
): TerrainType {
  const list = pool.length > 0 ? pool : (['Grass'] as const)
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
