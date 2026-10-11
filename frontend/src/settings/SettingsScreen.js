import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { GameWindowModal } from '../layout/GameWindowModal';
import { GameWindowOverlay } from '../layout/GameWindowOverlay';
import { HEX_SCALES } from '../hex/hexScale';
import { clearKeybindOverrides, loadKeybindOverrides, loadPlayerSettings, saveKeybindOverrides, savePlayerSettings, } from './playerSettings';
import { formatKeyLabel, keybindDbRows, resolvedKeybinds, } from '../input/keybindEngine';
import { appConfigNumber, getCachedCatalog } from '../town/catalog';
function normalizeBindingKey(event) {
    if (event.key === 'Escape') {
        return null;
    }
    if (event.key === ' ') {
        return ' ';
    }
    if (event.key === 'Enter') {
        return 'enter';
    }
    if (event.key === 'Tab') {
        return 'tab';
    }
    if (event.key.length === 1) {
        return event.key.toLowerCase();
    }
    return null;
}
export function SettingsScreen({ open, initialTab = 'audio', hexScale, onHexScale, onClose, }) {
    const [tab, setTab] = useState(initialTab);
    const [settings, setSettings] = useState(() => loadPlayerSettings());
    const [rebinding, setRebinding] = useState(null);
    const [conflict, setConflict] = useState(null);
    useEffect(() => {
        if (open) {
            setTab(initialTab);
            setSettings(loadPlayerSettings());
        }
    }, [open, initialTab]);
    useEffect(() => {
        if (!rebinding) {
            return;
        }
        const onKey = (event) => {
            event.preventDefault();
            event.stopPropagation();
            const key = normalizeBindingKey(event);
            if (!key) {
                setRebinding(null);
                return;
            }
            const overrides = loadKeybindOverrides();
            const taken = resolvedKeybinds().find((row) => row.action !== rebinding &&
                (row.key === key || row.alt_key === key));
            if (taken) {
                setConflict(`${taken.label} already uses that key — swapped.`);
                overrides[taken.action] = {
                    key: overrides[rebinding]?.key ?? taken.key,
                    altKey: overrides[rebinding]?.altKey ?? taken.alt_key,
                };
            }
            else {
                setConflict(null);
            }
            overrides[rebinding] = { key, altKey: null };
            saveKeybindOverrides(overrides);
            setRebinding(null);
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [rebinding]);
    const persist = (patch) => {
        const next = { ...settings, ...patch };
        setSettings(next);
        savePlayerSettings(next);
    };
    if (!open) {
        return null;
    }
    return (_jsx(GameWindowOverlay, { children: _jsxs(GameWindowModal, { "aria-labelledby": "settings-title", onBackdropClick: onClose, className: "settings-modal", children: [_jsx("h1", { id: "settings-title", children: "Settings" }), _jsx("div", { className: "settings-tabs", children: ['audio', 'popups', 'keybinds', 'video'].map((id) => (_jsx("button", { type: "button", className: tab === id ? 'is-active' : undefined, onClick: () => setTab(id), children: id === 'audio'
                            ? 'Audio'
                            : id === 'popups'
                                ? 'Popups'
                                : id === 'keybinds'
                                    ? 'Keybinds'
                                    : 'Video' }, id))) }), tab === 'audio' ? (_jsxs("div", { className: "settings-panel", children: [_jsxs("label", { children: ["Music", _jsx("input", { type: "range", min: 0, max: 100, value: settings.volumeMusic, onChange: (e) => persist({ volumeMusic: Number(e.target.value) }) })] }), _jsxs("label", { children: ["Effects", _jsx("input", { type: "range", min: 0, max: 100, value: settings.volumeEffects, onChange: (e) => persist({ volumeEffects: Number(e.target.value) }) })] }), _jsxs("label", { children: ["UI", _jsx("input", { type: "range", min: 0, max: 100, value: settings.volumeUi, onChange: (e) => persist({ volumeUi: Number(e.target.value) }) })] })] })) : null, tab === 'popups' ? (_jsxs("div", { className: "settings-panel", children: [_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: settings.confirmEndTurn, onChange: (e) => persist({ confirmEndTurn: e.target.checked }) }), "Warn before End Turn"] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: settings.confirmUpgrade, onChange: (e) => persist({ confirmUpgrade: e.target.checked }) }), "Confirm individual upgrades"] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: settings.confirmUpgradeAll, onChange: (e) => persist({ confirmUpgradeAll: e.target.checked }) }), "Confirm mass upgrades"] }), _jsxs("label", { children: ["Battle results popup (sec, 0=off, 99=until closed)", _jsx("input", { type: "number", min: 0, max: 99, value: settings.combatEndTimerSec ??
                                        effectiveCatalogTimer('end'), onChange: (e) => persist({
                                        combatEndTimerSec: Number(e.target.value),
                                    }) })] }), _jsxs("label", { children: ["Battle log popup (sec, 0=off, 99=until closed)", _jsx("input", { type: "number", min: 0, max: 99, value: settings.combatLogTimerSec ??
                                        effectiveCatalogTimer('log'), onChange: (e) => persist({
                                        combatLogTimerSec: Number(e.target.value),
                                    }) })] })] })) : null, tab === 'keybinds' ? (_jsxs("div", { className: "settings-panel settings-keybinds", children: [conflict ? _jsx("p", { className: "settings-hint", children: conflict }) : null, _jsxs("ul", { children: [keybindDbRows().length === 0 ? (_jsx("li", { className: "settings-hint", children: "No keybind rows loaded from catalog." })) : null, keybindDbRows().map((row) => {
                                    const live = resolvedKeybinds().find((r) => r.action === row.action);
                                    const displayKey = live?.key ?? row.key;
                                    return (_jsxs("li", { children: [_jsx("span", { children: row.label }), _jsx("button", { type: "button", disabled: !row.rebindable, onClick: () => row.rebindable && setRebinding(row.action), children: rebinding === row.action
                                                    ? 'Press a key…'
                                                    : formatKeyLabel(displayKey) })] }, row.action));
                                })] }), _jsx("button", { type: "button", onClick: () => {
                                clearKeybindOverrides();
                                setConflict(null);
                            }, children: "Reset to defaults" })] })) : null, tab === 'video' ? (_jsxs("div", { className: "settings-panel", children: [_jsx("button", { type: "button", onClick: () => {
                                void document.documentElement.requestFullscreen?.();
                            }, children: "Enter Fullscreen" }), _jsx("p", { className: "settings-hint", children: "Hex size" }), Object.keys(HEX_SCALES).map((name) => (_jsx("button", { type: "button", className: hexScale === name ? 'is-active' : undefined, onClick: () => onHexScale(name), children: name }, name)))] })) : null, _jsx("button", { type: "button", className: "date-notice-ok", onClick: onClose, children: "Close" })] }) }));
}
function effectiveCatalogTimer(kind) {
    const catalog = getCachedCatalog();
    return kind === 'end'
        ? Math.max(0, Math.floor(appConfigNumber(catalog, 'combat_end_timer', 99)))
        : Math.max(0, Math.floor(appConfigNumber(catalog, 'combat_log_timer', 2)));
}
