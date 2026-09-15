import type { Axial } from '../hex/hero'
import { hexDistance } from '../hex/pathfinding'
import type { AbilityRow, GroundEffectRow, ReferenceCatalog } from '../town/catalog'
import {
  heroEffectiveStats,
  terrainByName,
  unitAttackShape,
  unitById,
} from '../town/catalog'
import type { Hero } from '../session/types'
import {
  isHeroStack,
  noteUnitDeaths,
  stackMaxHealth,
  type CombatBattle,
  type CombatGroundEffect,
  type CombatSide,
  type CombatStack,
  type CombatTile,
} from './battle'
import {
  applyStackDamage,
  heroForSide,
  mitigateIncoming,
  type CombatHeroes,
} from './attack'
import { tryInflictSpec, applyBreaksOnDamage } from './condition'
import { chanceRollLog, rollChancePct } from './combatLog'
import { occupancyKey, stackFootprint } from './occupancy'
import { hexKey, moveKindForUnit, type MoveKind } from './movement'
import { syncTombstonesFromWipes } from './tombstone'
import { applySelfRezThenTombstones } from './confluence'
import { isSiegeEngineUnit, isWallSegmentUnit } from './siege'

export { zoneEvasionPctForStack, visibleGroundEffects } from './groundEvasion'

let groundEffectSeq = 0

function nextGroundId(): string {
  groundEffectSeq += 1
  return `ge-${groundEffectSeq}`
}

function asFinite(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function stackName(catalog: ReferenceCatalog, stack: CombatStack): string {
  return unitById(catalog, stack.unitId)?.name ?? 'Unknown'
}

function casterStrength(catalog: ReferenceCatalog, caster: Hero): number {
  return heroEffectiveStats(catalog, caster.class_id, caster.current_level)
    .strength
}

function casterIntel(catalog: ReferenceCatalog, caster: Hero): number {
  return heroEffectiveStats(catalog, caster.class_id, caster.current_level)
    .intel
}

/** Fire (id 6) — not Storm; Storm shares timing but is a separate template. */
function isFireMechanic(
  mechanicType: string,
  effect: string,
  templateId: number,
): boolean {
  if (templateId === STORM_GROUND_EFFECT_ID || effect === 'storm') {
    return false
  }
  return (
    templateId === FIRE_GROUND_EFFECT_ID ||
    effect === 'fire' ||
    (mechanicType === 'entry_and_turn_start_damage' &&
      templateId !== STORM_GROUND_EFFECT_ID)
  )
}

function isStormMechanic(
  effect: string,
  templateId: number,
): boolean {
  return templateId === STORM_GROUND_EFFECT_ID || effect === 'storm'
}

/** Fire or Storm: entry + turn-start flat damage zones. */
function isEntryTurnStartDamageZone(zone: {
  templateId: number
  mechanicType: string
  effect: string
}): boolean {
  return (
    isFireMechanic(zone.mechanicType, zone.effect, zone.templateId) ||
    isStormMechanic(zone.effect, zone.templateId)
  )
}

export const FIRE_GROUND_EFFECT_ID = 6
export const STORM_GROUND_EFFECT_ID = 7
const DEFAULT_FIRE_FIZZLE_TERRAIN_IDS = [11, 14, 16]
const DEFAULT_STORM_DMG_MULT = 1.5
const DEFAULT_STORM_EXPIRES_ROUNDS = 2

/** Terrain type ids where Fire placement creates no tile (Water/Shallows/Swamp). */
export function fireFizzleTerrainIds(catalog: ReferenceCatalog): Set<number> {
  const mechanic = asRecord(
    resolveGroundEffectTemplate(catalog, FIRE_GROUND_EFFECT_ID).mechanic,
  )
  const raw = mechanic?.fizzles_on_terrain
  if (!Array.isArray(raw) || raw.length === 0) {
    return new Set(DEFAULT_FIRE_FIZZLE_TERRAIN_IDS)
  }
  const ids = raw
    .map((value) => Math.floor(Number(value)))
    .filter((id) => Number.isFinite(id) && id > 0)
  return new Set(ids.length > 0 ? ids : DEFAULT_FIRE_FIZZLE_TERRAIN_IDS)
}

/**
 * Drop hexes whose combat terrain is in Fire's fizzles_on_terrain list.
 * Attempts still "count" for bolt/roll trackers — only actual placement is skipped.
 */
export function filterFirePlaceableHexKeys(
  hexKeys: string[],
  tiles: CombatTile[] | undefined,
  catalog: ReferenceCatalog,
): string[] {
  const unique = [...new Set(hexKeys.filter((key) => key.length > 0))]
  if (!tiles || tiles.length === 0) {
    return unique
  }
  const fizzleIds = fireFizzleTerrainIds(catalog)
  if (fizzleIds.size === 0) {
    return unique
  }
  const byKey = new Map(
    tiles.map((tile) => [occupancyKey(tile.q, tile.r), tile]),
  )
  return unique.filter((key) => {
    const tile = byKey.get(key)
    if (!tile) {
      return true
    }
    const terrain = terrainByName(catalog, tile.terrain)
    if (!terrain) {
      return true
    }
    return !fizzleIds.has(terrain.id)
  })
}

export function unitImmuneToFire(
  catalog: ReferenceCatalog,
  stack: CombatStack,
): boolean {
  if (isHeroStack(stack)) {
    return false
  }
  return unitAttackShape(unitById(catalog, stack.unitId)).immuneToFire === true
}

export function unitImmuneToLightning(
  catalog: ReferenceCatalog,
  stack: CombatStack,
): boolean {
  if (isHeroStack(stack)) {
    return false
  }
  return (
    unitAttackShape(unitById(catalog, stack.unitId)).immuneToLightning === true
  )
}

function unitImmuneToZone(
  catalog: ReferenceCatalog,
  stack: CombatStack,
  zone: { templateId: number; effect: string },
): boolean {
  if (isStormMechanic(zone.effect, zone.templateId)) {
    return unitImmuneToLightning(catalog, stack)
  }
  return unitImmuneToFire(catalog, stack)
}

/** Storm mechanic: intel × dmg_mult_vs_fire (default 1.5). */
export function stormFlatDmgFromIntel(
  catalog: ReferenceCatalog,
  intel: number,
): number {
  const mechanic = asRecord(
    resolveGroundEffectTemplate(catalog, STORM_GROUND_EFFECT_ID).mechanic,
  )
  const mult = asFinite(mechanic?.dmg_mult_vs_fire) ?? DEFAULT_STORM_DMG_MULT
  return Math.max(0, Math.floor(intel * mult))
}

export function stormExpiresRounds(catalog: ReferenceCatalog): number {
  const mechanic = asRecord(
    resolveGroundEffectTemplate(catalog, STORM_GROUND_EFFECT_ID).mechanic,
  )
  const n = asFinite(mechanic?.auto_expires_rounds)
  return Math.max(1, Math.floor(n ?? DEFAULT_STORM_EXPIRES_ROUNDS))
}

function parseMoveKinds(raw: unknown): MoveKind[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const out: MoveKind[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      continue
    }
    const n = entry.trim().toLowerCase()
    if (n === 'ground') {
      out.push('ground')
    } else if (n === 'submerge') {
      out.push('submerge')
    } else if (n === 'flying' || n === 'fly') {
      out.push('flying')
    } else if (n === 'hover') {
      out.push('hover')
    }
  }
  return out
}

