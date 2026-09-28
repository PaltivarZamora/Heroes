import { hexDistance } from '../hex/pathfinding'
import { slotsArmyValue } from './armyAlloc'
import {
  canCollectQuestReward,
  daysLeftInWeek,
  noticeBoardAcceptFitsWeek,
  noticeBoardKnowledgeFor,
  noticeBoardScoutExploreValue,
  playerQuestState,
  type NoticeBoardFeature,
} from '../session/quests'
import type {
  AxialPos,
  GameSession,
  Hero,
  Player,
  WeeklyQuest,
} from '../session/types'
import {
  getCachedCatalog,
  heroMovementPoints,
  unitById,
  unitEffectiveTier,
  type ReferenceCatalog,
} from '../town/catalog'
import { abilityById, heroHasDiscipline } from '../town/libraryRules'
import { aiAttackMinRatio } from './weights'

/** Collect urgency when goal is met (BR S9-11). Day 5+ overrides other goals. */
export const NOTICE_COLLECT_RETURN = 2.8
export const NOTICE_COLLECT_RESOURCE = 2.2
export const NOTICE_COLLECT_DAY5_RETURN = 5.5
export const NOTICE_COLLECT_DAY5_RESOURCE = 4.0

/** Accepted quest pursuit boosts (added onto related world candidates). */
export const NOTICE_PURSUE_RESOURCE = 1.8
export const NOTICE_PURSUE_MINE = 2.2
export const NOTICE_PURSUE_VISIT = 2.0
export const NOTICE_PURSUE_LEARN = 2.4
export const NOTICE_PURSUE_ATTACK = 1.6
export const NOTICE_PURSUE_RECRUIT = 1.6

/** Accept a known/unaccepted board (on top of scout explore_value). */
export const NOTICE_ACCEPT_EXPLORE = 0.9

export type NoticeBoardPurpose = 'scout_accept' | 'collect'

export function playerAcceptedQuests(
  session: GameSession,
  playerId: string,
): Array<{ board: NoticeBoardFeature; quest: WeeklyQuest }> {
  const out: Array<{ board: NoticeBoardFeature; quest: WeeklyQuest }> = []
  for (const row of session.features ?? []) {
    if (row.kind !== 'notice_board') {
      continue
    }
    const state = playerQuestState(row, playerId)
    if (!state.accepted || state.turned_in) {
      continue
    }
    const known = noticeBoardKnowledgeFor(row, playerId) ?? row.quest
    if (!known) {
      continue
    }
    out.push({ board: row, quest: known })
  }
  return out
}

/** Resource ids this player still needs for any Bring Resources / Control Nodes quest. */
export function questNeededResourceIds(
  session: GameSession,
  playerId: string,
): Set<number> {
  const needed = new Set<number>()
  const player = session.players.find((row) => row.id === playerId)
  for (const { quest, board } of playerAcceptedQuests(session, playerId)) {
    if (quest.category === 'bring_resources') {
      for (const ask of quest.resources ?? []) {
        const have = player?.resources[ask.resource_id] ?? 0
        if (have < ask.qty) {
          needed.add(ask.resource_id)
        }
      }
    }
    if (quest.category === 'control_nodes' && quest.control_nodes) {
      const owned = (session.nodes ?? []).filter(
        (node) =>
          node.kind === 'mine' &&
          node.player_id === playerId &&
          node.resource_id === quest.control_nodes!.resource_id,
      ).length
      if (owned < quest.control_nodes.qty) {
        needed.add(quest.control_nodes.resource_id)
      }
    }
    void board
  }
  return needed
}

export function questVisitFeatureIds(
  session: GameSession,
  playerId: string,
): Set<string> {
  const out = new Set<string>()
  for (const { board, quest } of playerAcceptedQuests(session, playerId)) {
    if (quest.category !== 'visit_feature' || !quest.visit) {
      continue
    }
    const state = playerQuestState(board, playerId)
    if (!state.completed) {
      out.add(quest.visit.feature_id)
    }
  }
  return out
}

export function heroCanLearnQuestAbility(
  catalog: ReferenceCatalog,
  hero: Hero,
  abilityId: number,
): boolean {
  if ((hero.learned_abilities ?? []).includes(abilityId)) {
    return false
  }
  const ability = abilityById(catalog, abilityId)
  if (!ability) {
    return false
  }
  return heroHasDiscipline(catalog, hero.class_id, ability.discipline_id)
}

