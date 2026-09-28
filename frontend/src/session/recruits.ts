import { isSiegeEngineUnit } from '../combat/siege'
import {
  canAfford,
  deductCost,
  emptyWallet,
  RESOURCES,
  snapshotWallet,
  type ResourceWallet,
} from '../hex/resources'
import {
  buildingById,
  buildingGrowth,
  maxAffordableQty,
  scaleCost,
  unitById,
  unitCost,
  unitEffectiveTier,
  type CostMap,
  type ReferenceCatalog,
  type UnitRow,
} from '../town/catalog'
import { calendarDayNumber } from '../hex/calendar'
import type { GameSession, MapFeature } from './types'
import { ARMY_STACK_SLOTS, type UnitStack } from './types'

export type RecruitsFeature = Extract<
  GameSession['features'][number],
  { kind: 'recruits' }
>

function walletForPlayer(session: GameSession, playerId: string): ResourceWallet {
  const wallet = emptyWallet()
  const player = session.players.find((row) => row.id === playerId)
  if (!player) {
    return wallet
  }
  for (const resource of RESOURCES) {
    wallet[resource.id].stockpile = player.resources[resource.id] ?? 0
  }
  return wallet
}

function applyPlayerWallet(
  session: GameSession,
  playerId: string,
  wallet: ResourceWallet,
): GameSession {
  return {
    ...session,
    players: session.players.map((player) =>
      player.id === playerId
        ? {
            ...player,
            resources: Object.fromEntries(
              RESOURCES.map((resource) => [
                resource.id,
                wallet[resource.id].stockpile,
              ]),
            ),
          }
        : player,
    ),
  }
}

function spendPlayerResources(
  session: GameSession,
  playerId: string,
  cost: CostMap,
): { session: GameSession; error: string | null } {
  const wallet = walletForPlayer(session, playerId)
  const error = canAfford(wallet, cost)
  if (error) {
    return { session, error }
  }
  return {
    session: applyPlayerWallet(
      session,
      playerId,
      deductCost(snapshotWallet(wallet), cost),
    ),
    error: null,
  }
}

export function findWorldRecruitsAt(
  session: GameSession,
  q: number,
  r: number,
): RecruitsFeature | undefined {
  return (session.features ?? []).find(
    (row): row is RecruitsFeature =>
      row.kind === 'recruits' &&
      row.position.q === q &&
      row.position.r === r,
  )
}

export function findWorldRecruitsById(
  session: GameSession,
  featureId: string,
): RecruitsFeature | undefined {
  return (session.features ?? []).find(
    (row): row is RecruitsFeature =>
      row.kind === 'recruits' && row.id === featureId,
  )
}

/** Eligible tiers from `feature.stats.tiers` (defaults [1,2]). */
export function recruitsEligibleTiers(
  catalog: ReferenceCatalog | null | undefined,
): number[] {
  const typeId = catalog?.feature_type.find(
    (row) => row.name === 'recruit_building',
  )?.id
  const feature =
    typeId != null
      ? catalog?.feature.find((row) => row.feature_type_id === typeId)
      : undefined
  const raw = feature?.stats?.tiers
  const out: number[] = []
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const n = Math.floor(Number(entry))
      if (Number.isFinite(n) && n > 0) {
        out.push(n)
      }
    }
  }
  return out.length > 0 ? out : [1, 2]
}

function unitTownTypeId(
  catalog: ReferenceCatalog,
  unit: UnitRow,
): number | null {
  if (unit.town_id != null && unit.town_id > 0) {
    return unit.town_id
  }
  const building = buildingById(catalog, unit.bldg_id)
  return building != null && building.town_id > 0 ? building.town_id : null
}

/**
 * Recruitable units for world Recruits (BR S9-9 / Schema §12 style):
 * has abilities, positive speed, dwelling with growth, not siege.
 * Base and Advanced both allowed. Tier must be in `stats.tiers`.
 */
export function isWorldRecruitableUnit(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  tiers: ReadonlySet<number>,
): boolean {
  if (!unit.has_abilities || (unit.speed ?? 0) <= 0) {
    return false
  }
  if (isSiegeEngineUnit(unit)) {
    return false
  }
  if (unit.bldg_id == null || unit.bldg_id < 1) {
    return false
  }
  const growth = buildingGrowth(buildingById(catalog, unit.bldg_id))
  if (growth <= 0) {
    return false
  }
  const tier = unitEffectiveTier(catalog, unit)
  return tiers.has(tier)
}

