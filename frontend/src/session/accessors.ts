import { calendarDayNumber } from '../hex/calendar'
import {
  canAfford,
  deductCost,
  emptyWallet,
  RESOURCES,
  YIELD_PER_MINE,
  type ResourceWallet,
} from '../hex/resources'
import type { SlotState } from '../town/townSlots'
import {
  BUILDING_SLOT_COUNT,
  HUMAN_PLAYER_ID,
  NECROPOLIS_TOWN_TYPE_ID,
  type BuildingState,
  type GameSession,
  type Node,
  type Town,
} from './types'

export function visitingHeroId(session: GameSession, town: Town): string | null {
  const hero = session.heroes.find(
    (h) => h.position.q === town.position.q && h.position.r === town.position.r,
  )
  return hero ? hero.id : null
}

export function humanPlayer(session: GameSession) {
  return session.players.find((player) => player.id === HUMAN_PLAYER_ID) ?? null
}

export function walletFromSession(session: GameSession): ResourceWallet {
  const wallet = emptyWallet()
  const player = humanPlayer(session)
  if (!player) {
    return wallet
  }
  for (const resource of RESOURCES) {
    wallet[resource.id].stockpile = player.resources[resource.id] ?? 0
    wallet[resource.id].claimedMines = session.nodes.filter(
      (node) =>
        node.kind === 'mine' &&
        node.player_id === player.id &&
        node.resource_id === resource.id,
    ).length
  }
  return wallet
}

