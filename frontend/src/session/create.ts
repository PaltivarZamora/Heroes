import { DEFAULT_AI_ARCH_ID } from '../ai/types'
import { startCalendar } from '../hex/calendar'
import { RESOURCES } from '../hex/resources'
import { HERO_MARKER_LABEL } from '../hex/hero'
import { hexDistance, neighborHexes } from '../hex/pathfinding'
import { forEachPassableHex, forEachTile, isPassable } from '../hex/world'
import { getCachedCatalog, heroMovementPoints, heroResourcePools, startingStockpileFor, visionRange } from '../town/catalog'
import type { ReferenceCatalog } from '../town/catalog'
import {
  defaultGameConfig,
  type GameConfig,
} from '../options/gameConfig'
import {
  mapObjectResourceId,
  mapObjectTownTypeId,
  type MapObjectData,
} from '../hex/types'
import { assignHeroesFromPool, grantHeroStartingArmy, heroIdsInOwnedTown, progressForHeroName, withNamedProgress } from './accessors'
import { seedNeutralTownBuildings } from './neutralTowns'
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
  const catalog = getCachedCatalog()
  const resources: Record<number, number> = {}
  for (const resource of RESOURCES) {
    resources[resource.id] = startingStockpileFor(catalog, resource)
  }
  return resources
}

/** Bootstrap / F5 refresh — same app_config defaults as the New Game screen. */
export function createInitialSession(): GameSession {
  return createSessionFromConfig(defaultGameConfig(getCachedCatalog()))
}

