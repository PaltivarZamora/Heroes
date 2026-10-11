import { unitById } from '../town/catalog';
import { poolMax } from './heroCast';
import { isHeroClass } from './shadow';
const MANA_RESOURCE_ID = 2;
export function isTowerUnit(catalog, unitId) {
    const unit = unitById(catalog, unitId);
    if (!unit?.town_id) {
        return false;
    }
    const towerId = catalog.town.find((row) => row.name.trim().toLowerCase() === 'tower')?.id;
    return towerId != null && unit.town_id === towerId;
}
export function towerUnitGetsPassives(catalog, stack) {
    return stack != null && isTowerUnit(catalog, stack.unitId);
}
/** +amount mana, capped at the Hero's max mana pool. */
export function grantHeroMana(catalog, hero, amount) {
    if (amount <= 0) {
        return hero;
    }
    const max = poolMax(catalog, hero, MANA_RESOURCE_ID);
    const next = Math.min(max, hero.current_mana + amount);
    if (next === hero.current_mana) {
        return hero;
    }
    return { ...hero, current_mana: next };
}
export function isWizardHero(catalog, hero) {
    return isHeroClass(catalog, hero, 'Wizard');
}
export function isSorcererHero(catalog, hero) {
    return isHeroClass(catalog, hero, 'Sorcerer');
}
