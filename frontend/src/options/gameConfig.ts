import { MAP_SIZES, type MapSizeName } from '../hex/hexScale'

export const PLAYER_COUNT_MIN = 1
export const PLAYER_COUNT_MAX = 6

/** Only Human is offered until AI exists. */
export const PLAYER_CONTROLLER = 'human' as const
export type PlayerController = typeof PLAYER_CONTROLLER

/** Catalog `hero_type.id`, or null for Random (unresolved until a later brief). */
export type HeroTypePick = number | null

export type PlayerConfig = {
  slot: number
  controller: PlayerController
  heroTypeId: HeroTypePick
}

export type GameConfig = {
  mapSize: MapSizeName
  playerCount: number
  players: PlayerConfig[]
  /** Catalog `difficulty.id`. */
  difficultyId: number
}

export function defaultPlayerSlots(): PlayerConfig[] {
  return Array.from({ length: PLAYER_COUNT_MAX }, (_, index) => ({
    slot: index + 1,
    controller: PLAYER_CONTROLLER,
    // Temporary hotseat defaults: P1 Necromancer, P2 Death Knight.
    heroTypeId: index === 0 ? 1 : index === 1 ? 2 : null,
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
    controller: PLAYER_CONTROLLER,
    heroTypeId: slot.heroTypeId,
  }))
  return { mapSize, playerCount, players, difficultyId }
}
