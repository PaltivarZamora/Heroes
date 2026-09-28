import { calendarDayNumber } from '../hex/calendar'
import { hexDistance, neighborHexes } from '../hex/pathfinding'
import { GOLD_RESOURCE_ID, resourceById } from '../hex/resources'
import { forEachPassableHex, getTile, isPassable } from '../hex/world'
import { isSiegeEngineUnit } from '../combat/siege'
import {
  buildingById,
  buildingGrowth,
  isAdvancedUnit,
  isArmySlot,
  questFeatureMult,
  unitById,
  unitEffectiveTier,
  unitForBuilding,
  unitHasTag,
  type FeatureRow,
  type QuestTextRow,
  type ReferenceCatalog,
  type UnitRow,
} from '../town/catalog'
import { mapTownTypeIds, recruitsScoutExploreValue } from './recruits'
import { abilityById, townDisciplineIds } from '../town/libraryRules'
import {
  awardHeroXp,
  levelUpNoticeForAward,
  type LevelUpNotice,
} from './xp'
import { compassDirection } from './sign'
import { removeWorldMob } from './mobs'
import {
  ARMY_STACK_SLOTS,
  type AxialPos,
  type GameSession,
  type MapFeature,
  type Mob,
  type QuestCategory,
  type QuestPlayerState,
  type UnitStack,
  type WeeklyQuest,
} from './types'

export type NoticeBoardFeature = Extract<
  MapFeature,
  { kind: 'notice_board' }
>

export type NoticeBoardStats = {
  bring_resources: Record<
    number,
    { qty: number; pool: number[]; picks: number }
  >
  bring_units: {
    qty: Record<number, number>
    groups: Record<string, { rule: string; label: string }>
  }
  know_ability: { ability_level: Record<number, number> }
  control_nodes: Record<number, Array<{ qty: number; pool: number[] }>>
  defeat_mob: {
    spawn_min_hexes: number
    spawn_max_hexes: number
    stacks_per_tier: number
  }
  visit_feature: { eligible_types: string[] }
  rewards: Record<number, { xp: number; gold: number }>
}

export type QuestLogEntry = {
  featureId: string
  townName: string
  quest: WeeklyQuest
  state: QuestPlayerState
}

export const declineNoticeBoardMessage =
  'We were really hoping for your help. Check back next week if we are still here.'

export const turnedInThankYouMessage =
  'Thank you adventurer, check back next week, we may need your help again.'

const EMPTY_PLAYER_STATE: QuestPlayerState = {
  accepted: false,
  completed: false,
  turned_in: false,
  accepted_on_day: null,
}

const CATEGORIES: QuestCategory[] = [
  'bring_resources',
  'bring_units',
  'know_ability',
  'control_nodes',
  'defeat_mob',
  'visit_feature',
]

/** feature_type.name → session MapFeature.kind */
const FEATURE_TYPE_TO_KIND: Record<string, MapFeature['kind']> = {
  fountain: 'fountain',
  sign: 'sign',
  library: 'library',
  hanger: 'hanger',
  dock: 'dock',
  recruit_building: 'recruits',
  quest: 'notice_board',
  chest: 'chest',
}

function posKey(position: AxialPos): string {
  return `${position.q},${position.r}`
}

function asInt(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.floor(n) : fallback
}

function asIntList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return []
  }
  const out: number[] = []
  for (const entry of value) {
    const n = asInt(entry, 0)
    if (n > 0) {
      out.push(n)
    }
  }
  return out
}

function pickUniform<T>(pool: T[], rng: () => number): T | null {
  if (pool.length === 0) {
    return null
  }
  return pool[Math.floor(rng() * pool.length)] ?? null
}

function weightedPickText(rows: QuestTextRow[], rng: () => number): QuestTextRow | null {
  if (rows.length === 0) {
    return null
  }
  let sum = 0
  for (const row of rows) {
    sum += Math.max(1, row.weight)
  }
  let roll = Math.floor(rng() * Math.max(1, sum))
  for (const row of rows) {
    roll -= Math.max(1, row.weight)
    if (roll < 0) {
      return row
    }
  }
  return rows[rows.length - 1] ?? null
}

function questTextRows(catalog: ReferenceCatalog): QuestTextRow[] {
  return catalog.quest_text ?? []
}

function tierMapNumber(
  raw: unknown,
): Record<number, number> {
  const out: Record<number, number> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return out
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const tier = asInt(key, 0)
    const n = asInt(value, 0)
    if (tier > 0 && n > 0) {
      out[tier] = n
    }
  }
  return out
}

function rewardForTier(
  stats: NoticeBoardStats,
  tier: number,
): { xp: number; gold: number } {
  const row = stats.rewards[tier] ?? stats.rewards[1]
  return {
    xp: Math.max(0, row?.xp ?? 0),
    gold: Math.max(0, row?.gold ?? 0),
  }
}

export function findNoticeBoardAt(
  session: GameSession,
  q: number,
  r: number,
): NoticeBoardFeature | undefined {
  return (session.features ?? []).find(
    (row): row is NoticeBoardFeature =>
      row.kind === 'notice_board' &&
      row.position.q === q &&
      row.position.r === r,
  )
}

export function findNoticeBoardById(
  session: GameSession,
  featureId: string,
): NoticeBoardFeature | undefined {
  return (session.features ?? []).find(
    (row): row is NoticeBoardFeature =>
      row.kind === 'notice_board' && row.id === featureId,
  )
}

/** Catalog feature row for Notice Boards (`feature_type.name === 'quest'`). */
export function noticeBoardFeatureRow(
  catalog: ReferenceCatalog | null | undefined,
): FeatureRow | undefined {
  const typeId = catalog?.feature_type.find((row) => row.name === 'quest')?.id
  if (typeId == null) {
    return undefined
  }
  return catalog?.feature.find((row) => row.feature_type_id === typeId)
}

