import type { Axial } from '../hex/hero'
import type { Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import {
  heroEffectiveStats,
  terrainByName,
  unitAttackShape,
  unitById,
} from '../town/catalog'
import type { CombatBattle, CombatSide, CombatStack, CombatTile } from './battle'
import { isHeroStack } from './battle'
import { chanceRollLog, rollChancePct } from './combatLog'
import { placeStormOnHexKeys } from './groundEffect'
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

/** Mud Sprite: +qty when entering / standing on matching terrain. */
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
  const terrainId = spec.terrainGrowthTerrainTypeId
  const amount = spec.terrainGrowthAmount
  if (terrainId == null || terrainId <= 0 || amount == null || amount <= 0) {
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
    const terrain = terrainByName(catalog, tile.terrain)
    return terrain?.id === terrainId
  })
  if (!onTerrain) {
    return { battle, lines: [] }
  }
  const gain = Math.max(1, Math.floor(amount))
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
  const templateId = spec.groundEffectId ?? 7
  const caster = heroForSide(stack.side, heroes)
  if (!caster) {
    return { battle, lines: [] }
  }
  const intel = heroEffectiveStats(
    catalog,
    caster.class_id,
    caster.current_level,
  ).intel
  const chanceMult = spec.chancePctIntelStat ?? 4
  const chance = Math.min(100, Math.max(0, Math.floor(intel * chanceMult)))
  const radius = Math.max(0, spec.radius ?? 2)
  const board = new Set(tiles.map((tile) => occupancyKey(tile.q, tile.r)))
  const hexes = hexDisk({ q: stack.q, r: stack.r }, radius).filter((hex) =>
    board.has(occupancyKey(hex.q, hex.r)),
  )
  const label = unitById(catalog, stack.unitId)?.name ?? 'Tempest'
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
    chanceRollLog(label, chance, hits > 0, {
      detail: `INT ${intel} × ${chanceMult}`,
      action: 'Storm scatter per hex',
      success: `${hits}/${attempted} hexes.`,
      fail: `0/${attempted} hexes.`,
    }),
  ]
  if (keys.length === 0 || templateId !== 7) {
    // Only Storm is implemented for move-stop scatter.
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
    const intel = caster
      ? heroEffectiveStats(catalog, caster.class_id, caster.current_level)
          .intel
      : 0
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
        detail: `INT ${intel}/${div} × ${killedThisRound} deaths`,
        action: 'to self-resurrect',
        success: 'risen!',
        fail: 'did not trigger — tombstone remains.',
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
  if (chancePctIntelStat != null && chancePctIntelStat > 0 && caster) {
    const intel = heroEffectiveStats(
      catalog,
      caster.class_id,
      caster.current_level,
    ).intel
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
