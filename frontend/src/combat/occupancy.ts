import type { Axial } from '../hex/hero'
import type { ReferenceCatalog } from '../town/catalog'
import { unitById, unitFootprint } from '../town/catalog'
import { isHeroStack, type CombatSide, type CombatStack } from './battle'
import {
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

export function bodyFromStack(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): OccupancyBody {
  return { id: stack.id, hexes: stackFootprint(stack, catalog) }
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
    const blocked = stackFootprint(stack, catalog).some((hex) =>
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
  const bodies = [
    ...stacks
      .filter((stack) => occupiesHex(stack, catalog, false))
      .map((stack) => bodyFromStack(stack, catalog)),
    ...extras,
  ]
  const hit = occupyingBody(bodies, q, r)
  if (!hit) {
    return null
  }
  return stacks.find((stack) => stack.id === hit.id) ?? null
}

/** True if every hex of the footprint can be stood on. */
export function footprintFits(
  origin: Axial,
  codeOrSize: FootprintCode | number,
  alongOrStep: 1 | -1 | Axial,
  occupied: ReadonlySet<string>,
  enterCost: (q: number, r: number) => number | null,
  ignore?: ReadonlySet<string>,
): boolean {
  for (const hex of footprintHexes(origin, codeOrSize, alongOrStep)) {
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
