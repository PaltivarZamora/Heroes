import type { Axial } from '../hex/hero'
import { hexDistance } from '../hex/pathfinding'
import { ARMY_STACK_SLOTS, type Hero } from '../session/types'
import type { AbilityRow, ReferenceCatalog, UnitRow } from '../town/catalog'
import {
  heroEffectiveStats,
  retaliationCharges,
  unitById,
  unitHasTag,
  unitHexFootprint,
  unitsWithTag,
} from '../town/catalog'
import type { HitFlashColor } from './attack'
import type {
  CombatBattle,
  CombatSide,
  CombatStack,
  CombatTile,
} from './battle'
import { insertIntoRemainingInitiative, isHeroStack } from './battle'
import { combatCanLandOn, combatEnterCost, moveKindForUnit } from './movement'
import {
  footprintFits,
  footprintStep,
  occupancyKey,
  occupiedHexes,
} from './occupancy'

const PERM_SLOTS = ARMY_STACK_SLOTS
const ENERGY_RESOURCE_ID = 1

export function isSummonStats(stats: Record<string, unknown>): boolean {
  if (stats.summon_unit_id != null) {
    return true
  }
  return stats.kill_pct_stat != null && stats.summon_tag != null
}

/** N separate stacks at random open hexes. target_id is a placeholder. */
export function isRandomPlacementSummon(
  stats: Record<string, unknown> | null | undefined,
): boolean {
  if (!stats) {
    return false
  }
  return (
    asFinite(stats.summon_count) != null || Array.isArray(stats.silence_schedule)
  )
}

function asFinite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function asIntList(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null
  }
  const out = value
    .map((item) => asFinite(item))
    .filter((n): n is number => n != null)
    .map((n) => Math.floor(n))
  return out.length > 0 ? out : null
}

function summonLandCost(
  tiles: CombatTile[],
  kind: ReturnType<typeof moveKindForUnit>,
): (q: number, r: number) => number | null {
  const tileAt = (q: number, r: number) =>
    tiles.find((tile) => tile.q === q && tile.r === r)
  return (q, r) => {
    const tile = tileAt(q, r)
    if (!combatCanLandOn(tile, kind)) {
      return null
    }
    return combatEnterCost(tile, kind)
  }
}

function openHexesForUnit(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  side: CombatSide,
  unit: UnitRow,
): Axial[] {
  const occupied = occupiedHexes(battle.stacks, catalog)
  const kind = moveKindForUnit(unit, catalog)
  const enterCost = summonLandCost(tiles, kind)
  const size = unitHexFootprint(unit)
  const step = footprintStep(side)
  return tiles.filter((tile) =>
    footprintFits({ q: tile.q, r: tile.r }, size, step, occupied, enterCost),
  )
}

export function pickRandomOpenHex(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  side: CombatSide,
  unit: UnitRow,
  random: () => number,
): Axial | null {
  const open = openHexesForUnit(battle, catalog, tiles, side, unit)
  return pickRandom(open, random)
}

function pickRandom<T>(items: T[], random: () => number): T | null {
  if (items.length === 0) {
    return null
  }
  return items[Math.floor(random() * items.length)] ?? null
}

function deathsForTag(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tagId: number,
): number {
  let total = 0
  for (const [rawId, killed] of Object.entries(battle.unitDeaths ?? {})) {
    const unitId = Number(rawId)
    if (!Number.isInteger(unitId) || killed <= 0) {
      continue
    }
    if (unitHasTag(unitById(catalog, unitId), tagId)) {
      total += killed
    }
  }
  return total
}

function livingTaggedStacks(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  side: CombatSide,
  tagId: number,
): CombatStack[] {
  return battle.stacks
    .filter(
      (row) =>
        row.side === side &&
        row.qty > 0 &&
        !isHeroStack(row) &&
        unitHasTag(unitById(catalog, row.unitId), tagId),
    )
    .sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id))
}

/** Selection gate: `requires_existing_summon_tag` needs a living tagged stack. */
export function abilityMeetsCastGate(
  catalog: ReferenceCatalog,
  ability: AbilityRow,
  battle: CombatBattle,
  side: CombatSide,
): boolean {
  const stats = ability.stats
  if (!stats || stats.requires_existing_summon_tag !== true) {
    return true
  }
  const tag = Math.floor(asFinite(stats.summon_tag) ?? 0)
  if (tag <= 0) {
    return false
  }
  return livingTaggedStacks(battle, catalog, side, tag).length > 0
}

