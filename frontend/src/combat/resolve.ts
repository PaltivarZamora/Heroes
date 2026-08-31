import { getSelectedMapHeroId, selectHeroOnMap } from '../hex/HexMap'
import { activePlayer, withEliminations } from '../session/accessors'
import { getSession, updateSession } from '../session/store'
import { type GameSession, type Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import { unitById } from '../town/catalog'
import type { CombatBattle, CombatSide, CombatStack } from './battle'

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
}

export function snapshotOpening(stacks: CombatStack[]): OpeningStack[] {
  return stacks.map((stack) => ({
    id: stack.id,
    side: stack.side,
    slot: stack.slot,
    unitId: stack.unitId,
    qty: stack.qty,
  }))
}

export function defeatedSide(battle: CombatBattle): CombatSide | null {
  const atkLive = battle.stacks.some((stack) => stack.side === 'atk')
  const defLive = battle.stacks.some((stack) => stack.side === 'def')
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
      .filter((stack) => stack.side === winnerSide)
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
  defenderHeroId: string,
  battle: CombatBattle,
  opening: OpeningStack[],
): { session: GameSession; summary: CombatSummary } | null {
  const loserSide = defeatedSide(battle)
  if (!loserSide) {
    return null
  }
  const winnerSide: CombatSide = loserSide === 'atk' ? 'def' : 'atk'
  const loserId = loserSide === 'atk' ? attackerHeroId : defenderHeroId
  const winnerId = winnerSide === 'atk' ? attackerHeroId : defenderHeroId
  const loser = session.heroes.find((hero) => hero.id === loserId)
  const winner = session.heroes.find((hero) => hero.id === winnerId)
  if (!loser || !winner) {
    return null
  }
  const summary: CombatSummary = {
    loserPlayer:
      loserSide === 'atk' ? battle.attackerPlayer : battle.defenderPlayer,
    loserHeroName: loser.name,
    winnerPlayer:
      winnerSide === 'atk' ? battle.attackerPlayer : battle.defenderPlayer,
    winnerHeroName: winner.name,
    loserLosses: lossesFor(loserSide, opening, battle, catalog),
    winnerLosses: lossesFor(winnerSide, opening, battle, catalog),
  }
  let next = applyWinnerArmy(session, winner, winnerSide, battle)
  next = removeDefeatedHero(next, loser)
  next = withEliminations(next)
  return { session: next, summary }
}

export function commitCombatOutcome(
  catalog: ReferenceCatalog,
  attackerHeroId: string,
  defenderHeroId: string,
  battle: CombatBattle,
  opening: OpeningStack[],
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
