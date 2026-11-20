import type { Axial } from '../hex/hero'
import { hexDistance } from '../hex/pathfinding'
import type { ReferenceCatalog } from '../town/catalog'
import {
  shapeIsUntargeted,
  shapePulsesOnMove,
  type UnitCombatAbilities,
  unitAttackShape,
  unitAutoTarget,
  unitById,
  unitIsStationary,
} from '../town/catalog'
import {
  attackIconFor,
  attackCanHitTargetAtStand,
  attackDeliveryOkFromStand,
  attackTargetPolicyOk,
  closestTargetFootprintHex,
  isValidAttackTarget,
  pickAutoAttackTarget,
  targetInNormalAttackReach,
  attackAimFromCommit,
  type AttackIconKind,
  attachBeamLineToCommit,
  type AttackCommitAim,
  type AttackAim,
  type CombatHeroes,
} from './attack'
import type { CombatBattle, CombatStack, CombatTile } from './battle'
import { stackMoveSpeed } from './battle'
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
import {
  occupancyKey,
  reachableAtHoverHex,
  minFootprintHexDistance,
  stackFootprint,
} from './occupancy'
import {
  actionOriginFootprintHex,
  hexWedgeZone,
  type ShapeGeometryOpts,
} from './actionOrigin'
import { deathKnightShadowMoveAdjust } from './shadow'
import { isHealAllyTarget } from './factory'
import { tombstoneOccupancyBodies } from './tombstone'
import {
  beamClippedPathFromCommit,
  breathHexes,
  hasLineOfSight,
  previewImpactKeys,
} from './shapes'
import {
  isSiegeEngineWallTarget,
  isUntargetableStack,
  isValidSiegeWallAttackStand,
  openBridgeMoatKeys,
} from './siege'
import {
  pickNearestUnitAnySide,
  isVanished,
  isUnitAttackBlocked,
  unitAttackBlockHoverLabel,
} from './condition'
import {
  isValidPullAttackTarget,
  pullLandingPreviewKeys,
} from './pullTarget'
import {
  bestTrapPlacementStand,
  canPlaceTrapAnyone,
  trapBlastImpactKeys,
  unitTrapConfig,
} from './unitTrap'

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
  /** Full clipped beam path (faint preview). */
  beamPathKeys?: string[]
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
  /** Pull_target: hex the victim lands on before the pulse. */
  pullLandingKeys?: string[]
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