export function mapTownTypeIds(session: GameSession): number[] {
  const ids = new Set<number>()
  for (const town of session.towns) {
    if (town.town_type_id > 0) {
      ids.add(town.town_type_id)
    }
  }
  return [...ids]
}

/** Units eligible for a single town type under the building's tier list. */
export function eligibleRecruitsForTownType(
  catalog: ReferenceCatalog,
  townTypeId: number,
  tiers: ReadonlySet<number>,
): UnitRow[] {
  return catalog.unit.filter((unit) => {
    if (!isWorldRecruitableUnit(catalog, unit, tiers)) {
      return false
    }
    return unitTownTypeId(catalog, unit) === townTypeId
  })
}

/**
 * Uniform town-type pick, then uniform unit among that type's pool.
 * Returns null when the map has no eligible town types / units.
 */
export function rollRecruitsOffer(
  catalog: ReferenceCatalog,
  session: GameSession,
  rng: () => number = Math.random,
): { unit_id: number; stock: number } | null {
  const tiers = new Set(recruitsEligibleTiers(catalog))
  const townTypes = mapTownTypeIds(session).filter(
    (id) => eligibleRecruitsForTownType(catalog, id, tiers).length > 0,
  )
  if (townTypes.length === 0) {
    return null
  }
  const townTypeId = townTypes[Math.floor(rng() * townTypes.length)]!
  const pool = eligibleRecruitsForTownType(catalog, townTypeId, tiers)
  if (pool.length === 0) {
    return null
  }
  const unit = pool[Math.floor(rng() * pool.length)]!
  const stock = Math.max(1, buildingGrowth(buildingById(catalog, unit.bldg_id)))
  return { unit_id: unit.id, stock }
}

export function withRolledRecruitsFeature(
  feature: Omit<RecruitsFeature, 'unit_id' | 'stock' | 'known_by_player'> & {
    unit_id?: number
    stock?: number
    known_by_player?: RecruitsPlayerKnowledgeMap
  },
  catalog: ReferenceCatalog,
  session: GameSession,
): RecruitsFeature {
  const rolled = rollRecruitsOffer(catalog, session)
  return {
    id: feature.id,
    kind: 'recruits',
    position: feature.position,
    unit_id: rolled?.unit_id ?? feature.unit_id ?? 0,
    stock: rolled?.stock ?? feature.stock ?? 0,
    known_by_player: {},
  }
}

/** Re-roll every Recruits building at New Week; clears all player knowledge. */
export function rollAllWorldRecruits(
  session: GameSession,
  catalog: ReferenceCatalog,
): GameSession {
  const features = (session.features ?? []).map((row) => {
    if (row.kind !== 'recruits') {
      return row
    }
    const rolled = rollRecruitsOffer(catalog, session)
    if (!rolled) {
      return { ...row, unit_id: 0, stock: 0, known_by_player: {} }
    }
    return {
      ...row,
      unit_id: rolled.unit_id,
      stock: rolled.stock,
      known_by_player: {},
    }
  })
  return { ...session, features }
}

export type RecruitsPlayerKnowledge = {
  unit_id: number
  stock: number
}

export type RecruitsPlayerKnowledgeMap = Record<string, RecruitsPlayerKnowledge>

/** Snapshot live unit/stock into this player's knowledge (per-player, not per-hero). */
export function recordWorldRecruitsKnowledge(
  session: GameSession,
  featureId: string,
  playerId: string,
): GameSession {
  return {
    ...session,
    features: (session.features ?? []).map((row) => {
      if (row.kind !== 'recruits' || row.id !== featureId) {
        return row
      }
      return {
        ...row,
        known_by_player: {
          ...row.known_by_player,
          [playerId]: { unit_id: row.unit_id, stock: row.stock },
        },
      }
    }),
  }
}

/** @deprecated Prefer {@link recordWorldRecruitsKnowledge}. */
export function recordWorldRecruitsVisit(
  session: GameSession,
  featureId: string,
  playerId: string,
): GameSession {
  return recordWorldRecruitsKnowledge(session, featureId, playerId)
}