export function noticeBoardStats(
  catalog: ReferenceCatalog | null | undefined,
): NoticeBoardStats {
  const stats = noticeBoardFeatureRow(catalog)?.stats ?? {}
  const bringRaw =
    stats.bring_resources && typeof stats.bring_resources === 'object'
      ? (stats.bring_resources as Record<string, unknown>)
      : {}
  const bring_resources: NoticeBoardStats['bring_resources'] = {}
  for (const [key, value] of Object.entries(bringRaw)) {
    const tier = asInt(key, 0)
    if (tier < 1 || !value || typeof value !== 'object') {
      continue
    }
    const rec = value as Record<string, unknown>
    bring_resources[tier] = {
      qty: Math.max(1, asInt(rec.qty, 1)),
      pool: asIntList(rec.pool),
      picks: Math.max(1, asInt(rec.picks, 1)),
    }
  }

  const unitsRaw =
    stats.bring_units && typeof stats.bring_units === 'object'
      ? (stats.bring_units as Record<string, unknown>)
      : {}
  const groupsRaw =
    unitsRaw.groups && typeof unitsRaw.groups === 'object'
      ? (unitsRaw.groups as Record<string, unknown>)
      : {}
  const groups: NoticeBoardStats['bring_units']['groups'] = {}
  for (const [key, value] of Object.entries(groupsRaw)) {
    if (!value || typeof value !== 'object') {
      continue
    }
    const rec = value as Record<string, unknown>
    const rule = typeof rec.rule === 'string' ? rec.rule : 'has_tag'
    const label =
      typeof rec.label === 'string' && rec.label.trim()
        ? rec.label.trim()
        : key
    groups[key] = { rule, label }
  }

  const knowRaw =
    stats.know_ability && typeof stats.know_ability === 'object'
      ? (stats.know_ability as Record<string, unknown>)
      : {}
  const controlRaw =
    stats.control_nodes && typeof stats.control_nodes === 'object'
      ? (stats.control_nodes as Record<string, unknown>)
      : {}
  const control_nodes: NoticeBoardStats['control_nodes'] = {}
  for (const [key, value] of Object.entries(controlRaw)) {
    const tier = asInt(key, 0)
    if (tier < 1 || !Array.isArray(value)) {
      continue
    }
    const options: Array<{ qty: number; pool: number[] }> = []
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') {
        continue
      }
      const rec = entry as Record<string, unknown>
      options.push({
        qty: Math.max(1, asInt(rec.qty, 1)),
        pool: asIntList(rec.pool),
      })
    }
    if (options.length > 0) {
      control_nodes[tier] = options
    }
  }

  const defeatRaw =
    stats.defeat_mob && typeof stats.defeat_mob === 'object'
      ? (stats.defeat_mob as Record<string, unknown>)
      : {}
  const visitRaw =
    stats.visit_feature && typeof stats.visit_feature === 'object'
      ? (stats.visit_feature as Record<string, unknown>)
      : {}
  const eligible =
    Array.isArray(visitRaw.eligible_types)
      ? visitRaw.eligible_types
          .map((row) => (typeof row === 'string' ? row.trim().toLowerCase() : ''))
          .filter((row) => row.length > 0)
      : []

  const rewardsRaw =
    stats.rewards && typeof stats.rewards === 'object'
      ? (stats.rewards as Record<string, unknown>)
      : {}
  const rewards: NoticeBoardStats['rewards'] = {}
  for (const [key, value] of Object.entries(rewardsRaw)) {
    const tier = asInt(key, 0)
    if (tier < 1 || !value || typeof value !== 'object') {
      continue
    }
    const rec = value as Record<string, unknown>
    rewards[tier] = {
      xp: Math.max(0, asInt(rec.xp, 0)),
      gold: Math.max(0, asInt(rec.gold, 0)),
    }
  }

  return {
    bring_resources,
    bring_units: {
      qty: tierMapNumber(unitsRaw.qty),
      groups,
    },
    know_ability: {
      ability_level: tierMapNumber(knowRaw.ability_level),
    },
    control_nodes,
    defeat_mob: {
      spawn_min_hexes: Math.max(1, asInt(defeatRaw.spawn_min_hexes, 2)),
      spawn_max_hexes: Math.max(1, asInt(defeatRaw.spawn_max_hexes, 3)),
      stacks_per_tier: Math.max(1, asInt(defeatRaw.stacks_per_tier, 1)),
    },
    visit_feature: { eligible_types: eligible },
    rewards,
  }
}

/**
 * Max dwelling `unit.tier` among built army-slot buildings in the linked town
 * (level ≥ 1). Never uses building.tier / slot alone when unit.tier exists.
 */
export function linkedTownArmyTier(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
): number {
  let max = 0
  for (const row of session.building_states) {
    if (row.town_id !== townId || row.level < 1 || row.building_id == null) {
      continue
    }
    if (!isArmySlot(row.slot_num)) {
      continue
    }
    const unit = unitForBuilding(catalog, row.building_id)
    if (!unit) {
      continue
    }
    max = Math.max(max, unitEffectiveTier(catalog, unit))
  }
  return Math.max(1, max)
}

export function playerQuestState(
  board: NoticeBoardFeature,
  playerId: string,
): QuestPlayerState {
  return board.by_player[playerId] ?? { ...EMPTY_PLAYER_STATE }
}

/** Snapshot of this week's quest for one AI player (BR S9-11). */
export function noticeBoardKnowledgeFor(
  board: NoticeBoardFeature,
  playerId: string,
): WeeklyQuest | null {
  const known = board.known_by_player?.[playerId]
  return known ?? null
}

/**
 * Record that this player has seen the board's quest this week.
 * Called when a hero opens the popup (human) or visits (AI).
 */
export function recordNoticeBoardKnowledge(
  session: GameSession,
  featureId: string,
  playerId: string,
): GameSession {
  const board = findNoticeBoardById(session, featureId)
  if (!board?.quest) {
    return session
  }
  if (board.known_by_player?.[playerId]) {
    return session
  }
  return updateBoard(session, featureId, (row) => ({
    ...row,
    known_by_player: {
      ...(row.known_by_player ?? {}),
      [playerId]: { ...row.quest! },
    },
  }))
}

/** Same early-week scout curve as Recruits for Hire (S9-9). */
export const noticeBoardScoutExploreValue = recruitsScoutExploreValue

/**
 * Days left in the week including today (day 7 → 1).
 * Late-week accept gate: round-trip to board + 1 day of work must fit.
 */
export function daysLeftInWeek(dayOfWeek: number): number {
  const d = Math.max(1, Math.min(7, Math.floor(dayOfWeek)))
  return 8 - d
}

/**
 * True when there is still time this week to reach the board, do work, and
 * return. Estimate: `2 × ceil(travelMp / maxMp) + 1` day(s) ≤ days left.
 */
export function noticeBoardAcceptFitsWeek(args: {
  dayOfWeek: number
  travelMp: number
  maxMp: number
}): boolean {
  const daysLeft = daysLeftInWeek(args.dayOfWeek)
  const maxMp = Math.max(1, args.maxMp)
  const daysToBoard = Math.max(1, Math.ceil(args.travelMp / maxMp))
  const need = daysToBoard * 2 + 1
  return need <= daysLeft
}

