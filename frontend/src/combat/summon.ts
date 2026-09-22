import type { Axial } from '../hex/hero'
import { hexDistance, neighborHexes } from '../hex/pathfinding'
import { ARMY_STACK_SLOTS, type Hero } from '../session/types'
import type { AbilityRow, ReferenceCatalog, UnitRow } from '../town/catalog'
import {
  heroEffectiveStats,
  retaliationCharges,
  unitById,
  unitFootprint,
  unitHasTag,
  unitTakesTurns,
  unitsWithTag,
} from '../town/catalog'
import {
  applyStackHeal,
  heroForSide,
  type CombatHeroes,
  type HitFlashColor,
} from './attack'
import type {
  CombatBattle,
  CombatSide,
  CombatStack,
  CombatTile,
} from './battle'
import { insertIntoRemainingInitiative, isHeroStack, stackMaxHealth } from './battle'
import {
  ATTACKER_COL,
  ATTACKER_HERO_COL,
  DEFENDER_COL,
  DEFENDER_HERO_COL,
} from './battlefield'
import {
  blockerPlacementKeepsEscapeRoutes,
  permanentBlockKeys,
} from './battleProps'
import { mirrorImageTopHealth } from './abilityStatMath'
import {
  isNatureTotemStack,
  isShamanTotemStack,
  shamanTotemCount,
  shamanTotemSpawnPerRound,
  totemSpawnExtras,
  totemTypeToUnitName,
  totemUnitByName,
  type TotemUnitName,
} from './heroArmyPassives'
import {
  missingPassiveStatKey,
  passiveStatNumber,
  passiveStatSourceValue,
  passiveStatString,
  passiveStatStringList,
  requirePassiveStats,
} from '../town/heroPassiveStats'
import {
  pickMostInjuredDamagedCreature,
  frontDeficit,
} from './templePassive'
import { isHeroClass } from './shadow'
import { combatCanLandOn, combatEnterCost, moveKindForUnit, stackOccupyingHex } from './movement'
import {
  footprintFits,
  footprintAlong,
  occupancyKey,
  occupiedHexes,
} from './occupancy'
import { tombstoneOccupancyBodies } from './tombstone'

const PERM_SLOTS = ARMY_STACK_SLOTS
const ENERGY_RESOURCE_ID = 1

export function isSummonStats(stats: Record<string, unknown>): boolean {
  // Ice Shards / Earth Spikes: damage (and optional knockback) plus terrain drops —
  // not a pure summon short-circuit.
  if (
    isIceShardStats(stats) ||
    isRadiusTerrainDropStats(stats) ||
    stats.targets_hexes === true
  ) {
    return false
  }
  if (stats.summon_unit_id != null) {
    return true
  }
  return stats.kill_pct_stat != null && stats.summon_tag != null
}

/** Ice Shards: single-target damage plus occupancy-aware adjacent blockers. */
export function isIceShardStats(
  stats: Record<string, unknown> | null | undefined,
): boolean {
  if (!stats) {
    return false
  }
  return (
    stats.skip_occupied_adjacent === true ||
    asFinite(stats.shard_radius) != null ||
    stats.redistribute_if_single_adjacent === true
  )
}

/**
 * Earth Spikes-style batch drop: place `summon_count` blockers in an aimed radius
 * after other effects. Not used when `targets_hexes` places one spike per bolt.
 */
export function isRadiusTerrainDropStats(
  stats: Record<string, unknown> | null | undefined,
): boolean {
  if (!stats || isIceShardStats(stats) || stats.targets_hexes === true) {
    return false
  }
  return (
    asFinite(stats.summon_unit_id) != null &&
    asFinite(stats.summon_count) != null &&
    asFinite(stats.radius) != null
  )
}

