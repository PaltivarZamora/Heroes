import { calendarDayNumber, advanceDay, isWeekRollover } from '../hex/calendar'
import { advanceAlongHexLine, nextTownCircleHex, townCircleLapSteps } from '../hex/flight'
import { hexDistance } from '../hex/pathfinding'
import {
  canAfford,
  deductCost,
  emptyWallet,
  formatAmount,
  GOLD_RESOURCE_ID,
  resourceById,
  RESOURCES,
  snapshotWallet,
  type ResourceWallet,
} from '../hex/resources'
import type { SlotState } from '../town/townSlots'
import {
  armyOptions,
  buildingById,
  buildingGrowth,
  buildingProduces,
  genericRoot,
  genericSlotBuildings,
  heroMovementPoints,
  heroResourcePools,
  isArmySlot,
  isBuildRoot,
  isLibraryBuilding,
  nextInChain,
  unitCost,
  unitForBuilding,
  unitUpgradeCost,
  advancedUnitFor,
  unitById,
  classBranchBaseUnit,
  getCachedCatalog,
  hireHeroGoldCost,
  tavernHirePool,
  resourceDailyMineRate,
  resourceWeeklyNode,
  scaleCost,
  flightSpeed,
  flightCostPerHex,
  type HeroPoolRow,
  type ReferenceCatalog,
  type BuildingRow,
} from '../town/catalog'
import {
  applyHeroTownVisitUniques,
  applyRecruitmentBeaconsBeforeGrowth,
  applyWeeklyTownUniquesWithReport,
  maybeApplyInfernalArchiveAfterBuild,
  takeArchiveLearnNotice,
  townRecruitCost,
  townUnitUpgradeCost,
  type ArchiveLearnNotice,
} from '../town/townUniques'

export {
  applyHeroTownVisitUniques,
  takeArchiveLearnNotice,
  type ArchiveLearnNotice,
} from '../town/townUniques'
import { applyWeeklyMobGrowth } from './mobs'
import { applyWeeklyNeutralTownGrowth } from './neutralTowns'
import {
  abilityById,
  classAbilityIdsAtTier,
  findOffer,
  goldCostForLevel,
  heroHasDiscipline,
  mergeLibraryOffers,
} from '../town/libraryRules'
import {
  marketConversionRate,
  ownedMarketplaceCount as countOwnedMarketplaces,
  quoteMarketTrade,
  quoteMultiSell,
} from '../town/market'
import {
  ARMY_STACK_SLOTS,
  BUILDING_SLOT_COUNT,
  HUMAN_PLAYER_ID,
  NECROPOLIS_TOWN_TYPE_ID,
  type AxialPos,
  type BuildingState,
  type GameSession,
  type Hero,
  type HeroProgress,
  type Node,
  type Player,
  type Town,
  type UnitStack,
} from './types'

export function visitingHeroId(
  session: GameSession,
  town: Town,
  preferredId?: string | null,
): string | null {
  const onTown = (hero: Hero) =>
    !hero.flight &&
    hero.position.q === town.position.q &&
    hero.position.r === town.position.r
  if (preferredId) {
    const preferred = session.heroes.find(
      (hero) => hero.id === preferredId && onTown(hero),
    )
    if (preferred) {
      return preferred.id
    }
  }
  const hero = session.heroes.find(onTown)
  return hero ? hero.id : null
}

/** True when any army slot id maps to a living (qty > 0) unit stack. */
export function slotsHaveLivingUnits(
  session: GameSession,
  slots: Array<string | null> | undefined,
): boolean {
  if (!slots) {
    return false
  }
  return slots.some((id) => {
    if (!id) {
      return false
    }
    const row = session.units.find((unit) => unit.id === id)
    return row != null && row.qty > 0
  })
}

/**
 * Enemy town with no garrison and no defending hero army — walk-in capture,
 * no siege battle.
 */
export function townIsUndefended(
  session: GameSession,
  town: Town,
  attackerHeroId?: string | null,
): boolean {
  if (slotsHaveLivingUnits(session, town.garrison.slots_1_to_6)) {
    return false
  }
  const visitorId = visitingHeroId(session, town)
  if (!visitorId || visitorId === attackerHeroId) {
    return true
  }
  const visitor = session.heroes.find((hero) => hero.id === visitorId)
  if (!visitor) {
    return true
  }
  if (town.player_id && visitor.player_id !== town.player_id) {
    return true
  }
  return !slotsHaveLivingUnits(session, visitor.army.slots_1_to_6)
}

export function activePlayerIndex(session: GameSession): number {
  const index = session.activePlayerIndex
  if (typeof index === 'number' && index >= 0 && index < session.players.length) {
    return index
  }
  return 0
}

export function activePlayer(session: GameSession): Player | null {
  return session.players[activePlayerIndex(session)] ?? session.players[0] ?? null
}

/** The player whose turn it is. Kept as an alias for existing call sites. */
export function humanPlayer(session: GameSession) {
  return activePlayer(session)
}

function actingPlayerId(
  session: GameSession,
  ownerId?: string | null,
): string | null {
  if (ownerId) {
    return ownerId
  }
  return activePlayer(session)?.id ?? null
}

export function persistActiveExplored(
  session: GameSession,
  hexes: AxialPos[],
): GameSession {
  const index = activePlayerIndex(session)
  return {
    ...session,
    players: session.players.map((player, i) =>
      i === index ? { ...player, explored: hexes } : player,
    ),
  }
}

export function isPlayerEliminated(session: GameSession, player: Player): boolean {
  if (player.eliminated) {
    return true
  }
  const hasTown = session.towns.some((town) => town.player_id === player.id)
  const hasHero = session.heroes.some((hero) => hero.player_id === player.id)
  if (hasTown || hasHero) {
    return false
  }
  return session.towns.length > 0 || session.heroes.length > 0
}

/** Mines owned by eliminated players revert to Neutral (unclaimed). */
export function releaseEliminatedPlayerMines(
  session: GameSession,
  eliminatedIds: ReadonlySet<string>,
): GameSession {
  if (eliminatedIds.size === 0) {
    return session
  }
  let changed = false
  const nodes = session.nodes.map((node) => {
    if (
      node.kind !== 'mine' ||
      node.player_id == null ||
      !eliminatedIds.has(node.player_id)
    ) {
      return node
    }
    changed = true
    return { ...node, player_id: null }
  })
  return changed ? { ...session, nodes } : session
}

export function withEliminations(session: GameSession): GameSession {
  let changed = false
  const newlyEliminated = new Set<string>()
  const players = session.players.map((player) => {
    const eliminated = isPlayerEliminated(session, player)
    if (eliminated === player.eliminated) {
      return player
    }
    changed = true
    if (eliminated && !player.eliminated) {
      newlyEliminated.add(player.id)
    }
    return { ...player, eliminated }
  })
  let next: GameSession = changed ? { ...session, players } : session
  if (newlyEliminated.size > 0) {
    next = releaseEliminatedPlayerMines(next, newlyEliminated)
  }
  return next
}

/** Surviving players when the match has a sole remaining side. */
export function matchVictors(session: GameSession): Player[] {
  const alive = session.players.filter(
    (player) => !isPlayerEliminated(session, player),
  )
  if (alive.length === 1 && session.players.length > 1) {
    return alive
  }
  return []
}

export function matchVictoryResult(session: GameSession): {
  winners: Player[]
  losers: Player[]
} | null {
  const winners = matchVictors(session)
  if (winners.length === 0) {
    return null
  }
  const winnerIds = new Set(winners.map((player) => player.id))
  return {
    winners,
    losers: session.players.filter((player) => !winnerIds.has(player.id)),
  }
}

export function nextActivePlayerIndex(session: GameSession): {
  index: number
  dayAdvance: boolean
} {
  const start = activePlayerIndex(session)
  const n = session.players.length
  if (n === 0) {
    return { index: 0, dayAdvance: false }
  }
  for (let step = 1; step <= n; step += 1) {
    const index = (start + step) % n
    const player = session.players[index]
    if (!player || isPlayerEliminated(session, player)) {
      continue
    }
    return { index, dayAdvance: index <= start }
  }
  return { index: start, dayAdvance: true }
}

export function endTurn(session: GameSession): GameSession {
  let current = withEliminations(session)
  const ending = activePlayer(current)
  const { index, dayAdvance } = nextActivePlayerIndex(current)
  current = { ...current, activePlayerIndex: index }
  // Flat +1 Energy and +1 Mana for the player whose turn just ended (capped at max).
  // Separate from day-rollover / town full-restore and from regen_pure/hybrid.
  if (ending) {
    current = regenHeroPoolsEndOfTurn(current, ending.id)
  }
  const incomeEvents: DayIncomeEvent[] = []
  if (dayAdvance) {
    const previous = current.game.calendar
    const next = advanceDay(previous)
    current = {
      ...current,
      game: { ...current.game, calendar: next },
    }
    current = advanceAllFlights(current)
    const mineResult = applyMineIncomeWithReport(current)
    current = mineResult.session
    incomeEvents.push(...mineResult.events)
    current = {
      ...current,
      heroes: current.heroes.map((hero) => ({
        ...hero,
        used_abilities_today: [],
      })),
    }
    current = restoreHeroPoolsEndingDayInTown(current)
    current = {
      ...current,
      game: {
        ...current.game,
        town_pool_restore_ids: heroIdsInOwnedTown(current),
      },
    }
    if (isWeekRollover(previous, next)) {
      const catalog = getCachedCatalog()
      if (catalog) {
        const weekResult = applyWeeklyGrowthWithReport(current, catalog)
        current = weekResult.session
        incomeEvents.push(...weekResult.events)
        current = applyWeeklyMobGrowth(current, catalog)
        current = applyWeeklyNeutralTownGrowth(current, catalog, next)
      }
    }
  }
  const incoming = activePlayer(current)
  if (incoming) {
    current = restorePlayerHeroMovement(current, incoming.id)
  }
  lastDayIncomeNoticeLines = dayAdvance
    ? formatDayIncomeNoticeLines(incomeEvents, localHumanPlayerId(current))
    : []
  return current
}

/** Human (non-AI) player id for HUD notices; falls back to player-1. */
function localHumanPlayerId(session: GameSession): string {
  return (
    session.players.find((player) => !player.is_ai)?.id ?? HUMAN_PLAYER_ID
  )
}

/** Day/week income lines from the last `endTurn` day advance (cleared on read). */
let lastDayIncomeNoticeLines: string[] = []

export function takeDayIncomeNoticeLines(): string[] {
  const lines = lastDayIncomeNoticeLines
  lastDayIncomeNoticeLines = []
  return lines
}

type DayIncomeEvent =
  | {
      kind: 'building'
      playerId: string
      townName: string
      buildingName: string
      resourceId: number
      amount: number
    }
  | {
      kind: 'mine'
      playerId: string
      resourceId: number
      amount: number
      mineCount: number
    }
  | {
      kind: 'unique'
      playerId: string
      townName: string
      uniqueName: string
      resourceId: number
      amount: number
    }
  | {
      kind: 'construct'
      playerId: string
      uniqueName: string
      verb: 'Built' | 'Upgraded'
      buildingName: string
    }
  | {
      kind: 'growth'
      playerId: string
      uniqueName: string
      buildingName: string
      amount: number
    }

function resourceLabel(resourceId: number): string {
  return resourceById(resourceId)?.name ?? `Resource ${resourceId}`
}

