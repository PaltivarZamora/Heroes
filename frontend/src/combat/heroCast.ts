import type { Hero } from '../session/types'
import type { AbilityRow, ReferenceCatalog } from '../town/catalog'
import { getCachedCatalog, heroResourcePools } from '../town/catalog'
import {
  isHeroStack,
  type CombatBattle,
  type CombatSide,
  type CombatStack,
} from './battle'
import { stackOccupyingHex } from './occupancy'

const ENERGY_RESOURCE_ID = 1

export type HeroCast = {
  stackId: string
  abilityId: number | null
}

export function disciplineResourceId(
  catalog: ReferenceCatalog,
  disciplineId: number,
): number {
  const row = catalog.ability.find((ability) => ability.discipline_id === disciplineId)
  return row?.resource_id ?? 2
}

export function resourceLabel(
  catalog: ReferenceCatalog,
  resourceId: number,
): string {
  return (
    catalog.ability_resource.find((row) => row.id === resourceId)?.value ??
    (resourceId === ENERGY_RESOURCE_ID ? 'Energy' : 'Mana')
  )
}

export function poolCurrent(hero: Hero, resourceId: number): number {
  return resourceId === ENERGY_RESOURCE_ID ? hero.current_energy : hero.current_mana
}

export function poolMax(
  catalog: ReferenceCatalog,
  hero: Hero,
  resourceId: number,
): number {
  const pools = heroResourcePools(catalog, hero)
  return resourceId === ENERGY_RESOURCE_ID
    ? pools.current_energy
    : pools.current_mana
}

/** Spend the ability row's own `cost` column — never a tier default. */
export function abilityCastCost(ability: AbilityRow): number {
  const live =
    getCachedCatalog()?.ability.find((row) => row.id === ability.id) ?? ability
  return Math.max(0, Math.floor(live.cost))
}

export function canAffordAbility(hero: Hero, ability: AbilityRow): boolean {
  return poolCurrent(hero, ability.resource_id) >= abilityCastCost(ability)
}

export function deductAbilityCost(hero: Hero, ability: AbilityRow): Hero {
  const cost = abilityCastCost(ability)
  if (ability.resource_id === ENERGY_RESOURCE_ID) {
    return { ...hero, current_energy: Math.max(0, hero.current_energy - cost) }
  }
  return { ...hero, current_mana: Math.max(0, hero.current_mana - cost) }
}

const COOLDOWN_ONCE_PER_BATTLE = 1
const COOLDOWN_DAILY = 2

function usedIds(list: number[] | undefined): number[] {
  return Array.isArray(list) ? list : []
}

function withAbilityId(list: number[], abilityId: number): number[] {
  return list.includes(abilityId) ? list : [...list, abilityId]
}

/** Record a resolved cast on both battle and daily lists. */
export function recordAbilityCast(hero: Hero, abilityId: number): Hero {
  return {
    ...hero,
    used_abilities_this_battle: withAbilityId(
      usedIds(hero.used_abilities_this_battle),
      abilityId,
    ),
    used_abilities_today: withAbilityId(
      usedIds(hero.used_abilities_today),
      abilityId,
    ),
  }
}

/** Null when the cooldown gate passes. Independent of affordability. */
export function abilityCooldownMessage(
  hero: Hero,
  ability: AbilityRow,
): string | null {
  if (ability.cooldown_id === COOLDOWN_ONCE_PER_BATTLE) {
    return usedIds(hero.used_abilities_this_battle).includes(ability.id)
      ? 'Already used this battle'
      : null
  }
  if (ability.cooldown_id === COOLDOWN_DAILY) {
    return usedIds(hero.used_abilities_today).includes(ability.id)
      ? 'Already used today'
      : null
  }
  return null
}

export function abilityCooldownReady(hero: Hero, ability: AbilityRow): boolean {
  return abilityCooldownMessage(hero, ability) == null
}

export function markHeroActed(
  battle: CombatBattle,
  heroStackId: string,
): CombatBattle {
  return {
    ...battle,
    stacks: battle.stacks.map((stack) =>
      stack.id === heroStackId ? { ...stack, hasActedThisRound: true } : stack,
    ),
  }
}

export function ownHeroAtHex(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  q: number,
  r: number,
  side: CombatSide,
): CombatStack | null {
  const occupant =
    stackOccupyingHex(battle.stacks, q, r, catalog) ??
    battle.stacks.find((row) => row.q === q && row.r === r) ??
    null
  if (
    occupant == null ||
    !isHeroStack(occupant) ||
    occupant.side !== side
  ) {
    return null
  }
  return occupant
}
