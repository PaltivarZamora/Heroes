import { aiFleeRatio } from '../ai/weights'
import { appendAiTrace } from '../ai/trace'
import { hexDistance, neighborHexes } from '../hex/pathfinding'
import { findPath } from '../hex/pathfinding'
import { GOLD_RESOURCE_ID } from '../hex/resources'
import { isExplored } from '../hex/world'
import { isPassable, getTile } from '../hex/world'
import { visitingHeroId } from '../session/accessors'
import type { GameSession, Hero, Town } from '../session/types'
import {
  combatConfigNumber,
  combatConfigRollPercent,
  type ReferenceCatalog,
} from '../town/catalog'
import { unitById } from '../town/catalog'
import type { CombatBattle, CombatSide } from './battle'
import { isHeroStack } from './battle'
import { isCreatureArmyUnit } from './siege'
import { partsArmyValue, type XpValuePart } from '../session/xp'

export type CombatEscapeKind = 'flee' | 'surrender'

export type CostMap = Record<number, number>

function posKey(position: { q: number; r: number }): string {
  return `${position.q},${position.r}`
}

function isMapEdgeHex(q: number, r: number): boolean {
  for (const n of neighborHexes({ q, r })) {
    if (!getTile(n.q, n.r)) {
      return true
    }
  }
  return false
}

