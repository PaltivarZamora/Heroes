import type { ReferenceCatalog, UnitRow } from './catalog'

/** Dwelling tier on the unit row (`level` 1 = base, 2 = upgraded). */
export function unitDwellingLevel(
  unit: UnitRow | { level?: number } | null | undefined,
): number {
  const raw = unit?.level
  if (raw == null || !Number.isFinite(raw)) {
    return 1
  }
  const n = Math.floor(raw)
  return n > 0 ? n : 1
}

function classBranchId(unit: UnitRow): number | null {
  const id = unit.class_id
  return id != null && id > 0 ? id : null
}

export function sameUpgradeBranch(a: UnitRow, b: UnitRow): boolean {
  if ((a.town_id ?? null) !== (b.town_id ?? null)) {
    return false
  }
  if ((a.tier ?? null) !== (b.tier ?? null)) {
    return false
  }
  return classBranchId(a) === classBranchId(b)
}

export function unitHasUpgradeCost(unit: UnitRow): boolean {
  const cost = unit.upgrade_cost
  if (!cost) {
    return false
  }
  return Object.values(cost).some((amount) => amount > 0)
}

export function advancedUnitsFor(
  catalog: ReferenceCatalog,
  base: UnitRow,
): UnitRow[] {
  return catalog.unit.filter(
    (row) =>
      sameUpgradeBranch(row, base) && unitDwellingLevel(row) === 2,
  )
}

export type UpgradePairingIssue = {
  unitId: number
  unitName: string
  townId: number | null
  tier: number | null
  classId: number | null
  kind: 'no_advanced' | 'ambiguous_advanced'
  matchIds: number[]
}

/** Recruitable bases (`upgrade_cost` set) with zero or multiple level-2 partners. */
export function auditUpgradePairing(
  catalog: ReferenceCatalog,
): UpgradePairingIssue[] {
  const issues: UpgradePairingIssue[] = []
  for (const unit of catalog.unit) {
    if (unitDwellingLevel(unit) !== 1 || !unitHasUpgradeCost(unit)) {
      continue
    }
    const matches = advancedUnitsFor(catalog, unit)
    if (matches.length === 1) {
      continue
    }
    issues.push({
      unitId: unit.id,
      unitName: unit.name,
      townId: unit.town_id,
      tier: unit.tier,
      classId: unit.class_id,
      kind: matches.length === 0 ? 'no_advanced' : 'ambiguous_advanced',
      matchIds: matches.map((row) => row.id),
    })
  }
  return issues.sort((a, b) => a.unitId - b.unitId)
}
