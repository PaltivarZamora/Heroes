import { ENERGY_RESOURCE_ID } from './abilityStatMath';
function abilityResourceRow(catalog, resourceId) {
    return catalog?.ability_resource.find((row) => row.id === resourceId);
}
/** True when the ability spends Energy (strength pool); else Mana (intel). */
export function isEnergyAbilityResource(catalog, resourceId) {
    const row = abilityResourceRow(catalog, resourceId);
    if (row) {
        const value = row.value.trim().toLowerCase();
        if (value.includes('energy')) {
            return true;
        }
        if (value.includes('mana')) {
            return false;
        }
    }
    return resourceId === ENERGY_RESOURCE_ID;
}
export function heroStatForAbilityResource(catalog, stats, resourceId) {
    return isEnergyAbilityResource(catalog, resourceId)
        ? stats.strength
        : stats.intel;
}
export function resourceStatForAbilityResource(catalog, strength, intel, resourceId) {
    return isEnergyAbilityResource(catalog, resourceId) ? strength : intel;
}
