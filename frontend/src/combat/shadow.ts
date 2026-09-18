import type { Axial } from '../hex/hero'
import { neighborHexes } from '../hex/pathfinding'
import type { Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import {
  heroTypeName,
  unitAttackShape,
  unitById,
} from '../town/catalog'
import {
  missingPassiveStatKey,
  passiveStatNumber,
  passiveStatSourceValue,
  passiveStatString,
  passiveStatStringList,
  requirePassiveStats,
} from '../town/heroPassiveStats'
import type {
  CombatBattle,
  CombatGroundEffect,
  CombatSide,
  CombatStack,
  CombatTile,
} from './battle'
import { isHeroStack } from './battle'
import type { CombatHeroes } from './attack'
import { heroForSide } from './attack'
import { occupancyKey, stackFootprint } from './occupancy'
import { moveKindForUnit, type MoveKind } from './movement'
import { chanceRollLog } from './combatLog'

export const SHADOW_GROUND_EFFECT_ID = 3
export const SHADOW_GROWTH_PCT_PER_LEVEL = 2


let shadowSeq = 0

function nextShadowId(): string {
  shadowSeq += 1
  return `shadow-${shadowSeq}`
}

export function isHeroClass(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  className: string,
): boolean {
  if (!hero) {
    return false
  }
  return (
    heroTypeName(catalog, hero.class_id).trim().toLowerCase() ===
    className.trim().toLowerCase()
  )
}

export function sideHasHeroClass(
  catalog: ReferenceCatalog,
  heroes: CombatHeroes | undefined,
  side: CombatSide,
  className: string,
): boolean {
  return isHeroClass(catalog, heroForSide(side, heroes ?? {}), className)
}

export function necromancerHeroesInBattle(
  catalog: ReferenceCatalog,
  heroes: CombatHeroes | undefined,
): Array<{ hero: Hero; side: CombatSide }> {
  const out: Array<{ hero: Hero; side: CombatSide }> = []
  if (!heroes) {
    return out
  }
  if (heroes.atk && isHeroClass(catalog, heroes.atk, 'Necromancer')) {
    out.push({ hero: heroes.atk, side: 'atk' })
  }
  if (heroes.def && isHeroClass(catalog, heroes.def, 'Necromancer')) {
    out.push({ hero: heroes.def, side: 'def' })
  }
  return out
}

export function isShadowHex(
  battle: CombatBattle,
  q: number,
  r: number,
): boolean {
  const key = occupancyKey(q, r)
  return (battle.groundEffects ?? []).some(
    (zone) =>
      zone.templateId === SHADOW_GROUND_EFFECT_ID &&
      zone.hexKeys.includes(key),
  )
}

export function groundEffectKeys(
  battle: CombatBattle,
): Set<string> {
  const keys = new Set<string>()
  for (const zone of battle.groundEffects ?? []) {
    for (const key of zone.hexKeys) {
      keys.add(key)
    }
  }
  return keys
}

export function buildShadowZone(
  hexKeys: string[],
  casterSide: CombatSide,
): CombatGroundEffect {
  return {
    id: nextShadowId(),
    templateId: SHADOW_GROUND_EFFECT_ID,
    name: 'Shadow',
    imagePath: 'Shadow.png',
    layer: 'below_units',
    hexKeys: [...new Set(hexKeys)],
    casterSide,
    hidden: false,
    roundsLeft: null,
    mechanicType: 'passive_zone',
    effect: 'shadow',
    triggerMoveTypes: [],
    evasionPct: 0,
    flatDmg: 0,
    explodeRadius: 0,
    stunChancePct: 0,
    stunConditionId: 0,
    resistStat: null,
    consumeOnTrigger: false,
    friendlyTakesDmg: false,
  }
}

/**
 * Place Shadow on hexes that have no ground effect yet (never overwrite).
 * Merges into an existing Shadow zone when possible; otherwise adds a new one.
 */
export function placeShadowOnEmptyHexes(
  battle: CombatBattle,
  hexKeys: string[],
  casterSide: CombatSide,
): CombatBattle {
  const occupied = groundEffectKeys(battle)
  const toPlace = [...new Set(hexKeys)].filter((key) => !occupied.has(key))
  if (toPlace.length === 0) {
    return battle
  }
  // Prefer appending hexes onto an existing same-side Shadow zone.
  const existing = (battle.groundEffects ?? []).find(
    (zone) =>
      zone.templateId === SHADOW_GROUND_EFFECT_ID &&
      zone.casterSide === casterSide,
  )
  if (existing) {
    return {
      ...battle,
      groundEffects: (battle.groundEffects ?? []).map((zone) =>
        zone.id === existing.id
          ? {
              ...zone,
              hexKeys: [...new Set([...zone.hexKeys, ...toPlace])],
            }
          : zone,
      ),
    }
  }
  return {
    ...battle,
    groundEffects: [
      ...(battle.groundEffects ?? []),
      buildShadowZone(toPlace, casterSide),
    ],
  }
}

function pickRandomKeys(
  keys: string[],
  count: number,
  random: () => number,
): string[] {
  if (count <= 0 || keys.length === 0) {
    return []
  }
  const copy = keys.slice()
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

/**
 * Seeds of Shadow: place up to `count` Shadow tiles.
 * Prefer hexes with no ground effect and no unit; then no-GE hexes under units.
 * Existing ground-effect hexes are never overwritten (remaining seeds no-op).
 */
export function scatterShadowSeeds(
  battle: CombatBattle,
  tiles: CombatTile[],
  count: number,
  casterSide: CombatSide,
  unitOccupied: ReadonlySet<string>,
  random: () => number = Math.random,
): { battle: CombatBattle; placedKeys: string[]; attempted: number } {
  const attempted = Math.max(0, Math.floor(count))
  if (attempted <= 0 || tiles.length === 0) {
    return { battle, placedKeys: [], attempted: 0 }
  }
  const board = tiles.map((tile) => occupancyKey(tile.q, tile.r))
  const blocked = groundEffectKeys(battle)
  const openEmpty: string[] = []
  const openUnderUnit: string[] = []
  for (const key of board) {
    if (blocked.has(key)) {
      continue
    }
    if (unitOccupied.has(key)) {
      openUnderUnit.push(key)
    } else {
      openEmpty.push(key)
    }
  }
  const picks = pickRandomKeys(openEmpty, attempted, random)
  if (picks.length < attempted) {
    picks.push(
      ...pickRandomKeys(openUnderUnit, attempted - picks.length, random),
    )
  }
  const next = placeShadowOnEmptyHexes(battle, picks, casterSide)
  return { battle: next, placedKeys: picks, attempted }
}

export function unitLeavesShadowOnMove(
  catalog: ReferenceCatalog,
  stack: CombatStack,
): boolean {
  if (isHeroStack(stack) || stack.qty <= 0) {
    return false
  }
  const spec = unitAttackShape(unitById(catalog, stack.unitId))
  // Shadow-specific helpers (growth UI, etc.) — leave-on-move itself is generic
  // via tryLeaveGroundEffectOnMoveStep reading ground_effect_id from abilities.
  return (
    spec.leavesGroundEffectOnMove === true &&
    spec.groundEffectId === SHADOW_GROUND_EFFECT_ID
  )
}

export function unitLeavesShadowOnAttack(
  catalog: ReferenceCatalog,
  stack: CombatStack,
): boolean {
  if (isHeroStack(stack) || stack.qty <= 0) {
    return false
  }
  const spec = unitAttackShape(unitById(catalog, stack.unitId))
  return (
    spec.leavesGroundEffectOnAttack === true &&
    spec.groundEffectId === SHADOW_GROUND_EFFECT_ID
  )
}

/** After a walk step: droppers leave Shadow on the hex they just entered. */
export function tryLeaveShadowOnMoveStep(
  battle: CombatBattle,
  stackId: string,
  catalog: ReferenceCatalog,
  hex: Axial,
): CombatBattle {
  // Kept for call-site compatibility; prefer tryLeaveGroundEffectOnMoveStep.
  // Shadow-only gate — Void and other GE ids must use the generic helper.
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || !unitLeavesShadowOnMove(catalog, stack)) {
    return battle
  }
  return placeShadowOnEmptyHexes(
    battle,
    [occupancyKey(hex.q, hex.r)],
    stack.side,
  )
}

/** Beam / attack trail: place Shadow on every hex in the geometry. */
export function tryLeaveShadowOnAttackPath(
  battle: CombatBattle,
  stackId: string,
  catalog: ReferenceCatalog,
  hexes: Axial[],
): CombatBattle {
  // Prefer tryLeaveGroundEffectOnAttackPath (attackTrail.ts) for Fire + chance.
  // Kept for Shadow-only call sites / compatibility.
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || !unitLeavesShadowOnAttack(catalog, stack)) {
    return battle
  }
  return placeShadowOnEmptyHexes(
    battle,
    hexes.map((hex) => occupancyKey(hex.q, hex.r)),
    stack.side,
  )
}

