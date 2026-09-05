import {
  GOLD_RESOURCE_ID,
  RESOURCES,
  applyResourceCatalog,
  formatAmount,
  resourceById,
} from '../hex/resources'
import type { DataStatus } from '../hex/debug'
import { slotFromPlayerId } from '../session/types'

export type CostMap = Record<number, number>

export type RequireClause = { all: number[] } | { any: number[] }

export type BuildingRow = {
  id: number
  name: string
  town_id: number
  tier: number | null
  class_id: number | null
  cost: CostMap | null
  effect_type: string
  payload: Record<string, unknown> | null
  destroy_cost: CostMap | null
  slot_num: number | null
  image_path: string | null
  /** Catalog building level in its slot. 1 = Build root; 2+ = Upgrade. */
  level: number
  /** Cross-slot gates. Null/empty always passes. */
  requires: RequireClause[] | null
  /** Weekly unit growth added to recruit_qty on week rollover. */
  growth: number | null
}

export type UnitRow = {
  id: number
  name: string
  bldg_id: number | null
  cost: CostMap | null
  image_path: string | null
  /** Battlefield footprint in hexes. Null means 1. */
  hex_size: number | null
  /** Null speed = never acts (no initiative, no log). */
  speed: number | null
  /** Attack-in-place only; Speed may still be set for turn order. */
  stationary: boolean
  move_type_id: number | null
  health: number
  defense: number
  resistance: number
  dmg_type: string | null
  min_dmg: number
  max_dmg: number
  min_range: number
  max_range: number
  /** Battlefield retaliation. Always a resolved spec (null data → default). */
  retaliation: UnitRetaliation
  abilities: UnitCombatAbilities
  /** Catalog `unit_tag.id` values from unit.tags. */
  tags: number[]
}

export type UnitRetaliation = {
  dmgPct: number | 'max'
  times: number | 'unlimited'
  preemptive: boolean
}

export type AttackShapeKind =
  | 'single'
  | 'cleave'
  | 'aoe'
  | 'pulse'
  | 'chain'
  | 'beam'
  | 'multi'
  | 'rain'
  | 'breath'

export type AutoTargetKind = 'random_wall_segment' | 'random_enemy'

export type UnitCombatAbilities = {
  no_enemy_retaliation: boolean
  shape: AttackShapeKind
  radius: number
  jumps: number
  falloff: number
  targets: number
  rows: number
  autoTarget: AutoTargetKind | null
  skipIfNone: boolean
  /** Catalog condition.id inflicted on a successful attack. */
  inflictsCondition: number | null
  /** Which unit stat the target rolls to resist that condition. */
  resistStat: 'resistance' | 'defense' | null
  /** Forced turns remaining when the condition lands. */
  conditionDuration: number
}

export const DEFAULT_UNIT_RETALIATION: UnitRetaliation = {
  dmgPct: 50,
  times: 1,
  preemptive: false,
}

export const DEFAULT_UNIT_ABILITIES: UnitCombatAbilities = {
  no_enemy_retaliation: false,
  shape: 'single',
  radius: 1,
  jumps: 1,
  falloff: 0,
  targets: 1,
  rows: 2,
  autoTarget: null,
  skipIfNone: false,
  inflictsCondition: null,
  resistStat: null,
  conditionDuration: 1,
}

export type MoveTypeRow = {
  id: number
  name: string
}

export type AppConfigRow = {
  key: string
  value: string
  description: string | null
}

export type TerrainTypeRow = {
  id: number
  name: string
  move_cost: number | null
  is_blocked: boolean
  /** Sight, not movement. Water can block walking and still leave LOS open. */
  blocks_los: boolean
  variants: number
  /** Hand-placed only when false (Barrier, Void). */
  random_eligible: boolean
  /** Flat HP loss (Moat). Not combat damage — no Defense/Resistance. */
  entry_damage: number | null
}

export type HeroTypeRow = {
  id: number
  name: string
  town_id: number
  speed: number
  strength: number
  intel: number
  defense: number
  resist: number
  crit_pct: number
  crit_amt: number
  stamina: number
}

export const HERO_STAT_KEYS = [
  'speed',
  'stamina',
  'strength',
  'intel',
  'defense',
  'resist',
  'crit_pct',
  'crit_amt',
] as const

export type HeroStatKey = (typeof HERO_STAT_KEYS)[number]

export type HeroStats = Record<HeroStatKey, number>

export type LevelRow = {
  id: number
  xp: number
}

export type HeroLevelRow = {
  hero_type_id: number
  level_id: number
  stat_bumps: Partial<HeroStats>
}

export type HeroPoolRow = {
  id: number
  name: string
  class_id: number
  image_path: string | null
}

export type ResourceRow = {
  id: number
  name: string
  base_value: number
}

export type MarketRow = {
  qty: number
  conversion_rate: number
}

export type AbilityRow = {
  id: number
  discipline_id: number
  level_id: number
  name: string
  description: string
  /** ability_resource.id — 1=Energy, 2=Mana. */
  resource_id: number
  /** Flat spend from that resource. 10/25/50 by tier. */
  cost: number
  /** ability_cooldown.id — 0=None, 1=Once, 2=Daily. */
  cooldown_id: number
  /** ability_target.id. Null = not designed yet. */
  target_id: number | null
  /** ability_type.id. Null = not designed yet. */
  ability_type_id: number | null
  /** Effect payload. Null = not designed yet; skip, not an error. */
  stats: Record<string, unknown> | null
}

export type AbilityResourceRow = {
  id: number
  value: string
}

export type AbilityCooldownRow = {
  id: number
  value: string
  description: string
}

export type AbilityTargetRow = {
  id: number
  value: string
}

export type AbilityTypeRow = {
  id: number
  value: string
}

export type DisciplineRow = {
  id: number
  name: string
}

export type AbilityLevelRow = {
  id: number
  value: string
}

export type HeroDisciplineRow = {
  hero_id: number
  discipline_id: number
}

export type DifficultyRow = {
  id: number
  name: string
  payload: Record<string, unknown> | null
}

export type PlayerColorRow = {
  id: number
  name: string
  hex_value: string
}

export type TownRow = {
  id: number
  name: string
}

export type TownLayoutRow = {
  id: number
  town_type_id: number
  slot: number
  x_pos: number
  y_pos: number
  size: number
}

