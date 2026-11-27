import type { Axial } from '../hex/hero'
import { hexDistance } from '../hex/pathfinding'
import { hexKey } from './movement'
import type { ReferenceCatalog } from '../town/catalog'
import { unitAttackShape, unitById } from '../town/catalog'
import { stackMaxRange, stackMinDmg } from './battle'
import type { CombatBattle, CombatStack, CombatTile } from './battle'
import { boardKeys, clipHexesAtLosBlocker, lineHexesToRange } from './shapes'
import { occupancyKey } from './occupancy'

import type { ShapeHit } from './shapes'

function keyOf(hex: { q: number; r: number }): string {
  return occupancyKey(hex.q, hex.r)
}
import {
  combatCanLandOn,
  combatEnterCost,
  footprintSpecFor,
  groundEffectMovementBlockKeys,
  landingOccupiedForMover,
  moveKindForUnit,
  stopOnlyForMover,
} from './movement'
import {
  footprintFits,
  stackFootprint,
  stacksOccupyingHex,
} from './occupancy'
import { openBridgeMoatKeys } from './siege'
import { isUntargetableStack } from './siege'
import { tombstoneOccupancyBodies } from './tombstone'
import { applyStandingHazards } from './hazards'
import {
  tryLeaveGroundEffectOnMoveStep,
  tryTriggerGroundEffectsOnEnter,
} from './groundEffect'
import { isStunned } from './condition'
import { actionOriginFootprintHex } from './actionOrigin'
import { appendBattleAnimCombatLog } from './battleAnimLogBridge'

export type ChargeLinePlanHit = {
  stack: CombatStack
  hex: Axial
  hexesTravelled: number
  flatPerCreature: number
  dmgPct: number
  /** 1-based slide leg index when strike display should fire (hex beside victim). */
  slidePauseAfterLeg: number
}

export type ChargeLinePlan = {
  /** Geometric pierce line (LoS-clipped), same as beam corridor preview. */
  lineHexes: Axial[]
  /** Anchor positions along the charge (start → end). */
  waypoints: Axial[]
  endAnchor: Axial
  hits: ChargeLinePlanHit[]
}

function tileMap(
  tiles: CombatTile[],
): Map<string, CombatTile> {
  return new Map(tiles.map((tile) => [hexKey(tile.q, tile.r), tile]))
}

function canLandAnchor(
  anchor: Axial,
  attacker: CombatStack,
  battle: CombatBattle,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
): boolean {
  const unit = unitById(catalog, attacker.unitId)
  const kind = moveKindForUnit(unit, catalog)
  const tombs = tombstoneOccupancyBodies(battle.tombstones, catalog)
  const landOccupied = landingOccupiedForMover(
    battle.stacks,
    catalog,
    attacker.id,
    tombs,
  )
  const passable = openBridgeMoatKeys(battle, catalog, tiles)
  const geBlocks = groundEffectMovementBlockKeys(battle)
  const spec = footprintSpecFor(attacker, catalog)
  const tilesByKey = tileMap(tiles)
  const landCost = (q: number, r: number): number | null => {
    const tile = tilesByKey.get(hexKey(q, r))
    if (!combatCanLandOn(tile, kind, passable, geBlocks)) {
      return null
    }
    return combatEnterCost(tile, kind, passable, geBlocks)
  }
  return footprintFits(
    anchor,
    spec.code,
    spec.along,
    landOccupied,
    landCost,
    spec.ignore,
  )
}

function terrainBlocksChargeHex(
  hex: Axial,
  attacker: CombatStack,
  battle: CombatBattle,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
  stopOnly: ReadonlySet<string>,
): boolean {
  const key = hexKey(hex.q, hex.r)
  if (stopOnly.has(key)) {
    return true
  }
  const unit = unitById(catalog, attacker.unitId)
  const kind = moveKindForUnit(unit, catalog)
  const passable = openBridgeMoatKeys(battle, catalog, tiles)
  const geBlocks = groundEffectMovementBlockKeys(battle)
  const tile = tileMap(tiles).get(key)
  return !combatCanLandOn(tile, kind, passable, geBlocks)
}

