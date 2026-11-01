import { absoluteWeekNumber } from '../hex/calendar'
import type {
  ActiveWorldEvent,
  GameSession,
  WorldEventPopup,
  WorldEventTarget,
} from './types'
import {
  armyOptions,
  armyTier,
  buildingById,
  isArmySlot,
  isBuildRoot,
  mapCfg,
  sizeNameFromDims,
  unitById,
  unitForBuilding,
} from '../town/catalog'
import type { EventRow, ReferenceCatalog } from '../town/catalog'
import { resourceById } from '../hex/resources'
import { sameUpgradeBranch } from '../town/unitUpgrade'
import { appendLogEntry, humanPlayers } from './gameLog'
import { applyWorldEventMapEffects } from './worldEventMapEffects'

export function worldEventPopupForPlayer(
  session: GameSession,
  playerId: string,
): WorldEventPopup | null {
  const popup = session.game.world_event_popup
  if (!popup) {
    return null
  }
  if (session.game.calendar.day !== 1) {
    return null
  }
  if (absoluteWeekNumber(session.game.calendar) !== popup.absoluteWeek) {
    return null
  }
  if (session.game.world_event_popup_seen?.[playerId] === popup.absoluteWeek) {
    return null
  }
  return popup
}

export function markWorldEventPopupSeen(
  session: GameSession,
  playerId: string,
): GameSession {
  const popup = session.game.world_event_popup
  if (!popup) {
    return session
  }
  return {
    ...session,
    game: {
      ...session.game,
      world_event_popup_seen: {
        ...(session.game.world_event_popup_seen ?? {}),
        [playerId]: popup.absoluteWeek,
      },
    },
  }
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function weekRng(session: GameSession, absoluteWeek: number): () => number {
  const seed = (session.game.seed || 1) ^ Math.imul(absoluteWeek, 0x9e3779b1)
  return mulberry32(seed >>> 0)
}

function eventRows(catalog: ReferenceCatalog | null | undefined): EventRow[] {
  if (!catalog?.event?.length) {
    return []
  }
  return catalog.event
}

export function eventRowById(
  catalog: ReferenceCatalog | null | undefined,
  id: number,
): EventRow | null {
  return catalog?.event.find((row) => row.id === id) ?? null
}

function weightedPick<T>(
  items: T[],
  weightOf: (item: T) => number,
  random: () => number,
): T | null {
  let total = 0
  for (const item of items) {
    const w = weightOf(item)
    if (w > 0) {
      total += w
    }
  }
  if (total <= 0) {
    return null
  }
  let roll = random() * total
  for (const item of items) {
    const w = weightOf(item)
    if (w <= 0) {
      continue
    }
    roll -= w
    if (roll <= 0) {
      return item
    }
  }
  return items[items.length - 1] ?? null
}

function mapConfigValue(
  catalog: ReferenceCatalog,
  key: string,
): unknown {
  return catalog.map_config.find((row) => row.key === key)?.value
}

function tierWeights(catalog: ReferenceCatalog): Map<number, number> {
  const raw = mapConfigValue(catalog, 'event_tier_weights')
  const map = new Map<number, number>()
  if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const tier = Math.floor(Number(key))
      const w = Number(value)
      if (tier >= 1 && tier <= 6 && Number.isFinite(w) && w > 0) {
        map.set(tier, w)
      }
    }
  }
  if (map.size === 0) {
    for (let tier = 1; tier <= 6; tier += 1) {
      map.set(tier, 1)
    }
  }
  return map
}

function pickTier(catalog: ReferenceCatalog, random: () => number): number {
  const weights = tierWeights(catalog)
  const tiers = [...weights.keys()]
  const picked = weightedPick(
    tiers,
    (tier) => weights.get(tier) ?? 0,
    random,
  )
  return picked ?? 1
}

function townTypeIdsOnMap(session: GameSession): number[] {
  const seen = new Set<number>()
  for (const town of session.towns) {
    if (town.town_type_id > 0) {
      seen.add(town.town_type_id)
    }
  }
  return [...seen]
}

type UnitPair = { baseUnitId: number; townTypeId: number; tier: number; classId: number | null }

