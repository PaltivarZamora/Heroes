import type { Hero } from '../session/types'
import type { ReferenceCatalog } from './catalog'
import { heroPassiveStats } from './heroPassiveStats'
import { logConfigOnce } from '../session/configLog'

/** Stable mechanic ids in `hero_type.passive_stats.passive_key` (set via SQL). */
export const PASSIVE_KEY = {
  KNIGHT_DOUBLE_RETALIATION: 'knight_double_retaliation',
  MONK_REFLECT_RETALIATION: 'monk_reflect_retaliation',
  CLERIC_HEAL: 'cleric_heal',
  PALADIN_ARMY_BONUS: 'paladin_army_bonus',
  RANGER_SURPRISE: 'ranger_surprise',
  BARBARIAN_ARMY_PHYS: 'barbarian_army_phys',
  ROGUE_ENERGY: 'rogue_energy',
  DRUID_MANA: 'druid_mana',
  WIZARD_MANA: 'wizard_mana',
  SORCERER_MANA: 'sorcerer_mana',
  EVOKER_SPELL_BONUS: 'evoker_spell_bonus',
  SHAMAN_TOTEMS: 'shaman_totems',
  FORGE_MASTER_ARMY_PHYS: 'forge_master_army_phys',
  CONJURER_ARMY_MAGIC: 'conjurer_army_magic',
  DEATH_KNIGHT_SHADOW: 'death_knight_shadow',
  NECROMANCER_SHADOW: 'necromancer_shadow',
  WARLOCK_DEMON_REINFORCEMENT: 'warlock_demon_reinforcement',
  HERETIC_DEMON_REINFORCEMENT: 'heretic_demon_reinforcement',
} as const

export type PassiveKey = (typeof PASSIVE_KEY)[keyof typeof PASSIVE_KEY]

const warnedMissingKey = new Set<number>()

export function passiveKeyForHero(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): string | null {
  const stats = heroPassiveStats(catalog, hero)
  if (!stats) {
    return null
  }
  const raw = stats.passive_key
  if (typeof raw !== 'string') {
    return null
  }
  const key = raw.trim()
  return key.length > 0 ? key : null
}

/** True when this hero's passive_key matches (no name fallback). */
export function hasPassiveKey(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  key: PassiveKey | string,
): boolean {
  if (!hero?.class_id) {
    return false
  }
  const got = passiveKeyForHero(catalog, hero)
  if (!got) {
    if (!warnedMissingKey.has(hero.class_id)) {
      warnedMissingKey.add(hero.class_id)
      logConfigOnce(
        `passive_key:${hero.class_id}`,
        `[passive_key] hero_type.id=${hero.class_id} has no passive_stats.passive_key; passive "${key}" disabled`,
      )
    }
    return false
  }
  return got === key
}
