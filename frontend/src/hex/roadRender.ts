import type { Graphics } from 'pixi.js'
import type { Axial } from './hero'

const AXIAL_NEIGHBORS: Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
]

function key(q: number, r: number): string {
  return `${q},${r}`
}

export type RoadPoint = { x: number; y: number }

/**
 * Straight road segments (BR S9-22). Each road hex draws from its centre to
 * the midpoint of an edge only when that edge was stepped by a routed path
 * (`roadMask` bit). A missing mask keeps the old neighbour-pair stroke so
 * maps saved before the mask still draw.
 */
export function strokeRoadSegments(
  g: Graphics,
  roadHexes: Axial[],
  centerOf: (q: number, r: number) => RoadPoint | null,
  strokeStyle: {
    width: number
    color: number
    alpha: number
    join: 'round'
    cap: 'round'
  },
  maskOf?: (q: number, r: number) => number | null | undefined,
): void {
  if (roadHexes.length === 0) {
    return
  }
  const nodes = new Set(roadHexes.map((h) => key(h.q, h.r)))
  const drawn = new Set<string>()
  let any = false
  for (const h of roadHexes) {
    const center = centerOf(h.q, h.r)
    if (!center) {
      continue
    }
    const bits = maskOf?.(h.q, h.r)
    const useMask = typeof bits === 'number'
    const hk = key(h.q, h.r)
    for (let i = 0; i < AXIAL_NEIGHBORS.length; i++) {
      const d = AXIAL_NEIGHBORS[i]!
      const nq = h.q + d.q
      const nr = h.r + d.r
      const nk = key(nq, nr)
      if (useMask) {
        if ((bits! & (1 << i)) === 0 || !nodes.has(nk)) {
          continue
        }
      } else if (!nodes.has(nk)) {
        continue
      }
      const ek = hk < nk ? `${hk}|${nk}` : `${nk}|${hk}`
      if (drawn.has(ek)) {
        continue
      }
      drawn.add(ek)
      const other = centerOf(nq, nr)
      if (!other) {
        continue
      }
      const mx = (center.x + other.x) / 2
      const my = (center.y + other.y) / 2
      g.moveTo(center.x, center.y)
      g.lineTo(mx, my)
      g.moveTo(other.x, other.y)
      g.lineTo(mx, my)
      any = true
    }
  }
  if (any) {
    g.stroke(strokeStyle)
  }
}

/** Thin dashed polyline. Each dash is its own stroke so Pixi does not join them. */
export function strokeDashedPolyline(
  g: Graphics,
  points: RoadPoint[],
  style: { width: number; color: number; alpha: number },
  dashLen = 7,
  gapLen = 5,
): void {
  if (points.length < 2) {
    return
  }
  let drawing = true
  let left = dashLen
  let cx = points[0]!.x
  let cy = points[0]!.y
  for (let i = 1; i < points.length; i++) {
    const x1 = points[i]!.x
    const y1 = points[i]!.y
    let dx = x1 - cx
    let dy = y1 - cy
    let dist = Math.hypot(dx, dy)
    if (dist < 1e-3) {
      continue
    }
    const ux = dx / dist
    const uy = dy / dist
    while (dist > 1e-3) {
      const step = Math.min(left, dist)
      const nx = cx + ux * step
      const ny = cy + uy * step
      if (drawing) {
        g.moveTo(cx, cy).lineTo(nx, ny).stroke({
          width: style.width,
          color: style.color,
          alpha: style.alpha,
          cap: 'round',
        })
      }
      cx = nx
      cy = ny
      dist -= step
      left -= step
      if (left <= 1e-3) {
        drawing = !drawing
        left = drawing ? dashLen : gapLen
      }
    }
  }
}
