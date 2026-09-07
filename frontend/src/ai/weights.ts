import {
  appConfigNumber,
  getCachedCatalog,
  type ReferenceCatalog,
} from '../town/catalog'
import type { Hero, Player } from '../session/types'
import {
  DEFAULT_AI_ARCH_ID,
  type ScoredOption,
  type WeightedPickResult,
} from './types'

/** Same disposable seed as `ai_arch_weight` INSERT — used if the table isn't loaded yet. */
const FALLBACK_WEIGHTS: Record<number, Record<string, Record<string, number>>> = {
  1: {
    world_move: {
      safety: 6,
      resource_value: 9,
      explore_value: 4,
      return_home: 5,
      garrison_value: 4,
      capture_town: 8,
      learn_ability_value: 8,
      attack_value: 3,
    },
    town_build: {
      economy_value: 9,
      army_value: 4,
      defense_value: 3,
      hero_value: 7,
    },
    army_alloc: { hero_share_pct: 55 },
    combat_action: {
      kill_potential: 6,
      target_weakness: 5,
      target_threat: 4,
      protect_ally: 3,
    },
    hero_ability: {
      dmg_bias: 1,
      heal_bias: 1,
      buff_bias: 1,
      debuff_bias: 1,
      condition_bias: 1,
      summon_bias: 1,
    },
  },
  2: {
    world_move: {
      safety: 4,
      resource_value: 5,
      explore_value: 9,
      return_home: 3,
      garrison_value: 3,
      capture_town: 6,
      learn_ability_value: 8,
      attack_value: 3,
    },
    town_build: {
      economy_value: 5,
      army_value: 3,
      defense_value: 2,
      hero_value: 7,
    },
    army_alloc: { hero_share_pct: 50 },
    combat_action: {
      kill_potential: 5,
      target_weakness: 5,
      target_threat: 4,
      protect_ally: 2,
    },
    hero_ability: {
      dmg_bias: 1,
      heal_bias: 1,
      buff_bias: 1,
      debuff_bias: 1,
      condition_bias: 1,
      summon_bias: 1,
    },
  },
  3: {
    world_move: {
      safety: 2,
      resource_value: 5,
      explore_value: 5,
      return_home: 2,
      garrison_value: 8,
      capture_town: 9,
      learn_ability_value: 8,
      attack_value: 9,
    },
    town_build: {
      economy_value: 3,
      army_value: 9,
      defense_value: 3,
      hero_value: 7,
    },
    army_alloc: { hero_share_pct: 80 },
    combat_action: {
      kill_potential: 9,
      target_weakness: 6,
      target_threat: 8,
      protect_ally: 2,
    },
    hero_ability: {
      dmg_bias: 1,
      heal_bias: 1,
      buff_bias: 1,
      debuff_bias: 1,
      condition_bias: 1,
      summon_bias: 1,
    },
  },
  4: {
    world_move: {
      safety: 8,
      resource_value: 5,
      explore_value: 3,
      return_home: 8,
      garrison_value: 8,
      capture_town: 7,
      learn_ability_value: 8,
      attack_value: 4,
    },
    town_build: {
      economy_value: 5,
      army_value: 6,
      defense_value: 9,
      hero_value: 7,
    },
    army_alloc: { hero_share_pct: 35 },
    combat_action: {
      kill_potential: 5,
      target_weakness: 4,
      target_threat: 6,
      protect_ally: 9,
    },
    hero_ability: {
      dmg_bias: 1,
      heal_bias: 1,
      buff_bias: 1,
      debuff_bias: 1,
      condition_bias: 1,
      summon_bias: 1,
    },
  },
}

export function aiHeroBlendBias(catalog: ReferenceCatalog | null | undefined): number {
  return Math.max(0, Math.min(1, appConfigNumber(catalog, 'ai_hero_blend_bias', 0.65)))
}

export function aiDecisionJitterPct(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, appConfigNumber(catalog, 'ai_decision_jitter_pct', 15))
}

/** Score multiplier on stack-upgrade candidates. Fallback 1.4. */
export function aiUpgradeBonusMult(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, appConfigNumber(catalog, 'ai_upgrade_bonus_mult', 1.4))
}

/** Softmax temperature. Lower = sharper toward the best option. Fallback 2. */
export function aiDecisionTemperature(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0.05, appConfigNumber(catalog, 'ai_decision_temperature', 2))
}

export function aiAttackMinRatio(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, appConfigNumber(catalog, 'ai_attack_min_ratio', 1.2))
}

export function aiAbilityMinValueRatio(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, appConfigNumber(catalog, 'ai_ability_min_value_ratio', 0.5))
}

export function aiAbilityRemainingRoundsMax(
  catalog: ReferenceCatalog | null | undefined,
): number {
  const renamed = appConfigNumber(
    catalog,
    'ai_ability_remaining_rounds_max',
    Number.NaN,
  )
  if (Number.isFinite(renamed) && renamed > 0) {
    return Math.max(1, renamed)
  }
  return Math.max(1, appConfigNumber(catalog, 'ai_ability_remaining_rounds_est', 5))
}

export function mapRandomMobs(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, Math.floor(appConfigNumber(catalog, 'map_random_mobs', 8)))
}

export function mapRandomMobsTier(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(1, Math.floor(appConfigNumber(catalog, 'map_random_mobs_tier', 3)))
}