function enteringFootprintHexes(
  fromAnchor: Axial,
  toAnchor: Axial,
  attacker: CombatStack,
  catalog: ReferenceCatalog,
): Axial[] {
  const bodyFrom = { ...attacker, q: fromAnchor.q, r: fromAnchor.r }
  const bodyTo = { ...attacker, q: toAnchor.q, r: toAnchor.r }
  const fromKeys = new Set(
    stackFootprint(bodyFrom, catalog).map((hex) => keyOf(hex)),
  )
  return stackFootprint(bodyTo, catalog).filter(
    (hex) => !fromKeys.has(keyOf(hex)),
  )
}

function liveEnemyOnHex(
  hex: Axial,
  attacker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
): CombatStack | null {
  for (const stack of stacksOccupyingHex(
    battle.stacks,
    hex.q,
    hex.r,
    catalog,
  )) {
    if (
      stack.id === attacker.id ||
      stack.qty <= 0 ||
      stack.side === attacker.side ||
      isUntargetableStack(stack, catalog)
    ) {
      continue
    }
    return stack
  }
  return null
}

function allyOccupiesHex(
  hex: Axial,
  attacker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
): boolean {
  for (const stack of stacksOccupyingHex(
    battle.stacks,
    hex.q,
    hex.r,
    catalog,
  )) {
    if (stack.id === attacker.id || stack.qty <= 0) {
      continue
    }
    if (stack.side === attacker.side) {
      return true
    }
  }
  return false
}

/** Footprint hex the pierce line starts from (2×1 etc.) — one rule for preview and resolve. */
export function chargeLineOriginHex(
  standAnchor: Axial,
  attacker: CombatStack,
  catalog: ReferenceCatalog,
  aimHex: Axial,
  wedgeZone?: number | null,
): Axial {
  const ghost = { ...attacker, q: standAnchor.q, r: standAnchor.r }
  return actionOriginFootprintHex(
    standAnchor,
    ghost,
    catalog,
    aimHex,
    wedgeZone,
  )
}

export function buildChargeLinePlanForAttack(
  standAnchor: Axial,
  aimHex: Axial,
  attacker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  wedgeZone?: number | null,
): ChargeLinePlan | null {
  const ghost = { ...attacker, q: standAnchor.q, r: standAnchor.r }
  const origin = chargeLineOriginHex(
    standAnchor,
    attacker,
    catalog,
    aimHex,
    wedgeZone,
  )
  return buildChargeLinePlan(
    standAnchor,
    origin,
    aimHex,
    ghost,
    battle,
    catalog,
    tiles,
  )
}

/**
 * charge_line delivery: target must appear in the simulated roll plan.
 * Replaces generic min/max hex distance for this shape.
 */
export function chargeLineCanHitAtStand(
  standAnchor: Axial,
  aimHex: Axial,
  attacker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  targetId: string | null | undefined,
  wedgeZone?: number | null,
): boolean {
  const plan = buildChargeLinePlanForAttack(
    standAnchor,
    aimHex,
    attacker,
    battle,
    catalog,
    tiles,
    wedgeZone,
  )
  if (!plan || plan.hits.length === 0) {
    return false
  }
  return targetReachableOnChargePlan(plan, targetId)
}

export function logChargeLineResolveReject(opts: {
  unitName: string
  stand: Axial
  origin: Axial
  aim: Axial
  targetId: string | null | undefined
  plan: ChargeLinePlan | null
  reason: string
}): void {
  const hitIds = (opts.plan?.hits ?? [])
    .map((row) => row.stack.id)
    .join(',')
  appendBattleAnimCombatLog(
    `[Dev] charge_line resolve reject (${opts.unitName}): ${opts.reason}; stand=${opts.stand.q},${opts.stand.r} origin=${opts.origin.q},${opts.origin.r} aim=${opts.aim.q},${opts.aim.r} target=${opts.targetId ?? 'none'} planHits=[${hitIds || 'none'}]`,
  )
}

