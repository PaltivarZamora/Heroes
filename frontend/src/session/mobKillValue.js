import { isCreatureArmyUnit } from '../combat/siege';
import { unitById } from '../town/catalog';
import { partsArmyValue } from './xp';
export function creatureOpeningSideValue(catalog, opening, side) {
    const parts = opening
        .filter((row) => row.side === side)
        .filter((row) => {
        const unit = unitById(catalog, row.unitId);
        return unit != null && isCreatureArmyUnit(unit);
    })
        .map((row) => ({ unitId: row.unitId, qty: row.qty }));
    return partsArmyValue(catalog, parts);
}
