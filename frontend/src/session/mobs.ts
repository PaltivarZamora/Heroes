import { hexDistance } from '../hex/pathfinding'
import { forEachPassableHex } from '../hex/world'
import {
  advancedUnitFor,
  buildingById,
  buildingGrowth,
  getCachedCatalog,
  isAdvancedUnit,
  unitById,
  unitEffectiveTier,
  type ReferenceCatalog,
  type UnitRow,
} from '../town/catalog'
import {
  mapMobAdvancedPct,
  mapMobMinTownDist,
  mapRandomMobs,
  mapRandomMobsTier,
} from '../ai/weights'
import {
  ARMY_STACK_SLOTS,
  type GameSession,
  type Mob,
  type UnitStack,
} from './types'

function posKey(position: { q: number; r: number }): string {
  return `${position.q},${position.r}`
}

function u32(n: number): number {
  return n >>> 0
}

function mobRand(seed: number, n: number): number {
  let h = u32(
    Math.imul(seed, 0x9e3779b1) ^ Math.imul(n + 0x7f4a7c15, 0x85ebca6b),
  )
  h = u32((h ^ (h >>> 16)) * 0x7feb352d)
  h = u32((h ^ (h >>> 15)) * 0x846ca68b)
  return u32(h ^ (h >>> 16))
}

function padSlots(slots: Array<string | null>): Array<string | null> {
  const next = slots.slice(0, ARMY_STACK_SLOTS)
  while (next.length < ARMY_STACK_SLOTS) {
    next.push(null)
  }
  return next
}

function occupiedKeys(session: GameSession): Set<string> {
  const keys = new Set<string>()
  for (const town of session.towns) {
    keys.add(posKey(town.position))
  }
  for (const hero of session.heroes) {
    keys.add(posKey(hero.position))
  }
  for (const node of session.nodes) {
    if (node.kind === 'pickup' && node.collected) {
      continue
    }
    keys.add(posKey(node.position))
  }
  for (const mob of session.mobs) {
    keys.add(posKey(mob.position))
  }
  return keys
}

function eligibleBaseUnits(
  catalog: ReferenceCatalog,
  maxTier: number,
): UnitRow[] {
  return catalog.unit.filter((unit) => {
    if (!unit.has_abilities || isAdvancedUnit(unit) || (unit.speed ?? 0) <= 0) {
      return false
    }
    if (unitEffectiveTier(catalog, unit) > maxTier) {
      return false
    }
    return buildingGrowth(buildingById(catalog, unit.bldg_id)) > 0
  })
}

function startingQty(catalog: ReferenceCatalog, unit: UnitRow): number {
  return Math.max(1, buildingGrowth(buildingById(catalog, unit.bldg_id)))
}

function composition(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  advancedPct: number,
): Array<{ unitId: number; qty: number }> {
  const qty = startingQty(catalog, unit)
  const advanced = advancedUnitFor(catalog, unit)
  if (!advanced?.has_abilities) {
    return [{ unitId: unit.id, qty }]
  }
  const advQty = Math.min(qty - 1, Math.floor((qty * advancedPct) / 100))
  if (advQty <= 0) {
    return [{ unitId: unit.id, qty }]
  }
  return [
    { unitId: unit.id, qty: qty - advQty },
    { unitId: advanced.id, qty: advQty },
  ]
}

function nextMobId(session: GameSession): string {
  let n = session.mobs.length + 1
  let id = `mob-${n}`
  while (session.mobs.some((row) => row.id === id)) {
    n += 1
    id = `mob-${n}`
  }
  return id
}

function nextStackId(session: GameSession): string {
  let n = session.units.length + 1
  while (session.units.some((unit) => unit.id === `unit-${n}`)) {
    n += 1
  }
  return `unit-${n}`
}

