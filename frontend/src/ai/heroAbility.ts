import type { Axial } from '../hex/hero'
import type { Hero, Player } from '../session/types'
import {
  abilityCastCost,
  abilityCooldownReady,
  canAffordAbility,
} from '../combat/heroCast'
import {
  abilityAimImpactKeys,
  abilityNeedsHexTarget,
  abilityValidHexKeys,
  parseTarget,
} from '../combat/ability'
import {
  applyStackHeal,
  heroForSide,
  mitigateIncoming,
  type CombatHeroes,
  type DmgKind,
} from '../combat/attack'
import {
  isHeroStack,
  stackMaxDmg,
  stackMaxHealth,
  stackMinDmg,
  type CombatBattle,
  type CombatSide,
  type CombatStack,
  type CombatTile,
} from '../combat/battle'
import { hexKey, stackOccupyingHex } from '../combat/movement'
import { isCreatureArmyUnit, isUntargetableStack } from '../combat/siege'
import { abilityMeetsCastGate, isSummonStats } from '../combat/summon'
import {
  heroEffectiveStats,
  minRangePenaltyMult,
  shapePulsesOnMove,
  unitAttackShape,
  unitById,
  unitHasTag,
  unitsWithTag,
  type AbilityRow,
  type ReferenceCatalog,
} from '../town/catalog'
import { combatDisplayLearnedIds } from '../town/libraryRules'
import {
  HERO_ABILITY_DECISION,
  type HeroAbilityFactor,
  type ScoredOption,
} from './types'
import { appendAiTrace } from './trace'
import {
  aiAbilityMinValueRatio,
  aiAbilityRemainingRoundsMax,
  aiDecisionTemperature,
  archName,
  blendedArchWeight,
  pickWeighted,
} from './weights'

export type AbilityEffectKind =
  | 'dmg'
  | 'heal'
  | 'buff'
  | 'debuff'
  | 'condition'
  | 'summon'

export type HeroAbilityIntent = {
  ability: AbilityRow
  aim: { targetId: string | null; hex: Axial }
  kind: AbilityEffectKind
}

type AimOption = {
  aim: { targetId: string | null; hex: Axial }
  stacks: CombatStack[]
}

const BIAS_KEY: Record<AbilityEffectKind, HeroAbilityFactor> = {
  dmg: 'dmg_bias',
  heal: 'heal_bias',
  buff: 'buff_bias',
  debuff: 'debuff_bias',
  condition: 'condition_bias',
  summon: 'summon_bias',
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

function letter(index: number): string {
  return String.fromCharCode(65 + (index % 26))
}

function livingCreatures(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
): CombatStack[] {
  return battle.stacks.filter(
    (row) =>
      row.qty > 0 &&
      !row.indestructible &&
      !isHeroStack(row) &&
      isCreatureArmyUnit(unitById(catalog, row.unitId)) &&
      !isUntargetableStack(row, catalog),
  )
}

function matchesGroup(
  stack: CombatStack,
  casterSide: CombatSide,
  group: 'friend' | 'enemy' | 'either',
): boolean {
  if (group === 'either') {
    return true
  }
  if (group === 'friend') {
    return stack.side === casterSide
  }
  return stack.side !== casterSide
}

/** Remaining `qty × avg dmg × health`, using live HP so wounded stacks are worth less. */
export function stackUnitValue(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): number {
  const unit = unitById(catalog, stack.unitId)
  if (!unit || stack.qty <= 0) {
    return 0
  }
  const avg = (stackMinDmg(stack, catalog) + stackMaxDmg(stack, catalog)) / 2
  const maxHp = stackMaxHealth(stack, catalog)
  const currentHp = Math.max(0, (stack.qty - 1) * maxHp + stack.topHealth)
  return currentHp * avg
}

function catalogUnitValue(
  catalog: ReferenceCatalog,
  unitId: number,
  qty: number,
): number {
  const unit = unitById(catalog, unitId)
  if (!unit || qty <= 0) {
    return 0
  }
  const avg = (unit.min_dmg + unit.max_dmg) / 2
  return qty * avg * unit.health
}

function otherSide(side: CombatSide): CombatSide {
  return side === 'atk' ? 'def' : 'atk'
}

function sideArmyValue(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  side: CombatSide,
): number {
  return livingCreatures(battle, catalog).reduce(
    (sum, row) => (row.side === side ? sum + stackUnitValue(row, catalog) : sum),
    0,
  )
}

function remainingRoundsEstimate(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  casterSide: CombatSide,
): { rounds: number; own: number; enemy: number } {
  const max = aiAbilityRemainingRoundsMax(catalog)
  const own = sideArmyValue(battle, catalog, casterSide)
  const enemy = sideArmyValue(battle, catalog, otherSide(casterSide))
  if (enemy <= 0) {
    return { rounds: max, own, enemy }
  }
  const scaled = max * Math.min(1, own / enemy)
  return {
    rounds: Math.max(1, Math.min(max, Math.round(scaled))),
    own,
    enemy,
  }
}

function casterStat(
  catalog: ReferenceCatalog,
  caster: Hero,
  resourceId: number,
): number {
  const stats = heroEffectiveStats(catalog, caster.class_id, caster.current_level)
  return resourceId === 1 ? stats.strength : stats.intel
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
    return Math.max(0, Math.floor(str * casterStat(catalog, caster, 1)))
  }
  const intel = asFinite(stats.int_dmg)
  if (intel != null) {
    return Math.max(0, Math.floor(intel * casterStat(catalog, caster, 2)))
  }
  return null
}

