import { calendarDayNumber } from '../hex/calendar'
import type { CombatSummary } from '../combat/resolve'
import {
  formatItemPickedUpLog,
  formatPlainItemLog,
  formatQuestRewardItemLog,
  formatTookItemsLog,
} from '../items/itemLogFormat'
import {
  appConfigNumber,
  buildingById,
  type ReferenceCatalog,
} from '../town/catalog'
import { activePlayer, findTownAt, findTownById } from './accessors'
import type {
  GameLogCombatArchive,
  GameLogEntry,
  GameSession,
  Player,
  PlayerGameLog,
} from './types'
import { HUMAN_PLAYER_ID } from './types'

export type GameLogTab = 'world' | 'town' | 'enemy' | 'combat'

export type FormattedLogLine = {
  text: string
  detailsCombatId?: string
  segments?: Array<{ text: string; color?: string }>
}

export type CombatLogExitPayload = {
  summary: CombatSummary
  lines: string[]
  escapeKind?: 'flee' | 'surrender'
  surrenderGold?: number
  escapingHeroId?: string
}

let combatIdSeq = 0

export function emptyPlayerGameLog(): PlayerGameLog {
  return { world: [], town: [], enemy: [], combat: [] }
}

export function ensurePlayerGameLog(player: Player): Player {
  if (player.game_log) {
    return player
  }
  return { ...player, game_log: emptyPlayerGameLog() }
}

export function normalizeSessionGameLogs(session: GameSession): GameSession {
  return {
    ...session,
    players: session.players.map((player) => ensurePlayerGameLog(player)),
  }
}

export function logViewPlayerId(session: GameSession): string {
  const active = activePlayer(session)
  if (active && !active.is_ai && !active.ai_spectator) {
    return active.id
  }
  return (
    session.players.find((player) => !player.is_ai && !player.ai_spectator)?.id ??
    HUMAN_PLAYER_ID
  )
}

export function playerGameLog(
  session: GameSession,
  playerId?: string,
): PlayerGameLog {
  const id = playerId ?? logViewPlayerId(session)
  const player = session.players.find((row) => row.id === id)
  return player?.game_log ?? emptyPlayerGameLog()
}

function humanPlayers(session: GameSession): Player[] {
  return session.players.filter(
    (player) => !player.is_ai && !player.ai_spectator,
  )
}

function updatePlayerLog(
  session: GameSession,
  playerId: string,
  updater: (log: PlayerGameLog) => PlayerGameLog,
): GameSession {
  return {
    ...session,
    players: session.players.map((player) => {
      if (player.id !== playerId) {
        return player
      }
      const base = ensurePlayerGameLog(player)
      const log = base.game_log ?? emptyPlayerGameLog()
      return { ...base, game_log: updater(log) }
    }),
  }
}

export function logWorldDays(catalog: ReferenceCatalog | null): number {
  return Math.max(1, Math.floor(appConfigNumber(catalog, 'log_world_days', 7)))
}

export function logCombatKeep(catalog: ReferenceCatalog | null): number {
  return Math.max(1, Math.floor(appConfigNumber(catalog, 'log_combat_keep', 10)))
}

export function pruneGameLogs(
  session: GameSession,
  catalog: ReferenceCatalog | null,
  day?: number,
): GameSession {
  const currentDay = day ?? calendarDayNumber(session.game.calendar)
  const keepDays = logWorldDays(catalog)
  const minDay = currentDay - keepDays + 1
  let next = session
  for (const player of humanPlayers(session)) {
    next = updatePlayerLog(next, player.id, (log) => ({
      ...log,
      world: log.world.filter((entry) => entry.day >= minDay),
      town: log.town.filter((entry) => entry.day >= minDay),
      enemy: log.enemy.filter((entry) => entry.day >= minDay),
    }))
  }
  return next
}