function formatDayIncomeNoticeLines(
  events: DayIncomeEvent[],
  playerId: string,
): string[] {
  const townLines: string[] = []
  const mineLines: string[] = []
  for (const event of events) {
    if (event.playerId !== playerId) {
      continue
    }
    if (event.kind === 'construct') {
      townLines.push(
        `${event.uniqueName} - ${event.verb} ${event.buildingName}`,
      )
      continue
    }
    if (event.kind === 'growth') {
      if (event.amount <= 0) {
        continue
      }
      townLines.push(
        `${event.uniqueName} - +${formatAmount(event.amount)} ${event.buildingName}`,
      )
      continue
    }
    if (event.amount <= 0) {
      continue
    }
    const res = resourceLabel(event.resourceId)
    if (event.kind === 'building') {
      townLines.push(
        `${event.townName}: ${event.buildingName} - ${formatAmount(event.amount)} ${res}`,
      )
    } else if (event.kind === 'unique') {
      townLines.push(
        `${event.uniqueName}: ${formatAmount(event.amount)} ${res}`,
      )
    } else {
      mineLines.push(
        `${res} Mines (${event.mineCount}) - ${formatAmount(event.amount)} ${res}`,
      )
    }
  }
  // Towns (weekly) first, then daily mine payouts.
  return [...townLines, ...mineLines]
}

const PLACEHOLDER_HERO_NAME = 'X1'
export const STARTING_HERO_LEVEL = 1
export const STARTING_HERO_XP = 0

export function emptyHeroProgress(): Record<string, HeroProgress> {
  return {}
}

function asHeroLevel(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 1) {
    return fallback
  }
  return Math.floor(n)
}

function asHeroXp(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 0) {
    return fallback
  }
  return Math.floor(n)
}

function asHeroPoolAmount(value: unknown, fallback: number): number {
  if (value == null || value === '') {
    return fallback
  }
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 0) {
    return fallback
  }
  return Math.floor(n)
}

function asAbilityIdList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter(
    (id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0,
  )
}

export function progressForHeroName(
  session: GameSession,
  name: string,
): HeroProgress {
  const saved = session.hero_progress?.[name]
  return {
    current_level: asHeroLevel(saved?.current_level, STARTING_HERO_LEVEL),
    current_xp: asHeroXp(saved?.current_xp, STARTING_HERO_XP),
  }
}

export function withNamedProgress(
  session: GameSession,
  name: string,
  live: HeroProgress,
): GameSession {
  if (!name || name === PLACEHOLDER_HERO_NAME) {
    return session
  }
  const existing = session.hero_progress?.[name]
  if (existing) {
    return session
  }
  return {
    ...session,
    hero_progress: {
      ...(session.hero_progress ?? {}),
      [name]: live,
    },
  }
}

export function setNamedProgress(
  session: GameSession,
  name: string,
  live: HeroProgress,
): GameSession {
  if (!name || name === PLACEHOLDER_HERO_NAME) {
    return session
  }
  return {
    ...session,
    hero_progress: {
      ...(session.hero_progress ?? {}),
      [name]: {
        current_level: asHeroLevel(live.current_level, STARTING_HERO_LEVEL),
        current_xp: asHeroXp(live.current_xp, STARTING_HERO_XP),
      },
    },
  }
}

export function normalizeHeroProgress(
  session: GameSession,
): GameSession {
  const progress: Record<string, HeroProgress> = {}
  const raw = session.hero_progress
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [name, row] of Object.entries(raw)) {
      if (!name || name === PLACEHOLDER_HERO_NAME) {
        continue
      }
      progress[name] = {
        current_level: asHeroLevel(row?.current_level, STARTING_HERO_LEVEL),
        current_xp: asHeroXp(row?.current_xp, STARTING_HERO_XP),
      }
    }
  }
  const heroes = session.heroes.map((hero) => {
    const fromHero = {
      current_level: asHeroLevel(
        hero.current_level,
        progress[hero.name]?.current_level ?? STARTING_HERO_LEVEL,
      ),
      current_xp: asHeroXp(
        hero.current_xp,
        progress[hero.name]?.current_xp ?? STARTING_HERO_XP,
      ),
    }
    const pools = heroResourcePools(getCachedCatalog(), {
      class_id: hero.class_id,
      current_level: fromHero.current_level,
    })
    if (hero.name && hero.name !== PLACEHOLDER_HERO_NAME) {
      progress[hero.name] = progress[hero.name] ?? fromHero
    }
    return {
      ...hero,
      ...fromHero,
      current_mana: asHeroPoolAmount(hero.current_mana, pools.current_mana),
      current_energy: asHeroPoolAmount(hero.current_energy, pools.current_energy),
      used_abilities_this_battle: asAbilityIdList(hero.used_abilities_this_battle),
      used_abilities_today: asAbilityIdList(hero.used_abilities_today),
      arch_id:
        typeof hero.arch_id === 'number' && hero.arch_id > 0 ? hero.arch_id : null,
    }
  })
  return { ...session, heroes, hero_progress: progress }
}
export function hireHeroCostMap(): Record<number, number> {
  return hireHeroGoldCost(getCachedCatalog())
}

function heroNeedsPool(hero: Hero): boolean {
  return hero.class_id == null || hero.name === PLACEHOLDER_HERO_NAME
}

export function unusedHeroPool(
  session: GameSession,
  pool: HeroPoolRow[],
): HeroPoolRow[] {
  const used = new Set(
    session.heroes
      .filter((hero) => !heroNeedsPool(hero))
      .map((hero) => hero.name),
  )
  return pool.filter((row) => !used.has(row.name))
}

export function unusedTavernPool(
  session: GameSession,
  catalog: ReferenceCatalog,
  townTypeId: number,
): HeroPoolRow[] {
  return unusedHeroPool(session, tavernHirePool(catalog, townTypeId))
}

export function assignHeroesFromPool(
  session: GameSession,
  pool: HeroPoolRow[],
): GameSession {
  const available = unusedHeroPool(session, pool)
  if (available.length === 0) {
    return session
  }
  let nextAvailable = available
  let changed = false
  let progress = { ...(session.hero_progress ?? {}) }
  const heroes = session.heroes.map((hero) => {
    if (!heroNeedsPool(hero) || nextAvailable.length === 0) {
      return hero
    }
    const pick =
      nextAvailable[Math.floor(Math.random() * nextAvailable.length)]
    nextAvailable = nextAvailable.filter((row) => row.id !== pick.id)
    changed = true
    const live = progress[pick.name] ?? {
      current_level: STARTING_HERO_LEVEL,
      current_xp: STARTING_HERO_XP,
    }
    progress[pick.name] = live
    return {
      ...hero,
      name: pick.name,
      class_id: pick.class_id,
      image_path: pick.image_path,
      army: { ...hero.army, slot_0: pick.name },
      learned_abilities: hero.learned_abilities ?? [],
      current_level: live.current_level,
      current_xp: live.current_xp,
      arch_id: pick.arch_id ?? null,
      movement_remaining: heroMovementPoints(getCachedCatalog(), {
        class_id: pick.class_id,
        current_level: live.current_level,
      }),
      ...heroResourcePools(getCachedCatalog(), {
        class_id: pick.class_id,
        current_level: live.current_level,
      }),
    }
  })
  const withNames = changed ? { ...session, heroes, hero_progress: progress } : session
  if (!changed) {
    return withNames
  }
  let next = withNames
  for (const hero of next.heroes) {
    next = grantHeroStartingArmy(next, hero.id)
  }
  return next
}

function nextHeroId(session: GameSession): string {
  let n = session.heroes.length + 1
  let id = `hero-${n}`
  while (session.heroes.some((hero) => hero.id === id)) {
    n += 1
    id = `hero-${n}`
  }
  return id
}

export function hireHeroFromPool(
  session: GameSession,
  townId: string,
  pick: HeroPoolRow,
  spawnAt?: AxialPos | null,
): { session: GameSession; error: string | null } {
  const town = findTownById(session, townId)
  if (!town) {
    return { session, error: 'This town is not in the game session.' }
  }
  const onTown =
    spawnAt == null ||
    (spawnAt.q === town.position.q && spawnAt.r === town.position.r)
  if (onTown && visitingHeroId(session, town)) {
    return { session, error: 'A hero is visiting — cannot hire' }
  }
  if (unusedHeroPool(session, [pick]).length === 0) {
    return { session, error: 'That hero is already in this game.' }
  }
  const catalog = getCachedCatalog()
  if (catalog && tavernHirePool(catalog, town.town_type_id).every((row) => row.id !== pick.id)) {
    return { session, error: 'That hero cannot be hired in this town.' }
  }
  const spent = spendResources(session, hireHeroCostMap())
  if (spent.error) {
    return spent
  }
  const live = progressForHeroName(spent.session, pick.name)
  const hero: Hero = {
    id: nextHeroId(spent.session),
    player_id: actingPlayerId(spent.session) ?? HUMAN_PLAYER_ID,
    name: pick.name,
    class_id: pick.class_id,
    image_path: pick.image_path,
    position: spawnAt ? { ...spawnAt } : { ...town.position },
    army: {
      slot_0: pick.name,
      slots_1_to_6: Array.from({ length: ARMY_STACK_SLOTS }, () => null),
    },
    learned_abilities: [],
    current_level: live.current_level,
    current_xp: live.current_xp,
    used_abilities_this_battle: [],
    used_abilities_today: [],
    arch_id: pick.arch_id ?? null,
    movement_remaining: heroMovementPoints(getCachedCatalog(), {
      class_id: pick.class_id,
      current_level: live.current_level,
    }),
    flight: null,
    ...heroResourcePools(getCachedCatalog(), {
      class_id: pick.class_id,
      current_level: live.current_level,
    }),
  }
  return {
    session: grantHeroStartingArmy(
      withNamedProgress(
        {
          ...spent.session,
          heroes: [...spent.session.heroes, hero],
          players: spent.session.players.map((player) =>
            player.id === hero.player_id
              ? { ...player, hero_ids: [...player.hero_ids, hero.id] }
              : player,
          ),
        },
        pick.name,
        live,
      ),
      hero.id,
    ),
    error: null,
  }
}

export function walletFromPlayer(
  session: GameSession,
  playerId: string,
): ResourceWallet {
  const wallet = emptyWallet()
  const player = session.players.find((row) => row.id === playerId)
  if (!player) {
    return wallet
  }
  const weekly = playerWeeklyIncome(session, getCachedCatalog(), player.id)
  for (const resource of RESOURCES) {
    wallet[resource.id].stockpile = player.resources[resource.id] ?? 0
    wallet[resource.id].weeklyIncome = weekly[resource.id] ?? 0
  }
  return wallet
}

export function walletFromSession(session: GameSession): ResourceWallet {
  const player = activePlayer(session)
  if (!player) {
    return emptyWallet()
  }
  return walletFromPlayer(session, player.id)
}

