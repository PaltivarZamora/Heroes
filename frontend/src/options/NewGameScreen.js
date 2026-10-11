import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState, useSyncExternalStore } from 'react';
import { HEX_SCALES, mapSizeChoiceLabel, mapSizes, } from '../hex/hexScale';
import { difficultyDisplay, fetchCatalog, getCachedCatalog, subscribeCatalog, } from '../town/catalog';
import { assembleGameConfig, defaultGameConfig, defaultPlayerSlots, HEX_SIZE_OPTIONS, MOVE_MODE_OPTIONS, PLAYER_CONTROLLER_OPTIONS, playerCountBounds, } from './gameConfig';
function heroLabel(heroTypeId, catalog) {
    if (heroTypeId == null) {
        return 'Random';
    }
    const type = catalog?.hero_type.find((row) => row.id === heroTypeId);
    if (!type) {
        return `hero_type #${heroTypeId}`;
    }
    const town = catalog?.town.find((row) => row.id === type.town_id);
    return town ? `${type.name} (${town.name})` : type.name;
}
function parseHeroValue(value) {
    if (value === '') {
        return null;
    }
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
}
export function NewGameScreen({ onClose, onStartGame, generating = false, embedded = false, }) {
    const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog);
    const bootDefaults = defaultGameConfig(catalog);
    const [mapSize, setMapSize] = useState(bootDefaults.mapSize);
    const [playerCount, setPlayerCount] = useState(bootDefaults.playerCount);
    const [difficultyId, setDifficultyId] = useState(bootDefaults.difficultyId);
    const [hexSize, setHexSize] = useState(bootDefaults.hexSize);
    const [moveMode, setMoveMode] = useState(bootDefaults.moveMode);
    const [slots, setSlots] = useState(() => defaultPlayerSlots(catalog));
    // false until catalog is applied once this mount — never skip when catalog was
    // already cached (F5) or we would keep stale pre-map_config form state.
    const [defaultsApplied, setDefaultsApplied] = useState(false);
    const [catalogError, setCatalogError] = useState(null);
    const difficulties = catalog?.difficulty ?? [];
    const selectedDifficulty = difficulties.find((row) => row.id === difficultyId) ?? null;
    const sizeOptions = mapSizes(catalog);
    const { min: playersMinBound, max: playersMaxBound } = playerCountBounds(catalog, mapSize);
    useEffect(() => {
        if (catalog) {
            return;
        }
        let cancelled = false;
        void fetchCatalog().catch((err) => {
            if (!cancelled) {
                setCatalogError(err instanceof Error ? err.message : 'Could not load reference data');
            }
        });
        return () => {
            cancelled = true;
        };
    }, [catalog]);
    // Pre-fill once from map_config when catalog is ready; do not overwrite edits after.
    useEffect(() => {
        if (!catalog || defaultsApplied) {
            return;
        }
        const defaults = defaultGameConfig(catalog);
        setMapSize(defaults.mapSize);
        setPlayerCount(defaults.playerCount);
        setDifficultyId(defaults.difficultyId);
        setHexSize(defaults.hexSize);
        setMoveMode(defaults.moveMode);
        setSlots(defaultPlayerSlots(catalog, defaults.playerCount));
        setDefaultsApplied(true);
    }, [catalog, defaultsApplied]);
    useEffect(() => {
        if (!defaultsApplied || difficulties.length === 0) {
            return;
        }
        if (difficulties.some((row) => row.id === difficultyId)) {
            return;
        }
        const normal = difficulties.find((row) => row.name.trim().toLowerCase() === 'normal');
        setDifficultyId(normal?.id ?? difficulties[0]?.id ?? 0);
    }, [difficulties, difficultyId, defaultsApplied]);
    // Clamp players when map size (and thus players_min/max) changes.
    useEffect(() => {
        if (!defaultsApplied) {
            return;
        }
        setPlayerCount((current) => Math.min(playersMaxBound, Math.max(playersMinBound, current)));
    }, [defaultsApplied, playersMinBound, playersMaxBound]);
    const setSlotHero = (index, heroTypeId) => {
        setSlots((current) => current.map((slot, i) => (i === index ? { ...slot, heroTypeId } : slot)));
    };
    const setSlotController = (index, controller) => {
        if (index === 0) {
            return;
        }
        setSlots((current) => current.map((slot, i) => (i === index ? { ...slot, controller } : slot)));
    };
    const onStart = () => {
        if (generating) {
            return;
        }
        const config = assembleGameConfig({
            mapSize,
            playerCount,
            slots,
            difficultyId,
            hexSize,
            moveMode,
        }, catalog);
        onStartGame(config);
    };
    // Intentionally sorted by hero_type.id (alphabetical renumber order).
    // Library tabs use hero_type.sort_order instead — do not unify these.
    const heroTypes = [...(catalog?.hero_type ?? [])].sort((a, b) => a.id - b.id);
    const body = (_jsxs("div", { className: `options-dialog new-game-dialog${embedded ? ' new-game-dialog-embedded' : ''}`, children: [_jsx("h2", { id: "new-game-title", children: "New Game" }), _jsxs("div", { className: "new-game-fields", children: [_jsxs("label", { className: "options-field options-field-row", children: [_jsx("span", { className: "options-field-label", children: "Map Size" }), _jsx("select", { value: mapSize, onChange: (event) => setMapSize(event.target.value), children: sizeOptions.map((name) => (_jsx("option", { value: name, children: mapSizeChoiceLabel(name, catalog) }, name))) })] }), _jsxs("label", { className: "options-field options-field-row", children: [_jsx("span", { className: "options-field-label", children: "Difficulty" }), _jsx("select", { value: difficultyId || '', onChange: (event) => setDifficultyId(Number(event.target.value)), disabled: difficulties.length === 0, children: difficulties.map((row) => (_jsx("option", { value: row.id, children: row.name }, row.id))) })] }), _jsxs("label", { className: "options-field options-field-row", children: [_jsx("span", { className: "options-field-label", children: "Players" }), _jsx("select", { value: playerCount, onChange: (event) => setPlayerCount(Number(event.target.value)), children: Array.from({ length: playersMaxBound - playersMinBound + 1 }, (_, i) => playersMinBound + i).map((n) => (_jsx("option", { value: n, children: n }, n))) })] }), _jsxs("label", { className: "options-field options-field-row", children: [_jsx("span", { className: "options-field-label", children: "Hex Size" }), _jsx("select", { value: hexSize, onChange: (event) => setHexSize(event.target.value), children: HEX_SIZE_OPTIONS.map((name) => (_jsxs("option", { value: name, children: [name, " (", HEX_SCALES[name], ")"] }, name))) })] }), _jsxs("label", { className: "options-field options-field-row", children: [_jsx("span", { className: "options-field-label", children: "Speed" }), _jsx("select", { value: moveMode, onChange: (event) => setMoveMode(event.target.value), children: MOVE_MODE_OPTIONS.map((option) => (_jsx("option", { value: option.id, children: option.label }, option.id))) })] })] }), selectedDifficulty && difficultyDisplay(selectedDifficulty) ? (_jsx("p", { className: "new-game-difficulty-note", children: difficultyDisplay(selectedDifficulty) })) : null, _jsxs("div", { className: "new-game-players", children: [_jsx("span", { className: "new-game-col-head", children: "Player" }), _jsx("span", { className: "new-game-col-head", children: "Controller" }), _jsx("span", { className: "new-game-col-head", children: "Hero" }), slots.slice(0, playerCount).map((slot, index) => (_jsxs("div", { className: "new-game-player-row", children: [_jsxs("span", { className: "new-game-player-label", children: ["Player ", slot.slot] }), index === 0 ? (_jsx("input", { value: "Human", readOnly: true, tabIndex: -1 })) : (_jsx("select", { value: slot.controller === 'ai_spectator' ? 'ai' : slot.controller, "aria-label": `Player ${slot.slot} controller`, onChange: (event) => setSlotController(index, event.target.value), children: PLAYER_CONTROLLER_OPTIONS.map((option) => (_jsx("option", { value: option.id, children: option.label }, option.id))) })), _jsxs("select", { value: slot.heroTypeId ?? '', "aria-label": `Player ${slot.slot} hero`, onChange: (event) => setSlotHero(index, parseHeroValue(event.target.value)), children: [_jsx("option", { value: "", children: "Random" }), heroTypes.map((row) => (_jsx("option", { value: row.id, children: heroLabel(row.id, catalog) }, row.id)))] })] }, slot.slot)))] }), catalogError ? (_jsx("p", { className: "options-error", role: "alert", children: catalogError })) : null, !catalog && !catalogError ? (_jsx("p", { className: "options-empty", children: "Loading hero types\u2026" })) : null, _jsxs("div", { className: "options-actions", children: [_jsx("button", { type: "button", onClick: onStart, disabled: generating, children: generating ? 'Generating map…' : 'Start Game' }), _jsx("button", { type: "button", onClick: onClose, children: "Cancel" })] })] }));
    if (embedded) {
        return body;
    }
    return (_jsx("div", { className: "options-modal", role: "dialog", "aria-labelledby": "new-game-title", children: body }));
}
