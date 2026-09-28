import {
  findPath,
  findPathOnBoard,
  hexDistance,
  neighborHexes,
  approachHex,
} from '../hex/pathfinding'
import {
  boatCostGold,
  boatEnterCost,
  boatOccupiedByHero,
  canSailOnto,
  findBoatAt,
  isDisembarkLandHex,
} from '../hex/boat'
import { forEachPassableHex, getTile, isExplored, restoreExplored } from '../hex/world'
import { hexTransitionMoveCost } from '../hex/terrainTransition'
import type { Axial } from '../hex/hero'
import {
  getCachedCatalog,
  heroMovementPoints,
  heroResourcePools,
  flightSpeed,
  unitById,
  type ReferenceCatalog,
  type ResourceRow,
} from '../town/catalog'
import type { GameSession, Hero, Player, Town } from '../session/types'
import { appendAiTrace } from './trace'
import { garrisonArmyValue, navalSlotsArmyValue, slotsArmyValue } from './armyAlloc'
import { firstAffordableLearn, firstAffordableWorldLibraryLearn } from './libraryLearn'
import { mobLabel } from '../session/mobs'
import {
  visitingHeroId,
  townIsUndefended,
  townHasHanger,
  flightDestinationsFromTown,
  flightDestinationsFromOrigin,
  findTownAt,
  findWorldHangerBeside,
  walletFromPlayer,
} from '../session/accessors'
import {
  recruitsArmyValue,
  recruitsKnowledgeFor,
  recruitsScoutExploreValue,
  worldRecruitsMaxQtyForOffer,
} from '../session/recruits'
import {
  noticeBoardKnowledgeFor,
  playerQuestState,
} from '../session/quests'
import {
  boardReadyToCollect,
  bringUnitsQtyOnHero,
  canAcceptNoticeBoardThisWeek,
  collectOverrideFactors,
  describeAcceptEstimate,
  heroCanLearnQuestAbility,
  heroStrongEnoughForQuestMob,
  NOTICE_ACCEPT_EXPLORE,
  NOTICE_PURSUE_ATTACK,
  NOTICE_PURSUE_LEARN,
  NOTICE_PURSUE_MINE,
  NOTICE_PURSUE_RECRUIT,
  NOTICE_PURSUE_RESOURCE,
  NOTICE_PURSUE_VISIT,
  playerAcceptedQuests,
  questNeededResourceIds,
  questVisitFeatureIds,
  scoutExploreForDay,
} from './noticeBoard'
import { GOLD_RESOURCE_ID } from '../hex/resources'
import {
  WORLD_MOVE_DECISION,
  WORLD_MOVE_FACTORS,
  type ScoredOption,
  type WorldMoveFactor,
} from './types'
import {
  aiAttackMinRatio,
  archName,
  aiDecisionJitterPct,
  aiDecisionTemperature,
  aiHeroBlendBias,
  finalFactorWeight,
  pickWeighted,
  scoreOption,
} from './weights'

export type WorldAttackTarget =
  | { type: 'mob'; mobId: string }
  | { type: 'hero'; heroId: string }
  | { type: 'town'; townId: string }

export function worldAttackPos(
  session: GameSession,
  target: WorldAttackTarget,
): Axial | null {
  if (target.type === 'mob') {
    const mob = session.mobs.find((row) => row.id === target.mobId)
    return mob ? { ...mob.position } : null
  }
  if (target.type === 'hero') {
    const other = session.heroes.find((row) => row.id === target.heroId)
    return other ? { ...other.position } : null
  }
  const town = session.towns.find((row) => row.id === target.townId)
  return town ? { ...town.position } : null
}

export type WorldMoveIntent =
  | { kind: 'explore'; dest: Axial }
  | { kind: 'pickup'; dest: Axial; nodeId: string; resourceId: number }
  | { kind: 'mine'; dest: Axial; nodeId: string; resourceId: number }
  | { kind: 'fountain'; dest: Axial; featureId: string }
  | { kind: 'chest'; dest: Axial; featureId: string }
  | { kind: 'return'; dest: Axial; townId: string }
  | { kind: 'capture'; dest: Axial; townId: string }
  | { kind: 'seek_library'; dest: Axial; townId?: string; featureId?: string }
  | { kind: 'seek_hanger'; dest: Axial; featureId: string }
  | { kind: 'seek_dock'; dest: Axial; featureId: string }
  | { kind: 'seek_recruits'; dest: Axial; featureId: string }
  | {
      kind: 'seek_notice_board'
      dest: Axial
      featureId: string
      purpose: 'scout_accept' | 'collect'
    }
  | { kind: 'board_boat'; dest: Axial; boatId: string }
  | { kind: 'sail'; dest: Axial }
  | { kind: 'disembark'; dest: Axial }
  | { kind: 'fly'; dest: Axial; townId: string }
  | { kind: 'attack'; dest: Axial; target: WorldAttackTarget }

function blankFactors(
  partial: Partial<Record<WorldMoveFactor, number>>,
): Record<WorldMoveFactor, number> {
  return {
    safety: 0,
    resource_value: 0,
    explore_value: 0,
    return_home: 0,
    garrison_value: 0,
    capture_town: 0,
    learn_ability_value: 0,
    attack_value: 0,
    ...partial,
  }
}

function clamp01(n: number): number {
  if (n < 0) {
    return 0
  }
  if (n > 1) {
    return 1
  }
  return n
}

function posKey(pos: Axial): string {
  return `${pos.q},${pos.r}`
}

function samePos(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r
}

/** Same idea as HexMap.obstacleHexes — explored objects, always block other heroes. */
function blockedHexes(
  session: GameSession,
  mover: Hero,
  walkOnto: Axial | null,
): Set<string> {
  const blocked = new Set<string>()
  const ontoKey = walkOnto ? posKey(walkOnto) : ''
  const add = (q: number, r: number) => {
    if (q === mover.position.q && r === mover.position.r) {
      return
    }
    if (!isExplored(q, r)) {
      return
    }
    const hexKey = `${q},${r}`
    if (ontoKey && hexKey === ontoKey) {
      return
    }
    blocked.add(hexKey)
  }
  for (const hero of session.heroes) {
    if (hero.flight) {
      continue
    }
    add(hero.position.q, hero.position.r)
  }
  for (const town of session.towns) {
    const enemyOwned =
      town.player_id != null && town.player_id !== mover.player_id
    if (enemyOwned && !townIsUndefended(session, town, mover.id)) {
      if (!samePos(town.position, mover.position)) {
        blocked.add(posKey(town.position))
      }
      continue
    }
    add(town.position.q, town.position.r)
  }
  for (const node of session.nodes) {
    if (node.kind === 'pickup' && node.collected) {
      continue
    }
    add(node.position.q, node.position.r)
  }
  for (const feature of session.features ?? []) {
    add(feature.position.q, feature.position.r)
  }
  for (const mob of session.mobs) {
    add(mob.position.q, mob.position.r)
  }
  for (const boat of session.boats ?? []) {
    add(boat.position.q, boat.position.r)
  }
  return blocked
}