export function chargeLineHexesFromCommit(
  origin: Axial,
  aimHex: Axial,
  attacker: CombatStack,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): Axial[] {
  const spec = unitAttackShape(unitById(catalog, attacker.unitId))
  if (spec.shape !== 'charge_line') {
    return []
  }
  const board = boardKeys(tiles)
  const maxRange = stackMaxRange(attacker, catalog)
  return lineHexesToRange(origin, aimHex, maxRange, board)
}

/** Frozen roll path, hits, and end anchor from one commit (preview = resolve = anim). */
export function buildChargeLinePlan(
  standAnchor: Axial,
  origin: Axial,
  aimHex: Axial,
  attacker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): ChargeLinePlan | null {
  const spec = unitAttackShape(unitById(catalog, attacker.unitId))
  if (spec.shape !== 'charge_line') {
    return null
  }
  const maxRange = stackMaxRange(attacker, catalog)
  const rawLine = chargeLineHexesFromCommit(
    origin,
    aimHex,
    attacker,
    catalog,
    tiles,
  )
  const lineHexes = clipHexesAtLosBlocker(
    rawLine,
    tiles,
    battle.stacks,
    catalog,
    origin,
  )
  if (lineHexes.length === 0) {
    return null
  }
  const unit = unitById(catalog, attacker.unitId)
  const kind = moveKindForUnit(unit, catalog)
  const stopOnly = stopOnlyForMover(battle, catalog, tiles, kind)
  const perHex = Math.max(1, spec.dmgIncreasePerHex ?? 1)
  const minDmg = Math.max(0, stackMinDmg(attacker, catalog))

  let anchor = { ...standAnchor }
  const waypoints: Axial[] = [{ ...anchor }]
  const hits: ChargeLinePlanHit[] = []
  const victimIds = new Set<string>()

  for (let li = 0; li < lineHexes.length; li += 1) {
    const stepAnchor = lineHexes[li]!
    if (terrainBlocksChargeHex(stepAnchor, attacker, battle, tiles, catalog, stopOnly)) {
      break
    }
  const entering = enteringFootprintHexes(anchor, stepAnchor, attacker, catalog)
    for (const hex of entering) {
      if (allyOccupiesHex(hex, attacker, battle, catalog)) {
        li = lineHexes.length
        break
      }
    }
    if (li >= lineHexes.length) {
      break
    }

    let hitEnemy: CombatStack | null = null
    let hitHex: Axial | null = null
    for (const hex of entering) {
      const enemy = liveEnemyOnHex(hex, attacker, battle, catalog)
      if (enemy) {
        hitEnemy = enemy
        hitHex = hex
        break
      }
    }

    const travelled = li + 1

    if (hitEnemy && hitHex) {
      let passed = false
      for (let j = li + 1; j < lineHexes.length; j += 1) {
        const pastAnchor = lineHexes[j]!
        if (
          terrainBlocksChargeHex(
            pastAnchor,
            attacker,
            battle,
            tiles,
            catalog,
            stopOnly,
          )
        ) {
          break
        }
        const pastEntering = enteringFootprintHexes(
          anchor,
          pastAnchor,
          attacker,
          catalog,
        )
        let blocked = false
        for (const hex of pastEntering) {
          if (allyOccupiesHex(hex, attacker, battle, catalog)) {
            blocked = true
            break
          }
          if (liveEnemyOnHex(hex, attacker, battle, catalog)) {
            blocked = true
            break
          }
        }
        if (blocked) {
          break
        }
        if (!canLandAnchor(pastAnchor, attacker, battle, tiles, catalog)) {
          break
        }
        anchor = pastAnchor
        waypoints.push({ ...anchor })
        passed = true
        li = j
        break
      }
      if (!victimIds.has(hitEnemy.id)) {
        victimIds.add(hitEnemy.id)
        const slidePauseAfterLeg = passed
          ? Math.max(1, waypoints.length - 1)
          : travelled
        hits.push({
          stack: hitEnemy,
          hex: hitHex,
          hexesTravelled: travelled,
          flatPerCreature: minDmg + travelled * perHex,
          dmgPct: 100,
          slidePauseAfterLeg,
        })
      }
      if (!passed) {
        break
      }
    } else {
      if (!canLandAnchor(stepAnchor, attacker, battle, tiles, catalog)) {
        break
      }
      anchor = stepAnchor
      waypoints.push({ ...anchor })
    }

    if (hexDistance(origin, stepAnchor) >= maxRange) {
      break
    }
  }

  return {
    lineHexes,
    waypoints,
    endAnchor: anchor,
    hits,
  }
}