/** N separate stacks at random open hexes. target_id is a placeholder. */
export function isRandomPlacementSummon(
  stats: Record<string, unknown> | null | undefined,
): boolean {
  if (!stats) {
    return false
  }
  // Aimed terrain drops still need a hex click despite summon_count.
  if (isIceShardStats(stats) || isRadiusTerrainDropStats(stats)) {
    return false
  }
  // Arcane Shield / Illusions: geometric placement, not random scatter.
  const placement = String(stats.placement ?? '')
    .trim()
    .toLowerCase()
  if (
    placement === 'front_of_target' ||
    placement === 'map_center_scattered' ||
    stats.summon_as_separate_stacks === true
  ) {
    return false
  }
  return (
    asFinite(stats.summon_count) != null || Array.isArray(stats.bolt_schedule)
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

/** Avoid "Earth Spikess" when the unit name is already plural. */
function blockerLabel(name: string, count: number): string {
  if (count === 1) {
    return name
  }
  const trimmed = name.trim()
  if (/s$/i.test(trimmed)) {
    return trimmed
  }
  return `${trimmed}s`
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
  const occupied = occupiedHexes(
    battle.stacks,
    catalog,
    undefined,
    tombstoneOccupancyBodies(battle.tombstones),
  )
  const kind = moveKindForUnit(unit, catalog)
  const enterCost = summonLandCost(tiles, kind)
  const code = unitFootprint(unit)
  const along = footprintAlong(side)
  return tiles.filter((tile) =>
    footprintFits({ q: tile.q, r: tile.r }, code, along, occupied, enterCost),
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
  return nearestOpenHexTo(battle, catalog, tiles, side, unit, hero)
}

/** Nearest landable hex to `origin` (prefers adjacent, then expanding). */
export function nearestOpenHexTo(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  side: CombatSide,
  unit: UnitRow,
  origin: Axial,
): Axial | null {
  const occupied = occupiedHexes(
    battle.stacks,
    catalog,
    undefined,
    tombstoneOccupancyBodies(battle.tombstones),
  )
  const kind = moveKindForUnit(unit, catalog)
  const enterCost = summonLandCost(tiles, kind)
  const code = unitFootprint(unit)
  const along = footprintAlong(side)
  const ranked = [...tiles]
    .filter((tile) => !(tile.q === origin.q && tile.r === origin.r))
    .sort((a, b) => {
      const da = hexDistance(origin, a)
      const db = hexDistance(origin, b)
      if (da !== db) {
        return da - db
      }
      if (a.q !== b.q) {
        return a.q - b.q
      }
      return a.r - b.r
    })
  for (const tile of ranked) {
    if (footprintFits({ q: tile.q, r: tile.r }, code, along, occupied, enterCost)) {
      return { q: tile.q, r: tile.r }
    }
  }
  return null
}

function mapCenter(tiles: CombatTile[]): Axial {
  if (tiles.length === 0) {
    return { q: 0, r: 0 }
  }
  let sq = 0
  let sr = 0
  for (const tile of tiles) {
    sq += tile.q
    sr += tile.r
  }
  return {
    q: Math.round(sq / tiles.length),
    r: Math.round(sr / tiles.length),
  }
}

/**
 * Hexes on the caster-facing side of `target` (neighbors closest to caster).
 * Occupied hexes are skipped — same spirit as Ice Shards.
 */
function frontOfTargetOpenHexes(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  side: CombatSide,
  unit: UnitRow,
  target: Axial,
  casterOrigin: Axial,
  want: number,
): Axial[] {
  const board = new Set(tiles.map((tile) => occupancyKey(tile.q, tile.r)))
  const occupied = occupiedHexes(
    battle.stacks,
    catalog,
    undefined,
    tombstoneOccupancyBodies(battle.tombstones),
  )
  const kind = moveKindForUnit(unit, catalog)
  const enterCost = summonLandCost(tiles, kind)
  const code = unitFootprint(unit)
  const along = footprintAlong(side)
  const ranked = neighborHexes(target)
    .filter((hex) => board.has(occupancyKey(hex.q, hex.r)))
    .sort((a, b) => {
      const da = hexDistance(a, casterOrigin)
      const db = hexDistance(b, casterOrigin)
      if (da !== db) {
        return da - db
      }
      if (a.q !== b.q) {
        return a.q - b.q
      }
      return a.r - b.r
    })
  const out: Axial[] = []
  for (const hex of ranked) {
    if (out.length >= want) {
      break
    }
    if (!footprintFits(hex, code, along, occupied, enterCost)) {
      continue
    }
    out.push(hex)
    occupied.add(occupancyKey(hex.q, hex.r))
  }
  return out
}

function pickNearCenterOpenHex(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  side: CombatSide,
  unit: UnitRow,
  random: () => number,
): Axial | null {
  const center = mapCenter(tiles)
  const open = openHexesForUnit(battle, catalog, tiles, side, unit)
  if (open.length === 0) {
    return null
  }
  open.sort((a, b) => {
    const da = hexDistance(center, a)
    const db = hexDistance(center, b)
    if (da !== db) {
      return da - db
    }
    if (a.q !== b.q) {
      return a.q - b.q
    }
    return a.r - b.r
  })
  // Bias toward center: pick randomly among the nearest third.
  const poolSize = Math.max(1, Math.ceil(open.length / 3))
  const pool = open.slice(0, poolSize)
  return pickRandom(pool, random)
}

function tileCol(tiles: CombatTile[], hex: Axial): number | null {
  const tile = tiles.find((row) => row.q === hex.q && row.r === hex.r)
  return tile?.col ?? null
}

/**
 * Place behind the army: attacker → leftmost (hero) columns; defender → rightmost.
 * Prefers the rearmost open column on that side, then a random hex in that column.
 */
function pickBehindArmyOpenHex(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  side: CombatSide,
  unit: UnitRow,
  random: () => number,
): Axial | null {
  const open = openHexesForUnit(battle, catalog, tiles, side, unit)
  if (open.length === 0) {
    return null
  }
  const backMaxCol = side === 'atk' ? ATTACKER_COL : DEFENDER_HERO_COL
  const backMinCol = side === 'atk' ? ATTACKER_HERO_COL : DEFENDER_COL
  const behind = open.filter((hex) => {
    const col = tileCol(tiles, hex)
    if (col == null) {
      return true
    }
    return col >= backMinCol && col <= backMaxCol
  })
  const pool = behind.length > 0 ? behind : open
  pool.sort((a, b) => {
    const ca = tileCol(tiles, a)
    const cb = tileCol(tiles, b)
    if (ca != null && cb != null && ca !== cb) {
      // Attacker: lower col is further back; defender: higher col is further back.
      return side === 'atk' ? ca - cb : cb - ca
    }
    if (a.r !== b.r) {
      return a.r - b.r
    }
    return a.q - b.q
  })
  const bestCol = tileCol(tiles, pool[0]!)
  const sameCol =
    bestCol == null
      ? pool
      : pool.filter((hex) => tileCol(tiles, hex) === bestCol)
  return pickRandom(sameCol.length > 0 ? sameCol : pool, random)
}

/** Prefer one of each totem type, then fill remaining slots at random. */
function pickTotemUnitsForSpawn(
  pool: UnitRow[],
  count: number,
  random: () => number,
  preferUnique: boolean,
): UnitRow[] {
  if (pool.length === 0 || count <= 0) {
    return []
  }
  const out: UnitRow[] = []
  if (preferUnique) {
    const shuffled = [...pool]
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1))
      const tmp = shuffled[i]!
      shuffled[i] = shuffled[j]!
      shuffled[j] = tmp
    }
    for (const unit of shuffled) {
      if (out.length >= count) {
        break
      }
      out.push(unit)
    }
  }
  while (out.length < count) {
    const unit = pool[Math.floor(random() * pool.length)]
    if (!unit) {
      break
    }
    out.push(unit)
  }
  return out
}

