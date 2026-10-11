/** Universal 16-slot town layout (`building.slot_num`). */
export const BUILDING_SLOT_LIBRARY = 5;
export const BUILDING_SLOT_TAVERN = 6;
export const BUILDING_SLOT_MARKETPLACE = 7;
export const BUILDING_SLOT_HANGER = 8;
export const BUILDING_SLOT_TOWN_UNIQUE = 9;
export function buildingSlotNum(building) {
    const slot = building?.slot_num;
    return slot != null && slot > 0 ? slot : null;
}
export function buildingInSlot(building, slotNum) {
    return buildingSlotNum(building) === slotNum;
}
