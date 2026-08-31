import { spendMovement, type Axial } from '../hex/hero'
import { findPathOnBoard, neighborHexes, reachableWithin } from '../hex/pathfinding'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import { unitById, unitHexFootprint } from '../town/catalog'
import type { CombatBattle, CombatStack, CombatTile } from './battle'

export type MoveKind = 'ground' | 'flying' | 'hover' | 'submerge'

export function hexKey(q: number, r: number): string {
  return `${q},${r}`
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
): number | null {
  if (!tile) {
    return null
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

/**
 * How many battlefield hexes this stack occupies. Defenders stay 2-wide
 * from the BR 4-5c visual test; everyone else follows `unit.hex_size`.
 */
export function combatStackCells(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): 1 | 2 {
  if (stack.side === 'def') {
    return 2
  }
  return unitHexFootprint(unitById(catalog, stack.unitId))
}

/** Primary hex plus the inward extra hex for a 2-hex footprint. */
export function stackFootprint(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): Axial[] {
  const origin = { q: stack.q, r: stack.r }
  if (combatStackCells(stack, catalog) === 1) {
    return [origin]
  }
  const extra =
    stack.side === 'def'
      ? { q: stack.q - 1, r: stack.r }
      : { q: stack.q + 1, r: stack.r }
  return [origin, extra]
}

export function occupiedHexes(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  exceptId?: string,
): Set<string> {
  const blocked = new Set<string>()
  for (const stack of stacks) {
    if (stack.id === exceptId) {
      continue
    }
    for (const hex of stackFootprint(stack, catalog)) {
      blocked.add(hexKey(hex.q, hex.r))
    }
  }
  return blocked
}

export function stackOccupyingHex(
  stacks: CombatStack[],
  q: number,
  r: number,
  catalog: ReferenceCatalog,
): CombatStack | null {
  const key = hexKey(q, r)
  return (
    stacks.find((stack) =>
      stackFootprint(stack, catalog).some(
        (hex) => hexKey(hex.q, hex.r) === key,
      ),
    ) ?? null
  )
}

function tileMap(tiles: CombatTile[]): Map<string, CombatTile> {
  return new Map(tiles.map((tile) => [hexKey(tile.q, tile.r), tile]))
}

function stackEnterCost(
  tiles: Map<string, CombatTile>,
  kind: MoveKind,
): (q: number, r: number) => number | null {
  return (q, r) => combatEnterCost(tiles.get(hexKey(q, r)), kind)
}

/**
 * Gold-preview steps toward `to`, truncated at remaining Speed — same rule as
 * World `movementSteps`. Occupied hexes are not landed on.
 */
export function combatPathSteps(
  from: Axial,
  to: Axial,
  budget: number,
  tiles: CombatTile[],
  kind: MoveKind,
  occupied: ReadonlySet<string>,
): Axial[] {
  if (budget <= 1e-9 || (from.q === to.q && from.r === to.r)) {
    return []
  }
  const enterCost = stackEnterCost(tileMap(tiles), kind)
  const destKey = hexKey(to.q, to.r)
  const destOccupied = occupied.has(destKey)
  const blocked = destOccupied
    ? new Set([...occupied].filter((key) => key !== destKey))
    : occupied
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
    if (cost == null || mp + 1e-9 < cost) {
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
): Map<string, Axial[]> {
  const enterCost = stackEnterCost(tileMap(tiles), kind)
  const paths = reachableWithin(from, budget, enterCost, occupied)
  const out = new Map<string, Axial[]>()
  out.set(hexKey(from.q, from.r), [])
  for (const [key, path] of paths) {
    out.set(key, path.slice(1))
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
  const kind = moveKindForUnit(unit, catalog)
  const occupied = occupiedHexes(battle.stacks, catalog, stack.id)
  const enterCost = stackEnterCost(tileMap(tiles), kind)
  return neighborHexes({ q: stack.q, r: stack.r }).some((next) => {
    if (occupied.has(hexKey(next.q, next.r))) {
      return false
    }
    return enterCost(next.q, next.r) != null
  })
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
