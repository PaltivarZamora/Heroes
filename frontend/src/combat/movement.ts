import { spendMovement, type Axial } from '../hex/hero'
import { findPathOnBoard, neighborHexes, reachableWithin } from '../hex/pathfinding'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import {
  DUMP_REMAINING_MOVE_COST,
  unitById,
  unitIsStationary,
} from '../town/catalog'
import type { CombatBattle, CombatStack, CombatTile } from './battle'
import { closedDrawbridgeKeys, openBridgeMoatKeys } from './siege'
import {
  combatBodySize,
  footprintFits,
  footprintStep,
  occupancyKey,
  occupiedHexes,
  stackFootprint,
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

/** Entry cost for one combat hex. Null = cannot enter. */
export function combatEnterCost(
  tile: CombatTile | undefined,
  kind: MoveKind,
  passableMoatKeys?: ReadonlySet<string>,
): number | null {
  if (!tile) {
    return null
  }
  if (tile.blocked) {
    if (
      kind === 'submerge' &&
      (tile.terrain === 'Water' || tile.terrain === 'Shallows')
    ) {
      return 1
    }
    return null
  }
  if (
    passableMoatKeys?.has(hexKey(tile.q, tile.r))
  ) {
    return 1
  }
  if (kind === 'flying' || kind === 'hover') {
    return 1
  }
  if (kind === 'submerge') {
    if (tile.terrain === 'Water' || tile.terrain === 'Shallows') {
      return 1
    }
    return tile.movementCostMultiplier
  }
  return tile.movementCostMultiplier
}

function isAirborne(kind: MoveKind): boolean {
  return kind === 'flying' || kind === 'hover'
}

export function occupiedForMover(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  exceptId: string | undefined,
  kind: MoveKind,
): Set<string> {
  return occupiedHexes(
    stacks,
    catalog,
    exceptId,
    [],
    isAirborne(kind),
  )
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

/**
 * Gold-preview steps toward `to`, truncated at remaining Speed — same rule as
 * World `movementSteps`. Occupied hexes are not landed on. A multi-hex
 * mover also cannot stand where any of its extra hexes would overlap.
 */
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
): Axial[] {
  if (budget <= 1e-9 || (from.q === to.q && from.r === to.r)) {
    return []
  }
  const enterCost = stackEnterCost(tileMap(tiles), kind, passableMoatKeys)
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
  return steps
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
): Map<string, Axial[]> {
  const enterCost = stackEnterCost(tileMap(tiles), kind, passableMoatKeys)
  const paths = reachableWithin(from, budget, enterCost, occupied, stopOnlyKeys)
  const out = new Map<string, Axial[]>()
  out.set(hexKey(from.q, from.r), [])
  for (const [key, path] of paths) {
    const steps = path.slice(1)
    if (steps.some((hex) => !standFits(hex, enterCost, occupied, spec))) {
      continue
    }
    out.set(key, steps)
  }
  return out
}

export function canCombatStep(
  stack: CombatStack,
  battle: CombatBattle,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
): boolean {
  const unit = unitById(catalog, stack.unitId)
  if (unitIsStationary(unit) || unit?.speed == null) {
    return false
  }
  const kind = moveKindForUnit(unit, catalog)
  const occupied = occupiedForMover(battle.stacks, catalog, stack.id, kind)
  const passable = openBridgeMoatKeys(battle, catalog, tiles)
  const enterCost = stackEnterCost(tileMap(tiles), kind, passable)
  const spec = footprintSpecFor(stack, catalog)
  return neighborHexes({ q: stack.q, r: stack.r }).some((next) =>
    standFits(next, enterCost, occupied, spec),
  )
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
