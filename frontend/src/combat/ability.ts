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
  unitAttackShape,
  unitById,
  unitHasTag,
} from '../town/catalog'
import {
  addStatFlat,
  combatSpeedChangedSides,
  forceEndRound,
  isHeroStack,
  noteUnitDeaths,
  resortRemainingInitiativeForSides,
  stackCombatSpeed,
  stackMaxDmg,
  stackMaxHealth,
  type CombatBattle,
  type CombatMitigationPct,
  type CombatOutputMods,
  type CombatSide,
  type CombatStack,
  type CombatTile,
} from './battle'
import { chanceRollLog, formatChancePct, rollChancePct } from './combatLog'
import { hexDistance } from '../hex/pathfinding'
import { relocateAwayFrom, relocateRandom, relocateToHex, landableHexes } from './relocate'
import {
  barrierLineDir,
  barrierLineHexes,
  clearTerrainPatchesOnKeys,
} from './factory'
import {
  applyStackDamage,
  applyStackHeal,
  applyStrike,
  heroForSide,
  mitigateIncoming,
  rollAttackDamage,
  writeCombatStack,
  type CombatHeroes,
  type DmgKind,
  type HitFlashColor,
} from './attack'
import { occupancyKey, occupiedHexes, stackFootprint } from './occupancy'
import {
  boardKeys,
  geometricHexes,
  hexLine,
  resolveShapeHits,
  type ShapeHit,
} from './shapes'
import {
  closedDrawbridgeKeys,
  isCreatureArmyUnit,
  isDrawbridgeUnit,
  isTerrainBlockerUnit,
  isUntargetableStack,
  isWallSegmentUnit,
  liveWallLosKeys,
} from './siege'
import { combatCanLandOn, stackOccupyingHex } from './movement'
import {
  applyIceShardPlacement,
  applyMirrorImage,
  applyRadiusBlockerPlacement,
  applySummonFromStats,
  isIceShardStats,
  isRadiusTerrainDropStats,
  isRandomPlacementSummon,
  isSummonStats,
  placeBlockerAtHex,
} from './summon'
import { applyEvokerArcaneSpellBonus } from './heroArmyPassives'
import { scatterShadowSeeds } from './shadow'
import {
  stackFromTombstone,
  syncTombstonesFromWipes,
  tombstoneHexKeys,
  tombstoneMatchesReviveTarget,
} from './tombstone'
import {
  applyBreaksOnDamage,
  applyHitTickConditions,
  BLIND_MISS_PCT,
  clearNegativeConditions,
  hasNegativeCondition,
  isVanished,
  liveResistance,
  tryInflictSpec,
} from './condition'
import {
  buildGroundEffectFromAbility,
  clearGroundEffectsOnKeys,
  placeFireOnHexKeys,
  placeGroundEffectOnBattle,
  tryTriggerGroundEffectsOnEnter,
} from './groundEffect'
import { zoneEvasionPctForStack } from './groundEvasion'
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
const SPEED_PCT_KEY = /^speed_(buff|debuff)_pct_stat$/

export type AbilityFlash = {
  keys: string[]
  color: HitFlashColor
}

/** One paced multi-hit beat (Earth Spikes): show flash/log, then wait before the next. */
export type AbilityBeat = {
  battle: CombatBattle
  lines: string[]
  flashes: AbilityFlash[]
}