export function applyWalletStockpiles(
  session: GameSession,
  wallet: ResourceWallet,
): GameSession {
  return {
    ...session,
    players: session.players.map((player) =>
      player.id === (activePlayer(session)?.id ?? HUMAN_PLAYER_ID)
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

const CHEST_GOLD = 10000
const CHEST_EACH = 20

/**
 * Debug: every hero learns all abilities at one Library tier (exclusive —
 * that tier only, both class disciplines). Does not grant other tiers.
 */
export function grantClassAbilitiesAtTier(
  session: GameSession,
  levelId: number,
): GameSession {
  const catalog = getCachedCatalog()
  if (!catalog) {
    return session
  }
  return {
    ...session,
    heroes: session.heroes.map((hero) => {
      const fromTier = classAbilityIdsAtTier(catalog, hero.class_id, levelId)
      if (fromTier.length === 0) {
        return hero
      }
      const have = new Set(hero.learned_abilities ?? [])
      for (const id of fromTier) {
        have.add(id)
      }
      return { ...hero, learned_abilities: [...have] }
    }),
  }
}

/** Debug/options: 10,000 gold plus 20 of every other resource. */
export function grantOpenChest(session: GameSession): GameSession {
  const player = activePlayer(session)
  if (!player) {
    return session
  }
  const catalog = getCachedCatalog()
  const ids =
    catalog && catalog.resource.length > 0
      ? catalog.resource.map((row) => row.id)
      : RESOURCES.map((row) => row.id)
  const resources = { ...player.resources }
  for (const id of ids) {
    const add = id === GOLD_RESOURCE_ID ? CHEST_GOLD : CHEST_EACH
    resources[id] = (resources[id] ?? 0) + add
  }
  return {
    ...session,
    players: session.players.map((row) =>
      row.id === player.id ? { ...row, resources } : row,
    ),
  }
}

/**
 * Debug/options: place basic (level-1) army dwellings for slots 11–16 on the
 * player's first controlled town. `armyChoice` 1 = first root per slot (by id),
 * 2 = second. Includes one week of initial growth in recruit_qty.
 */
export function grantBuildArmy(
  session: GameSession,
  armyChoice: 1 | 2,
): { session: GameSession; notice: string } {
  const player = activePlayer(session)
  if (!player) {
    return { session, notice: 'No active player.' }
  }
  const catalog = getCachedCatalog()
  if (!catalog) {
    return { session, notice: 'Catalog not loaded.' }
  }
  const town = session.towns.find((row) => row.player_id === player.id)
  if (!town) {
    return { session, notice: 'You do not control a town.' }
  }
  const rootIndex = armyChoice - 1
  let next = session
  let built = 0
  for (let slotNum = 11; slotNum <= 16; slotNum += 1) {
    if (!isArmySlot(slotNum)) {
      continue
    }
    const roots = armyOptions(catalog, slotNum, town.town_type_id)
      .filter(isBuildRoot)
      .sort((a, b) => a.id - b.id)
    const building = roots[rootIndex]
    if (!building) {
      continue
    }
    next = patchBuildingSlot(next, town.id, slotNum - 1, {
      level: 1,
      buildingId: building.id,
      recruitQty: buildingGrowth(building),
    })
    built += 1
  }
  if (built === 0) {
    return {
      session,
      notice: `No Army ${armyChoice} buildings defined for this town.`,
    }
  }
  const townLabel = town.name?.trim() || 'your first town'
  return {
    session: next,
    notice: `Built Army ${armyChoice} (slots 11–16) in ${townLabel} with initial growth`,
  }
}

/** Basic (slots 1–5, 11–16) + non-upgradeable (6–9) roots for every town. */
const BASIC_BUILD_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16] as const

/** Upgradeable slots that can gain +1 level (skip when capped). */
const UPGRADE_BUILD_SLOTS = [1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 16] as const

function slotAlreadyBuilt(
  session: GameSession,
  townId: string,
  slotNum: number,
): boolean {
  return session.building_states.some(
    (row) =>
      row.town_id === townId &&
      row.slot_num === slotNum &&
      row.building_id != null &&
      row.level >= 1,
  )
}

export function grantBuildBasicBuildings(
  session: GameSession,
): { session: GameSession; notice: string } {
  const catalog = getCachedCatalog()
  if (!catalog) {
    return { session, notice: 'Catalog not loaded.' }
  }
  if (session.towns.length === 0) {
    return { session, notice: 'No towns in this game.' }
  }
  let next = session
  let built = 0
  for (const town of next.towns) {
    for (const slotNum of BASIC_BUILD_SLOTS) {
      if (slotAlreadyBuilt(next, town.id, slotNum)) {
        continue
      }
      const building = isArmySlot(slotNum)
        ? armyOptions(catalog, slotNum, town.town_type_id)
            .filter(isBuildRoot)
            .sort((a, b) => a.id - b.id)[0]
        : genericRoot(
            genericSlotBuildings(catalog, slotNum, town.town_type_id),
          )
      if (!building) {
        continue
      }
      next = patchBuildingSlot(next, town.id, slotNum - 1, {
        level: 1,
        buildingId: building.id,
        recruitQty: isArmySlot(slotNum) ? buildingGrowth(building) : 0,
      })
      if (isLibraryBuilding(building)) {
        next = ensureLibraryOffers(
          next,
          catalog,
          town.id,
          town.town_type_id,
          slotNum,
        )
      }
      built += 1
    }
  }
  return {
    session: next,
    notice:
      built > 0
        ? `Built ${built} basic building(s) across ${session.towns.length} town(s).`
        : 'All basic building slots already filled.',
  }
}

export function grantUpgradeBuildings(
  session: GameSession,
): { session: GameSession; notice: string } {
  const catalog = getCachedCatalog()
  if (!catalog) {
    return { session, notice: 'Catalog not loaded.' }
  }
  if (session.towns.length === 0) {
    return { session, notice: 'No towns in this game.' }
  }
  let next = session
  let upgraded = 0
  let skipped = 0
  for (const town of next.towns) {
    for (const slotNum of UPGRADE_BUILD_SLOTS) {
      const state = next.building_states.find(
        (row) => row.town_id === town.id && row.slot_num === slotNum,
      )
      if (!state || state.building_id == null || state.level < 1) {
        continue
      }
      const current = buildingById(catalog, state.building_id)
      if (!current) {
        continue
      }
      const advanced = nextInChain(
        current,
        catalog,
        slotNum,
        town.town_type_id,
      )
      if (!advanced) {
        skipped += 1
        continue
      }
      next = patchBuildingSlot(next, town.id, slotNum - 1, {
        level: Math.max(1, advanced.level),
        buildingId: advanced.id,
        recruitQty: state.recruit_qty,
      })
      if (isLibraryBuilding(advanced)) {
        next = ensureLibraryOffers(
          next,
          catalog,
          town.id,
          town.town_type_id,
          slotNum,
        )
      }
      upgraded += 1
    }
  }
  return {
    session: next,
    notice:
      upgraded > 0
        ? `Upgraded ${upgraded} building(s) (+1 level); skipped ${skipped} empty/capped.`
        : 'No upgradeable buildings (empty or already capped).',
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

export function playerMarketplaceCount(
  session: GameSession,
  catalog: ReferenceCatalog,
): number {
  const player = humanPlayer(session)
  if (!player) {
    return 0
  }
  const ownedTownIds = new Set(
    session.towns
      .filter((town) => town.player_id === player.id)
      .map((town) => town.id),
  )
  return countOwnedMarketplaces(catalog, ownedTownIds, session.building_states)
}

export function executeMarketTrade(
  session: GameSession,
  catalog: ReferenceCatalog,
  sellId: number,
  buyId: number,
  edited: 'sell' | 'buy',
  qty: number,
): { session: GameSession; error: string | null } {
  if (sellId === buyId) {
    return { session, error: 'Choose two different resources.' }
  }
  const player = humanPlayer(session)
  if (!player) {
    return { session, error: 'No player.' }
  }
  const rate = marketConversionRate(
    catalog.market,
    playerMarketplaceCount(session, catalog),
  )
  if (rate == null) {
    return { session, error: 'Market rates are not loaded.' }
  }
  const ownedSell = player.resources[sellId] ?? 0
  const quote = quoteMarketTrade(
    catalog,
    sellId,
    buyId,
    rate,
    edited,
    qty,
    ownedSell,
  )
  if (!quote || quote.sellQty <= 0 || quote.buyQty <= 0) {
    return { session, error: 'Trade is not valid.' }
  }
  if (quote.sellQty > ownedSell) {
    return { session, error: 'Not enough to sell.' }
  }
  const wallet = walletFromSession(session)
  const sellEntry = wallet[sellId]
  const buyEntry = wallet[buyId]
  if (!sellEntry || !buyEntry) {
    return { session, error: 'Unknown resource.' }
  }
  const next = snapshotWallet(wallet)
  next[sellId].stockpile -= quote.sellQty
  next[buyId].stockpile += quote.buyQty
  return { session: applyWalletStockpiles(session, next), error: null }
}

export function executeMarketMultiSell(
  session: GameSession,
  catalog: ReferenceCatalog,
  sellIds: number[],
  buyId: number,
): { session: GameSession; error: string | null } {
  const player = humanPlayer(session)
  if (!player) {
    return { session, error: 'No player.' }
  }
  const rate = marketConversionRate(
    catalog.market,
    playerMarketplaceCount(session, catalog),
  )
  if (rate == null) {
    return { session, error: 'Market rates are not loaded.' }
  }
  const quote = quoteMultiSell(catalog, sellIds, buyId, rate, player.resources)
  if (quote.buyTotal <= 0 || quote.included.length === 0) {
    return { session, error: 'Trade is not valid.' }
  }
  const wallet = walletFromSession(session)
  const buyEntry = wallet[buyId]
  if (!buyEntry) {
    return { session, error: 'Unknown resource.' }
  }
  const next = snapshotWallet(wallet)
  for (const line of quote.included) {
    const sellEntry = next[line.sellId]
    if (!sellEntry || line.sellQty > (player.resources[line.sellId] ?? 0)) {
      return { session, error: 'Not enough to sell.' }
    }
    sellEntry.stockpile -= line.sellQty
  }
  next[buyId].stockpile += quote.buyTotal
  return { session: applyWalletStockpiles(session, next), error: null }
}

export function applyMineIncome(session: GameSession): GameSession {
  return applyMineIncomeWithReport(session).session
}

function applyMineIncomeWithReport(session: GameSession): {
  session: GameSession
  events: DayIncomeEvent[]
} {
  const catalog = getCachedCatalog()
  const payoutByPlayer = new Map<
    string,
    Map<number, { amount: number; mineCount: number }>
  >()
  const nodes = session.nodes.map((node) => {
    if (node.kind !== 'mine' || node.player_id == null) {
      return node
    }
    const rate = resourceDailyMineRate(catalog, node.resource_id)
    if (rate <= 0) {
      return node
    }
    let accrued = (node.accrued_fraction ?? 0) + rate
    const whole = Math.floor(accrued)
    accrued -= whole
    const byRes =
      payoutByPlayer.get(node.player_id) ??
      new Map<number, { amount: number; mineCount: number }>()
    const bag = byRes.get(node.resource_id) ?? { amount: 0, mineCount: 0 }
    bag.mineCount += 1
    if (whole > 0) {
      bag.amount += whole
    }
    byRes.set(node.resource_id, bag)
    payoutByPlayer.set(node.player_id, byRes)
    return { ...node, accrued_fraction: accrued }
  })
  const events: DayIncomeEvent[] = []
  for (const [playerId, byRes] of payoutByPlayer) {
    for (const [resourceId, bag] of byRes) {
      if (bag.amount > 0) {
        events.push({
          kind: 'mine',
          playerId,
          resourceId,
          amount: bag.amount,
          mineCount: bag.mineCount,
        })
      }
    }
  }
  if (events.length === 0) {
    const changed = nodes.some(
      (node, i) => node.accrued_fraction !== session.nodes[i]?.accrued_fraction,
    )
    return {
      session: changed ? { ...session, nodes } : session,
      events,
    }
  }
  return {
    session: {
      ...session,
      nodes,
      players: session.players.map((player) => {
        if (isPlayerEliminated(session, player)) {
          return player
        }
        const byRes = payoutByPlayer.get(player.id)
        if (!byRes) {
          return player
        }
        const resources = { ...player.resources }
        for (const [resourceId, bag] of byRes) {
          if (bag.amount > 0) {
            resources[resourceId] = (resources[resourceId] ?? 0) + bag.amount
          }
        }
        return { ...player, resources }
      }),
    },
    events,
  }
}

export function slotStatesForTown(session: GameSession, townId: string): SlotState[] {
  const slots: SlotState[] = Array.from({ length: BUILDING_SLOT_COUNT }, () => ({
    level: 0,
    buildingId: null,
    recruitQty: 0,
  }))
  for (const row of session.building_states) {
    if (row.town_id !== townId) {
      continue
    }
    const index = row.slot_num - 1
    if (index >= 0 && index < slots.length) {
      slots[index] = {
        level: row.level,
        buildingId: row.building_id,
        recruitQty: row.recruit_qty,
      }
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
    offered_abilities: [],
  }))
}

function withBuildingSlots(session: GameSession, townId: string): GameSession {
  const existing = session.building_states.filter((row) => row.town_id === townId)
  if (existing.length === 0) {
    return {
      ...session,
      building_states: [...session.building_states, ...emptyBuildingStates(townId)],
    }
  }
  const have = new Set(existing.map((row) => row.slot_num))
  const missing: BuildingState[] = []
  for (let slotNum = 1; slotNum <= BUILDING_SLOT_COUNT; slotNum += 1) {
    if (!have.has(slotNum)) {
      missing.push({
        id: `${townId}-slot-${slotNum}`,
        town_id: townId,
        building_id: null,
        slot_num: slotNum,
        level: 0,
        recruit_qty: 0,
        offered_abilities: [],
      })
    }
  }
  if (missing.length === 0) {
    return session
  }
  return {
    ...session,
    building_states: [...session.building_states, ...missing],
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
          recruit_qty: next.recruitQty,
          offered_abilities: [],
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
            recruit_qty: next.recruitQty,
            growth_bonus: row.growth_bonus ?? 0,
            offered_abilities:
              next.level === 0 ? [] : (row.offered_abilities ?? []),
          }
        : row,
    ),
  }
}

/**
 * After a building is placed/upgraded in a town: Infernal Archive grants its
 * visit learn effect immediately if a hero is already standing in town.
 */
export function afterTownBuildingPlaced(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
  building: BuildingRow,
): GameSession {
  const town = session.towns.find((row) => row.id === townId)
  if (!town) {
    return session
  }
  return maybeApplyInfernalArchiveAfterBuild(
    session,
    catalog,
    town,
    building,
    visitingHeroId(session, town),
  )
}

export function ensureLibraryOffers(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
  townTypeId: number,
  slotNum: number,
): GameSession {
  let changed = false
  const building_states = session.building_states.map((row) => {
    if (row.town_id !== townId || row.slot_num !== slotNum) {
      return row
    }
    if (row.level < 1 || row.building_id == null) {
      return row
    }
    const offered = mergeLibraryOffers(
      row.offered_abilities,
      catalog,
      row.building_id,
      townTypeId,
      row.level,
    )
    if (offered === row.offered_abilities) {
      return row
    }
    changed = true
    return { ...row, offered_abilities: offered }
  })
  return changed ? { ...session, building_states } : session
}

export function learnLibraryAbility(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
  heroId: string,
  abilityId: number,
): { session: GameSession; error: string | null } {
  const town = findTownById(session, townId)
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!town || !hero) {
    return { session, error: 'This town is not in the game session.' }
  }
  if (visitingHeroId(session, town) !== heroId) {
    return { session, error: 'A hero must be visiting this town.' }
  }
  const ability = abilityById(catalog, abilityId)
  if (!ability) {
    return { session, error: 'Unknown ability.' }
  }
  if ((hero.learned_abilities ?? []).includes(abilityId)) {
    return { session, error: 'Already learned.' }
  }
  if (!heroHasDiscipline(catalog, hero.class_id, ability.discipline_id)) {
    return { session, error: 'This hero cannot learn that ability.' }
  }
  const library = session.building_states.find((row) => {
    if (row.town_id !== townId || row.level < ability.level_id || row.building_id == null) {
      return false
    }
    const building = buildingById(catalog, row.building_id)
    return building != null && isLibraryBuilding(building)
  })
  if (!library) {
    return { session, error: 'That tier is not open yet.' }
  }
  const offer = findOffer(
    library.offered_abilities,
    ability.discipline_id,
    ability.level_id,
  )
  if (!offer || !offer.ability_ids.includes(abilityId)) {
    return { session, error: 'That ability is not on offer.' }
  }
  const spent = spendResources(session, goldCostForLevel(ability.level_id))
  if (spent.error) {
    return spent
  }
  return {
    session: {
      ...spent.session,
      heroes: spent.session.heroes.map((row) =>
        row.id === heroId
          ? {
              ...row,
              learned_abilities: [...(row.learned_abilities ?? []), abilityId],
            }
          : row,
      ),
    },
    error: null,
  }
}