/**
 * End-of-round Shadow growth: each Shadow tile × each Necromancer hero rolls
 * level×2% to spread into one random empty adjacent hex.
 */
export function tickShadowGrowth(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  heroes: CombatHeroes | undefined,
  tiles: CombatTile[],
  random: () => number = Math.random,
): { battle: CombatBattle; lines: string[] } {
  const necros = necromancerHeroesInBattle(catalog, heroes)
  if (necros.length === 0) {
    return { battle, lines: [] }
  }
  const board = new Set(tiles.map((tile) => occupancyKey(tile.q, tile.r)))
  const shadowZones = (battle.groundEffects ?? []).filter(
    (zone) => zone.templateId === SHADOW_GROUND_EFFECT_ID,
  )
  if (shadowZones.length === 0) {
    return { battle, lines: [] }
  }
  // Snapshot source hexes so growth this tick doesn't chain.
  const sourceHexes: Array<{ key: string; side: CombatSide }> = []
  for (const zone of shadowZones) {
    for (const key of zone.hexKeys) {
      sourceHexes.push({ key, side: zone.casterSide })
    }
  }
  let next = battle
  let placed = 0
  let attempts = 0
  const chanceByLabel = new Map<string, number>()
  for (const source of sourceHexes) {
    for (const { hero, side } of necros) {
      attempts += 1
      const level = Math.max(1, hero.current_level ?? 1)
      const chance = level * SHADOW_GROWTH_PCT_PER_LEVEL
      chanceByLabel.set(`level ${level}`, chance)
      if (random() * 100 >= chance) {
        continue
      }
      const [qs, rs] = source.key.split(',')
      const origin = { q: Number(qs), r: Number(rs) }
      const occupied = groundEffectKeys(next)
      const candidates = neighborHexes(origin).filter((hex) => {
        const key = occupancyKey(hex.q, hex.r)
        return board.has(key) && !occupied.has(key)
      })
      if (candidates.length === 0) {
        continue
      }
      const pick =
        candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))]
      if (!pick) {
        continue
      }
      // Growth attributed to the Necromancer who rolled (their side).
      next = placeShadowOnEmptyHexes(
        next,
        [occupancyKey(pick.q, pick.r)],
        side,
      )
      placed += 1
    }
  }
  const chances = [...chanceByLabel.values()]
  const primaryChance = chances[0] ?? 0
  const detail =
    chanceByLabel.size > 1
      ? [...chanceByLabel.entries()]
          .map(([label, pct]) => `${label}=${pct}%`)
          .join(', ')
      : undefined
  return {
    battle: next,
    lines: [
      chanceRollLog('Shadow growth', primaryChance, placed > 0, {
        detail,
        action: 'per Shadow hex × Necromancer',
        success: `${placed}/${attempts} grew.`,
        fail: `0/${attempts} grew.`,
      }),
    ],
  }
}

