import {
  canAfford,
  deductCost,
  emptyWallet,
  GOLD_RESOURCE_ID,
  RESOURCES,
  snapshotWallet,
  type ResourceWallet,
} from '../hex/resources'
import { boatCostGold, findBoatAt, findBoatById } from '../hex/boat'
import { facingFromMove } from '../hex/heroTravelSprite'
import { getCachedCatalog } from '../town/catalog'
import type { AxialPos, Boat, GameSession } from './types'

export function findWorldDockAt(
  session: GameSession,
  q: number,
  r: number,
): Extract<GameSession['features'][number], { kind: 'dock' }> | undefined {
  return (session.features ?? []).find(
    (row): row is Extract<GameSession['features'][number], { kind: 'dock' }> =>
      row.kind === 'dock' && row.position.q === q && row.position.r === r,
  )
}

export function findWorldDockById(
  session: GameSession,
  featureId: string,
): Extract<GameSession['features'][number], { kind: 'dock' }> | undefined {
  return (session.features ?? []).find(
    (row): row is Extract<GameSession['features'][number], { kind: 'dock' }> =>
      row.kind === 'dock' && row.id === featureId,
  )
}

function walletForPlayer(session: GameSession, playerId: string): ResourceWallet {
  const wallet = emptyWallet()
  const player = session.players.find((row) => row.id === playerId)
  if (!player) {
    return wallet
  }
  for (const resource of RESOURCES) {
    wallet[resource.id].stockpile = player.resources[resource.id] ?? 0
  }
  return wallet
}

function applyPlayerWallet(
  session: GameSession,
  playerId: string,
  wallet: ResourceWallet,
): GameSession {
  return {
    ...session,
    players: session.players.map((player) =>
      player.id === playerId
        ? {
            ...player,
            resources: Object.fromEntries(
              RESOURCES.map((resource) => [
                resource.id,
                wallet[resource.id].stockpile,
              ]),
            ),
          }
        : player,
    ),
  }
}

export type BuyBoatResult = {
  session: GameSession
  error: string | null
  boatId: string | null
}

/**
 * Buy an unoccupied boat at the Dock's launch hex. Hero does not board.
 */
export function buyBoatAtDock(
  session: GameSession,
  featureId: string,
  playerId: string,
): BuyBoatResult {
  const dock = findWorldDockById(session, featureId)
  if (!dock) {
    return { session, error: 'Dock not found.', boatId: null }
  }
  const existing = findBoatAt(session, dock.launch.q, dock.launch.r)
  if (existing) {
    return { session, error: 'A boat is already waiting.', boatId: null }
  }
  const cost = boatCostGold(getCachedCatalog())
  if (!session.players.some((row) => row.id === playerId)) {
    return { session, error: 'No player.', boatId: null }
  }
  const wallet = walletForPlayer(session, playerId)
  const affordError = canAfford(wallet, { [GOLD_RESOURCE_ID]: cost })
  if (affordError) {
    return { session, error: affordError, boatId: null }
  }
  const nextSession = applyPlayerWallet(
    session,
    playerId,
    deductCost(snapshotWallet(wallet), { [GOLD_RESOURCE_ID]: cost }),
  )
  const boats = [...(nextSession.boats ?? [])]
  const boatId = `boat-${boats.length + 1}`
  const boat: Boat = {
    id: boatId,
    position: { q: dock.launch.q, r: dock.launch.r },
    occupant_hero_id: null,
  }
  boats.push(boat)
  return {
    session: { ...nextSession, boats },
    error: null,
    boatId,
  }
}

export function boardBoat(
  session: GameSession,
  heroId: string,
  boatId: string,
): { session: GameSession; error: string | null } {
  const boat = findBoatById(session, boatId)
  if (!boat) {
    return { session, error: 'Boat not found.' }
  }
  if (boat.occupant_hero_id != null) {
    return { session, error: 'That boat is occupied.' }
  }
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero) {
    return { session, error: 'Hero not found.' }
  }
  if (hero.flight) {
    return { session, error: 'Land before boarding a boat.' }
  }
  const facing = facingFromMove(hero.position, boat.position)
  const boats = (session.boats ?? []).map((row) => {
    if (row.id === boatId) {
      return {
        ...row,
        occupant_hero_id: heroId,
        position: { ...row.position },
      }
    }
    if (row.occupant_hero_id === heroId) {
      return { ...row, occupant_hero_id: null }
    }
    return row
  })
  return {
    session: {
      ...session,
      boats,
      heroes: session.heroes.map((row) =>
        row.id === heroId
          ? {
              ...row,
              position: { q: boat.position.q, r: boat.position.r },
              ...(facing ? { travel_facing: facing } : {}),
            }
          : row,
      ),
    },
    error: null,
  }
}

/** Move occupied boat + hero together while sailing. */
export function syncHeroBoatPosition(
  session: GameSession,
  heroId: string,
  position: AxialPos,
  movementRemaining: number,
): GameSession {
  const hero = session.heroes.find((row) => row.id === heroId)
  const facing = hero ? facingFromMove(hero.position, position) : null
  const boats = (session.boats ?? []).map((boat) =>
    boat.occupant_hero_id === heroId
      ? { ...boat, position: { ...position } }
      : boat,
  )
  return {
    ...session,
    boats,
    heroes: session.heroes.map((row) =>
      row.id === heroId
        ? {
            ...row,
            position: { ...position },
            movement_remaining: movementRemaining,
            ...(facing ? { travel_facing: facing } : {}),
          }
        : row,
    ),
  }
}

/**
 * Leave the boat on its current water hex; hero steps onto `land`.
 * Disembarking ends the day's movement.
 */
export function disembarkBoat(
  session: GameSession,
  heroId: string,
  land: AxialPos,
): { session: GameSession; error: string | null } {
  const boat = (session.boats ?? []).find((row) => row.occupant_hero_id === heroId)
  if (!boat) {
    return { session, error: 'Not aboard a boat.' }
  }
  const boats = (session.boats ?? []).map((row) =>
    row.id === boat.id ? { ...row, occupant_hero_id: null } : row,
  )
  return {
    session: {
      ...session,
      boats,
      heroes: session.heroes.map((hero) =>
        hero.id === heroId
          ? {
              ...hero,
              position: { ...land },
              movement_remaining: 0,
            }
          : hero,
      ),
    },
    error: null,
  }
}