export function pruneCombatLogs(
  session: GameSession,
  catalog: ReferenceCatalog | null,
): GameSession {
  const keep = logCombatKeep(catalog)
  let next = session
  for (const player of humanPlayers(session)) {
    next = updatePlayerLog(next, player.id, (log) => {
      if (log.combat.length <= keep) {
        return log
      }
      return {
        ...log,
        combat: log.combat.slice(log.combat.length - keep),
      }
    })
  }
  return next
}

export function appendLogEntry(
  session: GameSession,
  playerId: string,
  tab: 'world' | 'town' | 'enemy',
  type: string,
  data: Record<string, string | number | boolean | null>,
  day?: number,
): GameSession {
  if (session.players.find((row) => row.id === playerId)?.is_ai) {
    return session
  }
  const entryDay = day ?? calendarDayNumber(session.game.calendar)
  const entry: GameLogEntry = { day: entryDay, type, data }
  return updatePlayerLog(session, playerId, (log) => ({
    ...log,
    [tab]: [...log[tab], entry],
  }))
}

export function playerSeesHex(player: Player, q: number, r: number): boolean {
  return (player.explored ?? []).some((hex) => hex.q === q && hex.r === r)
}

export function appendEnemyVisibleAt(
  session: GameSession,
  q: number,
  r: number,
  type: string,
  data: Record<string, string | number | boolean | null>,
  alwaysForPlayerIds: string[] = [],
): GameSession {
  let next = session
  const day = calendarDayNumber(session.game.calendar)
  for (const player of humanPlayers(session)) {
    const actorId = data.actorPlayerId
    if (typeof actorId === 'string' && actorId === player.id) {
      continue
    }
    const force = alwaysForPlayerIds.includes(player.id)
    if (force || playerSeesHex(player, q, r)) {
      next = appendLogEntry(next, player.id, 'enemy', type, data, day)
    }
  }
  return next
}

export function logPickup(
  session: GameSession,
  playerId: string,
  heroId: string,
  resourceId: number,
  amount: number,
): GameSession {
  return appendLogEntry(session, playerId, 'world', 'pickup_resource', {
    heroId,
    resourceId,
    amount,
  })
}

export function logCapturedMine(
  session: GameSession,
  playerId: string,
  heroId: string,
  resourceId: number,
  q: number,
  r: number,
  recapture: boolean,
): GameSession {
  let next = appendLogEntry(session, playerId, 'world', 'captured_mine', {
    heroId,
    resourceId,
    q,
    r,
    recapture: recapture ? 1 : 0,
  })
  next = appendEnemyVisibleAt(next, q, r, 'enemy_captured_mine', {
    actorPlayerId: playerId,
    heroId,
    resourceId,
    q,
    r,
  })
  return next
}

export function logArmyStackUpgraded(
  session: GameSession,
  playerId: string,
  townId: string,
  fromName: string,
  toName: string,
  qty: number,
  costText: string,
): GameSession {
  return appendLogEntry(session, playerId, 'town', 'army_stack_upgraded', {
    townId,
    fromName,
    toName,
    qty,
    costText,
  })
}

export function logArmyUpgradeAll(
  session: GameSession,
  playerId: string,
  townId: string,
  count: number,
  costText: string,
): GameSession {
  return appendLogEntry(session, playerId, 'town', 'army_upgrade_all', {
    townId,
    count,
    costText,
  })
}

export function logArmyBuyAll(
  session: GameSession,
  playerId: string,
  townId: string,
  unitName: string,
  qty: number,
  costText: string,
): GameSession {
  return appendLogEntry(session, playerId, 'town', 'army_buy_all', {
    townId,
    unitName,
    qty,
    costText,
  })
}

export function logTownBuilding(
  session: GameSession,
  playerId: string,
  townId: string,
  buildingId: number,
  level: number,
  built: boolean,
): GameSession {
  return appendLogEntry(session, playerId, 'town', built ? 'built' : 'upgraded', {
    townId,
    buildingId,
    level,
  })
}