export function noticeBoardTooltip(
  session: GameSession,
  board: NoticeBoardFeature,
): string {
  const town = session.towns.find((row) => row.id === board.linked_town_id)
  const name = town?.name?.trim() || 'Town'
  return `Notice Board for ${name}`
}

function tagIdByName(
  catalog: ReferenceCatalog,
  name: string,
): number | null {
  const needle = name.trim().toLowerCase()
  const row = catalog.unit_tag.find(
    (entry) => entry.value.trim().toLowerCase() === needle,
  )
  return row?.id ?? null
}

function unitMatchesBringGroup(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  groupKey: string,
  rule: string,
): boolean {
  if (rule === 'not_humanoid_or_beast') {
    const humanoid = tagIdByName(catalog, 'Humanoid')
    const beast = tagIdByName(catalog, 'Beast')
    if (humanoid != null && unitHasTag(unit, humanoid)) {
      return false
    }
    if (beast != null && unitHasTag(unit, beast)) {
      return false
    }
    return true
  }
  // Default / has_tag — group key is the tag name (Beast, Living, …).
  const tagId = tagIdByName(catalog, groupKey)
  return tagId != null && unitHasTag(unit, tagId)
}

function isRecruitableExactTier(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  tier: number,
): boolean {
  if (!unit.has_abilities || (unit.speed ?? 0) <= 0) {
    return false
  }
  if (isSiegeEngineUnit(unit)) {
    return false
  }
  if (unit.bldg_id == null || unit.bldg_id < 1) {
    return false
  }
  if (buildingGrowth(buildingById(catalog, unit.bldg_id)) <= 0) {
    return false
  }
  return unitEffectiveTier(catalog, unit) === tier
}

function occupiedKeys(session: GameSession): Set<string> {
  const keys = new Set<string>()
  for (const town of session.towns) {
    keys.add(posKey(town.position))
  }
  for (const hero of session.heroes) {
    keys.add(posKey(hero.position))
  }
  for (const node of session.nodes) {
    if (node.kind === 'pickup' && node.collected) {
      continue
    }
    keys.add(posKey(node.position))
  }
  for (const feature of session.features ?? []) {
    keys.add(posKey(feature.position))
    if (feature.kind === 'chest' && feature.guard) {
      keys.add(posKey(feature.guard))
    }
    if (feature.kind === 'dock') {
      keys.add(posKey(feature.launch))
    }
  }
  for (const boat of session.boats ?? []) {
    keys.add(posKey(boat.position))
  }
  for (const mob of session.mobs) {
    keys.add(posKey(mob.position))
  }
  return keys
}

function reserveDefeatSpawn(
  session: GameSession,
  from: AxialPos,
  minHexes: number,
  maxHexes: number,
  rng: () => number,
): AxialPos | null {
  const occupied = occupiedKeys(session)
  const candidates: AxialPos[] = []
  forEachPassableHex((q, r) => {
    const hex = { q, r }
    const dist = hexDistance(from, hex)
    if (dist < minHexes || dist > maxHexes) {
      return
    }
    if (occupied.has(posKey(hex))) {
      return
    }
    candidates.push(hex)
  })
  return pickUniform(candidates, rng)
}

function preRollDefeatStacks(
  catalog: ReferenceCatalog,
  tier: number,
  stacksPerTier: number,
  rng: () => number,
): Array<{ unit_id: number; qty: number }> {
  const stackCount = Math.max(1, tier * stacksPerTier)
  const basePool = catalog.unit.filter(
    (unit) =>
      !isAdvancedUnit(unit) && isRecruitableExactTier(catalog, unit, tier),
  )
  if (basePool.length === 0) {
    return []
  }
  const stacks: Array<{ unit_id: number; qty: number }> = []
  for (let i = 0; i < stackCount; i += 1) {
    const base = pickUniform(basePool, rng)
    if (!base) {
      break
    }
    const wantAdvanced = rng() < 0.5
    let unit = base
    if (wantAdvanced) {
      const advanced = catalog.unit.find(
        (row) =>
          isAdvancedUnit(row) &&
          isRecruitableExactTier(catalog, row, tier) &&
          row.name.trim().toLowerCase() ===
            `advanced ${base.name.trim()}`.toLowerCase(),
      )
      if (advanced) {
        unit = advanced
      }
    }
    const qty = Math.max(1, buildingGrowth(buildingById(catalog, unit.bldg_id)))
    stacks.push({ unit_id: unit.id, qty })
  }
  return stacks
}

function featureKindLabel(kind: MapFeature['kind']): string {
  switch (kind) {
    case 'fountain':
      return 'Fountain'
    case 'sign':
      return 'Sign'
    case 'library':
      return 'Library'
    case 'hanger':
      return 'Hanger'
    case 'dock':
      return 'Dock'
    case 'recruits':
      return 'Recruits'
    case 'notice_board':
      return 'Notice Board'
    case 'chest':
      return 'Chest'
    default:
      return 'Feature'
  }
}

function signHasTokens(
  catalog: ReferenceCatalog,
  feature: Extract<MapFeature, { kind: 'sign' }>,
): boolean {
  const custom = feature.custom_text?.trim()
  if (custom) {
    return custom.includes('{')
  }
  const row = catalog.sign_text.find((entry) => entry.id === feature.sign_text_id)
  return Boolean(row?.text.includes('{'))
}

function visitCandidates(
  session: GameSession,
  catalog: ReferenceCatalog,
  board: NoticeBoardFeature,
  stats: NoticeBoardStats,
  minDist: number,
): MapFeature[] {
  const kinds = new Set<MapFeature['kind']>()
  for (const typeName of stats.visit_feature.eligible_types) {
    const kind = FEATURE_TYPE_TO_KIND[typeName]
    if (kind) {
      kinds.add(kind)
    }
  }
  const out: MapFeature[] = []
  for (const feature of session.features ?? []) {
    if (feature.id === board.id) {
      continue
    }
    if (!kinds.has(feature.kind)) {
      continue
    }
    if (hexDistance(board.position, feature.position) < minDist) {
      continue
    }
    if (feature.kind === 'sign' && signHasTokens(catalog, feature)) {
      continue
    }
    out.push(feature)
  }
  return out
}

