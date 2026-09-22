import { GOLD_RESOURCE_ID } from '../hex/resources'
import type { GameSession, Town } from '../session/types'
import {
  buildingById,
  buildingProduces,
  constructionCost,
  hasPrerequisite,
  isArmySlot,
  isHallBuilding,
  isLibraryBuilding,
  nextInChain,
  scaleCost,
  type BuildingRow,
  type CostMap,
  type ReferenceCatalog,
} from './catalog'
import {
  heroHasDiscipline,
  mergeLibraryOffers,
} from './libraryRules'

const TOWN_UNIQUE_SLOT = 9

export function isTownUniqueBuilding(building: BuildingRow): boolean {
  return building.slot_num === TOWN_UNIQUE_SLOT
}

function nameKey(name: string): string {
  return name.trim().toLowerCase()
}

/** True when the named Town Unique is built (level ≥ 1) in this town. */
export function townHasUnique(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
  uniqueName: string,
): boolean {
  const want = nameKey(uniqueName)
  return session.building_states.some((row) => {
    if (row.town_id !== townId || row.level < 1 || row.building_id == null) {
      return false
    }
    const building = buildingById(catalog, row.building_id)
    return building != null && nameKey(building.name) === want
  })
}

function builtIdsForTown(session: GameSession, townId: string): Set<number> {
  const ids = new Set<number>()
  for (const row of session.building_states) {
    if (
      row.town_id === townId &&
      row.level >= 1 &&
      row.building_id != null
    ) {
      ids.add(row.building_id)
    }
  }
  return ids
}

function scaleCostPct(cost: CostMap, pct: number): CostMap {
  const out: CostMap = {}
  for (const [key, amount] of Object.entries(cost)) {
    out[Number(key)] = Math.max(0, Math.floor(amount * pct))
  }
  return out
}

/** Grove Whispering Timberworks: −25% construction / upgrade cost. */
export function townConstructionCost(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
  building: BuildingRow,
): CostMap {
  const base = constructionCost(catalog, building)
  if (townHasUnique(session, catalog, townId, 'Whispering Timberworks')) {
    return scaleCostPct(base, 0.75)
  }
  return base
}

/** Factory Union Lodge: −50% unit recruitment cost. */
export function townRecruitUnitCost(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
  unitCostMap: CostMap,
): CostMap {
  if (townHasUnique(session, catalog, townId, 'Union Lodge')) {
    return scaleCostPct(unitCostMap, 0.5)
  }
  return unitCostMap
}

export function townRecruitCost(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
  unitIdCost: CostMap,
  qty: number,
): CostMap {
  return scaleCost(townRecruitUnitCost(session, catalog, townId, unitIdCost), qty)
}

/** Citadel Vault: Halls weekly Gold amount (from produces). */
export function hallsWeeklyGold(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
): number {
  let gold = 0
  for (const row of session.building_states) {
    if (row.town_id !== townId || row.level < 1 || row.building_id == null) {
      continue
    }
    const building = buildingById(catalog, row.building_id)
    if (!building || !isHallBuilding(building)) {
      continue
    }
    for (const grant of buildingProduces(building)) {
      if (grant.resourceId === GOLD_RESOURCE_ID) {
        gold += grant.qty
      }
    }
  }
  return gold
}

function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) {
    return null
  }
  return items[Math.floor(Math.random() * items.length)] ?? null
}