export function mapMobAdvancedPct(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, Math.min(100, appConfigNumber(catalog, 'map_mob_advanced_pct', 10)))
}

export function mapMobMinTownDist(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(1, Math.floor(appConfigNumber(catalog, 'map_mob_min_town_dist', 2)))
}

export function mobSurrenderRatio(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, appConfigNumber(catalog, 'mob_surrender_ratio', 0.2))
}

export function mobSurrenderVsFleePct(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(
    0,
    Math.min(100, appConfigNumber(catalog, 'mob_surrender_vs_flee_pct', 50)),
  )
}

export function xpHpMult(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, appConfigNumber(catalog, 'xp_hp_mult', 1))
}

const FALLBACK_HIRE_CHANCE: Record<number, number> = {
  1: 80,
  2: 20,
  3: 5,
  4: 1.25,
}

/**
 * Percent chance to consider hiring the next hero.
 * extraN = how many heroes beyond the first this hire would be (1 = 2nd hero).
 */
export function aiHireChanceExtraPct(
  catalog: ReferenceCatalog | null | undefined,
  extraN: number,
): number {
  if (extraN <= 0) {
    return 100
  }
  const fallback = FALLBACK_HIRE_CHANCE[extraN] ?? 0
  return Math.max(
    0,
    appConfigNumber(catalog, `ai_hire_chance_extra_${extraN}`, fallback),
  )
}

export function archWeight(
  catalog: ReferenceCatalog | null | undefined,
  archId: number,
  decisionKey: string,
  factorKey: string,
): number {
  const row = catalog?.ai_arch_weight?.find(
    (entry) =>
      entry.arch_id === archId &&
      entry.decision_key === decisionKey &&
      entry.factor_key === factorKey,
  )
  if (row) {
    return row.weight
  }
  return FALLBACK_WEIGHTS[archId]?.[decisionKey]?.[factorKey] ?? 0
}

export function archName(
  catalog: ReferenceCatalog | null | undefined,
  archId: number | null | undefined,
): string {
  if (archId == null) {
    return 'none'
  }
  return catalog?.ai_arch?.find((row) => row.id === archId)?.name ?? `#${archId}`
}

/**
 * Blend player/hero archetype weights, then jitter. Fresh every call — not cached.
 */
export function finalFactorWeight(
  player: Player,
  hero: Hero | null | undefined,
  decisionKey: string,
  factorKey: string,
  catalog: ReferenceCatalog | null | undefined = getCachedCatalog(),
): number {
  const playerArch = player.arch_id > 0 ? player.arch_id : DEFAULT_AI_ARCH_ID
  const playerW = archWeight(catalog, playerArch, decisionKey, factorKey)
  const heroArch = hero?.arch_id
  let effective = playerW
  if (heroArch != null && heroArch > 0) {
    const bias = aiHeroBlendBias(catalog)
    const heroW = archWeight(catalog, heroArch, decisionKey, factorKey)
    effective = playerW * (1 - bias) + heroW * bias
  }
  const jitter = aiDecisionJitterPct(catalog) / 100
  const lo = 1 - jitter
  const hi = 1 + jitter
  const roll = lo + Math.random() * (hi - lo)
  return effective * roll
}

/** Player/hero blend with no jitter — for direct targets like army_alloc share. */
export function blendedArchWeight(
  player: Player,
  hero: Hero | null | undefined,
  decisionKey: string,
  factorKey: string,
  catalog: ReferenceCatalog | null | undefined = getCachedCatalog(),
): number {
  const playerArch = player.arch_id > 0 ? player.arch_id : DEFAULT_AI_ARCH_ID
  const playerW = archWeight(catalog, playerArch, decisionKey, factorKey)
  const heroArch = hero?.arch_id
  if (heroArch == null || heroArch <= 0) {
    return playerW
  }
  const bias = aiHeroBlendBias(catalog)
  const heroW = archWeight(catalog, heroArch, decisionKey, factorKey)
  return playerW * (1 - bias) + heroW * bias
}

export function scoreOption(
  factors: Record<string, number>,
  weights: Record<string, number>,
): number {
  let total = 0
  for (const key of Object.keys(factors)) {
    total += (factors[key] ?? 0) * (weights[key] ?? 0)
  }
  return Math.round(total * 100) / 100
}

/** Softmax over scores: weight = e^(score / T). A clear leader usually wins; close calls vary. */
export function pickWeighted<T>(
  options: ScoredOption<T>[],
  catalog: ReferenceCatalog | null | undefined = getCachedCatalog(),
): WeightedPickResult<T> | null {
  if (options.length === 0) {
    return null
  }
  const temperature = aiDecisionTemperature(catalog)
  const scores = options.map((option) => option.score)
  const peak = Math.max(...scores)
  const optionWeights = scores.map((score) =>
    Math.exp((score - peak) / temperature),
  )
  const weightSum = optionWeights.reduce((sum, n) => sum + n, 0)
  const roll = Math.random() * weightSum
  let cursor = 0
  for (let i = 0; i < options.length; i += 1) {
    cursor += optionWeights[i]
    if (roll <= cursor) {
      return {
        picked: options[i],
        roll,
        weightSum,
        temperature,
        optionWeights,
      }
    }
  }
  return {
    picked: options[options.length - 1],
    roll,
    weightSum,
    temperature,
    optionWeights,
  }
}
