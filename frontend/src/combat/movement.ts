import { spendMovement, type Axial } from '../hex/hero'
import { findPathOnBoard, reachableWithin } from '../hex/pathfinding'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import {
  DUMP_REMAINING_MOVE_COST,
  unitAttackShape,
  unitById,
  unitIsStationary,
} from '../town/catalog'
import type { CombatBattle, CombatStack, CombatTile } from './battle'
import { stackMoveSpeed } from './battle'
import { closedDrawbridgeKeys, openBridgeMoatKeys } from './siege'
import { hasLineOfSight } from './shapes'
import { tombstoneOccupancyBodies } from './tombstone'
import {
  combatBodySize,
  footprintFits,
  footprintStep,
  occupancyKey,
  occupiedHexes,
  stackFootprint,
  type OccupancyBody,
} from './occupancy'

export {
  combatBodySize as combatStackCells,
  occupiedHexes,
  stackFootprint,
  stackOccupyingHex,
} from './occupancy'

export type MoveKind = 'ground' | 'flying' | 'hover' | 'submerge'

export function hexKey(q: number, r: number): string {
  return occupancyKey(q, r)
}

export function moveKindForUnit(
  unit: UnitRow | null | undefined,
  catalog: ReferenceCatalog,
): MoveKind {
  if (unit?.move_type_id == null) {
    return 'ground'
  }
  const name =
    catalog.move_type
      .find((row) => row.id === unit.move_type_id)
      ?.name.toLowerCase() ?? ''
  if (name.includes('fly')) {
    return 'flying'
  }
  if (name.includes('hover')) {
    return 'hover'
  }
  if (name.includes('submerge')) {
    return 'submerge'
  }
  if (unit.move_type_id === 2) {
    return 'flying'
  }
  if (unit.move_type_id === 3) {
    return 'submerge'
  }
  if (unit.move_type_id === 4) {
    return 'hover'
  }
  return 'ground'
}

export function moveVerb(kind: MoveKind): string {
  if (kind === 'flying') {
    return 'flew'
  }
  if (kind === 'hover') {
    return 'hovered'
  }
  if (kind === 'submerge') {
    return 'submerged'
  }
  return 'moved'
}

function isAirborne(kind: MoveKind): boolean {
  return kind === 'flying' || kind === 'hover'
}

/**
 * Traversal cost. Null = cannot cross this hex mid-path.
 * Flying/Hover may cross `is_blocked` terrain and ground-effect blockers
 * (Void, Barricade, etc.), including ones that also block LOS — landing is
 * still forbidden via combatCanLandOn.
 */
export function combatEnterCost(
  tile: CombatTile | undefined,
  kind: MoveKind,
  passableMoatKeys?: ReadonlySet<string>,
): number | null {
  if (!tile) {
    return null
  }
  if (tile.blocked) {
    if (isAirborne(kind)) {
      return 1
    }
    return null
  }
  if (passableMoatKeys?.has(hexKey(tile.q, tile.r))) {
    return 1
  }
  if (isAirborne(kind)) {
    return 1
  }
  if (kind === 'submerge') {
    if (tile.terrain === 'Shallows') {
      return 1
    }
    return tile.movementCostMultiplier
  }
  return tile.movementCostMultiplier
}

/**
 * `is_blocked` / GE movement blockers are never a legal landing, for any
 * move type — Flying/Hover may path over them but cannot stop there.
 */
export function combatCanLandOn(
  tile: CombatTile | undefined,
  kind: MoveKind,
  passableMoatKeys?: ReadonlySet<string>,
): boolean {
  if (!tile || tile.blocked) {
    return false
  }
  return combatEnterCost(tile, kind, passableMoatKeys) != null
}

export function occupiedForMover(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  exceptId: string | undefined,
  kind: MoveKind,
  extras: OccupancyBody[] = [],
): Set<string> {
  // Flying/Hover may path through Wall/Shooter hexes, but must not land on them.
  return occupiedHexes(
    stacks,
    catalog,
    exceptId,
    extras,
    isAirborne(kind),
  )
}

/** Landing occupancy always counts Wall/Shooter bodies. */
export function landingOccupiedForMover(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  exceptId: string | undefined,
  extras: OccupancyBody[] = [],
): Set<string> {
  return occupiedHexes(stacks, catalog, exceptId, extras, false)
}

