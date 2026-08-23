import { RESOURCES, formatAmount, isResourceName } from '../hex/resources'

export type CostMap = Record<string, number>

export type BuildingRow = {
  id: number
  name: string
  town_id: number
  tier: number | null
  class_id: number | null
  bldg_prereq_id: number | null
  cost: CostMap | null
  effect_type: string
  payload: Record<string, unknown> | null
  destroy_cost: CostMap | null
  slot_num: number | null
  image_path: string | null
  /** Weekly unit growth — unused until recruitment exists. */
  growth: number | null
}

export type UnitRow = {
  id: number
  name: string
  bldg_id: number | null
}

export type HeroTypeRow = {
  id: number
  name: string
}

export type ReferenceCatalog = {
  building: BuildingRow[]
  unit: UnitRow[]
  hero_type: HeroTypeRow[]
}

/** TBD until per-building destroy_cost values exist. */
export const PLACEHOLDER_DESTROY_COST: CostMap = { Gold: 500 }

const NECROPOLIS_TOWN_ID = 1

export async function fetchCatalog(): Promise<ReferenceCatalog> {
  const response = await fetch('/api/reference/catalog')
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const payload = (await response.json()) as Partial<ReferenceCatalog>
  return {
    building: Array.isArray(payload.building) ? payload.building : [],
    unit: Array.isArray(payload.unit) ? payload.unit : [],
    hero_type: Array.isArray(payload.hero_type) ? payload.hero_type : [],
  }
}

export const BUILDING_SLOT_COUNT = 12
export const RESERVED_BUILDING_SLOT = 12

export function isArmySlot(slotId: number): boolean {
  return slotId >= 4 && slotId <= 9
}

export function isReservedBuildingSlot(slotId: number): boolean {
  return slotId === RESERVED_BUILDING_SLOT
}

export function armyTier(slotId: number): number {
  return slotId - 3
}

function asCost(value: CostMap | null | undefined): CostMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const cost: CostMap = {}
  for (const [name, amount] of Object.entries(value)) {
    const n = Number(amount)
    if (Number.isFinite(n) && n !== 0) {
      cost[name] = n
    }
  }
  return cost
}

export function buildingCost(building: BuildingRow): CostMap {
  return asCost(building.cost)
}

export function destroyCostOf(building: BuildingRow): CostMap {
  const listed = asCost(building.destroy_cost)
  return Object.keys(listed).length > 0 ? listed : PLACEHOLDER_DESTROY_COST
}

export function formatCost(cost: CostMap): string {
  const parts: string[] = []
  for (const resource of RESOURCES) {
    const amount = cost[resource.name]
    if (amount) {
      parts.push(`${formatAmount(amount)} ${resource.name}`)
    }
  }
  for (const [name, amount] of Object.entries(cost)) {
    if (amount && !isResourceName(name)) {
      parts.push(`${formatAmount(amount)} ${name}`)
    }
  }
  return parts.length > 0 ? parts.join(', ') : 'Free'
}

export function payloadNote(payload: Record<string, unknown> | null): string {
  if (!payload) {
    return ''
  }
  if (typeof payload.yield === 'string') {
    return payload.yield
  }
  if (typeof payload.note === 'string') {
    return payload.note
  }
  return ''
}

export function effectLine(building: BuildingRow, units: UnitRow[]): string {
  const payload = building.payload
  switch (building.effect_type) {
    case 'unit_unlock': {
      const unit = units.find((row) => row.bldg_id === building.id)
      const growth =
        payload && typeof payload.weekly_growth === 'number'
          ? payload.weekly_growth
          : '?'
      return `Trains ${growth} ${unit?.name ?? 'units'} per week`
    }
    case 'resource_yield':
      return payloadNote(payload) || 'Produces resources'
    case 'defense_tier':
      return 'Increases town defense'
    case 'passive_buff':
    case 'recruitment':
      return payloadNote(payload) || (building.effect_type === 'recruitment'
        ? 'Hero recruitment'
        : 'Town bonus')
    default:
      return payloadNote(payload)
  }
}

export function heroTypeName(
  catalog: ReferenceCatalog,
  classId: number | null,
): string {
  if (classId == null) {
    return ''
  }
  return catalog.hero_type.find((row) => row.id === classId)?.name ?? ''
}

function buildingsInSlot(
  catalog: ReferenceCatalog,
  slotId: number,
): BuildingRow[] {
  return catalog.building.filter(
    (row) => row.town_id === NECROPOLIS_TOWN_ID && row.slot_num === slotId,
  )
}

export function undesignedBuilding(
  catalog: ReferenceCatalog,
  slotId: number,
): BuildingRow | null {
  return (
    buildingsInSlot(catalog, slotId).find((row) => row.effect_type === 'TBD') ??
    null
  )
}

export function isUndesignedSlot(
  catalog: ReferenceCatalog,
  slotId: number,
): boolean {
  const rows = buildingsInSlot(catalog, slotId)
  if (rows.some((row) => row.effect_type === 'TBD')) {
    return true
  }
  return (slotId === 10 || slotId === 11) && rows.length === 0
}

export function armyOptions(
  catalog: ReferenceCatalog,
  slotId: number,
): BuildingRow[] {
  return buildingsInSlot(catalog, slotId).filter((row) => row.class_id != null)
}

export function genericSlotBuildings(
  catalog: ReferenceCatalog,
  slotId: number,
): BuildingRow[] {
  return buildingsInSlot(catalog, slotId)
    .filter((row) => row.class_id == null)
    .sort((a, b) => a.id - b.id)
}

export function genericRoot(buildings: BuildingRow[]): BuildingRow | null {
  if (buildings.length === 0) {
    return null
  }
  const roots = buildings.filter((row) => row.bldg_prereq_id == null)
  return (roots[0] ?? buildings[0]) ?? null
}

export function nextInChain(
  current: BuildingRow,
  catalog: ReferenceCatalog,
  slotId: number,
): BuildingRow | null {
  const group = isArmySlot(slotId)
    ? armyOptions(catalog, slotId)
    : genericSlotBuildings(catalog, slotId)
  const child = group.find((row) => row.bldg_prereq_id === current.id)
  if (child) {
    return child
  }
  if (isArmySlot(slotId)) {
    return null
  }
  const index = group.findIndex((row) => row.id === current.id)
  if (index < 0 || index + 1 >= group.length) {
    return null
  }
  return group[index + 1] ?? null
}

export function buildingById(
  catalog: ReferenceCatalog,
  id: number | null,
): BuildingRow | null {
  if (id == null) {
    return null
  }
  return catalog.building.find((row) => row.id === id) ?? null
}

export function unitForBuilding(
  catalog: ReferenceCatalog,
  buildingId: number | null,
): UnitRow | null {
  if (buildingId == null) {
    return null
  }
  return catalog.unit.find((row) => row.bldg_id === buildingId) ?? null
}
