import type { Axial } from '../hex/hero'
import { hexDistance, neighborHexes } from '../hex/pathfinding'
import type { Hero } from '../session/types'
import {
  commandingHeroStats,
  unitById,
  unitFootprint,
  type ReferenceCatalog,
  type UnitCombatAbilities,
  type UnitRow,
} from '../town/catalog'
import { heroStatValueByStatId } from '../town/statCatalog'
import { sameUpgradeBranch } from '../town/unitUpgrade'
import { heroForSide, type CombatHeroes } from './attack'
import type { CombatBattle, CombatSide, CombatStack, CombatTile } from './battle'
import { isHeroStack } from './battle'
import { combatCanLandOn, combatEnterCost, moveKindForUnit } from './movement'
import { footprintFits, footprintAlong, occupiedHexes } from './occupancy'
import { tombstoneOccupancyBodies } from './tombstone'
import { spawnSummonedStack } from './summon'

const STUB_SUMMON_ABILITY = {
  id: 0,
  name: 'Summon on kill',
  description: '',
  discipline_id: 0,
  level_id: 1,
  resource_id: 0,
  cost: 0,
  cooldown_id: 0,
  target_id: null,
  ability_type_id: null,
  stats: null,
}

export function unitHasSummonOnKill(spec: UnitCombatAbilities): boolean {
  return (
    spec.summonOnKillUnitId != null &&
    spec.summonOnKillUnitId > 0 &&
    spec.summonOnKillStatDiv != null &&
    spec.summonOnKillStatDiv > 0
  )
}

export function summonOnKillQty(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  spec: UnitCombatAbilities,
  killsThisAttack: number,
): number {
  if (killsThisAttack <= 0 || !unitHasSummonOnKill(spec)) {
    return 0
  }
  const div = spec.summonOnKillStatDiv ?? 1
  const stats = commandingHeroStats(catalog, hero ?? null)
  const statVal = heroStatValueByStatId(
    catalog,
    stats,
    spec.summonOnKillStat,
  )
  const perKill = Math.max(1, Math.floor(statVal / div))
  return perKill * killsThisAttack
}

function isAdjacent(a: Axial, b: Axial): boolean {
  return hexDistance(a, b) === 1
}

function anchorHexes(
  summoner: CombatStack,
  killHexes: Axial[],
): Axial[] {
  const seen = new Set<string>()
  const out: Axial[] = []
  const push = (hex: Axial) => {
    const key = `${hex.q},${hex.r}`
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    out.push(hex)
  }
  for (const hex of killHexes) {
    push(hex)
  }
  push({ q: summoner.q, r: summoner.r })
  return out
}

/** Summoned id or base/advanced partner (same town, tier, class). */
function reinforcesSummonUnit(
  catalog: ReferenceCatalog,
  summonUnit: UnitRow,
  stackUnitId: number,
): boolean {
  if (stackUnitId === summonUnit.id) {
    return true
  }
  const stackUnit = unitById(catalog, stackUnitId)
  if (!stackUnit) {
    return false
  }
  return sameUpgradeBranch(summonUnit, stackUnit)
}

function findReinforceStack(
  catalog: ReferenceCatalog,
  stacks: CombatStack[],
  side: CombatSide,
  summonUnit: UnitRow,
  summoner: CombatStack,
  killHexes: Axial[],
): CombatStack | null {
  const anchors = anchorHexes(summoner, killHexes)
  const candidates = stacks
    .filter(
      (row) =>
        row.side === side &&
        row.qty > 0 &&
        !isHeroStack(row) &&
        reinforcesSummonUnit(catalog, summonUnit, row.unitId),
    )
    .sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id))
  for (const stack of candidates) {
    const pos = { q: stack.q, r: stack.r }
    if (anchors.some((hex) => isAdjacent(pos, hex))) {
      return stack
    }
  }
  return null
}

function openAdjacentHex(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  side: CombatSide,
  unit: UnitRow,
  summoner: CombatStack,
  killHexes: Axial[],
): Axial | null {
  const occupied = occupiedHexes(
    battle.stacks,
    catalog,
    undefined,
    tombstoneOccupancyBodies(battle.tombstones),
  )
  const kind = moveKindForUnit(unit, catalog)
  const enterCost = (q: number, r: number) => {
    const tile = tiles.find((row) => row.q === q && row.r === r)
    if (!combatCanLandOn(tile, kind)) {
      return null
    }
    return combatEnterCost(tile, kind)
  }
  const code = unitFootprint(unit)
  const along = footprintAlong(side)
  const preferKill = killHexes.length > 0
  const anchorList = preferKill
    ? killHexes
    : [{ q: summoner.q, r: summoner.r }]
  const fallback =
    preferKill ? [{ q: summoner.q, r: summoner.r }] : []
  for (const anchor of [...anchorList, ...fallback]) {
    for (const n of neighborHexes(anchor)) {
      if (
        footprintFits(n, code, along, occupied, enterCost)
      ) {
        return n
      }
    }
  }
  return null
}

export function applySummonOnKillFromAttack(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  summoner: CombatStack,
  spec: UnitCombatAbilities,
  killsThisAttack: number,
  killHexes: Axial[],
  heroes: CombatHeroes | undefined,
): { battle: CombatBattle; lines: string[] } {
  if (!unitHasSummonOnKill(spec) || killsThisAttack <= 0) {
    return { battle, lines: [] }
  }
  const summonUnitId = spec.summonOnKillUnitId!
  const summonedUnit = unitById(catalog, summonUnitId)
  if (!summonedUnit) {
    return { battle, lines: [] }
  }
  const qty = summonOnKillQty(
    catalog,
    heroForSide(summoner.side, heroes),
    spec,
    killsThisAttack,
  )
  if (qty <= 0) {
    return { battle, lines: [] }
  }
  const summonerName =
    unitById(catalog, summoner.unitId)?.name ?? 'Unit'
  const summonedName = summonedUnit.name
  const logLine = `${summonerName} raised ${qty} ${summonedName}`

  const reinforce = findReinforceStack(
    catalog,
    battle.stacks,
    summoner.side,
    summonedUnit,
    summoner,
    killHexes,
  )
  if (reinforce) {
    return {
      battle: {
        ...battle,
        stacks: battle.stacks.map((row) =>
          row.id === reinforce.id
            ? {
                ...row,
                qty: row.qty + qty,
                startingQty: row.startingQty + qty,
              }
            : row,
        ),
      },
      lines: [logLine],
    }
  }

  const hex = openAdjacentHex(
    battle,
    catalog,
    tiles,
    summoner.side,
    summonedUnit,
    summoner,
    killHexes,
  )
  if (!hex) {
    return { battle, lines: [] }
  }
  const spawned = spawnSummonedStack(
    battle,
    catalog,
    tiles,
    STUB_SUMMON_ABILITY,
    summonedUnit,
    qty,
    false,
    summoner.side,
    hex,
    { spawnedRound: battle.round },
    false,
    { omitDefaultLog: true },
  )
  return {
    battle: spawned.battle,
    lines: spawned.battle === battle ? [] : [logLine],
  }
}