function pathBlockedHexes(session: GameSession, mover: Hero): Set<string> {
  const blocked = new Set<string>()
  const add = (q: number, r: number) => {
    if (q === mover.position.q && r === mover.position.r) {
      return
    }
    if (!isExplored(q, r)) {
      return
    }
    blocked.add(posKey({ q, r }))
  }
  for (const hero of session.heroes) {
    if (hero.flight || hero.id === mover.id) {
      continue
    }
    add(hero.position.q, hero.position.r)
  }
  for (const town of session.towns) {
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
  return blocked
}

function townHeroSlotFree(
  session: GameSession,
  town: Town,
  playerId: string,
  exceptHeroId: string,
): boolean {
  if (town.player_id !== playerId) {
    return false
  }
  const occupantId = visitingHeroId(session, town)
  if (!occupantId || occupantId === exceptHeroId) {
    return true
  }
  const occupant = session.heroes.find((row) => row.id === occupantId)
  return occupant == null || occupant.player_id !== playerId
}

function findWalkableOutsideTown(
  townPos: { q: number; r: number },
  occupied: Set<string>,
): { q: number; r: number } | null {
  const tryHex = (hex: { q: number; r: number }): boolean => {
    const key = posKey(hex)
    return (
      isPassable(hex.q, hex.r) &&
      !occupied.has(key) &&
      !isMapEdgeHex(hex.q, hex.r)
    )
  }
  const ring1 = neighborHexes(townPos)
  for (const hex of ring1) {
    if (tryHex(hex)) {
      return hex
    }
  }
  const seen = new Set<string>([posKey(townPos), ...ring1.map(posKey)])
  let frontier = ring1.flatMap((hex) => neighborHexes(hex))
  for (let dist = 2; dist <= 6; dist += 1) {
    const nextFrontier: { q: number; r: number }[] = []
    for (const hex of frontier) {
      const key = posKey(hex)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      if (tryHex(hex)) {
        return hex
      }
      nextFrontier.push(...neighborHexes(hex))
    }
    frontier = nextFrontier
  }
  return null
}

export function nearestFriendlyTown(
  session: GameSession,
  hero: Hero,
): Town | null {
  const owned = session.towns.filter((town) => town.player_id === hero.player_id)
  if (owned.length === 0) {
    return null
  }
  const blocked = pathBlockedHexes(session, hero)
  const from = hero.position
  let best: Town | null = null
  let bestPath = Infinity
  let bestLine = Infinity
  for (const town of owned) {
    const path = findPath(from, town.position, blocked, false)
    const steps = path ? Math.max(0, path.length - 1) : Infinity
    const line = hexDistance(from, town.position)
    if (
      steps < bestPath ||
      (steps === bestPath && line < bestLine) ||
      (steps === bestPath && line === bestLine && best && town.name < best.name)
    ) {
      bestPath = steps
      bestLine = line
      best = town
    }
  }
  return best
}

export function placementAfterEscape(
  session: GameSession,
  hero: Hero,
  town: Town,
): { q: number; r: number } {
  const occupied = new Set<string>()
  for (const other of session.heroes) {
    if (other.id === hero.id || other.flight) {
      continue
    }
    occupied.add(posKey(other.position))
  }
  if (townHeroSlotFree(session, town, hero.player_id, hero.id)) {
    return { ...town.position }
  }
  const outside = findWalkableOutsideTown(town.position, occupied)
  return outside ?? { ...town.position }
}

export function playerOwnsFriendlyTown(
  session: GameSession,
  playerId: string,
): boolean {
  return session.towns.some((town) => town.player_id === playerId)
}

/** True when this side is the siege defender (no flee / surrender). */
export function isSiegeDefenceSide(
  side: CombatSide,
  siegeTownId: string | null | undefined,
): boolean {
  return Boolean(siegeTownId) && side === 'def'
}

function livingCreatureParts(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  side: CombatSide,
): XpValuePart[] {
  const parts: XpValuePart[] = []
  for (const stack of battle.stacks) {
    if (
      stack.side !== side ||
      stack.qty <= 0 ||
      isHeroStack(stack) ||
      !isCreatureArmyUnit(unitById(catalog, stack.unitId))
    ) {
      continue
    }
    parts.push({ unitId: stack.unitId, qty: stack.qty })
  }
  return parts
}

export function sideArmyValueInBattle(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  side: CombatSide,
): number {
  return partsArmyValue(catalog, livingCreatureParts(battle, catalog, side))
}

export function baseSurrenderOfferGold(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  side: CombatSide,
): number {
  const armyValue = sideArmyValueInBattle(battle, catalog, side)
  const pct = combatConfigNumber(catalog, 'surrender_cost_pct', 50) / 100
  const raw = armyValue * pct
  return Math.max(0, Math.round(raw / 10) * 10)
}

export function escalateSurrenderOffer(
  catalog: ReferenceCatalog,
  previousGold: number,
  random: () => number,
): number {
  const bumpPct = combatConfigRollPercent(
    catalog,
    'surrender_escalate_pct',
    40,
    random,
  )
  return Math.max(0, Math.round((previousGold * (1 + bumpPct / 100)) / 10) * 10)
}

export function surrenderCostMap(
  goldAmount: number,
): CostMap {
  return { [GOLD_RESOURCE_ID]: Math.max(0, Math.floor(goldAmount)) }
}

export function playerGoldStockpile(
  session: GameSession,
  playerId: string,
): number {
  const player = session.players.find((row) => row.id === playerId)
  return Math.max(0, Math.floor(player?.resources[GOLD_RESOURCE_ID] ?? 0))
}

export function cappedSurrenderGold(
  session: GameSession,
  playerId: string,
  gold: number,
): number {
  return Math.min(gold, playerGoldStockpile(session, playerId))
}

export function applyFleeLossesToBattle(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  fleeingSide: CombatSide,
  random: () => number,
): CombatBattle {
  const stacks = battle.stacks.map((stack) => {
    if (
      stack.side !== fleeingSide ||
      stack.qty <= 0 ||
      isHeroStack(stack) ||
      stack.summonSeq != null
    ) {
      return stack
    }
    const lossPct = combatConfigRollPercent(
      catalog,
      'flee_loss_pct',
      75,
      random,
    )
    const lost = Math.floor(stack.qty * (lossPct / 100))
    const nextQty = Math.max(0, stack.qty - lost)
    if (nextQty <= 0) {
      return { ...stack, qty: 0, topHealth: 0 }
    }
    const maxHp = unitById(catalog, stack.unitId)?.health ?? stack.topHealth
    return {
      ...stack,
      qty: nextQty,
      topHealth: Math.min(stack.topHealth, maxHp),
    }
  })
  return { ...battle, stacks }
}

export function aiAcceptsSurrenderOffer(
  catalog: ReferenceCatalog,
  battle: CombatBattle,
  acceptingSide: CombatSide,
  offeredGold: number,
): boolean {
  const enemySide: CombatSide = acceptingSide === 'atk' ? 'def' : 'atk'
  const enemyRemain = sideArmyValueInBattle(battle, catalog, enemySide)
  const ownRemain = sideArmyValueInBattle(battle, catalog, acceptingSide)
  const expectedGain = enemyRemain - ownRemain
  const accept = offeredGold >= expectedGain
  appendAiTrace(
    `AI combat_surrender — side=${acceptingSide} offer=${offeredGold} expectedGain=${expectedGain.toFixed(0)} (${enemyRemain.toFixed(0)} enemy − ${ownRemain.toFixed(0)} own) → ${accept ? 'accept' : 'decline'}`,
  )
  return accept
}

export function aiShouldTryCombatEscape(
  catalog: ReferenceCatalog,
  battle: CombatBattle,
  side: CombatSide,
): boolean {
  const enemySide: CombatSide = side === 'atk' ? 'def' : 'atk'
  const own = sideArmyValueInBattle(battle, catalog, side)
  const enemy = sideArmyValueInBattle(battle, catalog, enemySide)
  if (!(enemy > 0)) {
    return false
  }
  const ratio = aiFleeRatio(catalog)
  return own < ratio * enemy
}

export function aiPrefersSurrenderOverFlee(
  hero: Hero | null | undefined,
): boolean {
  return (hero?.current_level ?? 1) >= 5
}

export function canAffordCost(
  session: GameSession,
  playerId: string,
  cost: CostMap,
): boolean {
  const gold = cost[GOLD_RESOURCE_ID] ?? 0
  return playerGoldStockpile(session, playerId) >= gold
}
