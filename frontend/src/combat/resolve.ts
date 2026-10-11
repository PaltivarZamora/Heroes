import {
  abortActiveMapMovement,
  getSelectedMapHeroId,
  selectHeroOnMap,
  syncSelectedHeroFromSession,
} from '../hex/HexMap'
import {
  activePlayer,
  addHeroStackQty,
  claimTown,
  insertHeroArmyStack,
  nextUnitStackId,
  withEliminations,
} from '../session/accessors'
import { awardScaledKillXp, levelUpNoticeForAward, partsArmyValue, type LevelUpNotice, type XpKillPart, type XpValuePart } from '../session/xp'
import { getSession, updateSession } from '../session/store'
import { ARMY_STACK_SLOTS, type GameSession, type Hero, type Mob, type Town } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import { unitById } from '../town/catalog'
import type { CombatBattle, CombatSide, CombatStack } from './battle'
import { defenderArmyIsGarrison, isHeroStack } from './battle'
import { applyDemonReinforcement } from './demonReinforcement'
import { applyClericEndOfBattlePassive } from './templePassive'
import { isCreatureArmyUnit } from './siege'
import { creditDefeatMobKill } from '../session/quests'
import { removeWorldMob } from '../session/mobs'
import { GOLD_RESOURCE_ID } from '../hex/resources'
import {
  nearestFriendlyTown,
  placementAfterEscape,
  type CombatEscapeKind,
  type CostMap,
} from './escape'
import { rolledItemDisplayName } from '../items/display'
import { transferDefeatedHeroItems } from '../items/heroLoot'
import {
  logLostItemsToHero,
  logTookItemsFromHero,
} from '../session/gameLog'
import { recycleDefeatedHero } from '../session/recycle'
import {
  applyMobKillGoldReward,
  snapshotMobKillRewards,
} from '../session/mobKillRewards'
import { runAiItemMaintenanceForPlayer } from '../ai/itemEquip'

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
  /** Item names taken from a defeated hero (BR S9-41). */
  itemsTakenLines?: string[]
  /** Human winner leveled with bumps — show after summary dismiss. */
  levelUpNotice?: LevelUpNotice | null
  /** Mob kill gold / item messages (BR S9-43). */
  rewardLines?: string[]
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
  return removeWorldMob(session, mob)
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
  // Cleric: end-of-battle rez before losses / army writeback so persisted
  // qty reflects a full-stack resurrect.
  let battleResolved = battle
  let clericLines: string[] = []
  if (winner) {
    const clericPass = applyClericEndOfBattlePassive(
      battle,
      catalog,
      winner,
      winnerSide,
      opening,
      Math.random,
    )
    battleResolved = clericPass.battle
    clericLines = clericPass.lines
  }
  const summary: CombatSummary = {
    loserPlayer:
      loserSide === 'atk' ? battle.attackerPlayer : battle.defenderPlayer,
    loserHeroName: loser?.name ?? siegeTown?.name ?? (mob ? 'Creatures' : 'Town'),
    winnerPlayer:
      winnerSide === 'atk' ? battle.attackerPlayer : battle.defenderPlayer,
    winnerHeroName: winner?.name ?? siegeTown?.name ?? (mob ? 'Creatures' : 'Town'),
    loserLosses: lossesFor(loserSide, opening, battle, catalog),
    winnerLosses: lossesFor(winnerSide, opening, battleResolved, catalog),
    winnerGains: [],
    xpLines: [...clericLines],
    itemsTakenLines: [],
    levelUpNotice: null,
  }
  let next = session
  if (winner) {
    next = applyWinnerArmy(next, winner, winnerSide, battleResolved)
    const persisted = persistSummonedStacks(
      next,
      winner,
      winnerSide,
      battleResolved,
      catalog,
    )
    next = persisted.session
    summary.winnerGains = persisted.gains
    // XP (and any level-ups) before demon tier — INT bumps from this battle
    // must count toward floor(INT/6) Warlock / floor(INT/4) Heretic. Demons
    // previously ran first, so a hero who crossed the tier threshold on this
    // fight still resolved at the old tier.
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
      openingKillParts(opening, battleResolved, catalog, loserSide),
      enemyValue,
      ownValue,
      'battle',
    )
    next = xp.session
    summary.xpLines = [...summary.xpLines, ...xp.lines]
    summary.levelUpNotice = levelUpNoticeForAward(catalog, xp)
    const winnerLive =
      next.heroes.find((hero) => hero.id === winner.id) ?? winner
    const demons = applyDemonReinforcement(
      next,
      catalog,
      winnerLive,
      battleResolved,
      opening,
      loserSide,
    )
    next = demons.session
    if (demons.gains.length > 0) {
      summary.winnerGains = [...summary.winnerGains, ...demons.gains]
    }
  }
  if (loser && winner) {
    const loot = transferDefeatedHeroItems(next, catalog, winner.id, loser.id)
    next = loot.session
    if (loot.taken.length > 0) {
      const items = loot.taken.map((item) => ({
        uid: item.uid,
        name: rolledItemDisplayName(catalog, item),
      }))
      summary.itemsTakenLines = [
        `Took ${items.map((row) => row.name).join(', ')}`,
      ]
      next = logTookItemsFromHero(
        next,
        winner.player_id,
        winner.id,
        items,
      )
      next = logLostItemsToHero(
        next,
        loser.player_id,
        loser.name,
        items.map((row) => row.name).join(', '),
      )
    }
    const winnerPlayer = next.players.find((row) => row.id === winner.player_id)
    if (winnerPlayer?.is_ai) {
      next = runAiItemMaintenanceForPlayer(next, catalog, winner.player_id, [
        winner.id,
      ])
    }
    const liveLoser = next.heroes.find((row) => row.id === loser.id)
    if (liveLoser) {
      next = recycleDefeatedHero(next, catalog, liveLoser)
    }
  } else if (loser) {
    next = recycleDefeatedHero(next, catalog, loser)
  }
  if (siegeTown && defenderArmyIsGarrison(session, siegeTown, attackerHeroId)) {
    next = applyGarrisonArmy(next, siegeTown, 'def', battle)
  }
  if (mob && loserSide === 'def') {
    const attacker = session.heroes.find((hero) => hero.id === attackerHeroId)
    if (attacker && winner) {
      const snap = snapshotMobKillRewards(session, catalog, mob, opening)
      const goldResult = applyMobKillGoldReward(
        next,
        catalog,
        winner.id,
        snap,
      )
      next = goldResult.session
      if (goldResult.line) {
        summary.rewardLines = [goldResult.line]
      }
      next = creditDefeatMobKill(next, mob.id, attacker.player_id)
    }
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

function transferGoldBetweenPlayers(
  session: GameSession,
  fromPlayerId: string,
  toPlayerId: string | null,
  cost: CostMap,
): GameSession {
  const gold = Math.max(0, Math.floor(cost[GOLD_RESOURCE_ID] ?? 0))
  if (gold <= 0) {
    return session
  }
  return {
    ...session,
    players: session.players.map((player) => {
      if (player.id === fromPlayerId) {
        const resources = { ...player.resources }
        resources[GOLD_RESOURCE_ID] = Math.max(
          0,
          (resources[GOLD_RESOURCE_ID] ?? 0) - gold,
        )
        return { ...player, resources }
      }
      if (toPlayerId && player.id === toPlayerId) {
        const resources = { ...player.resources }
        resources[GOLD_RESOURCE_ID] = (resources[GOLD_RESOURCE_ID] ?? 0) + gold
        return { ...player, resources }
      }
      return player
    }),
  }
}

function placeEscapedHero(
  session: GameSession,
  hero: Hero,
  position: { q: number; r: number },
): GameSession {
  return {
    ...session,
    heroes: session.heroes.map((row) =>
      row.id === hero.id
        ? {
            ...row,
            position,
            movement_remaining: 0,
            flight: null,
          }
        : row,
    ),
  }
}

export function applyCombatEscape(
  session: GameSession,
  catalog: ReferenceCatalog,
  attackerHeroId: string,
  defenderHeroId: string | null,
  battle: CombatBattle,
  opening: OpeningStack[],
  escapingSide: CombatSide,
  kind: CombatEscapeKind,
  siegeTownId?: string | null,
  defenderMobId?: string | null,
  surrenderCost?: CostMap,
): { session: GameSession; summary: CombatSummary } | null {
  const winnerSide: CombatSide = escapingSide === 'atk' ? 'def' : 'atk'
  const loserId = escapingSide === 'atk' ? attackerHeroId : defenderHeroId
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
  if (!loser) {
    return null
  }
  const summary: CombatSummary = {
    loserPlayer:
      escapingSide === 'atk' ? battle.attackerPlayer : battle.defenderPlayer,
    loserHeroName: loser.name,
    winnerPlayer:
      winnerSide === 'atk' ? battle.attackerPlayer : battle.defenderPlayer,
    winnerHeroName: winner?.name ?? siegeTown?.name ?? (mob ? 'Creatures' : 'Town'),
    loserLosses: lossesFor(escapingSide, opening, battle, catalog),
    winnerLosses: lossesFor(winnerSide, opening, battle, catalog),
    winnerGains: [],
    itemsTakenLines: [],
    xpLines: [
      kind === 'flee'
        ? `${loser.name} fled the battle.`
        : `${loser.name} surrendered.`,
    ],
    levelUpNotice: null,
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
      openingValueParts(opening, catalog, escapingSide),
    )
    const xp = awardScaledKillXp(
      next,
      catalog,
      winner.id,
      openingKillParts(opening, battle, catalog, escapingSide),
      enemyValue,
      ownValue,
      'battle',
    )
    next = xp.session
    summary.xpLines = [...summary.xpLines, ...xp.lines]
    summary.levelUpNotice = levelUpNoticeForAward(catalog, xp)
  }
  next = applyWinnerArmy(next, loser, escapingSide, battle)
  const town = nearestFriendlyTown(next, loser)
  if (town) {
    const position = placementAfterEscape(next, loser, town)
    next = placeEscapedHero(next, loser, position)
  } else {
    next = placeEscapedHero(next, loser, loser.position)
  }
  if (kind === 'surrender' && surrenderCost) {
    const winnerPlayerId = winner?.player_id ?? null
    next = transferGoldBetweenPlayers(
      next,
      loser.player_id,
      mob ? null : winnerPlayerId,
      surrenderCost,
    )
  }
  if (siegeTown && defenderArmyIsGarrison(session, siegeTown, attackerHeroId)) {
    next = applyGarrisonArmy(next, siegeTown, 'def', battle)
  }
  if (mob) {
    next = applyMobArmy(next, mob, 'def', battle)
  }
  next = withEliminations(next)
  return { session: next, summary }
}

export function commitCombatEscape(
  catalog: ReferenceCatalog,
  attackerHeroId: string,
  defenderHeroId: string | null,
  battle: CombatBattle,
  opening: OpeningStack[],
  escapingSide: CombatSide,
  kind: CombatEscapeKind,
  siegeTownId?: string | null,
  defenderMobId?: string | null,
  surrenderCost?: CostMap,
): CombatSummary | null {
  let summary: CombatSummary | null = null
  const next = updateSession((current) => {
    const applied = applyCombatEscape(
      current,
      catalog,
      attackerHeroId,
      defenderHeroId,
      battle,
      opening,
      escapingSide,
      kind,
      siegeTownId,
      defenderMobId,
      surrenderCost,
    )
    if (!applied) {
      return current
    }
    summary = applied.summary
    return applied.session
  })
  if (summary) {
    syncSelectedHeroFromSession()
    abortActiveMapMovement()
    reselectHero(getSession() ?? next)
  }
  return summary
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