export type SummonResolve = {
  battle: CombatBattle
  lines: string[]
  flashes: Array<{ keys: string[]; color: HitFlashColor }>
}

/** Place one indestructible blocker on `hex` if the hex is open. */
export function placeBlockerAtHex(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  ability: AbilityRow,
  unitId: number,
  hex: Axial,
  casterSide: CombatSide,
  persists = false,
): SummonResolve {
  const unit = unitId > 0 ? unitById(catalog, unitId) : null
  if (!unit) {
    return { battle, lines: [], flashes: [] }
  }
  const body =
    stackOccupyingHex(battle.stacks, hex.q, hex.r, catalog) ??
    battle.stacks.find((row) => row.q === hex.q && row.r === hex.r && row.qty > 0) ??
    null
  if (body) {
    return { battle, lines: [], flashes: [] }
  }
  const onBoard = tiles.some((tile) => tile.q === hex.q && tile.r === hex.r)
  if (!onBoard) {
    return { battle, lines: [], flashes: [] }
  }
  return spawnSummonedStack(
    battle,
    catalog,
    tiles,
    ability,
    unit,
    1,
    persists,
    casterSide,
    hex,
    {
      spawnedRound: battle.round,
      indestructible: true,
    },
  )
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
    // Creation round — Mud Golem skipFirstTurn / similar gates key off this.
    spawnedRound: battle.round,
    startHex: { q: at.q, r: at.r },
    ...extras,
  }
  let order = battle.order
  // Null-speed units (Wall, Arcane Shield, …) never enter initiative.
  if (unitTakesTurns(chosenUnit) && !order.includes(id)) {
    order = [...order, id]
  }
  let next: CombatBattle = {
    ...battle,
    stacks: [...battle.stacks, summoned],
    order,
  }
  if (insertIntoRemaining && unitTakesTurns(chosenUnit)) {
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

/**
 * Tag-based summons (e.g. Recruit the Dead) reinforce a living stack with
 * that tag when one exists; otherwise spawn a new stack near the Hero.
 * Unit-id summons always spawn fresh.
 */
export function applySummonFromStats(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  ability: AbilityRow,
  stats: Record<string, unknown>,
  caster: Hero,
  casterSide: CombatSide,
  random: () => number,
  aim?: { targetId: string | null; hex: Axial },
): SummonResolve {
  const persists = stats.persists_on_summon === true
  const insertQueue = stats.insert_into_current_round_queue === true
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
    const placement = String(stats.placement ?? '')
      .trim()
      .toLowerCase()

    // Arcane Shield: 4 destructible LOS blockers on the caster-facing side of target.
    if (placement === 'front_of_target') {
      const want = Math.max(1, Math.floor(asFinite(stats.summon_count) ?? 4))
      const targetStack =
        (aim?.targetId
          ? battle.stacks.find((row) => row.id === aim.targetId)
          : null) ??
        battle.stacks.find(
          (row) =>
            row.qty > 0 &&
            row.side !== casterSide &&
            row.q === aim?.hex.q &&
            row.r === aim?.hex.r,
        ) ??
        null
      if (!targetStack || targetStack.qty <= 0) {
        return {
          battle,
          lines: [`${ability.name} needs an enemy target.`],
          flashes: [],
        }
      }
      const casterOrigin =
        battle.stacks.find((row) => row.side === casterSide && isHeroStack(row)) ??
        ({ q: targetStack.q - 1, r: targetStack.r } as Axial)
      const spots = frontOfTargetOpenHexes(
        battle,
        catalog,
        tiles,
        casterSide,
        unit,
        { q: targetStack.q, r: targetStack.r },
        { q: casterOrigin.q, r: casterOrigin.r },
        want,
      )
      let next = battle
      const lines: string[] = []
      const flashes: SummonResolve['flashes'] = []
      let placed = 0
      for (const hex of spots) {
        const spawned = spawnSummonedStack(
          next,
          catalog,
          tiles,
          ability,
          unit,
          1,
          persists,
          casterSide,
          hex,
          { spawnedRound: next.round },
          insertQueue,
        )
        next = spawned.battle
        flashes.push(...spawned.flashes)
        placed += 1
      }
      if (placed === 0) {
        return {
          battle,
          lines: [`${ability.name} found no open hexes in front of the target.`],
          flashes: [],
        }
      }
      lines.push(
        `${ability.name}: placed ${placed} ${blockerLabel(unit.name, placed)}.`,
      )
      return { battle: next, lines, flashes }
    }

    // Illusions: N separate 1-unit stacks scattered toward map center.
    if (
      placement === 'map_center_scattered' ||
      stats.summon_as_separate_stacks === true
    ) {
      const qtyDiv = asFinite(stats.summon_qty_stat_div)
      const count =
        qtyDiv != null && qtyDiv > 0
          ? Math.max(0, Math.floor(scaleStat / qtyDiv))
          : Math.max(0, Math.floor(asFinite(stats.summon_count) ?? 0))
      if (count <= 0) {
        return {
          battle,
          lines: [`${ability.name} raised 0.`],
          flashes: [],
        }
      }
      let next = battle
      const flashes: SummonResolve['flashes'] = []
      let placed = 0
      for (let i = 0; i < count; i += 1) {
        const hex =
          placement === 'map_center_scattered'
            ? pickNearCenterOpenHex(next, catalog, tiles, casterSide, unit, random)
            : pickRandomOpenHex(next, catalog, tiles, casterSide, unit, random)
        if (!hex) {
          break
        }
        const spawned = spawnSummonedStack(
          next,
          catalog,
          tiles,
          ability,
          unit,
          1,
          persists,
          casterSide,
          hex,
          { spawnedRound: next.round },
          insertQueue,
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
      return {
        battle: next,
        lines: [`${ability.name}: ${placed} ${unit.name} appear.`],
        flashes,
      }
    }

    if (isRandomPlacementSummon(stats)) {
      const count = Math.max(1, Math.floor(asFinite(stats.summon_count) ?? 1))
      const schedule = asIntList(stats.bolt_schedule)
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
      insertQueue,
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

  // Reinforce any living stack with summon_tag (first by army slot, then id).
  const tagged = livingTaggedStacks(battle, catalog, casterSide, summonTag)
  if (tagged.length > 0) {
    const target = tagged[0]!
    const name = unitById(catalog, target.unitId)?.name ?? 'stack'
    return {
      battle: {
        ...battle,
        stacks: battle.stacks.map((row) =>
          row.id === target.id
            ? {
                ...row,
                qty: row.qty + qty,
                startingQty: row.startingQty + qty,
              }
            : row,
        ),
      },
      lines: [`${ability.name}: ${qty} reinforce ${name}.`],
      flashes: [
        { keys: [occupancyKey(target.q, target.r)], color: 'green' },
      ],
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

/** Mirror Image: duplicate a friendly stack with INT-capped HP. */
export function applyMirrorImage(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  ability: AbilityRow,
  stats: Record<string, unknown>,
  caster: Hero,
  casterSide: CombatSide,
  target: CombatStack,
): SummonResolve {
  if (
    target.qty <= 0 ||
    target.side !== casterSide ||
    isHeroStack(target)
  ) {
    return {
      battle,
      lines: [`${ability.name} needs a friendly stack.`],
      flashes: [],
    }
  }
  const unit = unitById(catalog, target.unitId)
  if (!unit) {
    return {
      battle,
      lines: [`${ability.name} raised 0.`],
      flashes: [],
    }
  }
  const hex = nearestOpenHexTo(
    battle,
    catalog,
    tiles,
    casterSide,
    unit,
    { q: target.q, r: target.r },
  )
  if (!hex) {
    return {
      battle,
      lines: [`${ability.name} found no space on the field.`],
      flashes: [],
    }
  }
  const heroStats = heroEffectiveStats(
    catalog,
    caster.class_id,
    caster.current_level,
  )
  const maxHp = stackMaxHealth(target, catalog)
  const topHealth =
    mirrorImageTopHealth(heroStats.intel, stats, maxHp) ??
    Math.max(1, maxHp)
  const persists = stats.persists_on_summon === true
  const insertQueue = stats.insert_into_current_round_queue === true
  const spawned = spawnSummonedStack(
    battle,
    catalog,
    tiles,
    ability,
    unit,
    target.qty,
    persists,
    casterSide,
    hex,
    {
      spawnedRound: battle.round,
      topHealth,
      // Fresh duplicate — unit abilities come from catalog; no inherited buffs.
    },
    insertQueue,
  )
  return {
    battle: spawned.battle,
    lines: [
      `${ability.name}: mirrored ${target.qty} ${unit.name} (${topHealth}/${maxHp} HP).`,
    ],
    flashes: spawned.flashes,
  }
}

/**
 * Place Ice Shard blockers in the 6 hexes around `around`. Occupied neighbors
 * are skipped. With one occupied neighbor, the leftover empty ring hexes still
 * receive up to `summon_count` shards (redistribution). With two+ occupied,
 * place at most one per remaining empty hex (fewer than summon_count).
 */
export function applyIceShardPlacement(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  ability: AbilityRow,
  stats: Record<string, unknown>,
  around: Axial,
  casterSide: CombatSide,
  random: () => number = Math.random,
): SummonResolve {
  const unitId = Math.floor(asFinite(stats.summon_unit_id) ?? 0)
  const want = Math.max(0, Math.floor(asFinite(stats.summon_count) ?? 0))
  const unit = unitId > 0 ? unitById(catalog, unitId) : null
  if (!unit || want <= 0) {
    return { battle, lines: [], flashes: [] }
  }
  const persists = stats.persists_on_summon === true
  const neighbors = neighborHexes(around)
  const board = new Set(tiles.map((tile) => occupancyKey(tile.q, tile.r)))
  const empty: Axial[] = []
  let occupiedCount = 0
  for (const hex of neighbors) {
    const key = occupancyKey(hex.q, hex.r)
    if (!board.has(key)) {
      occupiedCount += 1
      continue
    }
    const body =
      stackOccupyingHex(battle.stacks, hex.q, hex.r, catalog) ??
      battle.stacks.find((row) => row.q === hex.q && row.r === hex.r) ??
      null
    if (body) {
      occupiedCount += 1
      continue
    }
    empty.push(hex)
  }
  // One occupied → redistribute into remaining empties (up to want).
  // Two+ occupied → no extra redistribution beyond empty slots (same formula).
  let placeCount = Math.min(want, empty.length)
  // Never seal the target: keep ≥1 adjacent hex open after shards land.
  if (empty.length > 0 && placeCount >= empty.length) {
    placeCount = empty.length - 1
  }
  let next = battle
  const lines: string[] = []
  const flashes: SummonResolve['flashes'] = []
  const remaining = [...empty]
  const proposed = permanentBlockKeys(battle)
  let placed = 0
  let attempts = 0
  const maxAttempts = remaining.length * 4
  while (placed < placeCount && remaining.length > 0 && attempts < maxAttempts) {
    attempts += 1
    const idx = Math.min(
      remaining.length - 1,
      Math.floor(random() * remaining.length),
    )
    const pick = remaining.splice(idx, 1)[0]
    if (!pick) {
      break
    }
    const key = occupancyKey(pick.q, pick.r)
    const trial = new Set(proposed)
    trial.add(key)
    if (!blockerPlacementKeepsEscapeRoutes(next, catalog, tiles, trial)) {
      continue
    }
    const spawned = spawnSummonedStack(
      next,
      catalog,
      tiles,
      ability,
      unit,
      1,
      persists,
      casterSide,
      pick,
      {
        spawnedRound: next.round,
        indestructible: true,
      },
    )
    next = spawned.battle
    flashes.push(...spawned.flashes)
    proposed.add(key)
    placed += 1
  }
  if (placed > 0) {
    lines.push(
      `${ability.name}: placed ${placed} ${blockerLabel(unit.name, placed)}.`,
    )
  }
  return { battle: next, lines, flashes }
}

/**
 * Place up to `summon_count` blockers on open hexes inside `radius` of `center`
 * (Earth Spikes). Skips occupied hexes; no redistribution beyond empty slots.
 */
export function applyRadiusBlockerPlacement(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  ability: AbilityRow,
  stats: Record<string, unknown>,
  center: Axial,
  casterSide: CombatSide,
  random: () => number = Math.random,
): SummonResolve {
  const unitId = Math.floor(asFinite(stats.summon_unit_id) ?? 0)
  const want = Math.max(0, Math.floor(asFinite(stats.summon_count) ?? 0))
  const radius = Math.max(0, Math.floor(asFinite(stats.radius) ?? 0))
  const unit = unitId > 0 ? unitById(catalog, unitId) : null
  if (!unit || want <= 0 || radius < 0) {
    return { battle, lines: [], flashes: [] }
  }
  const persists = stats.persists_on_summon === true
  const occupied = occupiedHexes(
    battle.stacks,
    catalog,
    undefined,
    tombstoneOccupancyBodies(battle.tombstones),
  )
  const open: Axial[] = []
  for (const tile of tiles) {
    if (hexDistance(center, { q: tile.q, r: tile.r }) > radius) {
      continue
    }
    const key = occupancyKey(tile.q, tile.r)
    if (occupied.has(key)) {
      continue
    }
    open.push({ q: tile.q, r: tile.r })
  }
  const placeCount = Math.min(want, open.length)
  let next = battle
  const lines: string[] = []
  const flashes: SummonResolve['flashes'] = []
  const remaining = [...open]
  const proposed = permanentBlockKeys(battle)
  let placed = 0
  let attempts = 0
  const maxAttempts = remaining.length * 4
  while (placed < placeCount && remaining.length > 0 && attempts < maxAttempts) {
    attempts += 1
    const idx = Math.min(
      remaining.length - 1,
      Math.floor(random() * remaining.length),
    )
    const pick = remaining.splice(idx, 1)[0]
    if (!pick) {
      break
    }
    const key = occupancyKey(pick.q, pick.r)
    const trial = new Set(proposed)
    trial.add(key)
    if (!blockerPlacementKeepsEscapeRoutes(next, catalog, tiles, trial)) {
      continue
    }
    const spawned = spawnSummonedStack(
      next,
      catalog,
      tiles,
      ability,
      unit,
      1,
      persists,
      casterSide,
      pick,
      {
        spawnedRound: next.round,
        indestructible: true,
      },
    )
    next = spawned.battle
    flashes.push(...spawned.flashes)
    proposed.add(key)
    placed += 1
  }
  if (placed > 0) {
    lines.push(
      `${ability.name}: raised ${placed} ${blockerLabel(unit.name, placed)}.`,
    )
  }
  return { battle: next, lines, flashes }
}

/**
 * Shaman S7-8: Fire/Lightning/Nature Totems.
 * - Battle start (`fillToCap`): spawn every missing totem up to the INT cap,
 *   placed behind the army (not map center).
 * - Later rounds: spawn up to `totem_spawn_per_round` (usually 1) to replace
 *   destroyed totems, still behind the army.
 */
export function applyShamanBattleStartTotems(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  heroes: { atk?: Hero; def?: Hero },
  random: () => number = Math.random,
  opts?: { fillToCap?: boolean },
): { battle: CombatBattle; lines: string[] } {
  const sides: CombatSide[] = ['atk', 'def']
  let next = battle
  const lines: string[] = []
  const stubAbility = {
    id: 0,
    name: 'Shaman Totems',
  } as AbilityRow
  const fillToCap = opts?.fillToCap === true

  for (const side of sides) {
    const hero = heroes[side]
    if (!hero || !isHeroClass(catalog, hero, 'Shaman')) {
      continue
    }
    const want = shamanTotemCount(catalog, hero)
    const live = next.stacks.filter(
      (row) => row.side === side && isShamanTotemStack(catalog, row),
    ).length
    const missing = Math.max(0, want - live)
    if (missing <= 0) {
      continue
    }
    const spawnCap = fillToCap
      ? missing
      : shamanTotemSpawnPerRound(catalog, hero)
    const toSpawn = Math.min(missing, Math.max(0, spawnCap))
    if (toSpawn <= 0) {
      continue
    }
    const pool = shamanTotemUnitPool(catalog, hero)
    if (pool.length === 0) {
      continue
    }
    const intel = heroEffectiveStats(
      catalog,
      hero.class_id,
      hero.current_level ?? 1,
    ).intel
    const units = pickTotemUnitsForSpawn(pool, toSpawn, random, fillToCap)
    let spawned = 0
    for (const unit of units) {
      const hex = pickBehindArmyOpenHex(
        next,
        catalog,
        tiles,
        side,
        unit,
        random,
      )
      if (!hex) {
        break
      }
      const result = spawnSummonedStack(
        next,
        catalog,
        tiles,
        stubAbility,
        unit,
        1,
        false,
        side,
        hex,
        totemSpawnExtras(unit, intel),
        true,
      )
      next = result.battle
      spawned += 1
    }
    if (spawned > 0) {
      lines.push(
        `Shaman: ${spawned} totem${spawned === 1 ? '' : 's'} rise${spawned === 1 ? 's' : ''} (${live + spawned}/${want}).`,
      )
    }
  }
  return { battle: next, lines }
}

function shamanTotemUnitPool(
  catalog: ReferenceCatalog,
  hero: Hero,
): UnitRow[] {
  const stats = requirePassiveStats(catalog, hero, 'Shaman totems')
  const rawTypes = passiveStatStringList(stats, 'totem_types')
  const names: TotemUnitName[] =
    rawTypes.length > 0
      ? rawTypes
          .map(totemTypeToUnitName)
          .filter((name): name is TotemUnitName => name != null)
      : ['Fire Totem', 'Lightning Totem', 'Nature Totem']
  const unique = [...new Set(names)]
  const pool: UnitRow[] = []
  for (const name of unique) {
    const unit = totemUnitByName(catalog, name)
    if (unit) {
      pool.push(unit)
    }
  }
  return pool
}

/**
 * Shaman S7-8: each surviving Nature totem heals the most-injured army stack
 * for INT × nature_heal_multiplier (sequential; re-picks target after each heal).
 * Destroyed mid-round totems do not contribute.
 */
export function applyShamanEndOfRoundNatureHeals(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  heroes: CombatHeroes | undefined,
): { battle: CombatBattle; lines: string[]; healKeys: string[] } {
  let next = battle
  const lines: string[] = []
  const healKeys: string[] = []
  for (const side of ['atk', 'def'] as const) {
    const hero = heroForSide(side, heroes)
    if (!hero || !isHeroClass(catalog, hero, 'Shaman')) {
      continue
    }
    const stats = requirePassiveStats(catalog, hero, 'Shaman Nature totems')
    if (!stats) {
      continue
    }
    const healSource =
      passiveStatString(stats, 'nature_heal_stat_source') ?? 'INT'
    const healMult = passiveStatNumber(stats, 'nature_heal_multiplier')
    if (healMult == null) {
      missingPassiveStatKey(
        catalog,
        hero,
        'nature_heal_multiplier',
        'Shaman Nature totems',
      )
      continue
    }
    const amount = Math.max(
      0,
      Math.floor(passiveStatSourceValue(catalog, hero, healSource) * healMult),
    )
    if (amount <= 0) {
      continue
    }
    // Spawn-order: stacks array append order (stable across the round).
    const natureTotems = next.stacks.filter(
      (row) => row.side === side && isNatureTotemStack(catalog, row),
    )
    for (const totem of natureTotems) {
      // Must still be alive at end-of-round resolution.
      const liveTotem = next.stacks.find((row) => row.id === totem.id)
      if (!liveTotem || liveTotem.qty <= 0) {
        continue
      }
      const target = pickMostInjuredDamagedCreature(
        next.stacks,
        catalog,
        side,
      )
      if (!target) {
        lines.push('Nature Totem: No one in range needs heal')
        break
      }
      const full = stackMaxHealth(target, catalog)
      const need = frontDeficit(target, catalog)
      const spend = Math.min(amount, need)
      if (spend <= 0) {
        lines.push('Nature Totem: No one in range needs heal')
        break
      }
      const live = next.stacks.find((row) => row.id === target.id) ?? target
      const healed = applyStackHeal(live, spend, full)
      if (healed.healed <= 0) {
        continue
      }
      next = {
        ...next,
        stacks: next.stacks.map((row) =>
          row.id === live.id ? healed.stack : row,
        ),
      }
      healKeys.push(occupancyKey(live.q, live.r))
      const name = unitById(catalog, healed.stack.unitId)?.name ?? 'unit'
      lines.push(
        `Nature Totem: healed ${healed.stack.qty} ${name} for ${healed.healed}.`,
      )
    }
  }
  return {
    battle: next,
    lines,
    healKeys: [...new Set(healKeys)],
  }
}
