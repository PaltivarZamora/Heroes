import type { Axial } from '../hex/hero'
import type { Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import {
  commandingHeroStats,
  hexTerrainByName,
  unitAttackShape,
  unitById,
} from '../town/catalog'
import type { CombatBattle, CombatSide, CombatStack, CombatTile } from './battle'
import { isHeroStack } from './battle'
import { chanceRollLog, rollChancePct } from './combatLog'
import { placeStormOnHexKeys, STORM_GROUND_EFFECT_ID } from './groundEffect'
import { occupancyKey, stackFootprint } from './occupancy'
import { hexDisk } from './shapes'
import { syncTombstonesFromWipes } from './tombstone'

export type ConfluenceHeroes = { atk?: Hero; def?: Hero }

function heroForSide(
  side: CombatSide,
  heroes: ConfluenceHeroes | undefined,
): Hero | undefined {
  if (!heroes) {
    return undefined
  }
  return side === 'atk' ? heroes.atk : heroes.def
}

/** Mud Sprite: at turn-start only, if standing on absorb terrains, +floor(qty/10) (min 1). */
export function applyTerrainGrowth(
  battle: CombatBattle,
  stackId: string,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): { battle: CombatBattle; lines: string[] } {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || stack.qty <= 0 || isHeroStack(stack) || stack.indestructible) {
    return { battle, lines: [] }
  }
  const spec = unitAttackShape(unitById(catalog, stack.unitId))
  const absorbIds = new Set(
    (spec.absorbTerrainIds ?? []).filter((id) => id > 0),
  )
  if (absorbIds.size === 0) {
    return { battle, lines: [] }
  }
  const byKey = new Map(
    tiles.map((tile) => [occupancyKey(tile.q, tile.r), tile]),
  )
  const onTerrain = stackFootprint(stack, catalog).some((hex) => {
    const tile = byKey.get(occupancyKey(hex.q, hex.r))
    if (!tile) {
      return false
    }
    const terrain = hexTerrainByName(catalog, tile.terrain)
    return terrain != null && absorbIds.has(terrain.id)
  })
  if (!onTerrain) {
    return { battle, lines: [] }
  }
  const gain = Math.max(1, Math.floor(stack.qty / 10))
  const next: CombatStack = {
    ...stack,
    qty: stack.qty + gain,
    startingQty: stack.startingQty + gain,
  }
  const name = unitById(catalog, stack.unitId)?.name ?? 'Unknown'
  return {
    battle: {
      ...battle,
      stacks: battle.stacks.map((row) => (row.id === stackId ? next : row)),
    },
    lines: [
      `${name}: +${gain} from terrain growth (now ${next.qty}).`,
    ],
  }
}

/**
 * Tempest: after move stops, intel×chancePctIntelStat % independently per hex
 * in attack radius to place Storm.
 */
export function tryTempestStormScatter(
  battle: CombatBattle,
  stackId: string,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  heroes: ConfluenceHeroes | undefined,
  random: () => number = Math.random,
): { battle: CombatBattle; tiles?: CombatTile[]; lines: string[] } {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || stack.qty <= 0 || isHeroStack(stack)) {
    return { battle, lines: [] }
  }
  const spec = unitAttackShape(unitById(catalog, stack.unitId))
  if (spec.scatterGroundEffectOnMoveStop !== true) {
    return { battle, lines: [] }
  }
  const templateId = spec.groundEffectId ?? STORM_GROUND_EFFECT_ID
  const label = unitById(catalog, stack.unitId)?.name ?? 'Tempest'
  const caster = heroForSide(stack.side, heroes)
  const intel = commandingHeroStats(catalog, caster).intel
  const chanceMult = spec.chancePctIntelStat ?? 4
  const chance = Math.min(100, Math.max(0, Math.floor(intel * chanceMult)))
  const radius = Math.max(0, spec.radius ?? 2)
  const board = new Set(tiles.map((tile) => occupancyKey(tile.q, tile.r)))
  const hexes = hexDisk({ q: stack.q, r: stack.r }, radius).filter((hex) =>
    board.has(occupancyKey(hex.q, hex.r)),
  )
  let attempted = 0
  let hits = 0
  const keys: string[] = []
  for (const hex of hexes) {
    attempted += 1
    if (!rollChancePct(chance, random)) {
      continue
    }
    hits += 1
    keys.push(occupancyKey(hex.q, hex.r))
  }
  const lines = [
    `${label} dropped Storm ${hits}/${attempted} times` +
      (chance < 100
        ? ` (${chance}% per hex, INT ${intel} × ${chanceMult}).`
        : '.'),
  ]
  if (keys.length === 0) {
    return { battle, lines }
  }
  if (templateId !== STORM_GROUND_EFFECT_ID) {
    return { battle, lines }
  }
  const storm = placeStormOnHexKeys(
    battle,
    catalog,
    caster,
    stack.side,
    keys,
    tiles,
  )
  return {
    battle: storm.battle,
    tiles: storm.tiles,
    lines,
  }
}