export function pointerHexZone(
  dx: number,
  dy: number,
  hexSize: number,
  centerFrac: number | null,
): HexZone {
  const frac = centerFrac ?? 1
  if (frac >= 1 || Math.hypot(dx, dy) < hexSize * frac) {
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

/** Stand + aim from intent using the attacker's position before any walk steps. */
export function combatAttackAimFromIntent(
  attackerAtOrigin: CombatStack,
  intent: Pick<
    CombatHover,
    | 'attackTargetId'
    | 'aimHex'
    | 'q'
    | 'r'
    | 'arrowDeg'
    | 'steps'
    | 'afterMove'
    | 'fire'
  >,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): AttackAim {
  return attackAimFromCommit(
    attackCommitAim(attackerAtOrigin, intent, tiles, catalog),
  )
}

/** Rebuild committed aim from hover intent (preview, move-then-attack, AI). */
export function attackCommitAim(
  attacker: CombatStack,
  intent: Pick<
    CombatHover,
    | 'attackTargetId'
    | 'aimHex'
    | 'q'
    | 'r'
    | 'arrowDeg'
    | 'steps'
    | 'afterMove'
    | 'fire'
  >,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
): AttackCommitAim {
  const stand = actingStand({ q: attacker.q, r: attacker.r }, intent.steps)
  const atkShape = unitAttackShape(unitById(catalog, attacker.unitId))
  const aimHex =
    atkShape.shape === 'pulse' && intent.fire
      ? stand
      : (intent.aimHex ?? { q: intent.q, r: intent.r })
  const wedgeZone =
    intent.arrowDeg != null
      ? (((intent.arrowDeg / 60) % 6) + 6) % 6
      : undefined
  const ghost = { ...attacker, q: stand.q, r: stand.r }
  return attachBeamLineToCommit(
    {
      stand,
      aimHex,
      targetId: intent.attackTargetId,
      wedgeZone,
      origin: actionOriginFootprintHex(
        stand,
        ghost,
        catalog,
        aimHex,
        wedgeZone,
      ),
    },
    ghost,
    catalog,
    tiles,
  )
}

function deliveryOkFromStand(
  from: Axial,
  aim: Axial,
  attacker: CombatStack,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  stacks: CombatStack[],
  wedgeZone?: number | null,
): boolean {
  return attackDeliveryOkFromStand(
    from,
    aim,
    attacker,
    catalog,
    tiles,
    stacks,
    wedgeZone,
  )
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
  const tombs = tombstoneOccupancyBodies(battle.tombstones, catalog)
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

function impactPreview(
  attacker: CombatStack,
  stand: Axial,
  aim: Axial,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  extra?: {
    wedgeZone?: number | null
    chargeStandAnchor?: Axial | null
    targetId?: string | null
    allowFriendly?: boolean
  },
): { impactKeys: string[]; beamPathKeys: string[] } {
  const spec = unitAttackShape(unitById(catalog, attacker.unitId))
  const ghost = { ...attacker, q: stand.q, r: stand.r }
  if (spec.shape === 'beam') {
    const commit = attachBeamLineToCommit(
      {
        stand,
        aimHex: aim,
        targetId: extra?.targetId ?? null,
        wedgeZone: extra?.wedgeZone,
        origin: actionOriginFootprintHex(
          stand,
          ghost,
          catalog,
          aim,
          extra?.wedgeZone,
        ),
      },
      ghost,
      catalog,
      tiles,
    )
    const clipped = beamClippedPathFromCommit(
      commit,
      ghost,
      battle,
      catalog,
      tiles,
    )
    const pathKeys = clipped.map((hex) => occupancyKey(hex.q, hex.r))
    return {
      beamPathKeys: [],
      impactKeys: pathKeys,
    }
  }
  if (spec.shape === 'charge_line') {
    return {
      impactKeys: previewImpactKeys(attacker, aim, battle, catalog, tiles, {
        standAnchor: stand,
        attacker: ghost,
        chargeStandAnchor:
          extra?.chargeStandAnchor ?? { q: attacker.q, r: attacker.r },
      }),
      beamPathKeys: [],
    }
  }
  const geometry: ShapeGeometryOpts = {
    standAnchor: stand,
    attacker: ghost,
    wedgeZone: extra?.wedgeZone,
  }
  return {
    impactKeys: previewImpactKeys(ghost, aim, battle, catalog, tiles, geometry),
    beamPathKeys: [],
  }
}

function bestRangeStand(
  reachable: Map<string, Axial[]>,
  aim: Axial,
  attacker: CombatStack,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  stacks: CombatStack[],
): Axial | null {
  let best: Axial | null = null
  let bestSteps = Infinity
  for (const [key, steps] of reachable) {
    const [qs, rs] = key.split(',')
    const from = { q: Number(qs), r: Number(rs) }
    if (
      !deliveryOkFromStand(
        from,
        aim,
        attacker,
        catalog,
        tiles,
        stacks,
      )
    ) {
      continue
    }
    if (steps.length < bestSteps) {
      best = from
      bestSteps = steps.length
    }
  }
  return best
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
  let best: Axial | null = null
  let bestSteps = Infinity
  const tryStand = (from: Axial, steps: Axial[]) => {
    if (
      wallTarget &&
      !isValidSiegeWallAttackStand(from, tiles, stacks, catalog)
    ) {
      return
    }
    if (
      !attackCanHitTargetAtStand(
        from,
        attacker,
        target,
        catalog,
        tiles,
        stacks,
        allowFriendly,
      )
    ) {
      return
    }
    if (steps.length < bestSteps) {
      best = from
      bestSteps = steps.length
    }
  }
  tryStand({ q: attacker.q, r: attacker.r }, [])
  for (const [key, steps] of reachable) {
    const [qs, rs] = key.split(',')
    const from = { q: Number(qs), r: Number(rs) }
    tryStand(from, steps)
  }
  return best
}

function breathHitsTarget(
  stand: Axial,
  attacker: CombatStack,
  catalog: ReferenceCatalog,
  target: Axial,
  rows: number,
  wedgeZone?: number | null,
): boolean {
  const ghost = { ...attacker, q: stand.q, r: stand.r }
  const origin = actionOriginFootprintHex(
    stand,
    ghost,
    catalog,
    target,
    wedgeZone,
  )
  return breathHexes(origin, target, rows).some(
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
    const aimHex = closestTargetFootprintHex(from, attacker, target, catalog)
    if (
      !attackDeliveryOkFromStand(
        from,
        aimHex,
        attacker,
        catalog,
        tiles,
        stacks,
      )
    ) {
      continue
    }
    if (!breathHitsTarget(from, attacker, catalog, aimHex, rows)) {
      continue
    }
    const dist = hexDistance(from, aimHex)
    if (dist < bestDist || (dist === bestDist && steps.length < bestSteps)) {
      best = from
      bestDist = dist
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
  if (isUnitAttackBlocked(attacker, catalog)) {
    return false
  }
  const unit = unitById(catalog, attacker.unitId)
  if (unitTrapConfig(unit)) {
    return canPlaceTrapAnyone(attacker, battle, catalog, tiles)
  }
  const spec = unitAttackShape(unit)
  if (unitAutoTarget(unit)) {
    return canAutoActThisTurn(attacker, battle, catalog, tiles, heroes)
  }
  if (shapePulsesOnMove(spec.shape) && !spec.pullTarget) {
    return false
  }
  if (spec.pullTarget) {
    return battle.stacks.some((row) =>
      isValidPullAttackTarget(
        attacker,
        row,
        catalog,
        tiles,
        battle.stacks,
      ),
    )
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
  if (spec.shape === 'aoe') {
    return tiles.some(
      (tile) =>
        bestRangeStand(
          reachable,
          { q: tile.q, r: tile.r },
          attacker,
          catalog,
          tiles,
          battle.stacks,
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
  wedgeZone?: number | null,
): CombatHover {
  const blockLabel = unitAttackBlockHoverLabel(attacker, catalog)
  if (blockLabel) {
    if (steps.length > 0) {
      const dest = actingStand({ q: attacker.q, r: attacker.r }, steps)
      return {
        icon: 'move',
        q: dest.q,
        r: dest.r,
        steps,
        attackTargetId: null,
        fire: false,
        afterMove: null,
        impactKeys: [],
        label: blockLabel,
      }
    }
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
      label: blockLabel,
    }
  }
  const unit = unitById(catalog, attacker.unitId)
  const stand = actingStand({ q: attacker.q, r: attacker.r }, steps)
  const attackShape = unit ? unitAttackShape(unit).shape : 'single'
  const previewAim = attackShape === 'pulse' ? stand : aim
  const impact = impactPreview(attacker, stand, previewAim, battle, catalog, tiles, {
    wedgeZone,
    targetId,
  })
  return {
    icon: icon ?? attackIconFor(unit),
    q: aim.q,
    r: aim.r,
    steps,
    attackTargetId: targetId,
    fire: true,
    afterMove: null,
    impactKeys: impact.impactKeys,
    beamPathKeys: impact.beamPathKeys,
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
  mover: CombatStack,
  catalog: ReferenceCatalog,
  passableMoat?: ReadonlySet<string>,
  stopOnly?: ReadonlySet<string>,
  landOccupied?: ReadonlySet<string>,
  costAdjust?: EnterCostAdjust,
  movementBlockKeys?: ReadonlySet<string>,
): Axial[] | null {
  const dest =
    reachableAtHoverHex(hover, mover, catalog, reachable)?.anchor ?? hover
  const exact = reachable.get(hexKey(dest.q, dest.r))
  if (exact != null && exact.length > 0) {
    return exact
  }
  const truncated = combatPathSteps(
    from,
    dest,
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

/** Closest reachable stand by footprint gap to `target` (not anchor hex distance). */
function bestApproachTowardTargetFootprint(
  attacker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
  reachable: Map<string, Axial[]>,
): { hex: Axial; steps: Axial[] } | null {
  const startDist = minFootprintHexDistance(
    { q: attacker.q, r: attacker.r },
    attacker,
    target,
    catalog,
  )
  let best: { hex: Axial; steps: Axial[] } | null = null
  let bestDist = startDist
  let bestLen = Infinity
  for (const [key, steps] of reachable) {
    if (steps.length === 0) {
      continue
    }
    const [qs, rs] = key.split(',')
    const hex = { q: Number(qs), r: Number(rs) }
    const dist = minFootprintHexDistance(hex, attacker, target, catalog)
    if (dist > bestDist || (dist === bestDist && steps.length >= bestLen)) {
      continue
    }
    best = { hex, steps }
    bestDist = dist
    bestLen = steps.length
  }
  if (!best || bestDist >= startDist) {
    return null
  }
  return best
}

function standFootprintOccupiesHex(
  stand: Axial,
  attacker: CombatStack,
  catalog: ReferenceCatalog,
  hex: Axial,
): boolean {
  const body = { ...attacker, q: stand.q, r: stand.r }
  return stackFootprint(body, catalog).some(
    (h) => h.q === hex.q && h.r === hex.r,
  )
}

function playerStandCanHit(
  stand: Axial,
  attacker: CombatStack,
  target: CombatStack,
  aimHex: Axial,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  stacks: CombatStack[],
  allowFriendly: boolean,
  shape: UnitCombatAbilities,
  pointerWedge: number,
): boolean {
  const ghost = { ...attacker, q: stand.q, r: stand.r }
  if (!attackTargetPolicyOk(ghost, target, catalog, allowFriendly)) {
    return false
  }
  if (
    shape.shape === 'breath' &&
    !breathHitsTarget(
      stand,
      attacker,
      catalog,
      aimHex,
      shape.rows,
      pointerWedge,
    )
  ) {
    return false
  }
  return attackDeliveryOkFromStand(
    stand,
    aimHex,
    ghost,
    catalog,
    tiles,
    stacks,
    pointerWedge,
  )
}

/**
 * Player hover/click stand from pointer zone on a target footprint hex.
 * Centre → fewest-step legal stand; wedge → side approach with shortest fallback.
 */
export function pickPlayerAttackStand(
  attacker: CombatStack,
  target: CombatStack,
  targetHoverHex: Axial,
  zone: HexZone,
  reachable: Map<string, Axial[]>,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  stacks: CombatStack[],
  allowFriendly: boolean,
): { stand: Axial; steps: Axial[]; wedgeZone?: number } | null {
  const unit = unitById(catalog, attacker.unitId)
  const shape = unitAttackShape(unit)
  const minR = unit?.min_range ?? 0

  const shortestStand = (): {
    stand: Axial
    steps: Axial[]
    wedgeZone?: number
  } | null => {
    const stand =
      shape.shape === 'breath'
        ? bestBreathStand(attacker, target, reachable, catalog, tiles, stacks)
        : bestAttackStand(
            attacker,
            target,
            reachable,
            catalog,
            tiles,
            stacks,
            allowFriendly,
          )
    if (!stand) {
      return null
    }
    return {
      stand,
      steps: reachable.get(hexKey(stand.q, stand.r)) ?? [],
    }
  }

  if (zone === 'center') {
    return shortestStand()
  }

  const wedge = zone as number
  const adj = wedgeNeighbor(targetHoverHex, wedge)
  const candidates: { stand: Axial; steps: Axial[] }[] = []

  const consider = (from: Axial, steps: Axial[]) => {
    if (
      isSiegeEngineWallTarget(target, catalog) &&
      !isValidSiegeWallAttackStand(from, tiles, stacks, catalog)
    ) {
      return
    }
    if (minR <= 0) {
      if (!standFootprintOccupiesHex(from, attacker, catalog, adj)) {
        return
      }
    } else if (hexWedgeZone(targetHoverHex, from) !== wedge) {
      return
    }
    if (
      !playerStandCanHit(
        from,
        attacker,
        target,
        targetHoverHex,
        catalog,
        tiles,
        stacks,
        allowFriendly,
        shape,
        wedge,
      )
    ) {
      return
    }
    candidates.push({ stand: from, steps })
  }

  consider({ q: attacker.q, r: attacker.r }, [])
  for (const [key, steps] of reachable) {
    const [qs, rs] = key.split(',')
    consider({ q: Number(qs), r: Number(rs) }, steps)
  }

  if (candidates.length === 0) {
    return shortestStand()
  }

  candidates.sort((a, b) => a.steps.length - b.steps.length)
  const best = candidates[0]!
  return { stand: best.stand, steps: best.steps, wedgeZone: wedge }
}

const ATTACK_STAND_ZONES: HexZone[] = ['center', 0, 1, 2, 3, 4, 5]

/** Centre + six wedges via pickPlayerAttackStand (deduped stand+wedge). */
export function enumeratePlayerAttackStands(
  attacker: CombatStack,
  target: CombatStack,
  targetHoverHex: Axial,
  reachable: Map<string, Axial[]>,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  stacks: CombatStack[],
  allowFriendly: boolean,
): { stand: Axial; steps: Axial[]; wedgeZone?: number }[] {
  const seen = new Set<string>()
  const out: { stand: Axial; steps: Axial[]; wedgeZone?: number }[] = []
  for (const zone of ATTACK_STAND_ZONES) {
    const pick = pickPlayerAttackStand(
      attacker,
      target,
      targetHoverHex,
      zone,
      reachable,
      catalog,
      tiles,
      stacks,
      allowFriendly,
    )
    if (!pick) {
      continue
    }
    const dedupeKey = `${hexKey(pick.stand.q, pick.stand.r)}|${pick.wedgeZone ?? 'center'}`
    if (seen.has(dedupeKey)) {
      continue
    }
    seen.add(dedupeKey)
    out.push(pick)
  }
  return out
}

export function combatStrikeIntentFromStand(
  attacker: CombatStack,
  target: CombatStack,
  stand: Axial,
  steps: Axial[],
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  allowFriendly: boolean,
  footprintAimHex?: Axial | null,
  pointerWedge?: number | null,
): CombatHover {
  const unit = unitById(catalog, attacker.unitId)
  const shape = unitAttackShape(unit)
  const aim =
    footprintAimHex ??
    closestTargetFootprintHex(stand, attacker, target, catalog)
  const wedgeZone =
    pointerWedge != null
      ? pointerWedge
      : usesDirectionWedges(shape.shape)
        ? hexWedgeZone(stand, aim)
        : undefined
  return {
    ...attackHover(
      attacker,
      aim,
      steps,
      target.id,
      battle,
      catalog,
      tiles,
      undefined,
      wedgeZone,
    ),
    arrowDeg: wedgeZone != null ? wedgeZone * 60 : undefined,
    allowFriendly,
  }
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
  const reachable = combatMovementReachable(
    attacker,
    battle,
    tiles,
    catalog,
    costAdjust,
  )
  const strikeTarget = enemy ?? healAlly
  const trapCfg = unitTrapConfig(unit)
  if (trapCfg) {
    if (occupant && !isSelf) {
      const steps = stepsToward(
        hover,
        reachable,
        from,
        budget,
        tiles,
        kind,
        occupied,
        spec,
        attacker,
        catalog,
        passableMoat,
        stopOnly,
        landOccupied,
        costAdjust,
        geBlocks,
      )
      return steps ? moveTowardHover(from, steps) : null
    }
    const placement = bestTrapPlacementStand(
      attacker,
      hover,
      reachable,
      from,
      battle,
      catalog,
      tiles,
    )
    if (placement) {
      return {
        ...attackHover(
          attacker,
          hover,
          placement.steps,
          null,
          battle,
          catalog,
          tiles,
        ),
        impactKeys: trapBlastImpactKeys(hover, trapCfg.blastRadius, tiles),
        aimHex: hover,
      }
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
      attacker,
      catalog,
      passableMoat,
      stopOnly,
      landOccupied,
      costAdjust,
      geBlocks,
    )
    return steps ? moveTowardHover(from, steps) : null
  }

  if (isSelf) {
    if (shapePulsesOnMove(shape.shape) && !isUnitAttackBlocked(attacker, catalog)) {
      const impact = impactPreview(attacker, from, from, battle, catalog, tiles)
      return {
        icon: attackIconFor(unit),
        q: from.q,
        r: from.r,
        steps: [],
        attackTargetId: null,
        fire: true,
        afterMove: null,
        impactKeys: impact.impactKeys,
        aimHex: from,
      }
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
    if (!shapeIsUntargeted(shape.shape) && !shapePulsesOnMove(shape.shape)) {
      return unitIsStationary(unit) ? null : stayHover(from)
    }
  }

  if (shape.pullTarget && enemy) {
    const steps = stepsToward(
      hover,
      reachable,
      from,
      budget,
      tiles,
      kind,
      occupied,
      spec,
      attacker,
      catalog,
      passableMoat,
      stopOnly,
      landOccupied,
      costAdjust,
      geBlocks,
    )
    const stand = actingStand(from, steps ?? [])
    const ghost = { ...attacker, q: stand.q, r: stand.r }
    const aim = { q: enemy.q, r: enemy.r }
    const pullNow = isValidPullAttackTarget(
      ghost,
      enemy,
      catalog,
      tiles,
      battle.stacks,
    )
    const reachNow = targetInNormalAttackReach(
      ghost,
      enemy,
      catalog,
      tiles,
      battle.stacks,
    )
    if (pullNow || reachNow) {
      const pulseKeys = impactPreview(
        ghost,
        stand,
        stand,
        battle,
        catalog,
        tiles,
      ).impactKeys
      return {
        ...attackHover(
          ghost,
          aim,
          steps ?? [],
          enemy.id,
          battle,
          catalog,
          tiles,
        ),
        aimHex: aim,
        impactKeys: pulseKeys,
        pullLandingKeys: pullNow
          ? pullLandingPreviewKeys(battle, ghost, enemy, catalog, tiles)
          : [],
      }
    }
    if (steps) {
      return moveTowardHover(from, steps)
    }
    const approach = bestApproachToward(from, aim, reachable)
    return approach ? moveTowardHover(from, approach.steps) : null
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
        attacker,
        catalog,
        passableMoat,
        stopOnly,
        landOccupied,
        costAdjust,
        geBlocks,
      )
      if (!steps) {
        return null
      }
      return moveTowardHover(from, steps)
    }
  }

  if (shapeIsUntargeted(shape.shape)) {
    const targetOnHex = enemy ?? healAlly
    if (targetOnHex) {
      const steps =
        stepsToward(
          hover,
          reachable,
          from,
          budget,
          tiles,
          kind,
          occupied,
          spec,
          attacker,
          catalog,
          passableMoat,
          stopOnly,
          landOccupied,
          costAdjust,
          geBlocks,
        ) ?? []
      const stand = actingStand(from, steps)
      if (
        hasLineOfSight(
          stand,
          { q: targetOnHex.q, r: targetOnHex.r },
          tiles,
          battle.stacks,
          catalog,
        )
      ) {
        return attackHover(
          attacker,
          hover,
          steps,
          targetOnHex.id,
          battle,
          catalog,
          tiles,
        )
      }
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
      attacker,
      catalog,
      passableMoat,
      stopOnly,
      landOccupied,
      costAdjust,
      geBlocks,
    )
    return steps ? moveTowardHover(from, steps) : null
  }

  if (strikeTarget) {
    const picked = pickPlayerAttackStand(
      attacker,
      strikeTarget,
      hover,
      zone,
      reachable,
      catalog,
      tiles,
      battle.stacks,
      healAlly != null,
    )
    if (picked) {
      return {
        ...combatStrikeIntentFromStand(
          attacker,
          strikeTarget,
          picked.stand,
          picked.steps,
          battle,
          catalog,
          tiles,
          healAlly != null,
          hover,
          picked.wedgeZone,
        ),
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
      const approach = bestApproachTowardTargetFootprint(
        attacker,
        enemy,
        catalog,
        reachable,
      )
      if (approach) {
        const aimAtEnemy = closestTargetFootprintHex(
          approach.hex,
          attacker,
          enemy,
          catalog,
        )
        const ghost = { ...attacker, q: approach.hex.q, r: approach.hex.r }
        const inRange =
          shape.shape === 'aoe'
            ? attackDeliveryOkFromStand(
                approach.hex,
                aimAtEnemy,
                ghost,
                catalog,
                tiles,
                battle.stacks,
              )
            : attackCanHitTargetAtStand(
                approach.hex,
                ghost,
                enemy,
                catalog,
                tiles,
                battle.stacks,
                healAlly != null,
              )
        if (inRange) {
          return combatStrikeIntentFromStand(
            attacker,
            enemy,
            approach.hex,
            approach.steps,
            battle,
            catalog,
            tiles,
            healAlly != null,
            hover,
            zone === 'center' ? undefined : (zone as number),
          )
        }
        return moveTowardHover(from, approach.steps)
      }
      const legacy = bestApproachToward(
        from,
        { q: enemy.q, r: enemy.r },
        reachable,
      )
      return legacy ? moveTowardHover(from, legacy.steps) : null
    }
  }

  // Unit aims (incl. beam) via strikeTarget / bestAttackStand; no empty-ground beam.
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
    attacker,
    catalog,
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
  if (isUnitAttackBlocked(stack, catalog)) {
    return null
  }
  const target = pickNearestUnitAnySide(stack, battle, catalog, random)
  if (!target) {
    return null
  }
  const unit = unitById(catalog, stack.unitId)
  const shape = unitAttackShape(unit)
  const reachable = combatMovementReachable(stack, battle, tiles, catalog)
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
  const aim = closestTargetFootprintHex(stand, stack, target, catalog)
  const wedgeZone = usesDirectionWedges(shape.shape)
    ? hexWedgeZone(stand, aim)
    : undefined
  return {
    icon: attackIconFor(unit),
    q: stand.q,
    r: stand.r,
    steps,
    attackTargetId: target.id,
    fire: true,
    afterMove: null,
    impactKeys: [],
    aimHex: aim,
    arrowDeg: wedgeZone != null ? wedgeZone * 60 : undefined,
    allowFriendly: true,
  }
}

export type AutoActTurnPlan =
  | { kind: 'attack'; target: CombatStack }
  | { kind: 'intent'; intent: CombatHover; logPrefix: string[] }
  | { kind: 'skip' }

function autoActPolicyTargets(
  attacker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
): CombatStack[] {
  return battle.stacks.filter((row) => {
    if (row.qty <= 0) {
      return false
    }
    return attackTargetPolicyOk(attacker, row, catalog, false)
  })
}

function autoActRandomPick<T>(items: T[], random: () => number): T | null {
  if (items.length === 0) {
    return null
  }
  const i = Math.min(items.length - 1, Math.floor(random() * items.length))
  return items[i] ?? null
}

function autoActMoveAttackIntent(
  attacker: CombatStack,
  target: CombatStack,
  steps: Axial[],
  catalog: ReferenceCatalog,
): CombatHover {
  const stand = actingStand({ q: attacker.q, r: attacker.r }, steps)
  const aimHex = closestTargetFootprintHex(stand, attacker, target, catalog)
  const unit = unitById(catalog, attacker.unitId)
  return {
    icon: attackIconFor(unit),
    q: aimHex.q,
    r: aimHex.r,
    steps,
    attackTargetId: target.id,
    fire: true,
    afterMove: null,
    impactKeys: [],
    aimHex,
  }
}

function autoActMoveOnlyIntent(attacker: CombatStack, steps: Axial[]): CombatHover {
  const dest = actingStand({ q: attacker.q, r: attacker.r }, steps)
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

function bestApproachTowardEnemyFootprint(
  attacker: CombatStack,
  target: CombatStack,
  reachable: Map<string, Axial[]>,
  catalog: ReferenceCatalog,
): { hex: Axial; steps: Axial[] } | null {
  let best: { hex: Axial; steps: Axial[] } | null = null
  let bestDist = Infinity
  let bestLen = Infinity
  for (const [key, steps] of reachable) {
    if (steps.length === 0) {
      continue
    }
    const [qs, rs] = key.split(',')
    const hex = { q: Number(qs), r: Number(rs) }
    const dist = minFootprintHexDistance(hex, attacker, target, catalog)
    if (dist < bestDist || (dist === bestDist && steps.length < bestLen)) {
      best = { hex, steps }
      bestDist = dist
      bestLen = steps.length
    }
  }
  return best
}

function autoActReachable(
  attacker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  heroes?: CombatHeroes,
): Map<string, Axial[]> {
  const unit = unitById(catalog, attacker.unitId)
  const kind = moveKindForUnit(unit, catalog)
  const costAdjust = deathKnightShadowMoveAdjust(
    battle,
    catalog,
    heroes,
    attacker.side,
    kind,
  )
  return combatMovementReachable(
    attacker,
    battle,
    tiles,
    catalog,
    costAdjust,
  )
}

function planRandomEnemyAutoTurn(
  attacker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  heroes: CombatHeroes | undefined,
  random: () => number,
): AutoActTurnPlan {
  const unit = unitById(catalog, attacker.unitId)
  const name = unit?.name ?? 'Unit'
  const pool = autoActPolicyTargets(attacker, battle, catalog)
  if (pool.length === 0) {
    return { kind: 'skip' }
  }

  const inRange = pool.filter((row) =>
    isValidAttackTarget(attacker, row, catalog, tiles, battle.stacks),
  )
  const now = autoActRandomPick(inRange, random)
  if (now) {
    return { kind: 'attack', target: now }
  }

  if (unitIsStationary(unit) || (stackMoveSpeed(attacker, catalog) ?? 0) <= 0) {
    return { kind: 'skip' }
  }

  const reachable = autoActReachable(attacker, battle, catalog, tiles, heroes)
  const canHitAfterMove = pool.filter((target) =>
    bestAttackStand(
      attacker,
      target,
      reachable,
      catalog,
      tiles,
      battle.stacks,
    ),
  )
  const moveAttackTarget = autoActRandomPick(canHitAfterMove, random)
  if (moveAttackTarget) {
    const stand = bestAttackStand(
      attacker,
      moveAttackTarget,
      reachable,
      catalog,
      tiles,
      battle.stacks,
    )
    if (stand) {
      const steps = reachable.get(hexKey(stand.q, stand.r)) ?? []
      const targetName =
        unitById(catalog, moveAttackTarget.unitId)?.name ?? 'enemy'
      return {
        kind: 'intent',
        intent: autoActMoveAttackIntent(
          attacker,
          moveAttackTarget,
          steps,
          catalog,
        ),
        logPrefix: [`${name} moves to attack ${targetName}`],
      }
    }
  }

  const toward = autoActRandomPick(pool, random)
  if (!toward) {
    return { kind: 'skip' }
  }
  const approach = bestApproachTowardEnemyFootprint(
    attacker,
    toward,
    reachable,
    catalog,
  )
  if (!approach) {
    return { kind: 'skip' }
  }
  const targetName = unitById(catalog, toward.unitId)?.name ?? 'enemy'
  return {
    kind: 'intent',
    intent: autoActMoveOnlyIntent(attacker, approach.steps),
    logPrefix: [`${name} moves toward ${targetName}`],
  }
}

export function planAutoTargetTurn(
  attacker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  heroes?: CombatHeroes,
  random: () => number = Math.random,
): AutoActTurnPlan {
  const mode = unitAutoTarget(unitById(catalog, attacker.unitId))
  if (!mode) {
    return { kind: 'skip' }
  }
  if (mode === 'random_enemy' || mode === 'random_enemy_los') {
    return planRandomEnemyAutoTurn(
      attacker,
      battle,
      catalog,
      tiles,
      heroes,
      random,
    )
  }
  const target = pickAutoAttackTarget(
    attacker,
    battle,
    catalog,
    tiles,
    random,
  )
  if (!target) {
    return { kind: 'skip' }
  }
  return { kind: 'attack', target }
}

export function canAutoActThisTurn(
  attacker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  heroes?: CombatHeroes,
): boolean {
  return (
    planAutoTargetTurn(attacker, battle, catalog, tiles, heroes).kind !== 'skip'
  )
}
