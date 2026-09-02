import { startCalendar } from '../hex/calendar'
import { emptyWallet, RESOURCES } from '../hex/resources'
import { HERO_MARKER_LABEL, MAX_MOVEMENT_POINTS } from '../hex/hero'
import { hexDistance, neighborHexes } from '../hex/pathfinding'
import { forEachPassableHex, isPassable } from '../hex/world'
import { getCachedCatalog } from '../town/catalog'
import type { GameConfig } from '../options/gameConfig'
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
  playerIdForSlot,
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
        hero_type_ids: [null],
      },
    },
    players: [
      {
        id: HUMAN_PLAYER_ID,
        is_ai: false,
        eliminated: false,
        resources: startingResources(),
        hero_ids: [],
        town_ids: [],
        explored: [],
      },
    ],
    activePlayerIndex: 0,
    towns: [],
    building_states: [],
    heroes: [],
    units: [],
    nodes: [],
    mobs: [],
  }
}

export function createSessionFromConfig(config: GameConfig): GameSession {
  const players: Player[] = config.players.map((slot) => ({
    id: playerIdForSlot(slot.slot),
    is_ai: false,
    eliminated: false,
    resources: startingResources(),
    hero_ids: [],
    town_ids: [],
    explored: [],
  }))
  return {
    game: {
      id: GAME_ID,
      name: 'New Game',
      seed: 0,
      calendar: startCalendar(),
      settings: {
        player_count: config.playerCount,
        map_size: config.mapSize,
        victory_condition: 'standard',
        difficulty: String(config.difficultyId),
        game_type: config.playerCount > 1 ? 'hotseat' : 'single',
        hero_type_ids: config.players.map((slot) => slot.heroTypeId),
      },
    },
    players,
    activePlayerIndex: 0,
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
    eliminated: false,
    resources: startingResources(),
    hero_ids: [],
    town_ids: [],
    explored: [],
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
    offered_abilities: [],
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
  const ownerIds = session.players.map((player) => player.id)
  let claimedTowns = 0
  let claimedMines = 0
  for (const obj of objects) {
    if (obj.kind === 'town') {
      if (towns.some((town) => samePos(town.position, obj.q, obj.r))) {
        continue
      }
      townIndex += 1
      const id = `town-${townIndex}`
      const name = obj.name?.trim() || 'Town'
      const ownerId = obj.claimed
        ? ownerIds[claimedTowns % Math.max(1, ownerIds.length)] ?? null
        : null
      if (obj.claimed) {
        claimedTowns += 1
      }
      towns.push({
        id,
        name,
        town_type_id: mapObjectTownTypeId(obj) ?? NECROPOLIS_TOWN_TYPE_ID,
        position: { q: obj.q, r: obj.r },
        player_id: ownerId,
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
      const ownerId =
        obj.claimed && obj.kind === 'mine'
          ? ownerIds[claimedMines % Math.max(1, ownerIds.length)] ?? null
          : null
      if (obj.claimed && obj.kind === 'mine') {
        claimedMines += 1
      }
      nodes.push({
        id: `node-${nodeIndex}`,
        position: { q: obj.q, r: obj.r },
        resource_id: resourceId,
        kind: obj.kind,
        player_id: ownerId,
        collected: obj.kind === 'pickup' ? !!obj.collected : false,
      })
    }
  }
  for (const town of towns) {
    if (!building_states.some((row) => row.town_id === town.id)) {
      building_states.push(...emptyBuildingStates(town.id))
    }
  }
  return {
    ...session,
    towns,
    nodes,
    building_states,
    players: session.players.map((player) => ({
      ...player,
      town_ids: towns
        .filter((town) => town.player_id === player.id)
        .map((town) => town.id),
    })),
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
    learned_abilities: [],
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

function nextStartingHeroId(session: GameSession): string {
  if (!session.heroes.some((hero) => hero.id === HERO_ID)) {
    return HERO_ID
  }
  let n = session.heroes.length + 1
  let id = `hero-${n}`
  while (session.heroes.some((hero) => hero.id === id)) {
    n += 1
    id = `hero-${n}`
  }
  return id
}

function spawnPlayerHero(
  session: GameSession,
  playerId: string,
  position: { q: number; r: number },
  heroTypeId: number | null,
): GameSession {
  const catalog = getCachedCatalog()
  const usedNames = new Set(session.heroes.map((hero) => hero.name))
  let classId = heroTypeId
  let name = HERO_MARKER_LABEL
  let imagePath: string | null = null
  if (catalog) {
    const types = catalog.hero_type
    if (classId == null && types.length > 0) {
      classId = types[Math.floor(Math.random() * types.length)]?.id ?? null
    }
    const type = types.find((row) => row.id === classId)
    const pool = catalog.hero_pool.filter(
      (row) => row.class_id === classId && !usedNames.has(row.name),
    )
    const pick = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null
    if (pick) {
      name = pick.name
      classId = pick.class_id
      imagePath = pick.image_path
    } else if (type) {
      name = type.name
    }
  }
  const id = nextStartingHeroId(session)
  const hero: Hero = {
    id,
    player_id: playerId,
    name,
    class_id: classId,
    image_path: imagePath,
    position: { ...position },
    movement_remaining: MAX_MOVEMENT_POINTS,
    army: {
      slot_0: name,
      slots_1_to_6: emptyStackSlots(),
    },
    learned_abilities: [],
  }
  const withHero: GameSession = {
    ...session,
    heroes: [...session.heroes, hero],
    players: session.players.map((player) =>
      player.id === playerId
        ? { ...player, hero_ids: [...player.hero_ids, hero.id] }
        : player,
    ),
  }
  if (hero.class_id != null || !catalog) {
    return withHero
  }
  return assignHeroesFromPool(withHero, catalog.hero_pool)
}

function posKey(position: { q: number; r: number }): string {
  return `${position.q},${position.r}`
}

function pickSpreadTowns(towns: Town[], count: number): Town[] {
  if (count <= 0 || towns.length === 0) {
    return []
  }
  const remaining = [...towns]
  const picked: Town[] = []
  const center = {
    q: remaining.reduce((sum, town) => sum + town.position.q, 0) / remaining.length,
    r: remaining.reduce((sum, town) => sum + town.position.r, 0) / remaining.length,
  }
  remaining.sort(
    (a, b) =>
      hexDistance(b.position, center) - hexDistance(a.position, center),
  )
  const first = remaining.shift()
  if (first) {
    picked.push(first)
  }
  while (picked.length < count && remaining.length > 0) {
    let bestIndex = 0
    let bestMin = -1
    for (let i = 0; i < remaining.length; i += 1) {
      const town = remaining[i]
      const minDist = Math.min(
        ...picked.map((other) => hexDistance(other.position, town.position)),
      )
      if (minDist > bestMin) {
        bestMin = minDist
        bestIndex = i
      }
    }
    picked.push(remaining.splice(bestIndex, 1)[0])
  }
  return picked
}

function assignSpreadStartingTowns(session: GameSession): GameSession {
  const need = session.players.filter(
    (player) => !session.towns.some((town) => town.player_id === player.id),
  )
  if (need.length === 0) {
    return session
  }
  const unowned = session.towns.filter((town) => town.player_id == null)
  const picks = pickSpreadTowns(unowned, need.length)
  if (picks.length === 0) {
    return session
  }
  const ownerByTown = new Map<string, string>()
  picks.forEach((town, index) => {
    const player = need[index]
    if (player) {
      ownerByTown.set(town.id, player.id)
    }
  })
  const towns = session.towns.map((town) => {
    const ownerId = ownerByTown.get(town.id)
    return ownerId ? { ...town, player_id: ownerId } : town
  })
  return {
    ...session,
    towns,
    players: session.players.map((player) => ({
      ...player,
      town_ids: towns
        .filter((town) => town.player_id === player.id)
        .map((town) => town.id),
    })),
  }
}

function findSpawnNearTown(
  townPos: { q: number; r: number },
  occupied: Set<string>,
): { q: number; r: number } | null {
  const seen = new Set<string>([posKey(townPos)])
  let frontier = neighborHexes(townPos)
  for (let dist = 1; dist <= 3; dist += 1) {
    const nextFrontier: { q: number; r: number }[] = []
    for (const hex of frontier) {
      const key = posKey(hex)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      if (isPassable(hex.q, hex.r) && !occupied.has(key)) {
        return hex
      }
      nextFrontier.push(...neighborHexes(hex))
    }
    frontier = nextFrontier
  }
  return null
}

function findFarPassable(
  awayFrom: Array<{ q: number; r: number }>,
  occupied: Set<string>,
  fallback: { q: number; r: number },
): { q: number; r: number } {
  let best = fallback
  let bestScore = -1
  forEachPassableHex((q, r) => {
    const hex = { q, r }
    if (occupied.has(posKey(hex))) {
      return
    }
    const score =
      awayFrom.length === 0
        ? 0
        : Math.min(...awayFrom.map((other) => hexDistance(hex, other)))
    if (score > bestScore) {
      bestScore = score
      best = hex
    }
  })
  return best
}

export function ensureStartingHeroes(
  session: GameSession,
  fallbackPos: { q: number; r: number },
): GameSession {
  const picks = session.game.settings.hero_type_ids
  const alreadyStarted = session.heroes.length > 0
  let next = assignSpreadStartingTowns(session)
  const occupied = new Set<string>()
  for (const hero of next.heroes) {
    occupied.add(posKey(hero.position))
  }
  for (const town of next.towns) {
    occupied.add(posKey(town.position))
  }
  for (let index = 0; index < next.players.length; index += 1) {
    const player = next.players[index]
    if (!player || next.heroes.some((hero) => hero.player_id === player.id)) {
      continue
    }
    if (player.eliminated || alreadyStarted) {
      continue
    }
    const town = next.towns.find((row) => row.player_id === player.id)
    const others = next.heroes.map((hero) => hero.position)
    if (town) {
      others.push(town.position)
    }
    const nearTown = town ? findSpawnNearTown(town.position, occupied) : null
    const position = nearTown ?? findFarPassable(others, occupied, fallbackPos)
    occupied.add(posKey(position))
    next = spawnPlayerHero(
      next,
      player.id,
      position,
      picks?.[index] ?? null,
    )
  }
  return next
}
