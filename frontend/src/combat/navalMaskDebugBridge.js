let state = null;
const listeners = new Set();
function notify() {
    for (const listener of listeners) {
        listener();
    }
}
export function setNavalMaskDebugState(next) {
    state = next;
    notify();
}
export function getNavalMaskDebugState() {
    return state;
}
export function subscribeNavalMaskDebug(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