export type ReferenceCatalog = {
  building: BuildingRow[]
  unit: UnitRow[]
  hero_type: HeroTypeRow[]
  hero_pool: HeroPoolRow[]
  resource: ResourceRow[]
  town: TownRow[]
  town_layout: TownLayoutRow[]
  market: MarketRow[]
  ability: AbilityRow[]
  ability_resource: AbilityResourceRow[]
  ability_cooldown: AbilityCooldownRow[]
  ability_target: AbilityTargetRow[]
  ability_type: AbilityTypeRow[]
  unit_tag: AbilityTargetRow[]
  condition: AbilityTargetRow[]
  discipline: DisciplineRow[]
  ability_level: AbilityLevelRow[]
  hero_discipline: HeroDisciplineRow[]
  difficulty: DifficultyRow[]
  player_color: PlayerColorRow[]
  move_type: MoveTypeRow[]
  terrain_type: TerrainTypeRow[]
  app_config: AppConfigRow[]
  levels: LevelRow[]
  hero_levels: HeroLevelRow[]
}

/** TBD until per-building destroy_cost values exist. */
export const PLACEHOLDER_DESTROY_COST: CostMap = { [GOLD_RESOURCE_ID]: 500 }

function costKeyToId(key: string): number | null {
  const asNumber = Number(key)
  if (Number.isInteger(asNumber) && resourceById(asNumber)) {
    return asNumber
  }
  const byName = RESOURCES.find((resource) => resource.name === key)
  return byName ? byName.id : null
}

function asCost(value: CostMap | Record<string, number> | null | undefined): CostMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const cost: CostMap = {}
  for (const [key, amount] of Object.entries(value)) {
    const n = Number(amount)
    const id = costKeyToId(key)
    if (id != null && Number.isFinite(n) && n !== 0) {
      cost[id] = n
    }
  }
  return cost
}

function asHeroPool(rows: unknown): HeroPoolRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  const pool: HeroPoolRow[] = []
  for (const row of rows) {
    if (row == null || typeof row !== 'object') {
      continue
    }
    const rec = row as Record<string, unknown>
    const id = Number(rec.id)
    const classId = Number(rec.class_id)
    const name = typeof rec.name === 'string' ? rec.name.trim() : ''
    if (!Number.isInteger(id) || !Number.isInteger(classId) || !name) {
      continue
    }
    const image =
      typeof rec.image_path === 'string' ? rec.image_path.trim() : ''
    pool.push({
      id,
      name,
      class_id: classId,
      image_path: image || null,
    })
  }
  return pool
}

function asInt(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function asOptionalId(value: unknown): number | null {
  if (value == null || value === '') {
    return null
  }
  const n = asInt(value)
  return n > 0 ? n : null
}

function asIdList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((item) => asInt(item))
    .filter((id) => id > 0)
}

function asRequires(value: unknown): RequireClause[] | null {
  if (value == null) {
    return null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }
    try {
      return asRequires(JSON.parse(trimmed))
    } catch {
      return null
    }
  }
  if (!Array.isArray(value) || value.length === 0) {
    return null
  }
  const clauses: RequireClause[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const rec = entry as Record<string, unknown>
    if (Array.isArray(rec.all)) {
      clauses.push({ all: asIdList(rec.all) })
      continue
    }
    if (Array.isArray(rec.any)) {
      clauses.push({ any: asIdList(rec.any) })
    }
  }
  return clauses.length > 0 ? clauses : null
}

function catalogLevel(value: unknown): number {
  const n = asInt(value, 1)
  return n > 0 ? n : 1
}

function asTownLayout(rows: unknown): TownLayoutRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows.map((row) => {
    const raw = row as Partial<TownLayoutRow>
    return {
      id: asInt(raw.id),
      town_type_id: asInt(raw.town_type_id),
      slot: asInt(raw.slot),
      x_pos: asInt(raw.x_pos),
      y_pos: asInt(raw.y_pos),
      size: Math.max(1, asInt(raw.size, 1)),
    }
  })
}

function asMarket(rows: unknown): MarketRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row) => {
      const raw = row as Partial<MarketRow>
      return {
        qty: asInt(raw.qty),
        conversion_rate: asInt(raw.conversion_rate),
      }
    })
    .filter((row) => row.qty > 0 && row.conversion_rate > 0)
}

function asResources(rows: unknown): ResourceRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row) => {
      const raw = row as Partial<ResourceRow>
      const name = typeof raw.name === 'string' ? raw.name.trim() : ''
      return {
        id: asInt(raw.id),
        name,
        base_value: asInt(raw.base_value),
      }
    })
    .filter((row) => row.id > 0 && row.name.length > 0)
}

function asNamed(rows: unknown): Array<{ id: number; name: string }> {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row) => {
      const raw = row as { id?: unknown; name?: unknown }
      const name = typeof raw.name === 'string' ? raw.name.trim() : ''
      return { id: asInt(raw.id), name }
    })
    .filter((row) => row.id > 0 && row.name.length > 0)
}

function asMoveTypes(rows: unknown): MoveTypeRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row) => {
      const rec = row as Record<string, unknown>
      const name =
        typeof rec.name === 'string'
          ? rec.name.trim()
          : typeof rec.value === 'string'
            ? rec.value.trim()
            : ''
      return { id: asInt(rec.id), name }
    })
    .filter((row) => row.id > 0 && row.name.length > 0)
    .sort((a, b) => a.id - b.id)
}

function asAppConfig(rows: unknown): AppConfigRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row) => {
      const rec = row as Record<string, unknown>
      const key = typeof rec.key === 'string' ? rec.key.trim() : ''
      const value = rec.value == null ? '' : String(rec.value)
      const description =
        typeof rec.description === 'string' ? rec.description : null
      return { key, value, description }
    })
    .filter((row) => row.key.length > 0)
}

function asBoolFlag(value: unknown): boolean {
  if (value === true || value === 1) {
    return true
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    return text === 'true' || text === 't' || text === '1'
  }
  return false
}

function asTerrains(rows: unknown): TerrainTypeRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row) => {
      const rec = row as Record<string, unknown>
      const name = typeof rec.name === 'string' ? rec.name.trim() : ''
      const costRaw = rec.move_cost
      const cost =
        costRaw == null || costRaw === ''
          ? null
          : Number(costRaw)
      const dmgRaw = rec.entry_damage
      const dmg =
        dmgRaw == null || dmgRaw === ''
          ? null
          : Number(dmgRaw)
      return {
        id: asInt(rec.id),
        name,
        move_cost: cost != null && Number.isFinite(cost) ? cost : null,
        is_blocked: asBoolFlag(rec.is_blocked),
        blocks_los: asBoolFlag(rec.blocks_los),
        variants: Math.max(0, asInt(rec.variants)),
        random_eligible:
          rec.random_eligible == null || rec.random_eligible === ''
            ? true
            : asBoolFlag(rec.random_eligible),
        entry_damage:
          dmg != null && Number.isFinite(dmg) && dmg > 0
            ? Math.trunc(dmg)
            : null,
      }
    })
    .filter((row) => row.id > 0 && row.name.length > 0)
    .sort((a, b) => a.id - b.id)
}

