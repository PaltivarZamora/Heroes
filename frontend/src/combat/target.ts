import type { Axial } from '../hex/hero'
import { hexDistance } from '../hex/pathfinding'
import type { ReferenceCatalog } from '../town/catalog'
import {
  shapeIsUntargeted,
  shapePulsesOnMove,
  unitAttackShape,
  unitAutoTarget,
  unitById,
  unitIsStationary,
} from '../town/catalog'
import {
  attackIconFor,
  attackRangeFrom,
  isValidAttackTarget,
  type AttackIconKind,
  type CombatHeroes,
} from './attack'
import type { CombatBattle, CombatStack, CombatTile } from './battle'
import { isHeroStack, stackMoveSpeed, stackMaxRange } from './battle'
import {
  combatMovementReachable,
  combatPathSteps,
  footprintSpecFor,
  groundEffectMovementBlockKeys,
  hexKey,
  landingOccupiedForMover,
  moveKindForUnit,
  occupiedForMover,
  stackOccupyingHex,
  stopOnlyForMover,
  type EnterCostAdjust,
} from './movement'
import { deathKnightShadowMoveAdjust } from './shadow'
import { isHealAllyTarget } from './factory'
import { tombstoneOccupancyBodies } from './tombstone'
import { breathHexes, hasLineOfSight, previewImpactKeys } from './shapes'
import {
  isSiegeEngineWallTarget,
  isUntargetableStack,
  isValidSiegeWallAttackStand,
  openBridgeMoatKeys,
} from './siege'
import { pickNearestUnitAnySide, isVanished, isMagicAttackSilenced } from './condition'

export type TargetIconKind = 'move' | 'aoe' | 'hero' | 'invalid' | AttackIconKind

/** `'center'` or a 0–5 wedge index (pointy-top, 0 = east, clockwise). */
export type HexZone = 'center' | 0 | 1 | 2 | 3 | 4 | 5

export type CombatHover = {
  icon: TargetIconKind
  q: number
  r: number
  steps: Axial[]
  attackTargetId: string | null
  fire: boolean
  afterMove: 'pulse' | null
  impactKeys: string[]
  /** Enemy hex this attack aims at. Defaults to `q,r` when omitted. */
  aimHex?: Axial
  /** Outward arrow toward the chosen neighbor. */
  arrowDeg?: number | null
  /** Shown for invalid siege attack stands. */
  label?: string
  /** Confuse: allow striking allies. */
  allowFriendly?: boolean
  /** Prepended to the attack / turn-end log. */
  logPrefix?: string[]
}

/**
 * Pointy-top, y-down: 0° east, then 60° clockwise.
 * Matches honeycomb-grid POINTY neighbor angles.
 */
const WEDGE_NEIGHBORS: Axial[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
]

const CENTER_FRAC = 0.42

export function pointerHexZone(
  dx: number,
  dy: number,
  hexSize: number,
): HexZone {
  if (Math.hypot(dx, dy) < hexSize * CENTER_FRAC) {
    return 'center'
  }
  const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
  return (Math.floor((deg + 30) / 60) % 6) as 0 | 1 | 2 | 3 | 4 | 5
}

function wedgeNeighbor(hover: Axial, zone: number): Axial {
  const delta = WEDGE_NEIGHBORS[zone] ?? WEDGE_NEIGHBORS[0]!
  return { q: hover.q + delta.q, r: hover.r + delta.r }
}

function usesDirectionWedges(shape: string): boolean {
  return shape === 'single' || shape === 'cleave' || shape === 'breath'
}

/** Hex the stack will occupy after walking `steps` (current hex if none). */
export function actingStand(origin: Axial, steps: Axial[]): Axial {
  const last = steps[steps.length - 1]
  return last ?? { q: origin.q, r: origin.r }
}

