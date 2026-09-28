import {
  DEFAULT_HEX_SCALE,
  defaultMapSizeName,
  mapSizes,
  type HexScaleName,
  type MapSizeName,
} from '../hex/hexScale'
import { DEFAULT_AI_ARCH_ID } from '../ai/types'
import {
  defaultSizeName,
  mapCfgNumber,
  newHeroTypeId,
  playersMax,
  playersMin,
  type ReferenceCatalog,
} from '../town/catalog'

/** Absolute slot ceiling when catalog is empty (UI list length). */
export const PLAYER_COUNT_MIN = 1
export const PLAYER_COUNT_MAX = 8

/** Controllers available in New Game. `ai_spectator` may still appear on old saves. */
export type PlayerController = 'human' | 'ai' | 'ai_spectator'

export const PLAYER_CONTROLLER_OPTIONS: Array<{
  id: Exclude<PlayerController, 'ai_spectator'>
  label: string
}> = [
  { id: 'human', label: 'Human' },
  { id: 'ai', label: 'AI' },
]

export function controllerLabel(controller: PlayerController): string {
  if (controller === 'ai_spectator') {
    return 'AI'
  }
  return (
    PLAYER_CONTROLLER_OPTIONS.find((row) => row.id === controller)?.label ??
    controller
  )
}

/** Catalog `hero_type.id`, or null for Random (unresolved until a later brief). */
export type HeroTypePick = number | null

export type PlayerConfig = {
  slot: number
  controller: PlayerController
  heroTypeId: HeroTypePick
  archId: number
}

/**
 * Daily movement budget mode (New Game Speed / Options).
 * - hero_speed: speed × hero_steps_per_speed
 * - flat_100: every hero gets 100 steps/day
 */
export type MoveMode = 'hero_speed' | 'flat_100'

export const MOVE_MODE_OPTIONS: Array<{ id: MoveMode; label: string }> = [
  { id: 'hero_speed', label: 'Hero Speed' },
  { id: 'flat_100', label: '100 Steps' },
]

export const HEX_SIZE_OPTIONS: HexScaleName[] = ['Small', 'Medium', 'Large']

export type GameConfig = {
  mapSize: MapSizeName
  playerCount: number
  players: PlayerConfig[]
  /** Catalog `difficulty.id`. */
  difficultyId: number
  /** World-map hex display size (visual only). */
  hexSize: HexScaleName
  /** Daily movement mode. */
  moveMode: MoveMode
  /** When set, HexMap fetches this seed instead of a random map. */
  seed?: number
}

export function playerCountBounds(
  catalog: ReferenceCatalog | null | undefined,
  mapSize: MapSizeName,
): { min: number; max: number } {
  const min = playersMin(catalog, mapSize)
  const max = playersMax(catalog, mapSize)
  return { min, max }
}

