import type { Axial } from '../hex/hero'
import type { ReferenceCatalog } from '../town/catalog'
import { unitById, unitHexFootprint } from '../town/catalog'
import type { CombatSide, CombatStack } from './battle'

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

/** Inward contiguous step: extra hexes extend toward the field center. */
export function footprintStep(side: CombatSide): Axial {
  return side === 'def' ? { q: -1, r: 0 } : { q: 1, r: 0 }
}

export function footprintHexes(
  origin: Axial,
  size: number,
  step: Axial,
): Axial[] {
  const n = Math.max(1, Math.floor(size))
  const hexes: Axial[] = [{ q: origin.q, r: origin.r }]
  for (let i = 1; i < n; i += 1) {
    hexes.push({
      q: origin.q + step.q * i,
      r: origin.r + step.r * i,
    })
  }
  return hexes
}

export function combatBodySize(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): number {
  return unitHexFootprint(unitById(catalog, stack.unitId))
}

export function stackFootprint(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): Axial[] {
  return footprintHexes(
    { q: stack.q, r: stack.r },
    combatBodySize(stack, catalog),
    footprintStep(stack.side),
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

export function occupiedHexes(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  exceptId?: string,
  extras: OccupancyBody[] = [],
): Set<string> {
  return occupiedFromBodies(
    [...stacks.map((stack) => bodyFromStack(stack, catalog)), ...extras],
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
    ...stacks.map((stack) => bodyFromStack(stack, catalog)),
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
  size: number,
  step: Axial,
  occupied: ReadonlySet<string>,
  enterCost: (q: number, r: number) => number | null,
  ignore?: ReadonlySet<string>,
): boolean {
  for (const hex of footprintHexes(origin, size, step)) {
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