function moverStats(
  stack: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  heroes?: CombatHeroes,
) {
  const unit = unitById(catalog, stack.unitId)
  const kind = moveKindForUnit(unit, catalog)
  const tombs = tombstoneOccupancyBodies(battle.tombstones)
  // Tombstones block landing only — units may path through them.
  const occupied = occupiedForMover(battle.stacks, catalog, stack.id, kind)
  const landOccupied = landingOccupiedForMover(
    battle.stacks,
    catalog,
    stack.id,
    tombs,
  )
  const budget = unitIsStationary(unit)
    ? 0
    : (stackMoveSpeed(stack, catalog) ?? 0)
  const from = { q: stack.q, r: stack.r }
  const spec = footprintSpecFor(stack, catalog)
  const passableMoat = openBridgeMoatKeys(battle, catalog, tiles)
  const stopOnly = stopOnlyForMover(battle, catalog, tiles, kind)
  const costAdjust = deathKnightShadowMoveAdjust(
    battle,
    catalog,
    heroes,
    stack.side,
    kind,
  )
  const geBlocks = groundEffectMovementBlockKeys(battle)
  return {
    unit,
    kind,
    occupied,
    landOccupied,
    budget,
    from,
    spec,
    passableMoat,
    stopOnly,
    costAdjust,
    geBlocks,
  }
}

function impactFrom(
  attacker: CombatStack,
  stand: Axial,
  aim: Axial,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): string[] {
  const spec = unitAttackShape(unitById(catalog, attacker.unitId))
  // charge_line: corridor is from the pre-move hex through the target — not
  // from the post-walk stand (that would collapse the preview to 1 hex).
  if (spec.shape === 'charge_line') {
    return previewImpactKeys(
      attacker,
      aim,
      battle,
      catalog,
      tiles,
      { q: attacker.q, r: attacker.r },
    )
  }
  const ghost = { ...attacker, q: stand.q, r: stand.r }
  return previewImpactKeys(ghost, aim, battle, catalog, tiles)
}

function inMaxRange(
  from: Axial,
  hex: Axial,
  maxRange: number,
): boolean {
  const dist = hexDistance(from, hex)
  return dist >= 1 && dist <= maxRange
}

/** Fewest-steps hex this stack can stand on and still be in attack range. */
export function bestAttackStand(
  attacker: CombatStack,
  target: CombatStack,
  reachable: Map<string, Axial[]>,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  stacks: CombatStack[],
  allowFriendly = false,
): Axial | null {
  if (attacker.id === target.id) {
    return null
  }
  if (!allowFriendly && attacker.side === target.side) {
    return null
  }
  if (isUntargetableStack(target, catalog) || isVanished(target, catalog)) {
    return null
  }
  const wallTarget = isSiegeEngineWallTarget(target, catalog)
  const aim = { q: target.q, r: target.r }
  let best: Axial | null = null
  let bestSteps = Infinity
  for (const [key, steps] of reachable) {
    const [qs, rs] = key.split(',')
    const from = { q: Number(qs), r: Number(rs) }
    if (
      wallTarget &&
      !isValidSiegeWallAttackStand(from, tiles, stacks, catalog)
    ) {
      continue
    }
    if (!attackRangeFrom(from, target, catalog, attacker)) {
      continue
    }
    if (!hasLineOfSight(from, aim, tiles, stacks, catalog)) {
      continue
    }
    if (steps.length < bestSteps) {
      best = from
      bestSteps = steps.length
    }
  }
  return best
}

function breathHitsTarget(
  from: Axial,
  target: Axial,
  rows: number,
): boolean {
  return breathHexes(from, target, rows).some(
    (hex) => hex.q === target.q && hex.r === target.r,
  )
}

/**
 * Closest reachable hex to the target from which Breath still hits it.
 * Prefer adjacency when the movement budget can get there.
 */
