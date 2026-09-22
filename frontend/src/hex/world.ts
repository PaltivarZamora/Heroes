import { defineHex, Grid, Orientation, rectangle } from 'honeycomb-grid'
import type { Hex } from 'honeycomb-grid'
import type { TileData, TestGridResponse } from './types'

const GRID_PADDING = 28

/** Pixi fill when a type has no PNG. Presentation only — costs come from the catalog. */
const TERRAIN_FILL: Record<string, number> = {
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
  Moat: 0x1565c0,
  Forest: 0x1b5e20,
  Mountain: 0x4e342e,
  Water: 0x2196f3,
  Barrier: 0xe91e63,
  Void: 0x000000,
}

export function terrainFillColor(name: string): number {
  return (
    TERRAIN_FILL[name] ??
    TERRAIN_FILL[name.replaceAll('_', ' ')] ??
    TERRAIN_FILL[name.replaceAll(' ', '_')] ??
    0x607d8b
  )
}

let tilesByCoord = new Map<string, TileData>()
let explored = new Set<string>()

function coordKey(q: number, r: number): string {
  return `${q},${r}`
}

function asWorldTile(raw: TileData): TileData {
  const extra = raw as TileData & {
    isBlocked?: unknown
    is_blocked?: unknown
    movement_cost_multiplier?: unknown
    chunk_id?: unknown
    prop_id?: unknown
    prop_variant?: unknown
    prop_file?: unknown
  }
  const costRaw = extra.movementCostMultiplier ?? extra.movement_cost_multiplier
  const cost =
    costRaw == null || costRaw === ''
      ? null
      : Number(costRaw)
  const flag: unknown = extra.blocked ?? extra.isBlocked ?? extra.is_blocked
  const blocked =
    flag === undefined
      ? cost == null || !Number.isFinite(cost)
      : flag === true ||
        flag === 1 ||
        String(flag).trim().toLowerCase() === 'true'
  const propIdRaw = raw.propId ?? extra.prop_id
  const propVariantRaw = raw.propVariant ?? extra.prop_variant
  const propFileRaw = raw.propFile ?? extra.prop_file
  const propIdN =
    propIdRaw == null || propIdRaw === '' ? NaN : Number(propIdRaw)
  const propVariantN =
    propVariantRaw == null || propVariantRaw === ''
      ? NaN
      : Number(propVariantRaw)
  const propFile =
    typeof propFileRaw === 'string' && propFileRaw.trim() !== ''
      ? propFileRaw.trim().replace(/\.png$/i, '')
      : null
  return {
    q: raw.q,
    r: raw.r,
    terrain: String(raw.terrain ?? ''),
    movementCostMultiplier:
      cost != null && Number.isFinite(cost) ? cost : null,
    blocked,
    chunkId: (() => {
      const id = raw.chunkId ?? extra.chunk_id
      const n = id == null || id === '' ? NaN : Number(id)
      return Number.isFinite(n) && n > 0 ? n : null
    })(),
    propId: Number.isFinite(propIdN) && propIdN > 0 ? propIdN : null,
    propVariant:
      Number.isFinite(propVariantN) && propVariantN > 0
        ? Math.floor(propVariantN)
        : null,
    propFile,
  }
}

export function setTiles(tiles: TileData[]): void {
  tilesByCoord = new Map(
    tiles.map((tile) => {
      const next = asWorldTile(tile)
      return [coordKey(next.q, next.r), next]
    }),
  )
}

export function getTile(q: number, r: number): TileData | undefined {
  return tilesByCoord.get(coordKey(q, r))
}

export function isPassable(q: number, r: number): boolean {
  const tile = getTile(q, r)
  return tile != null && !tile.blocked
}

export function forEachPassableHex(fn: (q: number, r: number) => void): void {
  for (const tile of tilesByCoord.values()) {
    if (!tile.blocked) {
      fn(tile.q, tile.r)
    }
  }
}

