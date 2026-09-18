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
  /** Catalog `unit.town_id` (faction). Null falls back to dwelling town. */
  town_id: number | null
  /** Catalog `unit.class_id`. Null falls back to the dwelling's class. */
  class_id: number | null
  /** Catalog `unit.tier`. Null falls back to the dwelling's tier/slot. */
  tier: number | null
  cost: CostMap | null
  image_path: string | null
  /** Alternate-state portrait (e.g. silenced Rift). Null = no swap. */
  image_path_alt: string | null
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
  /** True when catalog JSON had a non-empty `abilities` object. */
  has_abilities: boolean
  /** Sight blocker. Drawbridge open/closed is separate and ignores this. */
  blocks_los: boolean
  /** Per-creature cost to upgrade this base unit into its Advanced form. */
  upgrade_cost: CostMap | null
}

export type UnitRetaliation = {
  /** `'default'` → `retaliation_default_dmg_mult` at read time. */
  dmgPct: number | 'max' | 'default'
  times: number | 'unlimited'
  preemptive: boolean
  /**
   * When set (and not `single`), retaliation uses the same geometry as
   * normal attacks (pulse, cleave, …). Omitted = classic single-target.
   */
  shape?: AttackShapeKind
  radius?: number
  /** Chain retaliation: hop count (Zealot). */
  jumps?: number
  /** Chain retaliation: % damage drop per hop (Zealot). */
  falloff?: number
  /** Chronomancer: on retaliation trigger, roll to teleport the attacker. */
  teleportsAttacker?: boolean
  /** Flat % chance (before resist) for teleportsAttacker. */
  teleportChancePct?: number
  /** Stat the attacker rolls to resist the teleport. */
  resistStat?: 'resistance' | 'defense' | null
}

export type AttackShapeKind =
  | 'single'
  | 'cleave'
  | 'aoe'
  | 'pulse'
  | 'chain'
  | 'beam'
  | 'line'
  /** Move like CHARGE; pierce-damage enemies on the traveled origin→target corridor. */
  | 'charge_line'
  | 'multi'
  | 'rain'
  | 'breath'
  /** Pyromaniac: single-target damage + clockwise Fire spiral (no AOE damage). */
  | 'spiral'

export type AutoTargetKind =
  | 'random_wall_segment'
  | 'random_enemy'
  | 'random_enemy_los'

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
  /** Mud Golem: split qty before acting (after first turn). */
  autoSplitOnTurn: boolean
  /** With autoSplitOnTurn: do not split on the turn a stack was created (summon or split). */
  skipFirstTurn: boolean
  /** Finger of Death / Assassin: overflow kills an extra creature. */
  killOnOverflow: boolean
  /** Assassin: % chance of a free second attack on own turns. */
  chancePct: number | null
  /** When true with chancePct, bonus attack never fires on retaliation. */
  extraAttackOnAttackOnly: boolean
  /**
   * Flat % of live Speed to cut on hit (Vines Thorned Lash). Paired with
   * chancePct + resistStat + conditionDuration (from debuff_duration).
   */
  speedDebuffPct: number | null
  /** Leave ground_effect while moving (Void origin, or full_path trail). */
  leavesGroundEffectOnMove: boolean
  /** Leave ground_effect on attack geometry (any shape via geometricHexes). */
  leavesGroundEffectOnAttack: boolean
  /** Catalog ground_effect.id for leave-on-move / leave-on-attack. */
  groundEffectId: number | null
  /** Fire (and similar): take zero damage from Fire entry/turn-start. */
  immuneToFire: boolean
  /** Storm / Lightning: take zero damage from Storm entry/turn-start. */
  immuneToLightning: boolean
  /**
   * When true with leaves_ground_effect_on_move: paint every entered hex
   * (Worms / Skeleton Riders). When false: only the single vacated origin
   * hex once per move (Void).
   */
  fullPath: boolean
  /** Goblin Hammersmith: may also target allies with this unit_tag.id. */
  canTargetAllyIfTag: number | null
  /** When targeting a tagged ally, heal instead of damaging. */
  healOnAllyTarget: boolean
  /** Heal amount per creature in this stack (× qty). */
  healAmtPerUnit: number | null
  /** Void: place this terrain_type.id on the vacated hex before moving. */
  leavesTerrainTypeOnMove: number | null
  /** Bouncy Bomb: when this stack's creatures die, pulse min_dmg × deaths. */
  killChainPulse: boolean
  /** Flesh Golem: flat % chance per Living kill to grow qty by growsQtyOnKill. */
  killAbsorbChancePct: number | null
  /** Victim must have this unit_tag.id to be absorbable (legacy single-tag). */
  killAbsorbTagRequired: number | null
  /** Victim must have ALL of these unit_tag.ids (e.g. Humanoid+Living). */
  killAbsorbTagsRequired: number[]
  /** Victim creature tier must equal this (Pit Fiend Arch). */
  killAbsorbRequiresTier: number | null
  /**
   * `per_attack`: +growsQtyOnKill once when the attack kills ≥1 qualifying
   * creature. Default / omitted: roll or grant once per creature killed.
   */
  killAbsorbTrigger: 'per_attack' | null
  /** Qty (and startingQty) gained on a successful absorb. */
  growsQtyOnKill: number | null
  /** Line shape: flat damage adds this × hex-distance to min_dmg. */
  dmgIncreasePerHex: number | null
  /** Charge: escalate damage once per hex walked before the strike. */
  chargeDmgEscalation: boolean
  /** Charge: chance% = hero.strength × this (usually 1). */
  escalationChancePctStat: number | null
  /** Charge: multiply current damage by this on a successful roll (e.g. 1.5). */
  escalationMult: number | null
  /** Charge: if floor(mult) gains &lt; this, force +this instead. */
  escalationMinIncrease: number | null
  /**
   * Flat speed cut of floor(hero.strength / div) on hit (Gladiator).
   * Uses chancePct + resistStat + conditionDuration for proc/resist/length.
   */
  speedDebuffFlatStatDiv: number | null
  /** Bonus damage vs targets with any of these unit_tag.ids (with bonusDmgMult). */
  bonusDmgTags: number[]
  /** Multiply strike damage when the target has any bonusDmgTags entry (e.g. 2 = double). */
  bonusDmgMult: number | null
  /** Illusions: AI threat scoring treats this stack as a real combat threat. */
  aiTreatAsThreat: boolean
  /** Arcane Shield: Magic damage is fully negated; Physical applies normally. */
  immuneToMagicDmg: boolean
  /**
   * Blink movement: relocate to any LOS hex (ignore Speed distance budget).
   * Pair with requiresLos / respectsHexSize.
   */
  blinkMovement: boolean
  /** When blinkMovement: destination must have clear line of sight. */
  requiresLos: boolean
  /** When blinkMovement: footprint/hex_size must fit (always enforced). */
  respectsHexSize: boolean
  /** Chronomancer: swap Speeds with a faster target for speedSwapDuration. */
  speedSwapIfTargetFaster: boolean
  /** Rounds the speed swap lasts (default 1). */
  speedSwapDuration: number
  /** High Priestess: after a kill, fully heal the most-injured Temple ally. */
  healMostInjuredOnKill: boolean
  /** With healMostInjuredOnKill: restore the stack completely (qty + front HP). */
  healFull: boolean
  /**
   * Inquisitor Grand: after a kill, chance% = hero.strength × this to act again.
   * Uncapped across successive turns (Fervor-style).
   */
  extraTurnOnKill: boolean
  /** Multiplier for strength→% chance (extra_turn_on_kill / Ninja chain). */
  chancePctFlatStat: number | null
  /**
   * Ninja: after each successful bonus attack, halve the chance and roll again
   * until a roll fails (STR × chancePctFlatStat starts the chain).
   */
  chanceHalvesEachAttempt: boolean
  /**
   * Ninja / similar: enable STR×chancePctFlatStat bonus-attack rolls
   * (distinct from Assassin's flat chancePct + extraAttackOnAttackOnly).
   */
  grantsSecondAttack: boolean
  /** Angelic Warrior: always fire a second strike in the same action. */
  dualAttack: boolean
  /** Damage type of the second dual-attack strike. */
  secondAttackDmgType: 'Physical' | 'Magic' | null
  secondAttackMinDmg: number | null
  secondAttackMaxDmg: number | null
  /** Dual attack: defender retaliates once after both hits (not between). */
  retaliateOnceAfterBoth: boolean
  /** Divine Aura Master: ally stacks within this hex radius pool into attack qty (+1 per stack). */
  auraRadius: number | null
  /** When true with auraRadius: +1 effective qty per nearby Temple ally stack (not sum of their units). */
  auraCountsAlliesAsExtraQty: boolean
  /** Mud Sprite: grow at turn-start only when on this terrain_type.id. */
  terrainGrowthTerrainTypeId: number | null
  /**
   * Legacy flat growth amount (unused). Mud Sprite grows by floor(qty/10), min 1.
   */
  terrainGrowthAmount: number | null
  /** Tidal Caller: clear this ground_effect.id along the attack path (Fire = 6). */
  clearsGroundEffectId: number | null
  /** Thunder Lizard / Tempest: chance% = hero.intel × this. */
  chancePctIntelStat: number | null
  /** Tempest: after move stops, scatter ground_effect in attack radius. */
  scatterGroundEffectOnMoveStop: boolean
  /** Pyromaniac spiral: % subtracted from chance after each successful Fire place. */
  spiralChanceDecayPct: number | null
  /** Phoenix: roll self-rez immediately on full wipe. */
  selfRezOnWipe: boolean
  /** Phoenix: chance uses floor(intel / this). */
  selfRezChanceStatDiv: number | null
  /** Phoenix: max self-rez chance (never 100%). */
  selfRezCapPct: number | null
  /** Phoenix: multiply chance by Phoenix deaths this round (incl. wipe). */
  selfRezBasedOnKillsThisRound: boolean
}

export const DEFAULT_UNIT_RETALIATION: UnitRetaliation = {
  dmgPct: 'default',
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
  autoSplitOnTurn: false,
  skipFirstTurn: false,
  killOnOverflow: false,
  chancePct: null,
  extraAttackOnAttackOnly: false,
  speedDebuffPct: null,
  leavesGroundEffectOnMove: false,
  leavesGroundEffectOnAttack: false,
  groundEffectId: null,
  immuneToFire: false,
  immuneToLightning: false,
  fullPath: false,
  canTargetAllyIfTag: null,
  healOnAllyTarget: false,
  healAmtPerUnit: null,
  leavesTerrainTypeOnMove: null,
  killChainPulse: false,
  killAbsorbChancePct: null,
  killAbsorbTagRequired: null,
  killAbsorbTagsRequired: [],
  killAbsorbRequiresTier: null,
  killAbsorbTrigger: null,
  growsQtyOnKill: null,
  dmgIncreasePerHex: null,
  chargeDmgEscalation: false,
  escalationChancePctStat: null,
  escalationMult: null,
  escalationMinIncrease: null,
  speedDebuffFlatStatDiv: null,
  bonusDmgTags: [],
  bonusDmgMult: null,
  aiTreatAsThreat: false,
  immuneToMagicDmg: false,
  blinkMovement: false,
  requiresLos: false,
  respectsHexSize: false,
  speedSwapIfTargetFaster: false,
  speedSwapDuration: 1,
  healMostInjuredOnKill: false,
  healFull: false,
  extraTurnOnKill: false,
  chancePctFlatStat: null,
  chanceHalvesEachAttempt: false,
  grantsSecondAttack: false,
  dualAttack: false,
  secondAttackDmgType: null,
  secondAttackMinDmg: null,
  secondAttackMaxDmg: null,
  retaliateOnceAfterBoth: false,
  auraRadius: null,
  auraCountsAlliesAsExtraQty: false,
  terrainGrowthTerrainTypeId: null,
  terrainGrowthAmount: null,
  clearsGroundEffectId: null,
  chancePctIntelStat: null,
  scatterGroundEffectOnMoveStop: false,
  spiralChanceDecayPct: null,
  selfRezOnWipe: false,
  selfRezChanceStatDiv: null,
  selfRezCapPct: null,
  selfRezBasedOnKillsThisRound: false,
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
  /** Town synergy passive (first engine support: Necromancer / Death Knight). */
  passive_ability: Record<string, unknown> | null
  /**
   * Tunable constants for the class passive (BR S7-2). Engine formulas read
   * named keys from here — not from hardcoded literals.
   */
  passive_stats: Record<string, unknown> | null
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
  /** Nullable hero archetype. Null = pure player blend. */
  arch_id: number | null
}

export type AiArchRow = {
  id: number
  name: string
  description: string | null
}

export type AiArchWeightRow = {
  arch_id: number
  decision_key: string
  factor_key: string
  weight: number
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
  ai_arch: AiArchRow[]
  ai_arch_weight: AiArchWeightRow[]
  levels: LevelRow[]
  hero_levels: HeroLevelRow[]
  ground_effect: GroundEffectRow[]
}

export type GroundEffectLayer = 'above_units' | 'below_units'

export type GroundEffectDisplayRules = {
  layer: GroundEffectLayer
}

export type GroundEffectRow = {
  id: number
  name: string
  description: string | null
  mechanic: Record<string, unknown> | null
  hidden: boolean
  image_path: string | null
  display_rules: GroundEffectDisplayRules | null
}

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
      arch_id: asOptionalId(rec.arch_id),
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
  // Some rows store a bare {"any":[...]} / {"all":[...]} instead of a list.
  if (!Array.isArray(value) && typeof value === 'object') {
    return asRequires([value])
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
      const all = asIdList(rec.all)
      if (all.length > 0) {
        clauses.push({ all })
      }
      continue
    }
    if (Array.isArray(rec.any)) {
      const any = asIdList(rec.any)
      if (any.length > 0) {
        clauses.push({ any })
      }
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

function asAiArch(rows: unknown): AiArchRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  const out: AiArchRow[] = []
  for (const row of rows) {
    if (row == null || typeof row !== 'object') {
      continue
    }
    const rec = row as Record<string, unknown>
    const id = asInt(rec.id)
    const name = typeof rec.name === 'string' ? rec.name.trim() : ''
    if (id <= 0 || !name) {
      continue
    }
    out.push({
      id,
      name,
      description: typeof rec.description === 'string' ? rec.description : null,
    })
  }
  return out
}