export function logDayIncomeEvent(
  session: GameSession,
  event: {
    kind: string
    playerId: string
    townName?: string
    buildingName?: string
    resourceId?: number
    amount?: number
    uniqueName?: string
    verb?: string
  },
): GameSession {
  if (session.players.find((row) => row.id === event.playerId)?.is_ai) {
    return session
  }
  const type =
    event.kind === 'growth'
      ? 'weekly_recruits'
      : event.kind === 'unique'
        ? 'town_unique'
        : event.kind === 'construct'
          ? 'town_unique_build'
          : event.kind === 'building'
            ? 'building_income'
            : event.kind === 'mine'
              ? 'mine_income'
              : event.kind
  return appendLogEntry(session, event.playerId, 'town', type, {
    townName: event.townName ?? '',
    buildingName: event.buildingName ?? '',
    resourceId: event.resourceId ?? -1,
    amount: event.amount ?? 0,
    uniqueName: event.uniqueName ?? '',
    verb: event.verb ?? '',
  })
}

export function logTownCapture(
  session: GameSession,
  townId: string,
  newOwnerId: string,
  previousOwnerId: string | null,
): GameSession {
  const town = findTownById(session, townId)
  const q = town?.position.q ?? 0
  const r = town?.position.r ?? 0
  let next = session
  if (!session.players.find((row) => row.id === newOwnerId)?.is_ai) {
    next = appendLogEntry(next, newOwnerId, 'town', 'town_captured', {
      townId,
      fromPlayerId: previousOwnerId ?? '',
    })
  }
  if (previousOwnerId && !session.players.find((row) => row.id === previousOwnerId)?.is_ai) {
    next = appendLogEntry(next, previousOwnerId, 'town', 'town_lost', {
      townId,
      toPlayerId: newOwnerId,
    })
  }
  const losers = previousOwnerId ? [previousOwnerId] : []
  next = appendEnemyVisibleAt(
    next,
    q,
    r,
    'enemy_captured_town',
    {
      actorPlayerId: newOwnerId,
      townId,
      fromPlayerId: previousOwnerId ?? '',
    },
    losers,
  )
  return next
}

export function logEnemyHeroMoved(
  session: GameSession,
  aiPlayerId: string,
  heroId: string,
  q: number,
  r: number,
): GameSession {
  return appendEnemyVisibleAt(session, q, r, 'enemy_hero_seen', {
    actorPlayerId: aiPlayerId,
    heroId,
    q,
    r,
  })
}

export function logItemPickedUp(
  session: GameSession,
  playerId: string,
  heroId: string,
  itemUid: string,
  itemName: string,
): GameSession {
  return appendLogEntry(session, playerId, 'world', 'item_picked_up', {
    heroId,
    itemUid,
    itemName,
  })
}

/** @deprecated Use {@link logItemPickedUp} */
export function logChestFound(
  session: GameSession,
  playerId: string,
  heroId: string,
  itemName: string,
): GameSession {
  return appendLogEntry(session, playerId, 'world', 'chest_item_found', {
    heroId,
    itemName,
  })
}

export function logMobKillGold(
  session: GameSession,
  playerId: string,
  heroId: string,
  gold: number,
): GameSession {
  return appendLogEntry(session, playerId, 'world', 'mob_kill_gold', {
    heroId,
    gold,
  })
}

export function logMobKillItemFound(
  session: GameSession,
  playerId: string,
  heroId: string,
  itemUid: string,
  itemName: string,
): GameSession {
  return logItemPickedUp(session, playerId, heroId, itemUid, itemName)
}

export function logMobItemLeftOnGround(
  session: GameSession,
  playerId: string,
  heroId: string,
  itemName: string,
  q: number,
  r: number,
): GameSession {
  return appendLogEntry(session, playerId, 'world', 'mob_item_ground', {
    heroId,
    itemName,
    q,
    r,
  })
}

export function logMobDroppedItem(
  session: GameSession,
  playerId: string,
  heroId: string,
  mobName: string,
): GameSession {
  return appendLogEntry(session, playerId, 'world', 'mob_item_dropped', {
    heroId,
    mobName,
  })
}