function randomInclusive(min: number, max: number): number {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

function addPlayerResources(
  session: GameSession,
  playerId: string,
  grants: Record<number, number>,
): GameSession {
  return {
    ...session,
    players: session.players.map((player) => {
      if (player.id !== playerId) {
        return player
      }
      const resources = { ...player.resources }
      for (const [key, amount] of Object.entries(grants)) {
        const id = Number(key)
        if (amount > 0) {
          resources[id] = (resources[id] ?? 0) + amount
        }
      }
      return { ...player, resources }
    }),
  }
}

function placeBuildingFree(
  session: GameSession,
  townId: string,
  building: BuildingRow,
): GameSession {
  if (building.slot_num == null) {
    return session
  }
  const slotNum = building.slot_num
  return {
    ...session,
    building_states: session.building_states.map((row) => {
      if (row.town_id !== townId || row.slot_num !== slotNum) {
        return row
      }
      return {
        ...row,
        building_id: building.id,
        level: Math.max(1, building.level),
        growth_bonus: row.growth_bonus ?? 0,
        recruit_qty:
          isArmySlot(slotNum) && building.growth != null && building.growth > 0
            ? Math.floor(building.growth)
            : row.recruit_qty,
        offered_abilities: [],
      }
    }),
  }
}

function eligibleUnbuiltNonArmy(
  session: GameSession,
  catalog: ReferenceCatalog,
  town: Town,
): BuildingRow[] {
  const builtIds = builtIdsForTown(session, town.id)
  const occupied = new Set(
    session.building_states
      .filter(
        (row) =>
          row.town_id === town.id && row.level >= 1 && row.building_id != null,
      )
      .map((row) => row.slot_num),
  )
  const candidates: BuildingRow[] = []
  for (const building of catalog.building) {
    if (building.town_id !== town.town_type_id) {
      continue
    }
    if (building.slot_num == null || isArmySlot(building.slot_num)) {
      continue
    }
    if (occupied.has(building.slot_num)) {
      continue
    }
    if (building.level !== 1) {
      continue
    }
    if (!hasPrerequisite(building, builtIds)) {
      continue
    }
    candidates.push(building)
  }
  return candidates
}

function eligibleUpgrades(
  session: GameSession,
  catalog: ReferenceCatalog,
  town: Town,
): Array<{ slotNum: number; next: BuildingRow }> {
  const builtIds = builtIdsForTown(session, town.id)
  const out: Array<{ slotNum: number; next: BuildingRow }> = []
  for (const row of session.building_states) {
    if (row.town_id !== town.id || row.level < 1 || row.building_id == null) {
      continue
    }
    const current = buildingById(catalog, row.building_id)
    if (!current || current.slot_num == null) {
      continue
    }
    const next = nextInChain(
      current,
      catalog,
      current.slot_num,
      town.town_type_id,
    )
    if (!next || !hasPrerequisite(next, builtIds)) {
      continue
    }
    out.push({ slotNum: row.slot_num, next })
  }
  return out
}

function applyArchitectSpire(
  session: GameSession,
  catalog: ReferenceCatalog,
  town: Town,
): GameSession {
  let next = session
  const unbuilt = eligibleUnbuiltNonArmy(next, catalog, town)
  const pickBuild = pickRandom(unbuilt)
  if (pickBuild) {
    next = placeBuildingFree(next, town.id, pickBuild)
    console.info(
      `[Town Unique] Architect's Spire: free-built ${pickBuild.name} in ${town.name}`,
    )
  }
  const upgrades = eligibleUpgrades(next, catalog, town)
  const pickUp = pickRandom(upgrades)
  if (pickUp) {
    next = placeBuildingFree(next, town.id, pickUp.next)
    console.info(
      `[Town Unique] Architect's Spire: free-upgraded to ${pickUp.next.name} in ${town.name}`,
    )
  }
  return next
}

function applyArmyGrowthBonus(
  session: GameSession,
  catalog: ReferenceCatalog,
  town: Town,
  uniqueLabel: string,
): GameSession {
  const armyRows = session.building_states.filter(
    (row) =>
      row.town_id === town.id &&
      row.level >= 1 &&
      row.building_id != null &&
      isArmySlot(row.slot_num),
  )
  const pick = pickRandom(armyRows)
  if (!pick) {
    return session
  }
  const building = buildingById(catalog, pick.building_id)
  console.info(
    `[Town Unique] ${uniqueLabel}: +1 growth on ${building?.name ?? `slot ${pick.slot_num}`} in ${town.name}`,
  )
  return {
    ...session,
    building_states: session.building_states.map((row) =>
      row.id === pick.id
        ? { ...row, growth_bonus: (row.growth_bonus ?? 0) + 1 }
        : row,
    ),
  }
}

/**
 * Weekly Town Unique effects: Vault gold, Architect's Spire, Bone Nursery /
 * Recruitment Beacon growth. Call after normal produces income.
 */
export function applyWeeklyTownUniques(
  session: GameSession,
  catalog: ReferenceCatalog,
): GameSession {
  let next = session
  for (const town of session.towns) {
    if (!town.player_id) {
      continue
    }
    if (townHasUnique(next, catalog, town.id, 'Vault')) {
      const hallGold = hallsWeeklyGold(next, catalog, town.id)
      if (hallGold >= 100) {
        const bonus = randomInclusive(100, hallGold)
        next = addPlayerResources(next, town.player_id, {
          [GOLD_RESOURCE_ID]: bonus,
        })
        console.info(
          `[Town Unique] Vault: +${bonus} Gold in ${town.name} (halls ${hallGold})`,
        )
      }
    }
    if (townHasUnique(next, catalog, town.id, "Architect's Spire")) {
      next = applyArchitectSpire(next, catalog, town)
    }
    if (townHasUnique(next, catalog, town.id, 'Bone Nursery')) {
      next = applyArmyGrowthBonus(next, catalog, town, 'Bone Nursery')
    }
    if (townHasUnique(next, catalog, town.id, 'Recruitment Beacon')) {
      next = applyArmyGrowthBonus(next, catalog, town, 'Recruitment Beacon')
    }
  }
  return next
}

function libraryAbilityIdsForTown(
  session: GameSession,
  catalog: ReferenceCatalog,
  town: Town,
): number[] {
  const ids = new Set<number>()
  for (const row of session.building_states) {
    if (row.town_id !== town.id || row.level < 1 || row.building_id == null) {
      continue
    }
    const building = buildingById(catalog, row.building_id)
    if (!building || !isLibraryBuilding(building)) {
      continue
    }
    const offers = mergeLibraryOffers(
      row.offered_abilities,
      catalog,
      row.building_id,
      town.town_type_id,
      row.level,
    )
    for (const offer of offers) {
      if (offer.level > row.level) {
        continue
      }
      for (const abilityId of offer.ability_ids) {
        ids.add(abilityId)
      }
    }
  }
  return [...ids]
}

function ensureTownLibraryOffers(
  session: GameSession,
  catalog: ReferenceCatalog,
  town: Town,
): GameSession {
  let next = session
  for (const row of session.building_states) {
    if (row.town_id !== town.id || row.level < 1 || row.building_id == null) {
      continue
    }
    const building = buildingById(catalog, row.building_id)
    if (!building || !isLibraryBuilding(building)) {
      continue
    }
    const offered = mergeLibraryOffers(
      row.offered_abilities,
      catalog,
      row.building_id,
      town.town_type_id,
      row.level,
    )
    if (offered === row.offered_abilities) {
      continue
    }
    next = {
      ...next,
      building_states: next.building_states.map((entry) =>
        entry.id === row.id ? { ...entry, offered_abilities: offered } : entry,
      ),
    }
  }
  return next
}

function applyInfernalArchive(
  session: GameSession,
  catalog: ReferenceCatalog,
  visited: Town,
  heroId: string,
): GameSession {
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero || !visited.player_id || hero.player_id !== visited.player_id) {
    return session
  }
  if (!townHasUnique(session, catalog, visited.id, 'Infernal Archive')) {
    return session
  }
  let next = session
  const archiveTowns = next.towns.filter(
    (town) =>
      town.player_id === visited.player_id &&
      townHasUnique(next, catalog, town.id, 'Infernal Archive'),
  )
  const learnIds = new Set<number>()
  for (const town of archiveTowns) {
    next = ensureTownLibraryOffers(next, catalog, town)
    for (const abilityId of libraryAbilityIdsForTown(next, catalog, town)) {
      learnIds.add(abilityId)
    }
  }
  const learned = new Set(hero.learned_abilities ?? [])
  const added: number[] = []
  for (const abilityId of learnIds) {
    if (learned.has(abilityId)) {
      continue
    }
    const ability = catalog.ability.find((row) => row.id === abilityId)
    if (!ability) {
      continue
    }
    if (!heroHasDiscipline(catalog, hero.class_id, ability.discipline_id)) {
      continue
    }
    added.push(abilityId)
    learned.add(abilityId)
  }
  if (added.length === 0) {
    return next
  }
  console.info(
    `[Town Unique] Infernal Archive: ${hero.name} learned ${added.length} abilities from ${archiveTowns.length} archive town(s)`,
  )
  return {
    ...next,
    heroes: next.heroes.map((row) =>
      row.id === heroId
        ? { ...row, learned_abilities: [...(row.learned_abilities ?? []), ...added] }
        : row,
    ),
  }
}

