import type { Axial } from '../hex/hero'
import { hexDistance } from '../hex/pathfinding'
import type { ReferenceCatalog } from '../town/catalog'
import { unitById, unitFootprint } from '../town/catalog'
import { isHeroStack, type CombatSide, type CombatStack } from './battle'
import {
  footprintBlockingCode,
  footprintBlockingHexes,
  footprintHexes as shapeFootprintHexes,
  type FootprintCode,
} from './footprint'

export function occupancyKey(q: number, r: number): string {
  return `${q},${r}`
}

/**
 * Any blocking body on the battlefield: a unit stack, or later a
 * terrain obstacle. Occupancy never cares which side a body is on.
 */
export type OccupancyBody = {
  id: string
  hexes: Axial[]
}

/** Inward along-row direction: attacker +q, defender −q. */
export function footprintAlong(side: CombatSide): 1 | -1 {
  return side === 'def' ? -1 : 1
}

/**
 * @deprecated Prefer footprintAlong — kept for call sites that still build Axial steps.
 * Extra hexes extend toward the field center along ±q.
 */
export function footprintStep(side: CombatSide): Axial {
  return side === 'def' ? { q: -1, r: 0 } : { q: 1, r: 0 }
}

export function footprintHexes(
  origin: Axial,
  codeOrSize: FootprintCode | number,
  alongOrStep: 1 | -1 | Axial = 1,
): Axial[] {
  const code: FootprintCode =
    typeof codeOrSize === 'number'
      ? codeOrSize <= 1
        ? '1x1'
        : codeOrSize === 2
          ? '2x1'
          : '1x1'
      : codeOrSize
  const along: 1 | -1 =
    typeof alongOrStep === 'number'
      ? alongOrStep
      : alongOrStep.q < 0
        ? -1
        : 1
  return shapeFootprintHexes(origin, code, along)
}

export function combatBodyFootprint(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): FootprintCode {
  if (isHeroStack(stack)) {
    return '1x1'
  }
  return unitFootprint(unitById(catalog, stack.unitId))
}

/** Footprint code for occupancy / landing (excludes non-blocking head row). */
export function combatBlockingFootprint(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): FootprintCode {
  return footprintBlockingCode(combatBodyFootprint(stack, catalog))
}

export function stackBlockingFootprint(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): Axial[] {
  return footprintBlockingHexes(
    { q: stack.q, r: stack.r },
    combatBodyFootprint(stack, catalog),
    footprintAlong(stack.side),
  )
}

/** @deprecated Use combatBodyFootprint — returns hex count for legacy art sizing. */
export function combatBodySize(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): number {
  return footprintHexes(
    { q: stack.q, r: stack.r },
    combatBodyFootprint(stack, catalog),
    footprintAlong(stack.side),
  ).length
}

export function stackFootprint(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): Axial[] {
  return footprintHexes(
    { q: stack.q, r: stack.r },
    combatBodyFootprint(stack, catalog),
    footprintAlong(stack.side),
  )
}

/** Shortest hex gap between two stacks' footprints at their anchor hexes. */
export function minFootprintHexDistance(
  anchorA: Axial,
  bodyA: CombatStack,
  bodyB: CombatStack,
  catalog: ReferenceCatalog,
): number {
  const hexesA = stackFootprint({ ...bodyA, q: anchorA.q, r: anchorA.r }, catalog)
  const hexesB = stackFootprint(bodyB, catalog)
  let min = Infinity
  for (const a of hexesA) {
    for (const b of hexesB) {
      min = Math.min(min, hexDistance(a, b))
    }
  }
  return min
}

export function bodyFromStack(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): OccupancyBody {
  return { id: stack.id, hexes: stackBlockingFootprint(stack, catalog) }
}

export function occupiedFromBodies(
  bodies: OccupancyBody[],
  exceptId?: string,
): Set<string> {
  const blocked = new Set<string>()
  for (const body of bodies) {
    if (body.id === exceptId) {
      continue
    }
    for (const hex of body.hexes) {
      blocked.add(occupancyKey(hex.q, hex.r))
    }
  }
  return blocked
}