function pickVisitTarget(
  session: GameSession,
  catalog: ReferenceCatalog,
  board: NoticeBoardFeature,
  stats: NoticeBoardStats,
  startTier: number,
  rng: () => number,
): { feature: MapFeature; tier: number } | null {
  const multiplier = questFeatureMult(catalog)
  for (let tier = startTier; tier >= 1; tier -= 1) {
    const minDist = tier * multiplier
    const pool = visitCandidates(session, catalog, board, stats, minDist)
    const pick = pickUniform(pool, rng)
    if (pick) {
      return { feature: pick, tier }
    }
  }
  return null
}

function buildGoalLine(
  catalog: ReferenceCatalog,
  quest: Omit<WeeklyQuest, 'flavour_text' | 'goal_line'>,
  boardPos: AxialPos,
): string {
  switch (quest.category) {
    case 'bring_resources': {
      const parts = (quest.resources ?? []).map((row) => {
        const name = resourceById(row.resource_id)?.name ?? `Resource ${row.resource_id}`
        return `${row.qty} ${name}`
      })
      return parts.length > 0 ? `Bring ${parts.join(' and ')}` : 'Bring resources'
    }
    case 'bring_units': {
      const ask = quest.bring_units
      if (!ask) {
        return 'Bring units'
      }
      return `Bring ${ask.qty} ${ask.label} (Tier ${ask.min_tier}+)`
    }
    case 'know_ability': {
      const name =
        quest.ability_id != null
          ? abilityById(catalog, quest.ability_id)?.name
          : null
      return name ? `Learn ${name}` : 'Learn an ability'
    }
    case 'control_nodes': {
      const ask = quest.control_nodes
      if (!ask) {
        return 'Control mines'
      }
      const name = resourceById(ask.resource_id)?.name ?? 'resource'
      const noun = ask.qty === 1 ? 'mine' : 'mines'
      return `Control ${ask.qty} ${name} ${noun}`
    }
    case 'defeat_mob': {
      const spawn = quest.defeat?.reserved_spawn
      if (spawn) {
        return `Defeat the creatures to the ${compassDirection(boardPos, spawn)}`
      }
      return 'Defeat the marked creatures'
    }
    case 'visit_feature': {
      const visit = quest.visit
      if (!visit) {
        return 'Visit a feature'
      }
      return `Visit the ${visit.feature_label}`
    }
    default:
      return 'Complete the quest'
  }
}

function fillQuestTokens(
  template: string,
  catalog: ReferenceCatalog,
  boardPos: AxialPos,
  quest: Omit<WeeklyQuest, 'flavour_text' | 'goal_line'>,
  visitPos: AxialPos | null,
): string {
  if (!template.includes('{')) {
    return template
  }
  const resourceNames = (quest.resources ?? [])
    .map((row) => resourceById(row.resource_id)?.name ?? '')
    .filter(Boolean)
  const resourceQty = quest.resources?.[0]?.qty
  const ask =
    (quest.resources ?? []).length > 1
      ? (quest.resources ?? [])
          .map((row) => {
            const name = resourceById(row.resource_id)?.name ?? 'resource'
            return `${row.qty} ${name}`
          })
          .join(' and ')
      : resourceNames[0]
        ? `${resourceQty ?? ''} ${resourceNames[0]}`.trim()
        : ''
  const ability =
    quest.ability_id != null
      ? abilityById(catalog, quest.ability_id)
      : null
  const abilityName = ability?.name ?? ''
  const discipline =
    ability != null
      ? (catalog.discipline.find((row) => row.id === ability.discipline_id)
          ?.name ?? '')
      : ''
  let direction = ''
  let terrain = ''
  if (quest.defeat?.reserved_spawn) {
    direction = compassDirection(boardPos, quest.defeat.reserved_spawn)
    const tile = getTile(
      quest.defeat.reserved_spawn.q,
      quest.defeat.reserved_spawn.r,
    )
    const terrainName = tile?.terrain?.trim() ?? ''
    const terrainRow = catalog.terrain.find(
      (row) => row.name.trim().toLowerCase() === terrainName.toLowerCase(),
    )
    terrain = (terrainRow?.name ?? terrainName).toLowerCase()
  } else if (visitPos) {
    direction = compassDirection(boardPos, visitPos)
  }
  const controlName =
    quest.control_nodes != null
      ? (resourceById(quest.control_nodes.resource_id)?.name ?? '')
      : ''
  const values: Record<string, string> = {
    resource: resourceNames[0] || controlName,
    resources: resourceNames.join(' and '),
    ask,
    qty: String(
      resourceQty ??
        quest.bring_units?.qty ??
        quest.control_nodes?.qty ??
        '',
    ),
    amount: String(resourceQty ?? quest.bring_units?.qty ?? ''),
    group: quest.bring_units?.label ?? '',
    units: quest.bring_units?.label ?? '',
    unit_group: quest.bring_units?.label ?? '',
    ability: abilityName,
    discipline,
    feature: quest.visit?.feature_label ?? '',
    feature_label: quest.visit?.feature_label ?? '',
    tier: quest.bring_units
      ? `T${quest.bring_units.min_tier}`
      : `T${quest.tier}`,
    direction,
    terrain,
  }
  return template.replace(/\{([a-z_]+)\}/gi, (_full, key: string) => {
    const hit = values[key.toLowerCase()]
    return hit != null && hit !== '' ? hit : `{${key}}`
  })
}

function questTextPoolFor(
  catalog: ReferenceCatalog,
  category: QuestCategory,
  questBody: Omit<WeeklyQuest, 'flavour_text' | 'goal_line'>,
): QuestTextRow[] {
  const all = questTextRows(catalog).filter((row) => row.category === category)
  if (category === 'bring_resources') {
    const resources = questBody.resources ?? []
    if (resources.length !== 1) {
      return all.filter((row) => row.resource_id == null)
    }
    const resourceId = resources[0]!.resource_id
    const matched = all.filter((row) => row.resource_id === resourceId)
    const generic = all.filter((row) => row.resource_id == null)
    return matched.length > 0 ? matched : generic
  }
  if (category === 'defeat_mob' && questBody.defeat) {
    const tile = getTile(
      questBody.defeat.reserved_spawn.q,
      questBody.defeat.reserved_spawn.r,
    )
    const terrainName = tile?.terrain?.trim().toLowerCase() ?? ''
    const terrainId =
      catalog.terrain.find(
        (row) => row.name.trim().toLowerCase() === terrainName,
      )?.id ?? null
    return all.filter(
      (row) =>
        row.terrain_id == null ||
        (terrainId != null && row.terrain_id === terrainId),
    )
  }
  return all
}

