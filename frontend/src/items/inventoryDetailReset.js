/** Clear hover/detail panes on all open {@link HeroInventory} panels (trade, etc.). */
const listeners = new Set();
export function subscribeInventoryDetailReset(listener) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
export function resetAllInventoryDetails() {
    for (const listener of listeners) {
        listener();
    }
}
