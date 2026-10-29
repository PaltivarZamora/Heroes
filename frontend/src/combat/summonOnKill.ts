import type { Axial } from '../hex/hero'
import { hexDistance, neighborHexes } from '../hex/pathfinding'
import type { Hero } from '../session/types'
import {
  addHeroStackQty,
  insertHeroArmyStack,
  nextUnitStackId,
} from '../session/accessors'
import { ARMY_STACK_SLOTS, type GameSession } from '../session/types'
import {
  commandingHeroStats,
  retaliationCharges,
  unitById,
  unitFootprint,
  unitTakesTurns,
  type ReferenceCatalog,
  type UnitCombatAbilities,
  type UnitRow,
} from '../town/catalog'
import { heroStatValueByStatId } from '../town/statCatalog'
import { sameUpgradeBranch } from '../town/unitUpgrade'
import { heroForSide, type CombatHeroes } from './attack'
import type { CombatBattle, CombatSide, CombatStack, CombatTile } from './battle'
import { insertIntoRemainingInitiative, isHeroStack } from './battle'
import { combatCanLandOn, combatEnterCost, moveKindForUnit } from './movement'
import { footprintFits, footprintAlong, occupiedHexes } from './occupancy'
import { tombstoneOccupancyBodies } from './tombstone'

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

function nextKillSpawnId(stacks: CombatStack[], side: CombatSide): string {
  let n = 1
  while (stacks.some((row) => row.id === `combat-${side}-killspawn-${n}`)) {
    n += 1
  }
  return `combat-${side}-killspawn-${n}`
}

function nextOverflowSlot(battle: CombatBattle, side: CombatSide): number {
  let slot = ARMY_STACK_SLOTS
  const taken = new Set(
    battle.stacks.filter((row) => row.side === side).map((row) => row.slot),
  )
  while (taken.has(slot)) {
    slot += 1
  }
  return slot
}

function spawnSummonOnKillStack(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  side: CombatSide,
  unit: UnitRow,
  qty: number,
  hex: Axial,
): CombatBattle {
  const id = nextKillSpawnId(battle.stacks, side)
  const summoned: CombatStack = {
    id,
    side,
    slot: nextOverflowSlot(battle, side),
    unitId: unit.id,
    qty,
    topHealth: Math.max(1, unit.health),
    startingQty: qty,
    q: hex.q,
    r: hex.r,
    hasActedThisRound: false,
    retaliationsLeft: retaliationCharges(unit),
    fromSummonOnKill: true,
    spawnedRound: battle.round,
    startHex: { q: hex.q, r: hex.r },
  }
  let order = battle.order
  if (unitTakesTurns(unit) && !order.includes(id)) {
    order = [...order, id]
  }
  let next: CombatBattle = {
    ...battle,
    stacks: [...battle.stacks, summoned],
    order,
  }
  if (unitTakesTurns(unit)) {
    next = insertIntoRemainingInitiative(next, catalog, id)
  }
  return next
}

function occupiedArmySlots(hero: { army: { slots_1_to_6: Array<string | null> } }): number {
  return hero.army.slots_1_to_6.filter((id) => id != null && id !== '').length
}

function firstOpenArmySlot(hero: {
  army: { slots_1_to_6: Array<string | null> }
}): number | null {
  const slots = [...hero.army.slots_1_to_6]
  while (slots.length < ARMY_STACK_SLOTS) {
    slots.push(null)
  }
  const index = slots.findIndex((id) => id == null)
  return index >= 0 ? index : null
}

function matchingArmyStackIdForUnit(
  session: GameSession,
  hero: Hero,
  summonUnit: UnitRow,
  catalog: ReferenceCatalog,
): string | null {
  for (const id of hero.army.slots_1_to_6) {
    if (!id) {
      continue
    }
    const row = session.units.find((unit) => unit.id === id)
    const armyUnit = row ? unitById(catalog, row.unit_id) : null
    if (row && armyUnit && sameUpgradeBranch(summonUnit, armyUnit)) {
      return id
    }
  }
  return null
}

/** Merge surviving summon_on_kill stacks into the winner's army (permanent units). */
export function persistSummonOnKillArmy(
  session: GameSession,
  hero: Hero,
  winnerSide: CombatSide,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
): {
  session: GameSession
  gains: Array<{ qty: number; unitName: string }>
  lines: string[]
} {
  const raised = battle.stacks.filter(
    (stack) =>
      stack.side === winnerSide &&
      stack.qty > 0 &&
      stack.fromSummonOnKill === true &&
      !isHeroStack(stack),
  )
  let next = session
  const gains: Array<{ qty: number; unitName: string }> = []
  const lines: string[] = []
  for (const stack of raised) {
    const summonUnit = unitById(catalog, stack.unitId)
    if (!summonUnit) {
      continue
    }
    const name = summonUnit.name
    const liveHero = next.heroes.find((row) => row.id === hero.id)
    if (!liveHero) {
      break
    }
    const mergeId = matchingArmyStackIdForUnit(
      next,
      liveHero,
      summonUnit,
      catalog,
    )
    if (mergeId) {
      next = addHeroStackQty(next, mergeId, stack.qty)
      gains.push({ qty: stack.qty, unitName: name })
      continue
    }
    if (occupiedArmySlots(liveHero) < ARMY_STACK_SLOTS) {
      const slot = firstOpenArmySlot(liveHero)
      if (slot != null) {
        next = insertHeroArmyStack(next, hero.id, slot, {
          id: nextUnitStackId(next),
          unitId: stack.unitId,
          qty: stack.qty,
        })
        gains.push({ qty: stack.qty, unitName: name })
        continue
      }
    }
    lines.push(`No room for ${stack.qty} ${name}`)
  }
  return { session: next, gains, lines }
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
  const next = spawnSummonOnKillStack(
    battle,
    catalog,
    summoner.side,
    summonedUnit,
    qty,
    hex,
  )
  return {
    battle: next,
    lines: next === battle ? [] : [logLine],
  }
}