function resolveFlavour(
  catalog: ReferenceCatalog,
  category: QuestCategory,
  boardPos: AxialPos,
  questBody: Omit<WeeklyQuest, 'flavour_text' | 'goal_line'>,
  goalLine: string,
  visitPos: AxialPos | null,
  rng: () => number,
): string {
  const pool = [...questTextPoolFor(catalog, category, questBody)]
  while (pool.length > 0) {
    const pick = weightedPickText(pool, rng)
    if (!pick) {
      break
    }
    const filled = fillQuestTokens(
      pick.text,
      catalog,
      boardPos,
      questBody,
      visitPos,
    )
    if (filled.trim() && !filled.includes('{')) {
      return filled
    }
    const idx = pool.findIndex((row) => row.id === pick.id)
    if (idx >= 0) {
      pool.splice(idx, 1)
    } else {
      break
    }
  }
  return goalLine
}

function categoryEligible(
  session: GameSession,
  catalog: ReferenceCatalog,
  board: NoticeBoardFeature,
  stats: NoticeBoardStats,
  category: QuestCategory,
  startTier: number,
): boolean {
  switch (category) {
    case 'bring_resources':
      return (stats.bring_resources[startTier]?.pool.length ?? 0) > 0
    case 'bring_units':
      return (
        Object.keys(stats.bring_units.groups).length > 0 &&
        (stats.bring_units.qty[startTier] ?? 0) > 0
      )
    case 'know_ability': {
      const levelId = stats.know_ability.ability_level[startTier]
      return (
        levelId != null &&
        catalog.ability.some((row) => row.level_id === levelId)
      )
    }
    case 'control_nodes':
      return (stats.control_nodes[startTier] ?? []).some(
        (row) => row.pool.length > 0,
      )
    case 'defeat_mob': {
      const spawn = reserveDefeatSpawn(
        session,
        board.position,
        stats.defeat_mob.spawn_min_hexes,
        stats.defeat_mob.spawn_max_hexes,
        () => 0,
      )
      if (!spawn) {
        return false
      }
      return (
        preRollDefeatStacks(
          catalog,
          startTier,
          stats.defeat_mob.stacks_per_tier,
          () => 0,
        ).length > 0
      )
    }
    case 'visit_feature':
      return (
        pickVisitTarget(session, catalog, board, stats, startTier, () => 0) !=
        null
      )
    default:
      return false
  }
}

type RollContext = {
  category: QuestCategory
  tier: number
  body: Omit<WeeklyQuest, 'flavour_text' | 'goal_line' | 'category' | 'tier' | 'reward_xp' | 'reward_gold'>
}

function tryRollCategory(
  session: GameSession,
  catalog: ReferenceCatalog,
  board: NoticeBoardFeature,
  stats: NoticeBoardStats,
  category: QuestCategory,
  startTier: number,
  rng: () => number,
): RollContext | null {
  switch (category) {
    case 'bring_resources': {
      const cfg = stats.bring_resources[startTier]
      if (!cfg || cfg.pool.length === 0) {
        return null
      }
      const pool = [...cfg.pool]
      const picked: number[] = []
      const picks = Math.min(cfg.picks, pool.length)
      for (let i = 0; i < picks; i += 1) {
        const idx = Math.floor(rng() * pool.length)
        const [id] = pool.splice(idx, 1)
        if (id != null) {
          picked.push(id)
        }
      }
      if (picked.length === 0) {
        return null
      }
      return {
        category,
        tier: startTier,
        body: {
          resources: picked.map((resource_id) => ({
            resource_id,
            qty: cfg.qty,
          })),
        },
      }
    }
    case 'bring_units': {
      const groupKeys = Object.keys(stats.bring_units.groups)
      const qty = stats.bring_units.qty[startTier]
      if (groupKeys.length === 0 || qty == null || qty < 1) {
        return null
      }
      const key = pickUniform(groupKeys, rng)
      if (!key) {
        return null
      }
      const group = stats.bring_units.groups[key]!
      return {
        category,
        tier: startTier,
        body: {
          bring_units: {
            group_key: key,
            label: group.label,
            qty,
            min_tier: startTier,
          },
        },
      }
    }
    case 'know_ability': {
      const levelId = stats.know_ability.ability_level[startTier]
      if (levelId == null || levelId < 1) {
        return null
      }
      const discIds = new Set<number>()
      for (const townTypeId of mapTownTypeIds(session)) {
        for (const id of townDisciplineIds(catalog, townTypeId)) {
          discIds.add(id)
        }
      }
      const pool = catalog.ability.filter(
        (row) =>
          row.level_id === levelId &&
          (discIds.size === 0 || discIds.has(row.discipline_id)),
      )
      const ability = pickUniform(pool, rng)
      if (!ability) {
        return null
      }
      return {
        category,
        tier: startTier,
        body: { ability_id: ability.id },
      }
    }
    case 'control_nodes': {
      const options = stats.control_nodes[startTier]
      if (!options || options.length === 0) {
        return null
      }
      const option = pickUniform(options, rng)
      if (!option || option.pool.length === 0) {
        return null
      }
      const resourceId = pickUniform(option.pool, rng)
      if (resourceId == null) {
        return null
      }
      return {
        category,
        tier: startTier,
        body: {
          control_nodes: { resource_id: resourceId, qty: option.qty },
        },
      }
    }
    case 'defeat_mob': {
      const spawn = reserveDefeatSpawn(
        session,
        board.position,
        stats.defeat_mob.spawn_min_hexes,
        stats.defeat_mob.spawn_max_hexes,
        rng,
      )
      if (!spawn) {
        return null
      }
      const stacks = preRollDefeatStacks(
        catalog,
        startTier,
        stats.defeat_mob.stacks_per_tier,
        rng,
      )
      if (stacks.length === 0) {
        return null
      }
      return {
        category,
        tier: startTier,
        body: {
          defeat: { reserved_spawn: spawn, stacks },
        },
      }
    }
    case 'visit_feature': {
      const hit = pickVisitTarget(
        session,
        catalog,
        board,
        stats,
        startTier,
        rng,
      )
      if (!hit) {
        return null
      }
      return {
        category,
        tier: hit.tier,
        body: {
          visit: {
            feature_id: hit.feature.id,
            feature_label: featureKindLabel(hit.feature.kind),
          },
        },
      }
    }
    default:
      return null
  }
}