export function applyWeeklyGrowth(
  session: GameSession,
  catalog: ReferenceCatalog,
): GameSession {
  return applyWeeklyGrowthWithReport(session, catalog).session
}

function applyWeeklyGrowthWithReport(
  session: GameSession,
  catalog: ReferenceCatalog,
): { session: GameSession; events: DayIncomeEvent[] } {
  // Beacon must roll against pre-growth Curr Recruits, then growth stacks on top.
  const beacon = applyRecruitmentBeaconsBeforeGrowth(session, catalog)
  const grown: GameSession = {
    ...beacon.session,
    building_states: beacon.session.building_states.map((row) => {
      if (row.level < 1 || row.building_id == null || !isArmySlot(row.slot_num)) {
        return row
      }
      const growth =
        buildingGrowth(buildingById(catalog, row.building_id)) +
        (row.growth_bonus ?? 0)
      if (growth <= 0) {
        return row
      }
      return { ...row, recruit_qty: row.recruit_qty + growth }
    }),
  }
  const income = applyWeeklyBuildingIncomeWithReport(grown, catalog)
  const uniques = applyWeeklyTownUniquesWithReport(income.session, catalog)
  const uniqueEvents: DayIncomeEvent[] = []
  for (const event of [...beacon.events, ...uniques.events]) {
    if (event.kind === 'construct') {
      uniqueEvents.push({
        kind: 'construct',
        playerId: event.playerId,
        uniqueName: event.uniqueName,
        verb: event.verb,
        buildingName: event.buildingName,
      })
    } else if (event.kind === 'growth') {
      uniqueEvents.push({
        kind: 'growth',
        playerId: event.playerId,
        uniqueName: event.uniqueName,
        buildingName: event.buildingName,
        amount: event.amount,
      })
    } else {
      uniqueEvents.push({
        kind: 'unique',
        playerId: event.playerId,
        townName: event.townName,
        uniqueName: event.uniqueName,
        resourceId: event.resourceId,
        amount: event.amount,
      })
    }
  }
  return {
    session: uniques.session,
    events: [...income.events, ...uniqueEvents],
  }
}

function addGrant(
  grants: Map<string, Record<number, number>>,
  playerId: string,
  resourceId: number,
  amount: number,
): void {
  if (amount <= 0) {
    return
  }
  const current = grants.get(playerId) ?? {}
  current[resourceId] = (current[resourceId] ?? 0) + amount
  grants.set(playerId, current)
}

/**
 * Fixed weekly `payload.produces` from a player's owned towns (Halls, Resource
 * Generators, etc.). Excludes Town Unique random effects — those are applied
 * separately and must not appear in the ResourceBar weekly total.
 */
export function weeklyBuildingProducesForPlayer(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  playerId: string,
): Record<number, number> {
  const totals: Record<number, number> = {}
  if (!catalog) {
    return totals
  }
  for (const town of session.towns) {
    if (town.player_id !== playerId) {
      continue
    }
    for (const row of session.building_states) {
      if (row.town_id !== town.id || row.level < 1 || row.building_id == null) {
        continue
      }
      const building = buildingById(catalog, row.building_id)
      for (const grant of buildingProduces(building)) {
        totals[grant.resourceId] = (totals[grant.resourceId] ?? 0) + grant.qty
      }
    }
  }
  return totals
}

/** Building produces + owned mine `weekly_node` — display/tick shared total. */
export function playerWeeklyIncome(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  playerId: string,
): Record<number, number> {
  const totals = weeklyBuildingProducesForPlayer(session, catalog, playerId)
  for (const node of session.nodes) {
    if (node.kind !== 'mine' || node.player_id !== playerId) {
      continue
    }
    const weekly = resourceWeeklyNode(catalog, node.resource_id)
    if (weekly <= 0) {
      continue
    }
    totals[node.resource_id] = (totals[node.resource_id] ?? 0) + weekly
  }
  return totals
}

/** Owned towns: each built building’s `payload.produces` credits the owner. */
function applyWeeklyBuildingIncome(
  session: GameSession,
  catalog: ReferenceCatalog,
): GameSession {
  return applyWeeklyBuildingIncomeWithReport(session, catalog).session
}

function applyWeeklyBuildingIncomeWithReport(
  session: GameSession,
  catalog: ReferenceCatalog,
): { session: GameSession; events: DayIncomeEvent[] } {
  const grants = new Map<string, Record<number, number>>()
  const events: DayIncomeEvent[] = []
  for (const town of session.towns) {
    if (!town.player_id) {
      continue
    }
    for (const row of session.building_states) {
      if (row.town_id !== town.id || row.level < 1 || row.building_id == null) {
        continue
      }
      const building = buildingById(catalog, row.building_id)
      if (!building) {
        continue
      }
      for (const grant of buildingProduces(building)) {
        addGrant(grants, town.player_id, grant.resourceId, grant.qty)
        events.push({
          kind: 'building',
          playerId: town.player_id,
          townName: town.name,
          buildingName: building.name,
          resourceId: grant.resourceId,
          amount: grant.qty,
        })
      }
    }
  }
  if (grants.size === 0) {
    return { session, events }
  }
  return {
    session: {
      ...session,
      players: session.players.map((player) => {
        const add = grants.get(player.id)
        if (!add) {
          return player
        }
        const resources = { ...player.resources }
        for (const [key, amount] of Object.entries(add)) {
          const id = Number(key)
          resources[id] = (resources[id] ?? 0) + amount
        }
        return { ...player, resources }
      }),
    },
    events,
  }
}

function nextStackId(session: GameSession): string {
  let n = session.units.length + 1
  while (session.units.some((unit) => unit.id === `unit-${n}`)) {
    n += 1
  }
  return `unit-${n}`
}

export function nextUnitStackId(session: GameSession): string {
  return nextStackId(session)
}

export function addHeroStackQty(
  session: GameSession,
  stackId: string,
  qty: number,
): GameSession {
  if (qty <= 0) {
    return session
  }
  return {
    ...session,
    units: session.units.map((row) =>
      row.id === stackId ? { ...row, qty: row.qty + qty } : row,
    ),
  }
}

export function insertHeroArmyStack(
  session: GameSession,
  heroId: string,
  slot: number,
  stack: { id: string; unitId: number; qty: number },
): GameSession {
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero || stack.qty <= 0 || slot < 0 || slot >= ARMY_STACK_SLOTS) {
    return session
  }
  const slots = [...hero.army.slots_1_to_6]
  while (slots.length < ARMY_STACK_SLOTS) {
    slots.push(null)
  }
  const existingId = slots[slot]
  const existing = existingId
    ? session.units.find((row) => row.id === existingId)
    : null
  if (existing && existing.unit_id === stack.unitId) {
    return addHeroStackQty(session, existing.id, stack.qty)
  }
  if (existingId) {
    return session
  }
  slots[slot] = stack.id
  const row: UnitStack = {
    id: stack.id,
    unit_id: stack.unitId,
    qty: stack.qty,
    town_id: null,
    hero_id: heroId,
    mob_id: null,
  }
  return {
    ...session,
    units: [...session.units, row],
    heroes: session.heroes.map((entry) =>
      entry.id === heroId
        ? { ...entry, army: { ...entry.army, slots_1_to_6: slots } }
        : entry,
    ),
  }
}

export type ArmyAbsorbPart = {
  unitId: number
  qty: number
}

function matchingSlotId(
  session: GameSession,
  slots: Array<string | null>,
  unitId: number,
): string | null {
  for (const id of slots) {
    if (!id) {
      continue
    }
    const row = session.units.find((unit) => unit.id === id)
    if (row && row.unit_id === unitId && row.qty > 0) {
      return row.id
    }
  }
  return null
}