function isAdvancedTierBuilding(building: BuildingRow): boolean {
  return building.level >= 2
}

function applyReliquaryOfElevation(
  session: GameSession,
  catalog: ReferenceCatalog,
  town: Town,
): GameSession {
  if (!townHasUnique(session, catalog, town.id, 'Reliquary of Elevation')) {
    return session
  }
  const hasAdvancedElsewhere = session.building_states.some((row) => {
    if (row.town_id !== town.id || row.level < 1 || row.building_id == null) {
      return false
    }
    const building = buildingById(catalog, row.building_id)
    return building != null && isAdvancedTierBuilding(building)
  })
  if (!hasAdvancedElsewhere) {
    return session
  }
  let next = session
  let upgraded = 0
  const rows = [...next.building_states]
  for (const row of rows) {
    if (row.town_id !== town.id || row.level < 1 || row.building_id == null) {
      continue
    }
    const current = buildingById(catalog, row.building_id)
    if (!current || current.level !== 1 || current.slot_num == null) {
      continue
    }
    const advanced = nextInChain(
      current,
      catalog,
      current.slot_num,
      town.town_type_id,
    )
    if (!advanced || advanced.level !== 2) {
      continue
    }
    const builtIds = builtIdsForTown(next, town.id)
    if (!hasPrerequisite(advanced, builtIds)) {
      continue
    }
    next = placeBuildingFree(next, town.id, advanced)
    upgraded += 1
  }
  if (upgraded > 0) {
    console.info(
      `[Town Unique] Reliquary of Elevation: free-upgraded ${upgraded} Basic→Advanced in ${town.name}`,
    )
  }
  return next
}

/** Hero-visit Town Unique effects (Infernal Archive, Reliquary of Elevation). */
export function applyHeroTownVisitUniques(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
  heroId: string,
): GameSession {
  const town = session.towns.find((row) => row.id === townId)
  if (!town) {
    return session
  }
  let next = applyInfernalArchive(session, catalog, town, heroId)
  next = applyReliquaryOfElevation(next, catalog, town)
  return next
}

/** Fortress War Room: +50% siege wall HP / shooter dmg / moat dmg. */
export function warRoomSiegeMult(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
): number {
  return townHasUnique(session, catalog, townId, 'War Room') ? 1.5 : 1
}