export function groundEffectById(
  catalog: ReferenceCatalog,
  id: number,
): GroundEffectRow | null {
  return catalog.ground_effect.find((row) => row.id === id) ?? null
}

/** Most-recent-wins: drop any zone that shares a hex with `hexKeys`. */
export function replaceOverlappingGroundEffects(
  battle: CombatBattle,
  hexKeys: string[],
): CombatGroundEffect[] {
  const want = new Set(hexKeys)
  return (battle.groundEffects ?? []).filter(
    (row) => !row.hexKeys.some((key) => want.has(key)),
  )
}

export function clearGroundEffectsOnKeys(
  battle: CombatBattle,
  hexKeys: ReadonlySet<string> | string[],
  chancePct = 100,
  random: () => number = Math.random,
  tiles?: CombatTile[],
): { battle: CombatBattle; cleared: number; tiles?: CombatTile[] } {
  const want = hexKeys instanceof Set ? hexKeys : new Set(hexKeys)
  if (want.size === 0) {
    return { battle, cleared: 0, ...(tiles ? { tiles } : {}) }
  }
  const kept: CombatGroundEffect[] = []
  const restore: NonNullable<CombatGroundEffect['tilePrevious']> = []
  let cleared = 0
  for (const row of battle.groundEffects ?? []) {
    const hits = row.hexKeys.some((key) => want.has(key))
    if (!hits) {
      kept.push(row)
      continue
    }
    if (chancePct < 100 && random() * 100 >= chancePct) {
      kept.push(row)
      continue
    }
    cleared += 1
    if (row.tilePrevious && row.tilePrevious.length > 0) {
      restore.push(...row.tilePrevious)
    }
  }
  if (cleared === 0) {
    return { battle, cleared: 0, ...(tiles ? { tiles } : {}) }
  }
  let nextTiles = tiles
  if (nextTiles && restore.length > 0) {
    nextTiles = restoreTilesFromSnapshots(nextTiles, restore)
  }
  return {
    battle: { ...battle, groundEffects: kept },
    cleared,
    ...(nextTiles ? { tiles: nextTiles } : {}),
  }
}

function restoreTilesFromSnapshots(
  tiles: CombatTile[],
  snapshots: NonNullable<CombatGroundEffect['tilePrevious']>,
): CombatTile[] {
  const byKey = new Map(
    snapshots.map((row) => [occupancyKey(row.q, row.r), row]),
  )
  return tiles.map((tile) => {
    const prev = byKey.get(occupancyKey(tile.q, tile.r))
    if (!prev) {
      return tile
    }
    return {
      ...tile,
      terrain: prev.terrain,
      blocked: prev.blocked,
      blocksLos: prev.blocksLos,
      movementCostMultiplier: prev.movementCostMultiplier,
    }
  })
}

function stampBlockingOntoTiles(
  tiles: CombatTile[],
  hexKeys: string[],
  blocksMovement: boolean,
  blocksLos: boolean,
): {
  tiles: CombatTile[]
  previous: NonNullable<CombatGroundEffect['tilePrevious']>
} {
  if (!blocksMovement && !blocksLos) {
    return { tiles, previous: [] }
  }
  const want = new Set(hexKeys)
  const previous: NonNullable<CombatGroundEffect['tilePrevious']> = []
  const next = tiles.map((tile) => {
    const key = occupancyKey(tile.q, tile.r)
    if (!want.has(key)) {
      return tile
    }
    previous.push({
      q: tile.q,
      r: tile.r,
      terrain: tile.terrain,
      blocked: tile.blocked,
      blocksLos: tile.blocksLos,
      movementCostMultiplier: tile.movementCostMultiplier,
    })
    return {
      ...tile,
      blocked: blocksMovement ? true : tile.blocked,
      blocksLos: blocksLos ? true : tile.blocksLos,
    }
  })
  return { tiles: next, previous }
}

