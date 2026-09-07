import type { Calendar } from '../hex/calendar'

export type AxialPos = {
  q: number
  r: number
}

export type GameSettings = {
  player_count: number
  map_size: string
  victory_condition: string
  difficulty: string
  game_type: string
  /** Catalog hero_type.id per player slot; null = Random. */
  hero_type_ids?: Array<number | null>
}

export type Game = {
  id: string
  name: string
  seed: number
  calendar: Calendar
  settings: GameSettings
}

export type Player = {
  id: string
  is_ai: boolean
  /**
   * DEV ONLY: camera-follow + manual End Turn while this AI acts.
   * Not a player-facing game mode.
   */
  ai_spectator: boolean
  /** Player-level archetype (`ai_arch.id`). */
  arch_id: number
  /** Skip in turn order after losing last town and last hero. */
  eliminated: boolean
  resources: Record<number, number>
  hero_ids: string[]
  town_ids: string[]
  /** Per-player fog of war — hexes this player has seen. */
  explored: AxialPos[]
}

export type TownGarrison = {
  slots_1_to_6: Array<string | null>
}

export type Town = {
  id: string
  name: string
  town_type_id: number
  position: AxialPos
  player_id: string | null
  last_build_day: number | null
  garrison: TownGarrison
}

export type BuildingState = {
  id: string
  town_id: string
  building_id: number | null
  slot_num: number
  level: number
  recruit_qty: number
  /** Rolled Library offers, keyed by building_id + discipline_id + level. */
  offered_abilities: OfferedAbilityRoll[]
}

export type OfferedAbilityRoll = {
  building_id: number
  discipline_id: number
  level: number
  ability_ids: number[]
}

export type HeroArmy = {
  slot_0: string
  slots_1_to_6: Array<string | null>
}

export type Hero = {
  id: string
  player_id: string
  name: string
  class_id: number | null
  image_path: string | null
  position: AxialPos
  movement_remaining: number
  army: HeroArmy
  learned_abilities: number[]
  /** Live level. Starts at 1; persists for this hero identity. */
  current_level: number
  /** Live XP. Starts at 0; persists for this hero identity. */
  current_xp: number
  /** Live Mana pool. Always present; unused classes sit at their intel-based max. */
  current_mana: number
  /** Live Energy pool. Always present; unused classes sit at their strength-based max. */
  current_energy: number
  /** Ability ids cast in the current battle. Reset at battle start. */
  used_abilities_this_battle: number[]
  /** Ability ids cast today (game day). Reset at day rollover. */
  used_abilities_today: number[]
  /** Nullable hero archetype from `hero_pool.arch_id`. Null = pure player blend. */
  arch_id: number | null
}

/** Per-name XP/level that survives death → tavern → re-hire. */
export type HeroProgress = {
  current_level: number
  current_xp: number
}

export type UnitStack = {
  id: string
  unit_id: number
  qty: number
  town_id: string | null
  hero_id: string | null
  mob_id: string | null
}

export type NodeKind = 'mine' | 'pickup'

export type Node = {
  id: string
  position: AxialPos
  resource_id: number
  kind: NodeKind
  player_id: string | null
  collected: boolean
}

export type Mob = {
  id: string
  position: AxialPos
  slots_1_to_6: Array<string | null>
}

export type GameSession = {
  game: Game
  players: Player[]
  /** Index into players[]; 0 = first slot. */
  activePlayerIndex: number
  towns: Town[]
  building_states: BuildingState[]
  heroes: Hero[]
  /** Name-keyed level/XP; survives a hero leaving the map. */
  hero_progress: Record<string, HeroProgress>
  units: UnitStack[]
  nodes: Node[]
  mobs: Mob[]
}

export const HUMAN_PLAYER_ID = 'player-1'
export const GAME_ID = 'game-1'
export const HERO_ID = 'hero-1'
export const NECROPOLIS_TOWN_TYPE_ID = 1
export const BUILDING_SLOT_COUNT = 16
export const ARMY_STACK_SLOTS = 6

export function playerIdForSlot(slot: number): string {
  return `player-${slot}`
}

export function slotFromPlayerId(playerId: string): number | null {
  if (!playerId.startsWith('player-')) {
    return null
  }
  const slot = Number(playerId.slice('player-'.length))
  if (!Number.isInteger(slot) || slot < 1) {
    return null
  }
  return slot
}