function sailTravelMp(
  session: GameSession,
  hero: Hero,
  dest: Axial,
  boatId: string,
): number | null {
  if (samePos(hero.position, dest)) {
    return 0
  }
  if (hero.movement_remaining <= 1e-9) {
    return null
  }
  const path = findPathOnBoard(
    hero.position,
    dest,
    boatEnterCost,
    undefined,
    (q, r) =>
      (q === hero.position.q && r === hero.position.r) ||
      canSailOnto(session, q, r, boatId, hero.player_id),
  )
  if (!path || path.length < 2) {
    return null
  }
  let cost = 0
  for (let i = 1; i < path.length; i += 1) {
    const step = boatEnterCost(path[i].q, path[i].r)
    if (step == null) {
      return null
    }
    cost += step
  }
  if (hero.movement_remaining + 1e-9 < cost) {
    return null
  }
  return cost
}

/** Boarded heroes must plan sail + disembark; never pick ground-only intents. */
function decideBoardedWorldMove(
  session: GameSession,
  hero: Hero,
  boatId: string,
  seen: Set<string>,
): WorldMoveIntent | null {
  const catalog = getCachedCatalog()
  const minRatio = aiAttackMinRatio(catalog)
  const ownValue = navalSlotsArmyValue(
    session,
    catalog,
    hero.army.slots_1_to_6,
  )

  // Visible enemy boats with naval strength ratios.
  type EnemyBoat = {
    dest: Axial
    heroId: string
    ratio: number
    travel: number | null
  }
  const enemies: EnemyBoat[] = []
  for (const boat of session.boats ?? []) {
    if (!boat.occupant_hero_id || boat.id === boatId) {
      continue
    }
    const foe = session.heroes.find((row) => row.id === boat.occupant_hero_id)
    if (!foe || foe.player_id === hero.player_id) {
      continue
    }
    if (!visibleToPlayer(seen, boat.position)) {
      continue
    }
    const enemyValue = navalSlotsArmyValue(
      session,
      catalog,
      foe.army.slots_1_to_6,
    )
    const ratio = enemyValue <= 0 ? Infinity : ownValue / enemyValue
    const travel = sailTravelMp(session, hero, boat.position, boatId)
    enemies.push({
      dest: { ...boat.position },
      heroId: foe.id,
      ratio,
      travel: travel ?? (samePos(hero.position, boat.position) ? 0 : null),
    })
  }

  // Engage when strong enough (same caution threshold as land fights).
  let bestNaval: EnemyBoat | null = null
  for (const row of enemies) {
    if (!(row.ratio >= minRatio)) {
      continue
    }
    if (row.travel == null && !samePos(hero.position, row.dest)) {
      continue
    }
    const score = (row.travel ?? 0) - row.ratio * 10
    const bestScore = bestNaval
      ? (bestNaval.travel ?? 0) - bestNaval.ratio * 10
      : Infinity
    if (!bestNaval || score < bestScore) {
      bestNaval = row
    }
  }
  if (bestNaval) {
    return {
      kind: 'attack',
      dest: bestNaval.dest,
      target: { type: 'hero', heroId: bestNaval.heroId },
    }
  }

  // Threat: stronger visible enemy nearby — prefer flee / disembark away.
  const threats = enemies
    .filter(
      (row) =>
        row.ratio < minRatio &&
        row.travel != null &&
        row.travel <= Math.max(8, hero.movement_remaining + 2),
    )
    .sort((a, b) => (a.travel ?? 99) - (b.travel ?? 99))
  const threatPos = threats[0]?.dest ?? null

  const landTargets: Axial[] = []
  const exploreDest = fogFrontier(hero.position)
  if (exploreDest) {
    landTargets.push(exploreDest)
  }
  for (const node of session.nodes) {
    if (node.kind === 'pickup' && node.collected) {
      continue
    }
    if (!visibleToPlayer(seen, node.position)) {
      continue
    }
    if (boatEnterCost(node.position.q, node.position.r) != null) {
      continue
    }
    landTargets.push(node.position)
  }
  for (const town of session.towns) {
    if (town.player_id !== hero.player_id) {
      continue
    }
    if (!visibleToPlayer(seen, town.position)) {
      continue
    }
    landTargets.push(town.position)
  }

  let bestDisembark: WorldMoveIntent | null = null
  let bestScore = Infinity

  const scoreAwayFromThreat = (at: Axial): number => {
    if (!threatPos) {
      return 0
    }
    // Prefer hexes farther from the threat.
    return -hexDistance(at, threatPos) * 3
  }

  for (const target of landTargets) {
    for (const land of neighborHexes(target)) {
      if (!isDisembarkLandHex(land.q, land.r)) {
        continue
      }
      if (hexDistance(hero.position, land) <= 1) {
        const score =
          hexDistance(land, target) + scoreAwayFromThreat(land)
        if (score < bestScore) {
          bestScore = score
          bestDisembark = { kind: 'disembark', dest: land }
        }
        continue
      }
      for (const water of neighborHexes(land)) {
        if (boatEnterCost(water.q, water.r) == null) {
          continue
        }
        if (!canSailOnto(session, water.q, water.r, boatId, hero.player_id)) {
          continue
        }
        const travel = sailTravelMp(session, hero, water, boatId)
        if (travel == null) {
          continue
        }
        const score =
          travel + hexDistance(land, target) + scoreAwayFromThreat(water)
        if (score < bestScore) {
          bestScore = score
          bestDisembark = { kind: 'sail', dest: water }
        }
      }
    }
  }
  if (bestDisembark) {
    return bestDisembark
  }

  // Anti-strand: any reachable sail step (prefer away from threat / toward fog).
  let bestSail: { dest: Axial; score: number } | null = null
  for (const n of neighborHexes(hero.position)) {
    if (boatEnterCost(n.q, n.r) == null) {
      continue
    }
    if (!canSailOnto(session, n.q, n.r, boatId, hero.player_id)) {
      continue
    }
    const travel = sailTravelMp(session, hero, n, boatId)
    if (travel == null) {
      continue
    }
    let score = travel + scoreAwayFromThreat(n)
    if (exploreDest) {
      score += hexDistance(n, exploreDest) * 0.25
    }
    if (!bestSail || score < bestSail.score) {
      bestSail = { dest: n, score }
    }
  }
  if (bestSail) {
    return { kind: 'sail', dest: bestSail.dest }
  }

  // Immediate disembark onto any adjacent land if we somehow have no sail.
  for (const n of neighborHexes(hero.position)) {
    if (!isDisembarkLandHex(n.q, n.r)) {
      continue
    }
    return { kind: 'disembark', dest: n }
  }
  return null
}