function unitPairsOnMap(
  session: GameSession,
  catalog: ReferenceCatalog,
): UnitPair[] {
  const townTypes = townTypeIdsOnMap(session)
  const pairs: UnitPair[] = []
  const seen = new Set<string>()
  for (const townTypeId of townTypes) {
    for (let slot = 11; slot <= 16; slot += 1) {
      for (const building of armyOptions(catalog, slot, townTypeId)) {
        if (!isBuildRoot(building)) {
          continue
        }
        const unit = unitForBuilding(catalog, building.id)
        if (!unit || unit.town_id !== townTypeId) {
          continue
        }
        const tier = unit.tier ?? armyTier(slot)
        const classId = unit.class_id
        const key = `${townTypeId}:${tier}:${classId ?? 0}:${unit.id}`
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
        pairs.push({
          baseUnitId: unit.id,
          townTypeId,
          tier,
          classId,
        })
      }
    }
  }
  return pairs
}

function classIdsOnMap(session: GameSession, catalog: ReferenceCatalog): number[] {
  const seen = new Set<number>()
  for (const pair of unitPairsOnMap(session, catalog)) {
    if (pair.classId != null && pair.classId > 0) {
      seen.add(pair.classId)
    }
  }
  return [...seen]
}

function mineResourceIdsOnMap(session: GameSession): number[] {
  const seen = new Set<number>()
  for (const node of session.nodes) {
    if (node.kind === 'mine' && node.resource_id > 0) {
      seen.add(node.resource_id)
    }
  }
  return [...seen]
}

function pickTarget(
  session: GameSession,
  catalog: ReferenceCatalog,
  row: EventRow,
  random: () => number,
): WorldEventTarget {
  switch (row.target_type) {
    case 'none':
      return { kind: 'none' }
    case 'all':
      return { kind: 'all' }
    case 'town': {
      const types = townTypeIdsOnMap(session)
      if (types.length === 0) {
        return { kind: 'none' }
      }
      const pick = types[Math.floor(random() * types.length)]!
      return { kind: 'town', townTypeId: pick }
    }
    case 'class': {
      const classes = classIdsOnMap(session, catalog)
      if (classes.length === 0) {
        return { kind: 'none' }
      }
      const pick = classes[Math.floor(random() * classes.length)]!
      return { kind: 'class', classId: pick }
    }
    case 'tier': {
      return { kind: 'tier', tier: pickTier(catalog, random) }
    }
    case 'resource': {
      const resources = mineResourceIdsOnMap(session)
      if (resources.length === 0) {
        return { kind: 'none' }
      }
      const pick = resources[Math.floor(random() * resources.length)]!
      return { kind: 'resource', resourceId: pick }
    }
    case 'unit': {
      const tier = pickTier(catalog, random)
      const pairs = unitPairsOnMap(session, catalog).filter((p) => p.tier === tier)
      if (pairs.length === 0) {
        const any = unitPairsOnMap(session, catalog)
        if (any.length === 0) {
          return { kind: 'none' }
        }
        const pick = any[Math.floor(random() * any.length)]!
        return { kind: 'unit', unitId: pick.baseUnitId }
      }
      const pick = pairs[Math.floor(random() * pairs.length)]!
      return { kind: 'unit', unitId: pick.baseUnitId }
    }
    default:
      return { kind: 'none' }
  }
}

export function targetDisplayName(
  catalog: ReferenceCatalog,
  target: WorldEventTarget,
): string {
  switch (target.kind) {
    case 'none':
      return ''
    case 'all':
      return 'All'
    case 'unit': {
      const unit = unitById(catalog, target.unitId)
      return unit?.name ?? `Unit ${target.unitId}`
    }
    case 'class':
      return (
        catalog.class_type.find((row) => row.id === target.classId)?.name ??
        `Class ${target.classId}`
      )
    case 'town':
      return (
        catalog.town.find((row) => row.id === target.townTypeId)?.name ??
        `Town ${target.townTypeId}`
      )
    case 'tier':
      return String(target.tier)
    case 'resource':
      return resourceById(target.resourceId)?.name ?? `Resource ${target.resourceId}`
    default:
      return ''
  }
}

function formatEventTemplate(template: string, targetLabel: string): string {
  if (!targetLabel) {
    return template.replace(/\{target\}/gi, '').trim()
  }
  return template.replace(/\{target\}/gi, targetLabel)
}

function formatEventName(row: EventRow, targetLabel: string): string {
  return formatEventTemplate(row.name, targetLabel)
}

