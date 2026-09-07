import { hexDistance, neighborHexes } from '../hex/pathfinding'
import type { Axial } from '../hex/hero'
import type { GameSession, Hero, Player, Town } from '../session/types'
import { MOB_ARCH_ID } from './types'
import { unitById, unitIsStationary, type ReferenceCatalog } from '../town/catalog'
import {
  applyStrike,
  heroForSide,
  isValidAttackTarget,
  type CombatHeroes,
} from '../combat/attack'
import {
  isHeroStack,
  stackMaxDmg,
  stackMaxHealth,
  stackMinDmg,
  stackMoveSpeed,
  type CombatBattle,
  type CombatStack,
  type CombatTile,
} from '../combat/battle'
import {
  combatReachable,
  footprintSpecFor,
  hexKey,
  moveKindForUnit,
  occupiedForMover,
  stopOnlyForMover,
} from '../combat/movement'
import { isUntargetableStack, openBridgeMoatKeys } from '../combat/siege'
import { actingStand, combatHover, type CombatHover } from '../combat/target'
import {
  COMBAT_ACTION_DECISION,
  COMBAT_ACTION_FACTORS,
  type CombatActionFactor,
  type ScoredOption,
} from './types'
import { appendAiTrace } from './trace'
import {
  archName,
  aiDecisionJitterPct,
  aiDecisionTemperature,
  aiHeroBlendBias,
  finalFactorWeight,
  pickWeighted,
  scoreOption,
} from './weights'

export type CombatAiIntent = CombatHover

type CombatCandidateKind = 'attack' | 'advance' | 'guard'

type CombatCandidate = {
  kind: CombatCandidateKind
  label: string
  intent: CombatHover
}

const MID_ROLL = () => 0.5
const PARTIAL_KILL_SCALE = 0.4

function clamp01(n: number): number {
  if (n < 0) {
    return 0
  }
  if (n > 1) {
    return 1
  }
  return n
}

function letter(index: number): string {
  return String.fromCharCode(65 + (index % 26))
}

function formatFactors(
  factors: Record<string, number>,
  weights: Record<string, number>,
): string {
  return COMBAT_ACTION_FACTORS.map((key) => {
    const f = factors[key] ?? 0
    const w = weights[key] ?? 0
    return `${key}=${f.toFixed(2)}×${w.toFixed(2)}`
  }).join('  ')
}

function stackName(catalog: ReferenceCatalog, stack: CombatStack): string {
  return unitById(catalog, stack.unitId)?.name ?? `unit ${stack.unitId}`
}

function stackCurrentHp(stack: CombatStack, catalog: ReferenceCatalog): number {
  const max = stackMaxHealth(stack, catalog)
  return Math.max(0, (stack.qty - 1) * max + stack.topHealth)
}

function stackHpPct(stack: CombatStack, catalog: ReferenceCatalog): number {
  const cap = stack.qty * stackMaxHealth(stack, catalog)
  if (cap <= 0) {
    return 0
  }
  return clamp01(stackCurrentHp(stack, catalog) / cap)
}

function stackThreat(stack: CombatStack, catalog: ReferenceCatalog): number {
  const avg = (stackMinDmg(stack, catalog) + stackMaxDmg(stack, catalog)) / 2
  return Math.max(0, avg * stack.qty)
}

function livingEnemies(
  stack: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
): CombatStack[] {
  return battle.stacks.filter(
    (row) =>
      row.side !== stack.side &&
      row.qty > 0 &&
      !isHeroStack(row) &&
      !isUntargetableStack(row, catalog),
  )
}

function reachableOf(
  stack: CombatStack,
  battle: CombatBattle,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
): Map<string, Axial[]> {
  const unit = unitById(catalog, stack.unitId)
  const kind = moveKindForUnit(unit, catalog)
  const occupied = occupiedForMover(battle.stacks, catalog, stack.id, kind)
  const budget = unitIsStationary(unit)
    ? 0
    : (stackMoveSpeed(stack, catalog) ?? 0)
  const from = { q: stack.q, r: stack.r }
  const spec = footprintSpecFor(stack, catalog)
  const passableMoat = openBridgeMoatKeys(battle, catalog, tiles)
  const stopOnly = stopOnlyForMover(battle, catalog, tiles, kind)
  return combatReachable(
    from,
    budget,
    tiles,
    kind,
    occupied,
    spec,
    passableMoat,
    stopOnly,
  )
}