function firstEmptySlot(slots: Array<string | null>): number | null {
  const padded = padStackSlots(slots)
  const index = padded.findIndex((id) => id == null)
  return index >= 0 ? index : null
}

function insertGarrisonStack(
  session: GameSession,
  townId: string,
  slot: number,
  stack: { id: string; unitId: number; qty: number },
): GameSession {
  const town = session.towns.find((row) => row.id === townId)
  if (!town || stack.qty <= 0 || slot < 0 || slot >= ARMY_STACK_SLOTS) {
    return session
  }
  const slots = padStackSlots(town.garrison.slots_1_to_6)
  const existingId = slots[slot]
  const existing = existingId
    ? session.units.find((row) => row.id === existingId)
    : null
  if (existing && existing.unit_id === stack.unitId) {
    return addHeroStackQty(session, existing.id, stack.qty)
  }
  if (existingId) {
    return session
  }
  slots[slot] = stack.id
  const row: UnitStack = {
    id: stack.id,
    unit_id: stack.unitId,
    qty: stack.qty,
    town_id: townId,
    hero_id: null,
    mob_id: null,
  }
  return {
    ...session,
    units: [...session.units, row],
    towns: session.towns.map((entry) =>
      entry.id === townId
        ? { ...entry, garrison: { ...entry.garrison, slots_1_to_6: slots } }
        : entry,
    ),
  }
}

/** Same-type merge, then open hero slots, then owned-town garrison if present. */
export function canFullyAbsorbParts(
  session: GameSession,
  heroId: string,
  parts: ArmyAbsorbPart[],
  townId: string | null,
): boolean {
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero) {
    return false
  }
  const heroTypes = new Set<number>()
  let openHero = 0
  for (const id of padStackSlots(hero.army.slots_1_to_6)) {
    if (!id) {
      openHero += 1
      continue
    }
    const row = session.units.find((unit) => unit.id === id)
    if (row && row.qty > 0) {
      heroTypes.add(row.unit_id)
    } else {
      openHero += 1
    }
  }
  const town = townId
    ? session.towns.find((row) => row.id === townId)
    : undefined
  const garrisonTypes = new Set<number>()
  let openGarrison = 0
  if (town) {
    for (const id of padStackSlots(town.garrison.slots_1_to_6)) {
      if (!id) {
        openGarrison += 1
        continue
      }
      const row = session.units.find((unit) => unit.id === id)
      if (row && row.qty > 0) {
        garrisonTypes.add(row.unit_id)
      } else {
        openGarrison += 1
      }
    }
  }
  for (const part of parts) {
    if (part.qty <= 0) {
      continue
    }
    if (heroTypes.has(part.unitId)) {
      continue
    }
    if (openHero > 0) {
      openHero -= 1
      heroTypes.add(part.unitId)
      continue
    }
    if (garrisonTypes.has(part.unitId)) {
      continue
    }
    if (openGarrison > 0) {
      openGarrison -= 1
      garrisonTypes.add(part.unitId)
      continue
    }
    return false
  }
  return true
}

export function absorbPartsIntoHeroOrGarrison(
  session: GameSession,
  heroId: string,
  parts: ArmyAbsorbPart[],
  townId: string | null,
): GameSession {
  let next = session
  for (const part of parts) {
    if (part.qty <= 0) {
      continue
    }
    const hero = next.heroes.find((row) => row.id === heroId)
    if (!hero) {
      return next
    }
    const heroMatch = matchingSlotId(next, hero.army.slots_1_to_6, part.unitId)
    if (heroMatch) {
      next = addHeroStackQty(next, heroMatch, part.qty)
      continue
    }
    const heroSlot = firstEmptySlot(hero.army.slots_1_to_6)
    if (heroSlot != null) {
      next = insertHeroArmyStack(next, heroId, heroSlot, {
        id: nextUnitStackId(next),
        unitId: part.unitId,
        qty: part.qty,
      })
      continue
    }
    const town = townId
      ? next.towns.find((row) => row.id === townId)
      : undefined
    if (!town) {
      return next
    }
    const garrisonMatch = matchingSlotId(
      next,
      town.garrison.slots_1_to_6,
      part.unitId,
    )
    if (garrisonMatch) {
      next = addHeroStackQty(next, garrisonMatch, part.qty)
      continue
    }
    const garrisonSlot = firstEmptySlot(town.garrison.slots_1_to_6)
    if (garrisonSlot != null) {
      next = insertGarrisonStack(next, town.id, garrisonSlot, {
        id: nextUnitStackId(next),
        unitId: part.unitId,
        qty: part.qty,
      })
    }
  }
  return next
}

const STARTING_T1_MIN = 6
const STARTING_T1_MAX = 10
const STARTING_T2_MIN = 2
const STARTING_T2_MAX = 5
const STARTING_T2_CHANCE = 0.8

function randomInclusive(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

export function heroArmyStackCount(session: GameSession, heroId: string): number {
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero) {
    return 0
  }
  let count = 0
  for (const id of padStackSlots(hero.army.slots_1_to_6)) {
    if (!id) {
      continue
    }
    const stack = session.units.find((row) => row.id === id)
    if (stack && stack.qty > 0) {
      count += 1
    }
  }
  return count
}

/** Hire / spawn: class-branch Tier 1 (6–10) and 80% Tier 2 (2–5). No-op if army exists. */
export function grantHeroStartingArmy(
  session: GameSession,
  heroId: string,
): GameSession {
  const hero = session.heroes.find((row) => row.id === heroId)
  const catalog = getCachedCatalog()
  if (!hero || !catalog || hero.class_id == null) {
    return session
  }
  if (heroArmyStackCount(session, heroId) > 0) {
    return session
  }
  const tier1 = classBranchBaseUnit(catalog, hero.class_id, 1)
  const tier2 = classBranchBaseUnit(catalog, hero.class_id, 2)
  let next = session
  if (tier1) {
    next = insertHeroArmyStack(next, heroId, 0, {
      id: nextStackId(next),
      unitId: tier1.id,
      qty: randomInclusive(STARTING_T1_MIN, STARTING_T1_MAX),
    })
  }
  if (tier2 && Math.random() < STARTING_T2_CHANCE) {
    next = insertHeroArmyStack(next, heroId, 1, {
      id: nextStackId(next),
      unitId: tier2.id,
      qty: randomInclusive(STARTING_T2_MIN, STARTING_T2_MAX),
    })
  }
  return next
}

export type ArmyRowId = 'garrison' | 'hero'

export type ArmySlotRef = {
  row: ArmyRowId
  slot: number
  heroId?: string | null
}

function sameArmyRow(from: ArmySlotRef, to: ArmySlotRef): boolean {
  return from.row === to.row && (from.heroId ?? null) === (to.heroId ?? null)
}

function isStackSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= ARMY_STACK_SLOTS
}

function padStackSlots(slots: Array<string | null>): Array<string | null> {
  const next = slots.slice(0, ARMY_STACK_SLOTS)
  while (next.length < ARMY_STACK_SLOTS) {
    next.push(null)
  }
  return next
}

function rowStackSlots(
  session: GameSession,
  townId: string,
  row: ArmyRowId,
  heroId?: string | null,
): {
  slots: Array<string | null>
  heroId: string | null
  error: string | null
} {
  if (row === 'garrison') {
    const town = session.towns.find((item) => item.id === townId)
    if (!town) {
      return { slots: [], heroId: null, error: 'This town is not in the game session.' }
    }
    return {
      slots: padStackSlots(town.garrison.slots_1_to_6),
      heroId: null,
      error: null,
    }
  }
  const town = session.towns.find((item) => item.id === townId)
  const resolved =
    heroId ?? (town ? visitingHeroId(session, town) : null)
  const hero = resolved
    ? session.heroes.find((item) => item.id === resolved)
    : null
  if (!hero) {
    return { slots: [], heroId: null, error: 'No hero is in this town.' }
  }
  return {
    slots: padStackSlots(hero.army.slots_1_to_6),
    heroId: hero.id,
    error: null,
  }
}

function writeRowSlots(
  session: GameSession,
  townId: string,
  row: ArmyRowId,
  slots: Array<string | null>,
  units: UnitStack[],
  heroId?: string | null,
): GameSession {
  if (row === 'garrison') {
    return {
      ...session,
      units,
      towns: session.towns.map((town) =>
        town.id === townId
          ? { ...town, garrison: { ...town.garrison, slots_1_to_6: slots } }
          : town,
      ),
    }
  }
  const town = session.towns.find((item) => item.id === townId)
  const resolved =
    heroId ?? (town ? visitingHeroId(session, town) : null)
  return {
    ...session,
    units,
    heroes: session.heroes.map((hero) =>
      hero.id === resolved
        ? { ...hero, army: { ...hero.army, slots_1_to_6: slots } }
        : hero,
    ),
  }
}

function ownStack(
  stack: UnitStack,
  townId: string,
  row: ArmyRowId,
  heroId: string | null,
): UnitStack {
  return row === 'garrison'
    ? { ...stack, town_id: townId, hero_id: null }
    : { ...stack, town_id: null, hero_id: heroId }
}

function ownSlots(
  units: UnitStack[],
  slots: Array<string | null>,
  townId: string,
  row: ArmyRowId,
  heroId: string | null,
): UnitStack[] {
  const ids = new Set(slots.filter((id): id is string => id != null))
  return units.map((stack) =>
    ids.has(stack.id) ? ownStack(stack, townId, row, heroId) : stack,
  )
}

export type ArmyAllocPart = {
  unitId: number
  qty: number
}

export type ArmyAllocTarget = {
  heroId: string
  parts: ArmyAllocPart[]
}

/**
 * Rewrite hero armies (and optional garrison) from a shared pool to a computed
 * end-state. Does not simulate pickup/swap/split clicks.
 */
export function applyPooledArmyAllocation(
  session: GameSession,
  poolHeroIds: string[],
  poolTownId: string | null,
  heroTargets: ArmyAllocTarget[],
  garrisonParts: ArmyAllocPart[] = [],
  preserveStackIds: string[] = [],
): GameSession {
  const town = poolTownId
    ? session.towns.find((row) => row.id === poolTownId)
    : undefined
  const poolSlotIds: Array<string | null> = []
  for (const id of poolHeroIds) {
    const hero = session.heroes.find((row) => row.id === id)
    if (hero) {
      poolSlotIds.push(...padStackSlots(hero.army.slots_1_to_6))
    }
  }
  if (town) {
    poolSlotIds.push(...padStackSlots(town.garrison.slots_1_to_6))
  }
  const poolIds = new Set(
    poolSlotIds.filter((id): id is string => id != null),
  )
  const preserve = new Set(preserveStackIds.filter((id) => poolIds.has(id)))
  const used = new Set<string>()
  let units = [...session.units]
  const dummyTownId = poolTownId ?? ''

  const allocOne = (
    unitId: number,
    qty: number,
    row: ArmyRowId,
    ownerHeroId: string | null,
  ): string | null => {
    if (qty <= 0) {
      return null
    }
    const reusable = units.find(
      (stack) =>
        poolIds.has(stack.id) &&
        !used.has(stack.id) &&
        !preserve.has(stack.id) &&
        stack.unit_id === unitId,
    )
    if (reusable) {
      used.add(reusable.id)
      units = units.map((stack) =>
        stack.id === reusable.id
          ? ownStack({ ...stack, qty }, dummyTownId, row, ownerHeroId)
          : stack,
      )
      return reusable.id
    }
    const id = nextStackId({ ...session, units })
    used.add(id)
    units = [
      ...units,
      ownStack(
        {
          id,
          unit_id: unitId,
          qty,
          town_id: null,
          hero_id: null,
          mob_id: null,
        },
        dummyTownId,
        row,
        ownerHeroId,
      ),
    ]
    return id
  }

  const heroSlotMap = new Map<string, Array<string | null>>()
  for (const target of heroTargets) {
    heroSlotMap.set(
      target.heroId,
      padStackSlots(
        target.parts.slice(0, ARMY_STACK_SLOTS).map((part) =>
          allocOne(part.unitId, part.qty, 'hero', target.heroId),
        ),
      ),
    )
  }
  const garrisonSlots = town
    ? padStackSlots(
        garrisonParts.slice(0, ARMY_STACK_SLOTS).map((part) =>
          allocOne(part.unitId, part.qty, 'garrison', null),
        ),
      )
    : []

  const placed = new Set(
    [...heroSlotMap.values(), garrisonSlots]
      .flat()
      .filter((id): id is string => id != null),
  )
  units = units
    .filter(
      (stack) =>
        !poolIds.has(stack.id) || placed.has(stack.id) || preserve.has(stack.id),
    )
    .map((stack) =>
      preserve.has(stack.id) && !placed.has(stack.id)
        ? town
          ? { ...stack, town_id: town.id, hero_id: null }
          : stack
        : stack,
    )

  let next = { ...session, units }
  for (const [heroId, slots] of heroSlotMap) {
    next = writeRowSlots(next, dummyTownId, 'hero', slots, next.units, heroId)
  }
  if (town) {
    next = writeRowSlots(
      next,
      town.id,
      'garrison',
      garrisonSlots,
      next.units,
    )
  }
  return next
}