export function stopOnlyForMover(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  kind: MoveKind,
): Set<string> {
  if (isAirborne(kind)) {
    return new Set()
  }
  return closedDrawbridgeKeys(
    battle.stacks,
    catalog,
    tiles,
    battle.siegeGate,
  )
}

function tileMap(tiles: CombatTile[]): Map<string, CombatTile> {
  return new Map(tiles.map((tile) => [hexKey(tile.q, tile.r), tile]))
}

function stackEnterCost(
  tiles: Map<string, CombatTile>,
  kind: MoveKind,
  passableMoatKeys?: ReadonlySet<string>,
): (q: number, r: number) => number | null {
  return (q, r) =>
    combatEnterCost(tiles.get(hexKey(q, r)), kind, passableMoatKeys)
}

export type FootprintSpec = {
  size: number
  step: Axial
  ignore: ReadonlySet<string>
}

export function footprintSpecFor(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): FootprintSpec {
  const size = combatBodySize(stack, catalog)
  const step = footprintStep(stack.side)
  const ignore = new Set(
    stackFootprint(stack, catalog).map((hex) => hexKey(hex.q, hex.r)),
  )
  return { size, step, ignore }
}

function standFits(
  origin: Axial,
  enterCost: (q: number, r: number) => number | null,
  occupied: ReadonlySet<string>,
  spec?: FootprintSpec,
): boolean {
  return footprintFits(
    origin,
    spec?.size ?? 1,
    spec?.step ?? { q: 0, r: 0 },
    occupied,
    enterCost,
    spec?.ignore,
  )
}

function landFits(
  origin: Axial,
  tiles: Map<string, CombatTile>,
  kind: MoveKind,
  occupied: ReadonlySet<string>,
  spec: FootprintSpec | undefined,
  passableMoatKeys?: ReadonlySet<string>,
): boolean {
  const landCost = (q: number, r: number): number | null => {
    const tile = tiles.get(hexKey(q, r))
    if (!combatCanLandOn(tile, kind, passableMoatKeys)) {
      return null
    }
    return combatEnterCost(tile, kind, passableMoatKeys)
  }
  return footprintFits(
    origin,
    spec?.size ?? 1,
    spec?.step ?? { q: 0, r: 0 },
    occupied,
    landCost,
    spec?.ignore,
  )
}

/**
 * Gold-preview steps toward `to`, truncated at remaining Speed — same rule as
 * World `movementSteps`. Occupied hexes are not landed on. A multi-hex
 * mover also cannot stand where any of its extra hexes would overlap.
 * `landOccupied` may be stricter than path `occupied` (e.g. tombstones:
 * path through OK, cannot end the turn on them).
 */
export type EnterCostAdjust = (
  q: number,
  r: number,
  cost: number,
) => number

function withCostAdjust(
  base: (q: number, r: number) => number | null,
  adjust?: EnterCostAdjust,
): (q: number, r: number) => number | null {
  if (!adjust) {
    return base
  }
  return (q, r) => {
    const cost = base(q, r)
    if (cost == null || cost === DUMP_REMAINING_MOVE_COST) {
      return cost
    }
    return adjust(q, r, cost)
  }
}

