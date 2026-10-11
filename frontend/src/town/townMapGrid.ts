import { defineHex, Grid, Orientation, rectangle, type Hex } from 'honeycomb-grid'
import { HEX_SCALES } from '../hex/hexScale'
import {
  COMBAT_COLUMNS,
  COMBAT_HEX_SIZE,
  COMBAT_ROWS,
} from '../combat/battlefield'

/**
 * Town map grid (BR S9-48). Same honeycomb setup as the 17×13 battle grid
 * ({@link createCombatHexGrid}): pointy-top, origin topLeft, Large radius 42,
 * `rectangle({ width: 17, height: 13 })`. Combat adds a 28px pad; the town map
 * does not, so the hex bounding box fills the 1273×840 game window.
 *
 * Honeycomb odd-r: 0-based rows 1, 3, 5, … (1-based rows 2, 4, 6, …) are
 * shifted right by half a hex. Numbering is left to right, then top to bottom:
 * row 1 = 1–17, row 2 = 18–34, … using `hex.col` / `hex.row`.
 */
export const TOWN_MAP_COLUMNS = COMBAT_COLUMNS
export const TOWN_MAP_ROWS = COMBAT_ROWS
export const TOWN_MAP_HEX_SIZE = COMBAT_HEX_SIZE
export const TOWN_MAP_HEX_COUNT = TOWN_MAP_COLUMNS * TOWN_MAP_ROWS

export type TownMapPoint = { x: number; y: number }

export type TownMapCell = {
  /** 1–221. */
  n: number
  col: number
  row: number
  q: number
  r: number
  center: TownMapPoint
  corners: TownMapPoint[]
  /** Lowest corner, stage px. Used for depth sort. */
  bottom: number
}

export type TownMapGrid = {
  cells: TownMapCell[]
  byNumber: Map<number, TownMapCell>
}

/** Shifted rows (1-based 2, 4, 6, …): rightmost column has no mirror partner. */
export const TOWN_HEX_NUMBERS_WITHOUT_MIRROR: readonly number[] = [
  34, 68, 102, 136, 170, 204,
]

const townHexNoMirror = new Set(TOWN_HEX_NUMBERS_WITHOUT_MIRROR)

export type TownHexPlaceContext = {
  townName: string
  slot?: number
  role?: 'door' | 'footprint' | 'entry' | 'road'
}

let cached: TownMapGrid | null = null

function hexCenter(hex: Hex): TownMapPoint {
  let x = 0
  let y = 0
  const corners = hex.corners
  for (const corner of corners) {
    x += corner.x
    y += corner.y
  }
  const n = corners.length || 1
  return { x: x / n, y: y / n }
}

export function createTownMapGrid(): TownMapGrid {
  if (cached) {
    return cached
  }
  if (HEX_SCALES.Large !== TOWN_MAP_HEX_SIZE) {
    throw new Error('Town map hex size must stay Large (42), matching combat.')
  }
  const TownHex = defineHex({
    dimensions: TOWN_MAP_HEX_SIZE,
    orientation: Orientation.POINTY,
    origin: 'topLeft',
  })
  const grid = new Grid(
    TownHex,
    rectangle({ width: TOWN_MAP_COLUMNS, height: TOWN_MAP_ROWS }),
  )
  const cells: TownMapCell[] = []
  grid.forEach((hex) => {
    const corners = hex.corners.map((corner) => ({ x: corner.x, y: corner.y }))
    let bottom = -Infinity
    for (const corner of corners) {
      if (corner.y > bottom) {
        bottom = corner.y
      }
    }
    const col = hex.col
    const row = hex.row
    cells.push({
      n: row * TOWN_MAP_COLUMNS + col + 1,
      col,
      row,
      q: hex.q,
      r: hex.r,
      center: hexCenter(hex),
      corners,
      bottom,
    })
  })
  cells.sort((a, b) => a.n - b.n)
  const byNumber = new Map(cells.map((cell) => [cell.n, cell]))
  cached = { cells, byNumber }
  return cached
}

/**
 * Exact mirror by row (BR S9-48 follow-up 1). Unshifted rows: col' = 16 − col.
 * Shifted rows (1-based 2, 4, 6, …): col' = 15 − col.
 */