export function applyArmyAllocation(
  session: GameSession,
  townId: string,
  heroId: string,
  heroParts: ArmyAllocPart[],
  garrisonParts: ArmyAllocPart[],
  preserveStackIds: string[] = [],
): GameSession {
  return applyPooledArmyAllocation(
    session,
    [heroId],
    townId,
    [{ heroId, parts: heroParts }],
    garrisonParts,
    preserveStackIds,
  )
}

function commitRows(
  session: GameSession,
  townId: string,
  from: ArmySlotRef,
  fromSlots: Array<string | null>,
  fromHeroId: string | null,
  to: ArmySlotRef,
  toSlots: Array<string | null>,
  toHeroId: string | null,
  units: UnitStack[],
): GameSession {
  const sameRow = sameArmyRow(from, to)
  let nextUnits = ownSlots(units, fromSlots, townId, from.row, fromHeroId)
  if (!sameRow) {
    nextUnits = ownSlots(nextUnits, toSlots, townId, to.row, toHeroId)
  }
  let next = writeRowSlots(
    session,
    townId,
    from.row,
    fromSlots,
    nextUnits,
    from.heroId ?? fromHeroId,
  )
  if (!sameRow) {
    next = writeRowSlots(
      next,
      townId,
      to.row,
      toSlots,
      next.units,
      to.heroId ?? toHeroId,
    )
  }
  return next
}

const HERO_MIN_ARMY_ERROR = 'A hero must keep at least one unit stack.'

function stripsLastHeroStack(before: GameSession, after: GameSession): boolean {
  for (const hero of before.heroes) {
    if (
      heroArmyStackCount(before, hero.id) > 0 &&
      heroArmyStackCount(after, hero.id) === 0
    ) {
      return true
    }
  }
  return false
}

function commitArmyMove(
  session: GameSession,
  townId: string,
  from: ArmySlotRef,
  fromSlots: Array<string | null>,
  fromHeroId: string | null,
  to: ArmySlotRef,
  toSlots: Array<string | null>,
  toHeroId: string | null,
  units: UnitStack[],
): { session: GameSession; error: string | null } {
  const next = commitRows(
    session,
    townId,
    from,
    fromSlots,
    fromHeroId,
    to,
    toSlots,
    toHeroId,
    units,
  )
  if (stripsLastHeroStack(session, next)) {
    return { session, error: HERO_MIN_ARMY_ERROR }
  }
  return { session: next, error: null }
}

function guardHeroMin(
  before: GameSession,
  after: GameSession,
): { session: GameSession; error: string | null } {
  if (stripsLastHeroStack(before, after)) {
    return { session: before, error: HERO_MIN_ARMY_ERROR }
  }
  return { session: after, error: null }
}

export function placeArmyStack(
  session: GameSession,
  townId: string,
  from: ArmySlotRef,
  to: ArmySlotRef,
): { session: GameSession; error: string | null } {
  if (!isStackSlot(from.slot) || !isStackSlot(to.slot)) {
    return { session, error: "Can't drop on that slot." }
  }
  const sameRow = sameArmyRow(from, to)
  if (sameRow && from.slot === to.slot) {
    return { session, error: null }
  }
  const sourceRow = rowStackSlots(session, townId, from.row, from.heroId)
  if (sourceRow.error) {
    return { session, error: sourceRow.error }
  }
  const destRow = sameRow
    ? sourceRow
    : rowStackSlots(session, townId, to.row, to.heroId)
  if (destRow.error) {
    return { session, error: destRow.error }
  }
  const fromSlots = sourceRow.slots
  const toSlots = sameRow ? fromSlots : destRow.slots
  const fromIndex = from.slot - 1
  const toIndex = to.slot - 1
  const sourceId = fromSlots[fromIndex]
  if (!sourceId) {
    return { session, error: 'That slot is empty.' }
  }
  const source = session.units.find((row) => row.id === sourceId)
  if (!source) {
    return { session, error: 'That slot is empty.' }
  }
  const destId = toSlots[toIndex]
  if (!destId) {
    fromSlots[fromIndex] = null
    toSlots[toIndex] = sourceId
    return commitArmyMove(
      session,
      townId,
      from,
      fromSlots,
      sourceRow.heroId,
      to,
      toSlots,
      destRow.heroId,
      session.units,
    )
  }
  const dest = session.units.find((row) => row.id === destId)
  if (!dest) {
    fromSlots[fromIndex] = null
    toSlots[toIndex] = sourceId
    return commitArmyMove(
      session,
      townId,
      from,
      fromSlots,
      sourceRow.heroId,
      to,
      toSlots,
      destRow.heroId,
      session.units,
    )
  }
  if (dest.unit_id === source.unit_id) {
    const units = session.units
      .map((row) =>
        row.id === destId ? { ...row, qty: row.qty + source.qty } : row,
      )
      .filter((row) => row.id !== sourceId)
    fromSlots[fromIndex] = null
    return commitArmyMove(
      session,
      townId,
      from,
      fromSlots,
      sourceRow.heroId,
      to,
      toSlots,
      destRow.heroId,
      units,
    )
  }
  fromSlots[fromIndex] = destId
  toSlots[toIndex] = sourceId
  return commitArmyMove(
    session,
    townId,
    from,
    fromSlots,
    sourceRow.heroId,
    to,
    toSlots,
    destRow.heroId,
    session.units,
  )
}

export function splitArmyStack(
  session: GameSession,
  townId: string,
  from: ArmySlotRef,
  qty: number,
): { session: GameSession; heldStackId: string | null; error: string | null } {
  if (!isStackSlot(from.slot)) {
    return { session, heldStackId: null, error: "Can't split that slot." }
  }
  if (!Number.isInteger(qty) || qty < 1) {
    return {
      session,
      heldStackId: null,
      error: 'Enter a whole number less than the stack.',
    }
  }
  const sourceRow = rowStackSlots(session, townId, from.row, from.heroId)
  if (sourceRow.error) {
    return { session, heldStackId: null, error: sourceRow.error }
  }
  const stackId = sourceRow.slots[from.slot - 1]
  const stack = stackId
    ? session.units.find((row) => row.id === stackId)
    : null
  if (!stack) {
    return { session, heldStackId: null, error: 'That slot is empty.' }
  }
  if (qty >= stack.qty) {
    return {
      session,
      heldStackId: null,
      error: 'Split a smaller amount than the stack. Drag the whole stack to move it all.',
    }
  }
  const held: UnitStack = {
    id: nextStackId(session),
    unit_id: stack.unit_id,
    qty,
    town_id: stack.town_id,
    hero_id: stack.hero_id,
    mob_id: null,
  }
  return {
    session: {
      ...session,
      units: session.units
        .map((row) =>
          row.id === stack.id ? { ...row, qty: row.qty - qty } : row,
        )
        .concat(held),
    },
    heldStackId: held.id,
    error: null,
  }
}

function townProducesUnit(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
  unitId: number,
): boolean {
  return session.building_states.some((row) => {
    if (row.town_id !== townId || row.level < 1) {
      return false
    }
    return unitForBuilding(catalog, row.building_id)?.id === unitId
  })
}

export function stackUpgradeOffer(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
  stack: UnitStack,
): {
  advanced: NonNullable<ReturnType<typeof advancedUnitFor>>
  perUnit: ReturnType<typeof unitUpgradeCost>
  total: ReturnType<typeof unitUpgradeCost>
} | null {
  const unit = unitById(catalog, stack.unit_id)
  const advanced = advancedUnitFor(catalog, unit)
  if (!unit || !advanced) {
    return null
  }
  const perUnit = townUnitUpgradeCost(
    session,
    catalog,
    townId,
    unitUpgradeCost(unit),
  )
  if (Object.keys(perUnit).length === 0) {
    return null
  }
  if (!townProducesUnit(session, catalog, townId, advanced.id)) {
    return null
  }
  return {
    advanced,
    perUnit,
    total: scaleCost(perUnit, stack.qty),
  }
}

export function upgradeArmyStack(
  session: GameSession,
  townId: string,
  from: ArmySlotRef,
  catalog: ReferenceCatalog,
): { session: GameSession; error: string | null } {
  const sourceRow = rowStackSlots(session, townId, from.row, from.heroId)
  if (sourceRow.error) {
    return { session, error: sourceRow.error }
  }
  const stackId = sourceRow.slots[from.slot - 1]
  const stack = stackId
    ? session.units.find((row) => row.id === stackId)
    : null
  if (!stack) {
    return { session, error: 'That slot is empty.' }
  }
  const offer = stackUpgradeOffer(session, catalog, townId, stack)
  if (!offer) {
    return {
      session,
      error: 'This stack cannot be upgraded in this town.',
    }
  }
  const spent = spendResources(session, offer.total)
  if (spent.error) {
    return { session, error: spent.error }
  }
  return {
    session: {
      ...spent.session,
      units: spent.session.units.map((row) =>
        row.id === stack.id ? { ...row, unit_id: offer.advanced.id } : row,
      ),
    },
    error: null,
  }
}

export function dropHeldArmyStack(
  session: GameSession,
  townId: string,
  heldStackId: string,
  origin: ArmySlotRef,
  to: ArmySlotRef,
): { session: GameSession; error: string | null } {
  if (!isStackSlot(to.slot)) {
    return { session, error: "Can't drop on that slot." }
  }
  const held = session.units.find((row) => row.id === heldStackId)
  if (!held) {
    return { session, error: 'There is nothing to drop.' }
  }
  const destRow = rowStackSlots(session, townId, to.row, to.heroId)
  if (destRow.error) {
    return { session, error: destRow.error }
  }
  const toSlots = destRow.slots
  const destId = toSlots[to.slot - 1]
  if (!destId) {
    toSlots[to.slot - 1] = heldStackId
    const units = ownSlots(
      session.units,
      toSlots,
      townId,
      to.row,
      destRow.heroId,
    )
    return guardHeroMin(
      session,
      writeRowSlots(
        session,
        townId,
        to.row,
        toSlots,
        units,
        to.heroId ?? destRow.heroId,
      ),
    )
  }
  const dest = session.units.find((row) => row.id === destId)
  if (!dest) {
    toSlots[to.slot - 1] = heldStackId
    const units = ownSlots(
      session.units,
      toSlots,
      townId,
      to.row,
      destRow.heroId,
    )
    return guardHeroMin(
      session,
      writeRowSlots(
        session,
        townId,
        to.row,
        toSlots,
        units,
        to.heroId ?? destRow.heroId,
      ),
    )
  }
  if (dest.unit_id !== held.unit_id) {
    return { session, error: "Can't drop a split stack on a different unit." }
  }
  const units = session.units
    .map((row) =>
      row.id === destId ? { ...row, qty: row.qty + held.qty } : row,
    )
    .filter((row) => row.id !== heldStackId)
  void origin
  return guardHeroMin(
    session,
    writeRowSlots(
      session,
      townId,
      to.row,
      toSlots,
      units,
      to.heroId ?? destRow.heroId,
    ),
  )
}