function pathTravelMp(
  hero: Hero,
  dest: Axial,
  blocked: ReadonlySet<string>,
): number | null {
  if (samePos(hero.position, dest)) {
    return 0
  }
  if (hero.movement_remaining <= 1e-9) {
    return null
  }
  const path = findPath(hero.position, dest, blocked)
  if (!path || path.length < 2) {
    return null
  }
  const firstCost = hexTransitionMoveCost(getCachedCatalog(), path[1].q, path[1].r)
  if (firstCost == null || hero.movement_remaining + 1e-9 < firstCost) {
    return null
  }
  let cost = 0
  for (let i = 1; i < path.length; i += 1) {
    const step = hexTransitionMoveCost(getCachedCatalog(), path[i].q, path[i].r)
    if (step == null) {
      return null
    }
    cost += step
  }
  return cost
}

/** 1 at the hero's hex, ~0.5 at one full day's travel, never a hard cutoff. */
function distanceFalloff(travelMp: number, refMp: number): number {
  return 1 / (1 + Math.max(0, travelMp) / Math.max(refMp, 1))
}

function nearestOwnTown(session: GameSession, playerId: string, at: Axial): Town | null {
  let best: Town | null = null
  let bestDist = Infinity
  for (const town of session.towns) {
    if (town.player_id !== playerId) {
      continue
    }
    const dist = hexDistance(at, town.position)
    if (dist < bestDist) {
      bestDist = dist
      best = town
    }
  }
  return best
}

function safetyAt(session: GameSession, playerId: string, dest: Axial): number {
  const home = nearestOwnTown(session, playerId, dest)
  if (!home) {
    return 0.4
  }
  return clamp01(1 - hexDistance(dest, home.position) / 12)
}

/** High only when the day is spent — not a constant “walk home” bonus. */
function returnHomeUrgency(hero: Hero, home: Town | null, maxMp: number): number {
  if (!home || samePos(hero.position, home.position)) {
    return 0
  }
  const cap = Math.max(maxMp, hero.movement_remaining, 1e-9)
  return clamp01(1 - hero.movement_remaining / cap)
}

function fogFrontier(from: Axial): Axial | null {
  let best: Axial | null = null
  let bestDist = Infinity
  forEachPassableHex((q, r) => {
    if (!isExplored(q, r)) {
      return
    }
    const hex = { q, r }
    if (samePos(hex, from)) {
      return
    }
    const nextToFog = neighborHexes(hex).some(
      (n) => getTile(n.q, n.r) != null && !isExplored(n.q, n.r),
    )
    if (!nextToFog) {
      return
    }
    const dist = hexDistance(from, hex)
    if (dist < bestDist) {
      bestDist = dist
      best = hex
    }
  })
  return best
}

function exploreValueAt(dest: Axial): number {
  const foggy = neighborHexes(dest).filter(
    (n) => getTile(n.q, n.r) != null && !isExplored(n.q, n.r),
  ).length
  return clamp01(foggy / 6)
}

function resourceValue(
  catalog: ReferenceCatalog | null,
  resourceId: number,
  kind: 'pickup' | 'mine',
): number {
  const rows = catalog?.resource ?? []
  const row = rows.find((entry) => entry.id === resourceId)
  const maxBase = Math.max(1, ...rows.map((entry: ResourceRow) => entry.base_value || 0))
  const frac = clamp01((row?.base_value ?? 1) / maxBase)
  return kind === 'mine' ? 0.55 + 0.45 * frac : 0.3 + 0.35 * frac
}

/** 1.0 ≈ ten of the strongest catalog unit sitting in garrison. */
function garrisonValueRef(catalog: ReferenceCatalog | null): number {
  if (!catalog) {
    return 1
  }
  let maxOne = 0
  for (const unit of catalog.unit) {
    const one = ((unit.min_dmg + unit.max_dmg) / 2) * unit.health
    if (one > maxOne) {
      maxOne = one
    }
  }
  return Math.max(1, maxOne * 10)
}

function garrisonValueAt(
  session: GameSession,
  catalog: ReferenceCatalog | null,
  town: Town,
): number {
  return clamp01(garrisonArmyValue(session, catalog, town) / garrisonValueRef(catalog))
}

function resourceName(
  catalog: ReferenceCatalog | null,
  resourceId: number,
): string {
  return catalog?.resource.find((row) => row.id === resourceId)?.name ?? `#${resourceId}`
}

function seenSet(player: Player): Set<string> {
  return new Set(player.explored.map((hex) => posKey(hex)))
}

function visibleToPlayer(seen: ReadonlySet<string>, pos: Axial): boolean {
  return seen.has(posKey(pos))
}

function letter(index: number): string {
  return String.fromCharCode(65 + (index % 26))
}

function formatFactors(
  factors: Record<string, number>,
  weights: Record<string, number>,
): string {
  return WORLD_MOVE_FACTORS.map((key) => {
    const f = factors[key] ?? 0
    const w = weights[key] ?? 0
    return `${key}=${f.toFixed(2)}×${w.toFixed(2)}`
  }).join('  ')
}