export function tickGroundEffectDurations(
  battle: CombatBattle,
): CombatBattle {
  const rows = battle.groundEffects ?? []
  if (rows.length === 0) {
    return battle
  }
  const next = rows
    .map((row) => {
      if (row.roundsLeft == null) {
        return row
      }
      return { ...row, roundsLeft: row.roundsLeft - 1 }
    })
    .filter((row) => row.roundsLeft == null || row.roundsLeft > 0)
  if (next.length === rows.length && next.every((row, i) => row === rows[i])) {
    return battle
  }
  return { ...battle, groundEffects: next }
}

function diskKeys(
  center: Axial,
  radius: number,
  tiles: CombatTile[],
): string[] {
  const keys: string[] = []
  for (const tile of tiles) {
    if (hexDistance(center, { q: tile.q, r: tile.r }) <= radius) {
      keys.push(occupancyKey(tile.q, tile.r))
    }
  }
  return keys
}

export function buildGroundEffectFromAbility(
  catalog: ReferenceCatalog,
  ability: AbilityRow,
  stats: Record<string, unknown>,
  caster: Hero,
  casterSide: CombatSide,
  aim: Axial,
  tiles: CombatTile[],
): CombatGroundEffect | null {
  const templateId = Math.floor(asFinite(stats.ground_effect_id) ?? 0)
  if (templateId <= 0) {
    return null
  }
  const template = resolveGroundEffectTemplate(catalog, templateId)
  const mechanic = asRecord(template.mechanic)
  if (!mechanic) {
    return null
  }
  const strength = casterStrength(catalog, caster)
  const intel = casterIntel(catalog, caster)
  const mechanicType =
    typeof mechanic.type === 'string' ? mechanic.type : 'passive_zone'
  const effect =
    typeof mechanic.effect === 'string' ? mechanic.effect : ''
  const triggerMoveTypes = parseMoveKinds(mechanic.trigger_move_types)

  const placementRadius = Math.max(0, Math.floor(asFinite(stats.radius) ?? 0))
  // Placement disk uses ability `radius` only — never explosion `radius_stat_div`.
  const hexKeys =
    mechanicType === 'trigger_zone' || placementRadius <= 0
      ? [occupancyKey(aim.q, aim.r)]
      : diskKeys(aim, placementRadius, tiles)

  const evasionMult = asFinite(stats.evasion_pct_flat_stat)
  const dmgMult = asFinite(stats.flat_dmg_flat_stat)
  const chanceMult = asFinite(stats.chance_pct_flat_stat)
  const explodeDiv = asFinite(stats.radius_stat_div)
  const duration = asFinite(stats.duration)

  const resistRaw = stats.resist_stat
  const resistStat =
    resistRaw === 'resistance' || resistRaw === 'defense' ? resistRaw : null

  // Fire: snapshot caster intel once at placement (not live later).
  // Storm: intel × dmg_mult_vs_fire with auto_expires_rounds.
  let flatDmg = 0
  let roundsLeft: number | null =
    mechanicType === 'trigger_zone'
      ? null
      : duration != null
        ? Math.max(1, Math.floor(duration))
        : null
  if (isStormMechanic(effect, templateId)) {
    flatDmg = stormFlatDmgFromIntel(catalog, intel)
    roundsLeft =
      duration != null
        ? Math.max(1, Math.floor(duration))
        : stormExpiresRounds(catalog)
  } else if (isFireMechanic(mechanicType, effect, templateId)) {
    flatDmg = Math.max(0, Math.floor(intel))
  } else if (dmgMult != null) {
    flatDmg = Math.max(0, Math.floor(strength * dmgMult))
  }

  return {
    id: nextGroundId(),
    templateId,
    name: template.name || ability.name,
    imagePath: template.image_path,
    layer: template.display_rules?.layer ?? 'below_units',
    hexKeys,
    casterSide,
    hidden: template.hidden === true,
    roundsLeft,
    mechanicType,
    effect,
    triggerMoveTypes,
    evasionPct:
      evasionMult != null ? Math.max(0, Math.floor(strength * evasionMult)) : 0,
    flatDmg,
    explodeRadius:
      explodeDiv != null && explodeDiv > 0
        ? Math.max(0, Math.floor(strength / explodeDiv))
        : 0,
    stunChancePct:
      chanceMult != null ? Math.max(0, Math.floor(strength * chanceMult)) : 0,
    stunConditionId: Math.max(
      0,
      Math.floor(asFinite(stats.inflicts_condition) ?? 0),
    ),
    resistStat,
    consumeOnTrigger: mechanicType === 'trigger_zone',
    // Opt-in only. Explosive Trap (id 2) never friendly-fires.
    friendlyTakesDmg:
      templateId === 2 ? false : stats.friendly_takes_dmg === true,
    blocksMovement:
      mechanic.blocks_movement === true || mechanic.is_blocked === true,
    blocksLos: mechanic.blocks_los === true,
  }
}

/** Catalog row, or known-id fallback when ground_effect isn't loaded yet. */
function resolveGroundEffectTemplate(
  catalog: ReferenceCatalog,
  templateId: number,
): GroundEffectRow {
  const live = groundEffectById(catalog, templateId)
  const fallback = fallbackGroundEffectRow(templateId)
  if (!live && !fallback) {
    return {
      id: templateId,
      name: 'Ground Effect',
      description: null,
      mechanic: null,
      hidden: false,
      image_path: null,
      display_rules: { layer: 'below_units' },
    }
  }
  if (!live) {
    return fallback!
  }
  if (!fallback) {
    return live
  }
  // Prefer live catalog; fill gaps from known defaults (image/layer/hidden/mechanic).
  // Smoke/Fire fallbacks use above_units — keep that even if an older DB row says below.
  const fallbackLayer = fallback.display_rules?.layer
  const liveLayer = live.display_rules?.layer
  return {
    ...fallback,
    ...live,
    mechanic: {
      ...(asRecord(fallback.mechanic) ?? {}),
      ...(asRecord(live.mechanic) ?? {}),
    },
    image_path: live.image_path ?? fallback.image_path,
    display_rules: {
      ...(fallback.display_rules ?? {}),
      ...(live.display_rules ?? {}),
      layer:
        fallbackLayer === 'above_units' || liveLayer === 'above_units'
          ? 'above_units'
          : (liveLayer ?? fallbackLayer ?? 'below_units'),
    },
    hidden: live.hidden || fallback.hidden,
    name: live.name || fallback.name,
  }
}

