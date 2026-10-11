/** Dwelling tier on the unit row (`level` 1 = base, 2 = upgraded). */
export function unitDwellingLevel(unit) {
    const raw = unit?.level;
    if (raw == null || !Number.isFinite(raw)) {
        return 1;
    }
    const n = Math.floor(raw);
    return n > 0 ? n : 1;
}
function classBranchId(unit) {
    const id = unit.class_id;
    return id != null && id > 0 ? id : null;
}
export function sameUpgradeBranch(a, b) {
    if ((a.town_id ?? null) !== (b.town_id ?? null)) {
        return false;
    }
    if ((a.tier ?? null) !== (b.tier ?? null)) {
        return false;
    }
    return classBranchId(a) === classBranchId(b);
}
export function unitHasUpgradeCost(unit) {
    const cost = unit.upgrade_cost;
    if (!cost) {
        return false;
    }
    return Object.values(cost).some((amount) => amount > 0);
}
export function advancedUnitsFor(catalog, base) {
    return catalog.unit.filter((row) => sameUpgradeBranch(row, base) && unitDwellingLevel(row) === 2);
}
/** Recruitable bases (`upgrade_cost` set) with zero or multiple level-2 partners. */
export function auditUpgradePairing(catalog) {
    const issues = [];
    for (const unit of catalog.unit) {
        if (unitDwellingLevel(unit) !== 1 || !unitHasUpgradeCost(unit)) {
            continue;
        }
        const matches = advancedUnitsFor(catalog, unit);
        if (matches.length === 1) {
            continue;
        }
        issues.push({
            unitId: unit.id,
            unitName: unit.name,
            townId: unit.town_id,
            tier: unit.tier,
            classId: unit.class_id,
            kind: matches.length === 0 ? 'no_advanced' : 'ambiguous_advanced',
            matchIds: matches.map((row) => row.id),
        });
    }
    return issues.sort((a, b) => a.unitId - b.unitId);
}