export function combatPathSteps(
  from: Axial,
  to: Axial,
  budget: number,
  tiles: CombatTile[],
  kind: MoveKind,
  occupied: ReadonlySet<string>,
  spec?: FootprintSpec,
  passableMoatKeys?: ReadonlySet<string>,
  stopOnlyKeys?: ReadonlySet<string>,
  landOccupied?: ReadonlySet<string>,
  costAdjust?: EnterCostAdjust,
): Axial[] {
  if (budget <= 1e-9 || (from.q === to.q && from.r === to.r)) {
    return []
  }
  const tilesByKey = tileMap(tiles)
  const enterCost = withCostAdjust(
    stackEnterCost(tilesByKey, kind, passableMoatKeys),
    costAdjust,
  )
  const destKey = hexKey(to.q, to.r)
  const destOccupied = occupied.has(destKey)
  const blocked = new Set(occupied)
  if (destOccupied) {
    blocked.delete(destKey)
  }
  if (stopOnlyKeys) {
    for (const key of stopOnlyKeys) {
      if (key !== destKey) {
        blocked.add(key)
      }
    }
  }
  const path = findPathOnBoard(from, to, enterCost, blocked)
  if (!path || path.length <= 1) {
    return []
  }
  let body = path.slice(1)
  if (destOccupied) {
    const last = body[body.length - 1]
    if (last && hexKey(last.q, last.r) === destKey) {
      body = body.slice(0, -1)
    }
  }
  // Transit uses path occupancy; landing may forbid extra no-stop hexes.
  const landingOccupied = landOccupied ?? occupied
  const steps: Axial[] = []
  let mp = budget
  for (const hex of body) {
    const cost = enterCost(hex.q, hex.r)
    if (cost == null) {
      break
    }
    if (cost === DUMP_REMAINING_MOVE_COST) {
      if (mp <= 1e-9) {
        break
      }
      if (!standFits(hex, enterCost, occupied, spec)) {
        break
      }
      if (!landFits(hex, tilesByKey, kind, landingOccupied, spec, passableMoatKeys)) {
        break
      }
      steps.push(hex)
      break
    }
    if (mp + 1e-9 < cost) {
      break
    }
    if (!standFits(hex, enterCost, occupied, spec)) {
      break
    }
    steps.push(hex)
    mp = spendMovement(mp, cost)
  }
  while (steps.length > 0) {
    const last = steps[steps.length - 1]
    if (
      last &&
      landFits(last, tilesByKey, kind, landingOccupied, spec, passableMoatKeys)
    ) {
      break
    }
    steps.pop()
  }
  return steps
}

/** Exact-reach leg for waypoint staging (null if the dest cannot be afforded). */
export function resolveCombatWaypointLeg(
  from: Axial,
  to: Axial,
  budget: number,
  tiles: CombatTile[],
  kind: MoveKind,
  occupied: ReadonlySet<string>,
  spec?: FootprintSpec,
  passableMoatKeys?: ReadonlySet<string>,
  stopOnlyKeys?: ReadonlySet<string>,
  landOccupied?: ReadonlySet<string>,
  costAdjust?: EnterCostAdjust,
): { steps: Axial[]; remaining: number } | null {
  if (from.q === to.q && from.r === to.r) {
    return null
  }
  const steps = combatPathSteps(
    from,
    to,
    budget,
    tiles,
    kind,
    occupied,
    spec,
    passableMoatKeys,
    stopOnlyKeys,
    landOccupied,
    costAdjust,
  )
  if (steps.length === 0) {
    return null
  }
  const last = steps[steps.length - 1]
  if (!last || last.q !== to.q || last.r !== to.r) {
    return null
  }
  const tilesByKey = tileMap(tiles)
  const enterCost = withCostAdjust(
    stackEnterCost(tilesByKey, kind, passableMoatKeys),
    costAdjust,
  )
  let mp = budget
  for (const hex of steps) {
    const cost = enterCost(hex.q, hex.r)
    if (cost == null) {
      return null
    }
    if (cost === DUMP_REMAINING_MOVE_COST) {
      mp = 0
      break
    }
    mp = spendMovement(mp, cost)
  }
  return { steps, remaining: mp }
}

/**
 * Hexes this stack can stand on this turn, including its current hex
 * (empty step list). Values are the walk steps from the origin.
 */
export function combatReachable(
  from: Axial,
  budget: number,
  tiles: CombatTile[],
  kind: MoveKind,
  occupied: ReadonlySet<string>,
  spec?: FootprintSpec,
  passableMoatKeys?: ReadonlySet<string>,
  stopOnlyKeys?: ReadonlySet<string>,
  landOccupied?: ReadonlySet<string>,
  costAdjust?: EnterCostAdjust,
): Map<string, Axial[]> {
  const tilesByKey = tileMap(tiles)
  const enterCost = withCostAdjust(
    stackEnterCost(tilesByKey, kind, passableMoatKeys),
    costAdjust,
  )
  const paths = reachableWithin(from, budget, enterCost, occupied, stopOnlyKeys)
  const landingOccupied = landOccupied ?? occupied
  const out = new Map<string, Axial[]>()
  out.set(hexKey(from.q, from.r), [])
  for (const [key, path] of paths) {
    const steps = path.slice(1)
    // Transit: path occupancy only (tombstones are passable mid-path).
    if (steps.some((hex) => !standFits(hex, enterCost, occupied, spec))) {
      continue
    }
    const dest = steps[steps.length - 1]
    if (
      dest &&
      !landFits(dest, tilesByKey, kind, landingOccupied, spec, passableMoatKeys)
    ) {
      continue
    }
    out.set(key, steps)
  }
  return out
}

