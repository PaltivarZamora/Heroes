import { DEFAULT_HEX_SCALE, defaultMapSizeName, mapSizes, } from '../hex/hexScale';
import { DEFAULT_AI_ARCH_ID } from '../ai/types';
import { defaultSizeName, mapCfgNumber, newHeroTypeId, playersMax, playersMin, } from '../town/catalog';
/** Absolute slot ceiling when catalog is empty (UI list length). */
export const PLAYER_COUNT_MIN = 1;
export const PLAYER_COUNT_MAX = 8;
export const PLAYER_CONTROLLER_OPTIONS = [
    { id: 'human', label: 'Human' },
    { id: 'ai', label: 'AI' },
];
export function controllerLabel(controller) {
    if (controller === 'ai_spectator') {
        return 'AI';
    }
    return (PLAYER_CONTROLLER_OPTIONS.find((row) => row.id === controller)?.label ??
        controller);
}
export const MOVE_MODE_OPTIONS = [
    { id: 'hero_speed', label: 'Hero Speed' },
    { id: 'flat_100', label: '100 Steps' },
];
export const HEX_SIZE_OPTIONS = ['Small', 'Medium', 'Large'];
export function playerCountBounds(catalog, mapSize) {
    const min = playersMin(catalog, mapSize);
    const max = playersMax(catalog, mapSize);
    return { min, max };
}
function clampPlayerCount(n, catalog, mapSize) {
    const size = mapSize?.trim() || defaultSizeName(catalog);
    const { min, max } = playerCountBounds(catalog, size);
    return Math.min(max, Math.max(min, Math.floor(n)));
}
/** `map_config.new_size` name (e.g. normal / large / giant). */
function mapSizeFromConfig(catalog) {
    const name = defaultMapSizeName(catalog);
    const names = mapSizes(catalog);
    return names.includes(name) ? name : names[0] ?? 'normal';
}
/** `map_config.new_hex_size`: 1 Small, 2 Medium, 3 Large. */
export function hexSizeFromConfig(catalog) {
    const index = Math.trunc(mapCfgNumber(catalog, 'new_hex_size', null, 2));
    if (index >= 1 && index <= HEX_SIZE_OPTIONS.length) {
        return HEX_SIZE_OPTIONS[index - 1];
    }
    return DEFAULT_HEX_SCALE;
}
/** `map_config.new_move_mode`: 1 Hero Speed, 2 100 Steps. */
export function moveModeFromConfig(catalog) {
    const index = Math.trunc(mapCfgNumber(catalog, 'new_move_mode', null, 1));
    return index === 2 ? 'flat_100' : 'hero_speed';
}
export function parseMoveMode(raw) {
    if (raw === 'flat_100' || raw === 2 || raw === '2') {
        return 'flat_100';
    }
    return 'hero_speed';
}
export function parseHexSize(raw) {
    if (typeof raw === 'string' && HEX_SIZE_OPTIONS.includes(raw)) {
        return raw;
    }
    return DEFAULT_HEX_SCALE;
}
/**
 * New Game hero defaults from `map_config.new_heroes` ({slot: hero_type_id}).
 * Slots without an entry → Random (null).
 */
function heroTypeDefault(catalog, slotIndex) {
    return newHeroTypeId(catalog, slotIndex + 1);
}
export function defaultPlayerSlots(catalog, playerCount) {
    const size = defaultMapSizeName(catalog);
    const count = playerCount != null
        ? clampPlayerCount(playerCount, catalog, size)
        : playersMax(catalog, size);
    const slots = Math.max(PLAYER_COUNT_MAX, count);
    return Array.from({ length: slots }, (_, index) => ({
        slot: index + 1,
        controller: index === 0 ? 'human' : 'ai',
        heroTypeId: heroTypeDefault(catalog, index),
        // Human keep default; each AI independently rolls one of the catalog arches.
        archId: index === 0 ? DEFAULT_AI_ARCH_ID : randomAiArchId(catalog),
    }));
}
/** Pick a random `ai_arch.id` (Build/Explore/Aggressive/Defend). */
export function randomAiArchId(catalog) {
    const rows = catalog?.ai_arch ?? [];
    if (rows.length === 0) {
        return DEFAULT_AI_ARCH_ID;
    }
    const pick = rows[Math.floor(Math.random() * rows.length)];
    return pick?.id && pick.id > 0 ? pick.id : DEFAULT_AI_ARCH_ID;
}
/**
 * New Game / quick-start defaults from map_config:
 * new_size, new_players, new_difficulty, new_hex_size, new_move_mode, new_heroes.
 */
export function defaultGameConfig(catalog) {
    const mapSize = mapSizeFromConfig(catalog);
    const playerCount = clampPlayerCount(mapCfgNumber(catalog, 'new_players', mapSize, 1), catalog, mapSize);
    const difficultyRaw = Math.trunc(mapCfgNumber(catalog, 'new_difficulty', mapSize, 2));
    const difficultyId = difficultyRaw > 0 ? difficultyRaw : 2;
    return {
        mapSize,
        playerCount,
        players: defaultPlayerSlots(catalog, playerCount).slice(0, playerCount),
        difficultyId,
        hexSize: hexSizeFromConfig(catalog),
        moveMode: moveModeFromConfig(catalog),
    };
}
export function assembleGameConfig(input, catalog) {
    const names = mapSizes(catalog);
    const want = input.mapSize.trim().toLowerCase();
    const mapSize = names.find((name) => name === want) ?? names[0] ?? defaultMapSizeName(catalog);
    const playerCount = clampPlayerCount(input.playerCount, catalog, mapSize);
    const difficultyId = Number.isInteger(input.difficultyId) && input.difficultyId > 0
        ? input.difficultyId
        : 0;
    const hexSize = HEX_SIZE_OPTIONS.includes(input.hexSize)
        ? input.hexSize
        : DEFAULT_HEX_SCALE;
    const moveMode = input.moveMode === 'flat_100' ? 'flat_100' : 'hero_speed';
    const players = input.slots.slice(0, playerCount).map((slot, index) => ({
        slot: index + 1,
        controller: index === 0
            ? 'human'
            : slot.controller === 'ai_spectator'
                ? 'ai'
                : slot.controller,
        heroTypeId: slot.heroTypeId,
        archId: slot.archId > 0 ? slot.archId : DEFAULT_AI_ARCH_ID,
    }));
    return {
        mapSize,
        playerCount,
        players,
        difficultyId,
        hexSize,
        moveMode,
        seed: input.seed,
    };
}
