import { heroResourcePools } from '../town/catalog';
import { rolledItemSlotTypeId } from './display';
import { BACKPACK_SIZE } from './types';
import { normalizeHeroInventory } from './state';
function clampHeroPools(catalog, hero) {
    const pools = heroResourcePools(catalog, hero);
    return {
        ...hero,
        current_mana: Math.min(hero.current_mana, pools.current_mana),
        current_energy: Math.min(hero.current_energy, pools.current_energy),
    };
}
/**
 * BR S9-41: equip into empty slot, else first empty backpack cell, else fail.
 */
export function giveItemToHero(session, catalog, heroId, item) {
    const heroIndex = session.heroes.findIndex((row) => row.id === heroId);
    if (heroIndex < 0) {
        return { session, ok: false, message: 'Hero not found' };
    }
    let hero = normalizeHeroInventory(session.heroes[heroIndex]);
    const slotTypeId = rolledItemSlotTypeId(catalog, item);
    if (slotTypeId != null && !hero.equipment[slotTypeId]) {
        hero = {
            ...hero,
            equipment: { ...hero.equipment, [slotTypeId]: item },
        };
        hero = clampHeroPools(catalog, hero);
        const heroes = [...session.heroes];
        heroes[heroIndex] = hero;
        return { session: { ...session, heroes }, ok: true };
    }
    for (let i = 0; i < BACKPACK_SIZE; i++) {
        if (!hero.backpack[i]) {
            const backpack = [...hero.backpack];
            backpack[i] = item;
            hero = clampHeroPools(catalog, { ...hero, backpack });
            const heroes = [...session.heroes];
            heroes[heroIndex] = hero;
            return { session: { ...session, heroes }, ok: true };
        }
    }
    return { session, ok: false, message: 'No room' };
}
/** Whether {@link giveItemToHero} would succeed (no session mutation). */
export function canGiveItemToHero(session, catalog, heroId, item) {
    const heroIndex = session.heroes.findIndex((row) => row.id === heroId);
    if (heroIndex < 0) {
        return false;
    }
    const hero = normalizeHeroInventory(session.heroes[heroIndex]);
    const slotTypeId = rolledItemSlotTypeId(catalog, item);
    if (slotTypeId != null && !hero.equipment[slotTypeId]) {
        return true;
    }
    for (let i = 0; i < BACKPACK_SIZE; i++) {
        if (!hero.backpack[i]) {
            return true;
        }
    }
    return false;
}