export function forEachTile(fn: (q: number, r: number) => void): void {
  for (const tile of tilesByCoord.values()) {
    fn(tile.q, tile.r)
  }
}

export function isExplored(q: number, r: number): boolean {
  return explored.has(coordKey(q, r))
}

export function markExplored(q: number, r: number): void {
  explored.add(coordKey(q, r))
}

export function getExploredHexes(): { q: number; r: number }[] {
  const hexes: { q: number; r: number }[] = []
  for (const key of explored) {
    const comma = key.indexOf(',')
    if (comma < 0) {
      continue
    }
    const q = Number(key.slice(0, comma))
    const r = Number(key.slice(comma + 1))
    if (Number.isFinite(q) && Number.isFinite(r)) {
      hexes.push({ q, r })
    }
  }
  return hexes
}

export function restoreExplored(
  hexes: readonly { q: number; r: number }[] | null | undefined,
): void {
  explored = new Set()
  if (!hexes) {
    return
  }
  for (const hex of hexes) {
    if (
      hex &&
      Number.isFinite(hex.q) &&
      Number.isFinite(hex.r)
    ) {
      explored.add(coordKey(hex.q, hex.r))
    }
  }
}

/** Explored and passable — A* will not enter fog or impassable terrain. */
export function isWalkable(q: number, r: number): boolean {
  return isExplored(q, r) && isPassable(q, r)
}

export function resetExplored(): void {
  explored = new Set()
}

export async function fetchTestGrid(seed?: number): Promise<TestGridResponse> {
  try {
    const query =
      seed != null && seed > 0 ? `?seed=${encodeURIComponent(String(seed))}` : ''
    const response = await fetch(`/api/map/test-grid${query}`)
    if (!response.ok) {
      console.log('Failed to fetch test grid:', response.status)
      return { seed: 0, tiles: [], objects: [] }
    }
    const payload = (await response.json()) as TestGridResponse
    if (!Array.isArray(payload.tiles)) {
      console.log('Failed to fetch test grid: unexpected payload')
      return { seed: 0, tiles: [], objects: [] }
    }
    payload.tiles = payload.tiles.map(asWorldTile)
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

/** honeycomb-grid default offset (-1): (axis + -1 * (axis & 1)) >> 1 */
function offsetFromZero(axis: number): number {
  return (axis + -1 * (axis & 1)) >> 1
}

/**
 * EXPERIMENT: pointy-top world map — odd-r offset (row = r, col = q + offset(r)).
 * Revert with odd-q: col = q, row = r + offset(q).
 */
function dimensionsFromTiles(tiles: TileData[]): { width: number; height: number } {
  let maxCol = 0
  let maxRow = 0
  for (const tile of tiles) {
    const row = tile.r
    const col = tile.q + offsetFromZero(tile.r)
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

  // EXPERIMENT: pointy-top — uniform pad like combat (no flat verticalStagger).
  const pad = GRID_PADDING
  return {
    offsetX: pad - minX,
    offsetY: pad - minY,
    canvasWidth: Math.ceil(maxX - minX + pad * 2),
    canvasHeight: Math.ceil(maxY - minY + pad * 2),
  }
}

/** Hex grid only — does not replace the World map tile cache. */
export function createHexGrid(width: number, height: number, hexSize: number) {
  const Hex = defineHex({
    dimensions: hexSize,
    // EXPERIMENT: pointy-top world map — revert to Orientation.FLAT with odd-q.
    orientation: Orientation.POINTY,
    origin: 'topLeft',
  })
  const grid = new Grid(Hex, rectangle({ width, height }))
  return { grid, layout: measureGrid(grid), width, height }
}

export function buildWorld(tiles: TileData[], hexSize: number) {
  setTiles(tiles)
  const { width, height } = dimensionsFromTiles(tiles)
  return createHexGrid(width, height, hexSize)
}