/**
 * Blink movement: any landable hex with LOS (no Speed distance budget).
 * Steps are a single teleport hop to the destination.
 */
export function combatBlinkReachable(
  from: Axial,
  tiles: CombatTile[],
  kind: MoveKind,
  occupied: ReadonlySet<string>,
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  spec?: FootprintSpec,
  passableMoatKeys?: ReadonlySet<string>,
  landOccupied?: ReadonlySet<string>,
  requireLos = true,
): Map<string, Axial[]> {
  const tilesByKey = tileMap(tiles)
  const enterCost = stackEnterCost(tilesByKey, kind, passableMoatKeys)
  const landingOccupied = landOccupied ?? occupied
  const out = new Map<string, Axial[]>()
  out.set(hexKey(from.q, from.r), [])
  for (const tile of tiles) {
    const dest = { q: tile.q, r: tile.r }
    const key = hexKey(dest.q, dest.r)
    if (dest.q === from.q && dest.r === from.r) {
      continue
    }
    if (
      requireLos &&
      !hasLineOfSight(from, dest, tiles, stacks, catalog)
    ) {
      continue
    }
    if (
      !landFits(dest, tilesByKey, kind, landingOccupied, spec, passableMoatKeys)
    ) {
      continue
    }
    if (!standFits(dest, enterCost, landingOccupied, spec)) {
      continue
    }
    out.set(key, [dest])
  }
  return out
}

/** Walk budget reach, or blink LOS destinations when the unit has blink_movement. */
export function combatMovementReachable(
  stack: CombatStack,
  battle: CombatBattle,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
  costAdjust?: EnterCostAdjust,
): Map<string, Axial[]> {
  const unit = unitById(catalog, stack.unitId)
  if (unitIsStationary(unit) || unit?.speed == null) {
    const here = hexKey(stack.q, stack.r)
    return new Map([[here, []]])
  }
  const kind = moveKindForUnit(unit, catalog)
  const tombs = tombstoneOccupancyBodies(battle.tombstones)
  const occupied = occupiedForMover(battle.stacks, catalog, stack.id, kind)
  const landOccupied = landingOccupiedForMover(
    battle.stacks,
    catalog,
    stack.id,
    tombs,
  )
  const from = { q: stack.q, r: stack.r }
  const spec = footprintSpecFor(stack, catalog)
  const passable = openBridgeMoatKeys(battle, catalog, tiles)
  const stopOnly = stopOnlyForMover(battle, catalog, tiles, kind)
  const abilities = unitAttackShape(unit)
  if (abilities.blinkMovement) {
    return combatBlinkReachable(
      from,
      tiles,
      kind,
      occupied,
      battle.stacks,
      catalog,
      spec,
      passable,
      landOccupied,
      // Blink is LOS-constrained (requires_los); never unrestricted like Shadow Step.
      true,
    )
  }
  return combatReachable(
    from,
    stackMoveSpeed(stack, catalog) ?? 0,
    tiles,
    kind,
    occupied,
    spec,
    passable,
    stopOnly,
    landOccupied,
    costAdjust,
  )
}

export function canCombatStep(
  stack: CombatStack,
  battle: CombatBattle,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
  costAdjust?: EnterCostAdjust,
): boolean {
  const unit = unitById(catalog, stack.unitId)
  if (unitIsStationary(unit) || unit?.speed == null) {
    return false
  }
  if ((stackMoveSpeed(stack, catalog) ?? 0) <= 0) {
    return false
  }
  const reach = combatMovementReachable(
    stack,
    battle,
    tiles,
    catalog,
    costAdjust,
  )
  return reach.size > 1
}

export function movementLogLine(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  spaces: number,
): string {
  const unit = unitById(catalog, stack.unitId)
  const name = unit?.name ?? 'Unknown'
  const verb = moveVerb(moveKindForUnit(unit, catalog))
  return `${stack.qty} ${name} ${verb} ${spaces} spaces.`
}