function asHeroTypes(rows: unknown): HeroTypeRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row) => {
      const rec = row as Record<string, unknown>
      const name = typeof rec.name === 'string' ? rec.name.trim() : ''
      return {
        id: asInt(rec.id),
        name,
        town_id: asInt(rec.town_id),
        speed: asInt(rec.speed, 10),
        strength: asInt(rec.strength, 10),
        intel: asInt(rec.intel, 10),
        defense: asInt(rec.defense, 10),
        resist: asInt(rec.resist, 10),
        crit_pct: asInt(rec.crit_pct, 10),
        crit_amt: asInt(rec.crit_amt, 10),
        stamina: asInt(rec.stamina, 10),
      }
    })
    .filter((row) => row.id > 0 && row.name.length > 0)
}

function asLevels(rows: unknown): LevelRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row) => {
      const rec = row as Record<string, unknown>
      return { id: asInt(rec.id), xp: asInt(rec.xp) }
    })
    .filter((row) => row.id > 0)
    .sort((a, b) => a.id - b.id)
}

function asStatBumps(value: unknown): Partial<HeroStats> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const rec = value as Record<string, unknown>
  const bumps: Partial<HeroStats> = {}
  for (const key of HERO_STAT_KEYS) {
    if (rec[key] == null || rec[key] === '') {
      continue
    }
    bumps[key] = asInt(rec[key])
  }
  return bumps
}

function asHeroLevels(rows: unknown): HeroLevelRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row) => {
      const rec = row as Record<string, unknown>
      return {
        hero_type_id: asInt(rec.hero_type_id),
        level_id: asInt(rec.level_id),
        stat_bumps: asStatBumps(rec.stat_bumps),
      }
    })
    .filter((row) => row.hero_type_id > 0 && row.level_id > 0)
}

function asAbilities(rows: unknown): AbilityRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row) => {
      const rec = row as Record<string, unknown>
      const name = typeof rec.name === 'string' ? rec.name.trim() : ''
      const description =
        typeof rec.description === 'string' ? rec.description.trim() : ''
      return {
        id: asInt(rec.id),
        discipline_id: asInt(rec.discipline_id),
        level_id: asInt(rec.level_id),
        name,
        description,
        resource_id: asInt(rec.resource_id),
        cost: asInt(rec.cost),
        cooldown_id: asInt(rec.cooldown_id),
        target_id: asOptionalId(rec.target_id),
        ability_type_id: asOptionalId(rec.ability_type_id),
        stats: asJsonObject(rec.stats),
      }
    })
    .filter((row) => row.id > 0 && row.name.length > 0)
}

function fillDesignedAbilities(
  abilities: AbilityRow[],
  targets: AbilityTargetRow[],
  types: AbilityTypeRow[],
): AbilityRow[] {
  const friendSingle =
    targets.find(
      (row) => row.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_single',
    )?.id ?? 1
  const buffType =
    types.find((row) => row.value.trim().toLowerCase() === 'buff')?.id ?? 2
  return abilities.map((row) => {
    if (row.name === 'Vampiric Strike') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: { ...(row.stats ?? {}), revive_on_dmg_dealt: true },
      }
    }
    if (row.name === 'Raise Skeleton') {
      const friendAll =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all',
        )?.id ?? 3
      const summonType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'summon')?.id ?? 4
      return {
        ...row,
        target_id: row.target_id ?? friendAll,
        ability_type_id: row.ability_type_id ?? summonType,
        stats: {
          kill_pct_stat: 4,
          kill_tag: 2,
          summon_tag: 12,
          persists_on_summon: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Summon Bound Spirit') {
      const friendAll =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all',
        )?.id ?? 3
      const summonType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'summon')?.id ?? 4
      return {
        ...row,
        target_id: row.target_id ?? friendAll,
        ability_type_id: row.ability_type_id ?? summonType,
        stats: {
          summon_unit_id: 222,
          persists_on_summon: false,
          summon_qty_int_stat: 1,
          ...(row.stats ?? {}),
        },
      }
    }
    return row
  })
}

function asAbilityResources(rows: unknown): AbilityResourceRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row) => {
      const rec = row as Record<string, unknown>
      const value =
        typeof rec.value === 'string'
          ? rec.value.trim()
          : typeof rec.name === 'string'
            ? rec.name.trim()
            : ''
      return { id: asInt(rec.id), value }
    })
    .filter((row) => row.id > 0 && row.value.length > 0)
    .sort((a, b) => a.id - b.id)
}

function asAbilityCooldowns(rows: unknown): AbilityCooldownRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row) => {
      const rec = row as Record<string, unknown>
      const value =
        typeof rec.value === 'string'
          ? rec.value.trim()
          : typeof rec.name === 'string'
            ? rec.name.trim()
            : ''
      const description =
        typeof rec.description === 'string' ? rec.description.trim() : ''
      return { id: asInt(rec.id), value, description }
    })
    .filter((row) => row.id >= 0 && row.value.length > 0)
    .sort((a, b) => a.id - b.id)
}

function asNamedValues(rows: unknown): { id: number; value: string }[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row) => {
      const rec = row as Record<string, unknown>
      const value =
        typeof rec.value === 'string'
          ? rec.value.trim()
          : typeof rec.name === 'string'
            ? rec.name.trim()
            : ''
      return { id: asInt(rec.id), value }
    })
    .filter((row) => row.id > 0 && row.value.length > 0)
    .sort((a, b) => a.id - b.id)
}

function asAbilityLevels(rows: unknown): AbilityLevelRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row) => {
      const raw = row as { id?: unknown; value?: unknown; name?: unknown }
      const value =
        typeof raw.value === 'string'
          ? raw.value.trim()
          : typeof raw.name === 'string'
            ? raw.name.trim()
            : ''
      return { id: asInt(raw.id), value }
    })
    .filter((row) => row.id > 0 && row.value.length > 0)
}

function asHeroDisciplines(rows: unknown): HeroDisciplineRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row) => {
      const raw = row as Partial<HeroDisciplineRow>
      return {
        hero_id: asInt(raw.hero_id),
        discipline_id: asInt(raw.discipline_id),
      }
    })
    .filter((row) => row.hero_id > 0 && row.discipline_id > 0)
}

function asIntIds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return []
  }
  const ids: number[] = []
  for (const entry of value) {
    const n = typeof entry === 'number' ? entry : Number(entry)
    if (Number.isInteger(n) && n > 0) {
      ids.push(n)
    }
  }
  return ids
}