/** Roll one weekly quest for a Notice Board. */
export function rollWeeklyQuest(
  session: GameSession,
  catalog: ReferenceCatalog,
  board: NoticeBoardFeature,
  rng: () => number = Math.random,
): WeeklyQuest | null {
  const stats = noticeBoardStats(catalog)
  const startTier = linkedTownArmyTier(session, catalog, board.linked_town_id)
  const eligible = CATEGORIES.filter((category) =>
    categoryEligible(session, catalog, board, stats, category, startTier),
  )
  // Try categories in random order until one rolls successfully.
  const order = [...eligible]
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = order[i]!
    order[i] = order[j]!
    order[j] = tmp
  }
  let rolled: RollContext | null = null
  for (const category of order) {
    rolled = tryRollCategory(
      session,
      catalog,
      board,
      stats,
      category,
      startTier,
      rng,
    )
    if (rolled) {
      break
    }
  }
  if (!rolled) {
    return null
  }
  const reward = rewardForTier(stats, rolled.tier)
  const body: Omit<WeeklyQuest, 'flavour_text' | 'goal_line'> = {
    category: rolled.category,
    tier: rolled.tier,
    reward_xp: reward.xp,
    reward_gold: reward.gold,
    ...rolled.body,
  }
  const visitPos =
    body.visit != null
      ? (session.features ?? []).find((row) => row.id === body.visit!.feature_id)
          ?.position ?? null
      : null
  let goalLine = buildGoalLine(catalog, body, board.position)
  if (body.category === 'visit_feature' && body.visit && visitPos) {
    goalLine = `Visit the ${body.visit.feature_label} to the ${compassDirection(board.position, visitPos)}`
  }
  const flavour = resolveFlavour(
    catalog,
    body.category,
    board.position,
    body,
    goalLine,
    visitPos,
    rng,
  )
  return {
    ...body,
    flavour_text: flavour,
    goal_line: goalLine,
  }
}

function nextMobId(session: GameSession): string {
  let n = session.mobs.length + 1
  let id = `mob-${n}`
  while (session.mobs.some((row) => row.id === id)) {
    n += 1
    id = `mob-${n}`
  }
  return id
}

function nextStackId(session: GameSession): string {
  let n = session.units.length + 1
  while (session.units.some((unit) => unit.id === `unit-${n}`)) {
    n += 1
  }
  return `unit-${n}`
}

function padSlots(slots: Array<string | null>): Array<string | null> {
  const next = slots.slice(0, ARMY_STACK_SLOTS)
  while (next.length < ARMY_STACK_SLOTS) {
    next.push(null)
  }
  return next
}

function spawnDefeatMob(
  session: GameSession,
  position: AxialPos,
  stacks: Array<{ unit_id: number; qty: number }>,
): { session: GameSession; mobId: string } | null {
  if (stacks.length === 0) {
    return null
  }
  const mobId = nextMobId(session)
  const slots = padSlots([])
  let next = session
  let slot = 0
  for (const part of stacks) {
    if (slot >= ARMY_STACK_SLOTS || part.qty <= 0) {
      continue
    }
    const id = nextStackId(next)
    const stack: UnitStack = {
      id,
      unit_id: part.unit_id,
      qty: part.qty,
      town_id: null,
      hero_id: null,
      mob_id: mobId,
    }
    next = { ...next, units: [...next.units, stack] }
    slots[slot] = id
    slot += 1
  }
  if (slot === 0) {
    return null
  }
  const mob: Mob = {
    id: mobId,
    position: { ...position },
    slots_1_to_6: slots,
  }
  return { session: { ...next, mobs: [...next.mobs, mob] }, mobId }
}

function findSpawnNearReserved(
  session: GameSession,
  reserved: AxialPos,
): AxialPos | null {
  const occupied = occupiedKeys(session)
  if (isPassable(reserved.q, reserved.r) && !occupied.has(posKey(reserved))) {
    return reserved
  }
  for (const hex of neighborHexes(reserved)) {
    if (isPassable(hex.q, hex.r) && !occupied.has(posKey(hex))) {
      return hex
    }
  }
  return null
}

function updateBoard(
  session: GameSession,
  featureId: string,
  patch: (board: NoticeBoardFeature) => NoticeBoardFeature,
): GameSession {
  return {
    ...session,
    features: (session.features ?? []).map((row) =>
      row.kind === 'notice_board' && row.id === featureId ? patch(row) : row,
    ),
  }
}

function setPlayerState(
  board: NoticeBoardFeature,
  playerId: string,
  state: QuestPlayerState,
): NoticeBoardFeature {
  return {
    ...board,
    by_player: {
      ...board.by_player,
      [playerId]: state,
    },
  }
}

/** New Week: clear player state, despawn board targets, roll fresh quests. */
export function rollAllNoticeBoardQuests(
  session: GameSession,
  catalog: ReferenceCatalog,
): GameSession {
  let next = session
  // Despawn last week's shared defeat targets first.
  for (const row of session.features ?? []) {
    if (row.kind !== 'notice_board' || !row.target_mob_id) {
      continue
    }
    const mob = next.mobs.find((entry) => entry.id === row.target_mob_id)
    if (mob) {
      next = removeWorldMob(next, mob)
    }
  }
  next = {
    ...next,
    features: (next.features ?? []).map((row) => {
      if (row.kind !== 'notice_board') {
        return row
      }
      const cleared: NoticeBoardFeature = {
        ...row,
        quest: null,
        target_mob_id: null,
        by_player: {},
        known_by_player: {},
      }
      const quest = rollWeeklyQuest(next, catalog, cleared)
      return { ...cleared, quest }
    }),
  }
  return next
}

