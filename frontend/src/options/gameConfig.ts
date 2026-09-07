import { MAP_SIZES, type MapSizeName } from '../hex/hexScale'
import { DEFAULT_AI_ARCH_ID } from '../ai/types'

export const PLAYER_COUNT_MIN = 1
export const PLAYER_COUNT_MAX = 6

/** `ai` / `ai_spectator` are DEV controllers, not a shipped multiplayer mode. */
export type PlayerController = 'human' | 'ai' | 'ai_spectator'

export const PLAYER_CONTROLLER_OPTIONS: Array<{
  id: PlayerController
  label: string
}> = [
  { id: 'human', label: 'Human' },
  { id: 'ai_spectator', label: 'AI w/ Spectator (DEV)' },
  { id: 'ai', label: 'AI' },
]

export function controllerLabel(controller: PlayerController): string {
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

export function defaultPlayerSlots(): PlayerConfig[] {
  return Array.from({ length: PLAYER_COUNT_MAX }, (_, index) => ({
    slot: index + 1,
    controller: index === 0 ? 'human' : 'ai_spectator',
    // Temporary defaults: P1 Necromancer, P2 Death Knight.
    heroTypeId: index === 0 ? 1 : index === 1 ? 2 : null,
    archId: DEFAULT_AI_ARCH_ID,
  }))
}

export function defaultGameConfig(): GameConfig {
  return {
    mapSize: MAP_SIZES[0],
    playerCount: 2,
    players: defaultPlayerSlots().slice(0, 2),
    difficultyId: 2,
  }
}

export function assembleGameConfig(input: {
  mapSize: MapSizeName
  playerCount: number
  slots: PlayerConfig[]
  difficultyId: number
  seed?: number
}): GameConfig {
  const playerCount = Math.min(
    PLAYER_COUNT_MAX,
    Math.max(PLAYER_COUNT_MIN, Math.floor(input.playerCount)),
  )
  const mapSize = MAP_SIZES.includes(input.mapSize) ? input.mapSize : MAP_SIZES[0]
  const difficultyId =
    Number.isInteger(input.difficultyId) && input.difficultyId > 0
      ? input.difficultyId
      : 0
  const players = input.slots.slice(0, playerCount).map((slot, index) => ({
    slot: index + 1,
    controller: index === 0 ? 'human' : slot.controller,
    heroTypeId: slot.heroTypeId,
    archId: slot.archId > 0 ? slot.archId : DEFAULT_AI_ARCH_ID,
  }))
  return { mapSize, playerCount, players, difficultyId, seed: input.seed }
}