/**
 * Necromancer passive: eligible move-type units on Shadow deal
 * +(stat × multiplier_pct)% damage. Tunables from passive_stats.
 */
export function necromancerShadowDamageBonusPct(
  striker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  heroes: CombatHeroes | undefined,
): number {
  if (isHeroStack(striker) || striker.qty <= 0) {
    return 0
  }
  const hero = heroForSide(striker.side, heroes ?? {})
  if (!isHeroClass(catalog, hero, 'Necromancer') || !hero) {
    return 0
  }
  const stats = requirePassiveStats(catalog, hero, 'Necromancer shadow dmg')
  if (!stats) {
    return 0
  }
  const multPct = passiveStatNumber(stats, 'multiplier_pct')
  const statSource = passiveStatString(stats, 'stat_source')
  const filters = passiveStatStringList(stats, 'unit_filter')
  if (multPct == null) {
    missingPassiveStatKey(catalog, hero, 'multiplier_pct', 'Necromancer')
    return 0
  }
  const unit = unitById(catalog, striker.unitId)
  const kind = moveKindForUnit(unit, catalog)
  if (!necromancerMoveTypeAllowed(kind, filters)) {
    return 0
  }
  if (!stackStandingInShadow(striker, battle, catalog)) {
    return 0
  }
  const base = passiveStatSourceValue(catalog, hero, statSource ?? 'INT')
  return Math.max(0, base * multPct)
}