export function acceptNoticeBoardQuest(
  session: GameSession,
  catalog: ReferenceCatalog,
  featureId: string,
  playerId: string,
  heroId: string,
): { session: GameSession; error: string | null } {
  void catalog
  const board = findNoticeBoardById(session, featureId)
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!board || !board.quest) {
    return { session, error: 'No quest on this Notice Board.' }
  }
  if (!hero || hero.player_id !== playerId) {
    return { session, error: 'Hero not found.' }
  }
  // Visiting always teaches the board's quest (BR S9-11).
  let next = recordNoticeBoardKnowledge(session, featureId, playerId)
  const live = findNoticeBoardById(next, featureId)
  if (!live?.quest) {
    return { session: next, error: 'No quest on this Notice Board.' }
  }
  const state = playerQuestState(live, playerId)
  if (state.turned_in) {
    return { session: next, error: 'You already turned in this week\'s quest.' }
  }
  if (state.accepted) {
    return { session: next, error: null }
  }
  const day = calendarDayNumber(next.game.calendar)
  next = updateBoard(next, featureId, (row) =>
    setPlayerState(row, playerId, {
      accepted: true,
      completed: false,
      turned_in: false,
      accepted_on_day: day,
    }),
  )
  const quest = live.quest
  if (quest.category === 'defeat_mob' && quest.defeat) {
    const afterAccept = findNoticeBoardById(next, featureId)!
    const existingId = afterAccept.target_mob_id
    const existing =
      existingId != null
        ? next.mobs.find((row) => row.id === existingId)
        : undefined
    if (!existing) {
      const spawnAt = findSpawnNearReserved(next, quest.defeat.reserved_spawn)
      if (!spawnAt) {
        return { session: next, error: 'No room to spawn the quest target.' }
      }
      const spawned = spawnDefeatMob(next, spawnAt, quest.defeat.stacks)
      if (!spawned) {
        return { session: next, error: 'Could not spawn the quest target.' }
      }
      next = updateBoard(spawned.session, featureId, (row) => ({
        ...row,
        target_mob_id: spawned.mobId,
      }))
    }
  }
  return { session: next, error: null }
}

function heroArmyStacks(
  session: GameSession,
  heroId: string,
): UnitStack[] {
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero) {
    return []
  }
  const out: UnitStack[] = []
  for (const id of padSlots(hero.army.slots_1_to_6)) {
    if (!id) {
      continue
    }
    const stack = session.units.find((row) => row.id === id)
    if (stack && stack.qty > 0 && stack.hero_id === heroId) {
      out.push(stack)
    }
  }
  return out
}

function totalArmyQty(stacks: UnitStack[]): number {
  return stacks.reduce((sum, row) => sum + Math.max(0, row.qty), 0)
}

function matchingBringStacks(
  session: GameSession,
  catalog: ReferenceCatalog,
  heroId: string,
  ask: NonNullable<WeeklyQuest['bring_units']>,
): UnitStack[] {
  const group = noticeBoardStats(catalog).bring_units.groups[ask.group_key]
  const rule = group?.rule ?? 'has_tag'
  return heroArmyStacks(session, heroId).filter((stack) => {
    const unit = unitById(catalog, stack.unit_id)
    if (!unit) {
      return false
    }
    if (unitEffectiveTier(catalog, unit) < ask.min_tier) {
      return false
    }
    return unitMatchesBringGroup(catalog, unit, ask.group_key, rule)
  })
}

function ownedMineCount(
  session: GameSession,
  playerId: string,
  resourceId: number,
): number {
  let n = 0
  for (const node of session.nodes) {
    if (
      node.kind === 'mine' &&
      node.player_id === playerId &&
      node.resource_id === resourceId
    ) {
      n += 1
    }
  }
  return n
}

function knowAbilitySatisfied(
  session: GameSession,
  heroId: string,
  abilityId: number,
  acceptedOnDay: number | null,
): boolean {
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero || acceptedOnDay == null) {
    return false
  }
  return (hero.ability_learn_log ?? []).some(
    (row) =>
      row.ability_id === abilityId && row.learned_on_day >= acceptedOnDay,
  )
}

function questGoalMet(
  session: GameSession,
  catalog: ReferenceCatalog,
  board: NoticeBoardFeature,
  playerId: string,
  heroId: string,
): boolean {
  const quest = board.quest
  if (!quest) {
    return false
  }
  const state = playerQuestState(board, playerId)
  if (!state.accepted || state.turned_in) {
    return false
  }
  switch (quest.category) {
    case 'defeat_mob':
    case 'visit_feature':
      return state.completed
    case 'bring_resources': {
      const player = session.players.find((row) => row.id === playerId)
      if (!player) {
        return false
      }
      return (quest.resources ?? []).every(
        (row) => (player.resources[row.resource_id] ?? 0) >= row.qty,
      )
    }
    case 'bring_units': {
      const ask = quest.bring_units
      if (!ask) {
        return false
      }
      const matching = matchingBringStacks(session, catalog, heroId, ask)
      const matchQty = totalArmyQty(matching)
      const allQty = totalArmyQty(heroArmyStacks(session, heroId))
      return matchQty >= ask.qty && allQty - ask.qty >= 1
    }
    case 'know_ability':
      return (
        quest.ability_id != null &&
        knowAbilitySatisfied(
          session,
          heroId,
          quest.ability_id,
          state.accepted_on_day,
        )
      )
    case 'control_nodes': {
      const ask = quest.control_nodes
      if (!ask) {
        return false
      }
      return ownedMineCount(session, playerId, ask.resource_id) >= ask.qty
    }
    default:
      return false
  }
}

export function canCollectQuestReward(
  session: GameSession,
  catalog: ReferenceCatalog,
  featureId: string,
  playerId: string,
  heroId: string,
): boolean {
  const board = findNoticeBoardById(session, featureId)
  if (!board?.quest) {
    return false
  }
  const state = playerQuestState(board, playerId)
  if (!state.accepted || state.turned_in) {
    return false
  }
  return questGoalMet(session, catalog, board, playerId, heroId)
}

function consumeBringResources(
  session: GameSession,
  playerId: string,
  resources: Array<{ resource_id: number; qty: number }>,
): { session: GameSession; error: string | null } {
  const player = session.players.find((row) => row.id === playerId)
  if (!player) {
    return { session, error: 'Player not found.' }
  }
  for (const row of resources) {
    if ((player.resources[row.resource_id] ?? 0) < row.qty) {
      const name = resourceById(row.resource_id)?.name ?? 'resource'
      return { session, error: `Not enough ${name}.` }
    }
  }
  return {
    session: {
      ...session,
      players: session.players.map((row) => {
        if (row.id !== playerId) {
          return row
        }
        const next = { ...row.resources }
        for (const ask of resources) {
          next[ask.resource_id] = (next[ask.resource_id] ?? 0) - ask.qty
        }
        return { ...row, resources: next }
      }),
    },
    error: null,
  }
}