function stackName(stack: CombatStack, catalog: ReferenceCatalog): string {
  return (unitById(catalog, stack.unitId)?.name ?? '').trim().toLowerCase()
}

/** Drawbridge never occupies — units must be able to stop on it. */
function occupiesHex(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  ignoreWalls = false,
): boolean {
  const name = stackName(stack, catalog)
  if (name === 'drawbridge') {
    return false
  }
  if (ignoreWalls && (name === 'wall' || name === 'shooter')) {
    return false
  }
  return true
}

export function occupiedHexes(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  exceptId?: string,
  extras: OccupancyBody[] = [],
  ignoreWalls = false,
): Set<string> {
  return occupiedFromBodies(
    [
      ...stacks
        .filter((stack) => occupiesHex(stack, catalog, ignoreWalls))
        .map((stack) => bodyFromStack(stack, catalog)),
      ...extras,
    ],
    exceptId,
  )
}

/** Drop later stacks whose footprint overlaps an earlier body. */
export function stacksWithoutOverlap(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  extras: OccupancyBody[] = [],
): CombatStack[] {
  const kept: CombatStack[] = []
  for (const stack of stacks) {
    const occupied = occupiedHexes(kept, catalog, undefined, extras)
    const blocked = stackBlockingFootprint(stack, catalog).some((hex) =>
      occupied.has(occupancyKey(hex.q, hex.r)),
    )
    if (!blocked) {
      kept.push(stack)
    }
  }
  return kept
}

export function occupyingBody(
  bodies: OccupancyBody[],
  q: number,
  r: number,
): OccupancyBody | null {
  const key = occupancyKey(q, r)
  return (
    bodies.find((body) =>
      body.hexes.some((hex) => occupancyKey(hex.q, hex.r) === key),
    ) ?? null
  )
}

export function stackOccupyingHex(
  stacks: CombatStack[],
  q: number,
  r: number,
  catalog: ReferenceCatalog,
  extras: OccupancyBody[] = [],
): CombatStack | null {
  const key = occupancyKey(q, r)
  let bodyPick: CombatStack | null = null
  let headPick: CombatStack | null = null
  for (const stack of stacks) {
    if (stack.qty <= 0 || !occupiesHex(stack, catalog, false)) {
      continue
    }
    if (
      stackBlockingFootprint(stack, catalog).some(
        (hex) => occupancyKey(hex.q, hex.r) === key,
      )
    ) {
      if (!bodyPick || stack.id.localeCompare(bodyPick.id) < 0) {
        bodyPick = stack
      }
      continue
    }
    if (
      stackFootprint(stack, catalog).some(
        (hex) => occupancyKey(hex.q, hex.r) === key,
      )
    ) {
      if (!headPick || stack.id.localeCompare(headPick.id) < 0) {
        headPick = stack
      }
    }
  }
  if (bodyPick) {
    return bodyPick
  }
  if (headPick) {
    return headPick
  }
  for (const body of extras) {
    if (!body.hexes.some((hex) => occupancyKey(hex.q, hex.r) === key)) {
      continue
    }
    const match = stacks.find((row) => row.id === body.id)
    if (match) {
      return match
    }
  }
  return null
}

/** Every stack whose drawn footprint (body + head) covers the hex. */
export function stacksOccupyingHex(
  stacks: CombatStack[],
  q: number,
  r: number,
  catalog: ReferenceCatalog,
  extras: OccupancyBody[] = [],
): CombatStack[] {
  const key = occupancyKey(q, r)
  const out: CombatStack[] = []
  for (const stack of stacks) {
    if (stack.qty <= 0 || !occupiesHex(stack, catalog, false)) {
      continue
    }
    if (
      stackFootprint(stack, catalog).some(
        (hex) => occupancyKey(hex.q, hex.r) === key,
      )
    ) {
      out.push(stack)
    }
  }
  for (const body of extras) {
    if (!body.hexes.some((hex) => occupancyKey(hex.q, hex.r) === key)) {
      continue
    }
    const match = stacks.find((row) => row.id === body.id)
    if (match && !out.some((row) => row.id === match.id)) {
      out.push(match)
    }
  }
  return out
}

