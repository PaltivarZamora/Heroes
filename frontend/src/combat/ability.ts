import type { GameSession, Hero } from '../session/types'
import type {
  AbilityRow,
  AttackShapeKind,
  ReferenceCatalog,
  UnitCombatAbilities,
} from '../town/catalog'
import {
  DEFAULT_UNIT_ABILITIES,
  heroEffectiveStats,
  parseAttackShape,
  unitById,
  unitHasTag,
} from '../town/catalog'
import {
  addStatFlat,
  noteUnitDeaths,
  resortRemainingInitiative,
  stackMaxDmg,
  stackMaxHealth,
  type CombatBattle,
  type CombatMitigationPct,
  type CombatOutputMods,
  type CombatSide,
  type CombatStack,
  type CombatTile,
} from './battle'
import {
  applyStackDamage,
  applyStackHeal,
  applyStrike,
  heroForSide,
  mitigateIncoming,
  writeCombatStack,
  type CombatHeroes,
  type DmgKind,
  type HitFlashColor,
} from './attack'
import { occupancyKey, stackFootprint } from './occupancy'
import {
  boardKeys,
  geometricHexes,
  resolveShapeHits,
  type ShapeHit,
} from './shapes'
import { isCreatureArmyUnit, isUntargetableStack } from './siege'
import { stackOccupyingHex } from './movement'
import { applySummonFromStats, isRandomPlacementSummon, isSummonStats } from './summon'
import {
  applyBreaksOnDamage,
  tryInflictSpec,
} from './condition'
import type { Axial } from '../hex/hero'

export const ABILITY_TYPE_BUFF = 2
export const ABILITY_TYPE_DEBUFF = 3

const ENERGY_RESOURCE_ID = 1
const MANA_RESOURCE_ID = 2

const OUTPUT_KEY =
  /^(physical|magic)_dmg_(total|min|max)_(stat|flat)$/
const MITIGATION_KEY = /^unit_(defense|resistance)_pct_(stat|flat)$/
const ROLL_MIN_KEY = /^(physical|magic)_dmg_(total|min|max)_roll_min$/
const SPEED_DIV_KEY = /^speed_(buff|debuff)_stat_div$/

export type AbilityFlash = {
  keys: string[]
  color: HitFlashColor
}

export type AbilityResolve = {
  battle: CombatBattle
  log: { lines: string[]; holdTurn?: boolean }
  flashes: AbilityFlash[]
  applySession?: (session: GameSession) => GameSession
}

export type TargetGroup = 'friend' | 'enemy' | 'either'
export type TargetSpread = 'single' | 'aoe' | 'all'