export function logChestLeftOpen(
  session: GameSession,
  playerId: string,
  heroId: string,
  itemName: string,
): GameSession {
  return appendLogEntry(session, playerId, 'world', 'chest_item_left_open', {
    heroId,
    itemName,
  })
}

export function logQuestItemReward(
  session: GameSession,
  playerId: string,
  heroId: string,
  itemUid: string,
  itemName: string,
): GameSession {
  return appendLogEntry(session, playerId, 'world', 'quest_item_reward', {
    heroId,
    itemUid,
    itemName,
  })
}

export function logTookItemsFromHero(
  session: GameSession,
  winnerPlayerId: string,
  winnerHeroId: string,
  items: Array<{ uid: string; name: string }>,
): GameSession {
  return appendLogEntry(session, winnerPlayerId, 'world', 'took_items_from_hero', {
    heroId: winnerHeroId,
    itemsJson: JSON.stringify(items),
  })
}

export function logLostItemsToHero(
  session: GameSession,
  loserPlayerId: string,
  loserHeroName: string,
  itemNames: string,
): GameSession {
  return appendLogEntry(session, loserPlayerId, 'world', 'lost_items_to_hero', {
    loserHeroName,
    itemNames,
  })
}

export function logMobAmbush(
  session: GameSession,
  playerId: string,
  heroId: string,
  mobId: string,
): GameSession {
  return appendLogEntry(session, playerId, 'world', 'ambushed', {
    heroId,
    mobId,
  })
}

export function logMobEncounterResolved(
  session: GameSession,
  playerId: string,
  heroId: string,
  mobId: string,
  kind: 'fled' | 'surrendered' | 'mob_fled' | 'mob_surrendered',
  gold?: number,
): GameSession {
  return appendLogEntry(session, playerId, 'world', kind, {
    heroId,
    mobId,
    gold: gold ?? 0,
  })
}

function lossSummaryText(losses: { qty: number; unitName: string }[]): string {
  const parts = losses.filter((line) => line.qty > 0)
  if (parts.length === 0) {
    return ''
  }
  return parts.map((line) => `${line.qty} ${line.unitName}`).join(', ')
}

function combatArchiveLinesFromPayload(payload: CombatLogExitPayload): string[] {
  const transcript = payload.lines.filter((line) => line.trim().length > 0)
  if (transcript.length > 0) {
    return transcript
  }
  const summary = payload.summary
  const fallback: string[] = summary.xpLines.filter((line) => line.trim().length > 0)
  const loserText = lossSummaryText(summary.loserLosses)
  const winnerText = lossSummaryText(summary.winnerLosses)
  if (loserText) {
    fallback.push(`${summary.loserHeroName} lost: ${loserText}`)
  }
  if (winnerText) {
    fallback.push(`${summary.winnerHeroName} lost: ${winnerText}`)
  }
  for (const gain of summary.winnerGains) {
    if (gain.qty > 0) {
      fallback.push(
        `${summary.winnerHeroName} gained ${gain.qty} ${gain.unitName}`,
      )
    }
  }
  if (fallback.length === 0) {
    fallback.push(
      `Player ${summary.winnerPlayer} — ${summary.winnerHeroName} beat Player ${summary.loserPlayer} — ${summary.loserHeroName}`,
    )
  }
  return fallback
}