function consumeBringUnits(
  session: GameSession,
  catalog: ReferenceCatalog,
  heroId: string,
  ask: NonNullable<WeeklyQuest['bring_units']>,
): { session: GameSession; error: string | null } {
  const matching = matchingBringStacks(session, catalog, heroId, ask)
  const matchQty = totalArmyQty(matching)
  const allStacks = heroArmyStacks(session, heroId)
  const allQty = totalArmyQty(allStacks)
  if (matchQty < ask.qty || allQty - ask.qty < 1) {
    return { session, error: 'Not enough matching units to turn in.' }
  }
  // Weakest first: lowest unit.tier, then smallest qty.
  const ordered = [...matching].sort((a, b) => {
    const ua = unitById(catalog, a.unit_id)
    const ub = unitById(catalog, b.unit_id)
    const ta = ua ? unitEffectiveTier(catalog, ua) : 99
    const tb = ub ? unitEffectiveTier(catalog, ub) : 99
    return ta - tb || a.qty - b.qty || a.id.localeCompare(b.id)
  })
  let remaining = ask.qty
  const qtyById = new Map<string, number>()
  for (const stack of ordered) {
    qtyById.set(stack.id, stack.qty)
  }
  for (const stack of ordered) {
    if (remaining <= 0) {
      break
    }
    const have = qtyById.get(stack.id) ?? 0
    const take = Math.min(have, remaining)
    qtyById.set(stack.id, have - take)
    remaining -= take
  }
  if (remaining > 0) {
    return { session, error: 'Not enough matching units to turn in.' }
  }
  const dropIds = new Set<string>()
  const units = session.units.map((row) => {
    if (!qtyById.has(row.id)) {
      return row
    }
    const qty = qtyById.get(row.id) ?? 0
    if (qty <= 0) {
      dropIds.add(row.id)
      return { ...row, qty: 0 }
    }
    return { ...row, qty }
  }).filter((row) => !dropIds.has(row.id))
  return {
    session: {
      ...session,
      units,
      heroes: session.heroes.map((hero) => {
        if (hero.id !== heroId) {
          return hero
        }
        const slots = padSlots(hero.army.slots_1_to_6).map((id) =>
          id && dropIds.has(id) ? null : id,
        )
        return { ...hero, army: { ...hero.army, slots_1_to_6: slots } }
      }),
    },
    error: null,
  }
}

function grantGold(
  session: GameSession,
  playerId: string,
  gold: number,
): GameSession {
  if (gold <= 0) {
    return session
  }
  return {
    ...session,
    players: session.players.map((row) =>
      row.id === playerId
        ? {
            ...row,
            resources: {
              ...row.resources,
              [GOLD_RESOURCE_ID]:
                (row.resources[GOLD_RESOURCE_ID] ?? 0) + gold,
            },
          }
        : row,
    ),
  }
}

export function collectQuestReward(
  session: GameSession,
  catalog: ReferenceCatalog,
  featureId: string,
  playerId: string,
  heroId: string,
): {
  session: GameSession
  error: string | null
  levelUpNotice: LevelUpNotice | null
} {
  const board = findNoticeBoardById(session, featureId)
  if (!board?.quest) {
    return { session, error: 'No quest on this Notice Board.', levelUpNotice: null }
  }
  if (!canCollectQuestReward(session, catalog, featureId, playerId, heroId)) {
    return { session, error: 'Quest is not ready to turn in.', levelUpNotice: null }
  }
  const quest = board.quest
  let next = session
  if (quest.category === 'bring_resources') {
    const spent = consumeBringResources(next, playerId, quest.resources ?? [])
    if (spent.error) {
      return { session, error: spent.error, levelUpNotice: null }
    }
    next = spent.session
  } else if (quest.category === 'bring_units' && quest.bring_units) {
    const spent = consumeBringUnits(next, catalog, heroId, quest.bring_units)
    if (spent.error) {
      return { session, error: spent.error, levelUpNotice: null }
    }
    next = spent.session
  }
  next = grantGold(next, playerId, quest.reward_gold)
  const xp = awardHeroXp(next, catalog, heroId, quest.reward_xp)
  next = xp.session
  next = updateBoard(next, featureId, (row) =>
    setPlayerState(row, playerId, {
      ...playerQuestState(row, playerId),
      completed: true,
      turned_in: true,
    }),
  )
  return {
    session: next,
    error: null,
    levelUpNotice: levelUpNoticeForAward(catalog, xp),
  }
}

/** Mark Defeat Mob quests completed when the board's target dies. */
export function creditDefeatMobKill(
  session: GameSession,
  mobId: string,
  killerPlayerId: string,
): GameSession {
  let changed = false
  const features = (session.features ?? []).map((row) => {
    if (row.kind !== 'notice_board' || row.target_mob_id !== mobId) {
      return row
    }
    changed = true
    const state = playerQuestState(row, killerPlayerId)
    let nextRow: NoticeBoardFeature = { ...row, target_mob_id: null }
    if (state.accepted && !state.turned_in && !state.completed) {
      nextRow = setPlayerState(nextRow, killerPlayerId, {
        ...state,
        completed: true,
      })
    }
    return nextRow
  })
  return changed ? { ...session, features } : session
}

/** Mark Visit Feature quests completed when the target is visited. */
export function creditVisitFeature(
  session: GameSession,
  featureId: string,
  playerId: string,
): GameSession {
  let changed = false
  const features = (session.features ?? []).map((row) => {
    if (row.kind !== 'notice_board') {
      return row
    }
    const quest = row.quest
    if (
      !quest ||
      quest.category !== 'visit_feature' ||
      quest.visit?.feature_id !== featureId
    ) {
      return row
    }
    const state = playerQuestState(row, playerId)
    if (!state.accepted || state.turned_in || state.completed) {
      return row
    }
    changed = true
    return setPlayerState(row, playerId, {
      ...state,
      completed: true,
    })
  })
  return changed ? { ...session, features } : session
}

/** Append an ability learn log entry (Know Ability quest gate). */
export function recordAbilityLearned(
  session: GameSession,
  heroId: string,
  abilityId: number,
): GameSession {
  const day = calendarDayNumber(session.game.calendar)
  return {
    ...session,
    heroes: session.heroes.map((hero) => {
      if (hero.id !== heroId) {
        return hero
      }
      const log = [...(hero.ability_learn_log ?? [])]
      log.push({ ability_id: abilityId, learned_on_day: day })
      return { ...hero, ability_learn_log: log }
    }),
  }
}

export function questLogEntries(
  session: GameSession,
  playerId: string,
): QuestLogEntry[] {
  const out: QuestLogEntry[] = []
  for (const row of session.features ?? []) {
    if (row.kind !== 'notice_board' || !row.quest) {
      continue
    }
    const state = playerQuestState(row, playerId)
    if (!state.accepted) {
      continue
    }
    const town = session.towns.find((entry) => entry.id === row.linked_town_id)
    out.push({
      featureId: row.id,
      townName: town?.name?.trim() || 'Town',
      quest: row.quest,
      state,
    })
  }
  return out
}