export function heroStrongEnoughForQuestMob(
  session: GameSession,
  catalog: ReferenceCatalog,
  hero: Hero,
  board: NoticeBoardFeature,
): boolean {
  const mobId = board.target_mob_id
  if (!mobId) {
    // Not spawned yet — estimate from pre-rolled stacks.
    const quest = noticeBoardKnowledgeFor(board, hero.player_id) ?? board.quest
    const stacks = quest?.defeat?.stacks ?? []
    let enemy = 0
    for (const part of stacks) {
      const unit = unitById(catalog, part.unit_id)
      if (!unit) {
        continue
      }
      const avg = ((unit.min_dmg ?? 0) + (unit.max_dmg ?? 0)) / 2
      enemy += part.qty * avg * (unit.health ?? 1)
    }
    const own = slotsArmyValue(session, catalog, hero.army.slots_1_to_6)
    const minRatio = aiAttackMinRatio(catalog)
    return enemy <= 0 ? own > 0 : own / enemy >= minRatio
  }
  const mob = session.mobs.find((row) => row.id === mobId)
  if (!mob) {
    return false
  }
  const own = slotsArmyValue(session, catalog, hero.army.slots_1_to_6)
  const enemy = slotsArmyValue(session, catalog, mob.slots_1_to_6)
  const minRatio = aiAttackMinRatio(catalog)
  return enemy <= 0 ? own > 0 : own / enemy >= minRatio
}

export function bringUnitsQtyOnHero(
  session: GameSession,
  catalog: ReferenceCatalog,
  hero: Hero,
  ask: NonNullable<WeeklyQuest['bring_units']>,
): number {
  let qty = 0
  for (const id of hero.army.slots_1_to_6) {
    if (!id) {
      continue
    }
    const stack = session.units.find((row) => row.id === id)
    if (!stack || stack.qty <= 0) {
      continue
    }
    const unit = unitById(catalog, stack.unit_id)
    if (!unit) {
      continue
    }
    if (unitEffectiveTier(catalog, unit) < ask.min_tier) {
      continue
    }
    // Group matching is enforced at collect; for pursuit count tier-ok stacks loosely.
    qty += stack.qty
  }
  return qty
}

/**
 * Late-week accept gate using path MP from hero to board approach.
 * Estimate: 2×ceil(travelMp/maxMp)+1 ≤ days left (incl. today).
 */
export function canAcceptNoticeBoardThisWeek(
  session: GameSession,
  hero: Hero,
  travelMp: number,
): boolean {
  const catalog = getCachedCatalog()
  const maxMp = heroMovementPoints(
    catalog,
    hero,
    session.game.settings.move_mode,
  )
  return noticeBoardAcceptFitsWeek({
    dayOfWeek: session.game.calendar.day,
    travelMp,
    maxMp,
  })
}

export function collectOverrideFactors(dayOfWeek: number): {
  return_home: number
  resource_value: number
} {
  if (dayOfWeek >= 5) {
    return {
      return_home: NOTICE_COLLECT_DAY5_RETURN,
      resource_value: NOTICE_COLLECT_DAY5_RESOURCE,
    }
  }
  return {
    return_home: NOTICE_COLLECT_RETURN,
    resource_value: NOTICE_COLLECT_RESOURCE,
  }
}

export function scoutExploreForDay(dayOfWeek: number): number {
  return noticeBoardScoutExploreValue(dayOfWeek)
}

export function describeAcceptEstimate(
  dayOfWeek: number,
  travelMp: number,
  maxMp: number,
): string {
  const daysLeft = daysLeftInWeek(dayOfWeek)
  const daysToBoard = Math.max(1, Math.ceil(travelMp / Math.max(1, maxMp)))
  const need = daysToBoard * 2 + 1
  return `daysLeft=${daysLeft} daysToBoard=${daysToBoard} need=${need}`
}

/** Nearest approach distance among player's heroes to a hex. */
export function nearestHeroTravelHint(
  session: GameSession,
  player: Player,
  dest: AxialPos,
): { heroId: string; dist: number } | null {
  let best: { heroId: string; dist: number } | null = null
  for (const hero of session.heroes) {
    if (hero.player_id !== player.id || hero.flight) {
      continue
    }
    const dist = hexDistance(hero.position, dest)
    if (!best || dist < best.dist) {
      best = { heroId: hero.id, dist }
    }
  }
  return best
}

export function boardReadyToCollect(
  session: GameSession,
  catalog: ReferenceCatalog,
  board: NoticeBoardFeature,
  playerId: string,
  heroId: string,
): boolean {
  return canCollectQuestReward(session, catalog, board.id, playerId, heroId)
}