function canReachMeleeNextTurn(
  enemy: CombatStack,
  ally: CombatStack,
  battle: CombatBattle,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
): boolean {
  if (enemy.qty <= 0 || enemy.side === ally.side || isHeroStack(enemy)) {
    return false
  }
  if (hexDistance(enemy, ally) <= 1) {
    return true
  }
  const unit = unitById(catalog, enemy.unitId)
  if (unitIsStationary(unit)) {
    return false
  }
  const reachable = reachableOf(enemy, battle, tiles, catalog)
  return neighborHexes(ally).some((hex) => reachable.has(hexKey(hex.q, hex.r)))
}

function killPotential(
  attacker: CombatStack,
  target: CombatStack,
  stand: Axial,
  catalog: ReferenceCatalog,
  heroes: CombatHeroes,
): number {
  const ghost = { ...attacker, q: stand.q, r: stand.r }
  const struck = applyStrike(
    ghost,
    target,
    catalog,
    MID_ROLL,
    100,
    false,
    heroForSide(target.side, heroes),
    heroForSide(attacker.side, heroes),
  )
  if (!struck.stack || struck.stack.qty <= 0) {
    return 1
  }
  const before = stackCurrentHp(target, catalog)
  if (before <= 0) {
    return 0
  }
  const after = stackCurrentHp(struck.stack, catalog)
  return clamp01(((before - after) / before) * PARTIAL_KILL_SCALE)
}

function emptyFactors(): Record<CombatActionFactor, number> {
  return {
    kill_potential: 0,
    target_weakness: 0,
    target_threat: 0,
    protect_ally: 0,
  }
}

export function mobCombatPlayer(): Player {
  return {
    id: 'mob',
    is_ai: true,
    ai_spectator: false,
    arch_id: MOB_ARCH_ID,
    eliminated: false,
    resources: {},
    hero_ids: [],
    town_ids: [],
    explored: [],
  }
}

export function combatOwnerPlayer(
  stack: CombatStack,
  session: GameSession,
  attacker?: Hero,
  defender?: Hero,
  siegeTown?: Town,
  defenderMobId?: string | null,
): Player | null {
  if (stack.side === 'def' && defenderMobId) {
    return mobCombatPlayer()
  }
  const playerId =
    stack.side === 'atk'
      ? attacker?.player_id
      : (defender?.player_id ?? siegeTown?.player_id)
  if (!playerId) {
    return null
  }
  return session.players.find((row) => row.id === playerId) ?? null
}

function guardHex(
  ally: CombatStack,
  threat: CombatStack,
  reachable: Map<string, Axial[]>,
): Axial | null {
  let best: Axial | null = null
  let bestSteps = Infinity
  let bestThreatDist = Infinity
  for (const hex of neighborHexes(ally)) {
    const key = hexKey(hex.q, hex.r)
    const steps = reachable.get(key)
    if (steps == null) {
      continue
    }
    const threatDist = hexDistance(hex, threat)
    if (
      steps.length < bestSteps ||
      (steps.length === bestSteps && threatDist < bestThreatDist)
    ) {
      best = hex
      bestSteps = steps.length
      bestThreatDist = threatDist
    }
  }
  return best
}

function hoverIsAction(intent: CombatHover | null): intent is CombatHover {
  return (
    intent != null &&
    (intent.fire ||
      intent.afterMove === 'pulse' ||
      intent.steps.length > 0)
  )
}