function fallbackGroundEffectRow(templateId: number): GroundEffectRow | null {
  if (templateId === 1) {
    return {
      id: 1,
      name: 'Smoke Cloud',
      description: null,
      mechanic: { type: 'passive_zone', effect: 'evasion_pct_stat' },
      hidden: false,
      image_path: 'Smoke_Cloud.png',
      display_rules: { layer: 'above_units' },
    }
  }
  if (templateId === 2) {
    return {
      id: 2,
      name: 'Explosive Trap',
      description: null,
      mechanic: {
        type: 'trigger_zone',
        trigger_move_types: ['Ground', 'Submerge'],
        effect: 'aoe_dmg_and_stun',
      },
      hidden: true,
      image_path: 'Explosive_Trap.png',
      display_rules: { layer: 'below_units' },
    }
  }
  if (templateId === 3) {
    return {
      id: 3,
      name: 'Shadow',
      description: null,
      mechanic: {
        type: 'passive_zone',
        effect: 'shadow',
        growth: {
          trigger: 'end_of_round',
          chance_pct_per_hero_level: 2,
          blocked_by_other_ground_effects: true,
          stacks_per_necromancer_hero: true,
        },
      },
      hidden: false,
      image_path: 'Shadow.png',
      display_rules: { layer: 'below_units' },
    }
  }
  if (templateId === 4) {
    return {
      id: 4,
      name: 'Barricade',
      description: null,
      mechanic: {
        type: 'passive_zone',
        effect: 'obstacle',
        blocks_movement: true,
        blocks_los: true,
        is_blocked: true,
      },
      hidden: false,
      image_path: 'Barricade.png',
      display_rules: { layer: 'below_units' },
    }
  }
  if (templateId === 5) {
    return {
      id: 5,
      name: 'Void',
      description: null,
      mechanic: {
        type: 'passive_zone',
        effect: 'void',
        blocks_movement: true,
        blocks_los: true,
        is_blocked: true,
      },
      hidden: false,
      image_path: 'Void.png',
      display_rules: { layer: 'below_units' },
    }
  }
  if (templateId === 6) {
    return {
      id: 6,
      name: 'Fire',
      description: null,
      mechanic: {
        type: 'entry_and_turn_start_damage',
        effect: 'fire',
        blocks_movement: false,
        blocks_los: false,
        fizzles_on_terrain: [11, 14, 16],
        fizzle_still_counts_as_drop: true,
      },
      hidden: false,
      image_path: 'Fire.png',
      display_rules: { layer: 'above_units' },
    }
  }
  if (templateId === 7) {
    return {
      id: 7,
      name: 'Storm',
      description: null,
      mechanic: {
        type: 'entry_and_turn_start_damage',
        effect: 'storm',
        dmg_mult_vs_fire: DEFAULT_STORM_DMG_MULT,
        auto_expires_rounds: DEFAULT_STORM_EXPIRES_ROUNDS,
        blocks_movement: false,
        blocks_los: false,
      },
      hidden: false,
      image_path: 'Storm.png',
      display_rules: { layer: 'above_units' },
    }
  }
  return null
}

function occupiedGroundEffectKeys(battle: CombatBattle): Set<string> {
  const keys = new Set<string>()
  for (const zone of battle.groundEffects ?? []) {
    for (const key of zone.hexKeys) {
      keys.add(key)
    }
  }
  return keys
}

/** Build a lasting zone from a ground_effect template (unit leave-behind, etc.). */
export function buildPassiveZoneFromTemplate(
  catalog: ReferenceCatalog,
  templateId: number,
  hexKeys: string[],
  casterSide: CombatSide,
): CombatGroundEffect | null {
  if (templateId <= 0 || hexKeys.length === 0) {
    return null
  }
  const template = resolveGroundEffectTemplate(catalog, templateId)
  const mechanic = asRecord(template.mechanic)
  if (!mechanic) {
    return null
  }
  const mechanicType =
    typeof mechanic.type === 'string' ? mechanic.type : 'passive_zone'
  const effect = typeof mechanic.effect === 'string' ? mechanic.effect : ''
  const storm = isStormMechanic(effect, templateId)
  const expires = storm
    ? Math.max(
        1,
        Math.floor(
          asFinite(mechanic.auto_expires_rounds) ?? DEFAULT_STORM_EXPIRES_ROUNDS,
        ),
      )
    : null
  return {
    id: nextGroundId(),
    templateId,
    name: template.name || 'Ground Effect',
    imagePath: template.image_path,
    layer: template.display_rules?.layer ?? 'below_units',
    hexKeys: [...new Set(hexKeys)],
    casterSide,
    hidden: template.hidden === true,
    roundsLeft: expires,
    mechanicType,
    effect,
    triggerMoveTypes: parseMoveKinds(mechanic.trigger_move_types),
    evasionPct: 0,
    flatDmg: 0,
    explodeRadius: 0,
    stunChancePct: 0,
    stunConditionId: 0,
    resistStat: null,
    consumeOnTrigger: false,
    friendlyTakesDmg: false,
    blocksMovement:
      mechanic.blocks_movement === true || mechanic.is_blocked === true,
    blocksLos: mechanic.blocks_los === true,
  }
}

