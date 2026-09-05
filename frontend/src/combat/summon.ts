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
import { isHeroStack } from './battle'
import { combatEnterCost, moveKindForUnit } from './movement'
import {
  footprintFits,
  footprintStep,
  occupancyKey,
  occupiedHexes,
} from './occupancy'

const PERM_SLOTS = ARMY_STACK_SLOTS

export function isSummonStats(stats: Record<string, unknown>): boolean {
  if (stats.summon_unit_id != null) {
    return true
  }
  return stats.kill_pct_stat != null && stats.summon_tag != null
}

function asFinite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
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
  const tileAt = (q: number, r: number) =>
    tiles.find((tile) => tile.q === q && tile.r === r)
  const enterCost = (q: number, r: number) => combatEnterCost(tileAt(q, r), kind)
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
): SummonResolve {
  const hex = nearestOpenHexToHero(battle, catalog, tiles, casterSide, chosenUnit)
  if (!hex) {
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
    q: hex.q,
    r: hex.r,
    hasActedThisRound: false,
    retaliationsLeft: retaliationCharges(chosenUnit),
    persistOnSummon: persists,
    summonSeq: nextSummonSeq(battle.stacks),
  }
  let order = battle.order
  if (chosenUnit.speed != null && !order.includes(id)) {
    order = [...order, id]
  }
  return {
    battle: {
      ...battle,
      stacks: [...battle.stacks, summoned],
      order,
    },
    lines: [`${ability.name}: ${qty} ${chosenUnit.name} appear.`],
    flashes: [{ keys: [occupancyKey(hex.q, hex.r)], color: 'green' }],
  }
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
  const intel = heroEffectiveStats(
    catalog,
    caster.class_id,
    caster.current_level,
  ).intel
  const unitId = Math.floor(asFinite(stats.summon_unit_id) ?? 0)
  if (unitId > 0) {
    const unit = unitById(catalog, unitId)
    const qtyStat = asFinite(stats.summon_qty_int_stat) ?? 1
    const qty = Math.max(0, Math.floor(intel * qtyStat))
    if (!unit || qty <= 0) {
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
    )
  }

  const killTag = Math.floor(asFinite(stats.kill_tag) ?? 0)
  const summonTag = Math.floor(asFinite(stats.summon_tag) ?? 0)
  const pct = asFinite(stats.kill_pct_stat) ?? 0
  const deaths = killTag > 0 ? deathsForTag(battle, catalog, killTag) : 0
  const qty = Math.max(0, Math.floor(intel * (pct / 100) * deaths))
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