function bestBreathStand(
  attacker: CombatStack,
  target: CombatStack,
  reachable: Map<string, Axial[]>,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  stacks: CombatStack[],
): Axial | null {
  if (attacker.side === target.side || attacker.id === target.id) {
    return null
  }
  if (isUntargetableStack(target, catalog)) {
    return null
  }
  const rows = unitAttackShape(unitById(catalog, attacker.unitId)).rows
  const aim = { q: target.q, r: target.r }
  const wallTarget = isSiegeEngineWallTarget(target, catalog)
  let best: Axial | null = null
  let bestDist = Infinity
  let bestSteps = Infinity
  for (const [key, steps] of reachable) {
    const [qs, rs] = key.split(',')
    const from = { q: Number(qs), r: Number(rs) }
    if (
      wallTarget &&
      !isValidSiegeWallAttackStand(from, tiles, stacks, catalog)
    ) {
      continue
    }
    if (!attackRangeFrom(from, target, catalog, attacker)) {
      continue
    }
    if (!hasLineOfSight(from, aim, tiles, stacks, catalog)) {
      continue
    }
    if (!breathHitsTarget(from, aim, rows)) {
      continue
    }
    const dist = hexDistance(from, aim)
    if (dist < bestDist || (dist === bestDist && steps.length < bestSteps)) {
      best = from
      bestDist = dist
      bestSteps = steps.length
    }
  }
  return best
}

function bestRangeStand(
  reachable: Map<string, Axial[]>,
  aim: Axial,
  maxRange: number,
  tiles: CombatTile[],
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
): Axial | null {
  let best: Axial | null = null
  let bestSteps = Infinity
  for (const [key, steps] of reachable) {
    const [qs, rs] = key.split(',')
    const from = { q: Number(qs), r: Number(rs) }
    if (!inMaxRange(from, aim, maxRange)) {
      continue
    }
    if (!hasLineOfSight(from, aim, tiles, stacks, catalog)) {
      continue
    }
    if (steps.length < bestSteps) {
      best = from
      bestSteps = steps.length
    }
  }
  return best
}

export function canStrikeThisTurn(
  attacker: CombatStack,
  battle: CombatBattle,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
  heroes?: CombatHeroes,
): boolean {
  if (isMagicAttackSilenced(attacker, catalog)) {
    return false
  }
  const unit = unitById(catalog, attacker.unitId)
  const spec = unitAttackShape(unit)
  if (unitAutoTarget(unit)) {
    return battle.stacks.some((row) =>
      isValidAttackTarget(attacker, row, catalog, tiles, battle.stacks),
    )
  }
  if (shapePulsesOnMove(spec.shape)) {
    return false
  }
  if (shapeIsUntargeted(spec.shape)) {
    return battle.stacks.some(
      (row) =>
        row.side !== attacker.side &&
        row.qty > 0 &&
        !isUntargetableStack(row, catalog) &&
        hasLineOfSight(
          { q: attacker.q, r: attacker.r },
          { q: row.q, r: row.r },
          tiles,
          battle.stacks,
          catalog,
        ),
    )
  }
  const { costAdjust } = moverStats(
    attacker,
    battle,
    catalog,
    tiles,
    heroes,
  )
  const reachable = combatMovementReachable(
    attacker,
    battle,
    tiles,
    catalog,
    costAdjust,
  )
  if (spec.shape === 'line') {
    // LINE is stay-and-shoot from the current hex (Centaur-style). Do not
    // treat it like Beam's "walk into range, then fire."
    return battle.stacks.some((row) => {
      if (
        row.qty <= 0 ||
        row.side === attacker.side ||
        isHeroStack(row) ||
        isUntargetableStack(row, catalog)
      ) {
        return false
      }
      return (
        attackRangeFrom(attacker, row, catalog, attacker) &&
        hasLineOfSight(
          { q: attacker.q, r: attacker.r },
          { q: row.q, r: row.r },
          tiles,
          battle.stacks,
          catalog,
        )
      )
    })
  }
  if (spec.shape === 'beam') {
    const maxRange = stackMaxRange(attacker, catalog)
    return battle.stacks.some((row) => {
      if (
        row.qty <= 0 ||
        row.side === attacker.side ||
        isHeroStack(row) ||
        isUntargetableStack(row, catalog)
      ) {
        return false
      }
      return (
        bestRangeStand(
          reachable,
          { q: row.q, r: row.r },
          maxRange,
          tiles,
          battle.stacks,
          catalog,
        ) != null
      )
    })
  }
  if (spec.shape === 'aoe') {
    const maxRange = stackMaxRange(attacker, catalog)
    return tiles.some(
      (tile) =>
        bestRangeStand(
          reachable,
          { q: tile.q, r: tile.r },
          maxRange,
          tiles,
          battle.stacks,
          catalog,
        ) != null,
    )
  }
  if (spec.shape === 'breath') {
    return battle.stacks.some(
      (row) =>
        bestBreathStand(
          attacker,
          row,
          reachable,
          catalog,
          tiles,
          battle.stacks,
        ) != null,
    )
  }
  return battle.stacks.some(
    (row) =>
      bestAttackStand(
        attacker,
        row,
        reachable,
        catalog,
        tiles,
        battle.stacks,
      ) != null,
  )
}

