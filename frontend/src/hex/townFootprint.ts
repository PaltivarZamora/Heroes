import type { Axial } from './hero'
import { footprintBottomRow, footprintHexes } from '../combat/footprint'
import type { FeatureRow, ReferenceCatalog } from '../town/catalog'

/**
 * Town map footprint: 2×1, drawbridge on the RIGHT (hardcoded — flip later).
 * Stored town / map-object position = entry (right) hex.
 * Left hex is permanently blocked.
 */
export function townEntryHex(position: Axial): Axial {
  return { q: position.q, r: position.r }
}

/** Left (blocked) hex of a town whose position is the entry/right hex. */
export function townBlockedHex(position: Axial): Axial {
  return { q: position.q - 1, r: position.r }
}

/** Footprint origin = leftmost hex (for {@link footprintHexes} along=+1). */
export function townFootprintOrigin(position: Axial): Axial {
  return townBlockedHex(position)
}

export function townFootprintHexes(position: Axial): Axial[] {
  return footprintHexes(townFootprintOrigin(position), '2x1', 1)
}

export function townFootprintBottomRow(position: Axial): Axial[] {
  return footprintBottomRow(townFootprintOrigin(position), '2x1', 1)
}

export function isTownEntryHex(townPos: Axial, q: number, r: number): boolean {
  return townPos.q === q && townPos.r === r
}

export function isTownBlockedHex(townPos: Axial, q: number, r: number): boolean {
  const left = townBlockedHex(townPos)
  return left.q === q && left.r === r
}

export function isTownFootprintHex(townPos: Axial, q: number, r: number): boolean {
  return isTownEntryHex(townPos, q, r) || isTownBlockedHex(townPos, q, r)
}

/**
 * Whether the town building should draw above a unit at `unit`.
 * Entry/drawbridge hex → unit on top; blocked hex, left approach, or north of
 * the keep → town on top.
 */
export function townOccludesUnit(townPos: Axial, unit: Axial): boolean {
  if (isTownEntryHex(townPos, unit.q, unit.r)) {
    return false
  }
  if (isTownBlockedHex(townPos, unit.q, unit.r)) {
    return true
  }
  const keep = townBlockedHex(townPos)
  const entry = townEntryHex(townPos)
  // Same-row approach from the left (blocked side).
  if (unit.r === keep.r && unit.q < keep.q && unit.q >= keep.q - 2) {
    return true
  }
  // Pointy-top: smaller `r` is screen-north (behind / above the keep).
  // Cover two rows — town art is taller than the 2×1 footprint.
  if (unit.r >= keep.r || unit.r < keep.r - 2) {
    return false
  }
  const minQ = Math.min(keep.q, entry.q) - 1
  const maxQ = Math.max(keep.q, entry.q) + 1
  return unit.q >= minQ && unit.q <= maxQ
}

/** `feature` row for a town type (`feature_type` = town, stats.town_id). */
export function featureForTownType(
  catalog: ReferenceCatalog | null | undefined,
  townTypeId: number | null | undefined,
): FeatureRow | undefined {
  if (!catalog || townTypeId == null || !Number.isFinite(townTypeId) || townTypeId <= 0) {
    return undefined
  }
  const typeId = catalog.feature_type.find((row) => row.name === 'town')?.id
  return catalog.feature.find((row) => {
    if (typeId != null && row.feature_type_id !== typeId) {
      return false
    }
    const tid = Number(row.stats?.town_id)
    return Number.isFinite(tid) && tid === townTypeId
  })
}
