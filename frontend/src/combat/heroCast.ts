import type { Hero } from '../session/types'
import type { AbilityRow, ReferenceCatalog } from '../town/catalog'
import { heroResourcePools } from '../town/catalog'
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

export function canAffordAbility(hero: Hero, ability: AbilityRow): boolean {
  return poolCurrent(hero, ability.resource_id) >= Math.max(0, Math.floor(ability.cost))
}

export function deductAbilityCost(hero: Hero, ability: AbilityRow): Hero {
  const cost = Math.max(0, Math.floor(ability.cost))
  if (ability.resource_id === ENERGY_RESOURCE_ID) {
    return { ...hero, current_energy: Math.max(0, hero.current_energy - cost) }
  }
  return { ...hero, current_mana: Math.max(0, hero.current_mana - cost) }
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
    occupant.side !== side ||
    occupant.hasActedThisRound
  ) {
    return null
  }
  return occupant
}