function attackHover(
  attacker: CombatStack,
  aim: Axial,
  steps: Axial[],
  targetId: string | null,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  icon?: TargetIconKind,
): CombatHover {
  if (isMagicAttackSilenced(attacker, catalog)) {
    return {
      icon: 'invalid',
      q: aim.q,
      r: aim.r,
      steps: [],
      attackTargetId: null,
      fire: false,
      afterMove: null,
      impactKeys: [],
      aimHex: aim,
      label: 'Silenced',
    }
  }
  const unit = unitById(catalog, attacker.unitId)
  const stand = actingStand({ q: attacker.q, r: attacker.r }, steps)
  return {
    icon: icon ?? attackIconFor(unit),
    q: aim.q,
    r: aim.r,
    steps,
    attackTargetId: targetId,
    fire: true,
    afterMove: null,
    impactKeys: impactFrom(attacker, stand, aim, battle, catalog, tiles),
    aimHex: aim,
  }
}

function stayHover(
  from: Axial,
  extra?: Pick<CombatHover, 'afterMove' | 'impactKeys'>,
): CombatHover {
  return {
    icon: 'move',
    q: from.q,
    r: from.r,
    steps: [],
    attackTargetId: null,
    fire: false,
    afterMove: extra?.afterMove ?? null,
    impactKeys: extra?.impactKeys ?? [],
  }
}

/**
 * Walk steps this turn toward `hover`: the exact reachable path if the hex
 * is in budget, otherwise the shortest path truncated at remaining Speed.
 */
function stepsToward(
  hover: Axial,
  reachable: Map<string, Axial[]>,
  from: Axial,
  budget: number,
  tiles: CombatTile[],
  kind: ReturnType<typeof moveKindForUnit>,
  occupied: ReadonlySet<string>,
  spec: ReturnType<typeof footprintSpecFor>,
  passableMoat?: ReadonlySet<string>,
  stopOnly?: ReadonlySet<string>,
  landOccupied?: ReadonlySet<string>,
  costAdjust?: EnterCostAdjust,
  movementBlockKeys?: ReadonlySet<string>,
): Axial[] | null {
  const exact = reachable.get(hexKey(hover.q, hover.r))
  if (exact != null && exact.length > 0) {
    return exact
  }
  const truncated = combatPathSteps(
    from,
    hover,
    budget,
    tiles,
    kind,
    occupied,
    spec,
    passableMoat,
    stopOnly,
    landOccupied,
    costAdjust,
    movementBlockKeys,
  )
  return truncated.length > 0 ? truncated : null
}

/**
 * Among hexes reachable this turn, pick the one that gets closest to `goal`.
 * Used when a direct path onto/toward an occupied enemy hex fails.
 */
export function bestApproachToward(
  from: Axial,
  goal: Axial,
  reachable: Map<string, Axial[]>,
): { hex: Axial; steps: Axial[] } | null {
  const startDist = hexDistance(from, goal)
  let best: { hex: Axial; steps: Axial[] } | null = null
  let bestDist = startDist
  let bestLen = Infinity
  for (const [key, steps] of reachable) {
    if (steps.length === 0) {
      continue
    }
    const [qs, rs] = key.split(',')
    const hex = { q: Number(qs), r: Number(rs) }
    const dist = hexDistance(hex, goal)
    if (dist < bestDist || (dist === bestDist && steps.length < bestLen)) {
      best = { hex, steps }
      bestDist = dist
      bestLen = steps.length
    }
  }
  if (!best || bestDist >= startDist) {
    return null
  }
  return best
}

