import { GOLD_RESOURCE_ID } from '../hex/resources'
import type { GameSession, Town } from '../session/types'
import {
  buildingById,
  buildingGrowth,
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

/** 50% off multi-resource cost: floor, min 1 per resource that costs something. */
function scaleCostHalfFloor(cost: CostMap): CostMap {
  const out: CostMap = {}
  for (const [key, amount] of Object.entries(cost)) {
    if (amount <= 0) {
      continue
    }
    out[Number(key)] = Math.max(1, Math.floor(amount * 0.5))
  }
  return out
}

/** Whispering Timberworks: pay 75% of build cost — ceil, min 1 per resource. */
function scaleConstructionCostTimberworks(cost: CostMap): CostMap {
  const out: CostMap = {}
  for (const [key, amount] of Object.entries(cost)) {
    if (amount <= 0) {
      continue
    }
    out[Number(key)] = Math.max(1, Math.ceil(amount * 0.75))
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
    return scaleConstructionCostTimberworks(base)
  }
  return base
}

/** Factory Union Lodge: −50% unit recruitment cost (floor, min 1 per resource). */
export function townRecruitUnitCost(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
  unitCostMap: CostMap,
): CostMap {
  if (townHasUnique(session, catalog, townId, 'Union Lodge')) {
    return scaleCostHalfFloor(unitCostMap)
  }
  return unitCostMap
}

/**
 * Temple Reliquary of Elevation: −50% unit upgrade_cost (floor, min 1).
 * Independent of the hero-visit free building-upgrade mechanic.
 */
export function townUnitUpgradeCost(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
  upgradeCostMap: CostMap,
): CostMap {
  if (townHasUnique(session, catalog, townId, 'Reliquary of Elevation')) {
    return scaleCostHalfFloor(upgradeCostMap)
  }
  return upgradeCostMap
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

/**
 * Citadel Vault: weekly Resource Generator totals (Tollhouse etc.) —
 * non-Hall `payload.produces`, aggregated by resource.
 */
export function townResourceGenWeekly(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
): Array<{ resourceId: number; qty: number }> {
  const totals = new Map<number, number>()
  for (const row of session.building_states) {
    if (row.town_id !== townId || row.level < 1 || row.building_id == null) {
      continue
    }
    const building = buildingById(catalog, row.building_id)
    if (!building || isHallBuilding(building)) {
      continue
    }
    for (const grant of buildingProduces(building)) {
      if (grant.resourceId === GOLD_RESOURCE_ID || grant.qty <= 0) {
        continue
      }
      totals.set(
        grant.resourceId,
        (totals.get(grant.resourceId) ?? 0) + grant.qty,
      )
    }
  }
  return [...totals.entries()].map(([resourceId, qty]) => ({ resourceId, qty }))
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

function eligibleArmyUpgrades(
  session: GameSession,
  catalog: ReferenceCatalog,
  town: Town,
): Array<{ slotNum: number; next: BuildingRow }> {
  return eligibleUpgrades(session, catalog, town).filter((row) =>
    isArmySlot(row.slotNum),
  )
}

function applyArchitectSpire(
  session: GameSession,
  catalog: ReferenceCatalog,
  town: Town,
): { session: GameSession; events: WeeklyUniqueConstructEvent[] } {
  let next = session
  const events: WeeklyUniqueConstructEvent[] = []
  if (!town.player_id) {
    return { session: next, events }
  }
  // Exactly one free action per week: unbuilt non-army OR army upgrade.
  type SpireOption =
    | { kind: 'build'; building: BuildingRow }
    | { kind: 'upgrade'; next: BuildingRow }
  const options: SpireOption[] = [
    ...eligibleUnbuiltNonArmy(next, catalog, town).map(
      (building): SpireOption => ({ kind: 'build', building }),
    ),
    ...eligibleArmyUpgrades(next, catalog, town).map(
      (row): SpireOption => ({ kind: 'upgrade', next: row.next }),
    ),
  ]
  const pick = pickRandom(options)
  if (!pick) {
    return { session: next, events }
  }
  if (pick.kind === 'build') {
    next = placeBuildingFree(next, town.id, pick.building)
    events.push({
      kind: 'construct',
      playerId: town.player_id,
      uniqueName: "Architect's Spire",
      verb: 'Built',
      buildingName: pick.building.name,
    })
    console.info(
      `[Town Unique] Architect's Spire: free-built ${pick.building.name} in ${town.name}`,
    )
    // Spire-built Infernal Archive still grants visit effect if a hero is here.
    const visitor = next.heroes.find(
      (hero) =>
        hero.player_id === town.player_id &&
        hero.position.q === town.position.q &&
        hero.position.r === town.position.r,
    )
    next = maybeApplyInfernalArchiveAfterBuild(
      next,
      catalog,
      town,
      pick.building,
      visitor?.id,
    )
  } else {
    next = placeBuildingFree(next, town.id, pick.next)
    events.push({
      kind: 'construct',
      playerId: town.player_id,
      uniqueName: "Architect's Spire",
      verb: 'Upgraded',
      buildingName: pick.next.name,
    })
    console.info(
      `[Town Unique] Architect's Spire: free-upgraded to ${pick.next.name} in ${town.name}`,
    )
  }
  return { session: next, events }
}

/**
 * Recruitment Beacon: before weekly growth, pick 1 random built army building
 * with Curr Recruits ≥ 1, roll +1..Curr, add to recruit_qty. Growth applies after.
 */
export function applyRecruitmentBeacon(
  session: GameSession,
  catalog: ReferenceCatalog,
  town: Town,
): { session: GameSession; events: WeeklyUniqueGrowthEvent[] } {
  const events: WeeklyUniqueGrowthEvent[] = []
  if (!town.player_id) {
    return { session, events }
  }
  const armyRows = session.building_states.filter(
    (row) =>
      row.town_id === town.id &&
      row.level >= 1 &&
      row.building_id != null &&
      isArmySlot(row.slot_num) &&
      row.recruit_qty >= 1,
  )
  const pick = pickRandom(armyRows)
  if (!pick || pick.building_id == null) {
    return { session, events }
  }
  const building = buildingById(catalog, pick.building_id)
  const max = Math.floor(pick.recruit_qty)
  if (max < 1) {
    return { session, events }
  }
  const bonus = randomInclusive(1, max)
  events.push({
    kind: 'growth',
    playerId: town.player_id,
    uniqueName: 'Recruitment Beacon',
    buildingName: building?.name ?? `Army slot ${pick.slot_num}`,
    amount: bonus,
  })
  console.info(
    `[Town Unique] Recruitment Beacon: +${bonus} (curr ${max}) on ${building?.name ?? `slot ${pick.slot_num}`} in ${town.name}`,
  )
  return {
    session: {
      ...session,
      building_states: session.building_states.map((row) =>
        row.id === pick.id
          ? { ...row, recruit_qty: row.recruit_qty + bonus }
          : row,
      ),
    },
    events,
  }
}

/** Run Beacon for every owned town that has it — must run before weekly growth. */
export function applyRecruitmentBeaconsBeforeGrowth(
  session: GameSession,
  catalog: ReferenceCatalog,
): { session: GameSession; events: WeeklyUniqueGrowthEvent[] } {
  let next = session
  const events: WeeklyUniqueGrowthEvent[] = []
  for (const town of session.towns) {
    if (!town.player_id) {
      continue
    }
    if (!townHasUnique(next, catalog, town.id, 'Recruitment Beacon')) {
      continue
    }
    const result = applyRecruitmentBeacon(next, catalog, town)
    next = result.session
    events.push(...result.events)
  }
  return { session: next, events }
}

/**
 * Bone Nursery: one random built army building gets a one-time +1..Max
 * recruit_qty bump this week only (Max = that building's growth). No stack,
 * no carry-forward, no change to growth_bonus.
 */
function applyBoneNursery(
  session: GameSession,
  catalog: ReferenceCatalog,
  town: Town,
): { session: GameSession; events: WeeklyUniqueGrowthEvent[] } {
  const events: WeeklyUniqueGrowthEvent[] = []
  if (!town.player_id) {
    return { session, events }
  }
  const armyRows = session.building_states.filter(
    (row) =>
      row.town_id === town.id &&
      row.level >= 1 &&
      row.building_id != null &&
      isArmySlot(row.slot_num),
  )
  const pick = pickRandom(armyRows)
  if (!pick || pick.building_id == null) {
    return { session, events }
  }
  const building = buildingById(catalog, pick.building_id)
  const max = buildingGrowth(building)
  if (max < 1) {
    return { session, events }
  }
  const bonus = randomInclusive(1, max)
  events.push({
    kind: 'growth',
    playerId: town.player_id,
    uniqueName: 'Bone Nursery',
    buildingName: building?.name ?? `Army slot ${pick.slot_num}`,
    amount: bonus,
  })
  console.info(
    `[Town Unique] Bone Nursery: +${bonus} (max ${max}) on ${building?.name ?? `slot ${pick.slot_num}`} in ${town.name}`,
  )
  return {
    session: {
      ...session,
      building_states: session.building_states.map((row) =>
        row.id === pick.id
          ? { ...row, recruit_qty: row.recruit_qty + bonus }
          : row,
      ),
    },
    events,
  }
}

/**
 * Weekly Town Unique effects: Vault gold, Architect's Spire, Bone Nursery.
 * Recruitment Beacon runs earlier (before growth) via
 * `applyRecruitmentBeaconsBeforeGrowth`.
 */
export function applyWeeklyTownUniques(
  session: GameSession,
  catalog: ReferenceCatalog,
): GameSession {
  return applyWeeklyTownUniquesWithReport(session, catalog).session
}

export type WeeklyUniqueConstructEvent = {
  kind: 'construct'
  playerId: string
  uniqueName: string
  verb: 'Built' | 'Upgraded'
  buildingName: string
}

export type WeeklyUniqueResourceEvent = {
  kind: 'resource'
  playerId: string
  townName: string
  uniqueName: string
  resourceId: number
  amount: number
}

export type WeeklyUniqueGrowthEvent = {
  kind: 'growth'
  playerId: string
  uniqueName: string
  buildingName: string
  amount: number
}

export type WeeklyUniqueIncomeEvent =
  | WeeklyUniqueResourceEvent
  | WeeklyUniqueConstructEvent
  | WeeklyUniqueGrowthEvent

export function applyWeeklyTownUniquesWithReport(
  session: GameSession,
  catalog: ReferenceCatalog,
): { session: GameSession; events: WeeklyUniqueIncomeEvent[] } {
  let next = session
  const events: WeeklyUniqueIncomeEvent[] = []
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
        events.push({
          kind: 'resource',
          playerId: town.player_id,
          townName: town.name,
          uniqueName: 'Vault',
          resourceId: GOLD_RESOURCE_ID,
          amount: bonus,
        })
        console.info(
          `[Town Unique] Vault: +${bonus} Gold in ${town.name} (halls ${hallGold})`,
        )
      }
      // Extra 1–Max per Resource Generator produce (Tollhouse, etc.).
      for (const grant of townResourceGenWeekly(next, catalog, town.id)) {
        if (grant.qty < 1) {
          continue
        }
        const bonus = randomInclusive(1, grant.qty)
        next = addPlayerResources(next, town.player_id, {
          [grant.resourceId]: bonus,
        })
        events.push({
          kind: 'resource',
          playerId: town.player_id,
          townName: town.name,
          uniqueName: 'Vault',
          resourceId: grant.resourceId,
          amount: bonus,
        })
        console.info(
          `[Town Unique] Vault: +${bonus} resource ${grant.resourceId} in ${town.name} (gen max ${grant.qty})`,
        )
      }
    }
    if (townHasUnique(next, catalog, town.id, "Architect's Spire")) {
      const spire = applyArchitectSpire(next, catalog, town)
      next = spire.session
      events.push(...spire.events)
    }
    if (townHasUnique(next, catalog, town.id, 'Bone Nursery')) {
      const nursery = applyBoneNursery(next, catalog, town)
      next = nursery.session
      events.push(...nursery.events)
    }
  }
  return { session: next, events }
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

export type ArchiveLearnNotice = {
  heroName: string
  abilityNames: string[]
}

let lastArchiveLearnNotice: ArchiveLearnNotice | null = null

/** Cleared on read — UI shows after Infernal Archive learn (build or visit). */
export function takeArchiveLearnNotice(): ArchiveLearnNotice | null {
  const notice = lastArchiveLearnNotice
  lastArchiveLearnNotice = null
  return notice
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
  const abilityNames: string[] = []
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
    abilityNames.push(ability.name)
    learned.add(abilityId)
  }
  if (added.length === 0) {
    return next
  }
  console.info(
    `[Town Unique] Infernal Archive: ${hero.name} learned ${added.length} abilities from ${archiveTowns.length} archive town(s)`,
  )
  lastArchiveLearnNotice = {
    heroName: hero.name,
    abilityNames,
  }
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

/**
 * When Infernal Archive is constructed and a hero is already in town, grant
 * the same learn-from-archives effect as a hero visit.
 */
export function maybeApplyInfernalArchiveAfterBuild(
  session: GameSession,
  catalog: ReferenceCatalog,
  town: Town,
  building: BuildingRow,
  heroId: string | null | undefined,
): GameSession {
  if (!heroId || nameKey(building.name) !== nameKey('Infernal Archive')) {
    return session
  }
  return applyInfernalArchive(session, catalog, town, heroId)
}

/** Fortress War Room: +33% siege wall HP / shooter dmg / moat dmg. */
export function warRoomSiegeMult(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
): number {
  return townHasUnique(session, catalog, townId, 'War Room') ? 4 / 3 : 1
}