function asAiArchWeight(rows: unknown): AiArchWeightRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  const out: AiArchWeightRow[] = []
  for (const row of rows) {
    if (row == null || typeof row !== 'object') {
      continue
    }
    const rec = row as Record<string, unknown>
    const archId = asInt(rec.arch_id)
    const decision =
      typeof rec.decision_key === 'string' ? rec.decision_key.trim() : ''
    const factor =
      typeof rec.factor_key === 'string' ? rec.factor_key.trim() : ''
    const weight = Number(rec.weight)
    if (archId <= 0 || !decision || !factor || !Number.isFinite(weight)) {
      continue
    }
    out.push({ arch_id: archId, decision_key: decision, factor_key: factor, weight })
  }
  return out
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
      const livePassive = asJsonObject(rec.passive_ability)
      const lower = name.toLowerCase()
      // Warlock / Heretic (Pandemonium): keep DB payload, finalize display copy.
      // Knight / Monk / Shaman: display fallbacks only — passive_stats come from DB as-is.
      let passive_ability = livePassive
      if (lower === 'warlock') {
        passive_ability = {
          ...(livePassive ?? {}),
          display:
            'Post-battle: converts Humanoid+Living kills into demon reinforcements. Max tier = floor(INT/6), capped by highest tier killed. Qty = INT.',
        }
      } else if (lower === 'heretic') {
        passive_ability = {
          ...(livePassive ?? {}),
          display:
            'Post-battle: converts Humanoid+Living kills into demon reinforcements. Max tier = floor(INT/4), capped by highest tier killed. Qty = INT.',
        }
      } else if (lower === 'knight') {
        // Display from DB when present; fallback only if display text missing.
        passive_ability = {
          ...(livePassive ?? {}),
          display:
            livePassive?.display ??
            'Chance to Retaliate Twice STR x2.5%',
        }
      } else if (lower === 'monk') {
        passive_ability = {
          ...(livePassive ?? {}),
          display:
            livePassive?.display ??
            'Chance to Reflect Retaliation Dmg STR x2.5%',
        }
      } else if (lower === 'wizard') {
        passive_ability = {
          ...(livePassive ?? {}),
          mana_on_tower_magic_attack: true,
          display:
            livePassive?.display ??
            'When a Tower unit deals Magic damage with an attack, gain +1 Mana (once per attack action, capped at max).',
        }
      } else if (lower === 'sorcerer') {
        passive_ability = {
          ...(livePassive ?? {}),
          mana_on_tower_magic_taken: true,
          display:
            livePassive?.display ??
            'When a Tower unit takes Magic damage from an attack, gain +1 Mana (once per unit hit per attack action, capped at max).',
        }
      } else if (lower === 'cleric') {
        // End-of-round heal pool + end-of-battle rez chance.
        passive_ability = {
          ...(livePassive ?? {}),
          display:
            'End of round: heals damaged Temple stacks (most-hurt first) from a pool of INT x Temple stack count HP. End of battle: 1% chance to fully resurrect a random Temple stack that took casualties.',
        }
      } else if (lower === 'paladin') {
        // BR S7-1: Temple stack dmg% bonuses replace the prior end-of-round execute copy.
        passive_ability = {
          ...(livePassive ?? {}),
          display:
            'STR + Temple stacks bonus Physical dmg%; INT + Temple stacks bonus Magic dmg%',
        }
      } else if (lower === 'druid') {
        passive_ability = {
          ...(livePassive ?? {}),
          display:
            'Hero gains +1 Mana when a Grove stack attacks (once per attack action, capped at max)',
        }
      } else if (lower === 'ranger') {
        passive_ability = {
          ...(livePassive ?? {}),
          display:
            livePassive?.display ??
            'STR + (Grove stacks x5) chance to avoid enemy retaliation 1-90%',
        }
      } else if (lower === 'barbarian') {
        passive_ability = {
          ...(livePassive ?? {}),
          display:
            livePassive?.display ??
            'Bonus Physical Dmg STR + (Fortress Stacks)%',
        }
      } else if (lower === 'rogue') {
        passive_ability = {
          ...(livePassive ?? {}),
          display:
            livePassive?.display ??
            '+1 current hero Energy whenever a Fortress unit attack is retaliated against',
        }
      } else if (lower === 'forge master') {
        passive_ability = {
          ...(livePassive ?? {}),
          display:
            'STR + (Non-Living Factory stacks x2) bonus Physical dmg%, applies only to Non-Living Factory units',
        }
      } else if (lower === 'conjurer') {
        passive_ability = {
          ...(livePassive ?? {}),
          display:
            'INT + (Non-Living Factory stacks x2) bonus Magic dmg%, applies only to Non-Living Factory units',
        }
      } else if (lower === 'shaman') {
        // Display from DB when present; passive_stats are DB-only (no loader pin).
        passive_ability = {
          ...(livePassive ?? {}),
          display:
            livePassive?.display ??
            'Each round, adds 1 totem (up to INT/4, min 1) if below max — random Fire, Lightning, or Nature. Nature totems heal the most injured stack INT x4 at end of round if they survive.',
        }
      } else if (lower === 'evoker') {
        passive_ability = {
          ...(livePassive ?? {}),
          display:
            livePassive?.display ??
            '(INT + Confluence STACKS in army)% bonus dmg on Hero own spell casts',
        }
      } else if (lower === 'death knight') {
        passive_ability = {
          ...(livePassive ?? {}),
          display:
            'On Shadow: step cost × (1 - STR × 2%), max 75% reduction. While standing in Shadow, Ground/Submerge units deal STR% bonus Physical damage.',
        }
      }
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
        passive_ability,
        // Cleric S7-3: ensure engine keys exist when DB still has the old
        // 1%-rez-only payload. DB values override defaults when present.
        // Knight / Monk / Shaman: no loader pin — passive_stats is DB-only.
        passive_stats:
          lower === 'cleric'
            ? {
                heal_stat_source: 'INT',
                heal_town_filter: 'Temple',
                heal_timing: 'end_of_round',
                heal_target_rule: 'most_hurt_first',
                rez_chance_pct: 1,
                rez_town_filter: 'Temple',
                rez_condition: 'casualties_gt_0',
                rez_selection: 'random',
                rez_scope: 'full_stack',
                ...(asJsonObject(rec.passive_stats) ?? {}),
              }
            : lower === 'death knight'
              ? {
                  // Move reduction (existing) + S7-1 addendum Physical dmg on Shadow.
                  stat_source: 'STR',
                  pct_per_point: 2,
                  max_reduction_pct: 75,
                  condition: 'standing_in_shadow',
                  dmg_stat_source: 'STR',
                  dmg_multiplier_pct: 1,
                  unit_filter: ['Ground', 'Submerge'],
                  ...(asJsonObject(rec.passive_stats) ?? {}),
                }
              : asJsonObject(rec.passive_stats),
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

function asAbilityCost(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value))
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    let total = 0
    for (const amount of Object.values(value as Record<string, unknown>)) {
      const n = Number(amount)
      if (Number.isFinite(n)) {
        total += Math.trunc(n)
      }
    }
    return Math.max(0, total)
  }
  return 0
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
        cost: asAbilityCost(rec.cost),
        cooldown_id: asInt(rec.cooldown_id),
        target_id: asOptionalId(rec.target_id),
        ability_type_id: asOptionalId(rec.ability_type_id),
        stats: normalizeAbilityStatFlags(asJsonObject(rec.stats)),
      }
    })
    .filter((row) => row.id > 0 && row.name.length > 0)
}

/** Boolean-like ability.stats keys — coerce 1/"true" at catalog load. */
const ABILITY_BOOL_STAT_KEYS = [
  'resorts_remaining_initiative',
  'reveals_enemy_stats',
  'forces_return_to_start',
  'persists_on_summon',
  'duplicates_target',
  'places_on_nearest_open_hex',
  'insert_into_current_round_queue',
  'summon_as_separate_stacks',
  'condition_immunity',
  'revive_on_dmg_dealt',
  'drain_heal',
  'vampiric_strike',
  'grants_extra_turn',
  'grants_kill_on_overflow',
  'guaranteed_max_dmg',
  'guaranteed_hit',
  'disable_min_range_penalty',
  'guarantees_miss_next_physical_hit',
  'instant',
  'no_turn_cost',
  'forces_max_dmg_on_target',
  'forces_min_dmg_on_target',
  'prevents_critical',
  'grants_ignore_target_armor',
  'physical_only',
  'reflects_physical_only',
  'ends_round_immediately',
  'skips_duration_tick',
  'direction_by_target_side',
  'clears_conditions',
  'clears_stat_debuffs',
  'grants_condition_immunity',
  'clears_terrain',
  'clears_los_blockers',
  'heals_to_full',
  'snapshot_qty_on_cast',
  'prevents_death_once',
  'targets_hexes',
  'friendly_takes_dmg',
  'no_stat_threshold',
  'before_retaliation',
  'ignores_retaliation',
  'insert_into_current_round_queue',
  'kill_on_overflow',
  'breaks_on_damage',
  'skip_occupied_adjacent',
  'redistribute_if_single_adjacent',
  'self_teleport',
  'respects_hex_size',
  'ignores_mitigation',
  'second_attack_after_retaliation',
  'blocks_direct_targeting',
  'aoe_still_hits',
  'can_still_retaliate',
  'retaliates_before_attack_resolves',
  'targets_empty_hexes',
  'prefers_empty_ground_effect_hexes',
  'ignores_sublethal_damage',
  'show_placement_preview',
  'avoids_occupied_hexes',
  'stops_if_blocked',
] as const

