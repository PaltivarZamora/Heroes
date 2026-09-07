import { getSelectedMapHeroId, selectHeroOnMap } from '../hex/HexMap'
import {
  activePlayer,
  addHeroStackQty,
  claimTown,
  insertHeroArmyStack,
  nextUnitStackId,
  withEliminations,
} from '../session/accessors'
import { awardScaledKillXp, partsArmyValue, type XpKillPart, type XpValuePart } from '../session/xp'
import { getSession, updateSession } from '../session/store'
import { ARMY_STACK_SLOTS, type GameSession, type Hero, type Mob, type Town } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import { unitById } from '../town/catalog'
import type { CombatBattle, CombatSide, CombatStack } from './battle'
import { defenderArmyIsGarrison, isHeroStack } from './battle'
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
  xpLines: string[]
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

function creatureOpening(
  opening: OpeningStack[],
  catalog: ReferenceCatalog,
  side: CombatSide,
): OpeningStack[] {
  return opening.filter((row) => {
    if (row.side !== side || row.qty <= 0) {
      return false
    }
    return isCreatureArmyUnit(unitById(catalog, row.unitId))
  })
}

function openingValueParts(
  opening: OpeningStack[],
  catalog: ReferenceCatalog,
  side: CombatSide,
): XpValuePart[] {
  return creatureOpening(opening, catalog, side).map((row) => ({
    unitId: row.unitId,
    qty: row.qty,
  }))
}

function openingKillParts(
  opening: OpeningStack[],
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  side: CombatSide,
): XpKillPart[] {
  return creatureOpening(opening, catalog, side)
    .map((row) => {
      const live = battle.stacks.find((stack) => stack.id === row.id)
      const remaining = live?.qty ?? 0
      return {
        unitId: row.unitId,
        killed: Math.max(0, row.qty - remaining),
      }
    })
    .filter((part) => part.killed > 0)
}

function applyLiveArmySlots(
  session: GameSession,
  slots: Array<string | null>,
  side: CombatSide,
  battle: CombatBattle,
): { units: GameSession['units']; slots: Array<string | null> } {
  const liveBySlot = new Map(
    battle.stacks
      .filter(
        (stack) =>
          stack.side === side &&
          !isHeroStack(stack) &&
          stack.summonSeq == null &&
          stack.qty > 0,
      )
      .map((stack) => [stack.slot, stack]),
  )
  const nextSlots = [...slots]
  const drop = new Set<string>()
  let units = session.units
  for (let slot = 0; slot < nextSlots.length; slot += 1) {
    const unitId = nextSlots[slot]
    if (!unitId) {
      continue
    }
    const live = liveBySlot.get(slot)
    if (!live) {
      nextSlots[slot] = null
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
  return { units, slots: nextSlots }
}

function applyWinnerArmy(
  session: GameSession,
  hero: Hero,
  winnerSide: CombatSide,
  battle: CombatBattle,
): GameSession {
  const applied = applyLiveArmySlots(
    session,
    hero.army.slots_1_to_6,
    winnerSide,
    battle,
  )
  return {
    ...session,
    units: applied.units,
    heroes: session.heroes.map((row) =>
      row.id === hero.id
        ? { ...row, army: { ...row.army, slots_1_to_6: applied.slots } }
        : row,
    ),
  }
}

function applyGarrisonArmy(
  session: GameSession,
  town: Town,
  side: CombatSide,
  battle: CombatBattle,
): GameSession {
  const applied = applyLiveArmySlots(
    session,
    town.garrison.slots_1_to_6,
    side,
    battle,
  )
  return {
    ...session,
    units: applied.units,
    towns: session.towns.map((row) =>
      row.id === town.id
        ? { ...row, garrison: { ...row.garrison, slots_1_to_6: applied.slots } }
        : row,
    ),
  }
}

function applyMobArmy(
  session: GameSession,
  mob: Mob,
  side: CombatSide,
  battle: CombatBattle,
): GameSession {
  const applied = applyLiveArmySlots(
    session,
    mob.slots_1_to_6,
    side,
    battle,
  )
  return {
    ...session,
    units: applied.units,
    mobs: session.mobs.map((row) =>
      row.id === mob.id ? { ...row, slots_1_to_6: applied.slots } : row,
    ),
  }
}

function removeDefeatedMob(session: GameSession, mob: Mob): GameSession {
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
  defenderMobId?: string | null,
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
  const mob = defenderMobId
    ? session.mobs.find((row) => row.id === defenderMobId)
    : undefined
  if (!loser && !(siegeTown && loserSide === 'def') && !(mob && loserSide === 'def')) {
    return null
  }
  const summary: CombatSummary = {
    loserPlayer:
      loserSide === 'atk' ? battle.attackerPlayer : battle.defenderPlayer,
    loserHeroName: loser?.name ?? siegeTown?.name ?? (mob ? 'Creatures' : 'Town'),
    winnerPlayer:
      winnerSide === 'atk' ? battle.attackerPlayer : battle.defenderPlayer,
    winnerHeroName: winner?.name ?? siegeTown?.name ?? (mob ? 'Creatures' : 'Town'),
    loserLosses: lossesFor(loserSide, opening, battle, catalog),
    winnerLosses: lossesFor(winnerSide, opening, battle, catalog),
    winnerGains: [],
    xpLines: [],
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
    const ownValue = partsArmyValue(
      catalog,
      openingValueParts(opening, catalog, winnerSide),
    )
    const enemyValue = partsArmyValue(
      catalog,
      openingValueParts(opening, catalog, loserSide),
    )
    const xp = awardScaledKillXp(
      next,
      catalog,
      winner.id,
      openingKillParts(opening, battle, catalog, loserSide),
      enemyValue,
      ownValue,
      'battle',
    )
    next = xp.session
    summary.xpLines = xp.lines
  }
  if (loser) {
    next = removeDefeatedHero(next, loser)
  }
  if (siegeTown && defenderArmyIsGarrison(session, siegeTown, attackerHeroId)) {
    next = applyGarrisonArmy(next, siegeTown, 'def', battle)
  }
  if (mob && loserSide === 'def') {
    next = removeDefeatedMob(next, mob)
  } else if (mob && winnerSide === 'def') {
    next = applyMobArmy(next, mob, 'def', battle)
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
  defenderMobId?: string | null,
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
      defenderMobId,
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