export type ParsedTarget = {
  group: TargetGroup
  spread: TargetSpread
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function asFinite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function casterStat(
  catalog: ReferenceCatalog,
  caster: Hero,
  resourceId: number,
): number {
  const stats = heroEffectiveStats(
    catalog,
    caster.class_id,
    caster.current_level,
  )
  return resourceId === ENERGY_RESOURCE_ID ? stats.strength : stats.intel
}

function abilityKind(ability: AbilityRow): DmgKind {
  return ability.resource_id === ENERGY_RESOURCE_ID ? 'physical' : 'magic'
}

export function parseTarget(
  catalog: ReferenceCatalog,
  ability: AbilityRow,
): ParsedTarget {
  const row = catalog.ability_target.find((entry) => entry.id === ability.target_id)
  if (!row) {
    if (ability.ability_type_id === ABILITY_TYPE_BUFF) {
      return { group: 'friend', spread: 'all' }
    }
    return { group: 'enemy', spread: 'single' }
  }
  const text = row.value.trim().toLowerCase().replaceAll(' ', '_')
  const group: TargetGroup =
    text.startsWith('all_') ||
    text.startsWith('any_') ||
    text.includes('either')
      ? 'either'
      : text.includes('friend')
        ? 'friend'
        : text.includes('enemy')
          ? 'enemy'
          : 'either'
  const spread: TargetSpread = text.endsWith('_all')
    ? 'all'
    : text.includes('aoe')
      ? 'aoe'
      : 'single'
  return { group, spread }
}

export function abilityNeedsHexTarget(
  catalog: ReferenceCatalog,
  ability: AbilityRow,
): boolean {
  if (!ability.stats) {
    return false
  }
  if (isRandomPlacementSummon(ability.stats)) {
    return false
  }
  return parseTarget(catalog, ability).spread !== 'all'
}

function isChargeStats(stats: Record<string, unknown>): boolean {
  return stats.movement === 'max_distance'
}

function isInstantPulse(stats: Record<string, unknown>): boolean {
  return (
    stats.instant === true &&
    stats.guaranteed_max_dmg === true &&
    !isChargeStats(stats)
  )
}

function statDiv(stats: Record<string, unknown>, key: string): number | null {
  const div = asFinite(stats[key])
  if (div == null || div <= 0) {
    return null
  }
  return div
}

/** `_stat_div` = raw stat / div. Distinct from `_stat` multiply keys. */
function chargeCoefficient(
  stats: Record<string, unknown>,
  raw: number,
): number {
  const div =
    statDiv(stats, 'max_dmg_mult_stat_div') ??
    statDiv(stats, 'speed_bonus_stat_div') ??
    statDiv(stats, 'crit_pct_flat_stat_div') ??
    statDiv(stats, 'crit_amt_flat_stat_div')
  if (div == null) {
    return 0
  }
  return raw / div
}

/** Occupied hexes the player may click for this ability's `target_id`. */
export function abilityValidHexKeys(
  catalog: ReferenceCatalog,
  ability: AbilityRow,
  casterSide: CombatSide,
  battle: CombatBattle,
  tiles?: CombatTile[],
): string[] {
  const parsed = parseTarget(catalog, ability)
  if (parsed.spread === 'all') {
    return []
  }
  if (parsed.spread === 'aoe' && tiles && tiles.length > 0) {
    return tiles.map((tile) => occupancyKey(tile.q, tile.r))
  }
  const requiredTag = asFinite(asRecord(ability.stats)?.target_tag_required)
  const keys: string[] = []
  for (const stack of livingCreatures(battle, catalog)) {
    if (!matchesGroup(stack, casterSide, parsed.group)) {
      continue
    }
    if (
      requiredTag != null &&
      requiredTag > 0 &&
      !unitHasTag(unitById(catalog, stack.unitId), requiredTag)
    ) {
      continue
    }
    for (const hex of stackFootprint(stack, catalog)) {
      keys.push(occupancyKey(hex.q, hex.r))
    }
  }
  return keys
}

/**
 * Red overlay while aiming. Single = valid stacks. AoE = the shape around
 * the hovered hex (plus valid stacks so friends stay visible for `friend_*`).
 */
export function abilityAimImpactKeys(
  catalog: ReferenceCatalog,
  ability: AbilityRow,
  casterSide: CombatSide,
  battle: CombatBattle,
  tiles: CombatTile[],
  hover: Axial,
): string[] {
  const parsed = parseTarget(catalog, ability)
  const valid = abilityValidHexKeys(catalog, ability, casterSide, battle, tiles)
  const stats = asRecord(ability.stats)
  if (stats && isInstantPulse(stats) && shapeFromStats(stats) === 'pulse') {
    const occupant =
      stackOccupyingHex(battle.stacks, hover.q, hover.r, catalog) ??
      battle.stacks.find((row) => row.q === hover.q && row.r === hover.r) ??
      null
    if (
      occupant &&
      valid.includes(occupancyKey(occupant.q, occupant.r))
    ) {
      const spec = shapeSpecFromStats(stats, parsed.spread)
      const hexes = geometricHexes(
        spec,
        { q: occupant.q, r: occupant.r },
        { q: occupant.q, r: occupant.r },
        battle,
        boardKeys(tiles),
        occupant.side,
        tiles,
        catalog,
      )
      return [...new Set(hexes.map((hex) => occupancyKey(hex.q, hex.r)))]
    }
    return valid
  }
  if (parsed.spread !== 'aoe') {
    return valid
  }
  if (!stats) {
    return valid
  }
  const spec = shapeSpecFromStats(stats, parsed.spread)
  const hexes = geometricHexes(
    spec,
    hover,
    hover,
    battle,
    boardKeys(tiles),
    casterSide,
    tiles,
    catalog,
  )
  return [...new Set(hexes.map((hex) => occupancyKey(hex.q, hex.r)))]
}

function matchesGroup(
  stack: CombatStack,
  casterSide: CombatSide,
  group: TargetGroup,
): boolean {
  if (group === 'either') {
    return true
  }
  if (group === 'friend') {
    return stack.side === casterSide
  }
  return stack.side !== casterSide
}

function livingCreatures(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
): CombatStack[] {
  return battle.stacks.filter(
    (row) =>
      row.qty > 0 &&
      !row.indestructible &&
      isCreatureArmyUnit(unitById(catalog, row.unitId)) &&
      !isUntargetableStack(row, catalog),
  )
}

function shapeFromStats(stats: Record<string, unknown>): AttackShapeKind {
  const raw = stats.shape
  if (typeof raw !== 'string' || !raw.trim()) {
    return 'single'
  }
  return parseAttackShape(raw)
}

function shapeSpecFromStats(
  stats: Record<string, unknown>,
  spread?: TargetSpread,
): UnitCombatAbilities {
  const shape = shapeFromStats(stats)
  const aoeWholeField = spread === 'aoe' && shape === 'single'
  return {
    ...DEFAULT_UNIT_ABILITIES,
    shape: aoeWholeField ? 'aoe' : shape,
    radius: Math.max(
      1,
      Math.floor(asFinite(stats.radius) ?? (aoeWholeField ? 99 : 1)),
    ),
  }
}

function dummyCaster(
  side: CombatSide,
  hex: Axial,
): CombatStack {
  return {
    id: 'hero-cast',
    side,
    slot: 0,
    unitId: 0,
    qty: 1,
    topHealth: 1,
    startingQty: 1,
    q: hex.q,
    r: hex.r,
    hasActedThisRound: false,
    retaliationsLeft: 0,
  }
}

function collectTargets(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  casterSide: CombatSide,
  _ability: AbilityRow,
  stats: Record<string, unknown>,
  aim: { targetId: string | null; hex: Axial },
  group: TargetGroup,
  spread: TargetSpread,
): CombatStack[] {
  const requiredTag = asFinite(stats.target_tag_required)
  const living = livingCreatures(battle, catalog).filter((row) => {
    if (!matchesGroup(row, casterSide, group)) {
      return false
    }
    if (
      requiredTag != null &&
      requiredTag > 0 &&
      !unitHasTag(unitById(catalog, row.unitId), requiredTag)
    ) {
      return false
    }
    return true
  })
  if (spread === 'all') {
    return living
  }
  const aimed =
    (aim.targetId
      ? battle.stacks.find((row) => row.id === aim.targetId)
      : null) ??
    stackOccupyingHex(battle.stacks, aim.hex.q, aim.hex.r, catalog) ??
    battle.stacks.find((row) => row.q === aim.hex.q && row.r === aim.hex.r) ??
    null
  if (spread === 'single') {
    if (
      aimed &&
      aimed.qty > 0 &&
      matchesGroup(aimed, casterSide, group) &&
      !aimed.indestructible &&
      !isUntargetableStack(aimed, catalog)
    ) {
      return [aimed]
    }
    return []
  }
  const shape = shapeFromStats(stats)
  const spec = shapeSpecFromStats(stats, spread)
  const origin = dummyCaster(casterSide, aim.hex)
  if (shape === 'chain' || shape === 'multi' || shape === 'rain') {
    const hits = resolveShapeHits(
      origin,
      aim.hex,
      aimed,
      battle,
      catalog,
      tiles,
      Math.random,
    )
    return uniqueStacks(hits, living)
  }
  const hexes = geometricHexes(
    spec,
    { q: origin.q, r: origin.r },
    aim.hex,
    battle,
    boardKeys(tiles),
    casterSide,
    tiles,
    catalog,
  )
  const hits: CombatStack[] = []
  const seen = new Set<string>()
  for (const hex of hexes) {
    const stack =
      stackOccupyingHex(battle.stacks, hex.q, hex.r, catalog) ??
      battle.stacks.find((row) => row.q === hex.q && row.r === hex.r) ??
      null
    if (
      !stack ||
      seen.has(stack.id) ||
      !living.some((row) => row.id === stack.id)
    ) {
      continue
    }
    seen.add(stack.id)
    hits.push(stack)
  }
  return hits
}

function pulseEnemyStacks(
  source: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  stats: Record<string, unknown>,
): CombatStack[] {
  const spec = shapeSpecFromStats(stats)
  const hexes = geometricHexes(
    spec,
    { q: source.q, r: source.r },
    { q: source.q, r: source.r },
    battle,
    boardKeys(tiles),
    source.side,
    tiles,
    catalog,
  )
  const living = new Set(
    livingCreatures(battle, catalog)
      .filter((row) => row.side !== source.side)
      .map((row) => row.id),
  )
  const hits: CombatStack[] = []
  const seen = new Set<string>()
  for (const hex of hexes) {
    const stack =
      stackOccupyingHex(battle.stacks, hex.q, hex.r, catalog) ??
      battle.stacks.find((row) => row.q === hex.q && row.r === hex.r) ??
      null
    if (
      !stack ||
      stack.id === source.id ||
      seen.has(stack.id) ||
      !living.has(stack.id)
    ) {
      continue
    }
    seen.add(stack.id)
    hits.push(stack)
  }
  return hits
}

function uniqueStacks(
  hits: ShapeHit[],
  allowed: CombatStack[],
): CombatStack[] {
  const allow = new Set(allowed.map((row) => row.id))
  const out: CombatStack[] = []
  const seen = new Set<string>()
  for (const hit of hits) {
    const stack = hit.stack
    if (!stack || seen.has(stack.id) || !allow.has(stack.id)) {
      continue
    }
    seen.add(stack.id)
    out.push(stack)
  }
  return out
}

function rawAbilityDamage(
  stats: Record<string, unknown>,
  catalog: ReferenceCatalog,
  caster: Hero,
): number | null {
  const flat = asFinite(stats.flat_dmg)
  if (flat != null) {
    return Math.max(0, Math.floor(flat))
  }
  const str = asFinite(stats.str_dmg)
  if (str != null) {
    const n = Math.floor(str * casterStat(catalog, caster, ENERGY_RESOURCE_ID))
    return Math.max(0, n)
  }
  const intel = asFinite(stats.int_dmg)
  if (intel != null) {
    const n = Math.floor(intel * casterStat(catalog, caster, MANA_RESOURCE_ID))
    return Math.max(0, n)
  }
  return null
}

function emptyOutput(): CombatOutputMods {
  return {
    physicalTotal: 0,
    magicTotal: 0,
    physicalMin: 0,
    magicMin: 0,
    physicalMax: 0,
    magicMax: 0,
  }
}

function emptyMitigation(): CombatMitigationPct {
  return { defense: 0, resistance: 0 }
}

function addOutput(
  current: CombatOutputMods | undefined,
  patch: Partial<CombatOutputMods>,
): CombatOutputMods {
  const next = { ...(current ?? emptyOutput()) }
  for (const key of Object.keys(patch) as (keyof CombatOutputMods)[]) {
    const extra = patch[key]
    if (extra) {
      next[key] += extra
    }
  }
  return next
}

function addMitigation(
  current: CombatMitigationPct | undefined,
  patch: Partial<CombatMitigationPct>,
): CombatMitigationPct {
  const next = { ...(current ?? emptyMitigation()) }
  if (patch.defense) {
    next.defense += patch.defense
  }
  if (patch.resistance) {
    next.resistance += patch.resistance
  }
  return next
}

function signedMagnitude(
  ability: AbilityRow,
  n: number,
): number {
  const mag = Math.abs(n)
  if (ability.ability_type_id === ABILITY_TYPE_DEBUFF) {
    return -mag
  }
  return mag
}

function scaledN(
  stats: Record<string, unknown>,
  key: string,
  catalog: ReferenceCatalog,
  caster: Hero,
  ability: AbilityRow,
  mode: 'stat' | 'flat',
): number | null {
  const n = asFinite(stats[key])
  if (n == null) {
    return null
  }
  const mag = mode === 'stat' ? n * casterStat(catalog, caster, ability.resource_id) : n
  return signedMagnitude(ability, mag)
}

function applyOutputAndMitigationKeys(
  stats: Record<string, unknown>,
  ability: AbilityRow,
  catalog: ReferenceCatalog,
  caster: Hero,
  target: CombatStack,
): { stack: CombatStack; notes: string[] } {
  let stack = target
  const notes: string[] = []
  for (const key of Object.keys(stats)) {
    const output = OUTPUT_KEY.exec(key)
    if (output) {
      const kind = output[1] as 'physical' | 'magic'
      const part = output[2] as 'total' | 'min' | 'max'
      const mode = output[3] as 'stat' | 'flat'
      const signed = scaledN(stats, key, catalog, caster, ability, mode)
      if (signed == null || signed === 0) {
        continue
      }
      const field =
        kind === 'magic'
          ? part === 'min'
            ? 'magicMin'
            : part === 'max'
              ? 'magicMax'
              : 'magicTotal'
          : part === 'min'
            ? 'physicalMin'
            : part === 'max'
              ? 'physicalMax'
              : 'physicalTotal'
      stack = {
        ...stack,
        outputMods: addOutput(stack.outputMods, { [field]: signed }),
      }
      const word = signed < 0 ? 'debuff' : 'buff'
      notes.push(
        `${stackName(catalog, target)} ${word}: ${kind} ${part} ${signed}%`,
      )
      continue
    }
    const mit = MITIGATION_KEY.exec(key)
    if (mit) {
      const stat = mit[1] as 'defense' | 'resistance'
      const mode = mit[2] as 'stat' | 'flat'
      const signed = scaledN(stats, key, catalog, caster, ability, mode)
      if (signed == null || signed === 0) {
        continue
      }
      const pct = signed
      stack = {
        ...stack,
        mitigationPct: addMitigation(stack.mitigationPct, { [stat]: pct }),
      }
      notes.push(
        `${stackName(catalog, target)} ${pct < 0 ? 'debuff' : 'buff'}: ${pct}% unit ${stat}`,
      )
    }
  }
  return { stack, notes }
}

function stackName(catalog: ReferenceCatalog, stack: CombatStack): string {
  return unitById(catalog, stack.unitId)?.name ?? 'Unknown'
}

function outputField(
  kind: 'physical' | 'magic',
  part: 'total' | 'min' | 'max',
): keyof CombatOutputMods {
  if (kind === 'magic') {
    return part === 'min' ? 'magicMin' : part === 'max' ? 'magicMax' : 'magicTotal'
  }
  return part === 'min' ? 'physicalMin' : part === 'max' ? 'physicalMax' : 'physicalTotal'
}

function applyRollAndSpeedKeys(
  stats: Record<string, unknown>,
  ability: AbilityRow,
  catalog: ReferenceCatalog,
  caster: Hero,
  target: CombatStack,
  random: () => number,
): { stack: CombatStack; notes: string[] } {
  let stack = target
  const notes: string[] = []
  const intel = casterStat(catalog, caster, MANA_RESOURCE_ID)
  for (const key of Object.keys(stats)) {
    const rollMin = ROLL_MIN_KEY.exec(key)
    if (rollMin) {
      const kind = rollMin[1] as 'physical' | 'magic'
      const part = rollMin[2] as 'total' | 'min' | 'max'
      const maxKey = `${kind}_dmg_${part}_roll_max_stat`
      const lo = Math.floor(asFinite(stats[key]) ?? 1)
      const hi = Math.floor((asFinite(stats[maxKey]) ?? lo) + intel)
      const span = Math.max(0, hi - lo)
      const rolled = lo + Math.floor(random() * (span + 1))
      const signed = signedMagnitude(ability, rolled)
      if (signed === 0) {
        continue
      }
      const field = outputField(kind, part)
      stack = {
        ...stack,
        outputMods: addOutput(stack.outputMods, { [field]: signed }),
      }
      notes.push(
        `${stackName(catalog, target)} ${signed < 0 ? 'debuff' : 'buff'}: ${kind} ${part} ${signed}% (rolled)`,
      )
      continue
    }
    const speedDiv = SPEED_DIV_KEY.exec(key)
    if (speedDiv) {
      const div = asFinite(stats[key])
      if (div == null || div <= 0) {
        continue
      }
      const scale = casterStat(catalog, caster, ability.resource_id)
      const amt = Math.max(0, Math.floor(scale / div))
      if (amt === 0) {
        continue
      }
      const signed = speedDiv[1] === 'debuff' ? -amt : amt
      const uses = Math.max(0, Math.floor(asFinite(stats.uses) ?? 0))
      if (uses > 0) {
        stack = {
          ...stack,
          speedUses: { amount: signed, usesLeft: uses },
        }
        notes.push(
          `${stackName(catalog, target)} speed ${signed > 0 ? '+' : ''}${signed} (${uses} use${uses === 1 ? '' : 's'})`,
        )
      } else {
        stack = { ...stack, speedMod: (stack.speedMod ?? 0) + signed }
        notes.push(
          `${stackName(catalog, target)} speed ${signed > 0 ? '+' : ''}${signed}`,
        )
      }
    }
  }
  return { stack, notes }
}

function applyDeltaAllStats(
  stats: Record<string, unknown>,
  catalog: ReferenceCatalog,
  caster: Hero,
  casterSide: CombatSide,
  target: CombatStack,
): { stack: CombatStack; notes: string[] } {
  if (stats.direction_by_target_side !== true) {
    return { stack: target, notes: [] }
  }
  const factor = asFinite(stats.delta_all_stats_stat)
  if (factor == null) {
    return { stack: target, notes: [] }
  }
  const intel = casterStat(catalog, caster, MANA_RESOURCE_ID)
  const mag = Math.max(0, Math.floor(intel * factor))
  if (mag === 0) {
    return { stack: target, notes: [] }
  }
  const signed = target.side === casterSide ? mag : -mag
  return {
    stack: { ...target, statFlat: addStatFlat(target.statFlat, signed) },
    notes: [
      `${stackName(catalog, target)} ${signed > 0 ? 'buff' : 'debuff'}: ${signed > 0 ? '+' : ''}${signed} speed, defense, resistance, min/max dmg, max range, and max HP`,
    ],
  }
}

const STR_OVER_BASE = 10

/** Default: max(0, stat-10). `no_stat_threshold` is a per-ability exception. */
function scaledCasterStat(
  catalog: ReferenceCatalog,
  caster: Hero,
  ability: AbilityRow,
  stats: Record<string, unknown>,
): number {
  const raw = casterStat(catalog, caster, ability.resource_id)
  if (stats.no_stat_threshold === true) {
    return Math.max(0, raw)
  }
  return Math.max(0, raw - STR_OVER_BASE)
}

function formatStatBonus(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
}

function applyCritBonuses(
  stats: Record<string, unknown>,
  catalog: ReferenceCatalog,
  caster: Hero,
  ability: AbilityRow,
  target: CombatStack,
): { stack: CombatStack; notes: string[] } {
  const pctStat = asFinite(stats.crit_pct_flat_stat)
  const amtStat = asFinite(stats.crit_amt_flat_stat)
  if (pctStat == null && amtStat == null) {
    return { stack: target, notes: [] }
  }
  const base = scaledCasterStat(catalog, caster, ability, stats)
  const pctBonus = pctStat != null ? base * pctStat : 0
  const amtBonus = amtStat != null ? base * amtStat : 0
  const minBonus = asFinite(stats.min_crit_bonus_dmg)
  if (pctBonus === 0 && amtBonus === 0 && minBonus == null) {
    return { stack: target, notes: [] }
  }
  const notes: string[] = []
  let stack: CombatStack = {
    ...target,
    critPctBonus: (target.critPctBonus ?? 0) + pctBonus,
    critAmtBonus: (target.critAmtBonus ?? 0) + amtBonus,
  }
  if (minBonus != null) {
    stack = {
      ...stack,
      minCritBonusDmg: Math.max(stack.minCritBonusDmg ?? 1, minBonus),
    }
  }
  if (pctBonus !== 0) {
    notes.push(
      `${stackName(catalog, target)} buff: +${formatStatBonus(pctBonus)}% crit chance`,
    )
  }
  if (amtBonus !== 0) {
    notes.push(
      `${stackName(catalog, target)} buff: +${formatStatBonus(amtBonus)}% crit damage`,
    )
  }
  return { stack, notes }
}

function applyChargeRush(
  stats: Record<string, unknown>,
  catalog: ReferenceCatalog,
  caster: Hero,
  ability: AbilityRow,
  target: CombatStack,
  actingId: string | undefined,
): { stack: CombatStack; notes: string[] } {
  if (!isChargeStats(stats)) {
    return { stack: target, notes: [] }
  }
  const uses = Math.max(1, Math.floor(asFinite(stats.uses) ?? 1))
  const raw = scaledCasterStat(catalog, caster, ability, stats)
  const coefficient = chargeCoefficient(stats, raw)
  if (coefficient <= 0) {
    return { stack: target, notes: [] }
  }
  const now =
    actingId === target.id && target.hasActedThisRound !== true
  return {
    stack: {
      ...target,
      chargeRush: {
        usesLeft: uses,
        coefficient,
        guaranteedHit: stats.guaranteed_hit === true,
        guaranteedMaxDmg: stats.guaranteed_max_dmg === true,
      },
    },
    notes: [
      now
        ? `${stackName(catalog, target)} Furious Rush this turn (×${formatStatBonus(coefficient)})`
        : `${stackName(catalog, target)} Furious Rush on next turn (×${formatStatBonus(coefficient)})`,
    ],
  }
}

function applyPrecisionTraits(
  stats: Record<string, unknown>,
  catalog: ReferenceCatalog,
  caster: Hero,
  ability: AbilityRow,
  target: CombatStack,
): { stack: CombatStack; notes: string[] } {
  let stack = target
  const notes: string[] = []
  if (stats.disable_min_range_penalty === true) {
    stack = { ...stack, ignoreMinRangePenalty: true }
    notes.push(`${stackName(catalog, target)} ignores min-range penalty`)
  }
  if (stats.guarantees_miss_next_physical_hit === true) {
    const uses = Math.max(1, Math.floor(asFinite(stats.uses) ?? 1))
    stack = {
      ...stack,
      parryPhysicalUses: (stack.parryPhysicalUses ?? 0) + uses,
      parryIgnoresRetaliation:
        stats.ignores_retaliation === true || stack.parryIgnoresRetaliation,
    }
    notes.push(
      `${stackName(catalog, target)} will parry the next physical hit`,
    )
  }
  const barrage = asFinite(stats.grants_second_attack_pct)
  if (barrage != null && barrage > 0) {
    const raw = scaledCasterStat(catalog, caster, ability, stats)
    const flat = asFinite(stats.second_attack_pct_flat_stat) ?? 0
    const pct = Math.max(0, Math.floor(barrage + raw * flat))
    const usesDiv = statDiv(stats, 'uses_stat_div')
    const uses =
      usesDiv != null
        ? Math.floor(casterStat(catalog, caster, ability.resource_id) / usesDiv)
        : null
    if (pct > 0 && (uses == null || uses > 0)) {
      stack = {
        ...stack,
        barragePct: pct,
        barrageUsesLeft: uses ?? undefined,
      }
      notes.push(
        uses != null
          ? `${stackName(catalog, target)} barrage: second attack at ${pct}% (${uses} this battle)`
          : `${stackName(catalog, target)} barrage: second attack at ${pct}%`,
      )
    }
  }
  const evadePct = asFinite(stats.evasion_pct)
  const durationDiv = statDiv(stats, 'duration_stat_div')
  if (evadePct != null && evadePct > 0 && durationDiv != null) {
    const rounds = Math.floor(
      casterStat(catalog, caster, ability.resource_id) / durationDiv,
    )
    if (rounds > 0) {
      stack = { ...stack, evasion: { pct: evadePct, roundsLeft: rounds } }
      notes.push(
        `${stackName(catalog, target)} camouflaged (${Math.floor(evadePct)}% evade, ${rounds} round${rounds === 1 ? '' : 's'})`,
      )
    }
  }
  if (stats.forces_max_dmg_on_target === true) {
    const hitDiv = statDiv(stats, 'hit_count_stat_div')
    if (hitDiv != null) {
      const hits = Math.floor(
        casterStat(catalog, caster, ability.resource_id) / hitDiv,
      )
      if (hits > 0) {
        stack = { ...stack, markHitsLeft: hits }
        notes.push(
          `${stackName(catalog, target)} marked (${hits} max-dmg hit${hits === 1 ? '' : 's'})`,
        )
      }
    }
  }
  return { stack, notes }
}

function applyStrengthSwing(
  stats: Record<string, unknown>,
  catalog: ReferenceCatalog,
  caster: Hero,
  target: CombatStack,
): { stack: CombatStack; notes: string[] } {
  const dmgStat = asFinite(stats.dmg_buff_pct_stat)
  const defStat = asFinite(stats.def_debuff_pct_stat)
  if (dmgStat == null && defStat == null) {
    return { stack: target, notes: [] }
  }
  const strength = heroEffectiveStats(
    catalog,
    caster.class_id,
    caster.current_level,
  ).strength
  const over = Math.max(0, strength - STR_OVER_BASE)
  let stack = target
  const notes: string[] = []
  if (dmgStat != null) {
    const pct = Math.max(0, Math.floor(over * dmgStat))
    if (pct > 0) {
      stack = {
        ...stack,
        outputMods: addOutput(stack.outputMods, {
          physicalTotal: pct,
          magicTotal: pct,
        }),
      }
      notes.push(`${stackName(catalog, target)} buff: +${pct}% damage`)
    }
  }
  if (defStat != null) {
    const cut = Math.max(0, Math.floor(over * defStat))
    const floor = Math.max(0, Math.floor(asFinite(stats.def_floor) ?? 0))
    if (cut > 0 || floor > 0) {
      stack = {
        ...stack,
        defensePct: (stack.defensePct ?? 0) - cut,
        defenseFloor: Math.max(stack.defenseFloor ?? 0, floor),
      }
      notes.push(
        `${stackName(catalog, target)} debuff: -${cut}% defense (floor ${floor})`,
      )
    }
  }
  return { stack, notes }
}

function hasEffectKeys(stats: Record<string, unknown>): boolean {
  if (asRecord(stats.enemy_effect) || asRecord(stats.ally_effect)) {
    return true
  }
  if (
    stats.flat_dmg != null ||
    stats.str_dmg != null ||
    stats.int_dmg != null ||
    stats.drain_heal === true ||
    stats.vampiric_strike === true ||
    stats.revive_on_dmg_dealt === true ||
    stats.inflicts_condition != null ||
    stats.grants_extra_turn === true ||
    stats.grants_kill_on_overflow === true ||
    stats.set_defense != null ||
    stats.max_dmg_mult != null ||
    stats.min_dmg_mult != null ||
    stats.dmg_buff_pct_stat != null ||
    stats.def_debuff_pct_stat != null ||
    stats.crit_pct_flat_stat != null ||
    stats.crit_amt_flat_stat != null ||
    stats.guaranteed_max_dmg === true ||
    stats.guaranteed_hit === true ||
    stats.movement != null ||
    stats.disable_min_range_penalty === true ||
    stats.guarantees_miss_next_physical_hit === true ||
    stats.grants_second_attack_pct != null ||
    stats.instant === true ||
    stats.evasion_pct != null ||
    stats.forces_max_dmg_on_target === true ||
    stats.delta_all_stats_stat != null ||
    stats.direction_by_target_side === true ||
    isSummonStats(stats)
  ) {
    return true
  }
  return Object.keys(stats).some(
    (key) =>
      OUTPUT_KEY.test(key) ||
      MITIGATION_KEY.test(key) ||
      ROLL_MIN_KEY.test(key) ||
      SPEED_DIV_KEY.test(key),
  )
}

function applyHealPool(
  stacks: CombatStack[],
  pool: number,
  catalog: ReferenceCatalog,
  targets: CombatStack[],
): { stacks: CombatStack[]; healed: number; notes: string[] } {
  let remaining = Math.max(0, Math.floor(pool))
  let healedTotal = 0
  const notes: string[] = []
  const ordered = [...targets]
    .filter((row) => row.qty > 0)
    .sort((a, b) => {
      const ha = stackMaxHealth(a, catalog)
      const hb = stackMaxHealth(b, catalog)
      if (ha !== hb) {
        return ha - hb
      }
      return a.id.localeCompare(b.id)
    })
  let nextStacks = stacks
  for (const target of ordered) {
    if (remaining <= 0) {
      break
    }
    const live = nextStacks.find((row) => row.id === target.id)
    if (!live || live.qty <= 0) {
      continue
    }
    const full = stackMaxHealth(live, catalog)
    const applied = applyStackHeal(live, remaining, full)
    remaining -= applied.healed
    healedTotal += applied.healed
    nextStacks = writeCombatStack(nextStacks, live.id, applied.stack)
    if (applied.healed > 0) {
      notes.push(
        `${stackName(catalog, live)} healed for ${applied.healed} (${applied.stack.topHealth}/${full}).`,
      )
    }
  }
  return { stacks: nextStacks, healed: healedTotal, notes }
}

function applyOneEffect(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  ability: AbilityRow,
  stats: Record<string, unknown>,
  caster: Hero,
  casterSide: CombatSide,
  heroes: CombatHeroes,
  targets: CombatStack[],
  healPool: number,
  random: () => number,
  tiles: CombatTile[],
): {
  battle: CombatBattle
  dealt: number
  flashes: AbilityFlash[]
  lines: string[]
} {
  let stacks = battle.stacks
  let dealt = 0
  const lines: string[] = []
  const flashes: AbilityFlash[] = []
  const liveTargets = () =>
    targets
      .map((row) => stacks.find((s) => s.id === row.id))
      .filter((row): row is CombatStack => row != null && row.qty > 0)

  const hitOne = (target: CombatStack, raw: number) => {
    const evadePct = target.evasion?.pct ?? 0
    if (evadePct > 0 && random() * 100 < evadePct) {
      lines.push(
        `${ability.name} missed ${stackName(catalog, target)} (camouflage).`,
      )
      return ''
    }
    const kind = abilityKind(ability)
    const overflow = stats.kill_on_overflow === true
    const defender = heroForSide(target.side, heroes)
    const mit = mitigateIncoming(raw, target, catalog, kind, defender)
    const full = stackMaxHealth(target, catalog)
    const applied = applyStackDamage(target, mit.damage, full, overflow)
    dealt += mit.damage
    let nextStack = applied.stack
    if (nextStack && mit.damage > 0) {
      const broken = applyBreaksOnDamage(nextStack, catalog)
      nextStack = broken.stack
      lines.push(...broken.lines)
    }
    stacks = writeCombatStack(stacks, target.id, nextStack)
    if (applied.killed > 0) {
      battle = noteUnitDeaths(battle, target.unitId, applied.killed)
    }
    const block =
      mit.blockBy && mit.blocked > 0
        ? ` (${mit.blocked} blocked by ${mit.blockBy})`
        : ''
    const died =
      applied.killed > 0
        ? ` and ${applied.killed} ${stackName(catalog, target)} died`
        : ''
    lines.push(
      `${ability.name} hit ${target.qty} ${stackName(catalog, target)} for ${mit.damage} dmg${block}${died}.`,
    )
    return occupancyKey(target.q, target.r)
  }

  const raw = rawAbilityDamage(stats, catalog, caster)
  if (raw != null) {
    const keys: string[] = []
    const shape = shapeFromStats(stats)
    if (shape === 'multi') {
      const bolts = Math.max(
        1,
        Math.floor(asFinite(stats.bolts) ?? asFinite(stats.targets) ?? 1),
      )
      for (let i = 0; i < bolts; i += 1) {
        const pool = liveTargets()
        if (pool.length === 0) {
          break
        }
        const pick =
          pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
        if (!pick) {
          break
        }
        const key = hitOne(pick, raw)
        if (key) {
          keys.push(key)
        }
      }
    } else {
      for (const target of liveTargets()) {
        const key = hitOne(target, raw)
        if (key) {
          keys.push(key)
        }
      }
    }
    if (keys.length > 0) {
      flashes.push({ keys, color: 'red' })
    }
  } else if (isInstantPulse(stats)) {
    const keys: string[] = []
    for (const source of liveTargets()) {
      const liveSource = stacks.find((row) => row.id === source.id)
      if (!liveSource || liveSource.qty <= 0) {
        continue
      }
      const victims = pulseEnemyStacks(
        liveSource,
        { ...battle, stacks },
        catalog,
        tiles,
        stats,
      )
      if (victims.length === 0) {
        lines.push(
          `${ability.name}: ${stackName(catalog, liveSource)} pulses — no adjacent enemies.`,
        )
        continue
      }
      for (const victim of victims) {
        const striker = stacks.find((row) => row.id === liveSource.id)
        const target = stacks.find((row) => row.id === victim.id)
        if (!striker || striker.qty <= 0 || !target || target.qty <= 0) {
          continue
        }
        const struck = applyStrike(
          striker,
          target,
          catalog,
          random,
          'max',
          false,
          heroForSide(target.side, heroes),
          heroForSide(striker.side, heroes),
        )
        dealt += struck.damage
        let nextStack = struck.stack
        if (nextStack && struck.damage > 0) {
          const broken = applyBreaksOnDamage(nextStack, catalog)
          nextStack = broken.stack
          lines.push(...broken.lines)
        }
        stacks = writeCombatStack(stacks, target.id, nextStack)
        if (struck.killed > 0) {
          battle = noteUnitDeaths(battle, target.unitId, struck.killed)
        }
        const notes: string[] = []
        if (struck.parried) {
          notes.push('parried')
        }
        if (struck.missed) {
          notes.push('missed')
        }
        if (struck.crits > 0) {
          notes.push(struck.crits === 1 ? 'crit' : `${struck.crits} crits`)
        }
        const block =
          struck.blockBy && struck.blocked > 0
            ? `${struck.blocked} blocked by ${struck.blockBy}`
            : ''
        if (block) {
          notes.push(block)
        }
        const extra = notes.length > 0 ? ` (${notes.join(', ')})` : ''
        const died =
          struck.killed > 0
            ? ` and ${struck.killed} ${stackName(catalog, target)} died`
            : ''
        lines.push(
          `${ability.name}: ${striker.qty} ${stackName(catalog, striker)} hit ${target.qty} ${stackName(catalog, target)} for ${struck.damage} dmg${extra}${died}.`,
        )
        if (struck.damage > 0 || struck.parried || struck.missed) {
          keys.push(occupancyKey(target.q, target.r))
        }
      }
    }
    if (keys.length > 0) {
      flashes.push({ keys, color: 'red' })
    }
  } else if (
    stats.guaranteed_max_dmg === true &&
    !isChargeStats(stats) &&
    stats.instant !== true
  ) {
    const actor = stacks.find(
      (row) => row.id === battle.order[battle.activeIndex],
    )
    if (actor && actor.qty > 0) {
      const per = stackMaxDmg(actor, catalog)
      const rawMax = Math.max(0, per * actor.qty)
      const keys: string[] = []
      for (const target of liveTargets()) {
        const key = hitOne(target, rawMax)
        if (key) {
          keys.push(key)
        }
      }
      if (keys.length > 0) {
        flashes.push({ keys, color: 'red' })
      }
    }
  }

  const afterDamage = liveTargets()
  let buffKeys: string[] = []
  let debuffKeys: string[] = []
  for (const target of afterDamage) {
    const live = stacks.find((row) => row.id === target.id)
    if (!live) {
      continue
    }
    const next = applyOutputAndMitigationKeys(
      stats,
      ability,
      catalog,
      caster,
      live,
    )
    const rolled = applyRollAndSpeedKeys(
      stats,
      ability,
      catalog,
      caster,
      next.stack,
      random,
    )
    const mutated = applyDeltaAllStats(
      stats,
      catalog,
      caster,
      casterSide,
      rolled.stack,
    )
    const swung = applyStrengthSwing(stats, catalog, caster, mutated.stack)
    const critted = applyCritBonuses(
      stats,
      catalog,
      caster,
      ability,
      swung.stack,
    )
    const rushed = applyChargeRush(
      stats,
      catalog,
      caster,
      ability,
      critted.stack,
      battle.order[battle.activeIndex],
    )
    const traits = applyPrecisionTraits(
      stats,
      catalog,
      caster,
      ability,
      rushed.stack,
    )
    const notes = [
      ...next.notes,
      ...rolled.notes,
      ...mutated.notes,
      ...swung.notes,
      ...critted.notes,
      ...rushed.notes,
      ...traits.notes,
    ]
    if (notes.length === 0) {
      continue
    }
    stacks = writeCombatStack(stacks, live.id, traits.stack)
    lines.push(...notes.map((note) => `${ability.name}: ${note}.`))
    const key = occupancyKey(live.q, live.r)
    if (ability.ability_type_id === ABILITY_TYPE_DEBUFF) {
      debuffKeys.push(key)
    } else if (ability.ability_type_id === ABILITY_TYPE_BUFF) {
      buffKeys.push(key)
    } else if (stats.direction_by_target_side === true) {
      if (live.side === casterSide) {
        buffKeys.push(key)
      } else {
        debuffKeys.push(key)
      }
    } else if (
      Object.keys(stats).some(
        (entry) => OUTPUT_KEY.test(entry) || ROLL_MIN_KEY.test(entry),
      )
    ) {
      debuffKeys.push(key)
    } else {
      buffKeys.push(key)
    }
  }

  const conditionId = Math.floor(asFinite(stats.inflicts_condition) ?? 0)
  if (conditionId > 0) {
    for (const target of liveTargets()) {
      const live = stacks.find((row) => row.id === target.id)
      if (!live) {
        continue
      }
      const inflicted = tryInflictSpec(
        live,
        catalog,
        {
          conditionId,
          resistStat:
            typeof stats.resist_stat === 'string' &&
            (stats.resist_stat === 'resistance' || stats.resist_stat === 'defense')
              ? stats.resist_stat
              : null,
          duration: Math.max(1, Math.floor(asFinite(stats.duration) ?? 1)),
          requiredTag: asFinite(stats.target_tag_required),
          extra: {
            roundTick: true,
            breaksOnDamage: stats.breaks_on_damage === true,
            breakChancePctStat: asFinite(stats.break_chance_pct_stat) ?? undefined,
          },
        },
        random,
      )
      stacks = writeCombatStack(stacks, live.id, inflicted.stack)
      lines.push(...inflicted.lines)
      if (inflicted.lines.some((line) => line.includes('afflicted'))) {
        debuffKeys.push(occupancyKey(live.q, live.r))
      }
    }
  }

  if (stats.grants_extra_turn === true) {
    for (const target of liveTargets()) {
      const live = stacks.find((row) => row.id === target.id)
      if (!live || live.qty <= 0) {
        continue
      }
      const alreadyActed = live.hasActedThisRound
      stacks = writeCombatStack(stacks, live.id, {
        ...live,
        hasActedThisRound: alreadyActed ? false : live.hasActedThisRound,
        extraTurnThisRound: alreadyActed ? false : true,
      })
      lines.push(
        alreadyActed
          ? `${ability.name}: ${stackName(catalog, live)} act again now.`
          : `${ability.name}: ${stackName(catalog, live)} will take an extra turn.`,
      )
      buffKeys.push(occupancyKey(live.q, live.r))
    }
  }

  if (stats.vampiric_strike === true || stats.revive_on_dmg_dealt === true) {
    for (const target of liveTargets()) {
      const live = stacks.find((row) => row.id === target.id)
      if (!live || live.qty <= 0) {
        continue
      }
      stacks = writeCombatStack(stacks, live.id, {
        ...live,
        vampiricStrike: true,
      })
      lines.push(
        `${ability.name}: ${stackName(catalog, live)} will revive from damage dealt.`,
      )
      buffKeys.push(occupancyKey(live.q, live.r))
    }
  }

  const setDefense = asFinite(stats.set_defense)
  const maxDmgMult = asFinite(stats.max_dmg_mult)
  const minDmgMult = asFinite(stats.min_dmg_mult)
  if (
    setDefense != null ||
    (maxDmgMult != null && maxDmgMult > 0) ||
    (minDmgMult != null && minDmgMult > 0)
  ) {
    for (const target of liveTargets()) {
      const live = stacks.find((row) => row.id === target.id)
      if (!live || live.qty <= 0) {
        continue
      }
      const next: CombatStack = { ...live }
      const bits: string[] = []
      if (minDmgMult != null && minDmgMult > 0) {
        next.minDmgMult = minDmgMult
        bits.push(`min damage ×${minDmgMult}`)
      }
      if (maxDmgMult != null && maxDmgMult > 0) {
        next.maxDmgMult = maxDmgMult
        bits.push(`max damage ×${maxDmgMult}`)
      }
      if (setDefense != null) {
        next.defenseSet = Math.max(0, Math.floor(setDefense))
        bits.push(`defense ${next.defenseSet}`)
      }
      stacks = writeCombatStack(stacks, live.id, next)
      lines.push(
        `${ability.name}: ${stackName(catalog, live)} ${bits.join(', ')}.`,
      )
      buffKeys.push(occupancyKey(live.q, live.r))
    }
  }

  if (stats.grants_kill_on_overflow === true) {
    for (const target of liveTargets()) {
      const live = stacks.find((row) => row.id === target.id)
      if (!live || live.qty <= 0) {
        continue
      }
      stacks = writeCombatStack(stacks, live.id, {
        ...live,
        killOnOverflow: true,
      })
      lines.push(
        `${ability.name}: ${stackName(catalog, live)} attacks kill on overflow.`,
      )
      buffKeys.push(occupancyKey(live.q, live.r))
    }
  }
  if (debuffKeys.length > 0) {
    flashes.push({ keys: debuffKeys, color: 'yellow' })
  }
  if (buffKeys.length > 0) {
    flashes.push({ keys: buffKeys, color: 'blue' })
  }

  const wantHeal = stats.drain_heal === true || asFinite(stats.flat_heal) != null
  if (wantHeal) {
    const pool =
      stats.drain_heal === true
        ? healPool
        : Math.max(0, Math.floor(asFinite(stats.flat_heal) ?? 0))
    const healed = applyHealPool(
      stacks,
      pool,
      catalog,
      liveTargets(),
    )
    stacks = healed.stacks
    lines.push(...healed.notes)
    if (healed.healed > 0) {
      flashes.push({
        keys: liveTargets().map((row) => occupancyKey(row.q, row.r)),
        color: 'green',
      })
    }
  }

  return { battle: { ...battle, stacks }, dealt, flashes, lines }
}

/**
 * Given a designed ability and a chosen aim hex/stack, apply its stats.
 * Null stats = not designed yet (skip, not an error).
 */
export function resolveAbility(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  ability: AbilityRow,
  caster: Hero,
  casterSide: CombatSide,
  aim: { targetId: string | null; hex: Axial },
  heroes: CombatHeroes,
  random: () => number = Math.random,
): AbilityResolve | null {
  const stats = asRecord(ability.stats)
  if (!stats || !hasEffectKeys(stats)) {
    return null
  }
  if (isSummonStats(stats)) {
    const summoned = applySummonFromStats(
      battle,
      catalog,
      tiles,
      ability,
      stats,
      caster,
      casterSide,
      random,
    )
    const lines =
      summoned.lines.length > 0
        ? summoned.lines
        : [`${ability.name} had no effect.`]
    return {
      battle: summoned.battle,
      log: { lines },
      flashes: summoned.flashes,
    }
  }
  const parsed = parseTarget(catalog, ability)
  const enemyStats = asRecord(stats.enemy_effect)
  const allyStats = asRecord(stats.ally_effect)
  const lines: string[] = []
  const flashes: AbilityFlash[] = []
  let next = battle
  let dealt = 0

  if (enemyStats || allyStats) {
    if (enemyStats) {
      const enemies = collectTargets(
        next,
        catalog,
        tiles,
        casterSide,
        ability,
        enemyStats,
        aim,
        'enemy',
        parsed.spread === 'single' ? 'single' : 'all',
      )
      const result = applyOneEffect(
        next,
        catalog,
        ability,
        enemyStats,
        caster,
        casterSide,
        heroes,
        enemies,
        0,
        random,
        tiles,
      )
      next = result.battle
      dealt += result.dealt
      lines.push(...result.lines)
      flashes.push(...result.flashes)
    }
    if (allyStats) {
      const allies = collectTargets(
        next,
        catalog,
        tiles,
        casterSide,
        ability,
        allyStats,
        aim,
        'friend',
        'all',
      )
      const result = applyOneEffect(
        next,
        catalog,
        ability,
        allyStats,
        caster,
        casterSide,
        heroes,
        allies,
        dealt,
        random,
        tiles,
      )
      next = result.battle
      lines.push(...result.lines)
      flashes.push(...result.flashes)
    }
  } else {
    const targets = collectTargets(
      next,
      catalog,
      tiles,
      casterSide,
      ability,
      stats,
      aim,
      parsed.group,
      parsed.spread,
    )
    const result = applyOneEffect(
      next,
      catalog,
      ability,
      stats,
      caster,
      casterSide,
      heroes,
      targets,
      0,
      random,
      tiles,
    )
    next = result.battle
    lines.push(...result.lines)
    flashes.push(...result.flashes)
  }

  if (lines.length === 0) {
    lines.push(`${ability.name} had no effect.`)
  }
  if (stats.resorts_remaining_initiative === true) {
    const before = next.order.join('\0')
    next = resortRemainingInitiative(next, catalog, casterSide)
    if (next.order.join('\0') !== before) {
      lines.push(`${ability.name}: remaining initiative re-sorted.`)
    }
  }
  return {
    battle: next,
    log: { lines },
    flashes,
  }
}