export function recruitsKnowledgeFor(
  feature: RecruitsFeature,
  playerId: string,
): RecruitsPlayerKnowledge | null {
  const known = feature.known_by_player?.[playerId]
  if (!known || known.unit_id < 1) {
    return null
  }
  return known
}

/**
 * Unknown-building scout score by day-of-week (calendar.day, 1–7).
 * Peak on days 1–2, then linear decay through day 7.
 */
export function recruitsScoutExploreValue(dayOfWeek: number): number {
  const d = Math.max(1, Math.min(7, Math.floor(dayOfWeek)))
  if (d === 1) {
    return 1.2
  }
  if (d === 2) {
    return 1.1
  }
  // Day 3 → 0.85 … Day 7 → 0.18
  return Math.round((0.85 - ((d - 3) * (0.85 - 0.18)) / 4) * 100) / 100
}

function nextStackId(session: GameSession): string {
  let n = session.units.length + 1
  let id = `stack-${n}`
  while (session.units.some((row) => row.id === id)) {
    n += 1
    id = `stack-${n}`
  }
  return id
}

function heroCanTakeUnit(
  session: GameSession,
  heroId: string,
  unitId: number,
): boolean {
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero) {
    return false
  }
  const slots = [...hero.army.slots_1_to_6]
  while (slots.length < ARMY_STACK_SLOTS) {
    slots.push(null)
  }
  for (const stackId of slots) {
    if (!stackId) {
      return true
    }
    const stack = session.units.find((row) => row.id === stackId)
    if (stack && stack.unit_id === unitId && stack.hero_id === heroId) {
      return true
    }
  }
  return false
}

/**
 * Buy from a world Recruits building into the visiting hero's army.
 * Uses raw {@link unitCost} — no Town Unique discounts.
 */
export function recruitFromWorldRecruits(
  session: GameSession,
  catalog: ReferenceCatalog,
  featureId: string,
  heroId: string,
  qty: number,
): { session: GameSession; error: string | null } {
  if (!Number.isInteger(qty) || qty < 1) {
    return { session, error: 'Enter a whole number of units to recruit.' }
  }
  const feature = findWorldRecruitsById(session, featureId)
  if (!feature) {
    return { session, error: 'Recruits building not found.' }
  }
  if (feature.stock < 1 || feature.unit_id < 1) {
    return { session, error: 'Nothing left to recruit this week.' }
  }
  if (qty > feature.stock) {
    return { session, error: `Only ${feature.stock} available to recruit.` }
  }
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero) {
    return { session, error: 'Hero not found.' }
  }
  if (hero.flight) {
    return { session, error: 'Land before recruiting.' }
  }
  const unit = unitById(catalog, feature.unit_id)
  if (!unit) {
    return { session, error: 'This offer has no recruitable unit.' }
  }
  if (!heroCanTakeUnit(session, heroId, unit.id)) {
    return { session, error: "Can't recruit, army is full." }
  }
  const cost = scaleCost(unitCost(unit), qty)
  const spent = spendPlayerResources(session, hero.player_id, cost)
  if (spent.error) {
    return { session, error: spent.error }
  }
  const slots = [...hero.army.slots_1_to_6]
  while (slots.length < ARMY_STACK_SLOTS) {
    slots.push(null)
  }
  const matchIndex = slots.findIndex((stackId) => {
    if (!stackId) {
      return false
    }
    const stack = spent.session.units.find((row) => row.id === stackId)
    return (
      stack != null &&
      stack.unit_id === unit.id &&
      stack.hero_id === heroId
    )
  })
  const emptyIndex = slots.findIndex((stackId) => stackId == null)
  let units = spent.session.units
  if (matchIndex >= 0) {
    const stackId = slots[matchIndex]!
    units = units.map((row) =>
      row.id === stackId ? { ...row, qty: row.qty + qty } : row,
    )
  } else {
    const stack: UnitStack = {
      id: nextStackId(spent.session),
      unit_id: unit.id,
      qty,
      town_id: null,
      hero_id: heroId,
      mob_id: null,
    }
    units = [...units, stack]
    slots[emptyIndex] = stack.id
  }
  return {
    session: {
      ...spent.session,
      units,
      heroes: spent.session.heroes.map((row) =>
        row.id === heroId
          ? { ...row, army: { ...row.army, slots_1_to_6: slots } }
          : row,
      ),
      features: (spent.session.features ?? []).map((row) =>
        row.kind === 'recruits' && row.id === featureId
          ? {
              ...row,
              stock: row.stock - qty,
              known_by_player: {
                ...row.known_by_player,
                [hero.player_id]: {
                  unit_id: row.unit_id,
                  stock: row.stock - qty,
                },
              },
            }
          : row,
      ),
    },
    error: null,
  }
}