export function recordCombatEnd(
  session: GameSession,
  catalog: ReferenceCatalog | null,
  input: {
    attackerHeroId: string
    defenderHeroId: string | null
    defenderMobId: string | null
    payload: CombatLogExitPayload
  },
): GameSession {
  const day = calendarDayNumber(session.game.calendar)
  const combatId = `combat-${day}-${++combatIdSeq}`
  const attacker = session.heroes.find((row) => row.id === input.attackerHeroId)
  const defender = input.defenderHeroId
    ? session.heroes.find((row) => row.id === input.defenderHeroId)
    : null
  const mob = input.defenderMobId
    ? session.mobs.find((row) => row.id === input.defenderMobId)
    : null
  const summary = input.payload.summary
  const participantIds = new Set<string>()
  if (attacker?.player_id) {
    participantIds.add(attacker.player_id)
  }
  if (defender?.player_id) {
    participantIds.add(defender.player_id)
  }
  const humanParticipants = [...participantIds].filter((id) => {
    const player = session.players.find((row) => row.id === id)
    return player && !player.is_ai
  })
  if (humanParticipants.length === 0 && attacker?.player_id) {
    const owner = session.players.find((row) => row.id === attacker.player_id)
    if (owner && !owner.is_ai) {
      humanParticipants.push(attacker.player_id)
    }
  }

  let next = session
  for (const playerId of humanParticipants) {
    const archive: GameLogCombatArchive = {
      id: combatId,
      day,
      lines: combatArchiveLinesFromPayload(input.payload),
    }
    next = updatePlayerLog(next, playerId, (log) => ({
      ...log,
      combat: [...log.combat, archive],
    }))

    const heroId = attacker?.player_id === playerId
      ? input.attackerHeroId
      : defender?.player_id === playerId
        ? input.defenderHeroId ?? ''
        : input.attackerHeroId
    const name =
      session.heroes.find((row) => row.id === heroId)?.name ?? 'Hero'
    const won = summary.winnerHeroName === name
    const opponent = won
      ? mob?.id ?? summary.loserHeroName
      : mob?.id ?? summary.winnerHeroName
    const losses = won ? summary.winnerLosses : summary.loserLosses
    const lossText = lossSummaryText(losses)
    const payload = input.payload
    const escaped =
      payload.escapeKind &&
      payload.escapingHeroId &&
      heroId === payload.escapingHeroId
    const escapedHero = escaped
      ? next.heroes.find((row) => row.id === heroId)
      : undefined
    const escapeTown =
      escapedHero != null
        ? findTownAt(next, escapedHero.position.q, escapedHero.position.r)
        : null
    if (escaped && payload.escapeKind === 'flee') {
      next = appendLogEntry(next, playerId, 'world', 'hero_fled_combat', {
        heroId,
        losses: lossText,
        combatId,
        townId: escapeTown?.id ?? '',
      })
    } else if (escaped && payload.escapeKind === 'surrender') {
      next = appendLogEntry(next, playerId, 'world', 'hero_surrendered_combat', {
        heroId,
        gold: payload.surrenderGold ?? 0,
        losses: lossText,
        combatId,
        townId: escapeTown?.id ?? '',
      })
    } else {
      next = appendLogEntry(next, playerId, 'world', 'battle_summary', {
        combatId,
        heroId,
        won: won ? 1 : 0,
        opponent: String(opponent),
        losses: lossText,
      })
    }
  }
  return pruneCombatLogs(next, catalog)
}

function heroName(session: GameSession, heroId: string): string {
  return session.heroes.find((row) => row.id === heroId)?.name ?? heroId
}

function townName(session: GameSession, townId: string): string {
  return findTownById(session, townId)?.name ?? townId
}

function mobLabel(session: GameSession, mobId: string): string {
  return session.mobs.find((row) => row.id === mobId)?.id ?? mobId
}

function resourceName(catalog: ReferenceCatalog | null, resourceId: number): string {
  if (!catalog) {
    return `Resource ${resourceId}`
  }
  return catalog.resource.find((row) => row.id === resourceId)?.name ?? `Resource ${resourceId}`
}