/**
 * Death Knight S7-1 addendum: eligible units on Shadow deal
 * +(stat × dmg_multiplier_pct)% Physical damage. Same standing_in_shadow
 * gate as Necromancer; move-cost reduction is separate (unchanged).
 */
export function deathKnightShadowDamageBonusPct(
  striker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  heroes: CombatHeroes | undefined,
): number {
  if (isHeroStack(striker) || striker.qty <= 0) {
    return 0
  }
  const hero = heroForSide(striker.side, heroes ?? {})
  if (!isHeroClass(catalog, hero, 'Death Knight') || !hero) {
    return 0
  }
  const stats = requirePassiveStats(catalog, hero, 'Death Knight shadow dmg')
  if (!stats) {
    return 0
  }
  // Prefer dedicated dmg keys; fall back so older DB rows still work once
  // dmg_multiplier_pct is present (defaults applied in catalog).
  const multPct = passiveStatNumber(stats, 'dmg_multiplier_pct')
  if (multPct == null) {
    missingPassiveStatKey(catalog, hero, 'dmg_multiplier_pct', 'Death Knight')
    return 0
  }
  const filters = passiveStatStringList(stats, 'unit_filter')
  const unit = unitById(catalog, striker.unitId)
  const kind = moveKindForUnit(unit, catalog)
  if (!necromancerMoveTypeAllowed(kind, filters)) {
    return 0
  }
  if (!stackStandingInShadow(striker, battle, catalog)) {
    return 0
  }
  const statSource =
    passiveStatString(stats, 'dmg_stat_source') ??
    passiveStatString(stats, 'stat_source') ??
    'STR'
  const base = passiveStatSourceValue(catalog, hero, statSource)
  return Math.max(0, base * multPct)
}

function stackStandingInShadow(
  stack: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
): boolean {
  return stackFootprint(stack, catalog).some((hex) =>
    isShadowHex(battle, hex.q, hex.r),
  )
}

function necromancerMoveTypeAllowed(
  kind: MoveKind,
  filters: string[],
): boolean {
  if (filters.length === 0) {
    // Legacy equivalent: Ground + Submerge (not flying/hover).
    return kind !== 'flying' && kind !== 'hover'
  }
  const allowed = new Set(filters.map((row) => row.trim().toLowerCase()))
  if (kind === 'ground') {
    return allowed.has('ground')
  }
  if (kind === 'submerge') {
    return allowed.has('submerge')
  }
  if (kind === 'flying') {
    return allowed.has('flying')
  }
  if (kind === 'hover') {
    return allowed.has('hover')
  }
  return false
}

/**
 * Death Knight passive: on Shadow tiles, multiply terrain move_cost by
 * (1 - min(STR × pct_per_point%, max_reduction_pct%)).
 *
 * Standing rule (future): if another move-cost reducer is added, stack
 * reduction percentages additively (sum %s, then apply once) — do not
 * multiply independent multipliers together.
 */
export function deathKnightShadowMoveAdjust(
  battle: CombatBattle | undefined,
  catalog: ReferenceCatalog,
  heroes: CombatHeroes | undefined,
  moverSide: CombatSide,
  moverKind: MoveKind,
): ((q: number, r: number, cost: number) => number) | undefined {
  if (!battle || moverKind === 'flying' || moverKind === 'hover') {
    return undefined
  }
  const hero = heroForSide(moverSide, heroes)
  if (!hero || !isHeroClass(catalog, hero, 'Death Knight')) {
    return undefined
  }
  const stats = requirePassiveStats(catalog, hero, 'Death Knight shadow move')
  if (!stats) {
    return undefined
  }
  const pctPerPoint = passiveStatNumber(stats, 'pct_per_point')
  const maxReductionPct = passiveStatNumber(stats, 'max_reduction_pct')
  const statSource = passiveStatString(stats, 'stat_source')
  if (pctPerPoint == null) {
    missingPassiveStatKey(catalog, hero, 'pct_per_point', 'Death Knight')
    return undefined
  }
  if (maxReductionPct == null) {
    missingPassiveStatKey(catalog, hero, 'max_reduction_pct', 'Death Knight')
    return undefined
  }
  const base = passiveStatSourceValue(catalog, hero, statSource ?? 'STR')
  const reduction = Math.min(
    (base * pctPerPoint) / 100,
    maxReductionPct / 100,
  )
  return (q, r, cost) => {
    if (!isShadowHex(battle, q, r)) {
      return cost
    }
    return Math.max(0, cost * (1 - reduction))
  }
}