function moveTowardHover(from: Axial, steps: Axial[]): CombatHover {
  const dest = actingStand(from, steps)
  return {
    icon: 'move',
    q: dest.q,
    r: dest.r,
    steps,
    attackTargetId: null,
    fire: false,
    afterMove: null,
    impactKeys: [],
  }
}

export function combatHover(
  attacker: CombatStack,
  hover: Axial,
  battle: CombatBattle,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
  zone: HexZone = 'center',
  heroes?: CombatHeroes,
): CombatHover | null {
  const { unit, kind, occupied, landOccupied, budget, from, spec, passableMoat, stopOnly, costAdjust, geBlocks } = moverStats(
    attacker,
    battle,
    catalog,
    tiles,
    heroes,
  )
  if (unitAutoTarget(unit)) {
    return null
  }
  const shape = unitAttackShape(unit)
  const occupant = stackOccupyingHex(
    battle.stacks,
    hover.q,
    hover.r,
    catalog,
  )
  const isSelf = occupant?.id === attacker.id
  if (
    occupant &&
    !isSelf &&
    isUntargetableStack(occupant, catalog)
  ) {
    return null
  }
  const enemy =
    occupant && !isSelf && occupant.side !== attacker.side ? occupant : null
  const healAlly =
    occupant && !isSelf && isHealAllyTarget(attacker, occupant, catalog)
      ? occupant
      : null
  const strikeTarget = enemy ?? healAlly
  const reachable = combatMovementReachable(
    attacker,
    battle,
    tiles,
    catalog,
    costAdjust,
  )
  const maxRange = stackMaxRange(attacker, catalog)

  if (isSelf) {
    if (shapePulsesOnMove(shape.shape)) {
      return stayHover(from, {
        afterMove: 'pulse',
        impactKeys: impactFrom(attacker, from, from, battle, catalog, tiles),
      })
    }
    if (shapeIsUntargeted(shape.shape)) {
      return attackHover(
        attacker,
        hover,
        [],
        null,
        battle,
        catalog,
        tiles,
      )
    }
    if (!usesDirectionWedges(shape.shape)) {
      return unitIsStationary(unit) ? null : stayHover(from)
    }
  }

  if (usesDirectionWedges(shape.shape) && !(occupant && !isSelf)) {
    const steps = reachable.get(hexKey(hover.q, hover.r))
    if (steps == null) {
      const toward = stepsToward(
        hover,
        reachable,
        from,
        budget,
        tiles,
        kind,
        occupied,
        spec,
        passableMoat,
        stopOnly,
        landOccupied,
        costAdjust,
        geBlocks,
      )
      return toward ? moveTowardHover(from, toward) : null
    }
    const moveOnly = (): CombatHover => ({
      icon: 'move',
      q: hover.q,
      r: hover.r,
      steps,
      attackTargetId: null,
      fire: false,
      afterMove: null,
      impactKeys: [],
    })
    if (zone === 'center') {
      return unitIsStationary(unit) ? null : moveOnly()
    }
    const neighbor = wedgeNeighbor(hover, zone)
    const foe = stackOccupyingHex(
      battle.stacks,
      neighbor.q,
      neighbor.r,
      catalog,
    )
    const aim = foe ? { q: foe.q, r: foe.r } : neighbor
    const validFoe =
      foe != null &&
      foe.qty > 0 &&
      (foe.side !== attacker.side || isHealAllyTarget(attacker, foe, catalog)) &&
      !isUntargetableStack(foe, catalog) &&
      attackRangeFrom(hover, foe, catalog, attacker) &&
      hasLineOfSight(hover, { q: foe.q, r: foe.r }, tiles, battle.stacks, catalog) &&
      (shape.shape !== 'breath' ||
        breathHitsTarget(hover, aim, shape.rows))
    if (!validFoe || !foe) {
      return moveOnly()
    }
    if (
      isSiegeEngineWallTarget(foe, catalog) &&
      !isValidSiegeWallAttackStand(hover, tiles, battle.stacks, catalog)
    ) {
      return {
        icon: 'invalid',
        q: hover.q,
        r: hover.r,
        steps,
        attackTargetId: null,
        fire: false,
        afterMove: null,
        impactKeys: [],
        label: "Can't Stand Here",
      }
    }
    if (isMagicAttackSilenced(attacker, catalog)) {
      return {
        icon: 'invalid',
        q: hover.q,
        r: hover.r,
        steps: [],
        attackTargetId: null,
        fire: false,
        afterMove: null,
        impactKeys: [],
        label: 'Silenced',
      }
    }
    return {
      icon: attackIconFor(unit),
      q: hover.q,
      r: hover.r,
      steps,
      attackTargetId: foe.id,
      fire: true,
      afterMove: null,
      impactKeys: impactFrom(attacker, hover, aim, battle, catalog, tiles),
      aimHex: aim,
      arrowDeg: zone * 60,
      allowFriendly: isHealAllyTarget(attacker, foe, catalog),
    }
  }

  if (shape.shape === 'aoe') {
    const stand = bestRangeStand(
      reachable,
      hover,
      maxRange,
      tiles,
      battle.stacks,
      catalog,
    )
    if (stand) {
      const enemyId =
        occupant && occupant.side !== attacker.side ? occupant.id : null
      return attackHover(
        attacker,
        hover,
        reachable.get(hexKey(stand.q, stand.r)) ?? [],
        enemyId,
        battle,
        catalog,
        tiles,
        'aoe',
      )
    }
  }

  // LINE: fire from the current hex only (full pierce line). Never walk into
  // range then shoot — that Beam-style path made ranged piercers close first.
  // (Pangolin uses charge_line: walk-then-pierce, not this branch.)
  if (shape.shape === 'line' && strikeTarget) {
    const aim = { q: strikeTarget.q, r: strikeTarget.r }
    const canFireNow =
      attackRangeFrom(from, strikeTarget, catalog, attacker) &&
      hasLineOfSight(from, aim, tiles, battle.stacks, catalog)
    if (canFireNow) {
      return {
        ...attackHover(
          attacker,
          aim,
          [],
          strikeTarget.id,
          battle,
          catalog,
          tiles,
        ),
        allowFriendly: healAlly != null,
      }
    }
    if (enemy) {
      const approach = bestApproachToward(
        from,
        { q: enemy.q, r: enemy.r },
        reachable,
      )
      return approach ? moveTowardHover(from, approach.steps) : null
    }
    return null
  }

  if (shapePulsesOnMove(shape.shape)) {
    // Occupied enemy hex: fall through to attack/approach handling below.
    if (!(occupant && !isSelf)) {
      const steps = stepsToward(
        hover,
        reachable,
        from,
        budget,
        tiles,
        kind,
        occupied,
        spec,
        passableMoat,
        stopOnly,
        landOccupied,
        costAdjust,
        geBlocks,
      )
      if (!steps) {
        return null
      }
      const dest = actingStand(from, steps)
      return {
        icon: 'move',
        q: dest.q,
        r: dest.r,
        steps,
        attackTargetId: null,
        fire: false,
        afterMove: 'pulse',
        impactKeys: impactFrom(attacker, dest, dest, battle, catalog, tiles),
      }
    }
  }

  if (shapeIsUntargeted(shape.shape)) {
    if (enemy && hasLineOfSight(from, { q: enemy.q, r: enemy.r }, tiles, battle.stacks, catalog)) {
      return attackHover(
        attacker,
        hover,
        [],
        enemy.id,
        battle,
        catalog,
        tiles,
      )
    }
    const steps = stepsToward(
      hover,
      reachable,
      from,
      budget,
      tiles,
      kind,
      occupied,
      spec,
      passableMoat,
      stopOnly,
      landOccupied,
      costAdjust,
      geBlocks,
    )
    return steps ? moveTowardHover(from, steps) : null
  }

  if (strikeTarget) {
    const stand =
      shape.shape === 'breath' && enemy
        ? bestBreathStand(
            attacker,
            enemy,
            reachable,
            catalog,
            tiles,
            battle.stacks,
          )
        : bestAttackStand(
            attacker,
            strikeTarget,
            reachable,
            catalog,
            tiles,
            battle.stacks,
            healAlly != null,
          )
    if (stand) {
      return {
        ...attackHover(
          attacker,
          { q: strikeTarget.q, r: strikeTarget.r },
          reachable.get(hexKey(stand.q, stand.r)) ?? [],
          strikeTarget.id,
          battle,
          catalog,
          tiles,
        ),
        allowFriendly: healAlly != null,
      }
    }
    if (enemy && isSiegeEngineWallTarget(enemy, catalog)) {
      return {
        icon: 'invalid',
        q: enemy.q,
        r: enemy.r,
        steps: [],
        attackTargetId: null,
        fire: false,
        afterMove: null,
        impactKeys: [],
        label: "Can't Stand Here",
      }
    }
    if (enemy) {
      const steps = combatPathSteps(
        from,
        hover,
        budget,
        tiles,
        kind,
        occupied,
        spec,
        passableMoat,
        stopOnly,
        landOccupied,
        costAdjust,
        geBlocks,
      )
      if (steps.length > 0) {
        return {
          icon: 'move',
          q: enemy.q,
          r: enemy.r,
          steps,
          attackTargetId: null,
          fire: false,
          afterMove: null,
          impactKeys: [],
        }
      }
      // Direct path onto the enemy hex failed (allies / footprint). Still walk closer.
      const approach = bestApproachToward(
        from,
        { q: enemy.q, r: enemy.r },
        reachable,
      )
      return approach ? moveTowardHover(from, approach.steps) : null
    }
  }

  // Beams never fire at empty ground (Thor Construct regression). Unit aims
  // are handled above via strikeTarget / bestAttackStand. LINE is stay-and-shoot
  // from the current hex (see dedicated branch above).
  if (occupant && !isSelf) {
    return null
  }
  const steps = stepsToward(
    hover,
    reachable,
    from,
    budget,
    tiles,
    kind,
    occupied,
    spec,
    passableMoat,
    stopOnly,
    landOccupied,
    costAdjust,
    geBlocks,
  )
  return steps ? moveTowardHover(from, steps) : null
}

