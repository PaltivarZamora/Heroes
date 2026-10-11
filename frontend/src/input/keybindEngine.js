import { FALLBACK_KEYBIND_ROWS } from './keybindDefaults';
import { getCachedCatalog } from '../town/catalog';
import { loadKeybindOverrides } from '../settings/playerSettings';
const warnedMissingActions = new Set();
function warnMissingKeybind(action) {
    if (warnedMissingActions.has(action)) {
        return;
    }
    warnedMissingActions.add(action);
    console.warn(`[keybind] Catalog has no row for action "${action}"; using fallback binding.`);
}
/** Normalize DB / fallback key strings to match `normalizeKey(event)`. */
export function normalizeStoredKey(key) {
    const trimmed = key.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'space') {
        return ' ';
    }
    const lower = trimmed.toLowerCase();
    if (lower === 'escape' || lower === 'esc') {
        return 'escape';
    }
    if (lower === 'enter' || lower === 'return') {
        return 'enter';
    }
    if (lower === 'tab') {
        return 'tab';
    }
    return trimmed.length === 1 ? trimmed.toLowerCase() : lower;
}
function normalizeKeybindRow(row) {
    return {
        ...row,
        key: normalizeStoredKey(row.key),
        alt_key: row.alt_key ? normalizeStoredKey(row.alt_key) : null,
    };
}
/** Rows exactly as loaded from the catalog (Settings UI). */
export function keybindDbRows() {
    const catalog = getCachedCatalog();
    const rows = catalog?.keybind;
    if (!rows || rows.length === 0) {
        return [];
    }
    return [...rows].map(normalizeKeybindRow).sort((a, b) => a.sort_order - b.sort_order);
}
/** DB rows plus fallbacks for actions the handler needs (with warnings). */
export function keybindCatalogRows() {
    const fromDb = keybindDbRows();
    if (fromDb.length === 0) {
        for (const row of FALLBACK_KEYBIND_ROWS) {
            warnMissingKeybind(row.action);
        }
        return [...FALLBACK_KEYBIND_ROWS].map(normalizeKeybindRow);
    }
    const byAction = new Set(fromDb.map((row) => row.action));
    const merged = [...fromDb];
    for (const fallback of FALLBACK_KEYBIND_ROWS) {
        if (!byAction.has(fallback.action)) {
            warnMissingKeybind(fallback.action);
            merged.push(normalizeKeybindRow(fallback));
        }
    }
    return merged.sort((a, b) => a.sort_order - b.sort_order);
}
export function resolvedKeybinds() {
    const overrides = loadKeybindOverrides();
    return keybindCatalogRows().map((row) => {
        const o = overrides[row.action];
        if (!o) {
            return row;
        }
        return {
            ...row,
            key: normalizeStoredKey(o.key),
            alt_key: o.altKey != null ? normalizeStoredKey(o.altKey) : null,
        };
    });
}
export function normalizeKey(event) {
    if (event.key === ' ') {
        return ' ';
    }
    if (event.key === 'Escape') {
        return 'escape';
    }
    if (event.key === 'Enter') {
        return 'enter';
    }
    if (event.key === 'Tab') {
        return 'tab';
    }
    return event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
}
export function bindingLabel(action) {
    const row = resolvedKeybinds().find((r) => r.action === action);
    if (!row) {
        return '';
    }
    const primary = formatKeyLabel(row.key);
    if (row.alt_key) {
        return `${primary}/${formatKeyLabel(row.alt_key)}`;
    }
    return primary;
}
export function tooltipWithKey(label, action) {
    const key = bindingLabel(action);
    return key ? `${label} (${key.toUpperCase()})` : label;
}
export function formatKeyLabel(key) {
    if (key === ' ') {
        return 'Space';
    }
    if (key === 'escape') {
        return 'Esc';
    }
    return key.length === 1 ? key.toUpperCase() : key;
}
const SCOPE_PRIORITY = [
    'popup',
    'battle',
    'map_view',
    'town',
    'hero',
    'world',
    'global',
];
export function activeScopes(context) {
    const scopes = [];
    if (context.popupOpen) {
        scopes.push('popup');
    }
    if (context.inBattle) {
        scopes.push('battle');
    }
    if (context.mapViewOpen) {
        scopes.push('map_view');
    }
    if (context.townOpen) {
        scopes.push('town');
    }
    if (context.heroOpen) {
        scopes.push('hero');
    }
    scopes.push('world', 'global');
    return scopes;
}
function scopeRank(scope) {
    const index = SCOPE_PRIORITY.indexOf(scope);
    return index >= 0 ? index : 99;
}
export function matchKeybindAction(event, scopes) {
    const key = normalizeKey(event);
    if (key === 'f5' || key === 'f11') {
        return null;
    }
    const scopeSet = new Set(scopes);
    const rows = resolvedKeybinds()
        .filter((row) => scopeSet.has(row.scope) || row.scope === 'global')
        .sort((a, b) => {
        const byScope = scopeRank(a.scope) - scopeRank(b.scope);
        if (byScope !== 0) {
            return byScope;
        }
        return a.sort_order - b.sort_order;
    });
    const matches = [];
    for (const row of rows) {
        const primary = normalizeStoredKey(row.key);
        const alt = row.alt_key != null ? normalizeStoredKey(row.alt_key) : null;
        if (key === primary || (alt != null && key === alt)) {
            matches.push(row);
        }
    }
    if (matches.length === 0) {
        return null;
    }
    const overlay = matches.find((row) => row.action === 'quest_log' || row.action === 'log');
    return overlay?.action ?? matches[0].action;
}