/**
 * Place template on empty hexes only (never overwrite an existing ground effect).
 * Merges into an existing same-side, same-template zone when present.
 */
export function placeGroundEffectOnEmptyHexes(
  battle: CombatBattle,
  hexKeys: string[],
  casterSide: CombatSide,
  templateId: number,
  catalog: ReferenceCatalog,
  tiles?: CombatTile[],
): { battle: CombatBattle; tiles?: CombatTile[] } {
  const blocked = occupiedGroundEffectKeys(battle)
  const toPlace = [...new Set(hexKeys)].filter((key) => !blocked.has(key))
  if (toPlace.length === 0) {
    return { battle, ...(tiles ? { tiles } : {}) }
  }
  const existing = (battle.groundEffects ?? []).find(
    (zone) =>
      zone.templateId === templateId && zone.casterSide === casterSide,
  )
  if (existing) {
    const merged: CombatGroundEffect = {
      ...existing,
      hexKeys: [...new Set([...existing.hexKeys, ...toPlace])],
    }
    if (
      tiles &&
      (merged.blocksMovement === true || merged.blocksLos === true)
    ) {
      const stamped = stampBlockingOntoTiles(
        tiles,
        toPlace,
        merged.blocksMovement === true,
        merged.blocksLos === true,
      )
      return {
        battle: {
          ...battle,
          groundEffects: (battle.groundEffects ?? []).map((zone) =>
            zone.id === existing.id
              ? {
                  ...merged,
                  tilePrevious: [
                    ...(existing.tilePrevious ?? []),
                    ...stamped.previous,
                  ],
                }
              : zone,
          ),
        },
        tiles: stamped.tiles,
      }
    }
    return {
      battle: {
        ...battle,
        groundEffects: (battle.groundEffects ?? []).map((zone) =>
          zone.id === existing.id ? merged : zone,
        ),
      },
      ...(tiles ? { tiles } : {}),
    }
  }
  const zone = buildPassiveZoneFromTemplate(
    catalog,
    templateId,
    toPlace,
    casterSide,
  )
  if (!zone) {
    return { battle, ...(tiles ? { tiles } : {}) }
  }
  return placeGroundEffectOnBattle(battle, zone, tiles)
}

/** Unit.abilities: leave that unit's ground_effect_id on move hexes. */
export function unitLeavesGroundEffectIdOnMove(
  catalog: ReferenceCatalog,
  stack: CombatStack,
): number | null {
  if (isHeroStack(stack) || stack.qty <= 0) {
    return null
  }
  const spec = unitAttackShape(unitById(catalog, stack.unitId))
  if (spec.leavesGroundEffectOnMove !== true) {
    return null
  }
  const id = spec.groundEffectId
  if (id == null || id <= 0) {
    return null
  }
  return id
}

/** Worms / Riders: `full_path` paints every entered hex along the walk. */
export function unitLeavesGroundEffectFullPath(
  catalog: ReferenceCatalog,
  stack: CombatStack,
): boolean {
  if (unitLeavesGroundEffectIdOnMove(catalog, stack) == null) {
    return false
  }
  return unitAttackShape(unitById(catalog, stack.unitId)).fullPath === true
}

/**
 * Void-style (no full_path): leave GE on the hex vacated at move start — once
 * per move, not each intermediate step.
 */
export function tryLeaveGroundEffectOnMoveOrigin(
  battle: CombatBattle,
  stackId: string,
  catalog: ReferenceCatalog,
  from: Axial,
  tiles?: CombatTile[],
): { battle: CombatBattle; tiles?: CombatTile[] } {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack) {
    return { battle, ...(tiles ? { tiles } : {}) }
  }
  const templateId = unitLeavesGroundEffectIdOnMove(catalog, stack)
  if (templateId == null || unitLeavesGroundEffectFullPath(catalog, stack)) {
    return { battle, ...(tiles ? { tiles } : {}) }
  }
  return placeGroundEffectOnEmptyHexes(
    battle,
    [occupancyKey(from.q, from.r)],
    stack.side,
    templateId,
    catalog,
    tiles,
  )
}

/**
 * After a walk step: full_path droppers leave their ground_effect_id on the
 * entered hex. Void (no full_path) is handled by tryLeaveGroundEffectOnMoveOrigin.
 */
export function tryLeaveGroundEffectOnMoveStep(
  battle: CombatBattle,
  stackId: string,
  catalog: ReferenceCatalog,
  hex: Axial,
  tiles?: CombatTile[],
): { battle: CombatBattle; tiles?: CombatTile[] } {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack) {
    return { battle, ...(tiles ? { tiles } : {}) }
  }
  const templateId = unitLeavesGroundEffectIdOnMove(catalog, stack)
  if (templateId == null || !unitLeavesGroundEffectFullPath(catalog, stack)) {
    return { battle, ...(tiles ? { tiles } : {}) }
  }
  return placeGroundEffectOnEmptyHexes(
    battle,
    [occupancyKey(hex.q, hex.r)],
    stack.side,
    templateId,
    catalog,
    tiles,
  )
}

export function placeGroundEffectOnBattle(
  battle: CombatBattle,
  effect: CombatGroundEffect,
  tiles?: CombatTile[],
): { battle: CombatBattle; tiles?: CombatTile[] } {
  // Restore any overlapping zones' tile stamps before dropping them.
  let nextTiles = tiles
  const outgoing = (battle.groundEffects ?? []).filter((row) =>
    row.hexKeys.some((key) => effect.hexKeys.includes(key)),
  )
  if (nextTiles && outgoing.length > 0) {
    const snaps = outgoing.flatMap((row) => row.tilePrevious ?? [])
    if (snaps.length > 0) {
      nextTiles = restoreTilesFromSnapshots(nextTiles, snaps)
    }
  }
  const kept = replaceOverlappingGroundEffects(battle, effect.hexKeys)
  let placed: CombatGroundEffect = effect
  if (
    nextTiles &&
    (effect.blocksMovement === true || effect.blocksLos === true)
  ) {
    const stamped = stampBlockingOntoTiles(
      nextTiles,
      effect.hexKeys,
      effect.blocksMovement === true,
      effect.blocksLos === true,
    )
    nextTiles = stamped.tiles
    placed = {
      ...effect,
      tilePrevious: stamped.previous,
    }
  }
  return {
    battle: {
      ...battle,
      groundEffects: [...kept, placed],
    },
    ...(nextTiles ? { tiles: nextTiles } : {}),
  }
}

