import {
  GOLD_RESOURCE_ID,
  RESOURCES,
  applyResourceCatalog,
  formatAmount,
  resourceById,
} from '../hex/resources'

export type CostMap = Record<number, number>

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
  /** Weekly unit growth added to recruit_qty on week rollover. */
  growth: number | null
}

export type UnitRow = {
  id: number
  name: string
  bldg_id: number | null
  cost: CostMap | null
}

export type HeroTypeRow = {
  id: number
  name: string
}

export type HeroPoolRow = {
  id: number
  name: string
  class_id: number
  image_path: string | null
}

export type ResourceRow = {
  id: number
  name: string
}

export type TownRow = {
  id: number
  name: string
}

export type ReferenceCatalog = {
  building: BuildingRow[]
  unit: UnitRow[]
  hero_type: HeroTypeRow[]
  hero_pool: HeroPoolRow[]
  resource: ResourceRow[]
  town: TownRow[]
}

/** TBD until per-building destroy_cost values exist. */
export const PLACEHOLDER_DESTROY_COST: CostMap = { [GOLD_RESOURCE_ID]: 500 }

function costKeyToId(key: string): number | null {
  const asNumber = Number(key)
  if (Number.isInteger(asNumber) && resourceById(asNumber)) {
    return asNumber
  }
  const byName = RESOURCES.find((resource) => resource.name === key)
  return byName ? byName.id : null
}

function asCost(value: CostMap | Record<string, number> | null | undefined): CostMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const cost: CostMap = {}
  for (const [key, amount] of Object.entries(value)) {
    const n = Number(amount)
    const id = costKeyToId(key)
    if (id != null && Number.isFinite(n) && n !== 0) {
      cost[id] = n
    }
  }
  return cost
}

function asHeroPool(rows: unknown): HeroPoolRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  const pool: HeroPoolRow[] = []
  for (const row of rows) {
    if (row == null || typeof row !== 'object') {
      continue
    }
    const rec = row as Record<string, unknown>
    const id = Number(rec.id)
    const classId = Number(rec.class_id)
    const name = typeof rec.name === 'string' ? rec.name.trim() : ''
    if (!Number.isInteger(id) || !Number.isInteger(classId) || !name) {
      continue
    }
    const image =
      typeof rec.image_path === 'string' ? rec.image_path.trim() : ''
    pool.push({
      id,
      name,
      class_id: classId,
      image_path: image || null,
    })
  }
  return pool
}

export async function fetchCatalog(): Promise<ReferenceCatalog> {
  const response = await fetch('/api/reference/catalog')
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const payload = (await response.json()) as Partial<ReferenceCatalog> & {
    resource?: ResourceRow[]
    town?: TownRow[]
  }
  applyResourceCatalog(Array.isArray(payload.resource) ? payload.resource : [])
  const building = (Array.isArray(payload.building) ? payload.building : []).map(
    (row) => {
      const growthNum = Number(row.growth)
      return {
        ...row,
        cost: asCost(row.cost),
        destroy_cost: asCost(row.destroy_cost),
        growth: Number.isFinite(growthNum) ? growthNum : row.growth,
      }
    },
  )
  const unit = (Array.isArray(payload.unit) ? payload.unit : []).map((row) => ({
    ...row,
    cost: asCost(row.cost),
  }))
  const catalog: ReferenceCatalog = {
    building,
    unit,
    hero_type: Array.isArray(payload.hero_type) ? payload.hero_type : [],
    hero_pool: asHeroPool(payload.hero_pool),
    resource: Array.isArray(payload.resource) ? payload.resource : [],
    town: Array.isArray(payload.town) ? payload.town : [],
  }
  cachedCatalog = catalog
  return catalog
}

let cachedCatalog: ReferenceCatalog | null = null

export function getCachedCatalog(): ReferenceCatalog | null {
  return cachedCatalog
}

export function buildingGrowth(building: BuildingRow | null): number {
  if (!building) {
    return 0
  }
  if (typeof building.growth === 'number' && Number.isFinite(building.growth) && building.growth > 0) {
    return Math.floor(building.growth)
  }
  const weekly = building.payload?.weekly_growth
  if (typeof weekly === 'number' && Number.isFinite(weekly) && weekly > 0) {
    return Math.floor(weekly)
  }
  return 0
}

export function unitCost(unit: UnitRow | null): CostMap {
  return unit ? asCost(unit.cost) : {}
}