export function decideCombatAction(
  stack: CombatStack,
  battle: CombatBattle,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
  player: Player,
  hero: Hero | null | undefined,
  heroes: CombatHeroes,
): CombatAiIntent | null {
  if (isHeroStack(stack)) {
    appendAiTrace(`AI combat_action — ${stack.heroId ?? stack.id} waits (no unit action)`)
    return null
  }

  const weights: Record<string, number> = {}
  for (const factor of COMBAT_ACTION_FACTORS) {
    weights[factor] = finalFactorWeight(
      player,
      hero,
      COMBAT_ACTION_DECISION,
      factor,
      catalog,
    )
  }

  const enemies = livingEnemies(stack, battle, catalog)
  const maxThreat = Math.max(0, ...enemies.map((row) => stackThreat(row, catalog)))
  const inRange = enemies.filter((row) =>
    isValidAttackTarget(stack, row, catalog, tiles, battle.stacks),
  )

  const options: ScoredOption<CombatCandidate>[] = []
  const add = (
    id: string,
    candidate: CombatCandidate,
    factors: Record<CombatActionFactor, number>,
  ) => {
    options.push({
      id,
      label: candidate.label,
      factors,
      weights,
      score: scoreOption(factors, weights),
      data: candidate,
    })
  }

  const scoreEnemy = (enemy: CombatStack, intent: CombatHover, kind: CombatCandidateKind) => {
    const stand = actingStand({ q: stack.q, r: stack.r }, intent.steps)
    const canHit = intent.fire === true || intent.afterMove === 'pulse'
    const factors = emptyFactors()
    factors.kill_potential = canHit
      ? killPotential(stack, enemy, stand, catalog, heroes)
      : 0
    factors.target_weakness = 1 - stackHpPct(enemy, catalog)
    factors.target_threat = maxThreat > 0 ? clamp01(stackThreat(enemy, catalog) / maxThreat) : 0
    const verb =
      kind === 'attack'
        ? 'attack'
        : canHit
          ? 'move+attack'
          : 'advance toward'
    add(`${kind}:${enemy.id}`, {
      kind,
      label: `${verb} ${enemy.qty} ${stackName(catalog, enemy)}`,
      intent,
    }, factors)
  }

  if (inRange.length > 0) {
    for (const enemy of inRange) {
      const intent = combatHover(
        stack,
        { q: enemy.q, r: enemy.r },
        battle,
        tiles,
        catalog,
        'center',
      )
      if (!intent || !intent.fire) {
        continue
      }
      scoreEnemy(enemy, intent, 'attack')
    }
  } else {
    for (const enemy of enemies) {
      const intent = combatHover(
        stack,
        { q: enemy.q, r: enemy.r },
        battle,
        tiles,
        catalog,
        'center',
      )
      if (!hoverIsAction(intent)) {
        continue
      }
      scoreEnemy(enemy, intent, 'advance')
    }

    const reachable = reachableOf(stack, battle, tiles, catalog)
    const allies = battle.stacks.filter(
      (row) =>
        row.id !== stack.id &&
        row.side === stack.side &&
        row.qty > 0 &&
        !isHeroStack(row) &&
        (unitById(catalog, row.unitId)?.min_range ?? 0) >= 2,
    )
    for (const ally of allies) {
      const threats = enemies.filter((enemy) =>
        canReachMeleeNextTurn(enemy, ally, battle, tiles, catalog),
      )
      if (threats.length === 0) {
        continue
      }
      threats.sort(
        (a, b) => hexDistance(a, ally) - hexDistance(b, ally),
      )
      const nearest = threats[0]!
      const dest = guardHex(ally, nearest, reachable)
      if (!dest) {
        continue
      }
      const steps = reachable.get(hexKey(dest.q, dest.r)) ?? []
      const factors = emptyFactors()
      factors.protect_ally = 1
      add(`guard:${ally.id}`, {
        kind: 'guard',
        label: `guard ${ally.qty} ${stackName(catalog, ally)}`,
        intent: {
          icon: 'move',
          q: dest.q,
          r: dest.r,
          steps,
          attackTargetId: null,
          fire: false,
          afterMove: null,
          impactKeys: [],
        },
      }, factors)
    }
  }

  const playerArch = archName(catalog, player.arch_id)
  const heroArch = archName(catalog, hero?.arch_id)
  const header = [
    `AI combat_action — ${stack.qty} ${stackName(catalog, stack)} (P${player.id.replace('player-', '')})`,
    `  player_arch=${playerArch} hero_arch=${heroArch} blend=${aiHeroBlendBias(catalog).toFixed(2)} jitter=±${aiDecisionJitterPct(catalog)}% T=${aiDecisionTemperature(catalog).toFixed(2)}`,
    `  in_range=${inRange.length} enemies=${enemies.length}`,
  ]

  if (options.length === 0) {
    appendAiTrace([...header, '  no combat options this turn'].join('\n'))
    return null
  }

  const pick = pickWeighted(options, catalog)
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
  return pick.picked.data.intent
}