/**
 * Place Fire (id 6) on exact hexes with caster intel snapshotted into flatDmg.
 * Overwrites overlapping ground effects (most-recent-wins).
 * Water/Shallows/Swamp hexes fizzle (no tile) but callers may still count the attempt.
 */
export function placeFireOnHexKeys(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  caster: Hero,
  casterSide: CombatSide,
  hexKeys: string[],
  tiles?: CombatTile[],
  ability?: AbilityRow | null,
): { battle: CombatBattle; tiles?: CombatTile[]; placedKeys: string[] } {
  const keys = filterFirePlaceableHexKeys(hexKeys, tiles, catalog)
  if (keys.length === 0) {
    return { battle, ...(tiles ? { tiles } : {}), placedKeys: [] }
  }
  const aimParts = keys[0]!.split(',')
  const aim = {
    q: Number(aimParts[0]),
    r: Number(aimParts[1]),
  }
  const stats: Record<string, unknown> = {
    ground_effect_id: FIRE_GROUND_EFFECT_ID,
    radius: 0,
  }
  const stubAbility: AbilityRow = ability ?? {
    id: 0,
    discipline_id: 0,
    level_id: 0,
    name: 'Fire',
    description: '',
    ability_type_id: 1,
    target_id: 0,
    resource_id: 2,
    cost: 0,
    cooldown_id: 0,
    stats,
  }
  const base = buildGroundEffectFromAbility(
    catalog,
    stubAbility,
    ability?.stats && typeof ability.stats === 'object'
      ? {
          ...(ability.stats as Record<string, unknown>),
          ground_effect_id: FIRE_GROUND_EFFECT_ID,
          radius: 0,
        }
      : stats,
    caster,
    casterSide,
    aim,
    tiles ?? [],
  )
  if (!base) {
    return { battle, ...(tiles ? { tiles } : {}), placedKeys: [] }
  }
  const effect: CombatGroundEffect = {
    ...base,
    hexKeys: keys,
    flatDmg: Math.max(
      0,
      Math.floor(
        heroEffectiveStats(catalog, caster.class_id, caster.current_level).intel,
      ),
    ),
  }
  const placed = placeGroundEffectOnBattle(battle, effect, tiles)
  return {
    battle: placed.battle,
    ...(placed.tiles ? { tiles: placed.tiles } : {}),
    placedKeys: keys,
  }
}

/**
 * Place Storm (id 7) on exact hexes. Damage = floor(intel × 1.5); expires in
 * auto_expires_rounds (default 2). No Water fizzle (unlike Fire).
 */
export function placeStormOnHexKeys(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  caster: Hero,
  casterSide: CombatSide,
  hexKeys: string[],
  tiles?: CombatTile[],
  ability?: AbilityRow | null,
): { battle: CombatBattle; tiles?: CombatTile[]; placedKeys: string[] } {
  const keys = [...new Set(hexKeys.filter((key) => key.length > 0))]
  if (keys.length === 0) {
    return { battle, ...(tiles ? { tiles } : {}), placedKeys: [] }
  }
  const aimParts = keys[0]!.split(',')
  const aim = {
    q: Number(aimParts[0]),
    r: Number(aimParts[1]),
  }
  const stats: Record<string, unknown> = {
    ground_effect_id: STORM_GROUND_EFFECT_ID,
    radius: 0,
  }
  const stubAbility: AbilityRow = ability ?? {
    id: 0,
    discipline_id: 0,
    level_id: 0,
    name: 'Storm',
    description: '',
    ability_type_id: 1,
    target_id: 0,
    resource_id: 2,
    cost: 0,
    cooldown_id: 0,
    stats,
  }
  const base = buildGroundEffectFromAbility(
    catalog,
    stubAbility,
    ability?.stats && typeof ability.stats === 'object'
      ? {
          ...(ability.stats as Record<string, unknown>),
          ground_effect_id: STORM_GROUND_EFFECT_ID,
          radius: 0,
        }
      : stats,
    caster,
    casterSide,
    aim,
    tiles ?? [],
  )
  if (!base) {
    return { battle, ...(tiles ? { tiles } : {}), placedKeys: [] }
  }
  const intel = heroEffectiveStats(
    catalog,
    caster.class_id,
    caster.current_level,
  ).intel
  const effect: CombatGroundEffect = {
    ...base,
    hexKeys: keys,
    flatDmg: stormFlatDmgFromIntel(catalog, intel),
    roundsLeft: stormExpiresRounds(catalog),
  }
  const placed = placeGroundEffectOnBattle(battle, effect, tiles)
  return {
    battle: placed.battle,
    ...(placed.tiles ? { tiles: placed.tiles } : {}),
    placedKeys: keys,
  }
}

/**
 * Remove specific hexes of a ground_effect template (e.g. Tidal Caller
 * extinguishing Fire along a line). Zones with no hexes left are dropped.
 */