export function scaleCost(cost: CostMap, qty: number): CostMap {
  const scaled: CostMap = {}
  for (const [key, amount] of Object.entries(cost)) {
    scaled[Number(key)] = amount * qty
  }
  return scaled
}

export function maxAffordableQty(
  wallet: { [id: number]: { stockpile: number } },
  cost: CostMap,
  cap: number,
): number {
  if (cap <= 0) {
    return 0
  }
  let max = cap
  for (const [key, amount] of Object.entries(cost)) {
    if (amount <= 0) {
      continue
    }
    const have = wallet[Number(key)]?.stockpile ?? 0
    max = Math.min(max, Math.floor(have / amount))
  }
  return Math.max(0, Math.floor(max))
}

export const BUILDING_SLOT_COUNT = 12
export const RESERVED_BUILDING_SLOT = 12

export function isArmySlot(slotId: number): boolean {
  return slotId >= 4 && slotId <= 9
}

export function isTavernBuilding(building: BuildingRow): boolean {
  return building.name.trim().toLowerCase() === 'tavern'
}

export function isReservedBuildingSlot(slotId: number): boolean {
  return slotId === RESERVED_BUILDING_SLOT
}

export function armyTier(slotId: number): number {
  return slotId - 3
}

export function buildingCost(building: BuildingRow): CostMap {
  return asCost(building.cost)
}

/** Construction cost; if the building row has none, use that dwelling's unit cost. */
export function constructionCost(
  catalog: ReferenceCatalog,
  building: BuildingRow,
): CostMap {
  const listed = buildingCost(building)
  if (Object.keys(listed).length > 0) {
    return listed
  }
  return unitCost(unitForBuilding(catalog, building.id))
}

export function hasPrerequisite(
  building: BuildingRow,
  builtIds: ReadonlySet<number>,
): boolean {
  return (
    building.bldg_prereq_id == null || builtIds.has(building.bldg_prereq_id)
  )
}

export function armyBuildOptions(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
  builtIds: ReadonlySet<number>,
): BuildingRow[] {
  return armyOptions(catalog, slotId, townTypeId).filter((row) =>
    hasPrerequisite(row, builtIds),
  )
}

export function destroyCostOf(building: BuildingRow): CostMap {
  const listed = asCost(building.destroy_cost)
  return Object.keys(listed).length > 0 ? listed : PLACEHOLDER_DESTROY_COST
}

export function formatCost(cost: CostMap): string {
  const parts: string[] = []
  const seen = new Set<number>()
  for (const resource of RESOURCES) {
    const amount = cost[resource.id]
    if (amount) {
      seen.add(resource.id)
      parts.push(`${formatAmount(amount)} ${resource.name}`)
    }
  }
  for (const [key, amount] of Object.entries(cost)) {
    const id = Number(key)
    if (amount && !seen.has(id)) {
      const resource = resourceById(id)
      parts.push(`${formatAmount(amount)} ${resource?.name ?? `#${key}`}`)
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
      const growth = buildingGrowth(building)
      return `Trains ${growth > 0 ? String(growth) : '?'} ${unit?.name ?? 'units'} per week`
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
  townTypeId: number,
): BuildingRow[] {
  return catalog.building.filter(
    (row) => row.town_id === townTypeId && row.slot_num === slotId,
  )
}

export function undesignedBuilding(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
): BuildingRow | null {
  return (
    buildingsInSlot(catalog, slotId, townTypeId).find(
      (row) => row.effect_type === 'TBD',
    ) ?? null
  )
}

export function isUndesignedSlot(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
): boolean {
  const rows = buildingsInSlot(catalog, slotId, townTypeId)
  if (rows.some((row) => row.effect_type === 'TBD')) {
    return true
  }
  return (slotId === 10 || slotId === 11) && rows.length === 0
}

export function armyOptions(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
): BuildingRow[] {
  return buildingsInSlot(catalog, slotId, townTypeId).filter(
    (row) => row.class_id != null,
  )
}

export function genericSlotBuildings(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
): BuildingRow[] {
  return buildingsInSlot(catalog, slotId, townTypeId)
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
  townTypeId: number,
): BuildingRow | null {
  const group = isArmySlot(slotId)
    ? armyOptions(catalog, slotId, townTypeId)
    : genericSlotBuildings(catalog, slotId, townTypeId)
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