function abilityKind(ability: AbilityRow): DmgKind {
  return ability.resource_id === 1 ? 'physical' : 'magic'
}

function classify(
  ability: AbilityRow,
  stats: Record<string, unknown>,
  catalog: ReferenceCatalog,
): AbilityEffectKind {
  if (isSummonStats(stats)) {
    return 'summon'
  }
  const cond = Math.floor(asFinite(stats.inflicts_condition) ?? 0)
  if (cond > 0) {
    return 'condition'
  }
  const nested = asRecord(stats.enemy_effect) ?? asRecord(stats.ally_effect)
  const probe = nested ?? stats
  if (
    probe.flat_dmg != null ||
    probe.str_dmg != null ||
    probe.int_dmg != null
  ) {
    return 'dmg'
  }
  if (probe.flat_heal != null || probe.drain_heal === true) {
    return 'heal'
  }
  const typeName =
    catalog.ability_type
      .find((row) => row.id === ability.ability_type_id)
      ?.value.trim()
      .toLowerCase() ?? ''
  if (typeName === 'debuff') {
    return 'debuff'
  }
  if (typeName === 'summon') {
    return 'summon'
  }
  if (typeName === 'attack') {
    return 'dmg'
  }
  return 'buff'
}

function effectStats(
  stats: Record<string, unknown>,
  kind: AbilityEffectKind,
): Record<string, unknown> {
  if (kind === 'dmg' || kind === 'debuff' || kind === 'condition') {
    return asRecord(stats.enemy_effect) ?? stats
  }
  if (kind === 'heal' || kind === 'buff') {
    return asRecord(stats.ally_effect) ?? stats
  }
  return stats
}

function hasSpeedMod(stats: Record<string, unknown>): boolean {
  return Object.keys(stats).some((key) =>
    /^speed_(buff|debuff)_stat_div$/.test(key),
  )
}

function hasDamageMod(stats: Record<string, unknown>): boolean {
  if (
    asFinite(stats.dmg_buff_pct_stat) != null ||
    asFinite(stats.min_dmg_mult) != null ||
    asFinite(stats.max_dmg_mult) != null ||
    asFinite(stats.crit_pct_flat_stat) != null ||
    asFinite(stats.crit_amt_flat_stat) != null ||
    asFinite(stats.grants_second_attack_pct) != null ||
    stats.guaranteed_max_dmg === true
  ) {
    return true
  }
  return Object.keys(stats).some((key) =>
    /^(physical|magic)_dmg_/.test(key),
  )
}

