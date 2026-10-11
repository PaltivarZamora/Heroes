import { getCachedCatalog } from '../town/catalog';
import { appConfigNumber } from '../town/catalog';
const STORAGE_KEY = 'heroes.playerSettings.v1';
const KEYBIND_OVERRIDES_KEY = 'heroes.keybindOverrides.v1';
function defaultFromCatalog() {
    const catalog = getCachedCatalog();
    return {
        confirmEndTurn: appConfigNumber(catalog, 'setting_confirm_end_turn', 1) !== 0,
        confirmUpgrade: appConfigNumber(catalog, 'setting_confirm_upgrade', 1) !== 0,
        confirmUpgradeAll: appConfigNumber(catalog, 'setting_confirm_upgrade_all', 1) !== 0,
        volumeMusic: Math.min(100, Math.max(0, appConfigNumber(catalog, 'setting_volume_music', 80))),
        volumeEffects: Math.min(100, Math.max(0, appConfigNumber(catalog, 'setting_volume_effects', 80))),
        volumeUi: Math.min(100, Math.max(0, appConfigNumber(catalog, 'setting_volume_ui', 80))),
        combatEndTimerSec: null,
        combatLogTimerSec: null,
        fullscreenPreferred: false,
        hexScale: null,
    };
}
export function loadPlayerSettings() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return defaultFromCatalog();
        }
        const parsed = JSON.parse(raw);
        return { ...defaultFromCatalog(), ...parsed };
    }
    catch {
        return defaultFromCatalog();
    }
}
export function savePlayerSettings(next) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
export function loadKeybindOverrides() {
    try {
        const raw = localStorage.getItem(KEYBIND_OVERRIDES_KEY);
        if (!raw) {
            return {};
        }
        return JSON.parse(raw);
    }
    catch {
        return {};
    }
}
export function saveKeybindOverrides(overrides) {
    localStorage.setItem(KEYBIND_OVERRIDES_KEY, JSON.stringify(overrides));
}
export function clearKeybindOverrides() {
    localStorage.removeItem(KEYBIND_OVERRIDES_KEY);
}
let warnedMissingDevTools = false;
export function devToolsEnabled() {
    const catalog = getCachedCatalog();
    const fromDb = appConfigNumber(catalog, 'dev_tools', -1);
    if (fromDb < 0) {
        if (!warnedMissingDevTools) {
            warnedMissingDevTools = true;
            console.warn('[app_config] Missing dev_tools; treating as off (dev keybind disabled).');
        }
        return false;
    }
    return fromDb !== 0;
}
/** Player override or catalog combat_config / app_config defaults. */
export function effectiveCombatEndTimerSec() {
    const settings = loadPlayerSettings();
    if (settings.combatEndTimerSec != null) {
        return settings.combatEndTimerSec;
    }
    const catalog = getCachedCatalog();
    return Math.max(0, Math.floor(appConfigNumber(catalog, 'combat_end_timer', 99)));
}
export function effectiveCombatLogTimerSec() {
    const settings = loadPlayerSettings();
    if (settings.combatLogTimerSec != null) {
        return settings.combatLogTimerSec;
    }
    const catalog = getCachedCatalog();
    return Math.max(0, Math.floor(appConfigNumber(catalog, 'combat_log_timer', 2)));
}