function asJsonObject(value: unknown): Record<string, unknown> | null {
  if (value == null) {
    return null
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }
    try {
      return asJsonObject(JSON.parse(trimmed))
    } catch {
      return null
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asUnitRetaliation(value: unknown): UnitRetaliation {
  const rec = asJsonObject(value)
  if (!rec) {
    return { ...DEFAULT_UNIT_RETALIATION }
  }
  const dmgRaw = rec.dmg_pct
  let dmgPct: number | 'max' = DEFAULT_UNIT_RETALIATION.dmgPct
  if (typeof dmgRaw === 'string' && dmgRaw.trim().toLowerCase() === 'max') {
    dmgPct = 'max'
  } else if (dmgRaw != null && dmgRaw !== '') {
    const n = Number(dmgRaw)
    if (Number.isFinite(n)) {
      dmgPct = Math.min(100, Math.max(0, n))
    }
  }
  const timesRaw = rec.times
  let times: number | 'unlimited' = DEFAULT_UNIT_RETALIATION.times
  if (
    typeof timesRaw === 'string' &&
    timesRaw.trim().toLowerCase() === 'unlimited'
  ) {
    times = 'unlimited'
  } else if (timesRaw != null && timesRaw !== '') {
    const n = Number(timesRaw)
    if (Number.isFinite(n)) {
      times = Math.max(0, Math.floor(n))
    }
  }
  return {
    dmgPct,
    times,
    preemptive: rec.preemptive === true,
  }
}

const ATTACK_SHAPES = new Set<string>([
  'single',
  'cleave',
  'aoe',
  'pulse',
  'chain',
  'beam',
  'multi',
  'rain',
  'breath',
])

function asAttackShape(raw: string): AttackShapeKind {
  if (raw === 'screen') {
    return 'rain'
  }
  if (ATTACK_SHAPES.has(raw)) {
    return raw as AttackShapeKind
  }
  return DEFAULT_UNIT_ABILITIES.shape
}

export function parseAttackShape(raw: string): AttackShapeKind {
  return asAttackShape(raw.trim().toLowerCase())
}

function asShapeInt(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 1) {
    return fallback
  }
  return Math.floor(n)
}

function asAutoTarget(value: unknown): AutoTargetKind | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (text === 'random_wall_segment' || text === 'random_enemy') {
    return text
  }
  return null
}

function asUnitCombatAbilities(value: unknown): UnitCombatAbilities {
  const rec = asJsonObject(value)
  const shapeRaw =
    typeof rec?.shape === 'string' ? rec.shape.trim().toLowerCase() : ''
  const falloffRaw = rec?.falloff
  const falloffNum = Number(falloffRaw)
  return {
    no_enemy_retaliation: rec?.no_enemy_retaliation === true,
    shape: asAttackShape(shapeRaw),
    radius: asShapeInt(rec?.radius, DEFAULT_UNIT_ABILITIES.radius),
    jumps: asShapeInt(rec?.jumps, DEFAULT_UNIT_ABILITIES.jumps),
    falloff:
      Number.isFinite(falloffNum) && falloffNum >= 0
        ? Math.min(100, falloffNum)
        : DEFAULT_UNIT_ABILITIES.falloff,
    targets: asShapeInt(rec?.targets, DEFAULT_UNIT_ABILITIES.targets),
    rows: asShapeInt(rec?.rows, DEFAULT_UNIT_ABILITIES.rows),
    autoTarget: asAutoTarget(rec?.target),
    skipIfNone: rec?.skip_if_none === true,
    inflictsCondition: asOptionalId(rec?.inflicts_condition),
    resistStat: asResistStat(rec?.resist_stat),
    conditionDuration: asShapeInt(rec?.duration, DEFAULT_UNIT_ABILITIES.conditionDuration),
  }
}

function asResistStat(value: unknown): 'resistance' | 'defense' | null {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (text === 'resistance' || text === 'defense') {
    return text
  }
  return null
}

function asPayload(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asDifficulties(rows: unknown): DifficultyRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row) => {
      const raw = row as Partial<DifficultyRow>
      const name = typeof raw.name === 'string' ? raw.name.trim() : ''
      return {
        id: asInt(raw.id),
        name,
        payload: asPayload(raw.payload),
      }
    })
    .filter((row) => row.id > 0 && row.name.length > 0)
    .sort((a, b) => a.id - b.id)
}

function asPlayerColors(rows: unknown): PlayerColorRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row) => {
      const rec = row as Record<string, unknown>
      const name = typeof rec.name === 'string' ? rec.name.trim() : ''
      const hex =
        typeof rec.hex_value === 'string'
          ? rec.hex_value.trim()
          : typeof rec.hexValue === 'string'
            ? rec.hexValue.trim()
            : ''
      return {
        id: asInt(rec.id),
        name,
        hex_value: hex,
      }
    })
    .filter((row) => row.id > 0 && row.hex_value.length > 0)
    .sort((a, b) => a.id - b.id)
}

function parseCssHex(value: string): number | null {
  const trimmed = value.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return Number.parseInt(trimmed, 16)
  }
  if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[0]
    const g = trimmed[1]
    const b = trimmed[2]
    return Number.parseInt(`${r}${r}${g}${g}${b}${b}`, 16)
  }
  return null
}

/** Pixi fill for an owned token, or null if unowned/neutral. */
export function ownerTint(playerId: string | null | undefined): number | null {
  if (!playerId) {
    return null
  }
  const slot = slotFromPlayerId(playerId)
  if (slot == null) {
    return null
  }
  const row = getCachedCatalog()?.player_color?.find((color) => color.id === slot)
  if (!row) {
    return null
  }
  return parseCssHex(row.hex_value)
}