export function clearGroundEffectTemplateHexes(
  battle: CombatBattle,
  hexKeys: ReadonlySet<string> | string[],
  templateId: number,
  tiles?: CombatTile[],
): { battle: CombatBattle; cleared: number; tiles?: CombatTile[] } {
  const want = hexKeys instanceof Set ? hexKeys : new Set(hexKeys)
  if (want.size === 0 || templateId <= 0) {
    return { battle, cleared: 0, ...(tiles ? { tiles } : {}) }
  }
  const kept: CombatGroundEffect[] = []
  const restore: NonNullable<CombatGroundEffect['tilePrevious']> = []
  let cleared = 0
  for (const row of battle.groundEffects ?? []) {
    if (row.templateId !== templateId) {
      kept.push(row)
      continue
    }
    const remain = row.hexKeys.filter((key) => !want.has(key))
    const removed = row.hexKeys.length - remain.length
    if (removed <= 0) {
      kept.push(row)
      continue
    }
    cleared += removed
    if (row.tilePrevious && row.tilePrevious.length > 0) {
      for (const snap of row.tilePrevious) {
        if (want.has(occupancyKey(snap.q, snap.r))) {
          restore.push(snap)
        }
      }
    }
    if (remain.length === 0) {
      continue
    }
    kept.push({
      ...row,
      hexKeys: remain,
      tilePrevious: row.tilePrevious?.filter(
        (snap) => !want.has(occupancyKey(snap.q, snap.r)),
      ),
    })
  }
  if (cleared === 0) {
    return { battle, cleared: 0, ...(tiles ? { tiles } : {}) }
  }
  let nextTiles = tiles
  if (nextTiles && restore.length > 0) {
    nextTiles = restoreTilesFromSnapshots(nextTiles, restore)
  }
  return {
    battle: { ...battle, groundEffects: kept },
    cleared,
    ...(nextTiles ? { tiles: nextTiles } : {}),
  }
}

export type GroundTriggerResult = {
  battle: CombatBattle
  lines: string[]
  hitKeys: string[]
}

export type FireHazardResult = GroundTriggerResult & {
  /** Flat Fire damage applied this tick (0 if none). */
  damage: number
  /** Creatures killed by this Fire tick. */
  killed: number
  /** Zone label used in log lines. */
  label: string
}

/**
 * Fire (id 6) / Storm (id 7): flat damage from snapshotted `flatDmg`.
 * Same timing as Moat — call at turn-start and when a stack enters / ends its
 * turn standing in the zone. Flying/Hover/walls/siege immune.
 * Fire → immune_to_fire; Storm → immune_to_lightning.
 */
export function applyFireGroundDamage(
  battle: CombatBattle,
  stackId: string,
  catalog: ReferenceCatalog,
  _tiles: CombatTile[],
  heroes?: { atk?: Hero; def?: Hero },
  random: () => number = Math.random,
): FireHazardResult {
  const empty: FireHazardResult = {
    battle,
    lines: [],
    hitKeys: [],
    damage: 0,
    killed: 0,
    label: 'Fire',
  }
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || stack.qty <= 0 || stack.indestructible || isHeroStack(stack)) {
    return empty
  }
  const unit = unitById(catalog, stack.unitId)
  if (isWallSegmentUnit(unit) || isSiegeEngineUnit(unit)) {
    return empty
  }
  const kind = moveKindForUnit(unit, catalog)
  if (kind === 'flying' || kind === 'hover') {
    return empty
  }
  const keys = new Set(
    stackFootprint(stack, catalog).map((hex) => occupancyKey(hex.q, hex.r)),
  )
  let damage = 0
  let label = 'Fire'
  for (const zone of battle.groundEffects ?? []) {
    if (
      !isEntryTurnStartDamageZone(zone) ||
      zone.flatDmg <= 0 ||
      unitImmuneToZone(catalog, stack, zone)
    ) {
      continue
    }
    if (!zone.hexKeys.some((key) => keys.has(key))) {
      continue
    }
    damage += zone.flatDmg
    if (zone.name?.trim()) {
      label = zone.name.trim()
    }
  }
  if (damage <= 0) {
    return empty
  }
  const full = stackMaxHealth(stack, catalog)
  const applied = applyStackDamage(stack, damage, full)
  const name = unit?.name ?? 'Unknown'
  let line = `${stack.qty} ${name} took ${damage} dmg from ${label}`
  if (applied.killed > 0) {
    line += ` and ${applied.killed} ${name} died`
  }
  const broken =
    applied.stack && damage > 0
      ? applyBreaksOnDamage(applied.stack, catalog)
      : { stack: applied.stack, lines: [] as string[] }
  const stacks = broken.stack
    ? battle.stacks.map((row) => (row.id === stackId ? broken.stack! : row))
    : battle.stacks.filter((row) => row.id !== stackId)
  let nextBattle: CombatBattle = { ...battle, stacks }
  if (applied.killed > 0) {
    nextBattle = noteUnitDeaths(nextBattle, stack.unitId, applied.killed)
  }
  const rez = applySelfRezThenTombstones(
    battle,
    nextBattle,
    catalog,
    heroes,
    random,
  )
  nextBattle = rez.battle
  return {
    battle: nextBattle,
    lines: [`${line}.`, ...broken.lines, ...rez.lines],
    hitKeys: [hexKey(stack.q, stack.r)],
    damage,
    killed: applied.killed,
    label,
  }
}

/** Aggregate walk-through Fire ticks into one battle-log line. */
export function fireHazardSummaryLine(
  hits: number,
  totalDamage: number,
  killed: number,
  unitName: string,
  label = 'Fire',
): string | null {
  if (hits <= 0 || totalDamage <= 0) {
    return null
  }
  const times = hits === 1 ? '1 time' : `${hits} times`
  let line = `${label} hits ${times} for ${totalDamage} dmg`
  if (killed > 0) {
    line += ` and ${killed} ${unitName} died`
  }
  return `${line}.`
}

