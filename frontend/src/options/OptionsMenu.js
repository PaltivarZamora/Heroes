import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
import { clearCachedGrid } from '../hex/HexMap';
import { createSave, deleteSave, fetchSave, isGameSession, listSaves, } from '../session/saves';
import { syncGameDifficultyFromSession } from '../session/gameDifficulty';
import { getSession, setSession } from '../session/store';
import { normalizeHeroProgress } from '../session/accessors';
import {} from '../session/xp';
import { refreshCatalogFromDb } from '../town/catalog';
import { NewGameScreen } from './NewGameScreen';
import { getExploredHexes } from '../hex/world';
import { GameWindowModal } from '../layout/GameWindowModal';
function withCurrentFog(session) {
    const explored = getExploredHexes();
    const index = typeof session.activePlayerIndex === 'number' &&
        session.activePlayerIndex >= 0 &&
        session.activePlayerIndex < session.players.length
        ? session.activePlayerIndex
        : 0;
    return {
        ...session,
        activePlayerIndex: index,
        players: session.players.map((player, i) => i === index
            ? { ...player, explored, eliminated: player.eliminated === true }
            : {
                ...player,
                explored: Array.isArray(player.explored) ? player.explored : [],
                eliminated: player.eliminated === true,
            }),
    };
}
function normalizeRecruitsKnowledge(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {};
    }
    const out = {};
    for (const [playerId, entry] of Object.entries(raw)) {
        if (entry === true) {
            // Legacy seen_by_player boolean — treat as unknown unit until next visit.
            continue;
        }
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            continue;
        }
        const rec = entry;
        const unitId = Math.floor(Number(rec.unit_id));
        const stock = Math.floor(Number(rec.stock));
        if (!(unitId > 0) || !(stock >= 0)) {
            continue;
        }
        out[playerId] = { unit_id: unitId, stock: Math.max(0, stock) };
    }
    return out;
}
function withExploredDefaults(session) {
    return normalizeHeroProgress({
        ...session,
        features: Array.isArray(session.features)
            ? session.features.map((row) => row.kind === 'recruits'
                ? {
                    ...row,
                    unit_id: typeof row.unit_id === 'number' && row.unit_id > 0
                        ? row.unit_id
                        : 0,
                    stock: typeof row.stock === 'number' && row.stock > 0
                        ? Math.floor(row.stock)
                        : 0,
                    known_by_player: normalizeRecruitsKnowledge(row
                        .known_by_player ??
                        row.seen_by_player),
                }
                : row)
            : [],
        boats: Array.isArray(session.boats) ? session.boats : [],
        activePlayerIndex: typeof session.activePlayerIndex === 'number' &&
            session.activePlayerIndex >= 0 &&
            session.activePlayerIndex < session.players.length
            ? session.activePlayerIndex
            : 0,
        players: session.players.map((player) => ({
            ...player,
            is_ai: player.is_ai === true,
            ai_spectator: player.ai_spectator === true,
            arch_id: typeof player.arch_id === 'number' && player.arch_id > 0
                ? player.arch_id
                : 1,
            eliminated: player.eliminated === true,
            explored: Array.isArray(player.explored) ? player.explored : [],
        })),
        heroes: session.heroes.map((hero) => ({
            ...hero,
            learned_abilities: Array.isArray(hero.learned_abilities)
                ? hero.learned_abilities
                : [],
            used_abilities_this_battle: Array.isArray(hero.used_abilities_this_battle)
                ? hero.used_abilities_this_battle
                : [],
            used_abilities_today: Array.isArray(hero.used_abilities_today)
                ? hero.used_abilities_today
                : [],
            arch_id: typeof hero.arch_id === 'number' && hero.arch_id > 0 ? hero.arch_id : null,
            travel_facing: hero.travel_facing === 'left' || hero.travel_facing === 'right'
                ? hero.travel_facing
                : 'right',
        })),
        building_states: session.building_states.map((row) => ({
            ...row,
            offered_abilities: Array.isArray(row.offered_abilities)
                ? row.offered_abilities
                : [],
        })),
    });
}
function defaultSaveName() {
    const session = getSession();
    const name = session.game.name?.trim();
    if (name) {
        return name;
    }
    return session.game.seed > 0 ? `Random ${session.game.seed}` : 'Test Game';
}
function formatCreated(iso) {
    if (!iso) {
        return 'unknown date';
    }
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return iso;
    }
    return date.toLocaleString();
}
function errorMessage(error, fallback) {
    return error instanceof Error && error.message.trim()
        ? error.message
        : fallback;
}
export function OptionsMenu({ onLoaded, onDataStatus: _onDataStatus, onCopyDebug: _onCopyDebug, onStartGame, mapGenerating = false, onPrepareNewGame, onLevelUpNotice: _onLevelUpNotice, onHudNotice, onStartFixedFight: _onStartFixedFight, onSeeWorld: _onSeeWorld, hexScale: _hexScale, onHexScale: _onHexScale, hideToggle = false, flowPanel, onFlowPanelChange, }) {
    const [expanded, setExpanded] = useState(false);
    const [panel, setPanel] = useState(null);
    const [saveName, setSaveName] = useState('');
    const [saves, setSaves] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const [notice, setNotice] = useState(null);
    const saveNameRef = useRef(null);
    const menuRef = useRef(null);
    useEffect(() => {
        if (!notice) {
            return;
        }
        const timer = window.setTimeout(() => setNotice(null), 2500);
        return () => window.clearTimeout(timer);
    }, [notice]);
    useEffect(() => {
        onHudNotice?.(notice);
    }, [notice, onHudNotice]);
    useEffect(() => {
        if (!expanded) {
            return;
        }
        const onPointerDown = (event) => {
            const root = menuRef.current;
            if (!root || !(event.target instanceof Node)) {
                return;
            }
            if (!root.contains(event.target)) {
                setExpanded(false);
            }
        };
        window.addEventListener('pointerdown', onPointerDown);
        return () => window.removeEventListener('pointerdown', onPointerDown);
    }, [expanded]);
    /** Close after a real pick; leave flyout parents open so their submenu can be used. */
    const closeAfterMenuPick = (event) => {
        const btn = event.target.closest('button[role="menuitem"]');
        if (!(btn instanceof HTMLButtonElement) || btn.disabled) {
            return;
        }
        const isFlyoutParent = btn.getAttribute('aria-haspopup') === 'true' &&
            !btn.closest('.options-submenu');
        if (isFlyoutParent) {
            return;
        }
        setExpanded(false);
    };
    // Focus the save-name field when Save Game opens (autoFocus fails while busy).
    useEffect(() => {
        if (panel !== 'save') {
            return;
        }
        const timer = window.setTimeout(() => {
            const input = saveNameRef.current;
            if (!input || input.disabled) {
                return;
            }
            input.focus();
            input.select();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [panel, busy]);
    const closePanel = () => {
        if (busy) {
            return;
        }
        setPanel(null);
        setError(null);
        onFlowPanelChange?.(null);
    };
    const openPanel = (next) => {
        setExpanded(false);
        setError(null);
        setBusy(false);
        setPanel(next);
        if (next === 'new') {
            onPrepareNewGame?.();
        }
        if (next === 'save') {
            setSaveName(defaultSaveName());
            setSelectedId(null);
            setSaves([]);
            setBusy(true);
        }
        if (next === 'load') {
            setSelectedId(null);
            setSaves([]);
            setBusy(true);
        }
    };
    useEffect(() => {
        if (!flowPanel) {
            return;
        }
        openPanel(flowPanel);
        onFlowPanelChange?.(null);
    }, [flowPanel, onFlowPanelChange]);
    useEffect(() => {
        if (panel !== 'load' && panel !== 'save') {
            return;
        }
        let cancelled = false;
        setBusy(true);
        void listSaves()
            .then((rows) => {
            if (!cancelled) {
                setSaves(rows);
                setError(null);
            }
        })
            .catch((err) => {
            if (!cancelled) {
                setError(errorMessage(err, 'Could not load saved games'));
            }
        })
            .finally(() => {
            if (!cancelled) {
                setBusy(false);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [panel]);
    useEffect(() => {
        if (panel == null) {
            return;
        }
        const onKey = (event) => {
            if (event.key === 'Escape' && !busy) {
                closePanel();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [panel, busy]);
    const onSave = async () => {
        const name = saveName.trim();
        if (!name) {
            setError('A game name is required.');
            return;
        }
        setBusy(true);
        setError(null);
        const current = getSession();
        const snapshot = withCurrentFog({
            ...current,
            game: { ...current.game, name },
        });
        try {
            await createSave(name, snapshot.game.seed, snapshot);
            setSession(snapshot);
            setPanel(null);
        }
        catch (err) {
            setError(errorMessage(err, 'Could not save the game'));
        }
        finally {
            setBusy(false);
        }
    };
    const onLoad = async () => {
        if (selectedId == null) {
            setError('Select a saved game.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const detail = await fetchSave(selectedId);
            if (!isGameSession(detail.gameState)) {
                throw new Error('That save is corrupt and was not loaded.');
            }
            try {
                await refreshCatalogFromDb();
            }
            catch {
                // Load the save even if the catalog refresh fails.
            }
            const loaded = withExploredDefaults(detail.gameState);
            setSession(loaded);
            syncGameDifficultyFromSession(loaded);
            clearCachedGrid();
            setPanel(null);
            onLoaded();
        }
        catch (err) {
            setError(errorMessage(err, 'Could not load that save'));
        }
        finally {
            setBusy(false);
        }
    };
    const onDelete = async () => {
        if (selectedId == null) {
            setError('Select a saved game.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await deleteSave(selectedId);
            setSaves((rows) => rows.filter((row) => row.id !== selectedId));
            setSelectedId(null);
        }
        catch (err) {
            setError(errorMessage(err, 'Could not delete that save'));
        }
        finally {
            setBusy(false);
        }
    };
    const onQuitYes = () => {
        window.location.reload();
    };
    const onRestartYes = () => {
        window.location.reload();
    };
    void _onDataStatus;
    void _onCopyDebug;
    void _onLevelUpNotice;
    void _onStartFixedFight;
    void _onSeeWorld;
    return (_jsxs("div", { className: `options-menu${hideToggle ? ' options-menu-headless' : ''}`, ref: menuRef, children: [hideToggle ? null : (_jsx("button", { type: "button", className: "options-toggle", "aria-expanded": expanded, "aria-haspopup": "true", onClick: () => setExpanded(!expanded), children: "Options" })), !hideToggle && expanded ? (_jsxs("div", { className: "options-choices", role: "menu", onClick: closeAfterMenuPick, children: [_jsx("button", { type: "button", role: "menuitem", onClick: () => openPanel('new'), children: "New Game" }), _jsx("button", { type: "button", role: "menuitem", onClick: () => openPanel('load'), children: "Load Game" }), _jsx("button", { type: "button", role: "menuitem", onClick: () => openPanel('save'), children: "Save Game" }), _jsx("button", { type: "button", role: "menuitem", onClick: () => openPanel('quit'), children: "Quit" })] })) : null, panel === 'new' ? (_jsx("div", { className: "game-window-embed", children: _jsx(GameWindowModal, { "aria-labelledby": "new-game-title", onBackdropClick: closePanel, className: "new-game-modal", children: _jsx(NewGameScreen, { embedded: true, generating: mapGenerating, onClose: closePanel, onStartGame: (config) => {
                            onStartGame(config);
                            closePanel();
                        } }) }) })) : null, panel === 'save' ? (_jsx("div", { className: "game-window-embed", children: _jsx(GameWindowModal, { "aria-labelledby": "save-title", onBackdropClick: closePanel, children: _jsxs("div", { className: "options-dialog", children: [_jsx("h2", { id: "save-title", children: "Save Game" }), _jsxs("label", { className: "options-field", children: ["Game Name", _jsx("input", { ref: saveNameRef, value: saveName, onChange: (event) => setSaveName(event.target.value), onKeyDown: (event) => {
                                            if (event.key !== 'Enter') {
                                                return;
                                            }
                                            event.preventDefault();
                                            if (!busy) {
                                                void onSave();
                                            }
                                        }, autoFocus: true })] }), saves.some((row) => row.name === saveName.trim()) ? (_jsx("p", { className: "options-empty", children: "Saving will overwrite the existing game with this name." })) : null, saves.length > 0 ? (_jsx("ul", { className: "options-save-list", children: saves.map((row) => (_jsx("li", { children: _jsxs("label", { children: [_jsx("input", { type: "radio", name: "saved-game-save", checked: selectedId === row.id, onChange: () => {
                                                    setSelectedId(row.id);
                                                    setSaveName(row.name);
                                                }, disabled: busy }), _jsxs("span", { children: [_jsx("strong", { children: row.name }), _jsx("em", { children: formatCreated(row.updatedAt ?? row.createdAt) })] })] }) }, row.id))) })) : null, error ? (_jsx("p", { className: "options-error", role: "alert", children: error })) : null, _jsxs("div", { className: "options-actions", children: [_jsx("button", { type: "button", disabled: busy, onClick: () => void onSave(), children: busy ? 'Saving…' : 'OK' }), _jsx("button", { type: "button", disabled: busy || selectedId == null, onClick: () => void onDelete(), children: "Delete" }), _jsx("button", { type: "button", disabled: busy, onClick: closePanel, children: "Cancel" })] })] }) }) })) : null, panel === 'load' ? (_jsx("div", { className: "game-window-embed", children: _jsx(GameWindowModal, { "aria-labelledby": "load-title", onBackdropClick: closePanel, children: _jsxs("div", { className: "options-dialog", children: [_jsx("h2", { id: "load-title", children: "Load Game" }), saves.length === 0 && !busy && !error ? (_jsx("p", { className: "options-empty", children: "No saved games yet." })) : (_jsx("ul", { className: "options-save-list", children: saves.map((row) => (_jsx("li", { children: _jsxs("label", { children: [_jsx("input", { type: "radio", name: "saved-game", checked: selectedId === row.id, onChange: () => setSelectedId(row.id), disabled: busy }), _jsxs("span", { children: [_jsx("strong", { children: row.name }), _jsx("em", { children: formatCreated(row.updatedAt ?? row.createdAt) })] })] }) }, row.id))) })), error ? (_jsx("p", { className: "options-error", role: "alert", children: error })) : null, _jsxs("div", { className: "options-actions", children: [_jsx("button", { type: "button", disabled: busy, onClick: () => void onLoad(), children: busy ? 'Loading…' : 'OK' }), _jsx("button", { type: "button", disabled: busy || selectedId == null, onClick: () => void onDelete(), children: "Delete" }), _jsx("button", { type: "button", disabled: busy, onClick: closePanel, children: "Cancel" })] })] }) }) })) : null, panel === 'quit' ? (_jsx("div", { className: "game-window-embed", children: _jsx(GameWindowModal, { "aria-labelledby": "quit-title", onBackdropClick: closePanel, children: _jsxs("div", { className: "options-dialog", children: [_jsx("h2", { id: "quit-title", children: "Are you sure?" }), _jsxs("div", { className: "options-actions", children: [_jsx("button", { type: "button", onClick: onQuitYes, children: "Yes" }), _jsx("button", { type: "button", onClick: closePanel, children: "No" })] })] }) }) })) : null, panel === 'restart' ? (_jsx("div", { className: "game-window-embed", children: _jsx(GameWindowModal, { "aria-labelledby": "restart-title", onBackdropClick: closePanel, children: _jsxs("div", { className: "options-dialog", children: [_jsx("h2", { id: "restart-title", children: "Restart the game?" }), _jsxs("div", { className: "options-actions", children: [_jsx("button", { type: "button", onClick: onRestartYes, children: "Yes" }), _jsx("button", { type: "button", onClick: closePanel, children: "No" })] })] }) }) })) : null] }));
}
