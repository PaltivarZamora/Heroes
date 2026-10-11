import type { HeroStats, ReferenceCatalog } from '../town/catalog'
import { ENERGY_RESOURCE_ID } from './abilityStatMath'

function abilityResourceRow(
  catalog: ReferenceCatalog | null | undefined,
  resourceId: number,
) {
  return catalog?.ability_resource.find((row) => row.id === resourceId)
}

/** True when the ability spends Energy (strength pool); else Mana (intel). */
export function isEnergyAbilityResource(
  catalog: ReferenceCatalog | null | undefined,
  resourceId: number,
): boolean {
  const row = abilityResourceRow(catalog, resourceId)
  if (row) {
    const value = row.value.trim().toLowerCase()
    if (value.includes('energy')) {
      return true
    }
    if (value.includes('mana')) {
      return false
    }
  }
  return resourceId === ENERGY_RESOURCE_ID
}

export function heroStatForAbilityResource(
  catalog: ReferenceCatalog | null | undefined,
  stats: HeroStats,
  resourceId: number,
): number {
  return isEnergyAbilityResource(catalog, resourceId)
    ? stats.strength
    : stats.intel
}

export function resourceStatForAbilityResource(
  catalog: ReferenceCatalog | null | undefined,
  strength: number,
  intel: number,
  resourceId: number,
): number {
  return isEnergyAbilityResource(catalog, resourceId) ? strength : intel
}