/**
 * Fire trigger zones when a unit enters/crosses their hex.
 * Call after each walk step / relocate landing. Does not consult AI vision —
 * traps always arm regardless of who is watching.
 * Friendly (caster-side) units never trigger — no damage, stun, or consume.
 */
export function tryTriggerGroundEffectsOnEnter(
  battle: CombatBattle,
  stackId: string,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  heroes: CombatHeroes | undefined,
  random: () => number = Math.random,
): GroundTriggerResult {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || stack.qty <= 0 || isHeroStack(stack)) {
    return { battle, lines: [], hitKeys: [] }
  }
  const unit = unitById(catalog, stack.unitId)
  const kind = moveKindForUnit(unit, catalog)
  const enterKeys = new Set(
    stackFootprint(stack, catalog).map((hex) => occupancyKey(hex.q, hex.r)),
  )
  const zones = [...(battle.groundEffects ?? [])]
  const toRemove = new Set<string>()
  let nextBattle = battle
  const lines: string[] = []
  const hitKeys: string[] = []

  for (const zone of zones) {
    if (zone.mechanicType !== 'trigger_zone') {
      continue
    }
    if (toRemove.has(zone.id)) {
      continue
    }
    // Caster's side never arms the trap — walk/stop/stand are fully inert.
    if (stack.side === zone.casterSide) {
      continue
    }
    if (
      zone.triggerMoveTypes.length > 0 &&
      !zone.triggerMoveTypes.includes(kind)
    ) {
      continue
    }
    const stepped = zone.hexKeys.some((key) => enterKeys.has(key))
    if (!stepped) {
      continue
    }
    if (zone.effect === 'aoe_dmg_and_stun') {
      const boom = detonateTrap(
        nextBattle,
        zone,
        catalog,
        tiles,
        heroes,
        random,
      )
      nextBattle = boom.battle
      lines.push(...boom.lines)
      hitKeys.push(...boom.hitKeys)
    }
    if (zone.consumeOnTrigger) {
      toRemove.add(zone.id)
    }
  }

  if (toRemove.size > 0) {
    nextBattle = {
      ...nextBattle,
      groundEffects: (nextBattle.groundEffects ?? []).filter(
        (row) => !toRemove.has(row.id),
      ),
    }
  }
  return { battle: nextBattle, lines, hitKeys: [...new Set(hitKeys)] }
}

function detonateTrap(
  battle: CombatBattle,
  zone: CombatGroundEffect,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  heroes: CombatHeroes | undefined,
  random: () => number,
): GroundTriggerResult {
  const centers = zone.hexKeys.map((key) => {
    const [qs, rs] = key.split(',')
    return { q: Number(qs), r: Number(rs) }
  })
  const radius = Math.max(0, zone.explodeRadius)
  const blastKeys = new Set<string>()
  for (const center of centers) {
    for (const key of diskKeys(center, radius, tiles)) {
      blastKeys.add(key)
    }
  }
  let stacks = battle.stacks
  let nextBattle = battle
  const lines: string[] = [`${zone.name} detonates!`]
  const hitKeys: string[] = []

  for (const target of [...stacks]) {
    if (target.qty <= 0 || isHeroStack(target) || target.indestructible) {
      continue
    }
    // Explosive Trap is inert to the caster's army: never dmg / stun friendlies,
    // regardless of a missing or stale friendlyTakesDmg snapshot.
    if (target.side === zone.casterSide && zone.friendlyTakesDmg !== true) {
      continue
    }
    const inBlast = stackFootprint(target, catalog).some((hex) =>
      blastKeys.has(occupancyKey(hex.q, hex.r)),
    )
    if (!inBlast) {
      continue
    }
    const live = stacks.find((row) => row.id === target.id)
    if (!live || live.qty <= 0) {
      continue
    }
    const defender = heroes ? heroForSide(live.side, heroes) : undefined
    const mit = mitigateIncoming(
      zone.flatDmg,
      live,
      catalog,
      'physical',
      defender,
    )
    const full = stackMaxHealth(live, catalog)
    const applied = applyStackDamage(live, mit.damage, full)
    stacks = stacks.map((row) =>
      row.id === live.id ? (applied.stack ?? { ...live, qty: 0 }) : row,
    )
    if (applied.killed > 0) {
      nextBattle = noteUnitDeaths(
        { ...nextBattle, stacks },
        live.unitId,
        applied.killed,
      )
      stacks = nextBattle.stacks
    }
    hitKeys.push(occupancyKey(live.q, live.r))
    const died =
      applied.killed > 0
        ? ` and ${applied.killed} ${stackName(catalog, live)} died`
        : ''
    lines.push(
      `${zone.name} hit ${live.qty} ${stackName(catalog, live)} for ${mit.damage} dmg${died}.`,
    )

    const afterDmg = stacks.find((row) => row.id === live.id)
    if (
      afterDmg &&
      afterDmg.qty > 0 &&
      zone.stunConditionId > 0 &&
      zone.stunChancePct > 0
    ) {
      const stunChance = zone.stunChancePct
      const triggered = rollChancePct(stunChance, random)
      lines.push(
        chanceRollLog(zone.name, stunChance, triggered, {
          action: 'to Stun',
        }),
      )
      if (triggered) {
        const stunned = tryInflictSpec(
          afterDmg,
          catalog,
          {
            conditionId: zone.stunConditionId,
            resistStat: zone.resistStat,
            duration: 1,
          },
          random,
        )
        stacks = stacks.map((row) =>
          row.id === afterDmg.id ? stunned.stack : row,
        )
        lines.push(...stunned.lines)
      }
    }
  }

  nextBattle = syncTombstonesFromWipes(
    battle,
    { ...nextBattle, stacks },
    catalog,
  )
  return { battle: nextBattle, lines, hitKeys }
}