export function returnHeldArmyStack(
  session: GameSession,
  townId: string,
  heldStackId: string,
  origin: ArmySlotRef,
): GameSession {
  const held = session.units.find((row) => row.id === heldStackId)
  if (!held) {
    return session
  }
  const sourceRow = rowStackSlots(session, townId, origin.row, origin.heroId)
  if (sourceRow.error) {
    return session
  }
  const originId = sourceRow.slots[origin.slot - 1]
  const originStack = originId
    ? session.units.find((row) => row.id === originId)
    : null
  if (originStack && originStack.unit_id === held.unit_id) {
    return {
      ...session,
      units: session.units
        .map((row) =>
          row.id === originStack.id ? { ...row, qty: row.qty + held.qty } : row,
        )
        .filter((row) => row.id !== heldStackId),
    }
  }
  if (!originId) {
    const slots = sourceRow.slots
    slots[origin.slot - 1] = heldStackId
    const units = ownSlots(
      session.units,
      slots,
      townId,
      origin.row,
      sourceRow.heroId,
    )
    return writeRowSlots(
      session,
      townId,
      origin.row,
      slots,
      units,
      origin.heroId ?? sourceRow.heroId,
    )
  }
  return session
}

export function recruitToGarrison(
  session: GameSession,
  townId: string,
  slotNum: number,
  qty: number,
  catalog: ReferenceCatalog,
): { session: GameSession; error: string | null } {
  if (!Number.isInteger(qty) || qty < 1) {
    return { session, error: 'Enter a whole number of units to recruit.' }
  }
  const town = session.towns.find((row) => row.id === townId)
  if (!town) {
    return { session, error: 'This town is not in the game session.' }
  }
  const buildingState = session.building_states.find(
    (row) => row.town_id === townId && row.slot_num === slotNum,
  )
  if (!buildingState || buildingState.level < 1 || buildingState.building_id == null) {
    return { session, error: 'There is no army building in this slot.' }
  }
  if (qty > buildingState.recruit_qty) {
    return { session, error: `Only ${buildingState.recruit_qty} available to recruit.` }
  }
  const unit = unitForBuilding(catalog, buildingState.building_id)
  if (!unit) {
    return { session, error: 'This building has no recruitable unit.' }
  }
  const cost = townRecruitCost(session, catalog, townId, unitCost(unit), qty)
  const slots = [...town.garrison.slots_1_to_6]
  while (slots.length < ARMY_STACK_SLOTS) {
    slots.push(null)
  }
  const matchIndex = slots.findIndex((stackId) => {
    if (!stackId) {
      return false
    }
    const stack = session.units.find((row) => row.id === stackId)
    return stack != null && stack.unit_id === unit.id && stack.town_id === townId
  })
  const emptyIndex = slots.findIndex((stackId) => stackId == null)
  if (matchIndex < 0 && emptyIndex < 0) {
    return { session, error: "Can't recruit, Garrison is full." }
  }
  const spent = spendResources(session, cost)
  if (spent.error) {
    return { session, error: spent.error }
  }
  let units = spent.session.units
  if (matchIndex >= 0) {
    const stackId = slots[matchIndex]
    units = units.map((row) =>
      row.id === stackId ? { ...row, qty: row.qty + qty } : row,
    )
  } else {
    const stack: UnitStack = {
      id: nextStackId(spent.session),
      unit_id: unit.id,
      qty,
      town_id: townId,
      hero_id: null,
      mob_id: null,
    }
    units = [...units, stack]
    slots[emptyIndex] = stack.id
  }
  return {
    session: {
      ...spent.session,
      units,
      building_states: spent.session.building_states.map((row) =>
        row.town_id === townId && row.slot_num === slotNum
          ? { ...row, recruit_qty: row.recruit_qty - qty }
          : row,
      ),
      towns: spent.session.towns.map((row) =>
        row.id === townId
          ? {
              ...row,
              garrison: { ...row.garrison, slots_1_to_6: slots },
            }
          : row,
      ),
    },
    error: null,
  }
}

function emptyGarrison(): Town['garrison'] {
  return {
    slots_1_to_6: Array.from({ length: 6 }, () => null),
  }
}

export function claimTown(
  session: GameSession,
  q: number,
  r: number,
  details?: { name?: string; townTypeId?: number; ownerId?: string },
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
  const ownerId = actingPlayerId(current, details?.ownerId)
  if (!ownerId || town.player_id === ownerId) {
    return current
  }
  const previousId = town.player_id
  return {
    ...current,
    towns: current.towns.map((t) =>
      t.id === town.id ? { ...t, player_id: ownerId } : t,
    ),
    players: current.players.map((player) => {
      if (player.id === ownerId && !player.town_ids.includes(town.id)) {
        return { ...player, town_ids: [...player.town_ids, town.id] }
      }
      if (previousId && player.id === previousId) {
        return {
          ...player,
          town_ids: player.town_ids.filter((id) => id !== town.id),
        }
      }
      return player
    }),
  }
}

