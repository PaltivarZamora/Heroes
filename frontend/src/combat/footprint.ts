import type { Axial } from '../hex/hero'

/** Diamond-stacked battlefield footprint codes (odd-r aware via axial math). */
export const FOOTPRINT_CODES = [
  '1x1',
  '1x2',
  '2x1',
  '3x1',
  '2x2',
  '3x2',
  '3x3',
] as const
export type FootprintCode = (typeof FOOTPRINT_CODES)[number]

/** Bottom→top row widths for each shape (shared/footprint-shapes.json). */
import footprintShapesJson from '../../../shared/footprint-shapes.json'

const FOOTPRINT_ROW_WIDTHS: Record<FootprintCode, readonly number[]> =
  footprintShapesJson as Record<FootprintCode, readonly number[]>

/** Pointy-top northern neighbor deltas (toward smaller `r` / screen top). */
const NORTH_DELTAS: readonly Axial[] = [
  { q: 0, r: -1 },
  { q: 1, r: -1 },
]

export function isFootprintCode(value: string): value is FootprintCode {
  return (FOOTPRINT_CODES as readonly string[]).includes(value)
}

/**
 * Parse `unit.footprint` / `prop.footprint`. Unknown → `1x1`.
 * Legacy numeric hex_size: 1→1x1, 2→2x1 (linear pair); larger → 1x1.
 */
export function parseFootprint(raw: unknown): FootprintCode {
  if (typeof raw === 'string') {
    const trimmed = raw.trim().toLowerCase()
    if (isFootprintCode(trimmed)) {
      return trimmed
    }
  }
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isFinite(n) && n >= 2) {
    return Math.floor(n) === 2 ? '2x1' : '1x1'
  }
  return '1x1'
}

/** Bounding cols×rows of the diamond (for sprite scaling). */
export function footprintExtent(code: FootprintCode): {
  cols: number
  rows: number
  hexCount: number
} {
  const widths = FOOTPRINT_ROW_WIDTHS[code]
  return {
    cols: Math.max(...widths),
    rows: widths.length,
    hexCount: widths.reduce((sum, w) => sum + w, 0),
  }
}

/**
 * Contiguous row of `width` hexes centered among northern neighbors of `below`.
 */
function centeredRowAbove(below: Axial[], width: number): Axial[] {
  const seen = new Set<string>()
  const cands: Axial[] = []
  for (const hex of below) {
    for (const d of NORTH_DELTAS) {
      const next = { q: hex.q + d.q, r: hex.r + d.r }
      const key = `${next.q},${next.r}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      cands.push(next)
    }
  }
  cands.sort((a, b) => a.q - b.q || a.r - b.r)
  if (cands.length <= width) {
    return cands
  }
  const start = Math.floor((cands.length - width) / 2)
  return cands.slice(start, start + width)
}

/**
 * All hexes covered by a footprint.
 * `along`: +1 extends bottom row +q (attacker / props); −1 extends −q (defender).
 * Origin = leftmost (along=+1) or rightmost (along=−1) hex of the bottom row.
 */
export function footprintHexes(
  origin: Axial,
  code: FootprintCode,
  along: 1 | -1 = 1,
): Axial[] {
  const widths = FOOTPRINT_ROW_WIDTHS[code] ?? FOOTPRINT_ROW_WIDTHS['1x1']
  const bottomW = widths[0] ?? 1
  let row: Axial[] = []
  for (let i = 0; i < bottomW; i += 1) {
    row.push({ q: origin.q + along * i, r: origin.r })
  }
  const out: Axial[] = [...row]
  for (let u = 1; u < widths.length; u += 1) {
    row = centeredRowAbove(row, widths[u] ?? 1)
    out.push(...row)
  }
  return out
}

/**
 * Prop footprints anchored on the **centre** hex (BR S9-12 gangplank 3x1).
 * Odd-width bottom rows centre on `origin`; even widths keep left-origin
 * `footprintHexes(..., +1)` so town/unit 2x1 is unchanged when called there.
 */
export function footprintHexesCentered(
  origin: Axial,
  code: FootprintCode,
): Axial[] {
  const widths = FOOTPRINT_ROW_WIDTHS[code] ?? FOOTPRINT_ROW_WIDTHS['1x1']
  const bottomW = widths[0] ?? 1
  if (bottomW % 2 === 0) {
    return footprintHexes(origin, code, 1)
  }
  const half = Math.floor(bottomW / 2)
  let row: Axial[] = []
  for (let i = -half; i <= half; i += 1) {
    row.push({ q: origin.q + i, r: origin.r })
  }
  const out: Axial[] = [...row]
  for (let u = 1; u < widths.length; u += 1) {
    row = centeredRowAbove(row, widths[u] ?? 1)
    out.push(...row)
  }
  return out
}

function rowWidthsKey(widths: readonly number[]): string {
  return widths.join(',')
}

function codeForRowWidths(widths: readonly number[]): FootprintCode {
  for (const code of FOOTPRINT_CODES) {
    if (rowWidthsKey(FOOTPRINT_ROW_WIDTHS[code]) === rowWidthsKey(widths)) {
      return code
    }
  }
  return '1x1'
}

/** Rows that block movement, landing, and placement (all but the top row when 2+ rows). */
export function footprintBlockingCode(code: FootprintCode): FootprintCode {
  const widths = FOOTPRINT_ROW_WIDTHS[code] ?? FOOTPRINT_ROW_WIDTHS['1x1']
  if (widths.length <= 1) {
    return code
  }
  return codeForRowWidths(widths.slice(0, -1))
}

/** Non-blocking top row when the shape has 2+ rows; empty for 1x1 and 2x1. */
export function footprintHeadHexes(
  origin: Axial,
  code: FootprintCode,
  along: 1 | -1 = 1,
): Axial[] {
  const widths = FOOTPRINT_ROW_WIDTHS[code] ?? FOOTPRINT_ROW_WIDTHS['1x1']
  if (widths.length <= 1) {
    return []
  }
  const all = footprintHexes(origin, code, along)
  const body = footprintBlockingHexes(origin, code, along)
  const bodyKeys = new Set(body.map((hex) => `${hex.q},${hex.r}`))
  return all.filter((hex) => !bodyKeys.has(`${hex.q},${hex.r}`))
}

/** Blocking hexes only (same anchor as the full footprint). */
export function footprintBlockingHexes(
  origin: Axial,
  code: FootprintCode,
  along: 1 | -1 = 1,
): Axial[] {
  const blockCode = footprintBlockingCode(code)
  return footprintHexes(origin, blockCode, along)
}

/** Bottom-row hexes only (for render anchor: bottom-center). */
export function footprintBottomRow(
  origin: Axial,
  code: FootprintCode,
  along: 1 | -1 = 1,
): Axial[] {
  const bottomW = FOOTPRINT_ROW_WIDTHS[code]?.[0] ?? 1
  const row: Axial[] = []
  for (let i = 0; i < bottomW; i += 1) {
    row.push({ q: origin.q + along * i, r: origin.r })
  }
  return row
}

/** Bottom row centred on `origin` (props / gangplank). */
export function footprintBottomRowCentered(
  origin: Axial,
  code: FootprintCode,
): Axial[] {
  const bottomW = FOOTPRINT_ROW_WIDTHS[code]?.[0] ?? 1
  if (bottomW % 2 === 0) {
    return footprintBottomRow(origin, code, 1)
  }
  const half = Math.floor(bottomW / 2)
  const row: Axial[] = []
  for (let i = -half; i <= half; i += 1) {
    row.push({ q: origin.q + i, r: origin.r })
  }
  return row
}