function appendStack(
  session: GameSession,
  mobId: string,
  unitId: number,
  qty: number,
): { session: GameSession; stackId: string } {
  const id = nextStackId(session)
  const stack: UnitStack = {
    id,
    unit_id: unitId,
    qty,
    town_id: null,
    hero_id: null,
    mob_id: mobId,
  }
  return {
    session: { ...session, units: [...session.units, stack] },
    stackId: id,
  }
}

function spawnOne(
  session: GameSession,
  catalog: ReferenceCatalog,
  position: { q: number; r: number },
  unit: UnitRow,
  advancedPct: number,
): GameSession {
  const mobId = nextMobId(session)
  const slots = padSlots([])
  let next = session
  let slot = 0
  for (const part of composition(catalog, unit, advancedPct)) {
    if (slot >= ARMY_STACK_SLOTS || part.qty <= 0) {
      continue
    }
    const added = appendStack(next, mobId, part.unitId, part.qty)
    next = added.session
    slots[slot] = added.stackId
    slot += 1
  }
  if (slot === 0) {
    return session
  }
  const mob: Mob = { id: mobId, position: { ...position }, slots_1_to_6: slots }
  return { ...next, mobs: [...next.mobs, mob] }
}

function candidatesNearTown(
  townPos: { q: number; r: number },
  towns: Array<{ q: number; r: number }>,
  occupied: Set<string>,
  minTownDist: number,
): Array<{ q: number; r: number }> {
  const found: Array<{ q: number; r: number; dist: number }> = []
  forEachPassableHex((q, r) => {
    const hex = { q, r }
    if (occupied.has(posKey(hex))) {
      return
    }
    if (towns.some((town) => hexDistance(hex, town) < minTownDist)) {
      return
    }
    found.push({ q, r, dist: hexDistance(hex, townPos) })
  })
  found.sort((a, b) => a.dist - b.dist || a.q - b.q || a.r - b.r)
  return found
}

/**
 * Place `map_random_mobs` neutrals around each town using live config
 * (tier cap, Advanced %, min-distance). Always adds a new batch — existing
 * mobs stay; occupied hexes are skipped. New-game seeding no-ops separately.
 */
export function addWorldMobs(session: GameSession): GameSession {
  if (session.towns.length === 0) {
    return session
  }
  const catalog = getCachedCatalog()
  if (!catalog) {
    return session
  }
  const perTown = mapRandomMobs(catalog)
  const maxTier = mapRandomMobsTier(catalog)
  const advancedPct = mapMobAdvancedPct(catalog)
  const minTownDist = mapMobMinTownDist(catalog)
  const pool = eligibleBaseUnits(catalog, maxTier)
  if (perTown <= 0 || pool.length === 0) {
    return session
  }
  const townPositions = session.towns.map((town) => town.position)
  const occupied = occupiedKeys(session)
  const seed = session.game.seed || 1
  let next = session
  let n = session.mobs.length
  for (const town of session.towns) {
    const spots = candidatesNearTown(
      town.position,
      townPositions,
      occupied,
      minTownDist,
    )
    for (let i = 0; i < perTown && spots.length > 0; i += 1) {
      const pick = mobRand(seed, n) % spots.length
      const hex = spots.splice(pick, 1)[0]!
      const unit = pool[mobRand(seed, n + 17) % pool.length]!
      occupied.add(posKey(hex))
      next = spawnOne(next, catalog, hex, unit, advancedPct)
      n += 1
    }
  }
  return next
}

/**
 * New-game / new-map only. No-op when mobs already exist (saves).
 */
export function seedWorldMobs(session: GameSession): GameSession {
  if (session.mobs.length > 0) {
    return session
  }
  return addWorldMobs(session)
}

function dwellingGrowthFor(
  catalog: ReferenceCatalog,
  unitId: number,
): number {
  const unit = unitById(catalog, unitId)
  if (!unit) {
    return 0
  }
  return buildingGrowth(buildingById(catalog, unit.bldg_id))
}