function unitCanSufferMinRangePenalty(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): boolean {
  if (stack.ignoreMinRangePenalty === true) {
    return false
  }
  const unit = unitById(catalog, stack.unitId)
  if (!unit || unit.min_range <= 1) {
    return false
  }
  return !shapePulsesOnMove(unitAttackShape(unit).shape)
}

/**
 * True when this buff/debuff's actual effect can change this stack.
 * Stats keys, not ability names — Steady Aim is `disable_min_range_penalty`.
 */
function buffAppliesToStack(
  stats: Record<string, unknown>,
  stack: CombatStack,
  catalog: ReferenceCatalog,
): boolean {
  const unit = unitById(catalog, stack.unitId)
  if (!unit) {
    return false
  }
  const checks: boolean[] = []
  if (stats.disable_min_range_penalty === true) {
    checks.push(unitCanSufferMinRangePenalty(stack, catalog))
  }
  if (hasSpeedMod(stats)) {
    checks.push(unit.speed != null)
  }
  if (stats.movement === 'max_distance') {
    checks.push(!unit.stationary && (unit.speed ?? 0) > 0)
  }
  if (stats.grants_extra_turn === true) {
    checks.push(unit.speed != null && stack.extraTurnThisRound !== true)
  }
  if (stats.grants_kill_on_overflow === true) {
    checks.push(unit.max_dmg > 0 && stack.killOnOverflow !== true)
  }
  if (asFinite(stats.grants_second_attack_pct) != null) {
    checks.push(
      unit.max_dmg > 0 &&
        (stack.barrageUsesLeft == null || stack.barrageUsesLeft > 0),
    )
  }
  if (hasDamageMod(stats)) {
    checks.push(unit.max_dmg > 0)
  }
  if (checks.length > 0) {
    return checks.some(Boolean)
  }
  return true
}

function buffMagnitude(
  stats: Record<string, unknown>,
  catalog: ReferenceCatalog,
  caster: Hero,
  ability: AbilityRow,
): number {
  const div =
    asFinite(stats.dmg_buff_pct_stat) ??
    asFinite(stats.def_debuff_pct_stat) ??
    asFinite(stats.unit_defense_pct_stat) ??
    asFinite(stats.unit_resistance_pct_stat)
  if (div != null && div > 0) {
    const pct = casterStat(catalog, caster, ability.resource_id) / div
    return Math.max(0.05, Math.min(1, pct / 100))
  }
  if (stats.disable_min_range_penalty === true) {
    return Math.max(0, 1 - minRangePenaltyMult(catalog))
  }
  const evade = asFinite(stats.evasion_pct)
  if (evade != null && evade > 0) {
    return Math.min(1, evade / 100)
  }
  const barrage = asFinite(stats.grants_second_attack_pct)
  if (barrage != null && barrage > 0) {
    const flat = asFinite(stats.second_attack_pct_flat_stat) ?? 0
    const pct = barrage + casterStat(catalog, caster, ability.resource_id) * flat
    return Math.min(1, Math.max(0, pct / 100))
  }
  return 0.2
}

function expectedDamageTo(
  raw: number,
  target: CombatStack,
  catalog: ReferenceCatalog,
  ability: AbilityRow,
  heroes: CombatHeroes,
): number {
  const mit = mitigateIncoming(
    raw,
    target,
    catalog,
    abilityKind(ability),
    heroForSide(target.side, heroes),
  )
  return Math.max(0, mit.damage)
}

function impactDamage(
  raw: number,
  targets: CombatStack[],
  catalog: ReferenceCatalog,
  ability: AbilityRow,
  heroes: CombatHeroes,
): number {
  let total = 0
  for (const target of targets) {
    const value = stackUnitValue(target, catalog)
    total += Math.min(expectedDamageTo(raw, target, catalog, ability, heroes), value)
  }
  return total
}