function normalizeAbilityStatFlags(
  stats: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!stats) {
    return null
  }
  let changed = false
  const next: Record<string, unknown> = { ...stats }
  for (const key of ABILITY_BOOL_STAT_KEYS) {
    if (!(key in next) || next[key] == null) {
      continue
    }
    const raw = next[key]
    const normalized = asBoolFlag(raw)
    if (raw !== normalized) {
      next[key] = normalized
      changed = true
    }
  }
  return changed ? next : stats
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
        stats: { revive_on_dmg_dealt: true, ...(row.stats ?? {}) },
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
    if (row.name === 'Recruit the Dead') {
      const friendAll =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all',
        )?.id ?? 3
      const summonType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'summon')?.id ?? 4
      const rest = { ...(row.stats ?? {}) }
      delete rest.requires_existing_summon_tag
      return {
        ...row,
        target_id: row.target_id ?? friendAll,
        ability_type_id: row.ability_type_id ?? summonType,
        stats: {
          kill_pct_stat: 4,
          kill_tag: 2,
          summon_tag: 12,
          persists_on_summon: true,
          ...rest,
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
    if (row.name === 'Unstable Rift') {
      const summonType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'summon')?.id ?? 4
      const rest = { ...(row.stats ?? {}) }
      // S7-11: silence_schedule was a misnamed bolt-count schedule.
      const schedule =
        (Array.isArray(rest.bolt_schedule) ? rest.bolt_schedule : null) ??
        (Array.isArray(rest.silence_schedule) ? rest.silence_schedule : null) ??
        [3, 2, 1]
      delete rest.silence_schedule
      return {
        ...row,
        ability_type_id: row.ability_type_id ?? summonType,
        stats: {
          ...rest,
          summon_unit_id: 223,
          summon_count: 3,
          persists_on_summon: false,
          bolt_schedule: schedule,
        },
      }
    }
    if (row.name === 'Earth Spikes') {
      const allAoe =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'all_aoe',
        )?.id ?? 8
      const attackType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1
      return {
        ...row,
        target_id: row.target_id ?? allAoe,
        ability_type_id: row.ability_type_id ?? attackType,
        stats: {
          shape: 'multi',
          radius: 4,
          bolts_stat: 1,
          int_dmg: 1.5,
          friendly_takes_dmg: false,
          move_type: 'random',
          move_dist_range: [1, 2],
          move_dist_fallback: 3,
          // Terrain object per erupted hex (unit 257) — placed in sync with each bolt.
          summon_unit_id: 257,
          targets_hexes: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Brisk Renewal') {
      const friendAll =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all',
        )?.id ?? 3
      const buffTypeId =
        types.find((entry) => entry.value.trim().toLowerCase() === 'buff')?.id ?? 2
      return {
        ...row,
        target_id: row.target_id ?? friendAll,
        ability_type_id: row.ability_type_id ?? buffTypeId,
        stats: {
          recurring_trigger: 'end_of_round',
          heal_pct_stat: 2,
          heal_min: 1,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Gift of Gaia') {
      const allAll =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'all_all',
        )?.id ??
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all',
        )?.id ??
        3
      const utilType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'utility')
          ?.id ?? 5
      return {
        ...row,
        target_id: row.target_id ?? allAll,
        ability_type_id: row.ability_type_id ?? utilType,
        stats: {
          clear_chance_pct_stat: 2,
          clears_terrain: true,
          clears_los_blockers: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Ice Shards') {
      const enemySingle =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') ===
            'enemy_single',
        )?.id ?? 4
      const attackType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1
      // Live DB has swapped stats with Earthquake on some rows — keep placement keys.
      const raw = { ...(row.stats ?? {}) }
      delete raw.min_dmg
      delete raw.max_dmg
      delete raw.inflicts_condition
      delete raw.chance_pct_flat_stat
      delete raw.no_stat_threshold
      delete raw.duration
      delete raw.resist_stat
      return {
        ...row,
        target_id: enemySingle,
        ability_type_id: row.ability_type_id ?? attackType,
        stats: {
          ...raw,
          int_dmg: 5,
          summon_unit_id: 258,
          summon_count: 5,
          shard_radius: 1,
          skip_occupied_adjacent: true,
          redistribute_if_single_adjacent: true,
        },
      }
    }
    if (row.name === 'Blizzard') {
      const enemyAll =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_all',
        )?.id ?? 6
      const attackType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1
      return {
        ...row,
        target_id: row.target_id ?? enemyAll,
        ability_type_id: row.ability_type_id ?? attackType,
        stats: {
          ...(row.stats ?? {}),
          min_dmg: 10,
          max_dmg: 20,
          // BR S7-4: Slow (condition 12), not Stun — differentiates from Earthquake.
          inflicts_condition: 12,
          duration: 1,
          resist_stat: 'resistance',
        },
      }
    }
    if (row.name === 'Earthquake') {
      const enemyAoe =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_aoe',
        )?.id ?? 5
      const attackType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1
      const raw = { ...(row.stats ?? {}) }
      delete raw.skip_occupied_adjacent
      delete raw.shard_radius
      delete raw.redistribute_if_single_adjacent
      delete raw.summon_unit_id
      delete raw.summon_count
      delete raw.int_dmg
      return {
        ...row,
        target_id: row.target_id ?? enemyAoe,
        ability_type_id: row.ability_type_id ?? attackType,
        stats: {
          ...raw,
          min_dmg: 10,
          max_dmg: 20,
          shape: 'aoe',
          radius: 3,
          inflicts_condition: 2,
          duration: 1,
          resist_stat: 'resistance',
        },
      }
    }
    if (row.name === 'Summon Mud Golem') {
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
          summon_unit_id: 259,
          summon_qty_stat_div: 2,
          persists_on_summon: true,
          insert_into_current_round_queue: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Time Warp') {
      return {
        ...row,
        stats: {
          grants_extra_turn: true,
          duration: 1,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Mass Slow') {
      const enemyAll =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_all',
        )?.id ?? 6
      return {
        ...row,
        target_id: enemyAll,
      }
    }
    if (row.name === 'Berserk') {
      const rest = { ...(row.stats ?? {}) }
      // S7-10: strip legacy permanent-only payload; force duration + Res=0.
      delete rest.def_mult
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          ...rest,
          min_dmg_mult: 2,
          max_dmg_mult: 2,
          set_defense: 0,
          set_resistance: 0,
          duration_stat_div: 9,
        },
      }
    }
    if (row.name === 'Execute') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          grants_kill_on_overflow: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Furious Rush') {
      const rest = { ...(row.stats ?? {}) }
      return {
        ...row,
        target_id: friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          movement: 'max_distance',
          speed_bonus_stat_div: 10,
          max_dmg_mult_stat_div: 10,
          guaranteed_max_dmg: true,
          guaranteed_hit: true,
          crit_pct_flat_stat_div: 10,
          crit_amt_flat_stat_div: 10,
          no_stat_threshold: true,
          uses: 1,
          ...rest,
        },
      }
    }
    if (row.name === 'Critical Attacks') {
      const friendAll =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all',
        )?.id ?? 3
      return {
        ...row,
        target_id: row.target_id ?? friendAll,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          crit_pct_flat_stat: 1.5,
          crit_amt_flat_stat: 0.8,
          no_stat_threshold: true,
          min_crit_bonus_dmg: 1,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Adrenaline Rush') {
      const friendAll =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all',
        )?.id ?? 3
      const rest = { ...(row.stats ?? {}) }
      delete rest.duration
      return {
        ...row,
        target_id: row.target_id ?? friendAll,
        ability_type_id: row.ability_type_id ?? buffType,
        // resorts_remaining_initiative must come from DB stats (not hardcoded).
        stats: {
          speed_buff_stat_div: 4,
          uses: 1,
          ...rest,
        },
      }
    }
    if (row.name === 'Blood Lust') {
      const friendAll =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all',
        )?.id ?? 3
      const utilityType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'utility')?.id ?? 5
      const rest = { ...(row.stats ?? {}) }
      // S7-10: replace % Def decay with flat halving.
      delete rest.def_debuff_pct_stat
      return {
        ...row,
        target_id: row.target_id ?? friendAll,
        ability_type_id: row.ability_type_id ?? utilityType,
        stats: {
          ...rest,
          dmg_buff_pct_stat: 10,
          def_divisor: 2,
          def_floor: 1,
          duration: 1,
        },
      }
    }
    if (row.name === 'Steady Aim') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          disable_min_range_penalty: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Parry') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          guarantees_miss_next_physical_hit: true,
          uses: 1,
          ignores_retaliation: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Call Beast') {
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
          summon_unit_id: 224,
          summon_qty_stat_div: 2,
          persists_on_summon: true,
          insert_into_current_round_queue: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Critical Chance') {
      const friendAll =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all',
        )?.id ?? 3
      return {
        ...row,
        target_id: row.target_id ?? friendAll,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          crit_pct_flat_stat: 2,
          no_stat_threshold: true,
          min_crit_bonus_dmg: 1,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Barrage') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          grants_second_attack_pct: 50,
          second_attack_pct_flat_stat: 1,
          before_retaliation: true,
          no_stat_threshold: true,
          uses_stat_div: 5,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Overcharge') {
      const attackType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? attackType,
        stats: {
          shape: 'pulse',
          guaranteed_max_dmg: true,
          instant: true,
          no_turn_cost: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Camouflage') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          evasion_pct: 25,
          duration_stat_div: 7,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Mark Target') {
      const enemySingle =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single',
        )?.id ?? 4
      const debuffType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'debuff')?.id ?? 3
      return {
        ...row,
        target_id: enemySingle,
        ability_type_id: row.ability_type_id ?? debuffType,
        stats: {
          forces_max_dmg_on_target: true,
          hit_count_stat_div: 7,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Expose') {
      const enemyAll =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_all',
        )?.id ?? 5
      const utilityType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'utility')?.id ?? 5
      return {
        ...row,
        target_id: row.target_id ?? enemyAll,
        ability_type_id: row.ability_type_id ?? utilityType,
        stats: {
          reveals_enemy_stats: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Forced Retreat' || row.name === 'Retreat') {
      const enemySingle =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single',
        )?.id ?? 4
      const debuffType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'debuff')?.id ?? 3
      return {
        ...row,
        target_id: row.target_id ?? enemySingle,
        ability_type_id: row.ability_type_id ?? debuffType,
        stats: {
          forces_return_to_start: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Curse' || row.id === 2) {
      const enemySingle =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single',
        )?.id ?? 4
      const debuffType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'debuff')?.id ?? 3
      const rest = { ...(row.stats ?? {}) }
      // S7-11: replace obsolete flat_dmg attack payload.
      delete rest.flat_dmg
      return {
        ...row,
        target_id: row.target_id ?? enemySingle,
        ability_type_id: row.ability_type_id ?? debuffType,
        stats: {
          ...rest,
          duration_stat_div: 10,
          forces_min_dmg_on_target: true,
          prevents_critical: true,
        },
      }
    }
    if (row.name === 'Fervor') {
      const friendAll =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all',
        )?.id ?? 3
      const buffType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'buff')?.id ?? 2
      return {
        ...row,
        target_id: row.target_id ?? friendAll,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          chain_trigger_pct_stat: 1,
          duration: 3,
          applies_to: ['turn', 'retaliation'],
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Battle Cry') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          retaliation_dmg_pct: 100,
          uses_stat_div: 6,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Hyper Focus') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          condition_immunity: true,
          uses: 1,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Illusions') {
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
          summon_unit_id: 260,
          summon_qty_stat_div: 3,
          summon_as_separate_stacks: true,
          placement: 'map_center_scattered',
          persists_on_summon: false,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Animate Weapon') {
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
          summon_unit_id: 261,
          summon_qty_stat_div: 2,
          persists_on_summon: false,
          insert_into_current_round_queue: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Mirror Image') {
      const summonType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'summon')?.id ?? 4
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? summonType,
        stats: {
          duplicates_target: true,
          duplicate_hp_cap_stat: 1,
          places_on_nearest_open_hex: true,
          insert_into_current_round_queue: true,
          persists_on_summon: false,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Arcane Shield') {
      const enemySingle =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single',
        )?.id ?? 4
      const summonType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'summon')?.id ?? 4
      return {
        ...row,
        target_id: row.target_id ?? enemySingle,
        ability_type_id: row.ability_type_id ?? summonType,
        stats: {
          summon_unit_id: 262,
          summon_count: 4,
          placement: 'front_of_target',
          persists_on_summon: false,
          ...(row.stats ?? {}),
          // Pure blocker — never join initiative (same as Wall/Drawbridge).
          insert_into_current_round_queue: false,
        },
      }
    }
    if (row.name === 'Charge') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        // resorts_remaining_initiative must come from DB stats (not hardcoded).
        stats: {
          speed_buff_flat_stat: 1,
          duration: 1,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Guard') {
      const rest = { ...(row.stats ?? {}) }
      // S7-10: additive Def (STR/3), not ×2 multiplier.
      delete rest.def_mult
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          ...rest,
          def_bonus_stat_div: 3,
          duration_stat_div: 5,
        },
      }
    }
    if (row.name === 'Rend') {
      const enemySingle =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') ===
            'enemy_single',
        )?.id ?? 4
      const rest = { ...(row.stats ?? {}) }
      return {
        ...row,
        target_id: row.target_id ?? enemySingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          ...rest,
          set_defense: 0,
          duration_stat_div: 5,
        },
      }
    }
    if (row.name === 'Sunder Armor') {
      const friendAll =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all',
        )?.id ?? 3
      const rest = { ...(row.stats ?? {}) }
      return {
        ...row,
        // S7-10: army-wide (DB may still say friend_single).
        target_id: friendAll,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          ...rest,
          physical_only: true,
          grants_ignore_target_armor: true,
          duration_stat_div: 9,
        },
      }
    }
    if (row.name === 'Stoneskin') {
      const friendAll =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all',
        )?.id ?? 3
      const rest = { ...(row.stats ?? {}) }
      // S7-10: flat Res bonus — strip old Def% key.
      delete rest.unit_defense_pct_stat
      return {
        ...row,
        target_id: row.target_id ?? friendAll,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          ...rest,
          res_bonus_stat_div: 7,
          duration_stat_div: 5,
        },
      }
    }
    if (row.name === 'Shield Wall') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        resource_id: row.resource_id > 0 ? row.resource_id : 1,
        stats: {
          def_mult_stat_div: 5,
          res_mult_stat_div: 5,
          duration_stat_div: 5,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Immunity') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        resource_id: row.resource_id > 0 ? row.resource_id : 1,
        stats: {
          dmg_taken_pct: 0,
          hit_count_stat_div: 9,
          ignores_retaliation: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Rally') {
      const friendAll =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all',
        )?.id ?? 3
      const utilityType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'utility')?.id ?? 5
      return {
        ...row,
        target_id: row.target_id ?? friendAll,
        ability_type_id: row.ability_type_id ?? utilityType,
        stats: {
          ends_round_immediately: true,
          skips_duration_tick: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Mutation') {
      const allSingle =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'all_single',
        )?.id ?? 7
      const utilityType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'utility')?.id ?? 5
      return {
        ...row,
        target_id: allSingle,
        ability_type_id: row.ability_type_id ?? utilityType,
        description:
          "Target any single stack, either side. Friendly targets are buffed, enemy targets are debuffed: Speed, Defense, Resistance, Min/Max damage, Max Range, and Max HP all shift by the same amount, scaled off the caster's Intelligence.",
        stats: {
          delta_all_stats_stat: 0.10,
          direction_by_target_side: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Cleanse') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          clears_conditions: true,
          clears_stat_debuffs: true,
          secondary_random_targets_stat_div: 5,
          secondary_pool: 'friend_with_negative_condition',
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Mass Dispel') {
      const friendAll =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all',
        )?.id ?? 3
      return {
        ...row,
        target_id: row.target_id ?? friendAll,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          clears_conditions: true,
          clears_stat_debuffs: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Iron Will') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          clears_conditions: true,
          clears_stat_debuffs: true,
          grants_condition_immunity: true,
          duration: 1,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Guardian Angel') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          snapshot_qty_on_cast: true,
          prevents_death_once: true,
          uses: 1,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Fortify') {
      const friendAoe =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_aoe',
        )?.id ?? 2
      return {
        ...row,
        target_id: row.target_id ?? friendAoe,
        ability_type_id: row.ability_type_id ?? buffType,
        resource_id: row.resource_id > 0 ? row.resource_id : 1,
        stats: {
          shape: 'aoe',
          radius_stat_div: 6,
          ignores_sublethal_damage: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Last Stand') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        resource_id: row.resource_id > 0 ? row.resource_id : 1,
        stats: {
          min_qty_stat_div: 8,
          min_qty_last_unit_hp: 1,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Barrier') {
      const allSingle =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'all_single',
        )?.id ?? 7
      const utilityType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'utility')?.id ?? 5
      // Force empty-hex line placement. Live DB still has target_id=8 (all_aoe).
      const raw = { ...(row.stats ?? {}) }
      delete raw.targets_empty_hexes
      delete raw.show_placement_preview
      return {
        ...row,
        target_id: allSingle,
        ability_type_id: row.ability_type_id ?? utilityType,
        resource_id: row.resource_id > 0 ? row.resource_id : 1,
        stats: {
          ground_effect_id: 4,
          line_length_stat_div: 5,
          avoids_occupied_hexes: true,
          ...raw,
          targets_empty_hexes: true,
          show_placement_preview: true,
        },
      }
    }
    if (row.name === 'Push Back') {
      const enemySingle =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single',
        )?.id ?? 4
      const attackType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1
      return {
        ...row,
        target_id: row.target_id ?? enemySingle,
        ability_type_id: row.ability_type_id ?? attackType,
        resource_id: row.resource_id > 0 ? row.resource_id : 1,
        stats: {
          str_dmg: 2.5,
          push_dist_stat_div: 7,
          push_direction: 'away_from_caster',
          stops_if_blocked: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Wind Shear' || row.id === 42) {
      const enemySingle =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single',
        )?.id ?? 4
      const attackType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1
      return {
        ...row,
        target_id: row.target_id ?? enemySingle,
        ability_type_id: row.ability_type_id ?? attackType,
        resource_id: row.resource_id > 0 ? row.resource_id : 2,
        stats: {
          shape: 'cleave',
          int_dmg: 2,
          chance_pct: 50,
          resist_stat: 'resistance',
          push_dist: 1,
          push_direction: 'away_from_caster',
          stops_if_blocked: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Chain Lightning' || row.id === 48) {
      const enemySingle =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single',
        )?.id ?? 4
      const attackType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1
      return {
        ...row,
        target_id: row.target_id ?? enemySingle,
        ability_type_id: row.ability_type_id ?? attackType,
        resource_id: row.resource_id > 0 ? row.resource_id : 2,
        stats: {
          shape: 'chain',
          int_dmg: 3,
          jumps: 5,
          falloff: 15,
          allow_repeat_target: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Fireball' || row.id === 41) {
      const enemySingle =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single',
        )?.id ?? 4
      const attackType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1
      return {
        ...row,
        target_id: row.target_id ?? enemySingle,
        ability_type_id: row.ability_type_id ?? attackType,
        resource_id: row.resource_id > 0 ? row.resource_id : 2,
        stats: {
          int_dmg: 2,
          ground_effect_id: 6,
          fire_radius_stat_div: 9,
          fire_drop_chance_pct: 50,
          includes_target_hex: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Wildfire' || row.id === 45) {
      const enemySingle =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single',
        )?.id ?? 4
      const attackType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1
      return {
        ...row,
        target_id: row.target_id ?? enemySingle,
        ability_type_id: row.ability_type_id ?? attackType,
        resource_id: row.resource_id > 0 ? row.resource_id : 2,
        stats: {
          ground_effect_id: 6,
          line_from_caster_to_target: true,
          skips_los_blocker_hexes: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Spell Reflect' || row.id === 46) {
      const friendSingle =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') ===
            'friend_single',
        )?.id ?? 2
      const buffType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'buff')?.id ?? 2
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        resource_id: row.resource_id > 0 ? row.resource_id : 2,
        stats: {
          uses_stat_div: 7,
          redirects_dmg_type: 'Magic',
          redirect_target: 'random_enemy',
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Meteor' || row.id === 47) {
      const allAll =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'all_all',
        )?.id ??
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'all_aoe',
        )?.id ??
        8
      const attackType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1
      // Force whole-board auto-cast. Live DB may still ship all_aoe / aimed targeting.
      return {
        ...row,
        target_id: allAll,
        ability_type_id: row.ability_type_id ?? attackType,
        resource_id: row.resource_id > 0 ? row.resource_id : 2,
        stats: {
          shape: 'multi',
          bolts_stat: 2,
          targets_hexes: true,
          avoids_friendly_hexes: true,
          avoids_los_blocker_hexes: true,
          int_dmg: 3,
          drops_fire_on_hit: true,
          ground_effect_id: 6,
          move_type: 'random',
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Confuse') {
      const enemySingle =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single',
        )?.id ?? 4
      const debuffType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'debuff')?.id ?? 3
      return {
        ...row,
        target_id: row.target_id ?? enemySingle,
        ability_type_id: row.ability_type_id ?? debuffType,
        stats: {
          inflicts_condition: 3,
          resist_stat: 'resistance',
          duration: 1,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Shadow Step') {
      const friendSingleTarget =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_single',
        )?.id ?? 1
      const utilityType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'utility')?.id ?? 5
      return {
        ...row,
        target_id: row.target_id ?? friendSingleTarget,
        ability_type_id: row.ability_type_id ?? utilityType,
        stats: {
          self_teleport: true,
          respects_hex_size: true,
          move_delay_ms: 500,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Deflect') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          takes_dmg_source: 'attacker_min_dmg',
          dmg_taken_pct: 50,
          ignores_mitigation: true,
          uses_stat_div: 7,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Double Tap') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          second_attack_after_retaliation: true,
          uses_stat_div: 10,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Vanish') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          inflicts_condition: 9,
          duration_stat_div: 7,
          blocks_direct_targeting: true,
          aoe_still_hits: true,
          can_still_retaliate: true,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Preemptive Strike') {
      return {
        ...row,
        target_id: row.target_id ?? friendSingle,
        ability_type_id: row.ability_type_id ?? buffType,
        stats: {
          retaliates_before_attack_resolves: true,
          uses_stat_div: 10,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Smoke Bomb') {
      const allAoe =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'all_aoe',
        )?.id ?? 8
      const utilityType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'utility')
          ?.id ?? 5
      return {
        ...row,
        target_id: row.target_id ?? allAoe,
        ability_type_id: row.ability_type_id ?? utilityType,
        stats: {
          shape: 'aoe',
          radius: 2,
          ground_effect_id: 1,
          evasion_pct_flat_stat: 3,
          // Rod: duration not specified — default 3 rounds until confirmed.
          duration: 3,
          ...(row.stats ?? {}),
        },
      }
    }
    if (row.name === 'Explosive Trap') {
      const allSingle =
        targets.find(
          (entry) =>
            entry.value.trim().toLowerCase().replaceAll(' ', '_') ===
            'all_single',
        )?.id ?? 7
      const utilityType =
        types.find((entry) => entry.value.trim().toLowerCase() === 'utility')
          ?.id ?? 5
      // Force placement targeting: empty hexes, never all_aoe. DB currently
      // ships target_id=8 (all_aoe), which would resolve as a whole-board cast.
      const raw = { ...(row.stats ?? {}) }
      delete raw.shape
      delete raw.radius
      const num = (value: unknown, fallback: number) => {
        const n = typeof value === 'number' ? value : Number(value)
        return Number.isFinite(n) ? n : fallback
      }
      return {
        ...row,
        target_id: allSingle,
        ability_type_id: row.ability_type_id ?? utilityType,
        stats: {
          ...raw,
          // Placement: whole-board empty hexes. Explosion radius is separate.
          targets_empty_hexes: true,
          ground_effect_id: 2,
          flat_dmg_flat_stat: num(raw.flat_dmg_flat_stat, 3),
          radius_stat_div: num(raw.radius_stat_div, 10),
          chance_pct_flat_stat: num(raw.chance_pct_flat_stat, 3),
          inflicts_condition: num(raw.inflicts_condition, 2),
          resist_stat:
            typeof raw.resist_stat === 'string' ? raw.resist_stat : 'resistance',
          // Always enemy-only for blast + trigger (DB may omit the flag).
          friendly_takes_dmg: false,
        },
      }
    }
    return row
  })
    .map(applyS75AbilityNormalization)
    .map(applyS712StickyBattleDuration)
}

/**
 * BR S7-12: sticky-for-battle lifecycle marker for tooltip `[duration]`.
 * `duration: null` → "for the battle". No combat change — duration already omitted
 * on these abilities means permanent until battle end.
 */
function applyS712StickyBattleDuration(row: AbilityRow): AbilityRow {
  const stickyIds = new Set([3, 18, 34, 40, 51, 69, 76, 84, 86, 90])
  const stickyNames = new Set([
    'sap strength',
    'bless',
    'mutation',
    'mass slow',
    'expose',
    'critical chance',
    'last stand',
    'execute',
    'critical attacks',
    'slow',
  ])
  const lower = row.name.trim().toLowerCase()
  if (!stickyIds.has(row.id) && !stickyNames.has(lower)) {
    return row
  }
  const stats: Record<string, unknown> = { ...(row.stats ?? {}) }
  // Prefer duration_stat_div when present (round-scaled); do not clobber it.
  if (Object.prototype.hasOwnProperty.call(stats, 'duration_stat_div')) {
    return row
  }
  stats.duration = null
  return { ...row, stats }
}

/**
 * BR S7-5: normalize condition chance / resist patterns on listed hero abilities.
 * Final pass so older fillDesignedAbilities blocks cannot leave resist_stat or
 * chance_pct_flat_stat on rows that must not have them.
 */
function applyS75AbilityNormalization(row: AbilityRow): AbilityRow {
  const id = row.id
  const name = row.name.trim().toLowerCase()
  const stats: Record<string, unknown> = { ...(row.stats ?? {}) }

  const stripResistAndLegacyChance = () => {
    delete stats.resist_stat
    delete stats.no_stat_threshold
    delete stats.chance_pct_flat_stat
  }

  // Condition-is-the-point: 100%, resistable.
  if (id === 59 || name === 'confuse') {
    stats.chance_pct = 100
    stats.resist_stat = 'resistance'
    stats.duration = 1
    stats.inflicts_condition = 3
    return { ...row, stats }
  }
  if (id === 95 || name === 'fear') {
    stripResistAndLegacyChance()
    stats.chance_pct = 100
    stats.resist_stat = 'resistance'
    stats.duration = 1
    stats.inflicts_condition = 1
    return { ...row, stats }
  }

  // Condition-as-side-effect: tier flat %, NOT resistable.
  if (id === 26 || name === 'mind spike') {
    stripResistAndLegacyChance()
    stats.chance_pct = 25
    stats.duration = 1
    stats.inflicts_condition = 4
    return { ...row, stats }
  }
  // Mass Silence: Rod exception (then standing rule) — AOE total-action-denial
  // conditions are resistable even as the ability's primary side effect.
  if (id === 27 || name === 'mass silence') {
    delete stats.chance_pct_flat_stat
    delete stats.no_stat_threshold
    stats.chance_pct = 25
    stats.resist_stat = 'resistance'
    stats.duration = 1
    stats.inflicts_condition = 4
    return { ...row, stats }
  }
  // Blizzard / Earthquake: damage always lands; riding Slow/Stun is resistable.
  if (id === 14 || name === 'blizzard') {
    delete stats.chance_pct_flat_stat
    delete stats.no_stat_threshold
    stats.chance_pct = 33
    stats.resist_stat = 'resistance'
    stats.duration = 1
    stats.inflicts_condition = 12
    return { ...row, stats }
  }
  if (id === 61 || name === 'explosive trap') {
    stripResistAndLegacyChance()
    stats.chance_pct = 33
    stats.duration = 1
    stats.inflicts_condition = 2
    return { ...row, stats }
  }
  if (id === 15 || name === 'earthquake') {
    delete stats.chance_pct_flat_stat
    delete stats.no_stat_threshold
    stats.chance_pct = 50
    stats.resist_stat = 'resistance'
    stats.duration = 1
    stats.inflicts_condition = 2
    return { ...row, stats }
  }
  if (id === 79 || name === 'shield slam') {
    stripResistAndLegacyChance()
    stats.chance_pct = 50
    stats.duration = 1
    stats.inflicts_condition = 2
    return { ...row, stats }
  }

  // Knockback — 100%, not resistable (not a condition).
  if (id === 42 || name === 'wind shear') {
    delete stats.resist_stat
    stats.chance_pct = 100
    return { ...row, stats }
  }

  return row
}

/** BR S7-5 unit condition chance / duration overrides (Base 33% / Advanced 50%). */
function s75UnitConditionNorm(
  unitId: number,
  lowerName: string,
): Partial<UnitCombatAbilities> | null {
  const byId: Record<number, Partial<UnitCombatAbilities>> = {
    // Fear
    20: { chancePct: 50, conditionDuration: 1, resistStat: 'resistance' },
    90: { chancePct: 33, conditionDuration: 1, resistStat: 'resistance' },
    91: { chancePct: 50, conditionDuration: 1, resistStat: 'resistance' },
    144: { chancePct: 33, conditionDuration: 1, resistStat: 'resistance' },
    222: { chancePct: 33, conditionDuration: 1, resistStat: 'resistance' },
    // Stun
    38: { chancePct: 33, conditionDuration: 1, resistStat: 'resistance' },
    39: { chancePct: 50, conditionDuration: 1, resistStat: 'resistance' },
    150: {
      chancePct: 33,
      conditionDuration: 1,
      resistStat: 'resistance',
      chancePctFlatStat: null,
    },
    151: {
      chancePct: 50,
      conditionDuration: 1,
      resistStat: 'resistance',
      chancePctFlatStat: null,
    },
    // Silence
    84: { chancePct: 33, resistStat: 'resistance' },
    85: { chancePct: 50, resistStat: 'resistance' },
    212: {
      chancePct: 33,
      resistStat: 'resistance',
      chancePctFlatStat: null,
    },
    213: {
      chancePct: 50,
      resistStat: 'resistance',
      chancePctFlatStat: null,
    },
    // Confuse (was qty_plus_stat / chance_pct_stat_mult — retired)
    206: {
      chancePct: 33,
      conditionDuration: 1,
      resistStat: 'resistance',
      chancePctFlatStat: null,
    },
    207: {
      chancePct: 50,
      conditionDuration: 1,
      resistStat: 'resistance',
      chancePctFlatStat: null,
    },
  }
  if (byId[unitId]) {
    return byId[unitId]!
  }
  // Name fallbacks when ids drift.
  if (lowerName === 'advanced spirit') {
    return byId[20]!
  }
  if (lowerName === 'nightmare') {
    return byId[90]!
  }
  if (lowerName === 'advanced nightmare') {
    return byId[91]!
  }
  if (lowerName === 'leviathan') {
    return byId[144]!
  }
  if (lowerName === 'bound spirit') {
    return byId[222]!
  }
  if (lowerName === 'medusa') {
    return byId[38]!
  }
  if (lowerName === 'advanced medusa') {
    return byId[39]!
  }
  if (lowerName === 'arbalast') {
    return byId[150]!
  }
  if (lowerName === 'advanced arbalast') {
    return byId[151]!
  }
  if (lowerName === 'concussive turret') {
    return byId[84]!
  }
  if (lowerName === 'advanced concussive turret') {
    return byId[85]!
  }
  if (lowerName === 'abyssal siren') {
    return byId[212]!
  }
  if (lowerName === 'advanced abyssal siren') {
    return byId[213]!
  }
  if (lowerName === 'succubus') {
    return byId[206]!
  }
  if (lowerName === 'advanced succubus') {
    return byId[207]!
  }
  return null
}

function asGroundEffects(rows: unknown): GroundEffectRow[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return rows
    .map((row) => {
      const rec = row as Record<string, unknown>
      const id = asInt(rec.id)
      const name = typeof rec.name === 'string' ? rec.name.trim() : ''
      const description =
        typeof rec.description === 'string' ? rec.description.trim() : null
      const image =
        typeof rec.image_path === 'string' ? rec.image_path.trim() : ''
      const rules = asJsonObject(rec.display_rules)
      const layerRaw =
        typeof rules?.layer === 'string' ? rules.layer.trim().toLowerCase() : ''
      const display_rules: GroundEffectDisplayRules | null =
        layerRaw === 'above_units' || layerRaw === 'below_units'
          ? { layer: layerRaw }
          : null
      return {
        id,
        name,
        description: description || null,
        mechanic: asJsonObject(rec.mechanic),
        hidden: asBoolFlag(rec.hidden),
        image_path: image || null,
        display_rules,
      }
    })
    .filter((row) => row.id > 0 && row.name.length > 0)
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
    // Single id (legacy) — treat as a one-element list.
    if (value != null && value !== '') {
      const n = typeof value === 'number' ? value : Number(value)
      if (Number.isInteger(n) && n > 0) {
        return [n]
      }
    }
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
  let dmgPct: UnitRetaliation['dmgPct'] = 'default'
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
  const shapeRaw =
    typeof rec.shape === 'string' ? rec.shape.trim().toLowerCase() : ''
  const shape =
    shapeRaw.length > 0 && ATTACK_SHAPES.has(shapeRaw)
      ? (shapeRaw as AttackShapeKind)
      : undefined
  const radiusRaw = Number(rec.radius)
  const radius =
    shape != null && Number.isFinite(radiusRaw) && radiusRaw >= 1
      ? Math.floor(radiusRaw)
      : shape != null
        ? 1
        : undefined
  const jumpsRaw = Number(rec.jumps)
  const jumps =
    shape != null && Number.isFinite(jumpsRaw) && jumpsRaw >= 1
      ? Math.floor(jumpsRaw)
      : undefined
  const falloffRaw = Number(rec.falloff)
  const falloff =
    shape != null && Number.isFinite(falloffRaw) && falloffRaw >= 0
      ? Math.min(100, falloffRaw)
      : undefined
  return {
    dmgPct,
    times,
    preemptive: rec.preemptive === true,
    ...(shape != null ? { shape, radius: radius ?? 1 } : {}),
    ...(jumps != null ? { jumps } : {}),
    ...(falloff != null ? { falloff } : {}),
    ...(rec.teleports_attacker === true
      ? {
          teleportsAttacker: true,
          teleportChancePct: (() => {
            const n = Number(rec.teleport_chance_pct)
            return Number.isFinite(n) && n > 0
              ? Math.min(100, Math.floor(n))
              : 50
          })(),
          resistStat: asResistStat(rec.resist_stat),
        }
      : {}),
  }
}

const ATTACK_SHAPES = new Set<string>([
  'single',
  'cleave',
  'aoe',
  'pulse',
  'chain',
  'beam',
  'line',
  'charge_line',
  'multi',
  'rain',
  'breath',
  'spiral',
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
  if (
    text === 'random_wall_segment' ||
    text === 'random_enemy' ||
    text === 'random_enemy_los'
  ) {
    return text
  }
  return null
}

function abilitiesConfigPresent(value: unknown): boolean {
  const rec = asJsonObject(value)
  if (!rec) {
    return false
  }
  return Object.keys(rec).length > 0
}

function asUnitCombatAbilities(value: unknown): UnitCombatAbilities {
  const rec = asJsonObject(value)
  const shapeRaw =
    typeof rec?.shape === 'string' ? rec.shape.trim().toLowerCase() : ''
  const falloffRaw = rec?.falloff
  const falloffNum = Number(falloffRaw)
  const chanceRaw = Number(rec?.chance_pct)
  return {
    no_enemy_retaliation:
      rec?.no_enemy_retaliation === true || rec?.ignores_retaliation === true,
    shape: asAttackShape(shapeRaw),
    radius: asShapeInt(rec?.radius, DEFAULT_UNIT_ABILITIES.radius),
    jumps: asShapeInt(rec?.jumps, DEFAULT_UNIT_ABILITIES.jumps),
    falloff:
      Number.isFinite(falloffNum) && falloffNum >= 0
        ? Math.min(100, falloffNum)
        : DEFAULT_UNIT_ABILITIES.falloff,
    targets: asShapeInt(rec?.targets, DEFAULT_UNIT_ABILITIES.targets),
    rows: asShapeInt(rec?.rows, DEFAULT_UNIT_ABILITIES.rows),
    autoTarget: asAutoTarget(rec?.auto_target) ?? asAutoTarget(rec?.target),
    skipIfNone: rec?.skip_if_none === true,
    inflictsCondition: asOptionalId(rec?.inflicts_condition),
    resistStat: asResistStat(rec?.resist_stat),
    conditionDuration: asShapeInt(
      rec?.debuff_duration ?? rec?.duration,
      DEFAULT_UNIT_ABILITIES.conditionDuration,
    ),
    autoSplitOnTurn: rec?.auto_split_on_turn === true,
    skipFirstTurn: rec?.skip_first_turn === true,
    killOnOverflow: rec?.kill_on_overflow === true,
    chancePct:
      Number.isFinite(chanceRaw) && chanceRaw > 0
        ? Math.min(100, Math.floor(chanceRaw))
        : null,
    extraAttackOnAttackOnly: rec?.extra_attack_on_attack_only === true,
    speedDebuffPct: (() => {
      const n = Number(rec?.speed_debuff_pct)
      return Number.isFinite(n) && n > 0 ? Math.min(100, Math.floor(n)) : null
    })(),
    leavesGroundEffectOnMove: rec?.leaves_ground_effect_on_move === true,
    leavesGroundEffectOnAttack: rec?.leaves_ground_effect_on_attack === true,
    groundEffectId: asOptionalId(rec?.ground_effect_id),
    immuneToFire: rec?.immune_to_fire === true,
    immuneToLightning: rec?.immune_to_lightning === true,
    fullPath: rec?.full_path === true,
    canTargetAllyIfTag: asOptionalId(rec?.can_target_ally_if_tag),
    healOnAllyTarget: rec?.heal_on_ally_target === true,
    healAmtPerUnit: (() => {
      const n = Number(rec?.heal_amt_per_unit)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
    })(),
    leavesTerrainTypeOnMove: asOptionalId(rec?.leaves_terrain_type_on_move),
    killChainPulse: rec?.kill_chain_pulse === true,
    killAbsorbChancePct: (() => {
      const n = Number(rec?.kill_absorb_chance_pct)
      return Number.isFinite(n) && n > 0 ? Math.min(100, Math.floor(n)) : null
    })(),
    killAbsorbTagRequired: asOptionalId(rec?.kill_absorb_tag_required),
    killAbsorbTagsRequired: asIntIds(rec?.kill_absorb_tags_required),
    killAbsorbRequiresTier: (() => {
      const n = Number(rec?.kill_absorb_requires_tier)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
    })(),
    killAbsorbTrigger:
      typeof rec?.kill_absorb_trigger === 'string' &&
      rec.kill_absorb_trigger.trim().toLowerCase() === 'per_attack'
        ? 'per_attack'
        : null,
    growsQtyOnKill: (() => {
      const n = Number(rec?.grows_qty_on_kill)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
    })(),
    dmgIncreasePerHex: (() => {
      const n = Number(rec?.dmg_increase_per_hex)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
    })(),
    chargeDmgEscalation: rec?.charge_dmg_escalation === true,
    escalationChancePctStat: (() => {
      const n = Number(rec?.escalation_chance_pct_stat)
      return Number.isFinite(n) && n > 0 ? n : null
    })(),
    escalationMult: (() => {
      const n = Number(rec?.escalation_mult)
      return Number.isFinite(n) && n > 0 ? n : null
    })(),
    escalationMinIncrease: (() => {
      const n = Number(rec?.escalation_min_increase)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
    })(),
    speedDebuffFlatStatDiv: (() => {
      const n = Number(rec?.speed_debuff_flat_stat_div)
      return Number.isFinite(n) && n > 0 ? n : null
    })(),
    bonusDmgTags: asIntIds(rec?.bonus_dmg_tag),
    bonusDmgMult: (() => {
      const n = Number(rec?.bonus_dmg_mult)
      return Number.isFinite(n) && n > 0 ? n : null
    })(),
    aiTreatAsThreat: rec?.ai_treat_as_threat === true,
    immuneToMagicDmg: rec?.immune_to_magic_dmg === true,
    blinkMovement: rec?.blink_movement === true,
    requiresLos: rec?.requires_los === true,
    respectsHexSize: rec?.respects_hex_size === true,
    speedSwapIfTargetFaster: rec?.speed_swap_if_target_faster === true,
    speedSwapDuration: asShapeInt(
      rec?.speed_swap_duration,
      DEFAULT_UNIT_ABILITIES.speedSwapDuration,
    ),
    healMostInjuredOnKill: rec?.heal_most_injured_on_kill === true,
    healFull: rec?.heal_full === true,
    extraTurnOnKill: rec?.extra_turn_on_kill === true,
    chancePctFlatStat: (() => {
      const n = Number(rec?.chance_pct_flat_stat)
      return Number.isFinite(n) && n > 0 ? n : null
    })(),
    chanceHalvesEachAttempt: rec?.chance_halves_each_attempt === true,
    grantsSecondAttack:
      rec?.grants_second_attack === true ||
      rec?.grants_second_attack_pct === true ||
      Number(rec?.grants_second_attack) === 1,
    dualAttack: rec?.dual_attack === true,
    secondAttackDmgType: (() => {
      const raw =
        typeof rec?.second_attack_dmg_type === 'string'
          ? rec.second_attack_dmg_type.trim().toLowerCase()
          : ''
      if (raw === 'physical') {
        return 'Physical'
      }
      if (raw === 'magic') {
        return 'Magic'
      }
      return null
    })(),
    secondAttackMinDmg: (() => {
      const n = Number(rec?.second_attack_min_dmg)
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
    })(),
    secondAttackMaxDmg: (() => {
      const n = Number(rec?.second_attack_max_dmg)
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
    })(),
    retaliateOnceAfterBoth: rec?.retaliate_once_after_both === true,
    auraRadius: (() => {
      const n = Number(rec?.aura_radius)
      return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null
    })(),
    auraCountsAlliesAsExtraQty: rec?.aura_counts_allies_as_extra_qty === true,
    terrainGrowthTerrainTypeId: asOptionalId(
      rec?.terrain_growth_terrain_type_id,
    ),
    terrainGrowthAmount: (() => {
      const n = Number(rec?.terrain_growth_amount)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
    })(),
    clearsGroundEffectId: asOptionalId(rec?.clears_ground_effect_id),
    chancePctIntelStat: (() => {
      const n = Number(rec?.chance_pct_intel_stat)
      return Number.isFinite(n) && n > 0 ? n : null
    })(),
    scatterGroundEffectOnMoveStop:
      rec?.scatter_ground_effect_on_move_stop === true,
    spiralChanceDecayPct: (() => {
      const n = Number(rec?.spiral_chance_decay_pct)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
    })(),
    selfRezOnWipe: rec?.self_rez_on_wipe === true,
    selfRezChanceStatDiv: (() => {
      const n = Number(rec?.self_rez_chance_stat_div)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
    })(),
    selfRezCapPct: (() => {
      const n = Number(rec?.self_rez_cap_pct)
      return Number.isFinite(n) && n > 0 ? Math.min(100, Math.floor(n)) : null
    })(),
    selfRezBasedOnKillsThisRound:
      rec?.self_rez_based_on_kills_this_round === true,
  }
}

/** BR S6-42: Arcane summon units when DB rows are not loaded yet. */
function designedArcaneUnits(): UnitRow[] {
  const blank = {
    bldg_id: null as number | null,
    town_id: null as number | null,
    class_id: null as number | null,
    tier: null as number | null,
    cost: null as CostMap | null,
    image_path_alt: null as string | null,
    hex_size: null as number | null,
    move_type_id: null as number | null,
    dmg_type: 'Physical' as string | null,
    min_range: 0,
    max_range: 1,
    retaliation: { ...DEFAULT_UNIT_RETALIATION },
    tags: [] as number[],
    has_abilities: true,
    upgrade_cost: null as CostMap | null,
  }
  return [
    {
      ...blank,
      id: 260,
      name: 'Arcane Illusion',
      image_path: 'Illusion.png',
      speed: null,
      stationary: true,
      health: 1,
      defense: 0,
      resistance: 0,
      min_dmg: 0,
      max_dmg: 0,
      blocks_los: false,
      abilities: {
        ...DEFAULT_UNIT_ABILITIES,
        aiTreatAsThreat: true,
      },
    },
    {
      ...blank,
      id: 261,
      name: 'Animated Weapon',
      image_path: 'Animated_Weapon.png',
      speed: 8,
      stationary: false,
      health: 12,
      defense: 2,
      resistance: 2,
      min_dmg: 5,
      max_dmg: 8,
      blocks_los: false,
      abilities: {
        ...DEFAULT_UNIT_ABILITIES,
        autoTarget: 'random_enemy',
      },
    },
    {
      ...blank,
      id: 262,
      name: 'Arcane Shield',
      image_path: 'Arcane_Shield.png',
      speed: null,
      stationary: true,
      health: 45,
      defense: 0,
      resistance: 0,
      min_dmg: 0,
      max_dmg: 0,
      blocks_los: true,
      abilities: {
        ...DEFAULT_UNIT_ABILITIES,
        immuneToMagicDmg: true,
      },
    },
  ]
}

/** BR S6-46: Shaman totems when DB rows are not loaded yet. */
function designedTotemUnits(catalogTowns: { id: number; name: string }[]): UnitRow[] {
  const confluenceId =
    catalogTowns.find((row) => row.name.trim().toLowerCase() === 'confluence')
      ?.id ?? null
  const blank = {
    bldg_id: null as number | null,
    town_id: confluenceId,
    class_id: null as number | null,
    tier: null as number | null,
    cost: null as CostMap | null,
    image_path_alt: null as string | null,
    hex_size: 1 as number | null,
    move_type_id: 1 as number | null,
    dmg_type: 'Magic' as string | null,
    min_range: 1,
    max_range: 7,
    retaliation: { times: 0, dmgPct: 0, preemptive: false },
    // Construct (9) + Non-Living (11) — match SQL; tag ids are stable in catalog.
    tags: [9, 11] as number[],
    has_abilities: true,
    upgrade_cost: null as CostMap | null,
  }
  return [
    {
      ...blank,
      id: 263,
      name: 'Fire Totem',
      image_path: 'Fire_Totem.png',
      speed: 5,
      stationary: true,
      health: 1,
      defense: 0,
      resistance: 0,
      min_dmg: 15,
      max_dmg: 25,
      blocks_los: false,
            abilities: {
        ...DEFAULT_UNIT_ABILITIES,
        shape: 'single',
        autoTarget: 'random_enemy',
        immuneToFire: true,
      },
    },
    {
      ...blank,
      id: 264,
      name: 'Lightning Totem',
      image_path: 'Lightning_Totem.png',
      speed: 5,
      stationary: true,
      health: 1,
      defense: 0,
      resistance: 0,
      min_dmg: 8,
      max_dmg: 13,
      blocks_los: false,
      abilities: {
        ...DEFAULT_UNIT_ABILITIES,
        shape: 'beam',
        autoTarget: 'random_enemy',
        immuneToLightning: true,
      },
    },
    {
      ...blank,
      id: 265,
      name: 'Nature Totem',
      image_path: 'Nature_Totem.png',
      speed: 5,
      stationary: true,
      health: 1,
      defense: 0,
      resistance: 0,
      // Heal-only (S7-8): no combat damage / auto-attack.
      min_dmg: 0,
      max_dmg: 0,
      blocks_los: false,
      abilities: {
        ...DEFAULT_UNIT_ABILITIES,
        shape: 'single',
      },
    },
  ]
}

function unitDesignedImmuneToFire(unitId: number, unitName: string): boolean {
  const name = unitName.trim().toLowerCase()
  return (
    unitId === 194 ||
    unitId === 195 ||
    name === 'homunculus' ||
    name === 'advanced homunculus' ||
    unitId === 196 ||
    unitId === 197 ||
    name === 'imp' ||
    name === 'advanced imp' ||
    unitId === 202 ||
    unitId === 203 ||
    name === 'smoldering ooze' ||
    name === 'advanced smoldering ooze' ||
    unitId === 204 ||
    unitId === 205 ||
    name === 'horned hellion' ||
    name === 'advanced horned hellion' ||
    unitId === 216 ||
    unitId === 217 ||
    name === 'pit fiend arch' ||
    name === 'advanced pit fiend arch' ||
    unitId === 64 ||
    unitId === 65 ||
    name === 'arsonist' ||
    name === 'advanced arsonist' ||
    unitId === 66 ||
    unitId === 67 ||
    name === 'fire giant' ||
    name === 'advanced fire giant'
  )
}

function designedFactoryAbilities(
  unitId: number,
  unitName: string,
): Partial<UnitCombatAbilities> | null {
  const name = unitName.trim().toLowerCase()
  // S6-51: Ninja — blink + diminishing STR×2% extra-attack chain.
  if (
    unitId === 68 ||
    unitId === 69 ||
    name === 'ninja' ||
    name === 'advanced ninja'
  ) {
    return {
      shape: 'single',
      blinkMovement: true,
      requiresLos: true,
      respectsHexSize: true,
      grantsSecondAttack: true,
      chancePctFlatStat: 2,
      chanceHalvesEachAttempt: true,
    }
  }
  if (
    unitId === 76 ||
    unitId === 77 ||
    name === 'goblin hammersmith' ||
    name === 'advanced goblin hammersmith'
  ) {
    return {
      shape: 'single',
      canTargetAllyIfTag: 8,
      healOnAllyTarget: true,
      healAmtPerUnit: 1,
    }
  }
  if (
    unitId === 78 ||
    unitId === 79 ||
    name === 'void' ||
    name === 'advanced void'
  ) {
    return {
      shape: 'pulse',
      radius: 1,
      leavesGroundEffectOnMove: true,
      groundEffectId: 5,
    }
  }
  if (
    unitId === 80 ||
    unitId === 81 ||
    name === 'bouncy bomb' ||
    name === 'advanced bouncy bomb'
  ) {
    return {
      shape: 'pulse',
      radius: 1,
      killChainPulse: true,
    }
  }
  if (
    unitId === 86 ||
    unitId === 87 ||
    name === 'flesh golem' ||
    name === 'advanced flesh golem'
  ) {
    return {
      shape: 'single',
      killAbsorbChancePct: 33,
      killAbsorbTagRequired: 10,
      growsQtyOnKill: 1,
    }
  }
  if (
    unitId === 216 ||
    unitId === 217 ||
    name === 'pit fiend arch' ||
    name === 'advanced pit fiend arch'
  ) {
    return {
      shape: 'single',
      killAbsorbRequiresTier: 6,
      killAbsorbTagsRequired: [2, 10],
      growsQtyOnKill: 1,
      killAbsorbTrigger: 'per_attack',
      immuneToFire: true,
    }
  }
  // S6-35: Fire-immune units (no other designed combat ability required).
  if (
    unitId === 194 ||
    unitId === 195 ||
    name === 'homunculus' ||
    name === 'advanced homunculus' ||
    unitId === 204 ||
    unitId === 205 ||
    name === 'horned hellion' ||
    name === 'advanced horned hellion' ||
    unitId === 64 ||
    unitId === 65 ||
    name === 'arsonist' ||
    name === 'advanced arsonist' ||
    unitId === 66 ||
    unitId === 67 ||
    name === 'fire giant' ||
    name === 'advanced fire giant'
  ) {
    return { immuneToFire: true }
  }
  // S6-43: Weeping Angel — blink + Blind pulse (no enemy retaliation).
  if (
    unitId === 136 ||
    unitId === 137 ||
    name === 'weeping angel' ||
    name === 'advanced weeping angel'
  ) {
    return {
      blinkMovement: true,
      requiresLos: true,
      respectsHexSize: true,
      shape: 'pulse',
      radius: 1,
      chancePct: 50,
      resistStat: 'resistance',
      inflictsCondition: 5,
      conditionDuration: 1,
      no_enemy_retaliation: true,
    }
  }
  // S6-43: Blink Dog — LOS blink relocation only.
  if (
    unitId === 60 ||
    unitId === 61 ||
    name === 'blink dog' ||
    name === 'advanced blink dog'
  ) {
    return {
      blinkMovement: true,
      requiresLos: true,
      respectsHexSize: true,
    }
  }
  // S6-43: Chronomancer — Temporal Bolt speed swap (retaliation is separate JSON).
  if (
    unitId === 138 ||
    unitId === 139 ||
    name === 'chronomancer' ||
    name === 'advanced chronomancer'
  ) {
    return {
      shape: 'single',
      speedSwapIfTargetFaster: true,
      speedSwapDuration: 1,
    }
  }
  // S6-35: attack-trail Fire droppers (+ immune where listed).
  if (
    unitId === 196 ||
    unitId === 197 ||
    name === 'imp' ||
    name === 'advanced imp'
  ) {
    return {
      shape: 'aoe',
      radius: 1,
      leavesGroundEffectOnAttack: true,
      groundEffectId: 6,
      chancePct: 40,
      immuneToFire: true,
    }
  }
  if (
    unitId === 202 ||
    unitId === 203 ||
    name === 'smoldering ooze' ||
    name === 'advanced smoldering ooze'
  ) {
    return {
      shape: 'pulse',
      radius: 1,
      leavesGroundEffectOnAttack: true,
      groundEffectId: 6,
      chancePct: 40,
      immuneToFire: true,
    }
  }
  if (
    unitId === 208 ||
    unitId === 209 ||
    name === 'cerberus' ||
    name === 'advanced cerberus'
  ) {
    return {
      shape: 'breath',
      rows: 2,
      leavesGroundEffectOnAttack: true,
      groundEffectId: 6,
      chancePct: 40,
    }
  }
  if (
    unitId === 210 ||
    unitId === 211 ||
    name === 'efreti' ||
    name === 'advanced efreti' ||
    name === 'efreeti' ||
    name === 'advanced efreeti'
  ) {
    return {
      shape: 'single',
      leavesGroundEffectOnAttack: true,
      groundEffectId: 6,
      chancePct: 100,
    }
  }
  // S6-39 Citadel: CHARGE escalation / flat Slow (DB abilities often still null).
  // Pangolin charge_line comes from unit.abilities.shape in the DB — no id remap.
  if (
    unitId === 158 ||
    unitId === 159 ||
    name === 'jouster' ||
    name === 'advanced jouster'
  ) {
    return {
      shape: 'single',
      chargeDmgEscalation: true,
      escalationChancePctStat: 1,
      escalationMult: 1.5,
      escalationMinIncrease: 1,
    }
  }
  if (
    unitId === 162 ||
    unitId === 163 ||
    name === 'war mammoth' ||
    name === 'advanced war mammoth'
  ) {
    return {
      shape: 'cleave',
      chargeDmgEscalation: true,
      escalationChancePctStat: 1,
      escalationMult: 1.5,
      escalationMinIncrease: 1,
    }
  }
  if (
    unitId === 164 ||
    unitId === 165 ||
    name === 'gladiator' ||
    name === 'advanced gladiator'
  ) {
    return {
      shape: 'single',
      chancePct: 80,
      resistStat: 'resistance',
      speedDebuffFlatStatDiv: 9,
      conditionDuration: 1,
    }
  }
  return null
}

/** BR S6-50: Confluence unit ability fills when DB abilities JSON is absent. */
function designedConfluenceAbilities(
  unitId: number,
  unitName: string,
): Partial<UnitCombatAbilities> | null {
  const name = unitName.trim().toLowerCase()
  const advanced = name.startsWith('advanced ') || unitId % 2 === 1
  // Mud Sprite 170/171 — turn-start growth on Mud (id 9): +floor(qty/10) min 1
  if (
    unitId === 170 ||
    unitId === 171 ||
    name === 'mud sprite' ||
    name === 'advanced mud sprite'
  ) {
    return {
      shape: 'single',
      terrainGrowthTerrainTypeId: 9,
    }
  }
  // Spark 172/173 — Storm on target 100%
  if (
    unitId === 172 ||
    unitId === 173 ||
    name === 'spark' ||
    name === 'advanced spark'
  ) {
    return {
      shape: 'single',
      leavesGroundEffectOnAttack: true,
      groundEffectId: 7,
      chancePct: 100,
      immuneToLightning: true,
    }
  }
  // Tidal Caller 178/179 — line clears Fire
  if (
    unitId === 178 ||
    unitId === 179 ||
    name === 'tidal caller' ||
    name === 'advanced tidal caller'
  ) {
    return {
      shape: 'line',
      dmgIncreasePerHex: 1,
      clearsGroundEffectId: 6,
    }
  }
  // Thunder Lizard 182/183 — beam Storm per hex intel×4%
  if (
    unitId === 182 ||
    unitId === 183 ||
    name === 'thunder lizard' ||
    name === 'advanced thunder lizard'
  ) {
    return {
      shape: 'beam',
      leavesGroundEffectOnAttack: true,
      groundEffectId: 7,
      chancePctIntelStat: 4,
      immuneToLightning: true,
    }
  }
  // Tempest 184/185 — post-move Storm scatter
  if (
    unitId === 184 ||
    unitId === 185 ||
    name === 'tempest' ||
    name === 'advanced tempest'
  ) {
    return {
      shape: 'aoe',
      radius: advanced || unitId === 185 ? 3 : 2,
      scatterGroundEffectOnMoveStop: true,
      groundEffectId: 7,
      chancePctIntelStat: 4,
      immuneToLightning: true,
    }
  }
  // Pyromaniac 186/187 — SPIRAL Fire
  if (
    unitId === 186 ||
    unitId === 187 ||
    name === 'pyromaniac' ||
    name === 'advanced pyromaniac'
  ) {
    return {
      shape: 'spiral',
      radius: advanced || unitId === 187 ? 3 : 2,
      spiralChanceDecayPct: advanced || unitId === 187 ? 5 : 10,
      groundEffectId: 6,
    }
  }
  // Tesla Coil 188/189 — multi Storm 80% per bolt
  if (
    unitId === 188 ||
    unitId === 189 ||
    name === 'tesla coil' ||
    name === 'advanced tesla coil'
  ) {
    return {
      shape: 'multi',
      targets: advanced || unitId === 189 ? 3 : 2,
      leavesGroundEffectOnAttack: true,
      groundEffectId: 7,
      chancePct: 80,
      immuneToLightning: true,
    }
  }
  // Phoenix 192/193
  if (
    unitId === 192 ||
    unitId === 193 ||
    name === 'phoenix' ||
    name === 'advanced phoenix'
  ) {
    return {
      shape: 'single',
      selfRezOnWipe: true,
      selfRezChanceStatDiv: 3,
      selfRezCapPct: 90,
      selfRezBasedOnKillsThisRound: true,
    }
  }
  // Cloud Panther / Channeler / Lightning Totem / Void immunities when DB empty
  if (
    unitId === 174 ||
    unitId === 175 ||
    name === 'cloud panther' ||
    name === 'advanced cloud panther'
  ) {
    return { shape: 'single', immuneToLightning: true }
  }
  if (
    unitId === 176 ||
    unitId === 177 ||
    name === 'channeler' ||
    name === 'advanced channeler'
  ) {
    return { shape: 'chain', immuneToLightning: true }
  }
  if (
    unitId === 78 ||
    unitId === 79 ||
    name === 'void' ||
    name === 'advanced void'
  ) {
    return {
      immuneToLightning: true,
      immuneToFire: true,
    }
  }
  if (
    unitId === 263 ||
    name === 'fire totem'
  ) {
    return {
      shape: 'single',
      autoTarget: 'random_enemy',
      immuneToFire: true,
    }
  }
  if (
    unitId === 264 ||
    name === 'lightning totem'
  ) {
    return {
      shape: 'beam',
      autoTarget: 'random_enemy',
      immuneToLightning: true,
    }
  }
  if (unitId === 265 || name === 'nature totem') {
    return {
      shape: 'single',
    }
  }
  return null
}

/** BR S6-47: Temple unit ability fills when DB abilities JSON is absent. */
function designedTempleAbilities(
  unitId: number,
  unitName: string,
): Partial<UnitCombatAbilities> | null {
  const name = unitName.trim().toLowerCase()
  const advanced = name.startsWith('advanced ')
  if (
    unitId === 106 ||
    unitId === 107 ||
    name === 'zealot' ||
    name === 'advanced zealot'
  ) {
    // Attack stays single; chain lives on retaliation JSON.
    return { shape: 'single' }
  }
  if (
    unitId === 114 ||
    unitId === 115 ||
    name === 'high priestess' ||
    name === 'advanced high priestess'
  ) {
    return {
      shape: 'single',
      healMostInjuredOnKill: true,
      healFull: true,
    }
  }
  if (
    unitId === 116 ||
    unitId === 117 ||
    name === 'inquisitor grand' ||
    name === 'advanced inquisitor grand'
  ) {
    return {
      shape: 'single',
      extraTurnOnKill: true,
      chancePctFlatStat: 1,
    }
  }
  if (
    unitId === 118 ||
    unitId === 119 ||
    name === 'angelic warrior' ||
    name === 'advanced angelic warrior'
  ) {
    return {
      shape: 'cleave',
      dualAttack: true,
      secondAttackDmgType: 'Physical',
      secondAttackMinDmg: advanced || unitId === 119 ? 36 : 35,
      secondAttackMaxDmg: advanced || unitId === 119 ? 46 : 45,
      retaliateOnceAfterBoth: true,
    }
  }
  if (
    unitId === 120 ||
    unitId === 121 ||
    name === 'divine aura master' ||
    name === 'advanced divine aura master'
  ) {
    return {
      shape: 'single',
      auraRadius: advanced || unitId === 121 ? 2 : 1,
      auraCountsAlliesAsExtraQty: true,
    }
  }
  return null
}

function designedTempleRetaliation(
  unitId: number,
  unitName: string,
): Partial<UnitRetaliation> | null {
  const name = unitName.trim().toLowerCase()
  if (
    unitId === 106 ||
    unitId === 107 ||
    name === 'zealot' ||
    name === 'advanced zealot'
  ) {
    const advanced = unitId === 107 || name === 'advanced zealot'
    return {
      shape: 'chain',
      jumps: advanced ? 3 : 2,
      falloff: 33,
      times: 1,
      dmgPct: 50,
    }
  }
  return null
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
      const raw = row as Record<string, unknown>
      const growthNum = Number(raw.growth)
      const name = typeof raw.name === 'string' ? raw.name.trim() : ''
      return {
        id: asInt(raw.id),
        name,
        town_id: asInt(raw.town_id),
        tier:
          raw.tier == null || raw.tier === '' ? null : asInt(raw.tier),
        class_id:
          raw.class_id == null || raw.class_id === ''
            ? null
            : asInt(raw.class_id),
        cost: asCost(raw.cost as CostMap | null),
        effect_type:
          typeof raw.effect_type === 'string' ? raw.effect_type.trim() : '',
        payload:
          raw.payload != null &&
          typeof raw.payload === 'object' &&
          !Array.isArray(raw.payload)
            ? (raw.payload as Record<string, unknown>)
            : null,
        destroy_cost: asCost(raw.destroy_cost as CostMap | null),
        slot_num:
          raw.slot_num == null || raw.slot_num === ''
            ? null
            : asInt(raw.slot_num),
        image_path:
          typeof raw.image_path === 'string' && raw.image_path.trim()
            ? raw.image_path.trim()
            : null,
        growth: Number.isFinite(growthNum) ? growthNum : null,
        level: catalogLevel(raw.level),
        requires: asRequires(raw.requires),
      } satisfies BuildingRow
    },
  ).filter((row) => row.id > 0 && row.name.length > 0)
  let unit: UnitRow[] = (Array.isArray(payload.unit) ? payload.unit : []).map((row) => {
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
      blocks_los?: unknown
      image_path_alt?: unknown
      class_id?: unknown
      tier?: unknown
      town_id?: unknown
    }
    const image = typeof row.image_path === 'string' ? row.image_path.trim() : ''
    const imageAlt =
      typeof extra.image_path_alt === 'string' ? extra.image_path_alt.trim() : ''
    const unitName = typeof row.name === 'string' ? row.name.trim() : ''
    const unitId = asInt(row.id)
    const rift = unitName.toLowerCase() === 'unstable rift'
    const hexRaw = extra.hex_size
    const hexNum = hexRaw == null || hexRaw === '' ? null : asInt(hexRaw)
    const moveRaw = extra.move_type_id
    const moveId =
      moveRaw == null || moveRaw === '' ? null : asInt(moveRaw)
    const dmgType =
      typeof extra.dmg_type === 'string' ? extra.dmg_type.trim() : ''
    const maxRangeRaw = extra.max_range
    const townRaw = extra.town_id
    const townId =
      townRaw == null || townRaw === '' ? null : asInt(townRaw)
    return {
      ...row,
      cost: asCost(row.cost),
      image_path: image || (rift ? 'Unstable_Rift_1.png' : null),
      image_path_alt: imageAlt || (rift ? 'Silent_Rift_1.png' : null),
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
      // Halberdier base (154): DB has max_range 1; designed polearm reach is 1–2
      // like Adv Halberdier (155) and Horned Hellion (204/205).
      max_range: (() => {
        const parsed =
          maxRangeRaw == null || maxRangeRaw === '' ? 1 : asInt(maxRangeRaw)
        if (unitId === 154 && parsed < 2) return 2
        return parsed
      })(),
      retaliation: (() => {
        const base = asUnitRetaliation(extra.retaliation)
        const lower = unitName.toLowerCase()
        if (
          unitId === 136 ||
          unitId === 137 ||
          lower === 'weeping angel' ||
          lower === 'advanced weeping angel'
        ) {
          return { ...base, times: 0 }
        }
        const chrono =
          unitId === 138 ||
          unitId === 139 ||
          lower === 'chronomancer' ||
          lower === 'advanced chronomancer'
        if (chrono) {
          const advanced =
            unitId === 139 || lower === 'advanced chronomancer'
          return {
            ...base,
            teleportsAttacker: true,
            teleportChancePct:
              base.teleportChancePct ?? (advanced ? 75 : 50),
            resistStat: base.resistStat ?? 'resistance',
            dmgPct: base.dmgPct === 'default' ? 50 : base.dmgPct,
          }
        }
        // S6-47 Zealot: force chain retaliation when DB JSON is missing/partial.
        const templeRet = designedTempleRetaliation(unitId, unitName)
        if (templeRet) {
          return {
            ...base,
            ...templeRet,
            shape: base.shape ?? templeRet.shape,
            jumps: base.jumps ?? templeRet.jumps,
            falloff: base.falloff ?? templeRet.falloff,
            dmgPct:
              base.dmgPct !== 'default' ? base.dmgPct : (templeRet.dmgPct ?? base.dmgPct),
            times: base.times !== 1 || templeRet.times == null ? base.times : templeRet.times,
          }
        }
        return base
      })(),
      abilities: (() => {
        const base = asUnitCombatAbilities(extra.abilities)
        let next = base
        if (unitName.toLowerCase() === 'mud golem') {
          next = {
            ...next,
            autoSplitOnTurn: true,
            skipFirstTurn: true,
          }
        }
        // BR S7-4: Thorned Lash speed debuff is resistable (DB may omit key).
        {
          const lower = unitName.trim().toLowerCase()
          if (
            unitId === 26 ||
            unitId === 27 ||
            lower === 'vines' ||
            lower === 'advanced vines'
          ) {
            next = {
              ...next,
              resistStat: next.resistStat ?? 'resistance',
            }
          }
        }
        // BR S7-5: flat condition chance + duration on listed units.
        {
          const s75 = s75UnitConditionNorm(unitId, unitName.trim().toLowerCase())
          if (s75) {
            next = {
              ...next,
              ...s75,
              resistStat: s75.resistStat ?? next.resistStat ?? 'resistance',
            }
          }
        }
        // Factory S6-28/29/35: DB rows may still be null — fill designed stats only
        // when abilities JSON is absent so a live DB row always wins.
        if (!abilitiesConfigPresent(extra.abilities)) {
          const designed =
            designedTempleAbilities(unitId, unitName) ??
            designedConfluenceAbilities(unitId, unitName) ??
            designedFactoryAbilities(unitId, unitName)
          if (designed) {
            next = { ...DEFAULT_UNIT_ABILITIES, ...designed }
          }
        }
        // S6-47 Temple: force designed keys when DB abilities omit them.
        {
          const temple = designedTempleAbilities(unitId, unitName)
          if (temple) {
            next = {
              ...next,
              ...(temple.healMostInjuredOnKill
                ? { healMostInjuredOnKill: true }
                : {}),
              ...(temple.healFull ? { healFull: true } : {}),
              ...(temple.extraTurnOnKill ? { extraTurnOnKill: true } : {}),
              ...(temple.chancePctFlatStat != null &&
              next.chancePctFlatStat == null
                ? { chancePctFlatStat: temple.chancePctFlatStat }
                : {}),
              ...(temple.dualAttack
                ? {
                    dualAttack: true,
                    secondAttackDmgType:
                      next.secondAttackDmgType ?? temple.secondAttackDmgType,
                    secondAttackMinDmg:
                      next.secondAttackMinDmg ?? temple.secondAttackMinDmg,
                    secondAttackMaxDmg:
                      next.secondAttackMaxDmg ?? temple.secondAttackMaxDmg,
                    retaliateOnceAfterBoth: true,
                    shape:
                      next.shape === 'single'
                        ? (temple.shape ?? next.shape)
                        : next.shape,
                  }
                : {}),
              ...(temple.auraCountsAlliesAsExtraQty
                ? {
                    auraCountsAlliesAsExtraQty: true,
                    auraRadius: next.auraRadius ?? temple.auraRadius,
                  }
                : {}),
            }
          }
        }
        // S6-50 Confluence: force engine keys when DB JSON is partial/outdated.
        {
          const confluence = designedConfluenceAbilities(unitId, unitName)
          if (confluence) {
            next = {
              ...next,
              ...(confluence.scatterGroundEffectOnMoveStop
                ? {
                    scatterGroundEffectOnMoveStop: true,
                    groundEffectId:
                      next.groundEffectId ?? confluence.groundEffectId,
                    chancePctIntelStat:
                      next.chancePctIntelStat ?? confluence.chancePctIntelStat,
                    radius: Math.max(
                      next.radius ?? 0,
                      confluence.radius ?? 0,
                    ),
                  }
                : {}),
              ...(confluence.leavesGroundEffectOnAttack
                ? {
                    leavesGroundEffectOnAttack: true,
                    groundEffectId:
                      next.groundEffectId ?? confluence.groundEffectId,
                    chancePct: next.chancePct ?? confluence.chancePct,
                    chancePctIntelStat:
                      next.chancePctIntelStat ?? confluence.chancePctIntelStat,
                  }
                : {}),
              ...(confluence.selfRezOnWipe
                ? {
                    selfRezOnWipe: true,
                    selfRezChanceStatDiv:
                      next.selfRezChanceStatDiv ??
                      confluence.selfRezChanceStatDiv,
                    selfRezCapPct:
                      next.selfRezCapPct ?? confluence.selfRezCapPct,
                    selfRezBasedOnKillsThisRound: true,
                  }
                : {}),
              ...(confluence.terrainGrowthTerrainTypeId != null
                ? {
                    terrainGrowthTerrainTypeId:
                      next.terrainGrowthTerrainTypeId ??
                      confluence.terrainGrowthTerrainTypeId,
                    terrainGrowthAmount:
                      next.terrainGrowthAmount ??
                      confluence.terrainGrowthAmount,
                  }
                : {}),
              ...(confluence.clearsGroundEffectId != null
                ? {
                    clearsGroundEffectId:
                      next.clearsGroundEffectId ??
                      confluence.clearsGroundEffectId,
                    dmgIncreasePerHex:
                      next.dmgIncreasePerHex ?? confluence.dmgIncreasePerHex,
                    shape:
                      next.shape === 'single'
                        ? (confluence.shape ?? next.shape)
                        : next.shape,
                  }
                : {}),
              ...(confluence.shape === 'spiral'
                ? {
                    shape: 'spiral' as const,
                    radius: Math.max(
                      next.radius ?? 0,
                      confluence.radius ?? 0,
                    ),
                    spiralChanceDecayPct:
                      next.spiralChanceDecayPct ??
                      confluence.spiralChanceDecayPct,
                    groundEffectId:
                      next.groundEffectId ?? confluence.groundEffectId,
                  }
                : {}),
              ...(confluence.immuneToLightning
                ? { immuneToLightning: true }
                : {}),
              ...(confluence.immuneToFire ? { immuneToFire: true } : {}),
            }
          }
        }
        // S6-35: listed Fire-immune units always get the flag even if older DB
        // abilities JSON omitted it.
        if (unitDesignedImmuneToFire(unitId, unitName)) {
          next = { ...next, immuneToFire: true }
        }
        // S6-42 Arcane unit flags — keep live even if older DB abilities omit them.
        {
          const lower = unitName.toLowerCase()
          if (unitId === 260 || lower === 'arcane illusion') {
            next = { ...next, aiTreatAsThreat: true }
          }
          if (unitId === 262 || lower === 'arcane shield') {
            next = { ...next, immuneToMagicDmg: true }
          }
          if (
            (unitId === 261 || lower === 'animated weapon') &&
            next.autoTarget == null
          ) {
            next = { ...next, autoTarget: 'random_enemy' }
          }
          // S6-46 Shaman totems.
          if (unitId === 263 || lower === 'fire totem') {
            next = {
              ...next,
              shape: 'single',
              autoTarget: next.autoTarget ?? 'random_enemy',
            }
          }
          if (unitId === 264 || lower === 'lightning totem') {
            next = {
              ...next,
              shape: 'beam',
              autoTarget: next.autoTarget ?? 'random_enemy',
            }
          }
          if (unitId === 265 || lower === 'nature totem') {
            // Heal-only — do not attach autoTarget / damage shapes.
            next = {
              ...next,
              shape: next.shape ?? 'single',
            }
          }
          // S6-43 Tower: force blink / Chronomancer keys even if older DB omitted them.
          if (
            unitId === 136 ||
            unitId === 137 ||
            lower === 'weeping angel' ||
            lower === 'advanced weeping angel'
          ) {
            next = {
              ...next,
              blinkMovement: true,
              requiresLos: true,
              respectsHexSize: true,
              shape: next.shape === 'single' ? 'pulse' : next.shape,
              radius: Math.max(1, next.radius),
              chancePct: next.chancePct ?? 50,
              resistStat: next.resistStat ?? 'resistance',
              inflictsCondition: next.inflictsCondition ?? 5,
              conditionDuration: Math.max(1, next.conditionDuration),
              no_enemy_retaliation: true,
            }
          }
          if (
            unitId === 60 ||
            unitId === 61 ||
            lower === 'blink dog' ||
            lower === 'advanced blink dog'
          ) {
            next = {
              ...next,
              blinkMovement: true,
              requiresLos: true,
              respectsHexSize: true,
            }
          }
          // S6-51 Ninja: blink + diminishing extra-attack chain.
          if (
            unitId === 68 ||
            unitId === 69 ||
            lower === 'ninja' ||
            lower === 'advanced ninja'
          ) {
            next = {
              ...next,
              blinkMovement: true,
              requiresLos: true,
              respectsHexSize: true,
              grantsSecondAttack: true,
              chancePctFlatStat: 2,
              chanceHalvesEachAttempt: true,
              // Must not take Assassin's flat-chance path (that skips this chain).
              extraAttackOnAttackOnly: false,
            }
          }
          if (
            unitId === 138 ||
            unitId === 139 ||
            lower === 'chronomancer' ||
            lower === 'advanced chronomancer'
          ) {
            next = {
              ...next,
              speedSwapIfTargetFaster: true,
              speedSwapDuration: Math.max(1, next.speedSwapDuration || 1),
            }
          }
        }
        return next
      })(),
      tags: asIntIds(extra.tags),
      has_abilities: abilitiesConfigPresent(extra.abilities),
      blocks_los: (() => {
        if (asBoolFlag(extra.blocks_los)) {
          return true
        }
        const lower = unitName.toLowerCase()
        // Terrain drops / Rift: always block sight even if an older DB row
        // omitted blocks_los (Tidal Caller could shoot through Earth Spikes).
        return (
          unitId === 223 ||
          unitId === 257 ||
          unitId === 258 ||
          lower === 'unstable rift' ||
          lower === 'earth spike' ||
          lower === 'ice shard'
        )
      })(),
      town_id: townId != null && townId > 0 ? townId : null,
      class_id: extra.class_id == null || extra.class_id === '' ? null : asInt(extra.class_id),
      tier: extra.tier == null || extra.tier === '' ? null : asInt(extra.tier),
      upgrade_cost: asCost(
        (row as { upgrade_cost?: CostMap | Record<string, number> | null })
          .upgrade_cost,
      ),
    }
  })
  {
    const haveIds = new Set(unit.map((row) => row.id))
    const haveNames = new Set(
      unit.map((row) => row.name.trim().toLowerCase()),
    )
    const towns = Array.isArray(payload.town)
      ? (payload.town as { id: number; name: string }[])
      : []
    const extras = [
      ...designedArcaneUnits(),
      ...designedTotemUnits(towns),
    ].filter(
      (row) =>
        !haveIds.has(row.id) &&
        !haveNames.has(row.name.trim().toLowerCase()),
    )
    if (extras.length > 0) {
      unit = [...unit, ...extras]
    }
  }
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
    condition: (() => {
      const rows = asNamedValues(
        (payload as { condition?: unknown }).condition,
      )
      // BR S7-4: Slow (id 12) — keep a local label if Rod's SQL hasn't landed yet.
      if (!rows.some((row) => row.id === 12 || row.value.toLowerCase() === 'slow')) {
        return [
          ...rows,
          { id: 12, value: 'Slow' },
        ].sort((a, b) => a.id - b.id)
      }
      return rows
    })(),
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
    ai_arch: asAiArch((payload as { ai_arch?: unknown }).ai_arch),
    ai_arch_weight: asAiArchWeight(
      (payload as { ai_arch_weight?: unknown }).ai_arch_weight,
    ),
    levels: asLevels((payload as { levels?: unknown }).levels),
    hero_levels: asHeroLevels((payload as { hero_levels?: unknown }).hero_levels),
    ground_effect: asGroundEffects(
      (payload as { ground_effect?: unknown }).ground_effect,
    ),
  }
  catalog.ability = fillDesignedAbilities(
    catalog.ability,
    catalog.ability_target,
    catalog.ability_type,
  ).map((row) => ({
    ...row,
    stats: normalizeAbilityStatFlags(row.stats),
  }))
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