function primaryUnitId(
  session: GameSession,
  catalog: ReferenceCatalog,
  mob: Mob,
): number | null {
  const stacks = mob.slots_1_to_6
    .map((id) => (id ? session.units.find((row) => row.id === id) : null))
    .filter((row): row is UnitStack => row != null && row.qty > 0)
  const basic = stacks.find((row) => {
    const unit = unitById(catalog, row.unit_id)
    return unit != null && !isAdvancedUnit(unit)
  })
  return (basic ?? stacks[0])?.unit_id ?? null
}

function distributeQty(
  session: GameSession,
  stackIds: string[],
  qty: number,
): GameSession {
  if (stackIds.length === 0 || qty <= 0) {
    return session
  }
  const base = Math.floor(qty / stackIds.length)
  let rem = qty - base * stackIds.length
  const add = new Map<string, number>()
  for (const id of stackIds) {
    const extra = rem > 0 ? 1 : 0
    rem -= extra
    add.set(id, base + extra)
  }
  return {
    ...session,
    units: session.units.map((row) => {
      const extra = add.get(row.id)
      return extra ? { ...row, qty: row.qty + extra } : row
    }),
  }
}

function growOneMob(
  session: GameSession,
  catalog: ReferenceCatalog,
  mob: Mob,
): GameSession {
  const unitId = primaryUnitId(session, catalog, mob)
  if (unitId == null) {
    return session
  }
  const growth = dwellingGrowthFor(catalog, unitId)
  if (growth <= 0) {
    return session
  }
  const slots = padSlots(mob.slots_1_to_6)
  const empty = slots.findIndex((id) => id == null)
  if (empty >= 0) {
    const added = appendStack(session, mob.id, unitId, growth)
    const nextSlots = [...slots]
    nextSlots[empty] = added.stackId
    return {
      ...added.session,
      mobs: added.session.mobs.map((row) =>
        row.id === mob.id ? { ...row, slots_1_to_6: nextSlots } : row,
      ),
    }
  }
  const sameType = slots.filter((id) => {
    if (!id) {
      return false
    }
    return session.units.find((row) => row.id === id)?.unit_id === unitId
  }) as string[]
  const targets = sameType.length > 0 ? sameType : slots.filter((id): id is string => id != null)
  return distributeQty(session, targets, growth)
}

/** Same dwelling growth numbers as a recruited army; 6-stack cap then even split. */
export function applyWeeklyMobGrowth(
  session: GameSession,
  catalog: ReferenceCatalog,
): GameSession {
  let next = session
  for (const mob of session.mobs) {
    const live = next.mobs.find((row) => row.id === mob.id)
    if (live) {
      next = growOneMob(next, catalog, live)
    }
  }
  return next
}

export function findMobAt(
  session: GameSession,
  q: number,
  r: number,
): Mob | undefined {
  return session.mobs.find((mob) => mob.position.q === q && mob.position.r === r)
}

export function mobLeadStack(
  session: GameSession,
  mob: Mob,
): UnitStack | null {
  const stacks = mob.slots_1_to_6
    .map((id) => (id ? session.units.find((row) => row.id === id) : null))
    .filter((row): row is UnitStack => row != null && row.qty > 0)
  return [...stacks].sort((a, b) => b.qty - a.qty)[0] ?? null
}

export function mobLabel(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  mob: Mob,
): string {
  const top = mobLeadStack(session, mob)
  if (!top) {
    return 'Mob'
  }
  const name = unitById(catalog, top.unit_id)?.name ?? 'Mob'
  return `${top.qty} ${name}`
}

export function removeWorldMob(session: GameSession, mob: Mob): GameSession {
  const drop = new Set(
    mob.slots_1_to_6.filter((id): id is string => id != null && id !== ''),
  )
  return {
    ...session,
    units: session.units.filter(
      (row) => !drop.has(row.id) && row.mob_id !== mob.id,
    ),
    mobs: session.mobs.filter((row) => row.id !== mob.id),
  }
}