function nextOverflowSlot(battle: CombatBattle, side: CombatSide): number {
  let slot = PERM_SLOTS
  const taken = new Set(
    battle.stacks.filter((row) => row.side === side).map((row) => row.slot),
  )
  while (taken.has(slot)) {
    slot += 1
  }
  return slot
}

function nextSummonId(stacks: CombatStack[], side: CombatSide): string {
  let n = 1
  while (stacks.some((row) => row.id === `combat-${side}-summon-${n}`)) {
    n += 1
  }
  return `combat-${side}-summon-${n}`
}

function nextSummonSeq(stacks: CombatStack[]): number {
  let seq = 0
  for (const stack of stacks) {
    if (stack.summonSeq != null && stack.summonSeq > seq) {
      seq = stack.summonSeq
    }
  }
  return seq + 1
}

export function nearestOpenHexToHero(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  side: CombatSide,
  unit: UnitRow,
): Axial | null {
  const hero = battle.stacks.find(
    (stack) => stack.side === side && isHeroStack(stack),
  )
  if (!hero) {
    return null
  }
  const occupied = occupiedHexes(battle.stacks, catalog)
  const kind = moveKindForUnit(unit, catalog)
  const enterCost = summonLandCost(tiles, kind)
  const size = unitHexFootprint(unit)
  const step = footprintStep(side)
  const ranked = [...tiles]
    .filter((tile) => !(tile.q === hero.q && tile.r === hero.r))
    .sort((a, b) => {
      const da = hexDistance(hero, a)
      const db = hexDistance(hero, b)
      if (da !== db) {
        return da - db
      }
      if (a.q !== b.q) {
        return a.q - b.q
      }
      return a.r - b.r
    })
  for (const tile of ranked) {
    if (footprintFits({ q: tile.q, r: tile.r }, size, step, occupied, enterCost)) {
      return { q: tile.q, r: tile.r }
    }
  }
  return null
}

export type SummonResolve = {
  battle: CombatBattle
  lines: string[]
  flashes: Array<{ keys: string[]; color: HitFlashColor }>
}

function spawnSummonedStack(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  ability: AbilityRow,
  chosenUnit: UnitRow,
  qty: number,
  persists: boolean,
  casterSide: CombatSide,
  hex: Axial | null = null,
  extras: Partial<CombatStack> = {},
  insertIntoRemaining = false,
): SummonResolve {
  const at =
    hex ?? nearestOpenHexToHero(battle, catalog, tiles, casterSide, chosenUnit)
  if (!at) {
    return {
      battle,
      lines: [`${ability.name} found no space on the field.`],
      flashes: [],
    }
  }
  const id = nextSummonId(battle.stacks, casterSide)
  const summoned: CombatStack = {
    id,
    side: casterSide,
    slot: nextOverflowSlot(battle, casterSide),
    unitId: chosenUnit.id,
    qty,
    topHealth: Math.max(1, chosenUnit.health),
    startingQty: qty,
    q: at.q,
    r: at.r,
    hasActedThisRound: false,
    retaliationsLeft: retaliationCharges(chosenUnit),
    persistOnSummon: persists,
    summonSeq: nextSummonSeq(battle.stacks),
    ...extras,
  }
  let order = battle.order
  if (chosenUnit.speed != null && !order.includes(id)) {
    order = [...order, id]
  }
  let next: CombatBattle = {
    ...battle,
    stacks: [...battle.stacks, summoned],
    order,
  }
  if (insertIntoRemaining && chosenUnit.speed != null) {
    next = insertIntoRemainingInitiative(next, catalog, id)
  }
  return {
    battle: next,
    lines: [`${ability.name}: ${qty} ${chosenUnit.name} appear.`],
    flashes: [{ keys: [occupancyKey(at.q, at.r)], color: 'green' }],
  }
}