export function applyWalletStockpiles(
  session: GameSession,
  wallet: ResourceWallet,
): GameSession {
  return {
    ...session,
    players: session.players.map((player) =>
      player.id === HUMAN_PLAYER_ID
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

export function spendResources(
  session: GameSession,
  cost: Record<number, number> | Record<string, number>,
): { session: GameSession; error: string | null } {
  const wallet = walletFromSession(session)
  const error = canAfford(wallet, cost)
  if (error) {
    return { session, error }
  }
  return {
    session: applyWalletStockpiles(session, deductCost(wallet, cost)),
    error: null,
  }
}

export function applyMineIncome(session: GameSession): GameSession {
  const player = humanPlayer(session)
  if (!player) {
    return session
  }
  const resources = { ...player.resources }
  for (const node of session.nodes) {
    if (node.kind !== 'mine' || node.player_id !== player.id) {
      continue
    }
    resources[node.resource_id] = (resources[node.resource_id] ?? 0) + YIELD_PER_MINE
  }
  return {
    ...session,
    players: session.players.map((p) =>
      p.id === HUMAN_PLAYER_ID ? { ...p, resources } : p,
    ),
  }
}

export function slotStatesForTown(session: GameSession, townId: string): SlotState[] {
  const slots: SlotState[] = Array.from({ length: BUILDING_SLOT_COUNT }, () => ({
    level: 0,
    buildingId: null,
  }))
  for (const row of session.building_states) {
    if (row.town_id !== townId) {
      continue
    }
    const index = row.slot_num - 1
    if (index >= 0 && index < slots.length) {
      slots[index] = { level: row.level, buildingId: row.building_id }
    }
  }
  return slots
}

function emptyBuildingStates(townId: string): BuildingState[] {
  return Array.from({ length: BUILDING_SLOT_COUNT }, (_, index) => ({
    id: `${townId}-slot-${index + 1}`,
    town_id: townId,
    building_id: null,
    slot_num: index + 1,
    level: 0,
    recruit_qty: 0,
  }))
}

function withBuildingSlots(session: GameSession, townId: string): GameSession {
  if (session.building_states.some((row) => row.town_id === townId)) {
    return session
  }
  return {
    ...session,
    building_states: [...session.building_states, ...emptyBuildingStates(townId)],
  }
}

export function patchBuildingSlot(
  session: GameSession,
  townId: string,
  slotIndex: number,
  next: SlotState,
): GameSession {
  const current = withBuildingSlots(session, townId)
  const slotNum = slotIndex + 1
  const exists = current.building_states.some(
    (row) => row.town_id === townId && row.slot_num === slotNum,
  )
  if (!exists) {
    return {
      ...current,
      building_states: [
        ...current.building_states,
        {
          id: `${townId}-slot-${slotNum}`,
          town_id: townId,
          building_id: next.buildingId,
          slot_num: slotNum,
          level: next.level,
          recruit_qty: 0,
        },
      ],
    }
  }
  return {
    ...current,
    building_states: current.building_states.map((row) =>
      row.town_id === townId && row.slot_num === slotNum
        ? {
            ...row,
            building_id: next.buildingId,
            level: next.level,
          }
        : row,
    ),
  }
}

function emptyGarrison(): Town['garrison'] {
  return {
    slot_0_hero_id: null,
    slots_1_to_6: Array.from({ length: 6 }, () => null),
  }
}

export function claimTown(
  session: GameSession,
  q: number,
  r: number,
  details?: { name?: string; townTypeId?: number },
): GameSession {
  let current = session
  let town = current.towns.find((t) => t.position.q === q && t.position.r === r)
  if (!town) {
    const id = `town-${current.towns.length + 1}`
    town = {
      id,
      name: details?.name?.trim() || 'Town',
      town_type_id: details?.townTypeId ?? NECROPOLIS_TOWN_TYPE_ID,
      position: { q, r },
      player_id: null,
      last_build_day: null,
      garrison: emptyGarrison(),
    }
    current = {
      ...current,
      towns: [...current.towns, town],
      building_states: [...current.building_states, ...emptyBuildingStates(id)],
    }
  }
  current = withBuildingSlots(current, town.id)
  if (town.player_id === HUMAN_PLAYER_ID) {
    return current
  }
  return {
    ...current,
    towns: current.towns.map((t) =>
      t.id === town.id ? { ...t, player_id: HUMAN_PLAYER_ID } : t,
    ),
    players: current.players.map((player) =>
      player.id === HUMAN_PLAYER_ID && !player.town_ids.includes(town.id)
        ? { ...player, town_ids: [...player.town_ids, town.id] }
        : player,
    ),
  }
}

export function claimMine(
  session: GameSession,
  q: number,
  r: number,
  resourceId?: number,
): GameSession {
  const existing = session.nodes.find(
    (node) => node.kind === 'mine' && node.position.q === q && node.position.r === r,
  )
  if (existing) {
    return {
      ...session,
      nodes: session.nodes.map((node) =>
        node.id === existing.id ? { ...node, player_id: HUMAN_PLAYER_ID } : node,
      ),
    }
  }
  if (resourceId == null) {
    return session
  }
  const node: Node = {
    id: `node-${session.nodes.length + 1}`,
    position: { q, r },
    resource_id: resourceId,
    kind: 'mine',
    player_id: HUMAN_PLAYER_ID,
    collected: false,
  }
  return { ...session, nodes: [...session.nodes, node] }
}

export function collectPickup(
  session: GameSession,
  q: number,
  r: number,
  resourceId: number,
  amount: number,
): GameSession {
  const player = humanPlayer(session)
  if (!player) {
    return session
  }
  const existing = session.nodes.find(
    (node) => node.kind === 'pickup' && node.position.q === q && node.position.r === r,
  )
  const nodes = existing
    ? session.nodes.map((node) =>
        node.id === existing.id ? { ...node, collected: true } : node,
      )
    : [
        ...session.nodes,
        {
          id: `node-${session.nodes.length + 1}`,
          position: { q, r },
          resource_id: resourceId,
          kind: 'pickup' as const,
          player_id: null,
          collected: true,
        },
      ]
  return {
    ...session,
    nodes,
    players: session.players.map((p) =>
      p.id === HUMAN_PLAYER_ID
        ? {
            ...p,
            resources: {
              ...p.resources,
              [resourceId]: (p.resources[resourceId] ?? 0) + amount,
            },
          }
        : p,
    ),
  }
}

export function syncHero(
  session: GameSession,
  position: { q: number; r: number },
  movementRemaining: number,
): GameSession {
  return {
    ...session,
    heroes: session.heroes.map((hero) =>
      hero.id === 'hero-1'
        ? { ...hero, position: { ...position }, movement_remaining: movementRemaining }
        : hero,
    ),
  }
}

export function findTownByName(session: GameSession, name: string): Town | undefined {
  return session.towns.find((town) => town.name === name)
}

export function findTownById(session: GameSession, townId: string): Town | undefined {
  return session.towns.find((town) => town.id === townId)
}

export function findTownAt(
  session: GameSession,
  q: number,
  r: number,
): Town | undefined {
  return session.towns.find((town) => town.position.q === q && town.position.r === r)
}

export function findNodeAt(
  session: GameSession,
  q: number,
  r: number,
): GameSession['nodes'][number] | undefined {
  return session.nodes.find(
    (node) => node.position.q === q && node.position.r === r,
  )
}

function townByIdOrName(session: GameSession, townIdOrName: string): Town | undefined {
  return findTownById(session, townIdOrName) ?? findTownByName(session, townIdOrName)
}

export function markTownBuiltToday(
  session: GameSession,
  townIdOrName: string,
): GameSession {
  const match = townByIdOrName(session, townIdOrName)
  if (!match) {
    return session
  }
  const day = calendarDayNumber(session.game.calendar)
  return {
    ...session,
    towns: session.towns.map((town) =>
      town.id === match.id ? { ...town, last_build_day: day } : town,
    ),
  }
}

export function hasTownBuiltToday(
  session: GameSession,
  townIdOrName: string,
): boolean {
  const town = townByIdOrName(session, townIdOrName)
  if (!town || town.last_build_day == null) {
    return false
  }
  return town.last_build_day === calendarDayNumber(session.game.calendar)
}