function formatEventDescription(row: EventRow, targetLabel: string): string {
  if (!row.description.trim()) {
    return ''
  }
  return formatEventTemplate(row.description, targetLabel)
}

function formatWorldEventLogLine(
  title: string,
  description: string,
  effectSummary: string,
): string {
  let line = title
  if (description) {
    line = `${line}: ${description}`
  }
  if (effectSummary) {
    line = description ? `${line}; ${effectSummary}` : `${line}: ${effectSummary}`
  }
  return line
}

function eventStartWeek(
  catalog: ReferenceCatalog,
  session: GameSession,
): number | null {
  const row = catalog.map_config.find((entry) => entry.key === 'event_start_week')
  if (!row || row.value == null || row.value === '') {
    return null
  }
  const settings = session.game.settings
  const sizeName = sizeNameFromDims(
    catalog,
    settings.map_width,
    settings.map_height,
    settings.map_size,
  )
  const raw = mapCfg(catalog, 'event_start_week', sizeName)
  if (raw == null || raw === '') {
    return null
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    for (const value of Object.values(raw as Record<string, unknown>)) {
      const n = Math.floor(Number(value))
      if (Number.isFinite(n)) {
        return n
      }
    }
    return null
  }
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) ? n : null
}

export function sessionMapSizeName(
  session: GameSession,
  catalog: ReferenceCatalog,
): string {
  const settings = session.game.settings
  return sizeNameFromDims(
    catalog,
    settings.map_width,
    settings.map_height,
    settings.map_size,
  )
}

function logWorldEventSkip(session: GameSession, message: string): GameSession {
  let next: GameSession = {
    ...session,
    game: {
      ...session.game,
      active_world_event: null,
      world_event_popup: null,
    },
  }
  for (const player of humanPlayers(next)) {
    next = appendLogEntry(next, player.id, 'world', 'world_event', {
      message,
    })
  }
  return next
}

function rollEventRow(
  catalog: ReferenceCatalog,
  timeframe: 'week' | 'month',
  random: () => number,
): EventRow | null {
  const pool = eventRows(catalog).filter((row) => row.timeframe === timeframe)
  return weightedPick(pool, (row) => row.weight, random)
}

export function activeWorldEventForSession(
  session: GameSession,
): ActiveWorldEvent | null {
  const active = session.game.active_world_event
  if (!active) {
    return null
  }
  if (active.absoluteWeek !== absoluteWeekNumber(session.game.calendar)) {
    return null
  }
  return active
}

export function rollWeekWorldEvent(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
): GameSession {
  const rows = eventRows(catalog)
  if (!catalog || rows.length === 0) {
    return logWorldEventSkip(
      session,
      '[event] Weekly events disabled — no valid event rows in reference data (Reload Reference Data).',
    )
  }

  const startWeek = eventStartWeek(catalog, session)
  if (startWeek == null) {
    return logWorldEventSkip(
      session,
      '[event] Missing map_config.event_start_week — weekly events disabled.',
    )
  }

  const absoluteWeek = absoluteWeekNumber(session.game.calendar)
  if (absoluteWeek < startWeek) {
    return {
      ...session,
      game: {
        ...session.game,
        active_world_event: null,
        world_event_popup: null,
      },
    }
  }

  const random = weekRng(session, absoluteWeek)
  const cal = session.game.calendar
  const monthWeekStart = cal.week === 1 && cal.day === 1

  let picked: EventRow | null = null
  if (monthWeekStart) {
    picked = rollEventRow(catalog, 'month', random)
    if (picked?.target_type === 'none') {
      picked = rollEventRow(catalog, 'week', random)
    }
  } else {
    picked = rollEventRow(catalog, 'week', random)
  }

  if (!picked) {
    const pool = monthWeekStart ? 'month/week' : 'week'
    return logWorldEventSkip(
      session,
      `[event] No ${pool} event rolled (empty or zero-weight pool).`,
    )
  }

  const target = pickTarget(session, catalog, picked, random)
  if (target.kind === 'none' && picked.target_type !== 'none') {
    return logWorldEventSkip(
      session,
      `[event] "${formatEventName(picked, '')}" could not pick a valid ${picked.target_type} target on this map.`,
    )
  }

  const active: ActiveWorldEvent = {
    eventId: picked.id,
    absoluteWeek,
    target,
    spawnStacks: picked.spawn_stacks ?? null,
    existingMobPct: picked.existing_mob_pct,
    resDrops: picked.res_drops ?? null,
  }

  let next: GameSession = {
    ...session,
    game: { ...session.game, active_world_event: active },
  }

  const targetLabel = targetDisplayName(catalog, target)
  const display = formatEventName(picked, targetLabel)
  const description = formatEventDescription(picked, targetLabel)

  const applied = applyWorldEventMapEffects(next, catalog, random)
  next = applied.session

  const effectSummary = applied.summaryParts.join('; ')
  const logLine = formatWorldEventLogLine(display, description, effectSummary)

  next = {
    ...next,
    game: {
      ...next.game,
      world_event_popup:
        picked.polarity !== 'neutral'
          ? {
              absoluteWeek,
              title: display,
              description,
              polarity: picked.polarity,
            }
          : null,
    },
  }

  for (const player of humanPlayers(next)) {
    next = appendLogEntry(next, player.id, 'world', 'world_event', {
      message: logLine,
      eventId: picked.id,
      polarity: picked.polarity,
    })
  }

  return next
}