function impactHeal(
  pool: number,
  targets: CombatStack[],
  catalog: ReferenceCatalog,
): number {
  let remaining = Math.max(0, Math.floor(pool))
  let impact = 0
  const ordered = [...targets].sort(
    (a, b) => stackMaxHealth(a, catalog) - stackMaxHealth(b, catalog),
  )
  for (const target of ordered) {
    if (remaining <= 0) {
      break
    }
    const full = stackMaxHealth(target, catalog)
    const applied = applyStackHeal(target, remaining, full)
    remaining -= applied.healed
    const avg =
      (stackMinDmg(target, catalog) + stackMaxDmg(target, catalog)) / 2
    impact += applied.healed * avg
  }
  return impact
}

function deathsForTag(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tagId: number,
): number {
  let total = 0
  for (const [rawId, killed] of Object.entries(battle.unitDeaths ?? {})) {
    const unitId = Number(rawId)
    if (!Number.isInteger(unitId) || killed <= 0) {
      continue
    }
    if (unitHasTag(unitById(catalog, unitId), tagId)) {
      total += killed
    }
  }
  return total
}

function impactSummon(
  stats: Record<string, unknown>,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  caster: Hero,
  ability: AbilityRow,
): number {
  const heroStats = heroEffectiveStats(
    catalog,
    caster.class_id,
    caster.current_level,
  )
  const scale = ability.resource_id === 1 ? heroStats.strength : heroStats.intel
  const unitId = Math.floor(asFinite(stats.summon_unit_id) ?? 0)
  if (unitId > 0) {
    const count = Math.max(1, Math.floor(asFinite(stats.summon_count) ?? 0))
    const qtyDiv = asFinite(stats.summon_qty_stat_div)
    const qty =
      count > 1
        ? count
        : qtyDiv != null && qtyDiv > 0
          ? Math.max(0, Math.floor(scale / qtyDiv))
          : Math.max(0, Math.floor(heroStats.intel * (asFinite(stats.summon_qty_int_stat) ?? 1)))
    return catalogUnitValue(catalog, unitId, qty)
  }
  const killTag = Math.floor(asFinite(stats.kill_tag) ?? 0)
  const summonTag = Math.floor(asFinite(stats.summon_tag) ?? 0)
  const pct = asFinite(stats.kill_pct_stat) ?? 0
  const deaths = killTag > 0 ? deathsForTag(battle, catalog, killTag) : 0
  const qty = Math.max(0, Math.floor(scale * (pct / 100) * deaths))
  const unit = unitsWithTag(catalog, summonTag).find((row) => (row.speed ?? 0) > 0)
  if (!unit || qty <= 0) {
    return 0
  }
  return catalogUnitValue(catalog, unit.id, qty)
}

function impactOf(
  kind: AbilityEffectKind,
  stats: Record<string, unknown>,
  targets: CombatStack[],
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  caster: Hero,
  ability: AbilityRow,
  heroes: CombatHeroes,
  roundsLeft: number,
): number {
  const probe = effectStats(stats, kind)
  if (kind === 'summon') {
    return impactSummon(stats, battle, catalog, caster, ability)
  }
  if (kind === 'dmg') {
    const raw = rawAbilityDamage(probe, catalog, caster)
    if (raw == null) {
      return 0
    }
    return impactDamage(raw, targets, catalog, ability, heroes)
  }
  if (kind === 'heal') {
    const pool =
      probe.drain_heal === true
        ? rawAbilityDamage(stats, catalog, caster) ?? 0
        : Math.max(0, Math.floor(asFinite(probe.flat_heal) ?? 0))
    return impactHeal(pool, targets, catalog)
  }
  if (kind === 'condition') {
    const duration = Math.max(1, Math.floor(asFinite(probe.duration) ?? 1))
    return targets.reduce(
      (sum, row) => sum + stackUnitValue(row, catalog) * duration,
      0,
    )
  }
  const magnitude = buffMagnitude(probe, catalog, caster, ability)
  const army = targets.reduce((sum, row) => {
    if (!buffAppliesToStack(probe, row, catalog)) {
      return sum
    }
    return sum + stackUnitValue(row, catalog)
  }, 0)
  return magnitude * army * roundsLeft
}