export function chargePlanShapeHits(plan: ChargeLinePlan): ShapeHit[] {
  return plan.hits.map((row) => ({
    hex: row.hex,
    stack: row.stack,
    dmgPct: row.dmgPct,
    flatPerCreature: row.flatPerCreature,
  }))
}

export function chargePathPreviewKeys(plan: ChargeLinePlan): string[] {
  const keys: string[] = []
  for (let i = 0; i < plan.waypoints.length - 1; i += 1) {
    const wp = plan.waypoints[i + 1]!
    keys.push(keyOf(wp))
  }
  return keys
}

export function chargeGhostFootprintKeys(
  plan: ChargeLinePlan,
  attacker: CombatStack,
  catalog: ReferenceCatalog,
): string[] {
  const body = {
    ...attacker,
    q: plan.endAnchor.q,
    r: plan.endAnchor.r,
  }
  return stackFootprint(body, catalog).map((hex) => keyOf(hex))
}

export function chargeVictimImpactKeys(plan: ChargeLinePlan): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const hit of plan.hits) {
    const key = keyOf(hit.hex)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    keys.push(key)
  }
  return keys
}

export function targetReachableOnChargePlan(
  plan: ChargeLinePlan,
  targetId: string | null | undefined,
): boolean {
  if (!targetId) {
    return plan.hits.length > 0
  }
  return plan.hits.some((row) => row.stack.id === targetId)
}

/** Advance the charger along frozen waypoints; ground effects and hazards per hex entered. */
export function applyChargeLineMovement(
  battle: CombatBattle,
  attackerId: string,
  plan: ChargeLinePlan,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  heroes?: Parameters<typeof tryTriggerGroundEffectsOnEnter>[4],
  random: () => number = Math.random,
): {
  battle: CombatBattle
  lines: string[]
  hitKeys: string[]
  stoppedEarly: boolean
} {
  const lines: string[] = []
  const hitKeys: string[] = []
  let latest = battle
  let stoppedEarly = false
  if (plan.waypoints.length <= 1) {
    return { battle: latest, lines, hitKeys, stoppedEarly }
  }
  for (let i = 1; i < plan.waypoints.length; i += 1) {
    const step = plan.waypoints[i]!
    latest = {
      ...latest,
      stacks: latest.stacks.map((row) =>
        row.id === attackerId ? { ...row, q: step.q, r: step.r } : row,
      ),
    }
    const left = tryLeaveGroundEffectOnMoveStep(
      latest,
      attackerId,
      catalog,
      step,
      tiles,
    )
    latest = left.battle
    lines.push(...left.lines)
    const boom = tryTriggerGroundEffectsOnEnter(
      latest,
      attackerId,
      catalog,
      tiles,
      heroes,
      random,
    )
    latest = boom.battle
    lines.push(...boom.lines)
    hitKeys.push(...boom.hitKeys)
    const hazard = applyStandingHazards(
      latest,
      attackerId,
      catalog,
      tiles,
      heroes,
    )
    latest = hazard.battle
    lines.push(...hazard.lines)
    hitKeys.push(...hazard.hitKeys)
    const walker = latest.stacks.find((row) => row.id === attackerId)
    if (!walker || walker.qty <= 0) {
      stoppedEarly = true
      break
    }
    if (isStunned(walker, catalog)) {
      stoppedEarly = true
      break
    }
  }
  return { battle: latest, lines, hitKeys, stoppedEarly }
}