function dwellingClassId(
  catalog: ReferenceCatalog,
  buildingId: number,
): number | null {
  const building = buildingById(catalog, buildingId)
  if (!building) {
    return null
  }
  if (building.class_id != null && building.class_id > 0) {
    return building.class_id
  }
  return unitForBuilding(catalog, buildingId)?.class_id ?? null
}

function unitMatchesTarget(
  catalog: ReferenceCatalog,
  unitId: number,
  target: WorldEventTarget,
): boolean {
  const unit = unitById(catalog, unitId)
  if (!unit) {
    return false
  }
  switch (target.kind) {
    case 'all':
      return true
    case 'unit': {
      const anchor = unitById(catalog, target.unitId)
      if (!anchor) {
        return false
      }
      if (unit.id === anchor.id) {
        return true
      }
      return sameUpgradeBranch(unit, anchor)
    }
    case 'class':
      return (unit.class_id ?? 0) === target.classId
    case 'tier':
      return (unit.tier ?? 0) === target.tier
    case 'town':
      return unit.town_id === target.townTypeId
    default:
      return false
  }
}

export function dwellingAffectedByEvent(
  session: GameSession,
  catalog: ReferenceCatalog,
  townTypeId: number,
  slotNum: number,
  buildingId: number,
): boolean {
  if (!isArmySlot(slotNum)) {
    return false
  }
  const active = activeWorldEventForSession(session)
  if (!active) {
    return false
  }
  const row = eventRowById(catalog, active.eventId)
  if (!row) {
    return false
  }
  const target = active.target
  if (target.kind === 'none') {
    return false
  }
  if (target.kind === 'all') {
    return true
  }
  if (target.kind === 'tier') {
    return armyTier(slotNum) === target.tier
  }
  if (target.kind === 'town') {
    return townTypeId === target.townTypeId
  }
  if (target.kind === 'class') {
    return dwellingClassId(catalog, buildingId) === target.classId
  }
  if (target.kind === 'unit') {
    const unit = unitForBuilding(catalog, buildingId)
    if (!unit) {
      return false
    }
    return unitMatchesTarget(catalog, unit.id, target)
  }
  return false
}

export function applyRecruitPctModifier(base: number, pct: number | null | undefined): number {
  if (base <= 0 || pct == null || pct === 0) {
    return base
  }
  if (pct <= -100) {
    return 0
  }
  const delta = Math.floor(base * (pct / 100))
  let next = base + delta
  if (pct > 0 && next <= base) {
    next = base + 1
  }
  return Math.max(0, next)
}

export function applyWaitingRecruitPct(
  qty: number,
  pct: number | null | undefined,
): number {
  if (qty <= 0 || pct == null || pct === 0) {
    return qty
  }
  if (pct <= -100) {
    return 0
  }
  const delta = Math.floor(qty * (pct / 100))
  return Math.max(0, qty + delta)
}

export function eventBlocksTownBuildingIncomeWithCatalog(
  session: GameSession,
  catalog: ReferenceCatalog,
): boolean {
  const active = activeWorldEventForSession(session)
  if (!active) {
    return false
  }
  const row = eventRowById(catalog, active.eventId)
  return row?.block_town_income === true
}