export async function fetchCatalog(): Promise<ReferenceCatalog> {
  const response = await fetch('/api/reference/catalog')
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const payload = (await response.json()) as Partial<ReferenceCatalog>
  const resource = asResources(payload.resource)
  applyResourceCatalog(resource)
  const building = (Array.isArray(payload.building) ? payload.building : []).map(
    (row) => {
      const growthNum = Number(row.growth)
      return {
        ...row,
        cost: asCost(row.cost),
        destroy_cost: asCost(row.destroy_cost),
        growth: Number.isFinite(growthNum) ? growthNum : row.growth,
        level: catalogLevel(row.level),
        requires: asRequires(row.requires),
      }
    },
  )
  const unit = (Array.isArray(payload.unit) ? payload.unit : []).map((row) => {
    const extra = row as {
      hex_size?: unknown
      speed?: unknown
      stationary?: unknown
      move_type_id?: unknown
      health?: unknown
      defense?: unknown
      resistance?: unknown
      dmg_type?: unknown
      min_dmg?: unknown
      max_dmg?: unknown
      min_range?: unknown
      max_range?: unknown
      retaliation?: unknown
      abilities?: unknown
      tags?: unknown
    }
    const image = typeof row.image_path === 'string' ? row.image_path.trim() : ''
    const hexRaw = extra.hex_size
    const hexNum = hexRaw == null || hexRaw === '' ? null : asInt(hexRaw)
    const moveRaw = extra.move_type_id
    const moveId =
      moveRaw == null || moveRaw === '' ? null : asInt(moveRaw)
    const dmgType =
      typeof extra.dmg_type === 'string' ? extra.dmg_type.trim() : ''
    const maxRangeRaw = extra.max_range
    return {
      ...row,
      cost: asCost(row.cost),
      image_path: image || null,
      hex_size: hexNum != null && hexNum > 0 ? hexNum : null,
      speed:
        extra.speed == null || extra.speed === ''
          ? null
          : asInt(extra.speed),
      stationary: asBoolFlag(extra.stationary),
      move_type_id: moveId != null && moveId > 0 ? moveId : null,
      health: asInt(extra.health),
      defense: Math.max(0, asInt(extra.defense)),
      resistance: Math.max(0, asInt(extra.resistance)),
      dmg_type: dmgType.length > 0 ? dmgType : null,
      min_dmg: asInt(extra.min_dmg),
      max_dmg: asInt(extra.max_dmg),
      min_range: asInt(extra.min_range),
      max_range:
        maxRangeRaw == null || maxRangeRaw === '' ? 1 : asInt(maxRangeRaw),
      retaliation: asUnitRetaliation(extra.retaliation),
      abilities: asUnitCombatAbilities(extra.abilities),
      tags: asIntIds(extra.tags),
    }
  })
  const catalog: ReferenceCatalog = {
    building,
    unit,
    hero_type: asHeroTypes(payload.hero_type),
    hero_pool: asHeroPool(payload.hero_pool),
    resource,
    town: Array.isArray(payload.town) ? payload.town : [],
    town_layout: asTownLayout(payload.town_layout),
    market: asMarket(payload.market),
    ability: asAbilities(payload.ability),
    ability_resource: asAbilityResources(
      (payload as { ability_resource?: unknown }).ability_resource,
    ),
    ability_cooldown: asAbilityCooldowns(
      (payload as { ability_cooldown?: unknown }).ability_cooldown,
    ),
    ability_target: asNamedValues(
      (payload as { ability_target?: unknown }).ability_target,
    ),
    ability_type: asNamedValues(
      (payload as { ability_type?: unknown }).ability_type,
    ),
    unit_tag: asNamedValues(
      (payload as { unit_tag?: unknown }).unit_tag,
    ),
    condition: asNamedValues(
      (payload as { condition?: unknown }).condition,
    ),
    discipline: asNamed(payload.discipline),
    ability_level: asAbilityLevels(payload.ability_level),
    hero_discipline: asHeroDisciplines(payload.hero_discipline),
    difficulty: asDifficulties(payload.difficulty),
    player_color: asPlayerColors(payload.player_color),
    move_type: asMoveTypes(payload.move_type),
    terrain_type: asTerrains(payload.terrain_type),
    app_config: asAppConfig(
      (payload as { app_config?: unknown }).app_config,
    ),
    levels: asLevels((payload as { levels?: unknown }).levels),
    hero_levels: asHeroLevels((payload as { hero_levels?: unknown }).hero_levels),
  }
  catalog.ability = fillDesignedAbilities(
    catalog.ability,
    catalog.ability_target,
    catalog.ability_type,
  )
  cachedCatalog = catalog
  emitCatalog()
  return catalog
}

let cachedCatalog: ReferenceCatalog | null = null
const catalogListeners = new Set<() => void>()

function emitCatalog(): void {
  for (const listener of catalogListeners) {
    listener()
  }
}

export function subscribeCatalog(listener: () => void): () => void {
  catalogListeners.add(listener)
  return () => {
    catalogListeners.delete(listener)
  }
}

export function getCachedCatalog(): ReferenceCatalog | null {
  return cachedCatalog
}

export async function reloadReferenceData(): Promise<DataStatus> {
  const response = await fetch('/api/system/reload-reference-data', {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const payload = (await response.json()) as DataStatus
  return {
    ok: payload.ok,
    tables: Array.isArray(payload.tables) ? payload.tables : [],
  }
}

/** Re-read Postgres into Spring, then refresh the frontend catalog. */
export async function refreshCatalogFromDb(): Promise<ReferenceCatalog> {
  await reloadReferenceData()
  return fetchCatalog()
}

export function buildingGrowth(building: BuildingRow | null): number {
  if (!building) {
    return 0
  }
  if (typeof building.growth === 'number' && Number.isFinite(building.growth) && building.growth > 0) {
    return Math.floor(building.growth)
  }
  const weekly = building.payload?.weekly_growth
  if (typeof weekly === 'number' && Number.isFinite(weekly) && weekly > 0) {
    return Math.floor(weekly)
  }
  return 0
}

function asPositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n) || n <= 0) {
    return null
  }
  return Math.floor(n)
}

function payloadResourceId(payload: Record<string, unknown>): number | null {
  const raw = payload.resource_id
  if (typeof raw === 'number' && Number.isInteger(raw) && resourceById(raw)) {
    return raw
  }
  if (typeof raw === 'string' && resourceById(Number(raw))) {
    return Number(raw)
  }
  const name = payload.resource_name
  if (typeof name !== 'string' || name.trim() === '') {
    return null
  }
  const match = RESOURCES.find(
    (resource) => resource.name.toLowerCase() === name.trim().toLowerCase(),
  )
  return match?.id ?? null
}

/** Weekly grant from a built `resource_yield` building, or null if payload is incomplete. */
export function resourceYieldGrant(
  building: BuildingRow | null,
): { resourceId: number; amount: number } | null {
  if (!building || building.effect_type !== 'resource_yield' || !building.payload) {
    return null
  }
  const amount = asPositiveInt(building.payload.amount)
  const resourceId = payloadResourceId(building.payload)
  if (amount == null || resourceId == null) {
    return null
  }
  return { resourceId, amount }
}

/** Weekly gold from a built `gold_income` building; 0 if payload.gold_income is missing. */
export function goldIncomeGrant(building: BuildingRow | null): number {
  if (!building || building.effect_type !== 'gold_income' || !building.payload) {
    return 0
  }
  return asPositiveInt(building.payload.gold_income) ?? 0
}

export function unitCost(unit: UnitRow | null): CostMap {
  return unit ? asCost(unit.cost) : {}
}

