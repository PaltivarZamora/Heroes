import type { Axial } from '../hex/hero'
import { hexDistance } from '../hex/pathfinding'
import type { ReferenceCatalog } from '../town/catalog'
import type { CombatStack } from './battle'
import { minFootprintHexDistance, stackFootprint } from './occupancy'

/** Pointy-top wedge index from `from` toward `hex` (matches combat pointer wedges). */
export function hexWedgeZone(from: Axial, hex: Axial): 0 | 1 | 2 | 3 | 4 | 5 {
  const dq = hex.q - from.q
  const dr = hex.r - from.r
  const dx = dq
  const dy = dr + dq * 0.5
  const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
  return (Math.floor((deg + 30) / 60) % 6) as 0 | 1 | 2 | 3 | 4 | 5
}

function pickDeterministic(hexes: Axial[]): Axial {
  return [...hexes].sort((a, b) => a.q - b.q || a.r - b.r)[0]!
}

/**
 * Footprint hex to act from: closest to `aim`, tie-break by wedge pointer then
 * direction toward aim (AI).
 */
export function actionOriginFootprintHex(
  standAnchor: Axial,
  stack: CombatStack,
  catalog: ReferenceCatalog,
  aim: Axial,
  wedgeZone?: number | null,
): Axial {
  const body = { ...stack, q: standAnchor.q, r: standAnchor.r }
  const hexes = stackFootprint(body, catalog)
  let bestDist = Infinity
  for (const h of hexes) {
    bestDist = Math.min(bestDist, hexDistance(h, aim))
  }
  const tied = hexes.filter((h) => hexDistance(h, aim) === bestDist)
  if (tied.length === 1) {
    return tied[0]!
  }
  if (wedgeZone != null && Number.isFinite(wedgeZone)) {
    const zone = ((Math.floor(wedgeZone) % 6) + 6) % 6
    const match = tied.filter((h) => hexWedgeZone(standAnchor, h) === zone)
    if (match.length > 0) {
      return pickDeterministic(match)
    }
  }
  const towardAim = hexWedgeZone(standAnchor, aim)
  const aimSide = tied.filter((h) => hexWedgeZone(standAnchor, h) === towardAim)
  if (aimSide.length > 0) {
    return pickDeterministic(aimSide)
  }
  return pickDeterministic(tied)
}

/** Closest hex on `target`'s footprint to any hex of `viewer`. */
export function closestHexOnTargetFootprint(
  viewer: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
): Axial {
  const vHexes = stackFootprint(viewer, catalog)
  const tHexes = stackFootprint(target, catalog)
  let best = { q: target.q, r: target.r }
  let bestDist = Infinity
  for (const t of tHexes) {
    for (const v of vHexes) {
      const d = hexDistance(v, t)
      if (d < bestDist || (d === bestDist && (t.q < best.q || (t.q === best.q && t.r < best.r)))) {
        bestDist = d
        best = t
      }
    }
  }
  return best
}

export function footprintsTouch(
  a: CombatStack,
  b: CombatStack,
  catalog: ReferenceCatalog,
): boolean {
  return (
    minFootprintHexDistance(
      { q: a.q, r: a.r },
      a,
      b,
      catalog,
    ) === 1
  )
}

export type ShapeGeometryOpts = {
  standAnchor: Axial
  attacker: CombatStack
  wedgeZone?: number | null
  /** charge_line: pre-move stand anchor. */
  chargeStandAnchor?: Axial | null
}

export function shapeActionOrigin(
  opts: ShapeGeometryOpts,
  catalog: ReferenceCatalog,
  aim: Axial,
): Axial {
  const stand = opts.chargeStandAnchor ?? opts.standAnchor
  const body = { ...opts.attacker, q: stand.q, r: stand.r }
  return actionOriginFootprintHex(stand, body, catalog, aim, opts.wedgeZone)
}
