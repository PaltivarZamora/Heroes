import type { Axial } from './hero'
import { hexDistance, neighborHexes } from './pathfinding'
import { townFootprintHexes } from './townFootprint'

type Cube = { x: number; y: number; z: number }

function axialToCube(hex: Axial): Cube {
  const x = hex.q
  const z = hex.r
  const y = -x - z
  return { x, y, z }
}

function cubeToAxial(cube: Cube): Axial {
  return { q: cube.x, r: cube.z }
}

function cubeLerp(a: Cube, b: Cube, t: number): Cube {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  }
}

function cubeRound(cube: Cube): Cube {
  let rx = Math.round(cube.x)
  let ry = Math.round(cube.y)
  let rz = Math.round(cube.z)
  const xDiff = Math.abs(rx - cube.x)
  const yDiff = Math.abs(ry - cube.y)
  const zDiff = Math.abs(rz - cube.z)
  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz
  } else if (yDiff > zDiff) {
    ry = -rx - rz
  } else {
    rz = -rx - ry
  }
  return { x: rx, y: ry, z: rz }
}

/**
 * Inclusive straight hex line from `from` to `to` (cube lerp).
 * Length is hexDistance + 1 (includes both endpoints).
 */
export function hexLine(from: Axial, to: Axial): Axial[] {
  const n = hexDistance(from, to)
  if (n === 0) {
    return [{ q: from.q, r: from.r }]
  }
  const a = axialToCube(from)
  const b = axialToCube(to)
  const out: Axial[] = []
  for (let i = 0; i <= n; i += 1) {
    out.push(cubeToAxial(cubeRound(cubeLerp(a, b, i / n))))
  }
  return out
}

/**
 * Ordered ring of hexes around a town's 2×1 footprint (excludes the town
 * hexes). Used for Hanger "circling" while the hero slot is occupied.
 */
export function townCirclePath(townPos: Axial): Axial[] {
  const footprint = new Set(
    townFootprintHexes(townPos).map((hex) => `${hex.q},${hex.r}`),
  )
  const ring = new Map<string, Axial>()
  for (const hex of townFootprintHexes(townPos)) {
    for (const n of neighborHexes(hex)) {
      const key = `${n.q},${n.r}`
      if (!footprint.has(key)) {
        ring.set(key, { q: n.q, r: n.r })
      }
    }
  }
  const cells = [...ring.values()]
  // Midpoint of the 2×1 (entry on the right, blocked on the left).
  const cx = townPos.q - 0.5
  const cy = townPos.r
  cells.sort((a, b) => {
    const aa = Math.atan2(a.r - cy, a.q - cx)
    const bb = Math.atan2(b.r - cy, b.q - cx)
    return aa - bb
  })
  return cells
}

function circleIndex(ring: Axial[], at: Axial): number {
  const exact = ring.findIndex((hex) => hex.q === at.q && hex.r === at.r)
  if (exact >= 0) {
    return exact
  }
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < ring.length; i += 1) {
    const hex = ring[i]!
    const d = hexDistance(at, hex)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

/** Next hex one step clockwise on the town circle (wraps). */
export function nextTownCircleHex(townPos: Axial, from: Axial): Axial {
  const ring = townCirclePath(townPos)
  if (ring.length === 0) {
    return { q: from.q, r: from.r }
  }
  const idx = circleIndex(ring, from)
  const onRing = ring[idx]!.q === from.q && ring[idx]!.r === from.r
  // If not yet on the ring, step onto nearest ring hex first.
  if (!onRing) {
    return { ...ring[idx]! }
  }
  return { ...ring[(idx + 1) % ring.length]! }
}

/**
 * One full clockwise lap starting after `from` (excludes `from` if already
 * on the ring; includes a return to the start hex).
 */
export function townCircleLapSteps(townPos: Axial, from: Axial): Axial[] {
  const ring = townCirclePath(townPos)
  if (ring.length === 0) {
    return []
  }
  const idx = circleIndex(ring, from)
  const onRing = ring[idx]!.q === from.q && ring[idx]!.r === from.r
  const out: Axial[] = []
  if (!onRing) {
    out.push({ ...ring[idx]! })
  }
  for (let step = 1; step <= ring.length; step += 1) {
    out.push({ ...ring[(idx + step) % ring.length]! })
  }
  return out
}

/** Hexes to traverse this flight segment (excludes current hex). */
export function flightSegmentSteps(
  from: Axial,
  to: Axial,
  steps: number,
): Axial[] {
  const n = Math.floor(Number(steps))
  if (!Number.isFinite(n) || n <= 0) {
    return []
  }
  const line = hexLine(from, to)
  if (line.length <= 1) {
    return []
  }
  const endIdx = Math.min(line.length - 1, n)
  return line.slice(1, endIdx + 1).map((hex) => ({ q: hex.q, r: hex.r }))
}

/** Advance along a straight line toward `to` by up to `steps` hexes (never past). */
export function advanceAlongHexLine(
  from: Axial,
  to: Axial,
  steps: number,
): Axial {
  const n = Math.floor(Number(steps))
  if (!Number.isFinite(n) || n <= 0) {
    return { q: from.q, r: from.r }
  }
  const line = hexLine(from, to)
  if (line.length === 0) {
    return { q: from.q, r: from.r }
  }
  const idx = Math.min(line.length - 1, n)
  const hex = line[idx] ?? line[0]!
  return { q: hex.q, r: hex.r }
}