/** Battlefield hexes this unit occupies. Null/missing/non-positive is 1. */
export function unitHexFootprint(unit: UnitRow | null | undefined): number {
  const n = unit?.hex_size
  if (n == null || !Number.isFinite(n) || n < 1) {
    return 1
  }
  return Math.floor(n)
}

export function unitRetaliation(
  unit: UnitRow | null | undefined,
): UnitRetaliation {
  return unit?.retaliation ?? DEFAULT_UNIT_RETALIATION
}

export function unitBlocksEnemyRetaliation(
  unit: UnitRow | null | undefined,
): boolean {
  return unit?.abilities?.no_enemy_retaliation === true
}

export function unitAttackShape(
  unit: UnitRow | null | undefined,
): UnitCombatAbilities {
  const raw = unit?.abilities
  if (!raw) {
    return DEFAULT_UNIT_ABILITIES
  }
  return {
    ...DEFAULT_UNIT_ABILITIES,
    ...raw,
    shape: raw.shape ?? DEFAULT_UNIT_ABILITIES.shape,
  }
}

export function unitAutoTarget(
  unit: UnitRow | null | undefined,
): AutoTargetKind | null {
  const fromAbilities = unitAttackShape(unit).autoTarget
  if (fromAbilities) {
    return fromAbilities
  }
  const name = (unit?.name ?? '').trim().toLowerCase()
  if (name === 'siege' || name === 'catapult') {
    return 'random_wall_segment'
  }
  if (name === 'shooter') {
    return 'random_enemy'
  }
  return null
}

export function conditionName(
  catalog: ReferenceCatalog,
  conditionId: number,
): string {
  return (
    catalog.condition.find((row) => row.id === conditionId)?.value ??
    `condition ${conditionId}`
  )
}

export function shapeIsUntargeted(shape: AttackShapeKind): boolean {
  return shape === 'rain' || shape === 'multi'
}

export function shapePulsesOnMove(shape: AttackShapeKind): boolean {
  return shape === 'pulse'
}

/** Remaining charges to grant at round start. Infinity = unlimited. */
export function retaliationCharges(
  unit: UnitRow | null | undefined,
): number {
  const times = unitRetaliation(unit).times
  return times === 'unlimited' ? Number.POSITIVE_INFINITY : times
}

export function scaleCost(cost: CostMap, qty: number): CostMap {
  const scaled: CostMap = {}
  for (const [key, amount] of Object.entries(cost)) {
    scaled[Number(key)] = amount * qty
  }
  return scaled
}

export function maxAffordableQty(
  wallet: { [id: number]: { stockpile: number } },
  cost: CostMap,
  cap: number,
): number {
  if (cap <= 0) {
    return 0
  }
  let max = cap
  for (const [key, amount] of Object.entries(cost)) {
    if (amount <= 0) {
      continue
    }
    const have = wallet[Number(key)]?.stockpile ?? 0
    max = Math.min(max, Math.floor(have / amount))
  }
  return Math.max(0, Math.floor(max))
}

export const TOWN_LAYOUT_SLOT_COUNT = 16

export function isArmySlot(slotId: number): boolean {
  return slotId >= 4 && slotId <= 9
}

export function isTavernBuilding(building: BuildingRow): boolean {
  return building.name.trim().toLowerCase() === 'tavern'
}

export function isMarketplaceBuilding(building: BuildingRow): boolean {
  return building.name.trim().toLowerCase() === 'marketplace'
}

export function isLibraryBuilding(building: BuildingRow): boolean {
  return building.name.trim().toLowerCase().includes('library')
}

export function isEmptyPlaceholder(building: BuildingRow): boolean {
  return building.name.trim().toLowerCase() === 'empty'
}

export function isEmptyPlaceholderSlot(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
): boolean {
  const rows = buildingsInSlot(catalog, slotId, townTypeId)
  const real = rows.filter((row) => !isEmptyPlaceholder(row))
  return real.length === 0 && rows.some(isEmptyPlaceholder)
}

export function townLayoutFor(
  catalog: ReferenceCatalog,
  townTypeId: number,
): TownLayoutRow[] {
  return catalog.town_layout
    .filter((row) => row.town_type_id === townTypeId)
    .slice()
    .sort((a, b) => a.slot - b.slot)
}

export function townLayoutError(
  catalog: ReferenceCatalog,
  townTypeId: number,
): string | null {
  const rows = townLayoutFor(catalog, townTypeId)
  if (rows.length === 0) {
    return `town_layout — 0 rows for town_type_id ${townTypeId}`
  }
  if (rows.length !== TOWN_LAYOUT_SLOT_COUNT) {
    return `town_layout — expected ${TOWN_LAYOUT_SLOT_COUNT} slots, got ${rows.length}`
  }
  return null
}

function layoutCellSize(rows: TownLayoutRow[]): number {
  const steps = rows.flatMap((row) => [row.x_pos, row.y_pos]).filter((n) => n > 0)
  return steps.length > 0 ? Math.min(...steps) : 100
}

export function townLayoutSlotStyle(
  row: TownLayoutRow,
  rows: TownLayoutRow[],
): { left: string; top: string; width: string; height: string } {
  const cell = layoutCellSize(rows)
  let maxX = 0
  let maxY = 0
  for (const item of rows) {
    maxX = Math.max(maxX, item.x_pos + item.size * cell)
    maxY = Math.max(maxY, item.y_pos + item.size * cell)
  }
  if (maxX <= 0 || maxY <= 0) {
    return { left: '0%', top: '0%', width: '25%', height: '25%' }
  }
  return {
    left: `${(row.x_pos / maxX) * 100}%`,
    top: `${(row.y_pos / maxY) * 100}%`,
    width: `${((row.size * cell) / maxX) * 100}%`,
    height: `${((row.size * cell) / maxY) * 100}%`,
  }
}

export function armyTier(slotId: number): number {
  return slotId - 3
}

export function buildingCost(building: BuildingRow): CostMap {
  return asCost(building.cost)
}

/** Construction cost; if the building row has none, use that dwelling's unit cost. */
export function constructionCost(
  catalog: ReferenceCatalog,
  building: BuildingRow,
): CostMap {
  const listed = buildingCost(building)
  if (Object.keys(listed).length > 0) {
    return listed
  }
  return unitCost(unitForBuilding(catalog, building.id))
}

export function hasPrerequisite(
  building: BuildingRow,
  builtIds: ReadonlySet<number>,
): boolean {
  const clauses = building.requires
  if (clauses == null || clauses.length === 0) {
    return true
  }
  return clauses.every((clause) => requireClausePasses(clause, builtIds))
}

function requireClausePasses(
  clause: RequireClause,
  builtIds: ReadonlySet<number>,
): boolean {
  if ('all' in clause) {
    return clause.all.every((id) => builtIds.has(id))
  }
  return clause.any.some((id) => builtIds.has(id))
}

