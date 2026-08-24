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
  resources: Record<number, number>
  hero_ids: string[]
  town_ids: string[]
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
  towns: Town[]
  building_states: BuildingState[]
  heroes: Hero[]
  units: UnitStack[]
  nodes: Node[]
  mobs: Mob[]
}

export const HUMAN_PLAYER_ID = 'player-1'
export const GAME_ID = 'game-1'
export const HERO_ID = 'hero-1'
export const NECROPOLIS_TOWN_TYPE_ID = 1
export const BUILDING_SLOT_COUNT = 12
export const ARMY_STACK_SLOTS = 6