/**
 * Max qty for a known/live offer (stock ∩ afford ∩ army room).
 * AI scoring uses this against `known_by_player` snapshots.
 */
export function worldRecruitsMaxQtyForOffer(
  session: GameSession,
  catalog: ReferenceCatalog,
  heroId: string,
  wallet: ResourceWallet,
  unitId: number,
  stock: number,
): number {
  if (stock < 1 || unitId < 1) {
    return 0
  }
  if (!heroCanTakeUnit(session, heroId, unitId)) {
    return 0
  }
  const unit = unitById(catalog, unitId)
  if (!unit) {
    return 0
  }
  return maxAffordableQty(wallet, unitCost(unit), stock)
}

/** Max qty from the live building stock. */
export function worldRecruitsMaxQty(
  session: GameSession,
  catalog: ReferenceCatalog,
  feature: RecruitsFeature,
  heroId: string,
  wallet: ResourceWallet,
): number {
  return worldRecruitsMaxQtyForOffer(
    session,
    catalog,
    heroId,
    wallet,
    feature.unit_id,
    feature.stock,
  )
}

/**
 * Visit outcome for AI: always refresh player knowledge from live stock,
 * then recruit if this hero can afford and has room (Town AI qty pick).
 */
export function aiRecruitFromWorldRecruits(
  session: GameSession,
  catalog: ReferenceCatalog,
  featureId: string,
  heroId: string,
): { session: GameSession; error: string | null; qty: number } {
  const feature = findWorldRecruitsById(session, featureId)
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!feature || !hero) {
    return { session, error: 'Recruits building not found.', qty: 0 }
  }
  let next = recordWorldRecruitsKnowledge(session, featureId, hero.player_id)
  const live = findWorldRecruitsById(next, featureId)!
  const wallet = walletForPlayer(next, hero.player_id)
  const maxQty = worldRecruitsMaxQty(next, catalog, live, heroId, wallet)
  if (maxQty < 1) {
    return {
      session: next,
      error: 'Cannot recruit (affordability, army room, or stock).',
      qty: 0,
    }
  }
  const qty = pickWorldRecruitQty(maxQty)
  if (qty < 1) {
    return { session: next, error: 'Cannot afford any recruits.', qty: 0 }
  }
  const result = recruitFromWorldRecruits(next, catalog, featureId, heroId, qty)
  return { ...result, qty: result.error ? 0 : qty }
}

/** AI qty pick — same distribution as town AI recruit. */
export function pickWorldRecruitQty(maxQty: number): number {
  if (maxQty <= 1) {
    return maxQty
  }
  if (Math.random() < 0.55) {
    return maxQty
  }
  const lo = Math.max(1, Math.ceil(maxQty * 0.35))
  const hi = Math.max(lo, Math.floor(maxQty * 0.75))
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

/** Town-AI-style army_value for a unit tier (exported for worldMove scoring). */
export function recruitsArmyValue(tier: number | null | undefined): number {
  const t = Math.max(1, tier ?? 1)
  return Math.round(Math.max(0.5, t / 3) * 100) / 100
}

export function worldRecruitsPerUnitCost(
  catalog: ReferenceCatalog,
  unitId: number,
): CostMap {
  return unitCost(unitById(catalog, unitId))
}

/** Debug / tooling — current game day number when known. */
export function currentGameDay(session: GameSession): number {
  return calendarDayNumber(session.game.calendar)
}

export function isMapFeatureRecruits(
  row: MapFeature,
): row is RecruitsFeature {
  return row.kind === 'recruits'
}