function clampPlayerCount(
  n: number,
  catalog?: ReferenceCatalog | null,
  mapSize?: MapSizeName | null,
): number {
  const size = mapSize?.trim() || defaultSizeName(catalog)
  const { min, max } = playerCountBounds(catalog, size)
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/** `map_config.new_size` name (e.g. normal / large / giant). */
function mapSizeFromConfig(
  catalog: ReferenceCatalog | null | undefined,
): MapSizeName {
  const name = defaultMapSizeName(catalog)
  const names = mapSizes(catalog)
  return names.includes(name) ? name : names[0] ?? 'normal'
}

/** `map_config.new_hex_size`: 1 Small, 2 Medium, 3 Large. */
export function hexSizeFromConfig(
  catalog: ReferenceCatalog | null | undefined,
): HexScaleName {
  const index = Math.trunc(mapCfgNumber(catalog, 'new_hex_size', null, 2))
  if (index >= 1 && index <= HEX_SIZE_OPTIONS.length) {
    return HEX_SIZE_OPTIONS[index - 1]!
  }
  return DEFAULT_HEX_SCALE
}

/** `map_config.new_move_mode`: 1 Hero Speed, 2 100 Steps. */
export function moveModeFromConfig(
  catalog: ReferenceCatalog | null | undefined,
): MoveMode {
  const index = Math.trunc(mapCfgNumber(catalog, 'new_move_mode', null, 1))
  return index === 2 ? 'flat_100' : 'hero_speed'
}

export function parseMoveMode(raw: unknown): MoveMode {
  if (raw === 'flat_100' || raw === 2 || raw === '2') {
    return 'flat_100'
  }
  return 'hero_speed'
}

export function parseHexSize(raw: unknown): HexScaleName {
  if (typeof raw === 'string' && (HEX_SIZE_OPTIONS as string[]).includes(raw)) {
    return raw as HexScaleName
  }
  return DEFAULT_HEX_SCALE
}

/**
 * New Game hero defaults from `map_config.new_heroes` ({slot: hero_type_id}).
 * Slots without an entry → Random (null).
 */
function heroTypeDefault(
  catalog: ReferenceCatalog | null | undefined,
  slotIndex: number,
): number | null {
  return newHeroTypeId(catalog, slotIndex + 1)
}

export function defaultPlayerSlots(
  catalog?: ReferenceCatalog | null,
  playerCount?: number,
): PlayerConfig[] {
  const size = defaultMapSizeName(catalog)
  const count =
    playerCount != null
      ? clampPlayerCount(playerCount, catalog, size)
      : playersMax(catalog, size)
  const slots = Math.max(PLAYER_COUNT_MAX, count)
  return Array.from({ length: slots }, (_, index) => ({
    slot: index + 1,
    controller: index === 0 ? 'human' : 'ai',
    heroTypeId: heroTypeDefault(catalog, index),
    // Human keep default; each AI independently rolls one of the catalog arches.
    archId: index === 0 ? DEFAULT_AI_ARCH_ID : randomAiArchId(catalog),
  }))
}

/** Pick a random `ai_arch.id` (Build/Explore/Aggressive/Defend). */
export function randomAiArchId(
  catalog?: ReferenceCatalog | null,
): number {
  const rows = catalog?.ai_arch ?? []
  if (rows.length === 0) {
    return DEFAULT_AI_ARCH_ID
  }
  const pick = rows[Math.floor(Math.random() * rows.length)]
  return pick?.id && pick.id > 0 ? pick.id : DEFAULT_AI_ARCH_ID
}

/**
 * New Game / quick-start defaults from map_config:
 * new_size, new_players, new_difficulty, new_hex_size, new_move_mode, new_heroes.
 */
export function defaultGameConfig(
  catalog?: ReferenceCatalog | null,
): GameConfig {
  const mapSize = mapSizeFromConfig(catalog)
  const playerCount = clampPlayerCount(
    mapCfgNumber(catalog, 'new_players', mapSize, 1),
    catalog,
    mapSize,
  )
  const difficultyRaw = Math.trunc(
    mapCfgNumber(catalog, 'new_difficulty', mapSize, 2),
  )
  const difficultyId = difficultyRaw > 0 ? difficultyRaw : 2
  return {
    mapSize,
    playerCount,
    players: defaultPlayerSlots(catalog, playerCount).slice(0, playerCount),
    difficultyId,
    hexSize: hexSizeFromConfig(catalog),
    moveMode: moveModeFromConfig(catalog),
  }
}

export function assembleGameConfig(
  input: {
    mapSize: MapSizeName
    playerCount: number
    slots: PlayerConfig[]
    difficultyId: number
    hexSize: HexScaleName
    moveMode: MoveMode
    seed?: number
  },
  catalog?: ReferenceCatalog | null,
): GameConfig {
  const names = mapSizes(catalog)
  const want = input.mapSize.trim().toLowerCase()
  const mapSize =
    names.find((name) => name === want) ?? names[0] ?? defaultMapSizeName(catalog)
  const playerCount = clampPlayerCount(input.playerCount, catalog, mapSize)
  const difficultyId =
    Number.isInteger(input.difficultyId) && input.difficultyId > 0
      ? input.difficultyId
      : 0
  const hexSize = HEX_SIZE_OPTIONS.includes(input.hexSize)
    ? input.hexSize
    : DEFAULT_HEX_SCALE
  const moveMode = input.moveMode === 'flat_100' ? 'flat_100' : 'hero_speed'
  const players = input.slots.slice(0, playerCount).map((slot, index) => ({
    slot: index + 1,
    controller:
      index === 0
        ? 'human'
        : slot.controller === 'ai_spectator'
          ? 'ai'
          : slot.controller,
    heroTypeId: slot.heroTypeId,
    archId: slot.archId > 0 ? slot.archId : DEFAULT_AI_ARCH_ID,
  }))
  return {
    mapSize,
    playerCount,
    players,
    difficultyId,
    hexSize,
    moveMode,
    seed: input.seed,
  }
}
