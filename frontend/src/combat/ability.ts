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
} from '../town/catalog'
import {
  noteUnitDeaths,
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
import { applySummonFromStats, isSummonStats } from './summon'
import type { Axial } from '../hex/hero'

export const ABILITY_TYPE_BUFF = 2
export const ABILITY_TYPE_DEBUFF = 3

const ENERGY_RESOURCE_ID = 1
const MANA_RESOURCE_ID = 2

const OUTPUT_KEY =
  /^(physical|magic)_dmg_(total|min|max)_(stat|flat)$/
const MITIGATION_KEY = /^unit_(defense|resistance)_pct_(stat|flat)$/

export type AbilityFlash = {
  keys: string[]
  color: HitFlashColor
}

export type AbilityResolve = {
  battle: CombatBattle
  log: { lines: string[]; holdTurn: true }
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
  const group: TargetGroup = text.startsWith('friend')
    ? 'friend'
    : text.startsWith('enemy')
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
  return parseTarget(catalog, ability).spread !== 'all'
}

/** Occupied hexes the player may click for this ability's `target_id`. */
export function abilityValidHexKeys(
  catalog: ReferenceCatalog,
  ability: AbilityRow,
  casterSide: CombatSide,
  battle: CombatBattle,
): string[] {
  const parsed = parseTarget(catalog, ability)
  if (parsed.spread === 'all') {
    return []
  }
  const keys: string[] = []
  for (const stack of livingCreatures(battle, catalog)) {
    if (!matchesGroup(stack, casterSide, parsed.group)) {
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
  const valid = abilityValidHexKeys(catalog, ability, casterSide, battle)
  if (parsed.spread !== 'aoe') {
    return valid
  }
  const stats = asRecord(ability.stats)
  if (!stats) {
    return valid
  }
  const shape = shapeFromStats(stats)
  const spec: UnitCombatAbilities = {
    ...DEFAULT_UNIT_ABILITIES,
    shape,
    radius: Math.max(1, Math.floor(asFinite(stats.radius) ?? 1)),
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
  const extra = hexes.map((hex) => occupancyKey(hex.q, hex.r))
  return [...new Set([...valid, ...extra])]
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
  const living = livingCreatures(battle, catalog).filter((row) =>
    matchesGroup(row, casterSide, group),
  )
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
  const spec: UnitCombatAbilities = {
    ...DEFAULT_UNIT_ABILITIES,
    shape,
    radius: Math.max(1, Math.floor(asFinite(stats.radius) ?? 1)),
  }
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
    isSummonStats(stats)
  ) {
    return true
  }
  return Object.keys(stats).some(
    (key) => OUTPUT_KEY.test(key) || MITIGATION_KEY.test(key),
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
      const ha = unitById(catalog, a.unitId)?.health ?? 1
      const hb = unitById(catalog, b.unitId)?.health ?? 1
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
    const full = Math.max(1, unitById(catalog, live.unitId)?.health ?? 1)
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
  heroes: CombatHeroes,
  targets: CombatStack[],
  healPool: number,
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

  const raw = rawAbilityDamage(stats, catalog, caster)
  if (raw != null) {
    const kind = abilityKind(ability)
    const overflow = stats.kill_on_overflow === true
    const keys: string[] = []
    for (const target of liveTargets()) {
      const defender = heroForSide(target.side, heroes)
      const mit = mitigateIncoming(raw, target, catalog, kind, defender)
      const full = Math.max(1, unitById(catalog, target.unitId)?.health ?? 1)
      const applied = applyStackDamage(target, mit.damage, full, overflow)
      dealt += mit.damage
      stacks = writeCombatStack(stacks, target.id, applied.stack)
      if (applied.killed > 0) {
        battle = noteUnitDeaths(battle, target.unitId, applied.killed)
      }
      keys.push(occupancyKey(target.q, target.r))
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
    }
    if (keys.length > 0) {
      flashes.push({ keys, color: 'red' })
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
    if (next.notes.length === 0) {
      continue
    }
    stacks = writeCombatStack(stacks, live.id, next.stack)
    lines.push(...next.notes.map((note) => `${ability.name}: ${note}.`))
    const key = occupancyKey(live.q, live.r)
    if (ability.ability_type_id === ABILITY_TYPE_DEBUFF) {
      debuffKeys.push(key)
    } else if (ability.ability_type_id === ABILITY_TYPE_BUFF) {
      buffKeys.push(key)
    } else if (Object.keys(stats).some((entry) => OUTPUT_KEY.test(entry))) {
      debuffKeys.push(key)
    } else {
      buffKeys.push(key)
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
      log: { lines, holdTurn: true },
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
        heroes,
        enemies,
        0,
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
        heroes,
        allies,
        dealt,
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
      heroes,
      targets,
      0,
    )
    next = result.battle
    lines.push(...result.lines)
    flashes.push(...result.flashes)
  }

  if (lines.length === 0) {
    lines.push(`${ability.name} had no effect.`)
  }
  return {
    battle: next,
    log: { lines, holdTurn: true },
    flashes,
  }
}