/**
 * Confuse: path (if needed) then strike the nearest living unit, any side.
 * Null when no victim or none reachable this turn.
 */
export function confusedAttackIntent(
  stack: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  random: () => number = Math.random,
): CombatHover | null {
  if (isMagicAttackSilenced(stack, catalog)) {
    return null
  }
  const target = pickNearestUnitAnySide(stack, battle, catalog, random)
  if (!target) {
    return null
  }
  const unit = unitById(catalog, stack.unitId)
  const shape = unitAttackShape(unit)
  const from = { q: stack.q, r: stack.r }
  const reachable = combatMovementReachable(stack, battle, tiles, catalog)
  // LINE: stay-and-shoot — never relocate before the confused strike.
  if (shape.shape === 'line') {
    if (
      !attackRangeFrom(stack, target, catalog, stack) ||
      !hasLineOfSight(
        from,
        { q: target.q, r: target.r },
        tiles,
        battle.stacks,
        catalog,
      )
    ) {
      return null
    }
    return {
      icon: attackIconFor(unit),
      q: from.q,
      r: from.r,
      steps: [],
      attackTargetId: target.id,
      fire: true,
      afterMove: null,
      impactKeys: [],
      aimHex: { q: target.q, r: target.r },
      allowFriendly: true,
    }
  }
  const stand = bestAttackStand(
    stack,
    target,
    reachable,
    catalog,
    tiles,
    battle.stacks,
    true,
  )
  if (!stand) {
    return null
  }
  const steps = reachable.get(hexKey(stand.q, stand.r)) ?? []
  return {
    icon: attackIconFor(unit),
    q: stand.q,
    r: stand.r,
    steps,
    attackTargetId: target.id,
    fire: true,
    afterMove: null,
    impactKeys: [],
    aimHex: { q: target.q, r: target.r },
    allowFriendly: true,
  }
}