export function claimMine(
  session: GameSession,
  q: number,
  r: number,
  resourceId?: number,
  ownerId?: string,
): GameSession {
  const actorId = actingPlayerId(session, ownerId)
  if (!actorId) {
    return session
  }
  const existing = session.nodes.find(
    (node) => node.kind === 'mine' && node.position.q === q && node.position.r === r,
  )
  if (existing) {
    if (existing.player_id === actorId) {
      return session
    }
    return {
      ...session,
      nodes: session.nodes.map((node) =>
        node.id === existing.id
          ? { ...node, player_id: actorId, accrued_fraction: 0 }
          : node,
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
    player_id: actorId,
    collected: false,
    qty: 0,
    accrued_fraction: 0,
  }
  return { ...session, nodes: [...session.nodes, node] }
}

export function collectPickup(
  session: GameSession,
  q: number,
  r: number,
  resourceId: number,
  amount: number,
  ownerId?: string,
): GameSession {
  const playerId = actingPlayerId(session, ownerId)
  if (!playerId) {
    return session
  }
  const existing = session.nodes.find(
    (node) => node.kind === 'pickup' && node.position.q === q && node.position.r === r,
  )
  const payout =
    existing != null && existing.qty > 0
      ? existing.qty
      : Math.max(0, Math.floor(amount))
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
          qty: payout,
          accrued_fraction: 0,
        },
      ]
  return {
    ...session,
    nodes,
    players: session.players.map((p) =>
      p.id === playerId
        ? {
            ...p,
            resources: {
              ...p.resources,
              [resourceId]: (p.resources[resourceId] ?? 0) + payout,
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
  heroId: string,
): GameSession {
  return {
    ...session,
    heroes: session.heroes.map((hero) => {
      if (hero.id !== heroId) {
        return hero
      }
      // Airborne position is owned by flight advance — don't let stale map
      // ground coords clobber it (e.g. heroRef still at the origin town).
      if (hero.flight) {
        return { ...hero, movement_remaining: 0 }
      }
      return {
        ...hero,
        position: { ...position },
        movement_remaining: movementRemaining,
      }
    }),
  }
}

export function restorePlayerHeroMovement(
  session: GameSession,
  playerId: string,
): GameSession {
  return {
    ...session,
    heroes: session.heroes.map((hero) => {
      if (hero.player_id !== playerId) {
        return hero
      }
      // In-flight heroes get no ground movement that day (advance happens on day tick).
      if (hero.flight) {
        return { ...hero, movement_remaining: 0 }
      }
      return {
        ...hero,
        movement_remaining: heroMovementPoints(getCachedCatalog(), hero),
      }
    }),
  }
}

const HANGER_SLOT = 8

export function isHeroInFlight(hero: Hero | null | undefined): boolean {
  return hero?.flight != null
}

/** Town has a built Hanger (slot 8). */
export function townHasHanger(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  townId: string,
): boolean {
  if (!catalog) {
    return false
  }
  return session.building_states.some((row) => {
    if (row.town_id !== townId || row.level < 1 || row.building_id == null) {
      return false
    }
    if (row.slot_num === HANGER_SLOT) {
      return true
    }
    const building = buildingById(catalog, row.building_id)
    return building?.slot_num === HANGER_SLOT
  })
}

export type FlightDestinationQuote = {
  town: Town
  distance: number
  goldCost: number
  /** True when departure rules block this pick (still listed for visibility). */
  blocked: boolean
}

/** Another of this player's heroes already flying to this town. */
function flightEnRouteToTown(
  session: GameSession,
  townId: string,
  playerId: string,
  exceptHeroId?: string | null,
): boolean {
  return session.heroes.some(
    (hero) =>
      hero.player_id === playerId &&
      hero.id !== exceptHeroId &&
      hero.flight?.destination_town_id === townId,
  )
}

/** Friendly town hero slot held by a grounded own hero. */
function townOwnHeroSlotOccupied(
  session: GameSession,
  town: Town,
  playerId: string,
): boolean {
  if (town.player_id !== playerId) {
    return false
  }
  const occupantId = visitingHeroId(session, town)
  if (!occupantId) {
    return false
  }
  const occupant = session.heroes.find((row) => row.id === occupantId)
  return occupant != null && occupant.player_id === playerId
}

/** Friendly Hanger towns the visiting hero can fly to (excludes current town). */
export function flightDestinationsFromTown(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  fromTownId: string,
  playerId: string,
  flyingHeroId?: string | null,
): FlightDestinationQuote[] {
  if (!catalog) {
    return []
  }
  const from = session.towns.find((town) => town.id === fromTownId)
  if (!from || !townHasHanger(session, catalog, from.id)) {
    return []
  }
  const perHex = flightCostPerHex(catalog)
  const out: FlightDestinationQuote[] = []
  for (const town of session.towns) {
    if (town.id === from.id) {
      continue
    }
    if (town.player_id !== playerId) {
      continue
    }
    if (!townHasHanger(session, catalog, town.id)) {
      continue
    }
    const distance = hexDistance(from.position, town.position)
    if (distance <= 0) {
      continue
    }
    const blocked =
      townOwnHeroSlotOccupied(session, town, playerId) ||
      flightEnRouteToTown(session, town.id, playerId, flyingHeroId)
    out.push({
      town,
      distance,
      goldCost: distance * perHex,
      blocked,
    })
  }
  return out.sort(
    (a, b) =>
      Number(a.blocked) - Number(b.blocked) ||
      a.distance - b.distance ||
      a.town.name.localeCompare(b.town.name),
  )
}

/**
 * Launch Hanger flight: charge gold and enter in-flight state.
 * Does not advance position — caller animates via {@link requestPlayHeroFlight}
 * (or day tick uses {@link advanceAllFlights}).
 */
export function launchHeroFlight(
  session: GameSession,
  heroId: string,
  destinationTownId: string,
  originTownId?: string,
): { session: GameSession; error: string | null } {
  const catalog = getCachedCatalog()
  if (!catalog) {
    return { session, error: 'Catalog not loaded.' }
  }
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero) {
    return { session, error: 'Hero not found.' }
  }
  if (hero.flight) {
    return { session, error: 'Already in flight.' }
  }
  const origin =
    (originTownId
      ? session.towns.find((town) => town.id === originTownId)
      : null) ?? findTownAt(session, hero.position.q, hero.position.r)
  if (!origin || origin.player_id !== hero.player_id) {
    return { session, error: 'Hero must be in a friendly town.' }
  }
  const atOrigin = findTownAt(session, hero.position.q, hero.position.r)
  if (!atOrigin || atOrigin.id !== origin.id) {
    return {
      session,
      error: 'Hero must be standing in this town to fly.',
    }
  }
  if (!townHasHanger(session, catalog, origin.id)) {
    return { session, error: 'This town has no Hanger.' }
  }
  const dest = session.towns.find((town) => town.id === destinationTownId)
  if (!dest) {
    return { session, error: 'Destination town not found.' }
  }
  if (dest.player_id !== hero.player_id) {
    return { session, error: 'Destination must be a friendly town.' }
  }
  if (!townHasHanger(session, catalog, dest.id)) {
    return { session, error: 'Destination has no Hanger.' }
  }
  if (dest.id === origin.id) {
    return { session, error: 'Pick a different town.' }
  }
  if (townOwnHeroSlotOccupied(session, dest, hero.player_id)) {
    return { session, error: 'Destination town hero slot is occupied.' }
  }
  if (flightEnRouteToTown(session, dest.id, hero.player_id, heroId)) {
    return { session, error: 'Another hero is already flying there.' }
  }
  const distance = hexDistance(origin.position, dest.position)
  if (!Number.isFinite(distance) || distance <= 0) {
    return { session, error: 'Invalid flight distance.' }
  }
  const goldCost = distance * flightCostPerHex(catalog)
  const spent = spendResources(session, { [GOLD_RESOURCE_ID]: goldCost })
  if (spent.error) {
    return { session, error: spent.error }
  }
  return {
    session: {
      ...spent.session,
      heroes: spent.session.heroes.map((row) =>
        row.id === heroId
          ? {
              ...row,
              flight: { destination_town_id: dest.id },
              movement_remaining: 0,
            }
          : row,
      ),
    },
    error: null,
  }
}

/** Update an airborne hero's map hex during flight animation. */
export function syncHeroFlightPosition(
  session: GameSession,
  position: { q: number; r: number },
  heroId: string,
): GameSession {
  return {
    ...session,
    heroes: session.heroes.map((hero) =>
      hero.id === heroId && hero.flight
        ? {
            ...hero,
            position: { ...position },
            movement_remaining: 0,
          }
        : hero,
    ),
  }
}

/**
 * After a flight segment animation (or instant day tick move), land if the
 * hero is on the destination hex and the town hero slot is free; otherwise
 * stay airborne (or enter circling around a friendly occupied town).
 */
export function finalizeHeroFlightSegment(
  session: GameSession,
  heroId: string,
): { session: GameSession; siegeTownId: string | null; arrivedTownId: string | null } {
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero?.flight) {
    return { session, siegeTownId: null, arrivedTownId: null }
  }
  const dest = session.towns.find(
    (town) => town.id === hero.flight!.destination_town_id,
  )
  if (!dest) {
    return {
      session: {
        ...session,
        heroes: session.heroes.map((row) =>
          row.id === heroId ? { ...row, flight: null, movement_remaining: 0 } : row,
        ),
      },
      siegeTownId: null,
      arrivedTownId: null,
    }
  }

  const tryLandFriendly = (): {
    session: GameSession
    siegeTownId: string | null
    arrivedTownId: string | null
  } | null => {
    if (dest.player_id !== hero.player_id) {
      return null
    }
    const occupantId = visitingHeroId(session, dest)
    if (occupantId && occupantId !== heroId) {
      // Slot occupied — orbit the 2×1 footprint; no progress toward landing.
      const alreadyCircling = hero.flight?.circling === true
      const onRing = alreadyCircling
        ? { ...hero.position }
        : nextTownCircleHex(dest.position, hero.position)
      return {
        session: {
          ...session,
          heroes: session.heroes.map((row) =>
            row.id === heroId
              ? {
                  ...row,
                  position: onRing,
                  movement_remaining: 0,
                  flight: {
                    destination_town_id: dest.id,
                    circling: true,
                  },
                }
              : row,
          ),
        },
        siegeTownId: null,
        arrivedTownId: null,
      }
    }
    const landed = {
      ...hero,
      position: { ...dest.position },
      flight: null as null,
      movement_remaining: 0,
    }
    return {
      session: {
        ...session,
        heroes: session.heroes.map((row) => (row.id === heroId ? landed : row)),
      },
      siegeTownId: null,
      arrivedTownId: dest.id,
    }
  }

  // Already circling: try land every segment; stay on ring if still blocked.
  if (hero.flight.circling) {
    const friendly = tryLandFriendly()
    if (friendly) {
      return friendly
    }
    // Town flipped hostile while waiting — force siege landing.
    const landed = {
      ...hero,
      position: { ...dest.position },
      flight: null as null,
      movement_remaining: 0,
    }
    return {
      session: {
        ...session,
        heroes: session.heroes.map((row) => (row.id === heroId ? landed : row)),
      },
      siegeTownId: dest.id,
      arrivedTownId: null,
    }
  }

  const arrived = hexDistance(hero.position, dest.position) <= 0
  if (!arrived) {
    return {
      session: {
        ...session,
        heroes: session.heroes.map((row) =>
          row.id === heroId ? { ...row, movement_remaining: 0 } : row,
        ),
      },
      siegeTownId: null,
      arrivedTownId: null,
    }
  }

  const friendly = tryLandFriendly()
  if (friendly) {
    return friendly
  }
  // Enemy / captured mid-flight — land into siege.
  const landed = {
    ...hero,
    position: { ...dest.position },
    flight: null as null,
    movement_remaining: 0,
  }
  return {
    session: {
      ...session,
      heroes: session.heroes.map((row) => (row.id === heroId ? landed : row)),
    },
    siegeTownId: dest.id,
    arrivedTownId: null,
  }
}

function advanceHeroFlightOnce(
  session: GameSession,
  heroId: string,
): { session: GameSession; error: string | null; siegeTownId: string | null } {
  const catalog = getCachedCatalog()
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero?.flight || !catalog) {
    return { session, error: null, siegeTownId: null }
  }
  const dest = session.towns.find(
    (town) => town.id === hero.flight!.destination_town_id,
  )
  if (!dest) {
    return {
      session: {
        ...session,
        heroes: session.heroes.map((row) =>
          row.id === heroId ? { ...row, flight: null, movement_remaining: 0 } : row,
        ),
      },
      error: null,
      siegeTownId: null,
    }
  }

  // Circling: one full orbit around the town (no flight_speed toward dest).
  if (hero.flight.circling) {
    const lap = townCircleLapSteps(dest.position, hero.position)
    const end = lap[lap.length - 1] ?? nextTownCircleHex(dest.position, hero.position)
    const moved: GameSession = {
      ...session,
      heroes: session.heroes.map((row) =>
        row.id === heroId
          ? {
              ...row,
              position: end,
              movement_remaining: 0,
              flight: {
                destination_town_id: dest.id,
                circling: true,
              },
            }
          : row,
      ),
    }
    const landed = finalizeHeroFlightSegment(moved, heroId)
    return {
      session: landed.session,
      error: null,
      siegeTownId: landed.siegeTownId,
    }
  }

  const speed = flightSpeed(catalog)
  const nextPos = advanceAlongHexLine(hero.position, dest.position, speed)
  const moved: GameSession = {
    ...session,
    heroes: session.heroes.map((row) =>
      row.id === heroId
        ? {
            ...row,
            position: nextPos,
            movement_remaining: 0,
          }
        : row,
    ),
  }
  const landed = finalizeHeroFlightSegment(moved, heroId)
  return {
    session: landed.session,
    error: null,
    siegeTownId: landed.siegeTownId,
  }
}

/** Day tick: advance every airborne hero one flight_speed segment. */
export function advanceAllFlights(session: GameSession): GameSession {
  let next = session
  const sieges: Array<{ heroId: string; townId: string }> = [
    ...(session.game.pending_flight_sieges ?? []),
  ]
  for (const hero of session.heroes) {
    if (!hero.flight) {
      continue
    }
    const result = advanceHeroFlightOnce(next, hero.id)
    next = result.session
    if (result.siegeTownId) {
      sieges.push({ heroId: hero.id, townId: result.siegeTownId })
    }
  }
  if (sieges.length === 0) {
    return next
  }
  return {
    ...next,
    game: {
      ...next.game,
      pending_flight_sieges: sieges,
    },
  }
}

export function takePendingFlightSieges(
  session: GameSession,
): { session: GameSession; sieges: Array<{ heroId: string; townId: string }> } {
  const sieges = session.game.pending_flight_sieges ?? []
  if (sieges.length === 0) {
    return { session, sieges: [] }
  }
  return {
    session: {
      ...session,
      game: { ...session.game, pending_flight_sieges: [] },
    },
    sieges,
  }
}

/** Heroes currently standing on a town hex they own. */
export function heroIdsInOwnedTown(session: GameSession): string[] {
  const ids: string[] = []
  for (const hero of session.heroes) {
    const town = findTownAt(session, hero.position.q, hero.position.r)
    if (town && town.player_id === hero.player_id) {
      ids.push(hero.id)
    }
  }
  return ids
}

/**
 * Full Energy + Mana at calendar day end for heroes standing in an owned town.
 * Entering town mid-day does not restore immediately — only the day boundary
 * does — so ending the day parked in town counts as spending the night.
 */
function restoreHeroPoolsEndingDayInTown(session: GameSession): GameSession {
  const catalog = getCachedCatalog()
  if (!catalog) {
    return session
  }
  let changed = false
  const heroes = session.heroes.map((hero) => {
    const town = findTownAt(session, hero.position.q, hero.position.r)
    if (!town || town.player_id !== hero.player_id) {
      return hero
    }
    const pools = heroResourcePools(catalog, hero)
    if (
      hero.current_mana === pools.current_mana &&
      hero.current_energy === pools.current_energy
    ) {
      return hero
    }
    changed = true
    return {
      ...hero,
      current_mana: pools.current_mana,
      current_energy: pools.current_energy,
    }
  })
  return changed ? { ...session, heroes } : session
}

/** World-map end-of-turn: +1 Energy and +1 Mana for that player's heroes (cap at max). */
function regenHeroPoolsEndOfTurn(
  session: GameSession,
  playerId: string,
): GameSession {
  const catalog = getCachedCatalog()
  if (!catalog) {
    return session
  }
  let changed = false
  const heroes = session.heroes.map((hero) => {
    if (hero.player_id !== playerId) {
      return hero
    }
    const pools = heroResourcePools(catalog, hero)
    const nextEnergy = Math.min(pools.current_energy, hero.current_energy + 1)
    const nextMana = Math.min(pools.current_mana, hero.current_mana + 1)
    if (
      nextEnergy === hero.current_energy &&
      nextMana === hero.current_mana
    ) {
      return hero
    }
    changed = true
    return {
      ...hero,
      current_energy: nextEnergy,
      current_mana: nextMana,
    }
  })
  return changed ? { ...session, heroes } : session
}

export function restoreAllHeroMovement(session: GameSession): GameSession {
  return {
    ...session,
    heroes: session.heroes.map((hero) => ({
      ...hero,
      movement_remaining: heroMovementPoints(getCachedCatalog(), hero),
    })),
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
  return session.towns.find((town) => {
    if (town.position.q === q && town.position.r === r) {
      return true
    }
    // 2×1 footprint: left hex is blocked but still "the town" for lookups.
    return town.position.q - 1 === q && town.position.r === r
  })
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