export function unitUpgradeCost(unit: UnitRow | null): CostMap {
  return unit ? asCost(unit.upgrade_cost) : {}
}

export function isAdvancedUnit(unit: UnitRow | null | undefined): boolean {
  return (unit?.name ?? '').trim().toLowerCase().startsWith('advanced ')
}

/** Advanced counterpart by name: "Worms" → "Advanced Worms". */
export function advancedUnitFor(
  catalog: ReferenceCatalog | null | undefined,
  unit: UnitRow | null | undefined,
): UnitRow | null {
  if (!catalog || !unit || isAdvancedUnit(unit)) {
    return null
  }
  const want = `Advanced ${unit.name.trim()}`.toLowerCase()
  return (
    catalog.unit.find((row) => row.name.trim().toLowerCase() === want) ?? null
  )
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
  catalog?: ReferenceCatalog | null,
): Omit<UnitRetaliation, 'dmgPct'> & { dmgPct: number | 'max' } {
  const spec = unit?.retaliation ?? DEFAULT_UNIT_RETALIATION
  const dmgPct =
    spec.dmgPct === 'default'
      ? retaliationDefaultDmgPct(catalog)
      : spec.dmgPct
  return { ...spec, dmgPct }
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
  const row = catalog.condition.find((entry) => entry.id === conditionId)
  const label = row?.value?.trim() ?? ''
  return label.length > 0 ? label : `condition ${conditionId}`
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

/** Town / Village Hall (and similar) — name match or gold_income root. */
export function isHallBuilding(building: BuildingRow): boolean {
  const name = building.name.trim().toLowerCase()
  if (name.includes('hall')) {
    return true
  }
  return building.effect_type === 'gold_income'
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

function prerequisiteBuildingName(
  catalog: ReferenceCatalog,
  id: number,
): string {
  const pre = buildingById(catalog, id)
  const name = pre?.name?.trim()
  return name && name.length > 0 ? name : `building #${id}`
}

/** One line per unmet requires group (all / any), naming live building rows. */
export function formatUnmetRequires(
  catalog: ReferenceCatalog,
  building: BuildingRow,
  builtIds: ReadonlySet<number>,
): string {
  const parts: string[] = []
  for (const clause of building.requires ?? []) {
    if (requireClausePasses(clause, builtIds)) {
      continue
    }
    if ('all' in clause) {
      const missing = clause.all
        .filter((id) => !builtIds.has(id))
        .map((id) => prerequisiteBuildingName(catalog, id))
      if (missing.length === 1) {
        parts.push(`Requires: ${missing[0]}`)
      } else if (missing.length > 1) {
        parts.push(`Requires: ${missing.join(', ')}`)
      }
      continue
    }
    const names = clause.any.map((id) => prerequisiteBuildingName(catalog, id))
    if (names.length === 1) {
      parts.push(`Requires: ${names[0]}`)
    } else if (names.length > 1) {
      parts.push(`Requires one of: ${names.join(', ')}`)
    }
  }
  return parts.length > 0
    ? parts.join(' ')
    : 'Build the required prerequisite first.'
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

/** Locked army roots with name + unmet requires (for empty-slot panel / hover). */
export function lockedArmyPrerequisiteLines(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
  builtIds: ReadonlySet<number>,
): string[] {
  const locked = armyOptions(catalog, slotId, townTypeId).filter(
    (row) => isBuildRoot(row) && !hasPrerequisite(row, builtIds),
  )
  if (locked.length === 0) {
    return ['Build the required prerequisite first.']
  }
  const lines: string[] = []
  for (const row of locked) {
    const unitName = unitForBuilding(catalog, row.id)?.name?.trim()
    lines.push(`Build ${row.name}${unitName ? ` (${unitName})` : ''}`)
    lines.push(formatUnmetRequires(catalog, row, builtIds))
  }
  return lines
}

export function missingArmyPrerequisiteLine(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
  builtIds: ReadonlySet<number>,
): string {
  return lockedArmyPrerequisiteLines(
    catalog,
    slotId,
    townTypeId,
    builtIds,
  ).join(' ')
}

export function missingGenericPrerequisiteLine(
  catalog: ReferenceCatalog,
  building: BuildingRow,
  builtIds: ReadonlySet<number>,
): string {
  return formatUnmetRequires(catalog, building, builtIds)
}

/** Hover/preview text for an empty town slot (same info as the Build panel). */
export function emptySlotPreviewLines(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
  builtIds: ReadonlySet<number>,
): string[] {
  if (isUndesignedSlot(catalog, slotId, townTypeId)) {
    return ['Not yet designed']
  }
  if (isEmptyPlaceholderSlot(catalog, slotId, townTypeId)) {
    return ['Nothing built here yet.']
  }
  if (isArmySlot(slotId)) {
    const options = armyBuildOptions(catalog, slotId, townTypeId, builtIds)
    if (options.length === 0) {
      return lockedArmyPrerequisiteLines(
        catalog,
        slotId,
        townTypeId,
        builtIds,
      )
    }
    const lines: string[] = []
    for (const building of options) {
      const unitName = unitForBuilding(catalog, building.id)?.name?.trim()
      lines.push(
        `Build ${building.name}${unitName ? ` (${unitName})` : ''}`,
      )
      const effect = effectLine(building)
      if (effect) {
        lines.push(effect)
      }
      lines.push(`Cost: ${formatCost(constructionCost(catalog, building))}`)
    }
    return lines
  }
  const root = genericRoot(genericSlotBuildings(catalog, slotId, townTypeId))
  if (!root) {
    return ['No building defined for this slot.']
  }
  if (!hasPrerequisite(root, builtIds)) {
    return [missingGenericPrerequisiteLine(catalog, root, builtIds)]
  }
  const lines = [`Build ${root.name}`]
  const effect = effectLine(root)
  if (effect) {
    lines.push(effect)
  }
  lines.push(`Cost: ${formatCost(constructionCost(catalog, root))}`)
  return lines
}

/** Destroy cost from the building row only — no app-config / hardcoded fallback. */
export function destroyCostOf(building: BuildingRow): CostMap {
  return asCost(building.destroy_cost)
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

/** The two hero classes that belong to this town type. */
export function tavernClassIds(
  catalog: ReferenceCatalog,
  townTypeId: number,
): number[] {
  return catalog.hero_type
    .filter((row) => row.town_id === townTypeId)
    .map((row) => row.id)
}

/** Tavern hire roster: unused names are applied by the caller. */
export function tavernHirePool(
  catalog: ReferenceCatalog,
  townTypeId: number,
): HeroPoolRow[] {
  const classIds = new Set(tavernClassIds(catalog, townTypeId))
  return catalog.hero_pool.filter((row) => classIds.has(row.class_id))
}

function emptyHeroStats(): HeroStats {
  const n = dummyHeroStat(getCachedCatalog())
  return {
    speed: n,
    stamina: n,
    strength: n,
    intel: n,
    defense: n,
    resist: n,
    crit_pct: n,
    crit_amt: n,
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

/**
 * Cumulative XP needed to advance out of `levelId` into the next level
 * (`levels.xp` where id = the level being left). Null if that row is missing.
 */
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
  const maxLevel = catalog
    ? catalog.levels.reduce((max, row) => (row.id > max ? row.id : max), 0)
    : 0
  // Threshold to leave current level; omit at max (no next level).
  const nextXp =
    catalog && level < maxLevel ? xpToReachLevel(catalog, level) : null
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
    return dummyHeroStat(catalog)
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

export function minRangePenaltyMult(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, appConfigNumber(catalog, 'min_range_penalty_mult', 0.5))
}

export function wallDamageMult(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, appConfigNumber(catalog, 'wall_damage_mult', 0.5))
}

export function retaliationDefaultDmgMult(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, appConfigNumber(catalog, 'retaliation_default_dmg_mult', 0.5))
}

function retaliationDefaultDmgPct(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.min(
    100,
    Math.max(0, Math.round(retaliationDefaultDmgMult(catalog) * 100)),
  )
}

const STARTING_FALLBACK: Record<string, number> = {
  gold: 10000,
  wood: 20,
  ore: 20,
  ichor: 20,
  crystal: 10,
  sap: 10,
  ash: 10,
  aether: 10,
  incense: 10,
  brimstone: 10,
  nuore: 10,
  processed_nuore: 10,
}

function startingConfigKey(name: string): string {
  return `starting_${name.trim().toLowerCase().replaceAll(/\s+/g, '_')}`
}

export function startingStockpileFor(
  catalog: ReferenceCatalog | null | undefined,
  resource: { id: number; name: string },
): number {
  const slug = startingConfigKey(resource.name).slice('starting_'.length)
  const fallback = STARTING_FALLBACK[slug] ?? 0
  return Math.max(
    0,
    Math.floor(appConfigNumber(catalog, startingConfigKey(resource.name), fallback)),
  )
}

export function pickupAmount(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, Math.floor(appConfigNumber(catalog, 'pickup_amount', 1)))
}

export function yieldPerMine(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, Math.floor(appConfigNumber(catalog, 'yield_per_mine', 1)))
}

export function hireHeroGoldCost(
  catalog: ReferenceCatalog | null | undefined,
): CostMap {
  return {
    [GOLD_RESOURCE_ID]: Math.max(
      0,
      Math.floor(appConfigNumber(catalog, 'hire_hero_cost', 1000)),
    ),
  }
}

export function libraryGoldCost(
  catalog: ReferenceCatalog | null | undefined,
  levelId: number,
): number {
  const key =
    levelId === 1
      ? 'library_cost_1'
      : levelId === 2
        ? 'library_cost_2'
        : levelId === 3
          ? 'library_cost_3'
          : null
  const fallback = levelId === 1 ? 500 : levelId === 2 ? 1000 : levelId === 3 ? 2000 : 0
  if (!key) {
    return 0
  }
  return Math.max(0, Math.floor(appConfigNumber(catalog, key, fallback)))
}

export function visionRange(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, Math.floor(appConfigNumber(catalog, 'vision_range', 4)))
}

