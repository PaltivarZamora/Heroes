import { startCalendar } from '../hex/calendar'
import { emptyWallet, RESOURCES } from '../hex/resources'
import { HERO_MARKER_LABEL, MAX_MOVEMENT_POINTS } from '../hex/hero'
import { getCachedCatalog } from '../town/catalog'
import {
  mapObjectResourceId,
  mapObjectTownTypeId,
  type MapObjectData,
} from '../hex/types'
import { assignHeroesFromPool } from './accessors'
import {
  ARMY_STACK_SLOTS,
  BUILDING_SLOT_COUNT,
  GAME_ID,
  HERO_ID,
  HUMAN_PLAYER_ID,
  NECROPOLIS_TOWN_TYPE_ID,
  type BuildingState,
  type GameSession,
  type Hero,
  type Node,
  type Player,
  type Town,
} from './types'

function emptyStackSlots(): Array<string | null> {
  return Array.from({ length: ARMY_STACK_SLOTS }, () => null)
}

export function startingResources(): Record<number, number> {
  const wallet = emptyWallet()
  const resources: Record<number, number> = {}
  for (const resource of RESOURCES) {
    resources[resource.id] = wallet[resource.id].stockpile
  }
  return resources
}

export function createInitialSession(): GameSession {
  return {
    game: {
      id: GAME_ID,
      name: 'Test Game',
      seed: 0,
      calendar: startCalendar(),
      settings: {
        player_count: 1,
        map_size: 'Small',
        victory_condition: 'standard',
        difficulty: 'normal',
        game_type: 'single',
      },
    },
    players: [
      {
        id: HUMAN_PLAYER_ID,
        is_ai: false,
        resources: startingResources(),
        hero_ids: [],
        town_ids: [],
      },
    ],
    towns: [],
    building_states: [],
    heroes: [],
    units: [],
    nodes: [],
    mobs: [],
  }
}

export function addHumanPlayer(session: GameSession): GameSession {
  const player: Player = {
    id: HUMAN_PLAYER_ID,
    is_ai: false,
    resources: startingResources(),
    hero_ids: [],
    town_ids: [],
  }
  return { ...session, players: [...session.players, player] }
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

function samePos(position: { q: number; r: number }, q: number, r: number): boolean {
  return position.q === q && position.r === r
}

export function hydrateMapObjects(
  session: GameSession,
  objects: MapObjectData[],
): GameSession {
  const towns: Town[] = [...session.towns]
  const nodes: Node[] = [...session.nodes]
  const building_states: BuildingState[] = [...session.building_states]
  let townIndex = towns.length
  let nodeIndex = nodes.length
  for (const obj of objects) {
    if (obj.kind === 'town') {
      if (towns.some((town) => samePos(town.position, obj.q, obj.r))) {
        continue
      }
      townIndex += 1
      const id = `town-${townIndex}`
      const name = obj.name?.trim() || 'Town'
      towns.push({
        id,
        name,
        town_type_id: mapObjectTownTypeId(obj) ?? NECROPOLIS_TOWN_TYPE_ID,
        position: { q: obj.q, r: obj.r },
        player_id: obj.claimed ? HUMAN_PLAYER_ID : null,
        last_build_day: null,
        garrison: {
          slots_1_to_6: emptyStackSlots(),
        },
      })
      building_states.push(...emptyBuildingStates(id))
    } else if (obj.kind === 'mine' || obj.kind === 'pickup') {
      if (nodes.some((node) => samePos(node.position, obj.q, obj.r))) {
        continue
      }
      const resourceId = mapObjectResourceId(obj)
      if (resourceId == null) {
        continue
      }
      nodeIndex += 1
      nodes.push({
        id: `node-${nodeIndex}`,
        position: { q: obj.q, r: obj.r },
        resource_id: resourceId,
        kind: obj.kind,
        player_id: obj.claimed && obj.kind === 'mine' ? HUMAN_PLAYER_ID : null,
        collected: obj.kind === 'pickup' ? !!obj.collected : false,
      })
    }
  }
  for (const town of towns) {
    if (!building_states.some((row) => row.town_id === town.id)) {
      building_states.push(...emptyBuildingStates(town.id))
    }
  }
  const town_ids = towns.filter((t) => t.player_id === HUMAN_PLAYER_ID).map((t) => t.id)
  return {
    ...session,
    towns,
    nodes,
    building_states,
    players: session.players.map((player) =>
      player.id === HUMAN_PLAYER_ID ? { ...player, town_ids } : player,
    ),
  }
}

export function addHumanHero(
  session: GameSession,
  position: { q: number; r: number },
): GameSession {
  if (session.heroes.some((hero) => hero.id === HERO_ID)) {
    return session
  }
  const hero: Hero = {
    id: HERO_ID,
    player_id: HUMAN_PLAYER_ID,
    name: HERO_MARKER_LABEL,
    class_id: null,
    image_path: null,
    position: { ...position },
    movement_remaining: MAX_MOVEMENT_POINTS,
    army: {
      slot_0: HERO_MARKER_LABEL,
      slots_1_to_6: emptyStackSlots(),
    },
  }
  const withHero: GameSession = {
    ...session,
    heroes: [...session.heroes, hero],
    players: session.players.map((player) =>
      player.id === HUMAN_PLAYER_ID
        ? { ...player, hero_ids: [...player.hero_ids, hero.id] }
        : player,
    ),
  }
  const catalog = getCachedCatalog()
  return catalog
    ? assignHeroesFromPool(withHero, catalog.hero_pool)
    : withHero
}
