import { getCachedCatalog, heroResourcePools } from '../town/catalog';
import { isHeroStack, } from './battle';
import { stackOccupyingHex } from './occupancy';
const ENERGY_RESOURCE_ID = 1;
export function disciplineResourceId(catalog, disciplineId) {
    const row = catalog.ability.find((ability) => ability.discipline_id === disciplineId);
    return row?.resource_id ?? 2;
}
export function resourceLabel(catalog, resourceId) {
    return (catalog.ability_resource.find((row) => row.id === resourceId)?.value ??
        (resourceId === ENERGY_RESOURCE_ID ? 'Energy' : 'Mana'));
}
export function poolCurrent(hero, resourceId) {
    return resourceId === ENERGY_RESOURCE_ID ? hero.current_energy : hero.current_mana;
}
export function poolMax(catalog, hero, resourceId) {
    const pools = heroResourcePools(catalog, hero);
    return resourceId === ENERGY_RESOURCE_ID
        ? pools.current_energy
        : pools.current_mana;
}
/** Spend the ability row's own `cost` column — never a tier default. */
export function abilityCastCost(ability) {
    const live = getCachedCatalog()?.ability.find((row) => row.id === ability.id) ?? ability;
    return Math.max(0, Math.floor(live.cost));
}
export function canAffordAbility(hero, ability) {
    return poolCurrent(hero, ability.resource_id) >= abilityCastCost(ability);
}
export function deductAbilityCost(hero, ability) {
    const cost = abilityCastCost(ability);
    if (ability.resource_id === ENERGY_RESOURCE_ID) {
        return { ...hero, current_energy: Math.max(0, hero.current_energy - cost) };
    }
    return { ...hero, current_mana: Math.max(0, hero.current_mana - cost) };
}
const COOLDOWN_ONCE_PER_BATTLE = 1;
const COOLDOWN_DAILY = 2;
function usedIds(list) {
    return Array.isArray(list) ? list : [];
}
function withAbilityId(list, abilityId) {
    return list.includes(abilityId) ? list : [...list, abilityId];
}
/** Record a resolved cast on both battle and daily lists. */
export function recordAbilityCast(hero, abilityId) {
    return {
        ...hero,
        used_abilities_this_battle: withAbilityId(usedIds(hero.used_abilities_this_battle), abilityId),
        used_abilities_today: withAbilityId(usedIds(hero.used_abilities_today), abilityId),
    };
}
/** Null when the cooldown gate passes. Independent of affordability. */
export function abilityCooldownMessage(hero, ability) {
    if (ability.cooldown_id === COOLDOWN_ONCE_PER_BATTLE) {
        return usedIds(hero.used_abilities_this_battle).includes(ability.id)
            ? 'Already used this battle'
            : null;
    }
    if (ability.cooldown_id === COOLDOWN_DAILY) {
        return usedIds(hero.used_abilities_today).includes(ability.id)
            ? 'Already used today'
            : null;
    }
    return null;
}
export function abilityCooldownReady(hero, ability) {
    return abilityCooldownMessage(hero, ability) == null;
}
export function markHeroActed(battle, heroStackId) {
    return {
        ...battle,
        stacks: battle.stacks.map((stack) => stack.id === heroStackId ? { ...stack, hasActedThisRound: true } : stack),
    };
}
export function ownHeroAtHex(battle, catalog, q, r, side) {
    const occupant = stackOccupyingHex(battle.stacks, q, r, catalog) ??
        battle.stacks.find((row) => row.q === q && row.r === r) ??
        null;
    if (occupant == null ||
        !isHeroStack(occupant) ||
        occupant.side !== side) {
        return null;
    }
    return occupant;
}
