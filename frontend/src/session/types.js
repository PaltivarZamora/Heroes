export const HUMAN_PLAYER_ID = 'player-1';
export const GAME_ID = 'game-1';
export const HERO_ID = 'hero-1';
export const NECROPOLIS_TOWN_TYPE_ID = 6;
export const BUILDING_SLOT_COUNT = 16;
export const ARMY_STACK_SLOTS = 6;
export function playerIdForSlot(slot) {
    return `player-${slot}`;
}
export function slotFromPlayerId(playerId) {
    if (!playerId.startsWith('player-')) {
        return null;
    }
    const slot = Number(playerId.slice('player-'.length));
    if (!Number.isInteger(slot) || slot < 1) {
        return null;
    }
    return slot;
}