/**
 * Phoenix: on full wipe, roll (intel/div)×(deaths this round)% capped at
 * selfRezCapPct. Success restores the pre-wipe stack; failure leaves a
 * tombstone via the normal wipe sync.
 */
export function applySelfRezThenTombstones(
  before: CombatBattle,
  after: CombatBattle,
  catalog: ReferenceCatalog,
  heroes: ConfluenceHeroes | undefined,
  random: () => number = Math.random,
): { battle: CombatBattle; lines: string[] } {
  const stillLive = new Set(after.stacks.map((row) => row.id))
  const lines: string[] = []
  let stacks = [...after.stacks]
  let roundDeaths = { ...(after.roundUnitDeaths ?? before.roundUnitDeaths ?? {}) }
  let unitDeaths = { ...(after.unitDeaths ?? before.unitDeaths ?? {}) }

  for (const stack of before.stacks) {
    if (stillLive.has(stack.id) || stack.qty <= 0 || isHeroStack(stack)) {
      continue
    }
    const spec = unitAttackShape(unitById(catalog, stack.unitId))
    if (spec.selfRezOnWipe !== true) {
      continue
    }
    const div = Math.max(1, spec.selfRezChanceStatDiv ?? 3)
    const cap = Math.min(100, Math.max(0, spec.selfRezCapPct ?? 90))
    const caster = heroForSide(stack.side, heroes)
    const intel = commandingHeroStats(catalog, caster).intel
    const killedThisRound = Math.max(
      1,
      roundDeaths[stack.unitId] ?? stack.qty,
    )
    const raw =
      spec.selfRezBasedOnKillsThisRound === true
        ? Math.floor(intel / div) * killedThisRound
        : Math.floor(intel / div)
    const chance = Math.min(cap, Math.max(0, raw))
    const name = unitById(catalog, stack.unitId)?.name ?? 'Phoenix'
    const triggered = rollChancePct(chance, random)
    lines.push(
      chanceRollLog(name, chance, triggered, {
        detail: `INT ${intel} / ${div} × ${killedThisRound} deaths this round`,
        action: 'to self-resurrect',
        success: 'triggered!',
        fail: 'did not trigger.',
      }),
    )
    if (!triggered) {
      continue
    }
    const full = Math.max(
      1,
      unitById(catalog, stack.unitId)?.health ?? stack.topHealth,
    )
    const restored: CombatStack = {
      ...stack,
      qty: Math.max(1, stack.qty),
      topHealth: full,
      hasActedThisRound: true,
      retaliationsLeft: 0,
    }
    stacks.push(restored)
    stillLive.add(stack.id)
    lines.push(`${name}: risen (${restored.qty})!`)
  }

  const withStacks: CombatBattle = {
    ...after,
    stacks,
    unitDeaths,
    roundUnitDeaths: roundDeaths,
  }
  return {
    battle: syncTombstonesFromWipes(before, withStacks, catalog),
    lines,
  }
}

/** Chance% = hero.intel × chancePctIntelStat (Thunder Lizard / Tempest). */
export function leaveBehindChancePct(
  catalog: ReferenceCatalog,
  caster: Hero | null | undefined,
  chancePct: number | null,
  chancePctIntelStat: number | null,
): number {
  if (chancePctIntelStat != null && chancePctIntelStat > 0) {
    const intel = commandingHeroStats(catalog, caster).intel
    return Math.min(100, Math.max(0, Math.floor(intel * chancePctIntelStat)))
  }
  if (chancePct != null && chancePct > 0) {
    return Math.min(100, Math.floor(chancePct))
  }
  return 100
}

export function diskKeysAround(at: Axial, radius: number): string[] {
  return hexDisk(at, radius).map((hex) => occupancyKey(hex.q, hex.r))
}
