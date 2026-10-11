import { createInitialSession } from './create';
import { normalizeSessionGameLogs } from './gameLog';
import { normalizeSessionItems } from '../items/state';
import { normalizeHeroProgress } from './accessors';
let session = createInitialSession();
const listeners = new Set();
function emit() {
    for (const listener of listeners) {
        listener();
    }
}
export function getSession() {
    return session;
}
export function subscribe(listener) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
export function setSession(next) {
    session = normalizeSessionItems(normalizeHeroProgress(normalizeSessionGameLogs(next)));
    emit();
}
export function updateSession(fn) {
    session = normalizeSessionItems(normalizeHeroProgress(fn(session)));
    emit();
    return session;
}
