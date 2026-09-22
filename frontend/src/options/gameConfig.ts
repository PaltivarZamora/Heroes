import { MAP_SIZES, type MapSizeName } from '../hex/hexScale'
import { DEFAULT_AI_ARCH_ID } from '../ai/types'
import {
  appConfigNumber,
  type ReferenceCatalog,
} from '../town/catalog'

export const PLAYER_COUNT_MIN = 1
export const PLAYER_COUNT_MAX = 6

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

export type GameConfig = {
  mapSize: MapSizeName
  playerCount: number
  players: PlayerConfig[]
  /** Catalog `difficulty.id`. */
  difficultyId: number
  /** When set, HexMap fetches this seed instead of a random map. */
  seed?: number
}

/** app_config `new_map_size`: 1-based index into MAP_SIZES (1 = Small). */
function mapSizeFromConfig(
  catalog: ReferenceCatalog | null | undefined,
): MapSizeName {
  const index = Math.trunc(appConfigNumber(catalog, 'new_map_size', 1))
  if (index >= 1 && index <= MAP_SIZES.length) {
    return MAP_SIZES[index - 1]
  }
  return MAP_SIZES[0]
}

function clampPlayerCount(n: number): number {
  return Math.min(
    PLAYER_COUNT_MAX,
    Math.max(PLAYER_COUNT_MIN, Math.floor(n)),
  )
}

/**
 * Placeholder New Game starters (Balance-phase TBD).
 * Spread across towns — Knight, Barbarian, Necromancer, Wizard.
 * Keep in sync with app_config.new_hero_1..4.
 */
const FALLBACK_HERO_TYPE_IDS: Array<number | null> = [1, 7, 12, 18]

function heroTypeDefault(
  catalog: ReferenceCatalog | null | undefined,
  slotIndex: number,
): number | null {
  if (slotIndex < 4) {
    const key = `new_hero_${slotIndex + 1}`
    const fallback = FALLBACK_HERO_TYPE_IDS[slotIndex] ?? null
    const id = Math.trunc(appConfigNumber(catalog, key, fallback ?? 0))
    return id > 0 ? id : null
  }
  return null
}

export function defaultPlayerSlots(
  catalog?: ReferenceCatalog | null,
): PlayerConfig[] {
  return Array.from({ length: PLAYER_COUNT_MAX }, (_, index) => ({
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
 * New Game / quick-start defaults from app_config:
 * new_map_size, new_players, new_difficulty, new_hero_1..4.
 */
export function defaultGameConfig(
  catalog?: ReferenceCatalog | null,
): GameConfig {
  const playerCount = clampPlayerCount(
    appConfigNumber(catalog, 'new_players', 1),
  )
  const difficultyRaw = Math.trunc(
    appConfigNumber(catalog, 'new_difficulty', 2),
  )
  const difficultyId = difficultyRaw > 0 ? difficultyRaw : 2
  return {
    mapSize: mapSizeFromConfig(catalog),
    playerCount,
    players: defaultPlayerSlots(catalog).slice(0, playerCount),
    difficultyId,
  }
}

export function assembleGameConfig(input: {
  mapSize: MapSizeName
  playerCount: number
  slots: PlayerConfig[]
  difficultyId: number
  seed?: number
}): GameConfig {
  const playerCount = clampPlayerCount(input.playerCount)
  const mapSize = MAP_SIZES.includes(input.mapSize) ? input.mapSize : MAP_SIZES[0]
  const difficultyId =
    Number.isInteger(input.difficultyId) && input.difficultyId > 0
      ? input.difficultyId
      : 0
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
  return { mapSize, playerCount, players, difficultyId, seed: input.seed }
}