function stacksFromKeys(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  keys: string[],
  casterSide: CombatSide,
  group: 'friend' | 'enemy' | 'either',
): CombatStack[] {
  const want = new Set(keys)
  return livingCreatures(battle, catalog).filter((row) => {
    if (!matchesGroup(row, casterSide, group)) {
      return false
    }
    return want.has(hexKey(row.q, row.r))
  })
}

function aimOptions(
  ability: AbilityRow,
  _stats: Record<string, unknown>,
  catalog: ReferenceCatalog,
  battle: CombatBattle,
  tiles: CombatTile[],
  casterSide: CombatSide,
  heroHex: Axial,
): AimOption[] {
  const parsed = parseTarget(catalog, ability)
  const living = livingCreatures(battle, catalog).filter((row) =>
    matchesGroup(row, casterSide, parsed.group),
  )
  if (!abilityNeedsHexTarget(catalog, ability) || parsed.spread === 'all') {
    return [{ aim: { targetId: null, hex: heroHex }, stacks: living }]
  }
  if (parsed.spread === 'aoe') {
    const options: AimOption[] = []
    const seen = new Set<string>()
    for (const tile of tiles) {
      const keys = abilityAimImpactKeys(
        catalog,
        ability,
        casterSide,
        battle,
        tiles,
        { q: tile.q, r: tile.r },
      )
      const stacks = stacksFromKeys(
        battle,
        catalog,
        keys,
        casterSide,
        parsed.group,
      )
      if (stacks.length === 0) {
        continue
      }
      const sig = stacks
        .map((row) => row.id)
        .sort()
        .join('|')
      if (seen.has(sig)) {
        continue
      }
      seen.add(sig)
      const occupant =
        stackOccupyingHex(battle.stacks, tile.q, tile.r, catalog) ??
        battle.stacks.find((row) => row.q === tile.q && row.r === tile.r) ??
        null
      options.push({
        aim: {
          targetId: occupant && !isHeroStack(occupant) ? occupant.id : null,
          hex: { q: tile.q, r: tile.r },
        },
        stacks,
      })
    }
    return options
  }
  const valid = new Set(
    abilityValidHexKeys(catalog, ability, casterSide, battle, tiles),
  )
  const options: AimOption[] = []
  for (const stack of living) {
    if (!valid.has(hexKey(stack.q, stack.r))) {
      continue
    }
    options.push({
      aim: { targetId: stack.id, hex: { q: stack.q, r: stack.r } },
      stacks: [stack],
    })
  }
  return options
}

function bestAim(
  ability: AbilityRow,
  stats: Record<string, unknown>,
  kind: AbilityEffectKind,
  catalog: ReferenceCatalog,
  battle: CombatBattle,
  tiles: CombatTile[],
  caster: Hero,
  casterSide: CombatSide,
  heroes: CombatHeroes,
  heroHex: Axial,
  roundsLeft: number,
): { aim: AimOption['aim']; impact: number } | null {
  const options = aimOptions(
    ability,
    stats,
    catalog,
    battle,
    tiles,
    casterSide,
    heroHex,
  )
  if (kind === 'summon') {
    const impact = impactOf(
      kind,
      stats,
      [],
      battle,
      catalog,
      caster,
      ability,
      heroes,
      roundsLeft,
    )
    return {
      aim: options[0]?.aim ?? { targetId: null, hex: heroHex },
      impact,
    }
  }
  let best: { aim: AimOption['aim']; impact: number } | null = null
  for (const option of options) {
    const impact = impactOf(
      kind,
      stats,
      option.stacks,
      battle,
      catalog,
      caster,
      ability,
      heroes,
      roundsLeft,
    )
    if (!best || impact > best.impact) {
      best = { aim: option.aim, impact }
    }
  }
  return best
}

/**
 * Score learned, affordable, off-cooldown abilities. Null = decline this
 * opportunity (below threshold, or nothing legal).
 */
