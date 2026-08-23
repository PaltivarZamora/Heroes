import { defineHex, Grid, Orientation, rectangle } from 'honeycomb-grid'
import type { Hex } from 'honeycomb-grid'
import type { TileData, TerrainType, TestGridResponse } from './types'

const GRID_PADDING = 28

export const TERRAIN_COLORS: Record<TerrainType, number> = {
  'Stone Path': 0xcfd8dc,
  'Dirt Path': 0xc4a574,
  Grass: 0x4caf50,
  Ash: 0x5c5666,
  Rocky: 0x8d6e63,
  Lava: 0xe64a19,
  Desert: 0xf5e6a8,
  Snow: 0xe8f4f8,
  Mud: 0x5d4037,
  Swamp: 0x6b8e23,
  Shallows: 0x81d4fa,
  Forest: 0x1b5e20,
  Mountain: 0x4e342e,
  Water: 0x2196f3,
  Barrier: 0xe91e63,
  Void: 0x000000,
}

let tilesByCoord = new Map<string, TileData>()
let explored = new Set<string>()

function coordKey(q: number, r: number): string {
  return `${q},${r}`
}

export function setTiles(tiles: TileData[]): void {
  tilesByCoord = new Map(tiles.map((tile) => [coordKey(tile.q, tile.r), tile]))
}

export function getTile(q: number, r: number): TileData | undefined {
  return tilesByCoord.get(coordKey(q, r))
}

export function isPassable(q: number, r: number): boolean {
  const tile = getTile(q, r)
  return tile != null && tile.movementCostMultiplier != null
}

export function isExplored(q: number, r: number): boolean {
  return explored.has(coordKey(q, r))
}

export function markExplored(q: number, r: number): void {
  explored.add(coordKey(q, r))
}

/** Explored and passable — A* will not enter fog or impassable terrain. */
export function isWalkable(q: number, r: number): boolean {
  return isExplored(q, r) && isPassable(q, r)
}

export function resetExplored(): void {
  explored = new Set()
}

export async function fetchTestGrid(): Promise<TestGridResponse> {
  try {
    const response = await fetch('/api/map/test-grid')
    if (!response.ok) {
      console.log('Failed to fetch test grid:', response.status)
      return { seed: 0, tiles: [], objects: [] }
    }
    const payload = (await response.json()) as TestGridResponse
    if (!Array.isArray(payload.tiles)) {
      console.log('Failed to fetch test grid: unexpected payload')
      return { seed: 0, tiles: [], objects: [] }
    }
    if (!Array.isArray(payload.objects)) {
      payload.objects = []
    }
    console.log(
      'Fetched test grid:',
      payload.tiles.length,
      'tiles, seed',
      payload.seed,
      payload.objects.length,
      'objects',
    )
    resetExplored()
    return payload
  } catch (error) {
    console.log('Failed to fetch test grid:', error)
    return { seed: 0, tiles: [], objects: [] }
  }
}

function offsetFromZero(col: number): number {
  return (col + -1 * (col & 1)) >> 1
}

function dimensionsFromTiles(tiles: TileData[]): { width: number; height: number } {
  let maxCol = 0
  let maxRow = 0
  for (const tile of tiles) {
    const col = tile.q
    const row = tile.r + offsetFromZero(tile.q)
    if (col > maxCol) {
      maxCol = col
    }
    if (row > maxRow) {
      maxRow = row
    }
  }
  return { width: maxCol + 1, height: maxRow + 1 }
}

function measureGrid(grid: Grid<Hex>) {
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

  const verticalStagger = grid.hexPrototype.height / 2
  const padX = GRID_PADDING
  const padY = GRID_PADDING + verticalStagger

  return {
    offsetX: padX - minX,
    offsetY: padY - minY,
    canvasWidth: Math.ceil(maxX - minX + padX * 2),
    canvasHeight: Math.ceil(maxY - minY + padY * 2),
  }
}

export function buildWorld(tiles: TileData[], hexSize: number) {
  setTiles(tiles)
  const { width, height } = dimensionsFromTiles(tiles)
  const Hex = defineHex({
    dimensions: hexSize,
    orientation: Orientation.FLAT,
    origin: 'topLeft',
  })
  const grid = new Grid(Hex, rectangle({ width, height }))
  return { grid, layout: measureGrid(grid), width, height }
}