export function isBuildRoot(building: BuildingRow): boolean {
  return building.level === 1
}

export function armyBuildOptions(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
  builtIds: ReadonlySet<number>,
): BuildingRow[] {
  return armyOptions(catalog, slotId, townTypeId).filter(
    (row) => isBuildRoot(row) && hasPrerequisite(row, builtIds),
  )
}

function unmetRequireNames(
  catalog: ReferenceCatalog,
  buildings: BuildingRow[],
  builtIds: ReadonlySet<number>,
): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const row of buildings) {
    if (hasPrerequisite(row, builtIds)) {
      continue
    }
    for (const clause of row.requires ?? []) {
      if (requireClausePasses(clause, builtIds)) {
        continue
      }
      const ids = 'all' in clause ? clause.all : clause.any
      for (const id of ids) {
        if (builtIds.has(id)) {
          continue
        }
        const pre = buildingById(catalog, id)
        if (!pre || seen.has(pre.name)) {
          continue
        }
        seen.add(pre.name)
        names.push(pre.name)
      }
    }
  }
  return names
}

function formatMissingPrerequisite(names: string[]): string {
  if (names.length === 0) {
    return 'Build the required prerequisite first.'
  }
  if (names.length === 1) {
    return `Build ${names[0]} first`
  }
  if (names.length === 2) {
    return `Build ${names[0]} or ${names[1]} first`
  }
  return `Build ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]} first`
}

export function missingArmyPrerequisiteLine(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
  builtIds: ReadonlySet<number>,
): string {
  const locked = armyOptions(catalog, slotId, townTypeId).filter(
    (row) => isBuildRoot(row) && !hasPrerequisite(row, builtIds),
  )
  return formatMissingPrerequisite(unmetRequireNames(catalog, locked, builtIds))
}

export function missingGenericPrerequisiteLine(
  catalog: ReferenceCatalog,
  building: BuildingRow,
  builtIds: ReadonlySet<number>,
): string {
  return formatMissingPrerequisite(
    unmetRequireNames(catalog, [building], builtIds),
  )
}

export function destroyCostOf(building: BuildingRow): CostMap {
  const listed = asCost(building.destroy_cost)
  return Object.keys(listed).length > 0 ? listed : PLACEHOLDER_DESTROY_COST
}

export function formatCost(cost: CostMap): string {
  const parts: string[] = []
  const seen = new Set<number>()
  for (const resource of RESOURCES) {
    const amount = cost[resource.id]
    if (amount) {
      seen.add(resource.id)
      parts.push(`${formatAmount(amount)} ${resource.name}`)
    }
  }
  for (const [key, amount] of Object.entries(cost)) {
    const id = Number(key)
    if (amount && !seen.has(id)) {
      const resource = resourceById(id)
      parts.push(`${formatAmount(amount)} ${resource?.name ?? `#${key}`}`)
    }
  }
  return parts.length > 0 ? parts.join(', ') : 'Free'
}

export function effectLine(building: BuildingRow): string {
  const display = building.payload?.display
  return typeof display === 'string' ? display : ''
}

export function difficultyDisplay(row: DifficultyRow | null | undefined): string {
  const display = row?.payload?.display
  return typeof display === 'string' ? display : ''
}

export function heroTypeName(
  catalog: ReferenceCatalog,
  classId: number | null,
): string {
  if (classId == null) {
    return ''
  }
  return catalog.hero_type.find((row) => row.id === classId)?.name ?? ''
}

const DEFAULT_HERO_STAT = 10

function emptyHeroStats(): HeroStats {
  return {
    speed: DEFAULT_HERO_STAT,
    stamina: DEFAULT_HERO_STAT,
    strength: DEFAULT_HERO_STAT,
    intel: DEFAULT_HERO_STAT,
    defense: DEFAULT_HERO_STAT,
    resist: DEFAULT_HERO_STAT,
    crit_pct: DEFAULT_HERO_STAT,
    crit_amt: DEFAULT_HERO_STAT,
  }
}

export function heroTypeBaseStats(
  row: HeroTypeRow | null | undefined,
): HeroStats {
  if (!row) {
    return emptyHeroStats()
  }
  return {
    speed: row.speed,
    stamina: row.stamina,
    strength: row.strength,
    intel: row.intel,
    defense: row.defense,
    resist: row.resist,
    crit_pct: row.crit_pct,
    crit_amt: row.crit_amt,
  }
}

/** Base hero_type stats plus hero_levels.stat_bumps up through current_level. */
export function heroEffectiveStats(
  catalog: ReferenceCatalog,
  classId: number | null,
  currentLevel: number,
): HeroStats {
  const type =
    classId != null
      ? catalog.hero_type.find((row) => row.id === classId)
      : undefined
  const stats = heroTypeBaseStats(type)
  if (classId == null) {
    return stats
  }
  const cap = Math.max(1, Math.floor(currentLevel))
  for (const row of catalog.hero_levels) {
    if (row.hero_type_id !== classId || row.level_id > cap) {
      continue
    }
    for (const key of HERO_STAT_KEYS) {
      const bump = row.stat_bumps[key]
      if (typeof bump === 'number' && Number.isFinite(bump)) {
        stats[key] += bump
      }
    }
  }
  return stats
}

/** XP total required to reach `levelId`, or null if that row is missing. */
export function xpToReachLevel(
  catalog: ReferenceCatalog,
  levelId: number,
): number | null {
  const row = catalog.levels.find((entry) => entry.id === levelId)
  if (!row) {
    return null
  }
  return row.xp
}

export function formatHeroLevelLine(
  catalog: ReferenceCatalog | null,
  name: string,
  currentLevel: number,
  currentXp: number,
): string {
  const level = Math.max(1, Math.floor(currentLevel))
  const xp = Math.max(0, Math.floor(currentXp))
  const nextXp = catalog ? xpToReachLevel(catalog, level + 1) : null
  if (nextXp == null) {
    return `${name} - Lvl ${level} - XP ${xp}`
  }
  return `${name} - Lvl ${level} - XP ${xp}/${nextXp}`
}

/** World-map movement budget: effective Speed. Fallback 10 if unknown. */
export function heroMovementPoints(
  catalog: ReferenceCatalog | null | undefined,
  hero:
    | { class_id: number | null; current_level?: number }
    | null
    | undefined,
): number {
  if (!catalog || !hero) {
    return DEFAULT_HERO_STAT
  }
  return Math.max(
    0,
    heroEffectiveStats(catalog, hero.class_id, hero.current_level ?? 1)
      .speed,
  )
}

export function abilityMult(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, Math.floor(appConfigNumber(catalog, 'ability_mult', 4)))
}