export function heroInteractCost(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, appConfigNumber(catalog, 'hero_interact_cost', 0.25))
}

export function dummyHeroStat(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, Math.floor(appConfigNumber(catalog, 'dummy_hero_stat', 10)))
}

/**
 * STR/INT/etc. for combat formulas. When no commanding Hero is present
 * (world mobs, hero-less sides), every stat is app_config.dummy_hero_stat.
 */
export function commandingHeroStats(
  catalog: ReferenceCatalog | null | undefined,
  hero:
    | { class_id: number | null; current_level?: number }
    | null
    | undefined,
): HeroStats {
  if (!catalog || !hero) {
    const n = dummyHeroStat(catalog)
    return {
      speed: n,
      stamina: n,
      strength: n,
      intel: n,
      defense: n,
      resist: n,
      crit_pct: n,
      crit_amt: n,
    }
  }
  return heroEffectiveStats(
    catalog,
    hero.class_id,
    hero.current_level ?? 1,
  )
}

export function dummyArmyQty(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, Math.floor(appConfigNumber(catalog, 'dummy_army_qty', 16)))
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
  return buildingsInSlot(catalog, slotId, townTypeId).filter((row) => {
    if (isEmptyPlaceholder(row)) {
      return false
    }
    // Necropolis sets building.class_id; Grove (and similar) leave it null and
    // link the unit via unit.bldg_id instead.
    if (row.class_id != null) {
      return true
    }
    return unitForBuilding(catalog, row.id) != null
  })
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