export function mirrorTownHexNumber(n: number): number | null {
  if (!Number.isInteger(n) || n < 1 || n > TOWN_MAP_HEX_COUNT) {
    return null
  }
  if (townHexNoMirror.has(n)) {
    return null
  }
  const index = n - 1
  const row = Math.floor(index / TOWN_MAP_COLUMNS)
  const col = index % TOWN_MAP_COLUMNS
  const shifted = row % 2 === 1
  const colPrime = shifted ? 15 - col : TOWN_MAP_COLUMNS - 1 - col
  if (colPrime < 0 || colPrime >= TOWN_MAP_COLUMNS) {
    return null
  }
  const mirrored = row * TOWN_MAP_COLUMNS + colPrime + 1
  if (townHexNoMirror.has(mirrored)) {
    return null
  }
  return mirrored
}

function warnSkippedMirrorHex(n: number, ctx: TownHexPlaceContext): void {
  const slot =
    ctx.slot != null ? ` slot ${ctx.slot}` : ''
  const role = ctx.role ? ` (${ctx.role})` : ''
  console.warn(
    `[town map] Flipped town "${ctx.townName}"${slot}: layout hex ${n}${role} has no mirror; skipped.`,
  )
}

export function placedTownHex(
  n: number,
  flipped: boolean,
  ctx?: TownHexPlaceContext,
): number | null {
  if (!flipped) {
    return n
  }
  const mirrored = mirrorTownHexNumber(n)
  if (mirrored == null && ctx) {
    warnSkippedMirrorHex(n, ctx)
  }
  return mirrored
}

export function pointInPolygon(
  x: number,
  y: number,
  corners: readonly TownMapPoint[],
): boolean {
  let inside = false
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const a = corners[i]!
    const b = corners[j]!
    const crosses = (a.y > y) !== (b.y > y)
    if (!crosses) {
      continue
    }
    const xAt = ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
    if (x < xAt) {
      inside = !inside
    }
  }
  return inside
}

export function townHexAtPoint(
  grid: TownMapGrid,
  x: number,
  y: number,
): TownMapCell | null {
  for (const cell of grid.cells) {
    if (pointInPolygon(x, y, cell.corners)) {
      return cell
    }
  }
  return null
}

export function axialDistance(
  a: { q: number; r: number },
  b: { q: number; r: number },
): number {
  return (
    (Math.abs(a.q - b.q) +
      Math.abs(a.q + a.r - b.q - b.r) +
      Math.abs(a.r - b.r)) /
    2
  )
}

/** Hex of `candidates` whose centre is closest to the centroid. Tie → lower number. */
export function centerHexNumber(
  grid: TownMapGrid,
  candidates: readonly number[],
): number | null {
  const cells: TownMapCell[] = []
  for (const n of candidates) {
    const cell = grid.byNumber.get(n)
    if (cell) {
      cells.push(cell)
    }
  }
  if (cells.length === 0) {
    return null
  }
  let cx = 0
  let cy = 0
  for (const cell of cells) {
    cx += cell.center.x
    cy += cell.center.y
  }
  cx /= cells.length
  cy /= cells.length
  let best = cells[0]!
  let bestD = Infinity
  for (const cell of cells) {
    const d = (cell.center.x - cx) ** 2 + (cell.center.y - cy) ** 2
    if (d < bestD - 0.01 || (Math.abs(d - bestD) <= 0.01 && cell.n < best.n)) {
      best = cell
      bestD = d
    }
  }
  return best.n
}

export function hexesBoundingBox(
  grid: TownMapGrid,
  numbers: readonly number[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let any = false
  for (const n of numbers) {
    const cell = grid.byNumber.get(n)
    if (!cell) {
      continue
    }
    any = true
    for (const corner of cell.corners) {
      minX = Math.min(minX, corner.x)
      minY = Math.min(minY, corner.y)
      maxX = Math.max(maxX, corner.x)
      maxY = Math.max(maxY, corner.y)
    }
  }
  if (!any) {
    return null
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Road hexes ordered by distance from `entry` (near first). `entry` itself
 * is omitted. Equal distance keeps the lower hex number.
 */
export function roadHexesNearestEntry(
  grid: TownMapGrid,
  entry: number | null,
  road: readonly number[],
): number[] {
  const entryCell = entry != null ? grid.byNumber.get(entry) : undefined
  const unique = [...new Set(road)].filter(
    (n) => n !== entry && grid.byNumber.has(n),
  )
  if (!entryCell) {
    return unique.sort((a, b) => a - b)
  }
  return unique.sort((a, b) => {
    const da = axialDistance(entryCell, grid.byNumber.get(a)!)
    const db = axialDistance(entryCell, grid.byNumber.get(b)!)
    if (da !== db) {
      return da - db
    }
    return a - b
  })
}
