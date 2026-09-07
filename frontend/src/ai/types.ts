/** Player-level default when New Game / test scenario doesn't pick one. */
export const DEFAULT_AI_ARCH_ID = 1
/** World mobs always fight with Aggressive `combat_action` weights. */
export const MOB_ARCH_ID = 3

export const WORLD_MOVE_DECISION = 'world_move'
export const TOWN_BUILD_DECISION = 'town_build'
export const ARMY_ALLOC_DECISION = 'army_alloc'
export const COMBAT_ACTION_DECISION = 'combat_action'

export const WORLD_MOVE_FACTORS = [
  'safety',
  'resource_value',
  'explore_value',
  'return_home',
  'garrison_value',
  'capture_town',
  'learn_ability_value',
  'attack_value',
] as const

export const TOWN_BUILD_FACTORS = [
  'economy_value',
  'army_value',
  'defense_value',
  'hero_value',
] as const

export const COMBAT_ACTION_FACTORS = [
  'kill_potential',
  'target_weakness',
  'target_threat',
  'protect_ally',
] as const

export const HERO_ABILITY_DECISION = 'hero_ability'

export const HERO_ABILITY_FACTORS = [
  'dmg_bias',
  'heal_bias',
  'buff_bias',
  'debuff_bias',
  'condition_bias',
  'summon_bias',
] as const

export type WorldMoveFactor = (typeof WORLD_MOVE_FACTORS)[number]
export type TownBuildFactor = (typeof TOWN_BUILD_FACTORS)[number]
export type CombatActionFactor = (typeof COMBAT_ACTION_FACTORS)[number]
export type HeroAbilityFactor = (typeof HERO_ABILITY_FACTORS)[number]

export type FactorScores = Record<string, number>

export type ScoredOption<T> = {
  id: string
  label: string
  factors: FactorScores
  weights: FactorScores
  score: number
  data: T
}

export type WeightedPickResult<T> = {
  picked: ScoredOption<T>
  roll: number
  weightSum: number
  temperature: number
  optionWeights: number[]
}
