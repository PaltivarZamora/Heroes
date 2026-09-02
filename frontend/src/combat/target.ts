import type { Axial } from '../hex/hero'
import { hexDistance } from '../hex/pathfinding'
import type { ReferenceCatalog } from '../town/catalog'
import {
  shapeIsUntargeted,
  shapePulsesOnMove,
  unitAttackShape,
  unitById,
} from '../town/catalog'
import {
  attackIconFor,
  attackRangeFrom,
  type AttackIconKind,
} from './attack'
import type { CombatBattle, CombatStack, CombatTile } from './battle'
import {
  combatPathSteps,
  combatReachable,
  footprintSpecFor,
  hexKey,
  moveKindForUnit,
  occupiedHexes,
  stackOccupyingHex,
} from './movement'
import { breathHexes, hasLineOfSight, previewImpactKeys } from './shapes'

export type TargetIconKind = 'move' | 'aoe' | AttackIconKind

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
) {
  const unit = unitById(catalog, stack.unitId)
  const kind = moveKindForUnit(unit, catalog)
  const occupied = occupiedHexes(battle.stacks, catalog, stack.id)
  const budget = unit?.speed ?? 0
  const from = { q: stack.q, r: stack.r }
  const spec = footprintSpecFor(stack, catalog)
  return { unit, kind, occupied, budget, from, spec }
}

function impactFrom(
  attacker: CombatStack,
  stand: Axial,
  aim: Axial,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): string[] {
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
): Axial | null {
  if (attacker.side === target.side || attacker.id === target.id) {
    return null
  }
  const aim = { q: target.q, r: target.r }
  let best: Axial | null = null
  let bestSteps = Infinity
  for (const [key, steps] of reachable) {
    const [qs, rs] = key.split(',')
    const from = { q: Number(qs), r: Number(rs) }
    if (!attackRangeFrom(from, target, catalog, attacker.unitId)) {
      continue
    }
    if (!hasLineOfSight(from, aim, tiles)) {
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
): Axial | null {
  if (attacker.side === target.side || attacker.id === target.id) {
    return null
  }
  const rows = unitAttackShape(unitById(catalog, attacker.unitId)).rows
  const aim = { q: target.q, r: target.r }
  let best: Axial | null = null
  let bestDist = Infinity
  let bestSteps = Infinity
  for (const [key, steps] of reachable) {
    const [qs, rs] = key.split(',')
    const from = { q: Number(qs), r: Number(rs) }
    if (!attackRangeFrom(from, target, catalog, attacker.unitId)) {
      continue
    }
    if (!hasLineOfSight(from, aim, tiles)) {
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
): Axial | null {
  let best: Axial | null = null
  let bestSteps = Infinity
  for (const [key, steps] of reachable) {
    const [qs, rs] = key.split(',')
    const from = { q: Number(qs), r: Number(rs) }
    if (!inMaxRange(from, aim, maxRange)) {
      continue
    }
    if (!hasLineOfSight(from, aim, tiles)) {
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
): boolean {
  const unit = unitById(catalog, attacker.unitId)
  const spec = unitAttackShape(unit)
  if (shapePulsesOnMove(spec.shape)) {
    return false
  }
  if (shapeIsUntargeted(spec.shape)) {
    return battle.stacks.some(
      (row) =>
        row.side !== attacker.side &&
        row.qty > 0 &&
        hasLineOfSight(
          { q: attacker.q, r: attacker.r },
          { q: row.q, r: row.r },
          tiles,
        ),
    )
  }
  const { kind, occupied, budget, from, spec: foot } = moverStats(
    attacker,
    battle,
    catalog,
  )
  const reachable = combatReachable(from, budget, tiles, kind, occupied, foot)
  if (spec.shape === 'beam' || spec.shape === 'aoe') {
    const maxRange = unit?.max_range ?? 1
    return tiles.some(
      (tile) =>
        bestRangeStand(
          reachable,
          { q: tile.q, r: tile.r },
          maxRange,
          tiles,
        ) != null,
    )
  }
  if (spec.shape === 'breath') {
    return battle.stacks.some(
      (row) => bestBreathStand(attacker, row, reachable, catalog, tiles) != null,
    )
  }
  return battle.stacks.some(
    (row) => bestAttackStand(attacker, row, reachable, catalog, tiles) != null,
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
  )
  return truncated.length > 0 ? truncated : null
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
): CombatHover | null {
  const { unit, kind, occupied, budget, from, spec } = moverStats(
    attacker,
    battle,
    catalog,
  )
  const shape = unitAttackShape(unit)
  const occupant = stackOccupyingHex(
    battle.stacks,
    hover.q,
    hover.r,
    catalog,
  )
  const isSelf = occupant?.id === attacker.id
  const enemy =
    occupant && !isSelf && occupant.side !== attacker.side ? occupant : null
  const reachable = combatReachable(from, budget, tiles, kind, occupied, spec)
  const maxRange = unit?.max_range ?? 1

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
      return stayHover(from)
    }
  }

  if (usesDirectionWedges(shape.shape)) {
    const steps = reachable.get(hexKey(hover.q, hover.r))
    if (occupant && !isSelf) {
      return null
    }
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
      return moveOnly()
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
      foe.side !== attacker.side &&
      attackRangeFrom(hover, foe, catalog, attacker.unitId) &&
      hasLineOfSight(hover, { q: foe.q, r: foe.r }, tiles) &&
      (shape.shape !== 'breath' ||
        breathHitsTarget(hover, aim, shape.rows))
    if (!validFoe || !foe) {
      return moveOnly()
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
    }
  }

  if (shape.shape === 'aoe') {
    const stand = bestRangeStand(reachable, hover, maxRange, tiles)
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

  if (shapePulsesOnMove(shape.shape)) {
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

  if (shapeIsUntargeted(shape.shape)) {
    if (enemy && hasLineOfSight(from, { q: enemy.q, r: enemy.r }, tiles)) {
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
    )
    return steps ? moveTowardHover(from, steps) : null
  }

  if (enemy) {
    const stand =
      shape.shape === 'breath'
        ? bestBreathStand(attacker, enemy, reachable, catalog, tiles)
        : bestAttackStand(attacker, enemy, reachable, catalog, tiles)
    if (stand) {
      return attackHover(
        attacker,
        { q: enemy.q, r: enemy.r },
        reachable.get(hexKey(stand.q, stand.r)) ?? [],
        enemy.id,
        battle,
        catalog,
        tiles,
      )
    }
    const steps = combatPathSteps(
      from,
      hover,
      budget,
      tiles,
      kind,
      occupied,
      spec,
    )
    if (steps.length === 0) {
      return null
    }
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

  if (shape.shape === 'beam') {
    const moveSteps = reachable.get(hexKey(hover.q, hover.r))
    const canMove = moveSteps != null && moveSteps.length > 0
    if (
      !canMove &&
      inMaxRange(from, hover, maxRange) &&
      !occupant &&
      hasLineOfSight(from, hover, tiles)
    ) {
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
  }

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
  )
  return steps ? moveTowardHover(from, steps) : null
}
