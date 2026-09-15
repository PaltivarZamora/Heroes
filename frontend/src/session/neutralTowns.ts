import { absoluteWeekNumber, type Calendar } from '../hex/calendar'
import {
  advancedUnitFor,
  armyOptions,
  armyTier,
  buildingById,
  buildingGrowth,
  getCachedCatalog,
  isArmySlot,
  isBuildRoot,
  isHallBuilding,
  isMarketplaceBuilding,
  isTavernBuilding,
  unitForBuilding,
  type BuildingRow,
  type ReferenceCatalog,
  type UnitRow,
} from '../town/catalog'
import {
  ARMY_STACK_SLOTS,
  type GameSession,
  type Town,
  type UnitStack,
} from './types'

function u32(n: number): number {
  return n >>> 0
}

function townRand(seed: number, n: number): number {
  let h = u32(
    Math.imul(seed, 0x9e3779b1) ^ Math.imul(n + 0x7f4a7c15, 0x85ebca6b),
  )
  h = u32((h ^ (h >>> 16)) * 0x7feb352d)
  h = u32((h ^ (h >>> 15)) * 0x846ca68b)
  return u32(h ^ (h >>> 16))
}

function rootInTown(
  catalog: ReferenceCatalog,
  townTypeId: number,
  predicate: (row: BuildingRow) => boolean,
): BuildingRow | null {
  const matches = catalog.building.filter(
    (row) =>
      row.town_id === townTypeId &&
      isBuildRoot(row) &&
      row.slot_num != null &&
      predicate(row),
  )
  matches.sort((a, b) => a.id - b.id)
  return matches[0] ?? null
}

/** Basic flavor set: Tavern, Marketplace, Hall, Tier 1 dwelling. */
function basicBuildingPool(
  catalog: ReferenceCatalog,
  townTypeId: number,
): BuildingRow[] {
  const pool: BuildingRow[] = []
  const tavern = rootInTown(catalog, townTypeId, isTavernBuilding)
  const market = rootInTown(catalog, townTypeId, isMarketplaceBuilding)
  const hall = rootInTown(catalog, townTypeId, isHallBuilding)
  if (tavern) {
    pool.push(tavern)
  }
  if (market) {
    pool.push(market)
  }
  if (hall) {
    pool.push(hall)
  }
  const dwellings = armyOptions(catalog, 4, townTypeId)
    .filter(isBuildRoot)
    .sort((a, b) => a.id - b.id)
  if (dwellings[0]) {
    pool.push(dwellings[0])
  }
  return pool
}

function townAlreadySeeded(session: GameSession, townId: string): boolean {
  return session.building_states.some(
    (row) => row.town_id === townId && row.building_id != null && row.level >= 1,
  )
}

function placeBuilding(
  session: GameSession,
  townId: string,
  building: BuildingRow,
): GameSession {
  if (building.slot_num == null) {
    return session
  }
  const slotNum = building.slot_num
  const occupied = session.building_states.find(
    (row) =>
      row.town_id === townId &&
      row.slot_num === slotNum &&
      row.building_id != null &&
      row.level >= 1,
  )
  if (occupied) {
    return session
  }
  const level = Math.max(1, building.level)
  // Starting T1 dwelling: one week of recruits ready on capture.
  const recruitQty =
    building.slot_num != null && isArmySlot(building.slot_num)
      ? Math.max(0, buildingGrowth(building))
      : 0
  const exists = session.building_states.some(
    (row) => row.town_id === townId && row.slot_num === slotNum,
  )
  if (!exists) {
    return {
      ...session,
      building_states: [
        ...session.building_states,
        {
          id: `${townId}-slot-${slotNum}`,
          town_id: townId,
          building_id: building.id,
          slot_num: slotNum,
          level,
          recruit_qty: recruitQty,
          offered_abilities: [],
        },
      ],
    }
  }
  return {
    ...session,
    building_states: session.building_states.map((row) =>
      row.town_id === townId && row.slot_num === slotNum
        ? {
            ...row,
            building_id: building.id,
            level,
            recruit_qty: recruitQty,
            offered_abilities: [],
          }
        : row,
    ),
  }
}

/**
 * Game start: each town gets 1–3 random buildings from the basic set.
 * Idempotent per town (skips if any building already placed).
 */
export function seedNeutralTownBuildings(session: GameSession): GameSession {
  const catalog = getCachedCatalog()
  if (!catalog) {
    return session
  }
  const seed = session.game.seed || 1
  let next = session
  let salt = 0
  for (const town of session.towns) {
    if (townAlreadySeeded(next, town.id)) {
      continue
    }
    const pool = basicBuildingPool(catalog, town.town_type_id)
    if (pool.length === 0) {
      continue
    }
    salt += 1
    const count = 1 + (townRand(seed, salt) % Math.min(3, pool.length))
    const remaining = [...pool]
    for (let i = 0; i < count && remaining.length > 0; i += 1) {
      salt += 1
      const index = townRand(seed, salt) % remaining.length
      const picked = remaining.splice(index, 1)[0]
      if (picked) {
        next = placeBuilding(next, town.id, picked)
      }
    }
  }
  return next
}