export function decideHeroAbility(
  hero: Hero,
  heroStack: CombatStack,
  battle: CombatBattle,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
  player: Player,
  heroes: CombatHeroes,
): HeroAbilityIntent | null {
  if (heroStack.hasActedThisRound) {
    return null
  }
  const learned = new Set(
    (hero.learned_abilities ?? []).length > 0
      ? hero.learned_abilities
      : combatDisplayLearnedIds(catalog, hero),
  )
  const minRatio = aiAbilityMinValueRatio(catalog)
  const length = remainingRoundsEstimate(battle, catalog, heroStack.side)
  const roundsLeft = length.rounds
  const options: ScoredOption<HeroAbilityIntent>[] = []

  for (const ability of catalog.ability) {
    if (!learned.has(ability.id) || !ability.stats) {
      continue
    }
    if (!abilityCooldownReady(hero, ability) || !canAffordAbility(hero, ability)) {
      continue
    }
    if (!abilityMeetsCastGate(catalog, ability, battle, heroStack.side)) {
      continue
    }
    const stats = asRecord(ability.stats)
    if (!stats) {
      continue
    }
    const kind = classify(ability, stats, catalog)
    const picked = bestAim(
      ability,
      stats,
      kind,
      catalog,
      battle,
      tiles,
      hero,
      heroStack.side,
      heroes,
      { q: heroStack.q, r: heroStack.r },
      roundsLeft,
    )
    if (!picked || picked.impact <= 0) {
      continue
    }
    const cost = Math.max(1, abilityCastCost(ability))
    const raw = picked.impact / cost
    const biasKey = BIAS_KEY[kind]
    const bias = blendedArchWeight(
      player,
      hero,
      HERO_ABILITY_DECISION,
      biasKey,
      catalog,
    )
    const score = raw * (bias <= 0 ? 1 : bias)
    const factors: Record<string, number> = { [biasKey]: 1 }
    const weights: Record<string, number> = { [biasKey]: bias }
    options.push({
      id: `${ability.id}:${picked.aim.hex.q},${picked.aim.hex.r}`,
      label: `${ability.name} (${kind}) impact=${picked.impact.toFixed(1)} cost=${cost} ratio=${raw.toFixed(2)} bias=${bias.toFixed(2)} → ${score.toFixed(2)}`,
      factors,
      weights,
      score,
      data: { ability, aim: picked.aim, kind },
    })
  }

  const playerArch = archName(catalog, player.arch_id)
  const header = [
    `AI hero_ability — ${hero.name} (P${player.id.replace('player-', '')}) round=${battle.round} remain_est=${roundsLeft} own=${length.own.toFixed(0)} enemy=${length.enemy.toFixed(0)} ratio=${length.enemy > 0 ? (length.own / length.enemy).toFixed(2) : 'inf'}`,
    `  player_arch=${playerArch} min_ratio=${minRatio} T=${aiDecisionTemperature(catalog).toFixed(2)} candidates=${options.length}`,
  ]

  if (options.length === 0) {
    appendAiTrace([...header, '  no legal abilities (cooldown/cost/gate)'].join('\n'))
    return null
  }

  const peak = Math.max(...options.map((row) => row.score))
  if (peak < minRatio) {
    appendAiTrace(
      [
        ...header,
        ...options.map(
          (row, index) => `  ${letter(index)} ${row.label}`,
        ),
        `  decline — best ${peak.toFixed(2)} < min_ratio ${minRatio}`,
      ].join('\n'),
    )
    return null
  }

  const viable = options.filter((row) => row.score >= minRatio)
  const pick = pickWeighted(viable, catalog)
  if (!pick) {
    appendAiTrace([...header, '  pick failed'].join('\n'))
    return null
  }

  const body = viable.map((option, index) => {
    const mark = option.id === pick.picked.id ? ' ← chosen' : ''
    const sm = pick.optionWeights[index]?.toFixed(3) ?? '?'
    return `  ${letter(index)} ${option.label} softmax=${sm}${mark}`
  })
  appendAiTrace(
    [
      ...header,
      ...body,
      `  roll=${pick.roll.toFixed(3)} / ${pick.weightSum.toFixed(3)} → ${pick.picked.label}`,
    ].join('\n'),
  )
  return pick.picked.data
}
