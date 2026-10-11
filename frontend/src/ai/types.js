/** Player-level default when New Game / test scenario doesn't pick one. */
export const DEFAULT_AI_ARCH_ID = 1;
/** World mobs always fight with Aggressive `combat_action` weights. */
export const MOB_ARCH_ID = 3;
/** Neutral town garrisons fight with Defend `combat_action` weights. */
export const NEUTRAL_GARRISON_ARCH_ID = 4;
export const WORLD_MOVE_DECISION = 'world_move';
export const TOWN_BUILD_DECISION = 'town_build';
export const ARMY_ALLOC_DECISION = 'army_alloc';
export const COMBAT_ACTION_DECISION = 'combat_action';
export const MOB_FLEE_RESPONSE_DECISION = 'mob_flee_response';
export const WORLD_MOVE_FACTORS = [
    'safety',
    'resource_value',
    'explore_value',
    'return_home',
    'garrison_value',
    'capture_town',
    'learn_ability_value',
    'attack_value',
];
export const TOWN_BUILD_FACTORS = [
    'economy_value',
    'army_value',
    'defense_value',
    'hero_value',
];
export const COMBAT_ACTION_FACTORS = [
    'kill_potential',
    'target_weakness',
    'target_threat',
    'protect_ally',
];
export const HERO_ABILITY_DECISION = 'hero_ability';
export const HERO_ABILITY_FACTORS = [
    'dmg_bias',
    'heal_bias',
    'buff_bias',
    'debuff_bias',
    'condition_bias',
    'summon_bias',
];
