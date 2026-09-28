import type { Calendar } from '../hex/calendar'

export type AxialPos = {
  q: number
  r: number
}

export type GameSettings = {
  player_count: number
  map_size: string
  /** Hex width stored so loads regenerate the same grid (incl. legacy sizes). */
  map_width?: number
  /** Hex height stored so loads regenerate the same grid (incl. legacy sizes). */
  map_height?: number
  victory_condition: string
  difficulty: string
  game_type: string
  /** Catalog hero_type.id per player slot; null = Random. */
  hero_type_ids?: Array<number | null>
  /** World hex display size: Small | Medium | Large (visual only). */
  hex_size?: string
  /** Daily movement: hero_speed | flat_100. */
  move_mode?: string
}

export type Game = {
  id: string
  name: string
  seed: number
  calendar: Calendar
  settings: GameSettings
  /**
   * Heroes in owned towns at last day boundary (kept for saves / tooling).
   * Full Energy/Mana restore at day end applies to whoever is in an owned town
   * when the calendar advances — not gated on this list.
   */
  town_pool_restore_ids?: string[]
  /**
   * After a day-advance flight landing on an enemy town — App pops these into
   * the normal siege flow.
   */
  pending_flight_sieges?: Array<{ heroId: string; townId: string }>
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
  /** Drawbridge on the left, keep on the right. */
  flipped?: boolean
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
  /**
   * Legacy permanent weekly growth add-on (no longer written by Town Uniques).
   * Still honored if present on a slot.
   */
  growth_bonus?: number
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

/** Active Hanger flight — hero is airborne toward a town. */
export type HeroFlight = {
  destination_town_id: string
  /**
   * Waiting to land: another of our heroes occupies the town slot.
   * Hero orbits the town footprint; no further progress toward dest.
   */
  circling?: boolean
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
  /**
   * Abilities learned with the calendar day they were acquired (BR S9-10
   * Know Ability: only counts if learned after accepting).
   */
  ability_learn_log?: Array<{ ability_id: number; learned_on_day: number }>
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
  /**
   * Hanger flight in progress. Null/undefined = on the ground.
   * While set, hero is untargetable and auto-advances each day.
   */
  flight: HeroFlight | null
  /**
   * World-map travel sprite facing (BR S9-7). Persists across save/load.
   * Updated from each movement / sail / flight step.
   */
  travel_facing?: 'left' | 'right'
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
  /**
   * Loose pile amount rolled at map generation (`loose_min`–`loose_max`).
   * Unused for mines.
   */
  qty: number
  /**
   * Mine fractional daily accrual (`weekly_node / 7`). Whole units pay out
   * when this reaches ≥ 1; remainder carries. Reset on capture/steal.
   */
  accrued_fraction: number
}

/** Neutral world feature (BR S9-2 fountain / S9-3 chest / S9-4 sign). */
export type MapFeature =
  | {
      id: string
      kind: 'fountain'
      position: AxialPos
    }
  | {
      id: string
      kind: 'chest'
      position: AxialPos
      /** `stats.level` / feature row. */
      level: number
      /** Display name from `feature.name`. */
      name: string
      /** Closed vs open art; survives Leave. */
      open: boolean
      /** Rolled at map generation; fixed thereafter. */
      loot: Array<{ resource_id: number; qty: number }>
      /** Adjacent guard spawn hex (one-time seeding). */
      guard: AxialPos | null
    }
  | {
      id: string
      kind: 'sign'
      position: AxialPos
      /** Chosen `sign_text.id` at generation. */
      sign_text_id: number
      /**
       * Campaign override; when set, replaces the table row entirely.
       * Random maps leave this unset.
       */
      custom_text?: string | null
      /**
       * Per-player last resolved text (also marks read for that player).
       * Key = `player_id`.
       */
      last_text_by_player: Record<string, string>
    }
  | {
      id: string
      kind: 'library'
      position: AxialPos
      /** Ability ids rolled at generation (Basic→Expert order). */
      ability_ids: number[]
      /**
       * Per-player visit flag for map tooltips (hotseat).
       * Key = `player_id`; value true once any hero of that player opened it.
       */
      visited_by_player: Record<string, boolean>
    }
  | {
      id: string
      kind: 'hanger'
      position: AxialPos
    }
  | {
      id: string
      kind: 'dock'
      position: AxialPos
      /** Adjacent deep Water hex chosen at generation. */
      launch: AxialPos
    }
  | {
      id: string
      kind: 'recruits'
      position: AxialPos
      /** Current week's unit (`unit.id`). */
      unit_id: number
      /** Remaining shared stock this week. */
      stock: number
      /**
       * Per-player knowledge of this week's offer (BR S9-9 AI addendum).
       * Key = `player_id`. Cleared on New Week re-roll.
       * AI scores recruits from this; live stock may differ until next visit.
       */
      known_by_player: Record<string, { unit_id: number; stock: number }>
    }
  | {
      id: string
      kind: 'notice_board'
      position: AxialPos
      /** Permanent town link (never changes on capture). */
      linked_town_id: string
      /** This week's rolled quest (null only before first roll). */
      quest: WeeklyQuest | null
      /** Living Defeat Mob target spawned from this board, if any. */
      target_mob_id: string | null
      /** Per-player accept / complete / turn-in state. */
      by_player: Record<string, QuestPlayerState>
      /**
       * Per-player AI knowledge of this week's quest (BR S9-11).
       * Key = `player_id`. Set when any hero opens/visits the board.
       * Cleared on New Week re-roll. AI scores from this, not live quest.
       */
      known_by_player: Record<string, WeeklyQuest>
    }

/** Quest category keys matching `quest_text.category` / feature stats. */
export type QuestCategory =
  | 'bring_resources'
  | 'bring_units'
  | 'know_ability'
  | 'control_nodes'
  | 'defeat_mob'
  | 'visit_feature'

export type QuestPlayerState = {
  accepted: boolean
  /** Goal met but not collected (Defeat Mob / Visit Feature only). */
  completed: boolean
  turned_in: boolean
  /** `calendarDayNumber` when accepted; used for Know Ability. */
  accepted_on_day: number | null
}

/** Fixed weekly quest payload on a Notice Board (BR S9-10). */
export type WeeklyQuest = {
  category: QuestCategory
  tier: number
  flavour_text: string
  goal_line: string
  reward_xp: number
  reward_gold: number
  /** Bring Resources asks. */
  resources?: Array<{ resource_id: number; qty: number }>
  /** Bring Units ask. */
  bring_units?: {
    group_key: string
    label: string
    qty: number
    min_tier: number
  }
  /** Know Ability target. */
  ability_id?: number
  /** Control Nodes ask. */
  control_nodes?: { resource_id: number; qty: number }
  /** Defeat Mob reserved spawn + pre-rolled stacks. */
  defeat?: {
    reserved_spawn: AxialPos
    stacks: Array<{ unit_id: number; qty: number }>
  }
  /** Visit Feature target. */
  visit?: { feature_id: string; feature_label: string }
}

/** Session boat (BR S9-8). Not a feature row — persists in save/load. */
export type Boat = {
  id: string
  position: AxialPos
  /** Hero aboard, or null when empty. */
  occupant_hero_id: string | null
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
  /** Neutral map features (fountains, chests, signs). Persist for save/reload. */
  features: MapFeature[]
  /** World boats (empty or occupied). Persist for save/reload. */
  boats: Boat[]
  mobs: Mob[]
}

export const HUMAN_PLAYER_ID = 'player-1'
export const GAME_ID = 'game-1'
export const HERO_ID = 'hero-1'
export const NECROPOLIS_TOWN_TYPE_ID = 6
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