export type AbilityResolve = {
  battle: CombatBattle
  log: { lines: string[]; holdTurn?: boolean }
  flashes: AbilityFlash[]
  /** When set, CombatScreen plays these ~0.5s apart instead of applying all at once. */
  beats?: AbilityBeat[]
  applySession?: (session: GameSession) => GameSession
  /** When true, the cast should not spend resource/cooldown/turn. */
  noOp?: boolean
  /** Rally: new round already started — do not mark the hero acted in it. */
  endsRound?: boolean
  /** Shadow Step: wait this many ms before revealing the landed unit. */
  moveDelayMs?: number
  /** Battle state before the teleport landing (unit still at origin). */
  preMoveBattle?: CombatBattle
  /** Barrier / Barricade / terrain stamps: updated combat tiles for the field. */
  tiles?: CombatTile[]
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

/** JSON/DB flags may be true, 1, or "true". */
function asFlag(value: unknown): boolean {
  if (value === true || value === 1) {
    return true
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    return text === 'true' || text === 't' || text === '1'
  }
  return false
}

function pickRandomSubset<T>(
  items: T[],
  count: number,
  random: () => number,
): T[] {
  if (count <= 0 || items.length === 0) {
    return []
  }
  const copy = items.slice()
  const n = Math.min(count, copy.length)
  for (let i = 0; i < n; i += 1) {
    const j = i + Math.floor(random() * (copy.length - i))
    const a = copy[i]
    const b = copy[j]
    if (a === undefined || b === undefined) {
      continue
    }
    copy[i] = b
    copy[j] = a
  }
  return copy.slice(0, n)
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
  // Ice Shards: enemy_single click even though summon_count looks summon-like.
  if (isIceShardStats(ability.stats)) {
    return true
  }
  if (asFlag(ability.stats.self_teleport)) {
    return true
  }
  if (asFlag(ability.stats.targets_empty_hexes)) {
    return true
  }
  // Seeds of Shadow: board-wide scatter — no aim hex (despite ground_effect_id).
  if (isSeedsOfShadowStats(ability.stats)) {
    return false
  }
  // Meteor: whole-board random barrage — no aim (ground_effect_id is Fire drop only).
  if (isMeteorStats(ability.stats)) {
    return false
  }
  if (asFinite(ability.stats.ground_effect_id) != null) {
    return true
  }
  if (isRandomPlacementSummon(ability.stats)) {
    return false
  }
  if (ability.stats.ends_round_immediately === true) {
    return false
  }
  return parseTarget(catalog, ability).spread !== 'all'
}

/** Seeds of Shadow: scatter N Shadow tiles from intel (`seed_count_stat`). */
export function isSeedsOfShadowStats(
  stats: Record<string, unknown> | null | undefined,
): boolean {
  if (!stats) {
    return false
  }
  return asFinite(stats.seed_count_stat) != null
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
  teleportUnitId?: string | null,
): string[] {
  const stats = asRecord(ability.stats)
  // Shadow Step phase 2: empty hexes the chosen unit can fit on.
  if (asFlag(stats?.self_teleport) && teleportUnitId && tiles && tiles.length > 0) {
    const mover = battle.stacks.find((row) => row.id === teleportUnitId)
    const unit = mover ? unitById(catalog, mover.unitId) : null
    if (!mover || !unit || mover.qty <= 0 || isHeroStack(mover)) {
      return []
    }
    const fromKey = occupancyKey(mover.q, mover.r)
    return landableHexes(battle, catalog, tiles, mover, unit)
      .filter((hex) => occupancyKey(hex.q, hex.r) !== fromKey)
      .map((hex) => occupancyKey(hex.q, hex.r))
  }
  // Explosive Trap-style: any unoccupied standable hex on the whole board.
  // Do NOT use radius_stat_div here — that key is effect-only for traps.
  if (asFlag(stats?.targets_empty_hexes) && tiles && tiles.length > 0) {
    const occupied = occupiedHexes(battle.stacks, catalog)
    const keys: string[] = []
    for (const tile of tiles) {
      const key = occupancyKey(tile.q, tile.r)
      if (occupied.has(key)) {
        continue
      }
      if (!combatCanLandOn(tile, 'ground')) {
        continue
      }
      keys.push(key)
    }
    return keys
  }
  const parsed = parseTarget(catalog, ability)
  if (parsed.spread === 'all') {
    return []
  }
  if (parsed.spread === 'aoe' && tiles && tiles.length > 0) {
    return tiles.map((tile) => occupancyKey(tile.q, tile.r))
  }
  const requiredTag = asFinite(stats?.target_tag_required)
  const keys: string[] = []
  for (const stack of livingCreatures(battle, catalog)) {
    if (!matchesGroup(stack, casterSide, parsed.group)) {
      continue
    }
    if (isVanished(stack, catalog)) {
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
  // Resurrection: own-side tombstones only (never enemy/ally corpses).
  if (isResurrectionStats(stats)) {
    keys.push(
      ...tombstoneHexKeys(battle, casterSide, catalog, requiredTag ?? null),
    )
  }
  return keys
}

function isResurrectionStats(
  stats: Record<string, unknown> | null | undefined,
): boolean {
  if (!stats) {
    return false
  }
  return (
    asFinite(stats.revive_pct_stat) != null &&
    asFinite(stats.revive_pct_min) != null &&
    asFinite(stats.revive_pct_max) != null
  )
}

export function abilityUsesLocalizedEmptyHexAim(
  ability: AbilityRow,
): boolean {
  return isUnlimitedEmptyHexPlacement(asRecord(ability.stats))
}

/** Barrier-style line placement: preview the resolved line, not all empty hexes. */
export function abilityUsesLinePlacementPreview(
  ability: AbilityRow,
): boolean {
  const stats = asRecord(ability.stats)
  return isBarrierStats(stats) || isWildfireStats(stats)
}

function isUnlimitedEmptyHexPlacement(
  stats: Record<string, unknown> | null | undefined,
): boolean {
  if (!stats) {
    return false
  }
  return (
    asFlag(stats.targets_empty_hexes) && asFinite(stats.ground_effect_id) != null
  )
}

/** Explosion / effect radius for trap preview — uses Strength for Energy casts. */
function groundEffectPreviewRadius(
  stats: Record<string, unknown>,
  caster: Hero | null | undefined,
  catalog: ReferenceCatalog | null | undefined,
  ability?: AbilityRow | null,
): number {
  const div = asFinite(stats.radius_stat_div)
  if (div == null || div <= 0 || !caster || !catalog) {
    return Math.max(0, Math.floor(asFinite(stats.radius) ?? 0))
  }
  const resourceId = ability?.resource_id ?? ENERGY_RESOURCE_ID
  const raw = casterStat(catalog, caster, resourceId)
  return Math.max(0, Math.floor(raw / div))
}

/**
 * Red overlay while aiming. Single = valid stacks. AoE = the shape around
 * the hovered hex (plus valid stacks so friends stay visible for `friend_*`).
 * Optional `caster` supplies intel for `radius_stat_div` preview.
 *
 * Explosive Trap: unlimited empty-hex *placement range*, but the red preview
 * is only the localized explosion disk (STR / radius_stat_div) — never the
 * whole board of valid tiles.
 */
function isBarrierStats(
  stats: Record<string, unknown> | null | undefined,
): boolean {
  if (!stats) {
    return false
  }
  return (
    asFinite(stats.ground_effect_id) != null &&
    asFinite(stats.line_length_stat_div) != null
  )
}

function isWildfireStats(
  stats: Record<string, unknown> | null | undefined,
): boolean {
  if (!stats) {
    return false
  }
  return (
    asFinite(stats.ground_effect_id) != null &&
    asFlag(stats.line_from_caster_to_target)
  )
}

function isFireballStats(
  stats: Record<string, unknown> | null | undefined,
): boolean {
  if (!stats) {
    return false
  }
  return (
    asFinite(stats.fire_drop_chance_pct) != null ||
    asFinite(stats.fire_radius_stat_div) != null
  )
}

function isMeteorStats(
  stats: Record<string, unknown> | null | undefined,
): boolean {
  if (!stats) {
    return false
  }
  return (
    asFlag(stats.drops_fire_on_hit) ||
    (asFlag(stats.targets_hexes) && asFlag(stats.avoids_friendly_hexes))
  )
}

/** Smoke/Trap-style: place zone only — not hybrid Fireball/Meteor/Wildfire. */
function isPlaceOnlyGroundEffect(
  stats: Record<string, unknown> | null | undefined,
): boolean {
  if (!stats || asFinite(stats.ground_effect_id) == null) {
    return false
  }
  if (isWildfireStats(stats) || isFireballStats(stats) || isMeteorStats(stats)) {
    return false
  }
  if (asFinite(stats.int_dmg) != null || asFinite(stats.str_dmg) != null) {
    return false
  }
  if (asFlag(stats.targets_hexes)) {
    return false
  }
  return true
}

function heroCasterHex(
  battle: CombatBattle,
  casterSide: CombatSide,
): Axial | null {
  const hero = battle.stacks.find(
    (row) => isHeroStack(row) && row.side === casterSide && row.qty > 0,
  )
  return hero ? { q: hero.q, r: hero.r } : null
}

export function abilityAimImpactKeys(
  catalog: ReferenceCatalog,
  ability: AbilityRow,
  casterSide: CombatSide,
  battle: CombatBattle,
  tiles: CombatTile[],
  hover: Axial,
  caster?: Hero | null,
  lineDir?: Axial | null,
): string[] {
  const parsed = parseTarget(catalog, ability)
  const valid = abilityValidHexKeys(catalog, ability, casterSide, battle, tiles)
  const stats = asRecord(ability.stats)
  const resourceId = ability.resource_id ?? MANA_RESOURCE_ID
  if (stats && isBarrierStats(stats) && caster) {
    const hoverKey = occupancyKey(hover.q, hover.r)
    if (!valid.includes(hoverKey)) {
      return []
    }
    const lengthDiv = asFinite(stats.line_length_stat_div) ?? 5
    const length = Math.max(
      1,
      Math.floor(casterStat(catalog, caster, resourceId) / lengthDiv),
    )
    const dir = barrierLineDir(
      heroCasterHex(battle, casterSide),
      hover,
      lineDir,
    )
    const occupied = occupiedHexes(battle.stacks, catalog)
    const line = barrierLineHexes(
      hover,
      length,
      dir,
      boardKeys(tiles),
      occupied,
      asFlag(stats.avoids_occupied_hexes),
    )
    return line.map((hex) => occupancyKey(hex.q, hex.r))
  }
  if (stats && isUnlimitedEmptyHexPlacement(stats)) {
    const hoverKey = occupancyKey(hover.q, hover.r)
    if (!valid.includes(hoverKey)) {
      return []
    }
    const radius = groundEffectPreviewRadius(stats, caster, catalog, ability)
    const keys: string[] = []
    for (const tile of tiles) {
      if (hexDistance(hover, { q: tile.q, r: tile.r }) <= radius) {
        keys.push(occupancyKey(tile.q, tile.r))
      }
    }
    return keys
  }
  if (stats && isInstantPulse(stats) && shapeFromStats(stats) === 'pulse') {
    const occupant =
      stackOccupyingHex(battle.stacks, hover.q, hover.r, catalog) ??
      battle.stacks.find((row) => row.q === hover.q && row.r === hover.r) ??
      null
    if (
      occupant &&
      valid.includes(occupancyKey(occupant.q, occupant.r))
    ) {
      const spec = shapeSpecFromStats(
        stats,
        parsed.spread,
        caster,
        catalog,
        resourceId,
      )
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
    if (
      stats &&
      caster &&
      (shapeFromStats(stats) === 'cleave' || shapeFromStats(stats) === 'breath')
    ) {
      const hoverKey = occupancyKey(hover.q, hover.r)
      if (!valid.includes(hoverKey)) {
        return []
      }
      const spec = shapeSpecFromStats(
        stats,
        parsed.spread,
        caster,
        catalog,
        resourceId,
      )
      const from = heroCasterHex(battle, casterSide) ?? hover
      const hexes = geometricHexes(
        spec,
        from,
        hover,
        battle,
        boardKeys(tiles),
        casterSide,
        tiles,
        catalog,
      )
      return [...new Set(hexes.map((hex) => occupancyKey(hex.q, hex.r)))]
    }
    return valid
  }
  if (!stats) {
    return []
  }
  const spec = shapeSpecFromStats(
    stats,
    parsed.spread,
    caster,
    catalog,
    resourceId,
  )
  if (spec.radius <= 0) {
    return []
  }
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
  caster?: Hero | null,
  catalog?: ReferenceCatalog | null,
  resourceId: number = MANA_RESOURCE_ID,
): UnitCombatAbilities {
  const shape = shapeFromStats(stats)
  const aoeWholeField = spread === 'aoe' && shape === 'single'
  // Explosive Trap keeps radius_stat_div for detonation only — never placement.
  const radiusDiv =
    asFinite(stats.ground_effect_id) != null && asFlag(stats.targets_empty_hexes)
      ? null
      : asFinite(stats.radius_stat_div)
  let radius: number
  if (radiusDiv != null && radiusDiv > 0 && caster && catalog) {
    const raw = casterStat(catalog, caster, resourceId)
    radius = Math.max(0, Math.floor(raw / radiusDiv))
  } else {
    radius = Math.max(
      1,
      Math.floor(asFinite(stats.radius) ?? (aoeWholeField ? 99 : 1)),
    )
  }
  return {
    ...DEFAULT_UNIT_ABILITIES,
    shape: aoeWholeField || spread === 'aoe' ? 'aoe' : shape,
    radius,
    jumps: Math.max(1, Math.floor(asFinite(stats.jumps) ?? 1)),
    falloff: Math.max(0, Math.floor(asFinite(stats.falloff) ?? 0)),
    targets: Math.max(1, Math.floor(asFinite(stats.targets) ?? 1)),
    rows: Math.max(1, Math.floor(asFinite(stats.rows) ?? 2)),
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
  ability: AbilityRow,
  stats: Record<string, unknown>,
  aim: { targetId: string | null; hex: Axial },
  group: TargetGroup,
  spread: TargetSpread,
  caster?: Hero | null,
): CombatStack[] {
  // Place-only ground effects (Smoke/Trap/etc.) must not collect living
  // targets — their numbers live on the zone. Hybrids like Fireball keep
  // ground_effect_id for the Fire drop but still need the aimed stack for
  // int_dmg / str_dmg.
  if (isPlaceOnlyGroundEffect(stats)) {
    return []
  }
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
    const shape = shapeFromStats(stats)
    // Cleave / breath / chain expand from the hero even with enemy_single aim.
    if (shape !== 'cleave' && shape !== 'breath' && shape !== 'chain') {
      if (
        aimed &&
        aimed.qty > 0 &&
        matchesGroup(aimed, casterSide, group) &&
        !aimed.indestructible &&
        !isUntargetableStack(aimed, catalog) &&
        !isVanished(aimed, catalog)
      ) {
        return [aimed]
      }
      return []
    }
  }
  const shape = shapeFromStats(stats)
  const spec = shapeSpecFromStats(
    stats,
    spread,
    caster,
    catalog,
    ability.resource_id ?? MANA_RESOURCE_ID,
  )
  const casterHex =
    heroCasterHex(battle, casterSide) ?? aim.hex
  const origin = dummyCaster(casterSide, casterHex)
  // Ground AOE (incl. multi-in-radius like Earth Spikes): disk around aim hex.
  if (spread === 'aoe') {
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
  if (shape === 'chain' || shape === 'multi' || shape === 'rain') {
    const hits = resolveShapeHits(
      origin,
      aim.hex,
      aimed,
      battle,
      catalog,
      tiles,
      Math.random,
      {
        shape: spec.shape,
        jumps: spec.jumps,
        falloff: spec.falloff,
        targets: spec.targets,
        radius: spec.radius,
        rows: spec.rows,
      },
      false,
      { allowRepeatTarget: asFlag(stats.allow_repeat_target) },
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
  random: () => number = Math.random,
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
  // Same roll as unit basic attacks, sourced from ability.stats min/max.
  const minD = asFinite(stats.min_dmg)
  const maxD = asFinite(stats.max_dmg)
  if (minD != null || maxD != null) {
    const lo = Math.floor(minD ?? maxD ?? 0)
    const hi = Math.floor(maxD ?? minD ?? 0)
    return Math.max(0, rollAttackDamage(1, lo, hi, random))
  }
  return null
}

function abilityUsesDamageRoll(stats: Record<string, unknown>): boolean {
  return asFinite(stats.min_dmg) != null || asFinite(stats.max_dmg) != null
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
      continue
    }
    const speedPct = SPEED_PCT_KEY.exec(key)
    if (speedPct) {
      const factor = asFinite(stats[key])
      if (factor == null || factor <= 0) {
        continue
      }
      const scale = casterStat(catalog, caster, ability.resource_id)
      const pct = Math.max(0, Math.floor(scale * factor))
      if (pct === 0) {
        continue
      }
      const live = stackCombatSpeed(stack, catalog) ?? 0
      let cut = Math.max(0, Math.floor((live * pct) / 100))
      if (cut === 0 && pct > 0 && live > 0) {
        cut = 1
      }
      if (cut === 0) {
        continue
      }
      const signed = speedPct[1] === 'debuff' ? -cut : cut
      stack = { ...stack, speedMod: (stack.speedMod ?? 0) + signed }
      notes.push(
        `${stackName(catalog, target)} speed ${signed > 0 ? '+' : ''}${signed} (${pct}% of ${live})`,
      )
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
  if (asFlag(stats.condition_immunity)) {
    const uses = Math.max(1, Math.floor(asFinite(stats.uses) ?? 1))
    stack = {
      ...stack,
      conditionImmunityUsesLeft: (stack.conditionImmunityUsesLeft ?? 0) + uses,
    }
    notes.push(
      `${stackName(catalog, target)} Hyper Focus (${uses} condition block${uses === 1 ? '' : 's'})`,
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
  if (stats.forces_min_dmg_on_target === true) {
    const durationDiv = statDiv(stats, 'duration_stat_div')
    if (durationDiv != null) {
      const rounds = Math.floor(
        casterStat(catalog, caster, ability.resource_id) / durationDiv,
      )
      if (rounds > 0) {
        const physicalOnly =
          typeof stats.requires_dmg_type === 'string' &&
          stats.requires_dmg_type.toLowerCase() === 'physical'
        stack = {
          ...stack,
          disarm: { roundsLeft: rounds, physicalOnly },
        }
        notes.push(
          `${stackName(catalog, target)} disarmed (${rounds} round${rounds === 1 ? '' : 's'}${physicalOnly ? ', Physical only' : ''})`,
        )
      }
    }
  }
  if (stats.grants_ignore_target_armor === true) {
    stack = {
      ...stack,
      ignoreTargetArmor: true,
      ignoreTargetArmorPhysicalOnly: stats.physical_only === true,
    }
    notes.push(
      `${stackName(catalog, target)} ignores target armor${
        stats.physical_only === true ? ' (Physical)' : ''
      }`,
    )
  }
  const reflectPct = asFinite(stats.reflect_pct)
  if (reflectPct != null && reflectPct > 0) {
    const hitDiv = statDiv(stats, 'hit_count_stat_div')
    if (hitDiv != null) {
      const hits = Math.floor(
        casterStat(catalog, caster, ability.resource_id) / hitDiv,
      )
      if (hits > 0) {
        stack = {
          ...stack,
          reflect: {
            pct: reflectPct,
            hitsLeft: hits,
            physicalOnly: stats.reflects_physical_only === true,
          },
        }
        notes.push(
          `${stackName(catalog, target)} reflects ${Math.floor(reflectPct)}% (${hits} hit${hits === 1 ? '' : 's'}${
            stats.reflects_physical_only === true ? ', Physical' : ''
          })`,
        )
      }
    }
  }
  if (
    stats.redirect_target === 'random_enemy' ||
    (typeof stats.redirects_dmg_type === 'string' &&
      stats.redirects_dmg_type.trim().toLowerCase() === 'magic')
  ) {
    const usesDiv = statDiv(stats, 'uses_stat_div')
    if (usesDiv != null && usesDiv > 0) {
      const uses = Math.floor(
        casterStat(catalog, caster, ability.resource_id) / usesDiv,
      )
      if (uses > 0) {
        stack = {
          ...stack,
          spellReflect: { usesLeft: uses },
        }
        notes.push(
          `${stackName(catalog, target)} Spell Reflect (${uses} use${uses === 1 ? '' : 's'})`,
        )
      }
    }
  }
  if (stats.reveals_enemy_stats === true) {
    stack = { ...stack, exposed: true }
    notes.push(`${stackName(catalog, target)} exposed`)
  }
  if (stats.forces_return_to_start === true) {
    stack = { ...stack, forcedRetreatPending: true }
    notes.push(
      `${stackName(catalog, target)} will retreat to their starting hex next turn`,
    )
  }
  const chainPctStat = asFinite(stats.chain_trigger_pct_stat)
  if (chainPctStat != null && chainPctStat > 0) {
    const strength = heroEffectiveStats(
      catalog,
      caster.class_id,
      caster.current_level,
    ).strength
    const chancePct = Math.max(0, Math.floor(strength * chainPctStat))
    const rounds = Math.max(
      1,
      Math.floor(asFinite(stats.duration) ?? 3),
    )
    if (chancePct > 0) {
      stack = {
        ...stack,
        fervor: { chancePct, roundsLeft: rounds },
      }
      notes.push(
        `${stackName(catalog, target)} fervor ${chancePct}% (${rounds} round${rounds === 1 ? '' : 's'})`,
      )
    }
  }
  const retalPct = asFinite(stats.retaliation_dmg_pct)
  if (retalPct != null && retalPct > 0) {
    const usesDiv = statDiv(stats, 'uses_stat_div')
    const uses =
      usesDiv != null
        ? Math.floor(
            casterStat(catalog, caster, ability.resource_id) / usesDiv,
          )
        : Math.max(1, Math.floor(asFinite(stats.uses) ?? 1))
    if (uses > 0) {
      stack = {
        ...stack,
        battleCryRetaliation: { pct: retalPct, usesLeft: uses },
      }
      notes.push(
        `${stackName(catalog, target)} battle cry: retaliation ${Math.floor(retalPct)}% (${uses} use${uses === 1 ? '' : 's'})`,
      )
    }
  }
  if (
    stats.takes_dmg_source === 'attacker_min_dmg' &&
    asFlag(stats.ignores_mitigation)
  ) {
    const usesDiv = statDiv(stats, 'uses_stat_div')
    const uses =
      usesDiv != null
        ? Math.floor(
            casterStat(catalog, caster, ability.resource_id) / usesDiv,
          )
        : Math.max(1, Math.floor(asFinite(stats.uses) ?? 1))
    const pct = Math.max(0, Math.floor(asFinite(stats.dmg_taken_pct) ?? 50))
    if (uses > 0 && pct > 0) {
      stack = { ...stack, deflect: { pct, usesLeft: uses } }
      notes.push(
        `${stackName(catalog, target)} deflect ${pct}% of attacker min (${uses} use${uses === 1 ? '' : 's'})`,
      )
    }
  }
  if (asFlag(stats.second_attack_after_retaliation)) {
    const usesDiv = statDiv(stats, 'uses_stat_div')
    const uses =
      usesDiv != null
        ? Math.floor(
            casterStat(catalog, caster, ability.resource_id) / usesDiv,
          )
        : Math.max(1, Math.floor(asFinite(stats.uses) ?? 1))
    if (uses > 0) {
      stack = { ...stack, doubleTapUsesLeft: uses }
      notes.push(
        `${stackName(catalog, target)} double tap (${uses} use${uses === 1 ? '' : 's'})`,
      )
    }
  }
  if (asFlag(stats.retaliates_before_attack_resolves)) {
    const usesDiv = statDiv(stats, 'uses_stat_div')
    const uses =
      usesDiv != null
        ? Math.floor(
            casterStat(catalog, caster, ability.resource_id) / usesDiv,
          )
        : Math.max(1, Math.floor(asFinite(stats.uses) ?? 1))
    if (uses > 0) {
      stack = { ...stack, preemptiveStrikeUsesLeft: uses }
      notes.push(
        `${stackName(catalog, target)} preemptive strike (${uses} use${uses === 1 ? '' : 's'})`,
      )
    }
  }
  const speedFlatStat = asFinite(stats.speed_buff_flat_stat)
  if (speedFlatStat != null && speedFlatStat !== 0) {
    const heroSpeed = heroEffectiveStats(
      catalog,
      caster.class_id,
      caster.current_level,
    ).speed
    const amount = Math.max(0, Math.floor(heroSpeed * speedFlatStat))
    const rounds = Math.max(1, Math.floor(asFinite(stats.duration) ?? 1))
    if (amount > 0) {
      stack = {
        ...stack,
        speedBoost: { amount, roundsLeft: rounds },
      }
      notes.push(
        `${stackName(catalog, target)} speed +${amount} (${rounds} round${rounds === 1 ? '' : 's'})`,
      )
    }
  }
  const defMult = asFinite(stats.def_mult)
  if (defMult != null && defMult > 0) {
    const durationDiv = statDiv(stats, 'duration_stat_div')
    const rounds =
      durationDiv != null
        ? Math.floor(
            casterStat(catalog, caster, ability.resource_id) / durationDiv,
          )
        : Math.max(1, Math.floor(asFinite(stats.duration) ?? 1))
    if (rounds > 0) {
      stack = {
        ...stack,
        defenseMult: { mult: defMult, roundsLeft: rounds },
      }
      notes.push(
        `${stackName(catalog, target)} defense ×${defMult} (${rounds} round${rounds === 1 ? '' : 's'})`,
      )
    }
  }
  // Shield Wall: STR-scaled Defense + Resistance multipliers (not Guard's flat def_mult).
  const defMultDiv = statDiv(stats, 'def_mult_stat_div')
  const resMultDiv = statDiv(stats, 'res_mult_stat_div')
  if (defMultDiv != null || resMultDiv != null) {
    const strength = casterStat(catalog, caster, ability.resource_id)
    const durationDiv = statDiv(stats, 'duration_stat_div')
    const rounds =
      durationDiv != null
        ? Math.max(0, Math.floor(strength / durationDiv))
        : Math.max(1, Math.floor(asFinite(stats.duration) ?? 1))
    if (rounds > 0) {
      if (defMultDiv != null) {
        const mult = Math.max(0, Math.floor(strength / defMultDiv))
        if (mult > 0) {
          stack = {
            ...stack,
            defenseMult: { mult, roundsLeft: rounds },
          }
          notes.push(
            `${stackName(catalog, target)} defense ×${mult} (${rounds} round${rounds === 1 ? '' : 's'})`,
          )
        }
      }
      if (resMultDiv != null) {
        const mult = Math.max(0, Math.floor(strength / resMultDiv))
        if (mult > 0) {
          stack = {
            ...stack,
            resistanceMult: { mult, roundsLeft: rounds },
          }
          notes.push(
            `${stackName(catalog, target)} resistance ×${mult} (${rounds} round${rounds === 1 ? '' : 's'})`,
          )
        }
      }
    }
  }
  // Immunity: source-less blanket zero damage for STR/hit_count_stat_div hits.
  // Distinct from Deflect (takes_dmg_source + dmg_taken_pct redirect).
  if (
    asFinite(stats.dmg_taken_pct) === 0 &&
    stats.takes_dmg_source == null &&
    statDiv(stats, 'hit_count_stat_div') != null
  ) {
    const hitDiv = statDiv(stats, 'hit_count_stat_div')!
    const hits = Math.max(
      0,
      Math.floor(
        casterStat(catalog, caster, ability.resource_id) / hitDiv,
      ),
    )
    if (hits > 0) {
      stack = {
        ...stack,
        immunityHitsLeft: hits,
        parryIgnoresRetaliation:
          stats.ignores_retaliation === true || stack.parryIgnoresRetaliation,
      }
      notes.push(
        `${stackName(catalog, target)} immune for ${hits} hit${hits === 1 ? '' : 's'}${
          stats.ignores_retaliation === true ? ' (no retaliation)' : ''
        }`,
      )
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
    const raw = over * dmgStat
    let pct = Math.max(0, Math.floor(raw))
    // Nonzero scaled % that floors to 0 still grants at least +1%.
    if (pct === 0 && raw > 0) {
      pct = 1
    }
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
    const raw = over * defStat
    let cut = Math.max(0, Math.floor(raw))
    if (cut === 0 && raw > 0) {
      cut = 1
    }
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
    stats.min_dmg != null ||
    stats.max_dmg != null ||
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
    stats.condition_immunity === true ||
    stats.duplicates_target === true ||
    stats.grants_second_attack_pct != null ||
    stats.instant === true ||
    stats.evasion_pct != null ||
    stats.forces_max_dmg_on_target === true ||
    stats.forces_min_dmg_on_target === true ||
    stats.grants_ignore_target_armor === true ||
    stats.reflect_pct != null ||
    stats.reveals_enemy_stats === true ||
    stats.forces_return_to_start === true ||
    stats.chain_trigger_pct_stat != null ||
    stats.retaliation_dmg_pct != null ||
    stats.speed_buff_flat_stat != null ||
    stats.def_mult != null ||
    stats.def_mult_stat_div != null ||
    stats.res_mult_stat_div != null ||
    stats.takes_dmg_source != null ||
    (stats.dmg_taken_pct != null && stats.takes_dmg_source == null) ||
    stats.second_attack_after_retaliation === true ||
    stats.retaliates_before_attack_resolves === true ||
    stats.self_teleport === true ||
    stats.ends_round_immediately === true ||
    stats.delta_all_stats_stat != null ||
    stats.direction_by_target_side === true ||
    stats.clears_conditions === true ||
    stats.clears_terrain === true ||
    stats.clears_los_blockers === true ||
    stats.ground_effect_id != null ||
    stats.seed_count_stat != null ||
    stats.line_from_caster_to_target === true ||
    stats.fire_drop_chance_pct != null ||
    stats.fire_radius_stat_div != null ||
    stats.drops_fire_on_hit === true ||
    stats.redirect_target != null ||
    stats.redirects_dmg_type != null ||
    stats.ignores_sublethal_damage === true ||
    stats.min_qty_stat_div != null ||
    stats.terrain_type_id != null ||
    stats.line_length_stat_div != null ||
    stats.push_dist_stat_div != null ||
    stats.push_direction != null ||
    stats.targets_empty_hexes === true ||
    stats.radius_stat_div != null ||
    stats.revive_pct_stat != null ||
    stats.revive_pct_min != null ||
    stats.revive_pct_max != null ||
    stats.heals_to_full === true ||
    stats.snapshot_qty_on_cast === true ||
    stats.prevents_death_once === true ||
    stats.move_type === 'random' ||
    stats.bolts_stat != null ||
    stats.targets_hexes === true ||
    stats.friendly_takes_dmg === false ||
    stats.recurring_trigger === 'end_of_round' ||
    stats.heal_pct_stat != null ||
    stats.clear_chance_pct_stat != null ||
    isIceShardStats(stats) ||
    isSummonStats(stats)
  ) {
    return true
  }
  return Object.keys(stats).some(
    (key) =>
      OUTPUT_KEY.test(key) ||
      MITIGATION_KEY.test(key) ||
      ROLL_MIN_KEY.test(key) ||
      SPEED_DIV_KEY.test(key) ||
      SPEED_PCT_KEY.test(key),
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
  aimHex?: Axial,
): {
  battle: CombatBattle
  dealt: number
  flashes: AbilityFlash[]
  lines: string[]
  beats?: AbilityBeat[]
  tiles?: CombatTile[]
} {
  let stacks = battle.stacks
  let tombstones = [...(battle.tombstones ?? [])]
  let dealt = 0
  const lines: string[] = []
  const flashes: AbilityFlash[] = []
  const beats: AbilityBeat[] = []
  let workingTiles = tiles
  const liveTargets = () =>
    targets
      .map((row) => stacks.find((s) => s.id === row.id))
      .filter((row): row is CombatStack => row != null && row.qty > 0)

  const snapshotBeat = (beatLines: string[], beatFlashes: AbilityFlash[]) => {
    if (beatLines.length === 0 && beatFlashes.length === 0) {
      return
    }
    beats.push({
      battle: { ...battle, stacks: stacks.map((row) => ({ ...row })) },
      lines: beatLines,
      flashes: beatFlashes,
    })
  }

  // Sanctify Grounds (guaranteed radius) / Gift of Gaia (whole-board chance).
  const clearsTerrain = stats.clears_terrain === true
  const clearsLos = stats.clears_los_blockers === true
  const radiusDiv = asFinite(stats.radius_stat_div)
  const clearChanceStat = asFinite(stats.clear_chance_pct_stat)
  let groundEffects = [...(battle.groundEffects ?? [])]
  if (clearsTerrain || clearsLos) {
    const intel = casterStat(catalog, caster, MANA_RESOURCE_ID)
    let candidateIds: string[] | null = null
    let clearHexKeys: Set<string> | null = null
    if (clearChanceStat != null && clearChanceStat > 0) {
      candidateIds = stacks
        .filter((stack) => stack.qty > 0 && !isHeroStack(stack))
        .map((stack) => stack.id)
      clearHexKeys = new Set(tiles.map((tile) => occupancyKey(tile.q, tile.r)))
    } else if (aimHex && radiusDiv != null && radiusDiv > 0) {
      const radius = Math.max(0, Math.floor(intel / radiusDiv))
      if (radius > 0) {
        const radiusKeys = new Set<string>()
        for (const tile of tiles) {
          if (hexDistance(aimHex, { q: tile.q, r: tile.r }) <= radius) {
            radiusKeys.add(occupancyKey(tile.q, tile.r))
          }
        }
        clearHexKeys = radiusKeys
        candidateIds = stacks
          .filter((stack) => {
            if (stack.qty <= 0 || isHeroStack(stack)) {
              return false
            }
            return stackFootprint(stack, catalog).some((hex) =>
              radiusKeys.has(occupancyKey(hex.q, hex.r)),
            )
          })
          .map((stack) => stack.id)
      }
    } else if (clearsTerrain) {
      // Fallback: clears_terrain with no radius/chance still sweeps the board
      // (ground effects + any stamped terrain).
      clearHexKeys = new Set(tiles.map((tile) => occupancyKey(tile.q, tile.r)))
      candidateIds = stacks
        .filter((stack) => stack.qty > 0 && !isHeroStack(stack))
        .map((stack) => stack.id)
    }
    if (candidateIds && candidateIds.length > 0) {
      const closedDrawbridge =
        clearsLos && battle.siegeGate != null
          ? closedDrawbridgeKeys(stacks, catalog, tiles, battle.siegeGate)
          : null
      const chancePct =
        clearChanceStat != null ? Math.max(0, intel * clearChanceStat) : 100
      const toRemove = new Set<string>()
      const toFlash: string[] = []
      let clearAttempts = 0
      let clearHits = 0
      for (const id of candidateIds) {
        const stack = stacks.find((row) => row.id === id)
        if (!stack || stack.qty <= 0) {
          continue
        }
        const unit = unitById(catalog, stack.unitId)
        if (!unit) {
          continue
        }
        // Arcane Shield / Illusions: real summon units, not terrain — never swept by
        // Sanctify Grounds / Gift of Gaia (those clear ground_effect + Ice/Earth blockers).
        const shape = unitAttackShape(unit)
        if (shape.immuneToMagicDmg === true || shape.aiTreatAsThreat === true) {
          continue
        }
        let remove = false
        if (
          clearsTerrain &&
          (isTerrainBlockerUnit(unit) ||
            (stack.indestructible === true &&
              unit.stationary === true &&
              (unit.speed ?? 0) <= 0 &&
              !isWallSegmentUnit(unit)))
        ) {
          remove = true
        }
        if (clearsLos && (unit.blocks_los === true || isWallSegmentUnit(unit))) {
          remove = true
        }
        if (
          clearsLos &&
          isDrawbridgeUnit(unit) &&
          closedDrawbridge?.has(`${stack.q},${stack.r}`) === true
        ) {
          remove = true
        }
        if (!remove) {
          continue
        }
        clearAttempts += 1
        if (clearChanceStat != null && !rollChancePct(chancePct, random)) {
          continue
        }
        clearHits += 1
        toRemove.add(stack.id)
        toFlash.push(occupancyKey(stack.q, stack.r))
      }
      if (clearChanceStat != null && clearAttempts > 0) {
        lines.push(
          chanceRollLog(ability.name, chancePct, clearHits > 0, {
            action: 'to clear terrain/blockers',
            success: `${clearHits}/${clearAttempts} cleared.`,
            fail: `0/${clearAttempts} cleared.`,
          }),
        )
      }
      if (toRemove.size > 0) {
        for (const id of toRemove) {
          stacks = writeCombatStack(stacks, id, null)
        }
        if (clearChanceStat == null) {
          lines.push(
            `${ability.name}: removed ${toRemove.size} terrain/blocker${
              toRemove.size === 1 ? '' : 's'
            }.`,
          )
        }
        flashes.push({ keys: [...new Set(toFlash)], color: 'green' })
      }
    }
    // Ground effects: always swept when clears_terrain (Sanctify radius / Gaia board).
    // clear_chance_pct_stat only gates unit-table terrain/LOS blockers above — not
    // ground_effect zones (Void/Shadow/Smoke/Barricade), which were vanishing under RNG.
    if (clearsTerrain && clearHexKeys && clearHexKeys.size > 0) {
      const swept = clearGroundEffectsOnKeys(
        { ...battle, stacks, tombstones, groundEffects },
        clearHexKeys,
        100,
        random,
        workingTiles,
      )
      groundEffects = swept.battle.groundEffects ?? []
      if (swept.tiles) {
        workingTiles = swept.tiles
      }
      if (swept.cleared > 0) {
        lines.push(
          `${ability.name}: cleared ${swept.cleared} ground effect${
            swept.cleared === 1 ? '' : 's'
          }.`,
        )
        flashes.push({ keys: [...clearHexKeys], color: 'green' })
      }
      const chancePct =
        clearChanceStat != null
          ? Math.max(0, intel * clearChanceStat)
          : 100
      // Barrier / Void terrain_type stamps (not unit blockers).
      const patchClear = clearTerrainPatchesOnKeys(
        { ...battle, stacks, tombstones, groundEffects },
        workingTiles,
        clearHexKeys,
        chancePct,
        random,
      )
      workingTiles = patchClear.tiles
      battle = patchClear.battle
      groundEffects = patchClear.battle.groundEffects ?? groundEffects
      if (clearChanceStat != null && patchClear.attempted > 0) {
        lines.push(
          chanceRollLog(ability.name, chancePct, patchClear.cleared > 0, {
            action: 'to clear terrain stamps',
            success: `${patchClear.cleared}/${patchClear.attempted} cleared.`,
            fail: `0/${patchClear.attempted} cleared.`,
          }),
        )
      } else if (patchClear.cleared > 0) {
        lines.push(
          `${ability.name}: cleared ${patchClear.cleared} terrain stamp${
            patchClear.cleared === 1 ? '' : 's'
          }.`,
        )
        flashes.push({ keys: [...clearHexKeys], color: 'green' })
      }
      if (patchClear.cleared > 0 && clearChanceStat != null) {
        flashes.push({ keys: [...clearHexKeys], color: 'green' })
      }
    }
  }

  // Smoke Bomb / Explosive Trap: place a ground-effect zone (template + cast stats).
  // Cast must ONLY place — damage / stun / evasion numbers live on the zone and
  // apply later (passive while inside, or on Ground/Submerge entry). Do not run
  // the rest of applyOneEffect or radius_stat_div / inflicts_condition will fire
  // as an instant board-wide ability (the S6-26 Trap regression).
  // Fireball / Meteor / Wildfire are hybrids — skip this early exit.
  if (isPlaceOnlyGroundEffect(stats) && aimHex) {
    const effect = buildGroundEffectFromAbility(
      catalog,
      ability,
      stats,
      caster,
      casterSide,
      aimHex,
      tiles,
    )
    if (effect) {
      const placed = placeGroundEffectOnBattle(
        { ...battle, stacks, tombstones, groundEffects },
        effect,
        workingTiles,
      )
      groundEffects = placed.battle.groundEffects ?? []
      if (placed.tiles) {
        workingTiles = placed.tiles
      }
      lines.push(
        `${ability.name}: ${effect.name} placed (${effect.hexKeys.length} hex${
          effect.hexKeys.length === 1 ? '' : 'es'
        }).`,
      )
      flashes.push({
        keys: effect.hexKeys,
        color: effect.hidden ? 'yellow' : 'blue',
      })
      return {
        battle: syncTombstonesFromWipes(
          battle,
          { ...battle, stacks, tombstones, groundEffects, recurringHeals: [...(battle.recurringHeals ?? [])] },
          catalog,
        ),
        dealt: 0,
        flashes,
        lines,
        ...(workingTiles !== tiles ? { tiles: workingTiles } : {}),
      }
    }
  }

function scaleDamageVsTag(
  damage: number,
  catalog: ReferenceCatalog,
  target: CombatStack,
  stats: Record<string, unknown>,
): number {
  const mult = asFinite(stats.bonus_dmg_mult)
  if (mult == null || mult <= 0 || mult === 1 || damage <= 0) {
    return damage
  }
  const tags = (() => {
    const raw = stats.bonus_dmg_tag
    if (Array.isArray(raw)) {
      return raw
        .map((entry) => asFinite(entry))
        .filter((n): n is number => n != null && n > 0)
        .map((n) => Math.floor(n))
    }
    const single = asFinite(raw)
    return single != null && single > 0 ? [Math.floor(single)] : []
  })()
  if (tags.length === 0) {
    return damage
  }
  const unit = unitById(catalog, target.unitId)
  if (!tags.some((tag) => unitHasTag(unit, tag))) {
    return damage
  }
  return Math.max(0, Math.floor(damage * mult))
}

const hitOne = (target: CombatStack, raw: number) => {
    let victim = stacks.find((row) => row.id === target.id) ?? target
    const evadePct = Math.max(
      victim.evasion?.pct ?? 0,
      zoneEvasionPctForStack(
        { ...battle, stacks, tombstones, groundEffects },
        victim,
        catalog,
      ),
    )
    if (evadePct > 0 && random() * 100 < evadePct) {
      lines.push(
        chanceRollLog(stackName(catalog, victim), evadePct, true, {
          action: `to evade ${ability.name}`,
          success: 'evaded!',
        }),
      )
      return ''
    }
    const kind = abilityKind(ability)
    // Spell Reflect: Magic abilities redirect to a random enemy before damage.
    if (
      kind === 'magic' &&
      (victim.spellReflect?.usesLeft ?? 0) > 0
    ) {
      const pool = stacks.filter(
        (row) =>
          row.qty > 0 &&
          row.side !== victim.side &&
          !isHeroStack(row) &&
          !row.indestructible &&
          isCreatureArmyUnit(unitById(catalog, row.unitId)) &&
          !isUntargetableStack(row, catalog),
      )
      if (pool.length > 0) {
        const pick =
          pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!
        const left = (victim.spellReflect?.usesLeft ?? 1) - 1
        const buffed: CombatStack = {
          ...victim,
          spellReflect: left > 0 ? { usesLeft: left } : undefined,
        }
        stacks = writeCombatStack(stacks, victim.id, buffed)
        lines.push(
          `Spell Reflect: ${stackName(catalog, victim)} redirects ${ability.name} to ${stackName(catalog, pick)}!`,
        )
        victim = stacks.find((row) => row.id === pick.id) ?? pick
      }
    }
    const overflow = stats.kill_on_overflow === true
    const defender = heroForSide(victim.side, heroes)
    const scaled = scaleDamageVsTag(raw, catalog, victim, stats)
    const mit = mitigateIncoming(scaled, victim, catalog, kind, defender)
    const full = stackMaxHealth(victim, catalog)
    const applied = applyStackDamage(victim, mit.damage, full, overflow)
    const taken = applied.negated === true ? 0 : mit.damage
    dealt += taken
    let nextStack = applied.stack
    if (nextStack && taken > 0) {
      const hitTick = applyHitTickConditions(nextStack, catalog)
      nextStack = hitTick.stack
      lines.push(...hitTick.lines)
      const broken = applyBreaksOnDamage(nextStack, catalog)
      nextStack = broken.stack
      lines.push(...broken.lines)
    }
    stacks = writeCombatStack(stacks, victim.id, nextStack)
    if (applied.killed > 0) {
      battle = noteUnitDeaths(battle, victim.unitId, applied.killed)
    }
    if (applied.negated === true) {
      lines.push(
        `${ability.name} hit ${victim.qty} ${stackName(catalog, victim)} but Fortify negated the blow.`,
      )
      return occupancyKey(victim.q, victim.r)
    }
    const block =
      mit.blockBy && mit.blocked > 0
        ? ` (${mit.blocked} blocked by ${mit.blockBy})`
        : ''
    const died =
      applied.killed > 0
        ? ` and ${applied.killed} ${stackName(catalog, victim)} died`
        : ''
    const saved = applied.guardianSaved === true ? ' (Guardian Angel)' : ''
    lines.push(
      `${ability.name} hit ${victim.qty} ${stackName(catalog, victim)} for ${taken} dmg${block}${died}${saved}.`,
    )
    return occupancyKey(victim.q, victim.r)
  }

  const applyKnockback = (targetId: string): AbilityFlash | null => {
    const live = stacks.find((row) => row.id === targetId)
    if (!live || live.qty <= 0) {
      return null
    }
    const pushAway = stats.push_direction === 'away_from_caster'
    if (!pushAway && stats.move_type !== 'random') {
      return null
    }
    const chancePct = asFinite(stats.chance_pct)
    if (chancePct != null) {
      const triggered = rollChancePct(chancePct, random)
      lines.push(
        chanceRollLog(ability.name, chancePct, triggered, {
          action: 'to knock back',
        }),
      )
      if (!triggered) {
        return null
      }
    }
    const resistRaw = stats.resist_stat
    if (resistRaw === 'resistance' || resistRaw === 'defense') {
      const resistChance = Math.min(
        100,
        liveResistance(live, catalog, resistRaw),
      )
      if (Math.floor(random() * 100) < resistChance) {
        lines.push(
          `${live.qty} ${stackName(catalog, live)}: ${resistChance}% ${resistRaw} vs knockback — resisted!`,
        )
        return null
      }
    }
    let relocated: {
      battle: CombatBattle
      moved: boolean
      to: { q: number; r: number } | null
    }
    if (pushAway) {
      const flatDist = asFinite(stats.push_dist)
      const pushDiv = asFinite(stats.push_dist_stat_div)
      let distance = 0
      if (flatDist != null && flatDist > 0) {
        distance = Math.max(0, Math.floor(flatDist))
      } else if (pushDiv != null && pushDiv > 0) {
        distance = Math.max(
          0,
          Math.floor(
            casterStat(
              catalog,
              caster,
              ability.resource_id ?? ENERGY_RESOURCE_ID,
            ) / pushDiv,
          ),
        )
      }
      if (distance <= 0) {
        return null
      }
      const from =
        heroCasterHex({ ...battle, stacks }, casterSide) ??
        aimHex ??
        { q: live.q, r: live.r }
      relocated = relocateAwayFrom(
        { ...battle, stacks },
        catalog,
        workingTiles,
        targetId,
        from,
        distance,
      )
    } else {
      relocated = relocateRandom(
        { ...battle, stacks },
        catalog,
        workingTiles,
        targetId,
        stats,
        random,
      )
    }
    let nextBattle = relocated.battle
    if (relocated.moved) {
      const boom = tryTriggerGroundEffectsOnEnter(
        nextBattle,
        targetId,
        catalog,
        workingTiles,
        heroes,
        random,
      )
      nextBattle = boom.battle
      lines.push(...boom.lines)
      groundEffects = nextBattle.groundEffects ?? []
    }
    stacks = nextBattle.stacks
    battle = { ...nextBattle, stacks, groundEffects }
    if (relocated.moved && relocated.to) {
      lines.push(
        `${ability.name}: ${stackName(catalog, live)} knocked to (${relocated.to.q},${relocated.to.r}).`,
      )
      return {
        keys: [occupancyKey(relocated.to.q, relocated.to.r)],
        color: 'yellow',
      }
    }
    return null
  }

  const rollEachHit = abilityUsesDamageRoll(stats)
  const fixedRaw = rollEachHit
    ? null
    : rawAbilityDamage(stats, catalog, caster, random)
  if (fixedRaw != null || rollEachHit) {
    const keys: string[] = []
    const shape = shapeFromStats(stats)
    const skipFriendlyDmg = stats.friendly_takes_dmg === false
    const paceMultiHits = shape === 'multi' && stats.move_type === 'random'
    const nextRaw = () => {
      const rolled = rollEachHit
        ? rawAbilityDamage(stats, catalog, caster, random)
        : fixedRaw
      if (rolled == null) {
        return null
      }
      return applyEvokerArcaneSpellBonus(
        rolled,
        catalog,
        ability,
        caster,
        casterSide,
        battle,
      )
    }
    if (shape === 'multi') {
      const boltsStat = asFinite(stats.bolts_stat)
      const bolts =
        boltsStat != null
          ? Math.max(
              1,
              Math.floor(casterStat(catalog, caster, MANA_RESOURCE_ID) * boltsStat),
            )
          : Math.max(
              1,
              Math.floor(asFinite(stats.bolts) ?? asFinite(stats.targets) ?? 1),
            )
      const targetHexes = stats.targets_hexes === true
      const radius = Math.max(0, Math.floor(asFinite(stats.radius) ?? 0))
      const spikeUnitId = Math.floor(asFinite(stats.summon_unit_id) ?? 0)
      let hexPool =
        targetHexes
          ? radius > 0 && aimHex
            ? tiles.filter(
                (tile) =>
                  hexDistance(aimHex, { q: tile.q, r: tile.r }) <= radius,
              )
            : [...tiles]
          : []
      if (hexPool.length > 0 && asFlag(stats.avoids_los_blocker_hexes)) {
        const blocked = new Set(
          tiles
            .filter((tile) => tile.blocksLos)
            .map((tile) => occupancyKey(tile.q, tile.r)),
        )
        for (const key of liveWallLosKeys(stacks, catalog, tiles)) {
          blocked.add(key)
        }
        hexPool = hexPool.filter(
          (tile) => !blocked.has(occupancyKey(tile.q, tile.r)),
        )
      }
      if (hexPool.length > 0 && asFlag(stats.avoids_friendly_hexes)) {
        const friendly = new Set<string>()
        for (const row of stacks) {
          if (row.qty <= 0 || row.side !== casterSide) {
            continue
          }
          for (const hex of stackFootprint(row, catalog)) {
            friendly.add(occupancyKey(hex.q, hex.r))
          }
        }
        hexPool = hexPool.filter(
          (tile) => !friendly.has(occupancyKey(tile.q, tile.r)),
        )
      }
      const radiusTiles = hexPool
      const dropFireOnHit = asFlag(stats.drops_fire_on_hit)
      const tryPlaceSpike = (hex: { q: number; r: number }) => {
        if (spikeUnitId <= 0) {
          return null
        }
        const placed = placeBlockerAtHex(
          { ...battle, stacks, tombstones },
          catalog,
          tiles,
          ability,
          spikeUnitId,
          hex,
          casterSide,
          stats.persists_on_summon === true,
        )
        if (placed.battle.stacks.length === stacks.length) {
          return null
        }
        stacks = placed.battle.stacks
        battle = { ...battle, stacks }
        return placed
      }
      for (let i = 0; i < bolts; i += 1) {
        const beatLines: string[] = []
        const beatFlashes: AbilityFlash[] = []
        let pick: CombatStack | null = null
        let spikeHex: { q: number; r: number } | null = null
        if (targetHexes) {
          if (radiusTiles.length === 0) {
            break
          }
          const hex =
            radiusTiles[
              Math.min(
                radiusTiles.length - 1,
                Math.floor(random() * radiusTiles.length),
              )
            ]
          if (!hex) {
            break
          }
          spikeHex = { q: hex.q, r: hex.r }
          const hexKey = occupancyKey(hex.q, hex.r)
          const occupant =
            stackOccupyingHex(stacks, hex.q, hex.r, catalog) ??
            stacks.find((row) => row.q === hex.q && row.r === hex.r && row.qty > 0) ??
            null
          const hittable =
            occupant &&
            occupant.qty > 0 &&
            !occupant.indestructible &&
            !isHeroStack(occupant) &&
            isCreatureArmyUnit(unitById(catalog, occupant.unitId)) &&
            !isUntargetableStack(occupant, catalog)
              ? stacks.find((row) => row.id === occupant.id) ?? occupant
              : null
          if (!hittable) {
            // Empty hex — spike graphic pops in with this beat.
            const placed = tryPlaceSpike(spikeHex)
            if (placed) {
              beatFlashes.push(...placed.flashes)
              if (!paceMultiHits) {
                flashes.push(...placed.flashes)
              }
            } else {
              beatFlashes.push({ keys: [hexKey], color: 'yellow' })
            }
            if (dropFireOnHit && spikeHex) {
              const fire = placeFireOnHexKeys(
                { ...battle, stacks, tombstones, groundEffects },
                catalog,
                caster,
                casterSide,
                [occupancyKey(spikeHex.q, spikeHex.r)],
                workingTiles,
                ability,
              )
              battle = fire.battle
              stacks = fire.battle.stacks
              tombstones = fire.battle.tombstones ?? tombstones
              groundEffects = fire.battle.groundEffects ?? []
              if (fire.tiles) {
                workingTiles = fire.tiles
              }
              if (fire.placedKeys.length > 0) {
                const msg = `${ability.name}: Fire ignites.`
                lines.push(msg)
                beatLines.push(msg)
                beatFlashes.push({ keys: fire.placedKeys, color: 'blue' })
                if (!paceMultiHits) {
                  flashes.push({ keys: fire.placedKeys, color: 'blue' })
                }
              }
            }
            if (paceMultiHits) {
              snapshotBeat(beatLines, beatFlashes)
            }
            continue
          }
          pick = hittable
        } else {
          const pool = liveTargets()
          if (pool.length === 0) {
            break
          }
          pick =
            pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ??
            null
          if (!pick) {
            break
          }
        }
        const skipDmg = skipFriendlyDmg && pick.side === casterSide
        if (skipDmg) {
          const msg = `${ability.name}: ${stackName(catalog, pick)} knocked (no friendly damage).`
          lines.push(msg)
          beatLines.push(msg)
          const knockBefore = lines.length
          const knockFlash = applyKnockback(pick.id)
          beatLines.push(...lines.slice(knockBefore))
          if (knockFlash) {
            keys.push(...knockFlash.keys)
            beatFlashes.push(knockFlash)
            if (!paceMultiHits) {
              flashes.push(knockFlash)
            }
          }
        } else {
          const raw = nextRaw()
          if (raw == null) {
            break
          }
          const lineBefore = lines.length
          const key = hitOne(pick, raw)
          if (key) {
            keys.push(key)
            beatFlashes.push({ keys: [key], color: 'red' })
          }
          beatLines.push(...lines.slice(lineBefore))
          const knockBefore = lines.length
          const knockFlash = applyKnockback(pick.id)
          beatLines.push(...lines.slice(knockBefore))
          if (knockFlash) {
            beatFlashes.push(knockFlash)
            if (!paceMultiHits) {
              flashes.push(knockFlash)
            }
          }
        }
        // After knockback, raise the spike on the erupted hex if it is open.
        if (spikeHex) {
          const placed = tryPlaceSpike(spikeHex)
          if (placed) {
            beatFlashes.push(...placed.flashes)
            if (!paceMultiHits) {
              flashes.push(...placed.flashes)
            }
          }
          if (dropFireOnHit) {
            const fire = placeFireOnHexKeys(
              { ...battle, stacks, tombstones, groundEffects },
              catalog,
              caster,
              casterSide,
              [occupancyKey(spikeHex.q, spikeHex.r)],
              workingTiles,
              ability,
            )
            battle = fire.battle
            stacks = fire.battle.stacks
            tombstones = fire.battle.tombstones ?? tombstones
            groundEffects = fire.battle.groundEffects ?? []
            if (fire.tiles) {
              workingTiles = fire.tiles
            }
            if (fire.placedKeys.length > 0) {
              const msg = `${ability.name}: Fire ignites.`
              lines.push(msg)
              beatLines.push(msg)
              beatFlashes.push({ keys: fire.placedKeys, color: 'blue' })
              if (!paceMultiHits) {
                flashes.push({ keys: fire.placedKeys, color: 'blue' })
              }
            }
          }
        }
        if (paceMultiHits) {
          snapshotBeat(beatLines, beatFlashes)
        }
      }
    } else if (shape === 'chain') {
      const casterHex =
        heroCasterHex({ ...battle, stacks }, casterSide) ??
        aimHex ??
        { q: 0, r: 0 }
      const origin = dummyCaster(casterSide, casterHex)
      const aimed =
        (aimHex
          ? stackOccupyingHex(stacks, aimHex.q, aimHex.r, catalog) ??
            stacks.find(
              (row) => row.q === aimHex.q && row.r === aimHex.r && row.qty > 0,
            )
          : null) ??
        targets[0] ??
        null
      const spec = shapeSpecFromStats(
        stats,
        undefined,
        caster,
        catalog,
        ability.resource_id ?? MANA_RESOURCE_ID,
      )
      const chainHits = resolveShapeHits(
        origin,
        aimHex ?? { q: aimed?.q ?? 0, r: aimed?.r ?? 0 },
        aimed,
        { ...battle, stacks },
        catalog,
        tiles,
        random,
        {
          shape: 'chain',
          jumps: spec.jumps,
          falloff: spec.falloff,
        },
        false,
        { allowRepeatTarget: asFlag(stats.allow_repeat_target) },
      )
      for (const hit of chainHits) {
        if (!hit.stack || hit.stack.qty <= 0) {
          continue
        }
        const live = stacks.find((row) => row.id === hit.stack!.id)
        if (!live || live.qty <= 0) {
          continue
        }
        const skipDmg = skipFriendlyDmg && live.side === casterSide
        if (skipDmg) {
          continue
        }
        const raw = nextRaw()
        if (raw == null) {
          break
        }
        const scaled = Math.max(
          0,
          Math.floor((raw * Math.max(0, hit.dmgPct)) / 100),
        )
        const key = hitOne(live, scaled)
        if (key) {
          keys.push(key)
        }
      }
    } else {
      for (const target of liveTargets()) {
        const skipDmg = skipFriendlyDmg && target.side === casterSide
        if (skipDmg) {
          const knockFlash = applyKnockback(target.id)
          if (knockFlash) {
            flashes.push(knockFlash)
          }
          continue
        }
        const raw = nextRaw()
        if (raw == null) {
          break
        }
        const key = hitOne(target, raw)
        if (key) {
          keys.push(key)
        }
        const knockFlash = applyKnockback(target.id)
        if (knockFlash) {
          flashes.push(knockFlash)
        }
      }
    }
    if (keys.length > 0 && !paceMultiHits) {
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
          const hitTick = applyHitTickConditions(nextStack, catalog)
          nextStack = hitTick.stack
          lines.push(...hitTick.lines)
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
          if (struck.blindMiss === true) {
            notes.push(
              `missed (Blind ${formatChancePct(struck.missChancePct ?? BLIND_MISS_PCT)}%)`,
            )
          } else if (
            struck.missChancePct != null &&
            struck.missChancePct > 0
          ) {
            notes.push(
              `missed (${formatChancePct(struck.missChancePct)}% evade)`,
            )
          } else {
            notes.push('missed')
          }
        }
        if (struck.guardianSaved) {
          notes.push('Guardian Angel')
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

  // Fireball: after the direct hit, each hex in intel/fire_radius_stat_div of the
  // aim independently rolls fire_drop_chance_pct to place Fire (incl. target hex).
  if (isFireballStats(stats) && aimHex) {
    const intel = casterStat(catalog, caster, MANA_RESOURCE_ID)
    const div = asFinite(stats.fire_radius_stat_div) ?? 9
    const chance = asFinite(stats.fire_drop_chance_pct) ?? 50
    const radius = Math.max(0, Math.floor(intel / Math.max(1, div)))
    const fireKeys: string[] = []
    let attempted = 0
    let hits = 0
    for (const tile of tiles) {
      if (hexDistance(aimHex, { q: tile.q, r: tile.r }) > radius) {
        continue
      }
      attempted += 1
      if (rollChancePct(chance, random)) {
        hits += 1
        fireKeys.push(occupancyKey(tile.q, tile.r))
      }
    }
    lines.push(
      chanceRollLog(ability.name, chance, hits > 0, {
        action: 'Fire drop per hex',
        success: `${hits}/${attempted} hexes catch.`,
        fail: `0/${attempted} hexes catch.`,
      }),
    )
    if (fireKeys.length > 0) {
      const fire = placeFireOnHexKeys(
        { ...battle, stacks, tombstones, groundEffects },
        catalog,
        caster,
        casterSide,
        fireKeys,
        workingTiles,
        ability,
      )
      battle = fire.battle
      stacks = fire.battle.stacks
      tombstones = fire.battle.tombstones ?? tombstones
      groundEffects = fire.battle.groundEffects ?? []
      if (fire.tiles) {
        workingTiles = fire.tiles
      }
      if (fire.placedKeys.length > 0) {
        flashes.push({ keys: fire.placedKeys, color: 'blue' })
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

  // Resurrection: revive a % of the targeted stack's dead units, or a
  // wiped own-side tombstone (full wipe leaves a marker to click).
  // Floor of 1 whenever deficit > 0 (S6-18-style) so small losses never
  // round the cast into a no-op; no-op only when there is truly 0 dead.
  const revivePctStat = asFinite(stats.revive_pct_stat)
  const revivePctMin = asFinite(stats.revive_pct_min)
  const revivePctMax = asFinite(stats.revive_pct_max)
  if (revivePctStat != null && revivePctMin != null && revivePctMax != null) {
    const intel = casterStat(catalog, caster, MANA_RESOURCE_ID)
    const rawPct = intel * revivePctStat
    const pct = Math.max(revivePctMin, Math.min(revivePctMax, rawPct))
    const percent = Math.floor(pct)
    if (percent > 0) {
      let revivedAny = false
      for (const target of liveTargets()) {
        const live = stacks.find((row) => row.id === target.id)
        if (!live || live.qty <= 0) {
          continue
        }
        const dead = Math.max(0, live.startingQty - live.qty)
        if (dead <= 0) {
          continue
        }
        const revived = Math.min(
          dead,
          Math.max(1, Math.floor((dead * percent) / 100)),
        )
        const nextQty = Math.min(live.startingQty, live.qty + revived)
        if (nextQty <= live.qty) {
          continue
        }
        stacks = writeCombatStack(stacks, live.id, {
          ...live,
          qty: nextQty,
        })
        lines.push(
          `${ability.name}: ${stackName(catalog, live)} revived +${revived}.`,
        )
        buffKeys.push(occupancyKey(live.q, live.r))
        revivedAny = true
      }
      if (!revivedAny && aimHex) {
        const requiredTag = asFinite(stats.target_tag_required)
        const tomb =
          tombstones.find(
            (row) => row.q === aimHex.q && row.r === aimHex.r,
          ) ?? null
        if (
          tomb &&
          tombstoneMatchesReviveTarget(
            tomb,
            casterSide,
            catalog,
            requiredTag ?? null,
          )
        ) {
          const dead = Math.max(0, tomb.deadQty)
          if (dead > 0) {
            const revived = Math.min(
              dead,
              Math.max(1, Math.floor((dead * percent) / 100)),
            )
            const raised = stackFromTombstone(tomb, catalog, revived)
            stacks = [...stacks.filter((row) => row.id !== raised.id), raised]
            tombstones = tombstones.filter((row) => row.id !== tomb.id)
            lines.push(
              `${ability.name}: ${stackName(catalog, raised)} revived +${revived}.`,
            )
            buffKeys.push(occupancyKey(raised.q, raised.r))
          }
        }
      }
    }
  }

  const conditionId = Math.floor(asFinite(stats.inflicts_condition) ?? 0)
  if (conditionId > 0) {
    const hitDiv = statDiv(stats, 'hit_count_stat_div')
    const hitBudget =
      hitDiv != null && hitDiv > 0
        ? Math.floor(
            casterStat(catalog, caster, ability.resource_id) / hitDiv,
          )
        : null
    const durationDiv = statDiv(stats, 'duration_stat_div')
    const durationFromStat =
      durationDiv != null
        ? Math.floor(
            casterStat(catalog, caster, ability.resource_id) / durationDiv,
          )
        : null
    for (const target of liveTargets()) {
      const live = stacks.find((row) => row.id === target.id)
      if (!live) {
        continue
      }
      if (hitBudget != null && hitBudget <= 0) {
        continue
      }
      const duration =
        hitBudget != null
          ? hitBudget
          : durationFromStat != null
            ? Math.max(1, durationFromStat)
            : Math.max(1, Math.floor(asFinite(stats.duration) ?? 1))
      if (duration <= 0) {
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
          duration,
          requiredTag: asFinite(stats.target_tag_required),
          extra: {
            roundTick: hitBudget == null,
            hitTick: hitBudget != null,
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

  if (stats.clears_conditions === true) {
    const primaryIds = new Set<string>()
    for (const target of liveTargets()) {
      const live = stacks.find((row) => row.id === target.id)
      if (!live || live.qty <= 0) {
        continue
      }
      primaryIds.add(live.id)
      const cleared = clearNegativeConditions(live, catalog)
      stacks = writeCombatStack(stacks, live.id, cleared.stack)
      if (cleared.cleared.length > 0) {
        lines.push(
          `${ability.name}: cleared ${cleared.cleared.join(', ')} from ${stackName(catalog, live)}.`,
        )
        buffKeys.push(occupancyKey(live.q, live.r))
      }
    }
    const secondaryDiv = statDiv(stats, 'secondary_random_targets_stat_div')
    if (
      secondaryDiv != null &&
      stats.secondary_pool === 'friend_with_negative_condition'
    ) {
      const intel = heroEffectiveStats(
        catalog,
        caster.class_id,
        caster.current_level,
      ).intel
      const want = Math.max(0, Math.floor(intel / secondaryDiv))
      if (want > 0) {
        const pool = stacks.filter(
          (row) =>
            row.side === casterSide &&
            row.qty > 0 &&
            !isHeroStack(row) &&
            !primaryIds.has(row.id) &&
            hasNegativeCondition(row, catalog),
        )
        const picks = pickRandomSubset(pool, want, random)
        for (const pick of picks) {
          const live = stacks.find((row) => row.id === pick.id)
          if (!live || live.qty <= 0) {
            continue
          }
          const cleared = clearNegativeConditions(live, catalog)
          stacks = writeCombatStack(stacks, live.id, cleared.stack)
          if (cleared.cleared.length > 0) {
            lines.push(
              `${ability.name}: also cleared ${cleared.cleared.join(', ')} from ${stackName(catalog, live)}.`,
            )
            buffKeys.push(occupancyKey(live.q, live.r))
          }
        }
      }
    }
  }

  if (
    stats.snapshot_qty_on_cast === true &&
    stats.prevents_death_once === true
  ) {
    const uses = Math.max(1, Math.floor(asFinite(stats.uses) ?? 1))
    for (const target of liveTargets()) {
      const live = stacks.find((row) => row.id === target.id)
      if (!live || live.qty <= 0) {
        continue
      }
      stacks = writeCombatStack(stacks, live.id, {
        ...live,
        guardianAngel: { snapshotQty: live.qty, usesLeft: uses },
      })
      lines.push(
        `${ability.name}: ${stackName(catalog, live)} protected (snapshot ${live.qty}).`,
      )
      buffKeys.push(occupancyKey(live.q, live.r))
    }
  }

  if (stats.ignores_sublethal_damage === true) {
    for (const target of liveTargets()) {
      const live = stacks.find((row) => row.id === target.id)
      if (!live || live.qty <= 0) {
        continue
      }
      stacks = writeCombatStack(stacks, live.id, {
        ...live,
        ignoresSublethal: true,
      })
      lines.push(
        `${ability.name}: ${stackName(catalog, live)} ignores sub-lethal hits.`,
      )
      buffKeys.push(occupancyKey(live.q, live.r))
    }
  }

  const minQtyDiv = asFinite(stats.min_qty_stat_div)
  if (minQtyDiv != null && minQtyDiv > 0) {
    const minQty = Math.max(
      0,
      Math.floor(
        casterStat(
          catalog,
          caster,
          ability.resource_id ?? ENERGY_RESOURCE_ID,
        ) / minQtyDiv,
      ),
    )
    const lastUnitHp = Math.max(
      1,
      Math.floor(asFinite(stats.min_qty_last_unit_hp) ?? 1),
    )
    if (minQty > 0) {
      for (const target of liveTargets()) {
        const live = stacks.find((row) => row.id === target.id)
        if (!live || live.qty <= 0) {
          continue
        }
        stacks = writeCombatStack(stacks, live.id, {
          ...live,
          lastStand: { minQty, lastUnitHp },
        })
        lines.push(
          `${ability.name}: ${stackName(catalog, live)} cannot drop below ${minQty} (last at ${lastUnitHp} HP).`,
        )
        buffKeys.push(occupancyKey(live.q, live.r))
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

  // Mass Heal: top off every friendly stack's front-unit HP (sub-lethal only).
  if (stats.heals_to_full === true) {
    const healedKeys: string[] = []
    for (const target of liveTargets()) {
      const live = stacks.find((row) => row.id === target.id)
      if (!live || live.qty <= 0) {
        continue
      }
      const maxHp = stackMaxHealth(live, catalog)
      if (live.topHealth >= maxHp) {
        continue
      }
      stacks = writeCombatStack(stacks, live.id, {
        ...live,
        topHealth: maxHp,
      })
      lines.push(
        `${ability.name}: ${stackName(catalog, live)} healed to full.`,
      )
      healedKeys.push(occupancyKey(live.q, live.r))
    }
    if (healedKeys.length > 0) {
      flashes.push({ keys: healedKeys, color: 'green' })
    }
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

  // Brisk Renewal: battle-long end-of-round heal on the caster's side.
  let recurringHeals = [...(battle.recurringHeals ?? [])]
  if (stats.recurring_trigger === 'end_of_round') {
    const healPctStat = asFinite(stats.heal_pct_stat)
    const healMin = Math.max(1, Math.floor(asFinite(stats.heal_min) ?? 1))
    if (healPctStat != null) {
      recurringHeals.push({
        side: casterSide,
        healPctStat,
        healMin,
        intel: casterStat(catalog, caster, MANA_RESOURCE_ID),
      })
      lines.push(`${ability.name}: renews each round for the rest of battle.`)
      flashes.push({
        keys: liveTargets().map((row) => occupancyKey(row.q, row.r)),
        color: 'blue',
      })
    }
  }

  // Ice Shards: place blockers around the aimed target hex.
  if (isIceShardStats(stats)) {
    const around =
      aimHex ??
      (targets[0] != null ? { q: targets[0].q, r: targets[0].r } : null)
    if (around) {
      const shards = applyIceShardPlacement(
        { ...battle, stacks, tombstones },
        catalog,
        workingTiles,
        ability,
        stats,
        around,
        casterSide,
        random,
      )
      stacks = shards.battle.stacks
      lines.push(...shards.lines)
      flashes.push(...shards.flashes)
    }
  }

  // Earth Spikes with targets_hexes place one spike per bolt inside the hit
  // loop (synced to beat pacing). Batch radius drop is only for other abilities.
  if (isRadiusTerrainDropStats(stats) && aimHex) {
    const spikes = applyRadiusBlockerPlacement(
      { ...battle, stacks, tombstones },
      catalog,
      workingTiles,
      ability,
      stats,
      aimHex,
      casterSide,
      random,
    )
    stacks = spikes.battle.stacks
    lines.push(...spikes.lines)
    flashes.push(...spikes.flashes)
  }

  return {
    battle: syncTombstonesFromWipes(
      battle,
      { ...battle, stacks, tombstones, groundEffects, recurringHeals },
      catalog,
    ),
    dealt,
    flashes,
    lines,
    ...(beats.length > 0 ? { beats } : {}),
    ...(workingTiles !== tiles ? { tiles: workingTiles } : {}),
  }
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
  aim: { targetId: string | null; hex: Axial; lineDir?: Axial | null },
  heroes: CombatHeroes,
  random: () => number = Math.random,
): AbilityResolve | null {
  const stats = asRecord(ability.stats)
  if (!stats || !hasEffectKeys(stats)) {
    return null
  }
  // Seeds of Shadow: scatter intel×seed_count_stat Shadow tiles (no aim, no dmg).
  // Must run before the generic ground_effect_id disk placer.
  if (isSeedsOfShadowStats(stats)) {
    const factor = Math.max(0, asFinite(stats.seed_count_stat) ?? 0)
    const intel = casterStat(catalog, caster, MANA_RESOURCE_ID)
    const count = Math.max(0, Math.floor(intel * factor))
    const unitOcc = occupiedHexes(battle.stacks, catalog)
    const seeded = scatterShadowSeeds(
      battle,
      tiles,
      count,
      casterSide,
      unitOcc,
      random,
    )
    const placed = seeded.placedKeys.length
    return {
      battle: seeded.battle,
      log: {
        lines: [
          placed > 0
            ? `${ability.name}: ${placed} Shadow tile${placed === 1 ? '' : 's'} sprout${placed === 1 ? 's' : ''} (${seeded.attempted} seed${seeded.attempted === 1 ? '' : 's'}).`
            : `${ability.name}: no open ground for Shadow (${seeded.attempted} seed${seeded.attempted === 1 ? '' : 's'}).`,
        ],
      },
      flashes:
        placed > 0
          ? [{ keys: seeded.placedKeys, color: 'blue' }]
          : [],
    }
  }
  // Barricade (Barrier ability): line of ground_effect hexes (preview via aim keys).
  // Must run before the generic disk placer so line_length_stat_div wins.
  if (isBarrierStats(stats)) {
    const lengthDiv = asFinite(stats.line_length_stat_div)
    if (lengthDiv == null || lengthDiv <= 0) {
      return {
        battle,
        log: { lines: [] },
        flashes: [],
        noOp: true,
      }
    }
    const length = Math.max(
      1,
      Math.floor(
        casterStat(
          catalog,
          caster,
          ability.resource_id ?? ENERGY_RESOURCE_ID,
        ) / lengthDiv,
      ),
    )
    const dir = barrierLineDir(
      heroCasterHex(battle, casterSide),
      aim.hex,
      aim.lineDir,
    )
    const occupied = occupiedHexes(battle.stacks, catalog)
    const line = barrierLineHexes(
      aim.hex,
      length,
      dir,
      boardKeys(tiles),
      occupied,
      asFlag(stats.avoids_occupied_hexes),
    )
    if (line.length === 0) {
      return {
        battle,
        log: { lines: [`${ability.name}: no open hexes for a Barricade.`] },
        flashes: [],
        noOp: true,
      }
    }
    const base = buildGroundEffectFromAbility(
      catalog,
      ability,
      stats,
      caster,
      casterSide,
      aim.hex,
      tiles,
    )
    if (!base) {
      return {
        battle,
        log: { lines: [] },
        flashes: [],
        noOp: true,
      }
    }
    const effect = {
      ...base,
      hexKeys: line.map((hex) => occupancyKey(hex.q, hex.r)),
    }
    const placed = placeGroundEffectOnBattle(battle, effect, tiles)
    return {
      battle: placed.battle,
      ...(placed.tiles ? { tiles: placed.tiles } : {}),
      log: {
        lines: [
          `${ability.name}: ${effect.name} stretches across ${line.length} hex${
            line.length === 1 ? '' : 'es'
          }.`,
        ],
      },
      flashes: [
        {
          keys: effect.hexKeys,
          color: 'blue',
        },
      ],
    }
  }
  // Wildfire: Fire along hexLine from the casting Hero hex through the aim hex.
  // Skip LOS-blocker hexes but continue the line (do not stop short).
  if (isWildfireStats(stats)) {
    const from = heroCasterHex(battle, casterSide)
    if (!from) {
      return {
        battle,
        log: { lines: [`${ability.name}: no hero hex to start from.`] },
        flashes: [],
        noOp: true,
      }
    }
    const line = hexLine(from, aim.hex)
    const blocked = new Set(
      tiles
        .filter((tile) => tile.blocksLos)
        .map((tile) => occupancyKey(tile.q, tile.r)),
    )
    for (const key of liveWallLosKeys(battle.stacks, catalog, tiles)) {
      blocked.add(key)
    }
    const fireKeys = line
      .filter((hex) => !blocked.has(occupancyKey(hex.q, hex.r)))
      .map((hex) => occupancyKey(hex.q, hex.r))
    if (fireKeys.length === 0) {
      return {
        battle,
        log: { lines: [`${ability.name}: no open hexes for Fire.`] },
        flashes: [],
        noOp: true,
      }
    }
    const placed = placeFireOnHexKeys(
      battle,
      catalog,
      caster,
      casterSide,
      fireKeys,
      tiles,
      ability,
    )
    return {
      battle: placed.battle,
      ...(placed.tiles ? { tiles: placed.tiles } : {}),
      log: {
        lines: [
          `${ability.name}: Fire races across ${placed.placedKeys.length} hex${
            placed.placedKeys.length === 1 ? '' : 'es'
          }.`,
        ],
      },
      flashes: [{ keys: placed.placedKeys, color: 'blue' }],
    }
  }
  // Ground-effect abilities: place the zone only. Detonation / passive numbers
  // are snapshotted onto the zone — never resolve as an instant board effect.
  // Hybrids (Fireball / Meteor) fall through to applyOneEffect.
  if (isPlaceOnlyGroundEffect(stats)) {
    const effect = buildGroundEffectFromAbility(
      catalog,
      ability,
      stats,
      caster,
      casterSide,
      aim.hex,
      tiles,
    )
    if (!effect) {
      return {
        battle,
        log: { lines: [] },
        flashes: [],
        noOp: true,
      }
    }
    const placed = placeGroundEffectOnBattle(battle, effect, tiles)
    return {
      battle: placed.battle,
      ...(placed.tiles ? { tiles: placed.tiles } : {}),
      log: {
        lines: [
          `${ability.name}: ${effect.name} placed (${effect.hexKeys.length} hex${
            effect.hexKeys.length === 1 ? '' : 'es'
          }).`,
        ],
      },
      flashes: [
        {
          keys: effect.hexKeys,
          color: effect.hidden ? 'yellow' : 'blue',
        },
      ],
    }
  }
  if (stats.ends_round_immediately === true) {
    const next = forceEndRound(battle, catalog, random, {
      skipDurationTicks: stats.skips_duration_tick === true,
      tiles,
      heroes,
    })
    const lines = [
      `${ability.name}: the round ends immediately!`,
      ...(next.roundLog ?? []),
    ]
    return {
      battle: { ...next, roundLog: [] },
      log: { lines, holdTurn: true },
      flashes: [],
      endsRound: true,
    }
  }
  if (asFlag(stats.self_teleport)) {
    const landing = aim.hex
    const subject =
      (aim.targetId
        ? battle.stacks.find((row) => row.id === aim.targetId)
        : null) ?? null
    if (
      !subject ||
      subject.qty <= 0 ||
      subject.side !== casterSide ||
      isHeroStack(subject)
    ) {
      return {
        battle,
        log: { lines: [] },
        flashes: [],
        noOp: true,
      }
    }
    const relocated = relocateToHex(
      battle,
      catalog,
      tiles,
      subject.id,
      landing,
    )
    if (!relocated.moved) {
      return {
        battle,
        log: { lines: [] },
        flashes: [],
        noOp: true,
      }
    }
    const triggered = tryTriggerGroundEffectsOnEnter(
      relocated.battle,
      subject.id,
      catalog,
      tiles,
      heroes,
      random,
    )
    const delay = Math.max(
      0,
      Math.floor(asFinite(stats.move_delay_ms) ?? 500),
    )
    return {
      battle: triggered.battle,
      log: {
        lines: [
          `${ability.name}: ${stackName(catalog, subject)} steps to (${landing.q},${landing.r}).`,
          ...triggered.lines,
        ],
      },
      flashes: [
        {
          keys: [
            occupancyKey(subject.q, subject.r),
            occupancyKey(landing.q, landing.r),
            ...triggered.hitKeys,
          ],
          color: 'blue',
        },
      ],
      moveDelayMs: delay,
      preMoveBattle: battle,
    }
  }
  if (asFlag(stats.duplicates_target)) {
    const subject =
      (aim.targetId
        ? battle.stacks.find((row) => row.id === aim.targetId)
        : null) ?? null
    if (!subject || subject.qty <= 0) {
      return {
        battle,
        log: { lines: [] },
        flashes: [],
        noOp: true,
      }
    }
    const mirrored = applyMirrorImage(
      battle,
      catalog,
      tiles,
      ability,
      stats,
      caster,
      casterSide,
      subject,
    )
    return {
      battle: mirrored.battle,
      log: {
        lines:
          mirrored.lines.length > 0
            ? mirrored.lines
            : [`${ability.name} had no effect.`],
      },
      flashes: mirrored.flashes,
    }
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
      { targetId: aim.targetId, hex: aim.hex },
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
  const beats: AbilityBeat[] = []
  let next = battle
  let dealt = 0
  let nextTiles: CombatTile[] | undefined

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
        caster,
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
        nextTiles ?? tiles,
          aim.hex,
      )
      next = result.battle
      dealt += result.dealt
      lines.push(...result.lines)
      flashes.push(...result.flashes)
      if (result.beats) {
        beats.push(...result.beats)
      }
      if (result.tiles) {
        nextTiles = result.tiles
      }
    }
    if (allyStats) {
      const allies = collectTargets(
        next,
        catalog,
        nextTiles ?? tiles,
        casterSide,
        ability,
        allyStats,
        aim,
        'friend',
        'all',
        caster,
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
        nextTiles ?? tiles,
          aim.hex,
      )
      next = result.battle
      lines.push(...result.lines)
      flashes.push(...result.flashes)
      if (result.beats) {
        beats.push(...result.beats)
      }
      if (result.tiles) {
        nextTiles = result.tiles
      }
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
      caster,
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
      aim.hex,
    )
    next = result.battle
    lines.push(...result.lines)
    flashes.push(...result.flashes)
    if (result.beats) {
      beats.push(...result.beats)
    }
    if (result.tiles) {
      nextTiles = result.tiles
    }
  }

  if (lines.length === 0) {
    // Utility/Buff/Debuff-style abilities should not spend resource/cooldown
    // when they would have no eligible effect.
    if (ability.ability_type_id === 1) {
      lines.push(`${ability.name} had no effect.`)
    }
  }
  // Any live speed change (buff OR debuff) re-sorts that side's remaining
  // queue immediately. DB resorts_remaining_initiative still forces a pass
  // for the caster side when set, but Slow/Mass Slow no longer depend on it.
  {
    const changedSides = combatSpeedChangedSides(battle, next, catalog)
    const sides =
      changedSides.length > 0
        ? changedSides
        : asFlag(stats.resorts_remaining_initiative)
          ? [casterSide]
          : []
    if (sides.length > 0) {
      const before = next.order.join('\0')
      next = resortRemainingInitiativeForSides(next, catalog, sides)
      if (next.order.join('\0') !== before) {
        lines.push(`${ability.name}: remaining initiative re-sorted.`)
      }
    }
  }
  return {
    battle: next,
    log: { lines },
    flashes,
    ...(beats.length > 0 ? { beats } : {}),
    ...(nextTiles ? { tiles: nextTiles } : {}),
    noOp: ability.ability_type_id !== 1 && lines.length === 0 ? true : undefined,
  }
}