/** Branch key for dwelling upgrades: building.class_id, else unit.class_id. */
function armyBranchKey(
  catalog: ReferenceCatalog,
  building: BuildingRow,
): number | null {
  if (building.class_id != null && building.class_id > 0) {
    return building.class_id
  }
  const unit = unitForBuilding(catalog, building.id)
  return unit?.class_id != null && unit.class_id > 0 ? unit.class_id : null
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
  const currentKey = armyBranchKey(catalog, current)
  const byBranch = group.find((row) => {
    if (row.level !== want) {
      return false
    }
    if (currentKey != null) {
      return armyBranchKey(catalog, row) === currentKey
    }
    return row.class_id === current.class_id
  })
  if (byBranch) {
    return byBranch
  }
  // Grove-style: Advanced X lists Basic X in requires.all when class_id is null.
  return (
    group.find(
      (row) =>
        row.level === want &&
        (row.requires ?? []).some(
          (clause) => 'all' in clause && clause.all.includes(current.id),
        ),
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

/** Hero class this unit belongs to — unit.class_id, else the dwelling's class. */
export function unitClassId(
  catalog: ReferenceCatalog,
  unit: UnitRow | null | undefined,
): number | null {
  if (!unit) {
    return null
  }
  if (unit.class_id != null && unit.class_id > 0) {
    return unit.class_id
  }
  const building = buildingById(catalog, unit.bldg_id)
  return building?.class_id != null && building.class_id > 0
    ? building.class_id
    : null
}

export function unitEffectiveTier(
  catalog: ReferenceCatalog,
  unit: UnitRow,
): number {
  return unitCreatureTier(catalog, unit)
}

function unitCreatureTier(
  catalog: ReferenceCatalog,
  unit: UnitRow,
): number {
  if (unit.tier != null && unit.tier > 0) {
    return unit.tier
  }
  const building = buildingById(catalog, unit.bldg_id)
  if (building?.tier != null && building.tier > 0) {
    return building.tier
  }
  if (building?.slot_num != null && isArmySlot(building.slot_num)) {
    return armyTier(building.slot_num)
  }
  return 99
}

/**
 * Rank-th base (non-Advanced) unit of a hero class branch.
 * rank 1 = lowest-tier, rank 2 = next tier of that same class.
 */
export function classBranchBaseUnit(
  catalog: ReferenceCatalog,
  classId: number | null | undefined,
  rank: number,
): UnitRow | null {
  if (classId == null || classId <= 0 || rank < 1) {
    return null
  }
  const byTier = new Map<number, UnitRow>()
  for (const unit of catalog.unit) {
    if (isAdvancedUnit(unit) || unitClassId(catalog, unit) !== classId) {
      continue
    }
    const tier = unitCreatureTier(catalog, unit)
    const existing = byTier.get(tier)
    if (!existing || unit.id < existing.id) {
      byTier.set(tier, unit)
    }
  }
  const ranked = [...byTier.entries()]
    .sort((a, b) => a[0] - b[0] || a[1].id - b[1].id)
    .map((entry) => entry[1])
  return ranked[rank - 1] ?? null
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

/** Dev toggle: always show full enemy inspect stats (independent of Expose). */
export function debugSeeEnemyStats(
  catalog: ReferenceCatalog | null | undefined,
): boolean {
  return appConfigNumber(catalog, 'debug_see_enemy_stats', 0) !== 0
}

/**
 * Post-turn battle log popup seconds.
 * 0 = skip popup; 99 = stay open until dismissed (no auto-advance).
 */
export function combatLogTimerSeconds(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, Math.floor(appConfigNumber(catalog, 'combat_log_timer', 2)))
}

/**
 * Post-combat results popup seconds.
 * 0 = skip popup; 99 = stay open until dismissed (no auto-advance).
 */
export function combatEndTimerSeconds(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(
    0,
    Math.floor(appConfigNumber(catalog, 'combat_end_timer', 99)),
  )
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
