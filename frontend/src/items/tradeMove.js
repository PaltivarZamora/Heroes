import { heroResourcePools } from '../town/catalog';
import { rolledItemSlotTypeId } from './display';
import { normalizeHeroInventory } from './state';
function clampHeroPools(catalog, hero) {
    const pools = heroResourcePools(catalog, hero);
    return {
        ...hero,
        current_mana: Math.min(hero.current_mana, pools.current_mana),
        current_energy: Math.min(hero.current_energy, pools.current_energy),
    };
}
function readAt(hero, loc) {
    if (loc.kind === 'backpack') {
        return hero.backpack[loc.index] ?? null;
    }
    return hero.equipment[loc.slotId] ?? null;
}
function writeAt(hero, loc, item) {
    if (loc.kind === 'backpack') {
        const backpack = [...hero.backpack];
        backpack[loc.index] = item;
        return { ...hero, backpack };
    }
    return {
        ...hero,
        equipment: { ...hero.equipment, [loc.slotId]: item },
    };
}
function canEquipInSlot(catalog, item, slotId) {
    const need = rolledItemSlotTypeId(catalog, item);
    return need != null && need === slotId;
}
function patchHero(session, heroIndex, hero) {
    const heroes = [...session.heroes];
    heroes[heroIndex] = hero;
    return { ...session, heroes };
}
/**
 * Move or swap items between two heroes in friendly trade (S9-40 rules per hero).
 */
export function moveTradeItem(session, catalog, fromHeroId, from, toHeroId, to, inCombat) {
    if (inCombat) {
        return { session, ok: false, message: 'Cannot move items during combat' };
    }
    if (fromHeroId === toHeroId) {
        return { session, ok: false, message: 'Use same-hero move' };
    }
    const fromIndex = session.heroes.findIndex((row) => row.id === fromHeroId);
    const toIndex = session.heroes.findIndex((row) => row.id === toHeroId);
    if (fromIndex < 0 || toIndex < 0) {
        return { session, ok: false, message: 'Hero not found' };
    }
    let fromHero = normalizeHeroInventory(session.heroes[fromIndex]);
    let toHero = normalizeHeroInventory(session.heroes[toIndex]);
    const moving = readAt(fromHero, from);
    if (!moving) {
        return { session, ok: false, message: 'Nothing to move in source slot' };
    }
    if (to.kind === 'equipment' && !canEquipInSlot(catalog, moving, to.slotId)) {
        return { session, ok: false, message: 'Wrong slot for this item' };
    }
    const target = readAt(toHero, to);
    if (!target) {
        fromHero = writeAt(fromHero, from, null);
        toHero = writeAt(toHero, to, moving);
        fromHero = clampHeroPools(catalog, fromHero);
        toHero = clampHeroPools(catalog, toHero);
        let next = patchHero(session, fromIndex, fromHero);
        next = patchHero(next, toIndex, toHero);
        return { session: next, ok: true };
    }
    if (from.kind === 'equipment' &&
        !canEquipInSlot(catalog, target, from.slotId)) {
        return {
            session,
            ok: false,
            message: 'Swapped item cannot go in that equipment slot',
        };
    }
    if (to.kind === 'equipment' && !canEquipInSlot(catalog, moving, to.slotId)) {
        return { session, ok: false, message: 'Wrong slot for this item' };
    }
    fromHero = writeAt(fromHero, from, target);
    toHero = writeAt(toHero, to, moving);
    fromHero = clampHeroPools(catalog, fromHero);
    toHero = clampHeroPools(catalog, toHero);
    let next = patchHero(session, fromIndex, fromHero);
    next = patchHero(next, toIndex, toHero);
    return { session: next, ok: true };
}