/** Expand flash keys to every hex of any stack hit on a key (multi-hex footprints). */
export function expandHitFlashHexKeys(
  keys: readonly string[],
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
): string[] {
  const out = new Set<string>()
  for (const key of keys) {
    out.add(key)
    const [qs, rs] = key.split(',')
    const q = Number(qs)
    const r = Number(rs)
    if (!Number.isFinite(q) || !Number.isFinite(r)) {
      continue
    }
    const stack = stackOccupyingHex(stacks, q, r, catalog)
    if (!stack) {
      continue
    }
    for (const hex of stackFootprint(stack, catalog)) {
      out.add(occupancyKey(hex.q, hex.r))
    }
  }
  return [...out]
}

/** Footprint hex keys when the stack anchor sits on `anchor`. */
export function anchorFootprintHexKeys(
  anchor: Axial,
  stack: CombatStack,
  catalog: ReferenceCatalog,
): string[] {
  const ghost = { ...stack, q: anchor.q, r: anchor.r }
  return stackFootprint(ghost, catalog).map((hex) => occupancyKey(hex.q, hex.r))
}

export function expandAnchorKeysForFootprint(
  anchorKeys: Iterable<string>,
  stack: CombatStack,
  catalog: ReferenceCatalog,
): string[] {
  const out = new Set<string>()
  for (const key of anchorKeys) {
    const [qs, rs] = key.split(',')
    const q = Number(qs)
    const r = Number(rs)
    if (!Number.isFinite(q) || !Number.isFinite(r)) {
      continue
    }
    for (const hexKey of anchorFootprintHexKeys({ q, r }, stack, catalog)) {
      out.add(hexKey)
    }
  }
  return [...out]
}

/**
 * Map a hovered hex to a reachable anchor + steps (anchor may differ when
 * hover is on a non-anchor cell of a valid stand footprint).
 */
export function reachableAtHoverHex(
  hover: Axial,
  stack: CombatStack,
  catalog: ReferenceCatalog,
  reachable: Map<string, Axial[]>,
): { anchor: Axial; steps: Axial[] } | null {
  const direct = reachable.get(occupancyKey(hover.q, hover.r))
  if (direct != null) {
    return { anchor: hover, steps: direct }
  }
  for (const [key, steps] of reachable) {
    const [qs, rs] = key.split(',')
    const q = Number(qs)
    const r = Number(rs)
    if (!Number.isFinite(q) || !Number.isFinite(r)) {
      continue
    }
    const anchor = { q, r }
    const covers = stackFootprint({ ...stack, q: anchor.q, r: anchor.r }, catalog)
    if (covers.some((hex) => hex.q === hover.q && hex.r === hover.r)) {
      return { anchor, steps }
    }
  }
  return null
}

/**
 * True if the stack can stand at `origin`: blocking hexes must be landable and
 * unoccupied; head hexes do not block others and may extend into display-only rows.
 */
export function footprintFits(
  origin: Axial,
  codeOrSize: FootprintCode | number,
  alongOrStep: 1 | -1 | Axial,
  occupied: ReadonlySet<string>,
  enterCost: (q: number, r: number) => number | null,
  ignore?: ReadonlySet<string>,
): boolean {
  const code: FootprintCode =
    typeof codeOrSize === 'number'
      ? codeOrSize <= 1
        ? '1x1'
        : codeOrSize === 2
          ? '2x1'
          : '1x1'
      : codeOrSize
  const along: 1 | -1 =
    typeof alongOrStep === 'number'
      ? alongOrStep
      : alongOrStep.q < 0
        ? -1
        : 1
  for (const hex of footprintBlockingHexes(origin, code, along)) {
    const key = occupancyKey(hex.q, hex.r)
    if (enterCost(hex.q, hex.r) == null) {
      return false
    }
    if (ignore?.has(key)) {
      continue
    }
    if (occupied.has(key)) {
      return false
    }
  }
  return true
}
