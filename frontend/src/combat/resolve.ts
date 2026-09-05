import { getSelectedMapHeroId, selectHeroOnMap } from '../hex/HexMap'
import {
  activePlayer,
  addHeroStackQty,
  claimTown,
  insertHeroArmyStack,
  nextUnitStackId,
  withEliminations,
} from '../session/accessors'
import { getSession, updateSession } from '../session/store'
import { ARMY_STACK_SLOTS, type GameSession, type Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import { unitById } from '../town/catalog'
import type { CombatBattle, CombatSide, CombatStack } from './battle'
import { isHeroStack } from './battle'
import { isCreatureArmyUnit } from './siege'

export type OpeningStack = {
  id: string
  side: CombatSide
  slot: number
  unitId: number
  qty: number
}

export type CombatLossLine = {
  qty: number
  unitName: string
}

export type CombatSummary = {
  loserPlayer: number
  loserHeroName: string
  winnerPlayer: number
  winnerHeroName: string
  loserLosses: CombatLossLine[]
  winnerLosses: CombatLossLine[]
  winnerGains: CombatLossLine[]
}

export function snapshotOpening(stacks: CombatStack[]): OpeningStack[] {
  return stacks
    .filter((stack) => !isHeroStack(stack))
    .map((stack) => ({
      id: stack.id,
      side: stack.side,
      slot: stack.slot,
      unitId: stack.unitId,
      qty: stack.qty,
    }))
}

/** Only creature army. Walls, fixtures, and Siege never decide victory. */
function stackCountsTowardWipe(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): boolean {
  if (stack.qty <= 0 || isHeroStack(stack)) {
    return false
  }
  return isCreatureArmyUnit(unitById(catalog, stack.unitId))
}

function sideHasLiving(
  battle: CombatBattle,
  side: CombatSide,
  catalog: ReferenceCatalog,
): boolean {
  return battle.stacks.some(
    (stack) => stack.side === side && stackCountsTowardWipe(stack, catalog),
  )
}

export function defeatedSide(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
): CombatSide | null {
  const atkLive = sideHasLiving(battle, 'atk', catalog)
  const defLive = sideHasLiving(battle, 'def', catalog)
  if (!atkLive && defLive) {
    return 'atk'
  }
  if (!defLive && atkLive) {
    return 'def'
  }
  return null
}

function lossesFor(
  side: CombatSide,
  opening: OpeningStack[],
  battle: CombatBattle,
  catalog: ReferenceCatalog,
): CombatLossLine[] {
  return opening
    .filter((row) => row.side === side && row.qty > 0)
    .map((row) => {
      const live = battle.stacks.find((stack) => stack.id === row.id)
      const remaining = live?.qty ?? 0
      return {
        qty: row.qty - remaining,
        unitName: unitById(catalog, row.unitId)?.name ?? 'Unknown',
      }
    })
    .filter((line) => line.qty > 0)
}

function applyWinnerArmy(
  session: GameSession,
  hero: Hero,
  winnerSide: CombatSide,
  battle: CombatBattle,
): GameSession {
  const liveBySlot = new Map(
    battle.stacks
      .filter(
        (stack) =>
          stack.side === winnerSide &&
          !isHeroStack(stack) &&
          stack.summonSeq == null,
      )
      .map((stack) => [stack.slot, stack]),
  )
  const slots = [...hero.army.slots_1_to_6]
  const drop = new Set<string>()
  let units = session.units
  for (let slot = 0; slot < slots.length; slot += 1) {
    const unitId = slots[slot]
    if (!unitId) {
      continue
    }
    const live = liveBySlot.get(slot)
    if (!live) {
      slots[slot] = null
      drop.add(unitId)
      continue
    }
    units = units.map((row) =>
      row.id === unitId ? { ...row, qty: live.qty } : row,
    )
  }
  if (drop.size > 0) {
    units = units.filter((row) => !drop.has(row.id))
  }
  return {
    ...session,
    units,
    heroes: session.heroes.map((row) =>
      row.id === hero.id
        ? { ...row, army: { ...row.army, slots_1_to_6: slots } }
        : row,
    ),
  }
}

function occupiedArmySlots(hero: Hero): number {
  return hero.army.slots_1_to_6.filter((id) => id != null && id !== '').length
}

function firstOpenArmySlot(hero: Hero): number | null {
  const slots = [...hero.army.slots_1_to_6]
  while (slots.length < ARMY_STACK_SLOTS) {
    slots.push(null)
  }
  const index = slots.findIndex((id) => id == null)
  return index >= 0 ? index : null
}

function matchingArmyStackId(
  session: GameSession,
  hero: Hero,
  unitId: number,
): string | null {
  for (const id of hero.army.slots_1_to_6) {
    if (!id) {
      continue
    }
    const row = session.units.find((unit) => unit.id === id)
    if (row && row.unit_id === unitId) {
      return id
    }
  }
  return null
}

/**
 * Post-battle summon reconciliation. Creation order. persists_on_summon
 * false is always discarded. True: new slot if room, else merge same
 * unit type, else discard.
 */
function persistSummonedStacks(
  session: GameSession,
  hero: Hero,
  winnerSide: CombatSide,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
): { session: GameSession; gains: CombatLossLine[] } {
  const summons = battle.stacks
    .filter(
      (stack) =>
        stack.side === winnerSide &&
        stack.qty > 0 &&
        stack.summonSeq != null,
    )
    .sort((a, b) => (a.summonSeq ?? 0) - (b.summonSeq ?? 0))
  let next = session
  const gains: CombatLossLine[] = []
  for (const stack of summons) {
    if (stack.persistOnSummon !== true) {
      continue
    }
    const liveHero = next.heroes.find((row) => row.id === hero.id)
    if (!liveHero) {
      break
    }
    const name = unitById(catalog, stack.unitId)?.name ?? 'Unknown'
    if (occupiedArmySlots(liveHero) < ARMY_STACK_SLOTS) {
      const slot = firstOpenArmySlot(liveHero)
      if (slot == null) {
        continue
      }
      next = insertHeroArmyStack(next, hero.id, slot, {
        id: nextUnitStackId(next),
        unitId: stack.unitId,
        qty: stack.qty,
      })
      gains.push({ qty: stack.qty, unitName: name })
      continue
    }
    const sameId = matchingArmyStackId(next, liveHero, stack.unitId)
    if (sameId) {
      next = addHeroStackQty(next, sameId, stack.qty)
      gains.push({ qty: stack.qty, unitName: name })
    }
  }
  return { session: next, gains }
}

function removeDefeatedHero(session: GameSession, hero: Hero): GameSession {
  return {
    ...session,
    units: session.units.filter((row) => row.hero_id !== hero.id),
    heroes: session.heroes.filter((row) => row.id !== hero.id),
    players: session.players.map((player) =>
      player.id === hero.player_id
        ? {
            ...player,
            hero_ids: player.hero_ids.filter((id) => id !== hero.id),
          }
        : player,
    ),
  }
}

function reselectHero(session: GameSession): void {
  const selected = getSelectedMapHeroId()
  if (selected && session.heroes.some((hero) => hero.id === selected)) {
    return
  }
  const actor = activePlayer(session)
  const next =
    session.heroes.find((hero) => hero.player_id === actor?.id) ??
    session.heroes[0]
  if (next) {
    selectHeroOnMap(next.id)
  }
}

export function applyCombatOutcome(
  session: GameSession,
  catalog: ReferenceCatalog,
  attackerHeroId: string,
  defenderHeroId: string | null,
  battle: CombatBattle,
  opening: OpeningStack[],
  siegeTownId?: string | null,
): { session: GameSession; summary: CombatSummary } | null {
  const loserSide = defeatedSide(battle, catalog)
  if (!loserSide) {
    return null
  }
  const winnerSide: CombatSide = loserSide === 'atk' ? 'def' : 'atk'
  const loserId = loserSide === 'atk' ? attackerHeroId : defenderHeroId
  const winnerId = winnerSide === 'atk' ? attackerHeroId : defenderHeroId
  const loser = loserId
    ? session.heroes.find((hero) => hero.id === loserId)
    : undefined
  const winner = winnerId
    ? session.heroes.find((hero) => hero.id === winnerId)
    : undefined
  const siegeTown = siegeTownId
    ? session.towns.find((row) => row.id === siegeTownId)
    : undefined
  if (!loser && !(siegeTown && loserSide === 'def')) {
    return null
  }
  const summary: CombatSummary = {
    loserPlayer:
      loserSide === 'atk' ? battle.attackerPlayer : battle.defenderPlayer,
    loserHeroName: loser?.name ?? siegeTown?.name ?? 'Town',
    winnerPlayer:
      winnerSide === 'atk' ? battle.attackerPlayer : battle.defenderPlayer,
    winnerHeroName: winner?.name ?? siegeTown?.name ?? 'Town',
    loserLosses: lossesFor(loserSide, opening, battle, catalog),
    winnerLosses: lossesFor(winnerSide, opening, battle, catalog),
    winnerGains: [],
  }
  let next = session
  if (winner) {
    next = applyWinnerArmy(next, winner, winnerSide, battle)
    const persisted = persistSummonedStacks(
      next,
      winner,
      winnerSide,
      battle,
      catalog,
    )
    next = persisted.session
    summary.winnerGains = persisted.gains
  }
  if (loser) {
    next = removeDefeatedHero(next, loser)
  }
  if (siegeTown && winnerSide === 'atk') {
    // Town stays on the map; only owner_id / player_id changes.
    next = claimTown(next, siegeTown.position.q, siegeTown.position.r)
  }
  next = withEliminations(next)
  return { session: next, summary }
}

export function commitCombatOutcome(
  catalog: ReferenceCatalog,
  attackerHeroId: string,
  defenderHeroId: string | null,
  battle: CombatBattle,
  opening: OpeningStack[],
  siegeTownId?: string | null,
): CombatSummary | null {
  let summary: CombatSummary | null = null
  const next = updateSession((current) => {
    const applied = applyCombatOutcome(
      current,
      catalog,
      attackerHeroId,
      defenderHeroId,
      battle,
      opening,
      siegeTownId,
    )
    if (!applied) {
      return current
    }
    summary = applied.summary
    return applied.session
  })
  if (summary) {
    reselectHero(getSession() ?? next)
  }
  return summary
}