function baseUnitForArmyTier(
  catalog: ReferenceCatalog,
  townTypeId: number,
  tier: number,
): UnitRow | null {
  for (let slot = 4; slot <= 9; slot += 1) {
    if (!isArmySlot(slot) || armyTier(slot) !== tier) {
      continue
    }
    const roots = armyOptions(catalog, slot, townTypeId)
      .filter(isBuildRoot)
      .sort((a, b) => a.id - b.id)
    for (const building of roots) {
      const unit = unitForBuilding(catalog, building.id)
      if (unit) {
        return unit
      }
    }
  }
  return null
}

type GrowthKind = 't1' | 't2' | 'adv_t1' | 'adv_t2'

/** Absolute week → growth kind. Weeks 2–5 only (brief schedule). */
function growthKindForWeek(week: number): GrowthKind | null {
  if (week === 2) {
    return 't1'
  }
  if (week === 3) {
    return 't2'
  }
  if (week === 4) {
    return 'adv_t1'
  }
  if (week === 5) {
    return 'adv_t2'
  }
  return null
}

function unitForGrowth(
  catalog: ReferenceCatalog,
  town: Town,
  kind: GrowthKind,
): UnitRow | null {
  if (kind === 't1' || kind === 'adv_t1') {
    const base = baseUnitForArmyTier(catalog, town.town_type_id, 1)
    if (!base) {
      return null
    }
    return kind === 'adv_t1' ? advancedUnitFor(catalog, base) : base
  }
  const base = baseUnitForArmyTier(catalog, town.town_type_id, 2)
  if (!base) {
    return null
  }
  return kind === 'adv_t2' ? advancedUnitFor(catalog, base) : base
}

function growthQty(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  seed: number,
  salt: number,
): number {
  const max = Math.max(1, buildingGrowth(buildingById(catalog, unit.bldg_id)))
  return 1 + (townRand(seed, salt) % max)
}

function nextStackId(session: GameSession): string {
  let n = session.units.length + 1
  while (session.units.some((unit) => unit.id === `unit-${n}`)) {
    n += 1
  }
  return `unit-${n}`
}

function padSlots(slots: Array<string | null>): Array<string | null> {
  const next = slots.slice(0, ARMY_STACK_SLOTS)
  while (next.length < ARMY_STACK_SLOTS) {
    next.push(null)
  }
  return next
}

function addGarrisonUnits(
  session: GameSession,
  townId: string,
  unitId: number,
  qty: number,
): GameSession {
  if (qty <= 0) {
    return session
  }
  const town = session.towns.find((row) => row.id === townId)
  if (!town) {
    return session
  }
  const slots = padSlots(town.garrison.slots_1_to_6)
  for (let i = 0; i < slots.length; i += 1) {
    const id = slots[i]
    if (!id) {
      continue
    }
    const row = session.units.find((unit) => unit.id === id)
    if (row && row.unit_id === unitId && row.qty > 0) {
      return {
        ...session,
        units: session.units.map((unit) =>
          unit.id === id ? { ...unit, qty: unit.qty + qty } : unit,
        ),
      }
    }
  }
  const empty = slots.findIndex((id) => id == null)
  if (empty < 0) {
    return session
  }
  const stackId = nextStackId(session)
  slots[empty] = stackId
  const stack: UnitStack = {
    id: stackId,
    unit_id: unitId,
    qty,
    town_id: townId,
    hero_id: null,
    mob_id: null,
  }
  return {
    ...session,
    units: [...session.units, stack],
    towns: session.towns.map((entry) =>
      entry.id === townId
        ? { ...entry, garrison: { ...entry.garrison, slots_1_to_6: slots } }
        : entry,
    ),
  }
}

/**
 * Neutral towns only: on week rollover into absolute weeks 2–5, add garrison
 * units by schedule (T1 → T2 → Adv T1 → Adv T2). Independent of dwellings built.
 */
export function applyWeeklyNeutralTownGrowth(
  session: GameSession,
  catalog: ReferenceCatalog,
  calendar: Calendar,
): GameSession {
  const kind = growthKindForWeek(absoluteWeekNumber(calendar))
  if (!kind) {
    return session
  }
  const seed = session.game.seed || 1
  let next = session
  let salt = absoluteWeekNumber(calendar) * 1000
  for (const town of session.towns) {
    if (town.player_id != null) {
      continue
    }
    const unit = unitForGrowth(catalog, town, kind)
    if (!unit) {
      continue
    }
    salt += 1
    const qty = growthQty(catalog, unit, seed, salt)
    next = addGarrisonUnits(next, town.id, unit.id, qty)
  }
  return next
}