export function formatLogEntry(
  session: GameSession,
  catalog: ReferenceCatalog | null,
  entry: GameLogEntry,
  _tab: GameLogTab,
): FormattedLogLine {
  const prefix = `Day ${entry.day}: `
  const data = entry.data
  switch (entry.type) {
    case 'pickup_resource':
      return {
        text: `${prefix}${heroName(session, String(data.heroId))} picked up ${data.amount} ${resourceName(catalog, Number(data.resourceId))}`,
      }
    case 'captured_mine':
      return {
        text: `${prefix}${heroName(session, String(data.heroId))} captured ${resourceName(catalog, Number(data.resourceId))} mine`,
      }
    case 'army_stack_upgraded':
      return {
        text: `${prefix}Upgraded ${data.qty} ${data.fromName} → ${data.toName} in ${townName(session, String(data.townId))} (${data.costText})`,
      }
    case 'army_upgrade_all':
      return {
        text: `${prefix}Upgrade All: ${data.count} stack(s) in ${townName(session, String(data.townId))} (${data.costText})`,
      }
    case 'army_buy_all':
      return {
        text: `${prefix}Buy All: +${data.qty} ${data.unitName} in ${townName(session, String(data.townId))} (${data.costText})`,
      }
    case 'built':
    case 'upgraded': {
      const building = catalog
        ? buildingById(catalog, Number(data.buildingId))
        : null
      const verb = entry.type === 'built' ? 'Built' : 'Upgraded'
      return {
        text: `${prefix}${verb} ${building?.name ?? 'building'} in ${townName(session, String(data.townId))}`,
      }
    }
    case 'weekly_recruits':
      return {
        text: `${prefix}${data.uniqueName}: +${data.amount} ${data.buildingName}`,
      }
    case 'town_unique':
      return {
        text: `${prefix}${data.uniqueName} in ${data.townName}: +${data.amount} ${resourceName(catalog, Number(data.resourceId))}`,
      }
    case 'town_unique_build':
      return {
        text: `${prefix}${data.uniqueName}: ${data.verb} ${data.buildingName}`,
      }
    case 'building_income':
      return {
        text: `${prefix}${data.townName} ${data.buildingName}: +${data.amount} ${resourceName(catalog, Number(data.resourceId))}`,
      }
    case 'mine_income':
      return {
        text: `${prefix}Mines: +${data.amount} ${resourceName(catalog, Number(data.resourceId))}`,
      }
    case 'town_captured':
      return {
        text: `${prefix}Captured ${townName(session, String(data.townId))}`,
      }
    case 'town_lost':
      return {
        text: `${prefix}Lost ${townName(session, String(data.townId))}`,
      }
    case 'ambushed':
      return {
        text: `${prefix}${mobLabel(session, String(data.mobId))} ambushed ${heroName(session, String(data.heroId))}`,
      }
    case 'fled':
      return {
        text: `${prefix}${heroName(session, String(data.heroId))} fled from ${mobLabel(session, String(data.mobId))}`,
      }
    case 'surrendered':
      return {
        text: `${prefix}${heroName(session, String(data.heroId))} surrendered to ${mobLabel(session, String(data.mobId))} (${data.gold} gold)`,
      }
    case 'mob_fled':
      return {
        text: `${prefix}${mobLabel(session, String(data.mobId))} fled from ${heroName(session, String(data.heroId))}`,
      }
    case 'mob_surrendered':
      return {
        text: `${prefix}${mobLabel(session, String(data.mobId))} surrendered to ${heroName(session, String(data.heroId))}`,
      }
    case 'hero_fled_combat': {
      const losses = String(data.losses ?? '')
      const tail = losses ? ` (lost ${losses})` : ''
      const townId = String(data.townId ?? '')
      const townLabel = townId ? townName(session, townId) : 'safety'
      return {
        text: `${prefix}${heroName(session, String(data.heroId))} fled to ${townLabel}${tail}`,
        detailsCombatId: String(data.combatId),
      }
    }
    case 'hero_surrendered_combat': {
      const losses = String(data.losses ?? '')
      const tail = losses ? ` (lost ${losses})` : ''
      const townId = String(data.townId ?? '')
      const townLabel = townId ? townName(session, townId) : 'safety'
      return {
        text: `${prefix}${heroName(session, String(data.heroId))} surrendered (${data.gold} gold) and returned to ${townLabel}${tail}`,
        detailsCombatId: String(data.combatId),
      }
    }
    case 'battle_summary': {
      const h = heroName(session, String(data.heroId))
      const won = Number(data.won) === 1
      const opp = String(data.opponent)
      const losses = String(data.losses ?? '')
      const tail = losses ? ` (lost ${losses})` : ''
      const verb = won ? 'defeated' : 'lost to'
      return {
        text: `${prefix}${h} ${verb} ${opp}${tail}`,
        detailsCombatId: String(data.combatId),
      }
    }
    case 'enemy_hero_seen':
      return {
        text: `${prefix}Enemy hero ${heroName(session, String(data.heroId))} seen at (${data.q}, ${data.r})`,
      }
    case 'enemy_captured_mine':
      return {
        text: `${prefix}Enemy captured ${resourceName(catalog, Number(data.resourceId))} mine`,
      }
    case 'enemy_captured_town':
      return {
        text: `${prefix}Enemy captured ${townName(session, String(data.townId))}`,
      }
    case 'mob_kill_gold':
      return {
        text: `${prefix}${heroName(session, String(data.heroId))} gained ${data.gold} gold from a defeated mob`,
      }
    case 'item_picked_up':
      return formatItemPickedUpLog(
        session,
        catalog,
        entry.day,
        String(data.heroId),
        String(data.itemUid),
        String(data.itemName ?? ''),
      )
    case 'mob_item_found':
    case 'chest_item_found':
      return formatItemPickedUpLog(
        session,
        catalog,
        entry.day,
        String(data.heroId),
        String(data.itemUid ?? ''),
        String(data.itemName ?? ''),
      )
    case 'mob_item_ground':
      return formatPlainItemLog(
        entry.day,
        `Backpack full: ${data.itemName} left on the ground`,
      )
    case 'mob_item_dropped':
      return {
        text: `${prefix}The ${data.mobName} dropped an item!`,
      }
    case 'chest_item_left_open':
      return formatPlainItemLog(
        entry.day,
        `Backpack full: chest left open (${data.itemName})`,
      )
    case 'quest_item_reward':
      return formatQuestRewardItemLog(
        session,
        catalog,
        entry.day,
        String(data.heroId),
        String(data.itemUid ?? ''),
        String(data.itemName ?? ''),
      )
    case 'took_items_from_hero': {
      const legacyNames = data.itemNames
      if (typeof legacyNames === 'string' && legacyNames.trim()) {
        const parts = legacyNames.split(',').map((name) => ({
          uid: '',
          name: name.trim(),
        }))
        return formatTookItemsLog(
          session,
          catalog,
          entry.day,
          String(data.heroId),
          parts,
        )
      }
      let items: Array<{ uid: string; name: string }> = []
      if (typeof data.itemsJson === 'string' && data.itemsJson) {
        try {
          const parsed = JSON.parse(data.itemsJson) as Array<{
            uid?: string
            name?: string
          }>
          if (Array.isArray(parsed)) {
            items = parsed.map((row) => ({
              uid: String(row.uid ?? ''),
              name: String(row.name ?? ''),
            }))
          }
        } catch {
          items = []
        }
      }
      return formatTookItemsLog(
        session,
        catalog,
        entry.day,
        String(data.heroId),
        items,
      )
    }
    case 'lost_items_to_hero':
      return {
        text: `${prefix}${data.loserHeroName} lost ${data.itemNames}`,
      }
    default:
      return { text: `${prefix}${entry.type}` }
  }
}

export function formatCombatArchiveLines(
  archive: GameLogCombatArchive,
): string[] {
  const lines = archive.lines.filter((line) => line.trim().length > 0)
  return lines.length > 0
    ? lines
    : [`Day ${archive.day}: (empty combat log)`]
}

export function formattedTabLines(
  session: GameSession,
  catalog: ReferenceCatalog | null,
  playerId: string,
  tab: GameLogTab,
): FormattedLogLine[] {
  const log = playerGameLog(session, playerId)
  if (tab === 'combat') {
    return log.combat.flatMap((archive) =>
      formatCombatArchiveLines(archive).map((line) => ({ text: line })),
    )
  }
  const entries = log[tab]
  return entries.map((entry) => formatLogEntry(session, catalog, entry, tab))
}