export function decideWorldMove(
  session: GameSession,
  player: Player,
  hero: Hero,
): WorldMoveIntent | null {
  restoreExplored(player.explored)
  const seen = seenSet(player)
  const catalog = getCachedCatalog()
  const aboardBoat = boatOccupiedByHero(session, hero.id)
  if (aboardBoat) {
    return decideBoardedWorldMove(session, hero, aboardBoat.id, seen)
  }
  const maxMp = heroMovementPoints(
    catalog,
    hero,
    session.game.settings.move_mode,
  )
  const weights: Record<string, number> = {}
  for (const factor of WORLD_MOVE_FACTORS) {
    weights[factor] = finalFactorWeight(player, hero, WORLD_MOVE_DECISION, factor, catalog)
  }

  const options: ScoredOption<WorldMoveIntent>[] = []
  const add = (
    label: string,
    intent: WorldMoveIntent,
    factors: Record<WorldMoveFactor, number>,
  ) => {
    const walkOnto = intent.kind === 'explore' ? null : intent.dest
    const blocked = blockedHexes(session, hero, walkOnto)
    const travel = pathTravelMp(hero, intent.dest, blocked)
    if (travel == null) {
      return
    }
    const falloff = distanceFalloff(travel, maxMp)
    const raw = scoreOption(factors, weights)
    const id =
      intent.kind === 'attack'
        ? intent.target.type === 'mob'
          ? `attack:mob:${intent.target.mobId}`
          : intent.target.type === 'hero'
            ? `attack:hero:${intent.target.heroId}`
            : `attack:town:${intent.target.townId}`
        : intent.kind === 'seek_notice_board'
          ? `seek_notice_board:${intent.purpose}:${intent.featureId}`
          : `${intent.kind}:${posKey(intent.dest)}`
    options.push({
      id,
      label: `${label}  dist=${travel.toFixed(1)}×${falloff.toFixed(2)}`,
      factors,
      weights,
      score: Math.round(raw * falloff * 100) / 100,
      data: intent,
    })
  }

  const ownValue = slotsArmyValue(session, catalog, hero.army.slots_1_to_6)
  const minRatio = aiAttackMinRatio(catalog)
  const considerAttack = (
    label: string,
    targetPos: Axial,
    enemyValue: number,
    target: WorldAttackTarget,
  ) => {
    if (!(ownValue > 0)) {
      return
    }
    const ratio =
      enemyValue > 0 ? ownValue / enemyValue : Number.POSITIVE_INFINITY
    if (!(ratio >= minRatio)) {
      return
    }
    const approach = approachHex(
      hero.position,
      targetPos,
      blockedHexes(session, hero, null),
    )
    if (!approach) {
      return
    }
    add(
      `${label} @ ${posKey(targetPos)} ratio=${Number.isFinite(ratio) ? ratio.toFixed(2) : 'inf'}`,
      { kind: 'attack', dest: approach, target },
      blankFactors({
        safety: safetyAt(session, player.id, approach),
        attack_value: 1,
      }),
    )
  }

  let pickupVisible = 0
  const questResources = questNeededResourceIds(session, player.id)
  const questVisits = questVisitFeatureIds(session, player.id)
  const acceptedQuests = playerAcceptedQuests(session, player.id)

  let pickupFog = 0
  for (const node of session.nodes) {
    if (node.kind === 'pickup' && !node.collected) {
      if (!visibleToPlayer(seen, node.position)) {
        pickupFog += 1
      } else {
        pickupVisible += 1
      }
    }
    if (!visibleToPlayer(seen, node.position)) {
      continue
    }
    if (node.kind === 'pickup') {
      if (node.collected) {
        continue
      }
      const questBoost = questResources.has(node.resource_id)
        ? NOTICE_PURSUE_RESOURCE
        : 0
      add(
        `pickup ${resourceName(catalog, node.resource_id)} @ ${posKey(node.position)}${questBoost ? ' (quest)' : ''}`,
        {
          kind: 'pickup',
          dest: node.position,
          nodeId: node.id,
          resourceId: node.resource_id,
        },
        blankFactors({
          safety: safetyAt(session, player.id, node.position),
          resource_value:
            resourceValue(catalog, node.resource_id, 'pickup') + questBoost,
          explore_value: exploreValueAt(node.position) * 0.4,
        }),
      )
      continue
    }
    if (node.player_id === player.id) {
      continue
    }
    // Enemy-held mines: only pursue when a Control Nodes / Bring Resources
    // quest still needs that resource.
    if (node.player_id != null && !questResources.has(node.resource_id)) {
      continue
    }
    const questMineBoost = questResources.has(node.resource_id)
      ? NOTICE_PURSUE_MINE
      : 0
    add(
      `mine ${resourceName(catalog, node.resource_id)} @ ${posKey(node.position)}${questMineBoost ? ' (quest)' : ''}${node.player_id != null ? ' (recapture)' : ''}`,
      {
        kind: 'mine',
        dest: node.position,
        nodeId: node.id,
        resourceId: node.resource_id,
      },
      blankFactors({
        safety: safetyAt(session, player.id, node.position),
        resource_value:
          resourceValue(catalog, node.resource_id, 'mine') + questMineBoost,
        explore_value: exploreValueAt(node.position) * 0.25,
      }),
    )
  }

  // Fountain (BR S9-2): only when Mana or Energy is below max.
  if (catalog) {
    const pools = heroResourcePools(catalog, hero)
    const manaNeed =
      pools.current_mana > 0
        ? clamp01(1 - hero.current_mana / pools.current_mana)
        : 0
    const energyNeed =
      pools.current_energy > 0
        ? clamp01(1 - hero.current_energy / pools.current_energy)
        : 0
    const poolNeed = Math.max(manaNeed, energyNeed)
    if (poolNeed > 1e-9) {
      for (const feature of session.features ?? []) {
        if (feature.kind !== 'fountain') {
          continue
        }
        if (!visibleToPlayer(seen, feature.position)) {
          continue
        }
        if (samePos(hero.position, feature.position)) {
          continue
        }
        // Score: missing-pool fraction × resource_value weight; distance via falloff in add().
        add(
          `fountain @ ${posKey(feature.position)} (need=${poolNeed.toFixed(2)} mana=${manaNeed.toFixed(2)} energy=${energyNeed.toFixed(2)})`,
          {
            kind: 'fountain',
            dest: feature.position,
            featureId: feature.id,
          },
          blankFactors({
            safety: safetyAt(session, player.id, feature.position),
            resource_value: 0.55 + 0.45 * poolNeed,
            explore_value: exploreValueAt(feature.position) * 0.15,
          }),
        )
      }
    }
  }

  for (const feature of session.features ?? []) {
    if (feature.kind !== 'chest') {
      continue
    }
    if (!visibleToPlayer(seen, feature.position)) {
      continue
    }
    const approach = approachHex(
      hero.position,
      feature.position,
      blockedHexes(session, hero, null),
    )
    if (!approach) {
      continue
    }
    const levelFrac = clamp01(feature.level / 4)
    add(
      `chest ${feature.name} @ ${posKey(feature.position)} → ${posKey(approach)} (L${feature.level})`,
      {
        kind: 'chest',
        dest: approach,
        featureId: feature.id,
      },
      blankFactors({
        safety: safetyAt(session, player.id, approach),
        resource_value: 0.4 + 0.6 * levelFrac,
        explore_value: exploreValueAt(feature.position) * 0.2,
      }),
    )
  }

  for (const town of session.towns) {
    if (!visibleToPlayer(seen, town.position)) {
      continue
    }
    if (town.player_id === player.id) {
      if (samePos(hero.position, town.position)) {
        continue
      }
      const urgency = returnHomeUrgency(hero, town, maxMp)
      const garrison = garrisonValueAt(session, catalog, town)
      if (urgency > 0 || garrison > 0) {
        add(
          `return home ${town.name} @ ${posKey(town.position)} (urgency=${urgency.toFixed(2)} garrison=${garrison.toFixed(2)})`,
          {
            kind: 'return',
            dest: town.position,
            townId: town.id,
          },
          blankFactors({
            safety: 0.9 * urgency,
            return_home: urgency,
            garrison_value: garrison,
          }),
        )
      }
      if (catalog) {
        const ability = firstAffordableLearn(
          session,
          catalog,
          player,
          hero,
          town,
        )
        if (ability) {
          const questLearn = acceptedQuests.some(
            ({ board, quest }) =>
              quest.category === 'know_ability' &&
              quest.ability_id === ability.id &&
              !playerQuestState(board, player.id).completed &&
              heroCanLearnQuestAbility(catalog, hero, quest.ability_id),
          )
          add(
            `seek library ${town.name} @ ${posKey(town.position)} (${ability.name}${questLearn ? ', quest' : ''})`,
            {
              kind: 'seek_library',
              dest: town.position,
              townId: town.id,
            },
            blankFactors({
              safety: safetyAt(session, player.id, town.position),
              learn_ability_value: questLearn ? NOTICE_PURSUE_LEARN : 1,
            }),
          )
        }
      }
      continue
    }
    if (town.player_id != null) {
      const occupantId = visitingHeroId(session, town)
      const occupant = occupantId
        ? session.heroes.find((row) => row.id === occupantId)
        : undefined
      const occupantValue =
        occupant && occupant.player_id !== player.id
          ? slotsArmyValue(session, catalog, occupant.army.slots_1_to_6)
          : 0
      const garrisonValue = garrisonArmyValue(session, catalog, town)
      if (
        townIsUndefended(session, town, hero.id) ||
        (garrisonValue <= 0 && occupantValue <= 0)
      ) {
        add(`capture ${town.name} @ ${posKey(town.position)}`, {
          kind: 'capture',
          dest: town.position,
          townId: town.id,
        }, blankFactors({
          safety: safetyAt(session, player.id, town.position),
          explore_value: exploreValueAt(town.position) * 0.2,
          capture_town: 1,
        }))
        continue
      }
      considerAttack(
        `attack ${town.name}`,
        town.position,
        garrisonValue + occupantValue,
        { type: 'town', townId: town.id },
      )
      continue
    }
    const garrisonValue = garrisonArmyValue(session, catalog, town)
    if (garrisonValue > 0) {
      // Neutral town with a garrison — attack only if the ratio gate passes.
      considerAttack(
        `attack garrison ${town.name}`,
        town.position,
        garrisonValue,
        { type: 'town', townId: town.id },
      )
      continue
    }
    add(`capture ${town.name} @ ${posKey(town.position)}`, {
      kind: 'capture',
      dest: town.position,
      townId: town.id,
    }, blankFactors({
      safety: safetyAt(session, player.id, town.position),
      explore_value: exploreValueAt(town.position) * 0.2,
      capture_town: 1,
    }))
  }

  for (const feature of session.features ?? []) {
    if (feature.kind !== 'library') {
      continue
    }
    if (!catalog || !visibleToPlayer(seen, feature.position)) {
      continue
    }
    const ability = firstAffordableWorldLibraryLearn(
      session,
      catalog,
      player,
      hero,
      feature.id,
    )
    if (!ability) {
      continue
    }
    const approach = approachHex(
      hero.position,
      feature.position,
      blockedHexes(session, hero, null),
    )
    if (!approach) {
      continue
    }
    add(
      `seek world library @ ${posKey(feature.position)} → ${posKey(approach)} (${ability.name})`,
      {
        kind: 'seek_library',
        dest: approach,
        featureId: feature.id,
      },
      blankFactors({
        safety: safetyAt(session, player.id, approach),
        learn_ability_value: 1,
      }),
    )
  }

  for (const other of session.heroes) {
    if (other.id === hero.id || other.player_id === player.id) {
      continue
    }
    if (other.flight) {
      continue
    }
    if (!visibleToPlayer(seen, other.position)) {
      continue
    }
    const onTown = session.towns.find(
      (town) =>
        town.position.q === other.position.q &&
        town.position.r === other.position.r,
    )
    if (onTown && onTown.player_id !== player.id) {
      continue
    }
    considerAttack(
      `attack ${other.name}`,
      other.position,
      slotsArmyValue(session, catalog, other.army.slots_1_to_6),
      { type: 'hero', heroId: other.id },
    )
  }

  for (const mob of session.mobs) {
    if (!visibleToPlayer(seen, mob.position)) {
      continue
    }
    const questBoard = acceptedQuests.find(
      ({ board, quest }) =>
        quest.category === 'defeat_mob' &&
        board.target_mob_id === mob.id &&
        !playerQuestState(board, player.id).completed,
    )?.board
    if (questBoard) {
      if (!catalog || !heroStrongEnoughForQuestMob(session, catalog, hero, questBoard)) {
        continue
      }
      const approach = approachHex(
        hero.position,
        mob.position,
        blockedHexes(session, hero, null),
      )
      if (!approach) {
        continue
      }
      add(
        `quest defeat ${mobLabel(session, catalog, mob)}`,
        { kind: 'attack', dest: approach, target: { type: 'mob', mobId: mob.id } },
        blankFactors({
          safety: safetyAt(session, player.id, approach),
          attack_value: NOTICE_PURSUE_ATTACK,
          return_home: 0.5,
        }),
      )
      continue
    }
    considerAttack(
      `attack ${mobLabel(session, catalog, mob)}`,
      mob.position,
      slotsArmyValue(session, catalog, mob.slots_1_to_6),
      { type: 'mob', mobId: mob.id },
    )
  }

  // Hanger flight: town departure (unchanged) + world Hanger departure.
  const pushFlyQuotes = (
    originLabel: string,
    _originPos: Axial,
    quotes: ReturnType<typeof flightDestinationsFromOrigin>,
  ) => {
    if (!catalog) {
      return
    }
    const gold = player.resources[GOLD_RESOURCE_ID] ?? 0
    const speed = flightSpeed(catalog)
    for (const quote of quotes) {
      if (quote.blocked || gold < quote.goldCost) {
        continue
      }
      const urgency = returnHomeUrgency(hero, quote.town, maxMp)
      const garrison = garrisonValueAt(session, catalog, quote.town)
      const ability = firstAffordableLearn(
        session,
        catalog,
        player,
        hero,
        quote.town,
      )
      if (urgency <= 0 && garrison <= 0 && !ability && quote.distance <= speed) {
        continue
      }
      const flightDays = Math.max(1, Math.ceil(quote.distance / speed))
      const falloff = distanceFalloff(flightDays, 1)
      const goldMult = clamp01(
        1 -
          (quote.goldCost / Math.max(gold, quote.goldCost, 1)) * 0.35,
      )
      const factors = blankFactors({
        safety: 0.95,
        return_home: Math.max(urgency, garrison > 0 || ability ? 0.45 : 0.25),
        garrison_value: garrison,
        learn_ability_value: ability ? 1 : 0,
      })
      const raw = scoreOption(factors, weights)
      options.push({
        id: `fly:${originLabel}:${quote.town.id}`,
        label: `fly ${quote.town.name} via ${originLabel} @ ${posKey(quote.town.position)} days=${flightDays} gold=${quote.goldCost} ×${falloff.toFixed(2)}×g${goldMult.toFixed(2)}`,
        factors,
        weights,
        score: Math.round(raw * falloff * goldMult * 100) / 100,
        data: {
          kind: 'fly',
          dest: { ...quote.town.position },
          townId: quote.town.id,
        },
      })
    }
  }

  const originTown = findTownAt(session, hero.position.q, hero.position.r)
  if (
    catalog &&
    originTown &&
    originTown.player_id === player.id &&
    townHasHanger(session, catalog, originTown.id)
  ) {
    pushFlyQuotes(
      `town ${originTown.name}`,
      originTown.position,
      flightDestinationsFromTown(
        session,
        catalog,
        originTown.id,
        player.id,
        hero.id,
      ),
    )
  }

  const besideHanger = findWorldHangerBeside(session, hero.position)
  if (catalog && besideHanger) {
    pushFlyQuotes(
      'world hanger',
      besideHanger.position,
      flightDestinationsFromOrigin(
        session,
        catalog,
        besideHanger.position,
        player.id,
        hero.id,
      ),
    )
  } else if (catalog) {
    // Walk toward a world Hanger when flying from there looks worthwhile.
    for (const feature of session.features ?? []) {
      if (feature.kind !== 'hanger') {
        continue
      }
      if (!visibleToPlayer(seen, feature.position)) {
        continue
      }
      const quotes = flightDestinationsFromOrigin(
        session,
        catalog,
        feature.position,
        player.id,
        hero.id,
      ).filter((quote) => {
        const gold = player.resources[GOLD_RESOURCE_ID] ?? 0
        return !quote.blocked && gold >= quote.goldCost
      })
      if (quotes.length === 0) {
        continue
      }
      const approach = approachHex(
        hero.position,
        feature.position,
        blockedHexes(session, hero, null),
      )
      if (!approach || samePos(approach, hero.position)) {
        continue
      }
      const best = quotes[0]
      if (!best) {
        continue
      }
      const urgency = returnHomeUrgency(hero, best.town, maxMp)
      const garrison = garrisonValueAt(session, catalog, best.town)
      const ability = firstAffordableLearn(
        session,
        catalog,
        player,
        hero,
        best.town,
      )
      if (urgency <= 0 && garrison <= 0 && !ability) {
        continue
      }
      add(
        `seek hanger @ ${posKey(feature.position)} → ${posKey(approach)} (then fly ${best.town.name})`,
        {
          kind: 'seek_hanger',
          dest: approach,
          featureId: feature.id,
        },
        blankFactors({
          safety: safetyAt(session, player.id, approach),
          return_home: Math.max(urgency, garrison > 0 || ability ? 0.4 : 0.2),
          garrison_value: garrison * 0.85,
          learn_ability_value: ability ? 0.85 : 0,
        }),
      )
    }
  }

  // Deferred: full MP comparison of land route vs boat+sail+disembark.
  for (const boat of session.boats ?? []) {
    if (boat.occupant_hero_id != null) {
      continue
    }
    if (!visibleToPlayer(seen, boat.position)) {
      continue
    }
    const blocked = blockedHexes(session, hero, boat.position)
    const travel = pathTravelMp(hero, boat.position, blocked)
    if (travel == null) {
      continue
    }
    add(
      `board boat @ ${posKey(boat.position)}`,
      { kind: 'board_boat', dest: boat.position, boatId: boat.id },
      blankFactors({
        safety: safetyAt(session, player.id, boat.position),
        explore_value: 0.45,
        resource_value: 0.35,
      }),
    )
  }
  if (catalog) {
    for (const feature of session.features ?? []) {
      if (feature.kind !== 'dock') {
        continue
      }
      if (!visibleToPlayer(seen, feature.position)) {
        continue
      }
      if (findBoatAt(session, feature.launch.q, feature.launch.r)) {
        continue
      }
      const gold = player.resources[GOLD_RESOURCE_ID] ?? 0
      if (gold < boatCostGold(catalog)) {
        continue
      }
      const approach = approachHex(
        hero.position,
        feature.position,
        blockedHexes(session, hero, null),
      )
      if (!approach || samePos(approach, hero.position)) {
        continue
      }
      add(
        `seek dock @ ${posKey(feature.position)} → ${posKey(approach)}`,
        { kind: 'seek_dock', dest: approach, featureId: feature.id },
        blankFactors({
          safety: safetyAt(session, player.id, approach),
          explore_value: 0.35,
          resource_value: 0.4,
        }),
      )
    }
  }

  // Recruits for Hire (BR S9-9 AI addendum):
  // Knowledge is per AI player (known_by_player). Unknown buildings get a high
  // early-week scout score; known stock 0 is dropped; known stock > 0 uses
  // Town AI recruit scoring for this hero's affordability/room.
  if (catalog) {
    const wallet = walletFromPlayer(session, player.id)
    const dayOfWeek = session.game.calendar.day
    const scoutValue = recruitsScoutExploreValue(dayOfWeek)
    for (const feature of session.features ?? []) {
      if (feature.kind !== 'recruits') {
        continue
      }
      if (!visibleToPlayer(seen, feature.position)) {
        continue
      }
      const approach = approachHex(
        hero.position,
        feature.position,
        blockedHexes(session, hero, null),
      )
      if (!approach) {
        continue
      }
      // Already adjacent counts as reachable (visit / recruit this action).
      const known = recruitsKnowledgeFor(feature, player.id)
      if (known) {
        if (known.stock < 1) {
          continue
        }
        const unit = unitById(catalog, known.unit_id)
        if (!unit) {
          continue
        }
        const maxQty = worldRecruitsMaxQtyForOffer(
          session,
          catalog,
          hero.id,
          wallet,
          known.unit_id,
          known.stock,
        )
        if (maxQty < 1) {
          // This hero can't use it; other heroes may still score it later.
          continue
        }
        const army = recruitsArmyValue(unit.tier)
        add(
          `seek recruits @ ${posKey(feature.position)} → ${posKey(approach)} (${unit.name} known stock=${known.stock})`,
          { kind: 'seek_recruits', dest: approach, featureId: feature.id },
          blankFactors({
            safety: safetyAt(session, player.id, approach),
            garrison_value: army,
          }),
        )
        continue
      }
      // Unknown this week — high scout priority early in the week.
      add(
        `seek recruits (scout D${dayOfWeek}) @ ${posKey(feature.position)} → ${posKey(approach)}`,
        { kind: 'seek_recruits', dest: approach, featureId: feature.id },
        blankFactors({
          safety: safetyAt(session, player.id, approach),
          explore_value: scoutValue,
        }),
      )
    }
  }

  // Notice Boards (BR S9-11): scout/accept, collect deadline, pursue goals.
  if (catalog) {
    const dayOfWeek = session.game.calendar.day
    const scoutValue = scoutExploreForDay(dayOfWeek)
    const collectFactors = collectOverrideFactors(dayOfWeek)

    for (const feature of session.features ?? []) {
      if (feature.kind !== 'notice_board') {
        continue
      }
      if (!visibleToPlayer(seen, feature.position)) {
        continue
      }
      const approach = approachHex(
        hero.position,
        feature.position,
        blockedHexes(session, hero, null),
      )
      if (!approach) {
        continue
      }
      const blocked = blockedHexes(session, hero, approach)
      const travel = pathTravelMp(hero, approach, blocked)
      if (travel == null) {
        continue
      }
      const state = playerQuestState(feature, player.id)
      if (state.turned_in) {
        continue
      }

      // Collect when goal is met — very high, day 5+ overrides other goals.
      if (
        state.accepted &&
        boardReadyToCollect(session, catalog, feature, player.id, hero.id)
      ) {
        add(
          `collect notice board @ ${posKey(feature.position)} (D${dayOfWeek})`,
          {
            kind: 'seek_notice_board',
            dest: approach,
            featureId: feature.id,
            purpose: 'collect',
          },
          blankFactors({
            safety: safetyAt(session, player.id, approach),
            return_home: collectFactors.return_home,
            resource_value: collectFactors.resource_value,
          }),
        )
        continue
      }

      // Scout / accept if not yet accepted.
      if (!state.accepted) {
        if (!canAcceptNoticeBoardThisWeek(session, hero, travel)) {
          continue
        }
        const known = noticeBoardKnowledgeFor(feature, player.id)
        const explore = known
          ? NOTICE_ACCEPT_EXPLORE
          : scoutValue + NOTICE_ACCEPT_EXPLORE * 0.25
        const est = describeAcceptEstimate(dayOfWeek, travel, maxMp)
        add(
          `seek notice board (${known ? 'accept' : `scout D${dayOfWeek}`}) @ ${posKey(feature.position)} [${est}]`,
          {
            kind: 'seek_notice_board',
            dest: approach,
            featureId: feature.id,
            purpose: 'scout_accept',
          },
          blankFactors({
            safety: safetyAt(session, player.id, approach),
            explore_value: explore,
          }),
        )
      }
    }

    // Visit Feature pursuit — approach the named feature to interact.
    for (const featureId of questVisits) {
      const target = (session.features ?? []).find((row) => row.id === featureId)
      if (!target || !visibleToPlayer(seen, target.position)) {
        continue
      }
      const dest =
        target.kind === 'fountain'
          ? { ...target.position }
          : approachHex(
              hero.position,
              target.position,
              blockedHexes(session, hero, null),
            )
      if (!dest) {
        continue
      }
      // Reuse seek_* intents where they exist so turn.ts triggers the interact.
      if (target.kind === 'library') {
        add(
          `quest visit library @ ${posKey(target.position)}`,
          {
            kind: 'seek_library',
            dest,
            featureId: target.id,
          },
          blankFactors({
            safety: safetyAt(session, player.id, dest),
            learn_ability_value: NOTICE_PURSUE_VISIT,
            explore_value: 0.5,
          }),
        )
      } else if (target.kind === 'hanger') {
        add(
          `quest visit hanger @ ${posKey(target.position)}`,
          { kind: 'seek_hanger', dest, featureId: target.id },
          blankFactors({
            safety: safetyAt(session, player.id, dest),
            explore_value: NOTICE_PURSUE_VISIT,
          }),
        )
      } else if (target.kind === 'dock') {
        add(
          `quest visit dock @ ${posKey(target.position)}`,
          { kind: 'seek_dock', dest, featureId: target.id },
          blankFactors({
            safety: safetyAt(session, player.id, dest),
            explore_value: NOTICE_PURSUE_VISIT,
          }),
        )
      } else if (target.kind === 'recruits') {
        add(
          `quest visit recruits @ ${posKey(target.position)}`,
          { kind: 'seek_recruits', dest, featureId: target.id },
          blankFactors({
            safety: safetyAt(session, player.id, dest),
            explore_value: NOTICE_PURSUE_VISIT,
          }),
        )
      } else if (target.kind === 'fountain') {
        add(
          `quest visit fountain @ ${posKey(target.position)}`,
          { kind: 'fountain', dest, featureId: target.id },
          blankFactors({
            safety: safetyAt(session, player.id, dest),
            explore_value: NOTICE_PURSUE_VISIT,
            resource_value: 0.5,
          }),
        )
      } else if (target.kind === 'notice_board') {
        add(
          `quest visit notice board @ ${posKey(target.position)}`,
          {
            kind: 'seek_notice_board',
            dest,
            featureId: target.id,
            purpose: 'scout_accept',
          },
          blankFactors({
            safety: safetyAt(session, player.id, dest),
            explore_value: NOTICE_PURSUE_VISIT,
          }),
        )
      }
      // Signs: approach then credit on turn arrival is handled if we add seek —
      // use explore toward the hex as a fallback walk.
      else if (target.kind === 'sign') {
        add(
          `quest visit sign @ ${posKey(target.position)}`,
          { kind: 'explore', dest },
          blankFactors({
            safety: safetyAt(session, player.id, dest),
            explore_value: NOTICE_PURSUE_VISIT,
          }),
        )
      }
    }

    // Know Ability: send a hero who can learn it to a world/town library.
    for (const { board, quest } of acceptedQuests) {
      if (quest.category !== 'know_ability' || quest.ability_id == null) {
        continue
      }
      if (playerQuestState(board, player.id).completed) {
        continue
      }
      if (!heroCanLearnQuestAbility(catalog, hero, quest.ability_id)) {
        continue
      }
      for (const feature of session.features ?? []) {
        if (feature.kind !== 'library') {
          continue
        }
        if (!visibleToPlayer(seen, feature.position)) {
          continue
        }
        if (!feature.ability_ids.includes(quest.ability_id)) {
          continue
        }
        const approach = approachHex(
          hero.position,
          feature.position,
          blockedHexes(session, hero, null),
        )
        if (!approach) {
          continue
        }
        add(
          `quest learn ability @ library ${feature.id}`,
          {
            kind: 'seek_library',
            dest: approach,
            featureId: feature.id,
          },
          blankFactors({
            safety: safetyAt(session, player.id, approach),
            learn_ability_value: NOTICE_PURSUE_LEARN,
          }),
        )
      }
    }

    // Bring Units: prefer Recruits buildings when this hero still needs qty.
    for (const { board, quest } of acceptedQuests) {
      if (quest.category !== 'bring_units' || !quest.bring_units) {
        continue
      }
      if (playerQuestState(board, player.id).completed) {
        continue
      }
      const have = bringUnitsQtyOnHero(session, catalog, hero, quest.bring_units)
      if (have >= quest.bring_units.qty) {
        continue
      }
      for (const feature of session.features ?? []) {
        if (feature.kind !== 'recruits') {
          continue
        }
        const known = recruitsKnowledgeFor(feature, player.id)
        if (!known || known.stock < 1) {
          continue
        }
        const unit = unitById(catalog, known.unit_id)
        if (!unit) {
          continue
        }
        const tier = unit.tier ?? 0
        if (tier < quest.bring_units.min_tier) {
          continue
        }
        const approach = approachHex(
          hero.position,
          feature.position,
          blockedHexes(session, hero, null),
        )
        if (!approach) {
          continue
        }
        add(
          `quest bring units via recruits @ ${posKey(feature.position)}`,
          { kind: 'seek_recruits', dest: approach, featureId: feature.id },
          blankFactors({
            safety: safetyAt(session, player.id, approach),
            garrison_value: NOTICE_PURSUE_RECRUIT,
          }),
        )
      }
    }
  }

  const exploreDest = fogFrontier(hero.position)
  if (exploreDest) {
    const reachableLoot = options.some(
      (option) => option.data.kind === 'pickup' || option.data.kind === 'mine',
    )
    add(`explore toward fog @ ${posKey(exploreDest)}`, { kind: 'explore', dest: exploreDest }, blankFactors({
      safety: safetyAt(session, player.id, exploreDest) * (reachableLoot ? 0.35 : 1),
      explore_value: reachableLoot
        ? 0.15
        : Math.max(0.8, exploreValueAt(exploreDest)),
    }))
  }

  const pickupListed = options.filter((option) => option.data.kind === 'pickup').length
  const playerArch = archName(catalog, player.arch_id)
  const heroArch = archName(catalog, hero.arch_id)
  const header = [
    `AI world_move — ${hero.name} (P${player.id.replace('player-', '')})`,
    `  player_arch=${playerArch} hero_arch=${heroArch} blend=${aiHeroBlendBias(catalog).toFixed(2)} jitter=±${aiDecisionJitterPct(catalog)}% T=${aiDecisionTemperature(catalog).toFixed(2)} dist_falloff=1/(1+mp/${maxMp.toFixed(1)})`,
    `  pickups visible=${pickupVisible} fog_hidden=${pickupFog} listed=${pickupListed} no_path=${Math.max(0, pickupVisible - pickupListed)}`,
  ]

  if (options.length === 0) {
    appendAiTrace([...header, '  no reachable options this turn'].join('\n'))
    return null
  }

  // BR S9-11 / S9-13: from day 5, collecting a completed quest overrides
  // every other world goal for this hero.
  const dayOfWeek = session.game.calendar.day
  if (dayOfWeek >= 5) {
    const collectOpts = options.filter(
      (option) =>
        option.data.kind === 'seek_notice_board' &&
        option.data.purpose === 'collect',
    )
    if (collectOpts.length > 0) {
      collectOpts.sort((a, b) => b.score - a.score)
      const forced = collectOpts[0]!
      appendAiTrace(
        [
          ...header,
          `  DAY-5+ COLLECT OVERRIDE → ${forced.label}`,
          ...options.map((option, index) => {
            const mark = option.id === forced.id ? ' ← forced collect' : ''
            return `  ${letter(index)} ${option.label}\n      ${formatFactors(option.factors, option.weights)}  SCORE=${option.score.toFixed(2)}${mark}`
          }),
        ].join('\n'),
      )
      return forced.data
    }
  }

  const pick = pickWeighted(options)
  if (!pick) {
    appendAiTrace([...header, '  pick failed'].join('\n'))
    return null
  }

  const body = options.map((option, index) => {
    const mark = option.id === pick.picked.id ? ' ← chosen' : ''
    const sm = pick.optionWeights[index]?.toFixed(3) ?? '?'
    return `  ${letter(index)} ${option.label}\n      ${formatFactors(option.factors, option.weights)}  SCORE=${option.score.toFixed(2)} softmax=${sm}${mark}`
  })
  appendAiTrace(
    [
      ...header,
      ...body,
      `  roll=${pick.roll.toFixed(3)} / ${pick.weightSum.toFixed(3)} → ${pick.picked.label}`,
    ].join('\n'),
  )
  return pick.picked.data
}