export function createSessionFromConfig(config: GameConfig): GameSession {
  const players: Player[] = config.players.map((slot) => ({
    id: playerIdForSlot(slot.slot),
    is_ai: slot.controller !== 'human',
    ai_spectator: slot.controller === 'ai_spectator',
    arch_id: slot.archId ?? DEFAULT_AI_ARCH_ID,
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
      seed: config.seed != null && config.seed > 0 ? config.seed : 0,
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
    hero_progress: {},
    units: [],
    nodes: [],
    mobs: [],
  }
}

export function addHumanPlayer(session: GameSession): GameSession {
  const player: Player = {
    id: HUMAN_PLAYER_ID,
    is_ai: false,
    ai_spectator: false,
    arch_id: DEFAULT_AI_ARCH_ID,
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

function townTypeIdForHeroClass(
  catalog: ReferenceCatalog,
  heroTypeId: number | null | undefined,
): number | null {
  if (heroTypeId == null || heroTypeId <= 0) {
    return null
  }
  const type = catalog.hero_type.find((row) => row.id === heroTypeId)
  return type != null && type.town_id > 0 ? type.town_id : null
}

/**
 * Every map town is typed from the players' picked hero classes (Druid → Grove,
 * etc.). Solo Druid ⇒ all Grove; multiplayer ⇒ types drawn from those picks
 * (spawn anchors prefer their player's class). Runs before building seed.
 */
function assignTownTypesFromPlayerClasses(
  towns: Town[],
  heroTypeIds: Array<number | null> | undefined,
  playerCount: number,
): Town[] {
  const catalog = getCachedCatalog()
  if (!catalog || towns.length === 0 || playerCount <= 0) {
    return towns
  }
  const typePool: number[] = []
  for (let i = 0; i < playerCount; i += 1) {
    const townTypeId = townTypeIdForHeroClass(catalog, heroTypeIds?.[i])
    if (townTypeId != null) {
      typePool.push(townTypeId)
    }
  }
  if (typePool.length === 0) {
    return towns
  }

  const patchByTownId = new Map<string, { townTypeId: number }>()

  const neutrals = towns.filter((town) => town.player_id == null)
  const anchors = pickSpreadTowns(
    neutrals,
    Math.min(playerCount, neutrals.length),
  )
  const anchorIds = new Set(anchors.map((town) => town.id))

  for (let i = 0; i < anchors.length; i += 1) {
    const townTypeId =
      townTypeIdForHeroClass(catalog, heroTypeIds?.[i]) ??
      typePool[i % typePool.length]!
    patchByTownId.set(anchors[i]!.id, {
      townTypeId,
    })
  }

  let next = 0
  // Owned towns already have a faction + buildings — never rewrite their type
  // from the round-robin pool (would desync skyline/hire from building art).
  const rest = towns
    .filter((town) => !anchorIds.has(town.id) && town.player_id == null)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
  for (const town of rest) {
    const townTypeId = typePool[next % typePool.length]!
    next += 1
    patchByTownId.set(town.id, {
      townTypeId,
    })
  }

  return towns.map((town) => {
    const patch = patchByTownId.get(town.id)
    if (!patch) {
      return town
    }
    if (town.town_type_id === patch.townTypeId) {
      return town
    }
    // Keep unique map name from town_name_pool; only retype the faction.
    return { ...town, town_type_id: patch.townTypeId }
  })
}

/**
 * After heroes exist, retype map towns from their real class_ids.
 * Covers Random picks (settings null → map kept Fortress/Necropolis) and any
 * hydrate that ran before the catalog was ready.
 */
function syncTownTypesToSpawnedHeroes(session: GameSession): GameSession {
  const catalog = getCachedCatalog()
  if (!catalog || session.towns.length === 0 || session.heroes.length === 0) {
    return session
  }
  const heroTypeIds = session.players.map((player) => {
    const hero = session.heroes.find((row) => row.player_id === player.id)
    return hero?.class_id ?? null
  })
  if (heroTypeIds.every((id) => id == null || id <= 0)) {
    return session
  }
  const typed = assignTownTypesFromPlayerClasses(
    session.towns,
    heroTypeIds,
    session.players.length,
  )
  const changedIds = new Set<string>()
  for (const town of typed) {
    const before = session.towns.find((row) => row.id === town.id)
    if (before && before.town_type_id !== town.town_type_id) {
      changedIds.add(town.id)
    }
  }
  if (changedIds.size === 0) {
    return session
  }
  const cleared: GameSession = {
    ...session,
    towns: typed,
    building_states: session.building_states.map((row) =>
      changedIds.has(row.town_id)
        ? {
            ...row,
            building_id: null,
            level: 0,
            recruit_qty: 0,
            offered_abilities: [],
          }
        : row,
    ),
  }
  return seedNeutralTownBuildings(cleared)
}

/** Match one town to a hero class; clear and re-seed buildings for the new type. */
function applyHeroTownType(
  session: GameSession,
  townId: string,
  heroTypeId: number | null | undefined,
): GameSession {
  const catalog = getCachedCatalog()
  if (!catalog) {
    return session
  }
  const townTypeId = townTypeIdForHeroClass(catalog, heroTypeId)
  if (townTypeId == null) {
    return session
  }
  const town = session.towns.find((row) => row.id === townId)
  if (!town) {
    return session
  }
  if (town.town_type_id === townTypeId) {
    return session
  }
  const cleared: GameSession = {
    ...session,
    towns: session.towns.map((row) =>
      row.id === townId ? { ...row, town_type_id: townTypeId } : row,
    ),
    building_states: session.building_states.map((row) =>
      row.town_id === townId
        ? {
            ...row,
            building_id: null,
            level: 0,
            recruit_qty: 0,
            offered_abilities: [],
          }
        : row,
    ),
  }
  return seedNeutralTownBuildings(cleared)
}

export function hydrateMapObjects(
  session: GameSession,
  objects: MapObjectData[],
): GameSession {
  const hadTowns = session.towns.length > 0
  const towns: Town[] = [...session.towns]
  const nodes: Node[] = [...session.nodes]
  const building_states: BuildingState[] = [...session.building_states]
  let townIndex = towns.length
  let nodeIndex = nodes.length
  const ownerIds = session.players.map((player) => player.id)
  let claimedMines = 0
  for (const obj of objects) {
    if (obj.kind === 'town') {
      if (towns.some((town) => samePos(town.position, obj.q, obj.r))) {
        continue
      }
      townIndex += 1
      const id = `town-${townIndex}`
      const name = obj.name?.trim() || 'Town'
      // All towns start neutral; capture is a real first action.
      towns.push({
        id,
        name,
        town_type_id: mapObjectTownTypeId(obj) ?? NECROPOLIS_TOWN_TYPE_ID,
        position: { q: obj.q, r: obj.r },
        player_id: null,
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
        qty:
          obj.kind === 'pickup'
            ? Math.max(0, Math.floor(Number(obj.qty) || 0))
            : 0,
        accrued_fraction: 0,
      })
    }
  }
  for (const town of towns) {
    if (!building_states.some((row) => row.town_id === town.id)) {
      building_states.push(...emptyBuildingStates(town.id))
    }
  }
  // First hydrate only: assign factions from hero picks. Remounts must keep
  // existing town_type_id (owned towns already have buildings for that type).
  const typedTowns = hadTowns
    ? towns
    : assignTownTypesFromPlayerClasses(
        towns,
        session.game.settings.hero_type_ids,
        session.players.length,
      )
  return seedNeutralTownBuildings({
    ...session,
    towns: typedTowns,
    nodes,
    building_states,
    players: session.players.map((player) => ({
      ...player,
      town_ids: typedTowns
        .filter((town) => town.player_id === player.id)
        .map((town) => town.id),
    })),
  })
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
    movement_remaining: heroMovementPoints(getCachedCatalog(), {
      class_id: null,
      current_level: 1,
    }),
    army: {
      slot_0: HERO_MARKER_LABEL,
      slots_1_to_6: emptyStackSlots(),
    },
    learned_abilities: [],
    current_level: 1,
    current_xp: 0,
    used_abilities_this_battle: [],
    used_abilities_today: [],
    arch_id: null,
    flight: null,
    ...heroResourcePools(getCachedCatalog(), {
      class_id: null,
      current_level: 1,
    }),
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
  let heroArchId: number | null = null
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
      heroArchId = pick.arch_id
    } else if (type) {
      name = type.name
    }
  }
  const id = nextStartingHeroId(session)
  const live = progressForHeroName(session, name)
  const hero: Hero = {
    id,
    player_id: playerId,
    name,
    class_id: classId,
    image_path: imagePath,
    position: { ...position },
    movement_remaining: heroMovementPoints(getCachedCatalog(), {
      class_id: classId,
      current_level: live.current_level,
    }),
    army: {
      slot_0: name,
      slots_1_to_6: emptyStackSlots(),
    },
    learned_abilities: [],
    current_level: live.current_level,
    current_xp: live.current_xp,
    used_abilities_this_battle: [],
    used_abilities_today: [],
    arch_id: heroArchId,
    flight: null,
    ...heroResourcePools(getCachedCatalog(), {
      class_id: classId,
      current_level: live.current_level,
    }),
  }
  const withHero: GameSession = withNamedProgress(
    {
      ...session,
      heroes: [...session.heroes, hero],
      players: session.players.map((player) =>
        player.id === playerId
          ? { ...player, hero_ids: [...player.hero_ids, hero.id] }
          : player,
      ),
    },
    name,
    live,
  )
  if (hero.class_id != null || !catalog) {
    return grantHeroStartingArmy(withHero, hero.id)
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

/**
 * Spread spawn anchors only — does NOT assign town ownership.
 * Players must walk in and capture like any other neutral town.
 */
function pickSpawnAnchorTowns(session: GameSession, count: number): Town[] {
  const neutrals = session.towns.filter((town) => town.player_id == null)
  return pickSpreadTowns(neutrals, count)
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
  let next = session
  const occupied = new Set<string>()
  for (const hero of next.heroes) {
    occupied.add(posKey(hero.position))
  }
  for (const town of next.towns) {
    occupied.add(posKey(town.position))
  }
  const needSpawn: Player[] = []
  for (let index = 0; index < next.players.length; index += 1) {
    const player = next.players[index]
    if (!player || next.heroes.some((hero) => hero.player_id === player.id)) {
      continue
    }
    if (player.eliminated || alreadyStarted) {
      continue
    }
    needSpawn.push(player)
  }
  const anchors = pickSpawnAnchorTowns(next, needSpawn.length)
  for (let i = 0; i < needSpawn.length; i += 1) {
    const player = needSpawn[i]!
    const town = anchors[i]
    const playerIndex = next.players.findIndex((row) => row.id === player.id)
    const heroTypeId = picks?.[playerIndex] ?? null
    if (town) {
      next = applyHeroTownType(next, town.id, heroTypeId)
    }
    const liveTown = town
      ? next.towns.find((row) => row.id === town.id) ?? town
      : undefined
    const others = next.heroes.map((hero) => hero.position)
    if (liveTown) {
      others.push(liveTown.position)
    }
    const nearTown = liveTown
      ? findSpawnNearTown(liveTown.position, occupied)
      : null
    const position = nearTown ?? findFarPassable(others, occupied, fallbackPos)
    occupied.add(posKey(position))
    next = spawnPlayerHero(next, player.id, position, heroTypeId)
    // Align the spawn-anchor town to the hero that actually appeared (Random
    // picks leave settings null, so pre-spawn typing never ran).
    if (town) {
      const spawned = next.heroes.find((row) => row.player_id === player.id)
      if (spawned?.class_id != null) {
        next = applyHeroTownType(next, town.id, spawned.class_id)
      }
    }
  }
  // Retype map towns from spawned classes once at game start only — remounts
  // must not reshuffle owned-town factions (skyline/hire vs buildings).
  if (!alreadyStarted) {
    next = syncTownTypesToSpawnedHeroes(next)
  }
  const withVision = seedStartingVision(next)
  // Only seed overnight eligibility on first spawn — remounts must not promote
  // same-day walk-ins into the restore set mid-day.
  if (alreadyStarted && next.game.town_pool_restore_ids != null) {
    return withVision
  }
  return {
    ...withVision,
    game: {
      ...withVision.game,
      town_pool_restore_ids: heroIdsInOwnedTown(withVision),
    },
  }
}

/** Each player gets starting vision around their hero. Live fog only paints the active player. */
export function seedStartingVision(session: GameSession): GameSession {
  const range = visionRange(getCachedCatalog())
  return {
    ...session,
    players: session.players.map((player) => {
      if (player.explored.length > 0) {
        return player
      }
      const hero = session.heroes.find((row) => row.player_id === player.id)
      if (!hero) {
        return player
      }
      const explored: Array<{ q: number; r: number }> = []
      forEachTile((q, r) => {
        if (hexDistance(hero.position, { q, r }) <= range) {
          explored.push({ q, r })
        }
      })
      return { ...player, explored }
    }),
  }
}