function spawnRandomStacks(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  ability: AbilityRow,
  chosenUnit: UnitRow,
  count: number,
  persists: boolean,
  casterSide: CombatSide,
  random: () => number,
  extras: Partial<CombatStack>,
  schedule: number[] | null,
): SummonResolve {
  let next = battle
  const lines: string[] = []
  const flashes: SummonResolve['flashes'] = []
  let placed = 0
  for (let i = 0; i < count; i += 1) {
    const hex = pickRandomOpenHex(next, catalog, tiles, casterSide, chosenUnit, random)
    if (!hex) {
      break
    }
    const shots =
      schedule && schedule.length > 0
        ? (schedule[i] ?? schedule[schedule.length - 1] ?? 1)
        : null
    const spawned = spawnSummonedStack(
      next,
      catalog,
      tiles,
      ability,
      chosenUnit,
      1,
      persists,
      casterSide,
      hex,
      shots != null ? { ...extras, silenceShotsLeft: shots } : extras,
    )
    next = spawned.battle
    flashes.push(...spawned.flashes)
    placed += 1
  }
  if (placed === 0) {
    return {
      battle,
      lines: [`${ability.name} found no space on the field.`],
      flashes: [],
    }
  }
  lines.push(`${ability.name}: ${placed} ${chosenUnit.name} appear.`)
  return { battle: next, lines, flashes }
}

/** Always a fresh battlefield stack next to the Hero. Never merges mid-combat. */
export function applySummonFromStats(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  ability: AbilityRow,
  stats: Record<string, unknown>,
  caster: Hero,
  casterSide: CombatSide,
  random: () => number,
): SummonResolve {
  const persists = stats.persists_on_summon === true
  const heroStats = heroEffectiveStats(
    catalog,
    caster.class_id,
    caster.current_level,
  )
  const intel = heroStats.intel
  const scaleStat =
    ability.resource_id === ENERGY_RESOURCE_ID
      ? heroStats.strength
      : intel
  const unitId = Math.floor(asFinite(stats.summon_unit_id) ?? 0)
  if (unitId > 0) {
    const unit = unitById(catalog, unitId)
    if (!unit) {
      return {
        battle,
        lines: [`${ability.name} raised 0.`],
        flashes: [],
      }
    }
    if (isRandomPlacementSummon(stats)) {
      const count = Math.max(1, Math.floor(asFinite(stats.summon_count) ?? 1))
      const schedule = asIntList(stats.silence_schedule)
      const extras: Partial<CombatStack> = {
        spawnedRound: battle.round,
        indestructible: true,
      }
      return spawnRandomStacks(
        battle,
        catalog,
        tiles,
        ability,
        unit,
        count,
        persists,
        casterSide,
        random,
        extras,
        schedule,
      )
    }
    const qtyDiv = asFinite(stats.summon_qty_stat_div)
    const qty =
      qtyDiv != null && qtyDiv > 0
        ? Math.max(0, Math.floor(scaleStat / qtyDiv))
        : Math.max(0, Math.floor(intel * (asFinite(stats.summon_qty_int_stat) ?? 1)))
    if (qty <= 0) {
      return {
        battle,
        lines: [`${ability.name} raised 0.`],
        flashes: [],
      }
    }
    return spawnSummonedStack(
      battle,
      catalog,
      tiles,
      ability,
      unit,
      qty,
      persists,
      casterSide,
      null,
      {},
      stats.insert_into_current_round_queue === true,
    )
  }

  const killTag = Math.floor(asFinite(stats.kill_tag) ?? 0)
  const summonTag = Math.floor(asFinite(stats.summon_tag) ?? 0)
  const pct = asFinite(stats.kill_pct_stat) ?? 0
  const deaths = killTag > 0 ? deathsForTag(battle, catalog, killTag) : 0
  const qty = Math.max(0, Math.floor(scaleStat * (pct / 100) * deaths))
  if (qty <= 0 || summonTag <= 0) {
    return {
      battle,
      lines: [`${ability.name} raised 0.`],
      flashes: [],
    }
  }

  const pool = unitsWithTag(catalog, summonTag).filter(
    (row) => (row.speed ?? 0) > 0,
  )
  const chosenUnit = pickRandom(pool, random)
  if (!chosenUnit) {
    return {
      battle,
      lines: [`${ability.name} raised 0.`],
      flashes: [],
    }
  }

  return spawnSummonedStack(
    battle,
    catalog,
    tiles,
    ability,
    chosenUnit,
    qty,
    persists,
    casterSide,
  )
}
