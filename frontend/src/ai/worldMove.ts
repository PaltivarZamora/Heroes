import { findPath, hexDistance, neighborHexes, approachHex } from '../hex/pathfinding'
import { forEachPassableHex, getTile, isExplored, restoreExplored } from '../hex/world'
import type { Axial } from '../hex/hero'
import {
  getCachedCatalog,
  heroMovementPoints,
  type ReferenceCatalog,
  type ResourceRow,
} from '../town/catalog'
import type { GameSession, Hero, Player, Town } from '../session/types'
import { appendAiTrace } from './trace'
import { garrisonArmyValue, slotsArmyValue } from './armyAlloc'
import { firstAffordableLearn } from './libraryLearn'
import { mobLabel } from '../session/mobs'
import { visitingHeroId } from '../session/accessors'
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
  | { kind: 'return'; dest: Axial; townId: string }
  | { kind: 'capture'; dest: Axial; townId: string }
  | { kind: 'seek_library'; dest: Axial; townId: string }
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
    add(hero.position.q, hero.position.r)
  }
  for (const town of session.towns) {
    const enemyOwned =
      town.player_id != null && town.player_id !== mover.player_id
    if (enemyOwned) {
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
  for (const mob of session.mobs) {
    add(mob.position.q, mob.position.r)
  }
  return blocked
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
  const firstCost = getTile(path[1].q, path[1].r)?.movementCostMultiplier
  if (firstCost == null || hero.movement_remaining + 1e-9 < firstCost) {
    return null
  }
  let cost = 0
  for (let i = 1; i < path.length; i += 1) {
    const step = getTile(path[i].q, path[i].r)?.movementCostMultiplier
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
  const maxMp = heroMovementPoints(catalog, hero)
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
      add(
        `pickup ${resourceName(catalog, node.resource_id)} @ ${posKey(node.position)}`,
        {
          kind: 'pickup',
          dest: node.position,
          nodeId: node.id,
          resourceId: node.resource_id,
        },
        blankFactors({
          safety: safetyAt(session, player.id, node.position),
          resource_value: resourceValue(catalog, node.resource_id, 'pickup'),
          explore_value: exploreValueAt(node.position) * 0.4,
        }),
      )
      continue
    }
    if (node.player_id != null) {
      continue
    }
    add(
      `mine ${resourceName(catalog, node.resource_id)} @ ${posKey(node.position)}`,
      {
        kind: 'mine',
        dest: node.position,
        nodeId: node.id,
        resourceId: node.resource_id,
      },
      blankFactors({
        safety: safetyAt(session, player.id, node.position),
        resource_value: resourceValue(catalog, node.resource_id, 'mine'),
        explore_value: exploreValueAt(node.position) * 0.25,
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
          add(
            `seek library ${town.name} @ ${posKey(town.position)} (${ability.name})`,
            {
              kind: 'seek_library',
              dest: town.position,
              townId: town.id,
            },
            blankFactors({
              safety: safetyAt(session, player.id, town.position),
              learn_ability_value: 1,
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
      considerAttack(
        `attack ${town.name}`,
        town.position,
        garrisonArmyValue(session, catalog, town) + occupantValue,
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

  for (const other of session.heroes) {
    if (other.id === hero.id || other.player_id === player.id) {
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
    considerAttack(
      `attack ${mobLabel(session, catalog, mob)}`,
      mob.position,
      slotsArmyValue(session, catalog, mob.slots_1_to_6),
      { type: 'mob', mobId: mob.id },
    )
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