export function regenPure(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, Math.floor(appConfigNumber(catalog, 'regen_pure', 4)))
}

export function regenHybrid(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, Math.floor(appConfigNumber(catalog, 'regen_hybrid', 2)))
}

/** Starting / missing-save Mana and Energy. Energy = strength × ability_mult; Mana = intel × ability_mult. */
export function heroResourcePools(
  catalog: ReferenceCatalog | null | undefined,
  hero:
    | { class_id: number | null; current_level?: number }
    | null
    | undefined,
): { current_mana: number; current_energy: number } {
  const stats =
    catalog && hero
      ? heroEffectiveStats(catalog, hero.class_id, hero.current_level ?? 1)
      : emptyHeroStats()
  const mult = abilityMult(catalog)
  return {
    current_energy: Math.max(0, stats.strength * mult),
    current_mana: Math.max(0, stats.intel * mult),
  }
}

export function abilityTooltip(
  catalog: ReferenceCatalog | null | undefined,
  ability: AbilityRow,
): string {
  const extra = abilityCastLine(catalog, ability)
  if (!extra) {
    return ability.description
  }
  if (!ability.description) {
    return extra
  }
  return `${ability.description}\n${extra}`
}

function abilityCastLine(
  catalog: ReferenceCatalog | null | undefined,
  ability: AbilityRow,
): string {
  const resource = catalog?.ability_resource.find(
    (row) => row.id === ability.resource_id,
  )?.value
  const cooldown = catalog?.ability_cooldown.find(
    (row) => row.id === ability.cooldown_id,
  )
  const parts: string[] = []
  if (resource) {
    parts.push(`${ability.cost} ${resource}`)
  } else if (ability.cost > 0) {
    parts.push(String(ability.cost))
  }
  if (cooldown && cooldown.id !== 0) {
    parts.push(cooldown.value)
  }
  return parts.join(' · ')
}

function buildingsInSlot(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
): BuildingRow[] {
  return catalog.building.filter(
    (row) => row.town_id === townTypeId && row.slot_num === slotId,
  )
}

export function undesignedBuilding(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
): BuildingRow | null {
  return (
    buildingsInSlot(catalog, slotId, townTypeId).find(
      (row) => row.effect_type === 'TBD',
    ) ?? null
  )
}

export function isUndesignedSlot(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
): boolean {
  const rows = buildingsInSlot(catalog, slotId, townTypeId)
  if (rows.some(isMarketplaceBuilding) || rows.some(isLibraryBuilding)) {
    return false
  }
  if (rows.some((row) => row.effect_type === 'TBD')) {
    return true
  }
  return (slotId === 10 || slotId === 11) && rows.length === 0
}

export function isMarketplaceSlot(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
): boolean {
  return buildingsInSlot(catalog, slotId, townTypeId).some(isMarketplaceBuilding)
}

export function isLibrarySlot(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
): boolean {
  return buildingsInSlot(catalog, slotId, townTypeId).some(isLibraryBuilding)
}

export function armyOptions(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
): BuildingRow[] {
  return buildingsInSlot(catalog, slotId, townTypeId).filter(
    (row) => row.class_id != null,
  )
}

export function genericSlotBuildings(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
): BuildingRow[] {
  return buildingsInSlot(catalog, slotId, townTypeId)
    .filter((row) => row.class_id == null && !isEmptyPlaceholder(row))
    .sort((a, b) => a.id - b.id)
}

export function genericRoot(buildings: BuildingRow[]): BuildingRow | null {
  if (buildings.length === 0) {
    return null
  }
  const roots = buildings.filter(isBuildRoot)
  return (roots[0] ?? null)
}

export function nextInChain(
  current: BuildingRow,
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
): BuildingRow | null {
  const group = isArmySlot(slotId)
    ? armyOptions(catalog, slotId, townTypeId)
    : genericSlotBuildings(catalog, slotId, townTypeId)
  const want = current.level + 1
  return (
    group.find(
      (row) => row.level === want && row.class_id === current.class_id,
    ) ?? null
  )
}

export function buildingById(
  catalog: ReferenceCatalog,
  id: number | null,
): BuildingRow | null {
  if (id == null) {
    return null
  }
  return catalog.building.find((row) => row.id === id) ?? null
}

export function unitForBuilding(
  catalog: ReferenceCatalog,
  buildingId: number | null,
): UnitRow | null {
  if (buildingId == null) {
    return null
  }
  return catalog.unit.find((row) => row.bldg_id === buildingId) ?? null
}

export function unitById(
  catalog: ReferenceCatalog | null | undefined,
  id: number | null | undefined,
): UnitRow | null {
  if (!catalog || id == null) {
    return null
  }
  return catalog.unit.find((row) => row.id === id) ?? null
}

export function unitHasTag(
  unit: UnitRow | null | undefined,
  tagId: number,
): boolean {
  return Boolean(unit?.tags?.includes(tagId))
}

export function unitsWithTag(
  catalog: ReferenceCatalog,
  tagId: number,
): UnitRow[] {
  return catalog.unit.filter((row) => unitHasTag(row, tagId))
}

export function unitIsStationary(
  unit: UnitRow | null | undefined,
): boolean {
  return unit?.stationary === true
}

/** Null speed never acts — not the same as speed 0. */
export function unitTakesTurns(unit: UnitRow | null | undefined): boolean {
  return unit != null && unit.speed != null
}

export function appConfigNumber(
  catalog: ReferenceCatalog | null | undefined,
  key: string,
  fallback: number,
): number {
  const raw = catalog?.app_config.find((row) => row.key === key)?.value
  const n = raw == null || raw === '' ? NaN : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/** Catalog convention: always enterable, dumps remaining MP. Not a literal cost. */
export const DUMP_REMAINING_MOVE_COST = 99

/** World/combat random sampling: eligible flag and not Moat-style cost 99. */
export function terrainIsRandomEligible(
  row: TerrainTypeRow | null | undefined,
): boolean {
  if (!row || !row.random_eligible) {
    return false
  }
  return row.move_cost !== DUMP_REMAINING_MOVE_COST
}

export function terrainByName(
  catalog: ReferenceCatalog | null | undefined,
  name: string | null | undefined,
): TerrainTypeRow | null {
  const key = (name ?? '').trim()
  if (!catalog || !key) {
    return null
  }
  const underscored = key.replaceAll(' ', '_')
  const spaced = key.replaceAll('_', ' ')
  return (
    catalog.terrain_type.find(
      (row) =>
        row.name === key ||
        row.name === underscored ||
        row.name === spaced,
    ) ?? null
  )
}
