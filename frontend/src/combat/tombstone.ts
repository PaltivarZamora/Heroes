import type { ReferenceCatalog } from '../town/catalog'
import { unitById, unitHasTag } from '../town/catalog'
import type {
  CombatBattle,
  CombatSide,
  CombatStack,
  CombatTombstone,
} from './battle'
import { isHeroStack } from './battle'
import type { OccupancyBody } from './occupancy'
import { occupancyKey } from './occupancy'
import { isCreatureArmyUnit } from './siege'

export type { CombatTombstone }

export const TOMBSTONE_ART = 'Dead.png'

export function canLeaveTombstone(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): boolean {
  if (isHeroStack(stack) || stack.indestructible) {
    return false
  }
  return isCreatureArmyUnit(unitById(catalog, stack.unitId))
}

export function makeTombstone(stack: CombatStack): CombatTombstone {
  return {
    id: stack.id,
    side: stack.side,
    unitId: stack.unitId,
    q: stack.q,
    r: stack.r,
    startingQty: Math.max(1, stack.startingQty),
    deadQty: Math.max(1, stack.startingQty),
    sessionStackId: stack.sessionStackId,
    armySlot: stack.armySlot,
    slot: stack.slot,
  }
}

/** Landing blockers only — units may path through tombstones but cannot stop on them. */
export function tombstoneOccupancyBodies(
  tombstones: CombatTombstone[] | undefined,
): OccupancyBody[] {
  return (tombstones ?? []).map((tomb) => ({
    id: tomb.id,
    hexes: [{ q: tomb.q, r: tomb.r }],
  }))
}

export function tombstoneAt(
  battle: CombatBattle,
  q: number,
  r: number,
): CombatTombstone | null {
  return (
    (battle.tombstones ?? []).find(
      (tomb) => tomb.q === q && tomb.r === r,
    ) ?? null
  )
}

export function tombstoneById(
  battle: CombatBattle,
  id: string,
): CombatTombstone | null {
  return (battle.tombstones ?? []).find((tomb) => tomb.id === id) ?? null
}

export function tombstoneName(
  catalog: ReferenceCatalog,
  tomb: CombatTombstone,
): string {
  return unitById(catalog, tomb.unitId)?.name?.trim() || 'Dead'
}

/**
 * After a stacks mutation, place tombstones for creature army stacks that
 * were removed (full wipe). Guardian Angel saves never reach here.
 */
export function syncTombstonesFromWipes(
  before: CombatBattle,
  after: CombatBattle,
  catalog: ReferenceCatalog,
): CombatBattle {
  const stillLive = new Set(after.stacks.map((stack) => stack.id))
  const existing = new Set((after.tombstones ?? before.tombstones ?? []).map((t) => t.id))
  const added: CombatTombstone[] = []
  for (const stack of before.stacks) {
    if (stillLive.has(stack.id) || existing.has(stack.id)) {
      continue
    }
    if (!canLeaveTombstone(stack, catalog)) {
      continue
    }
    added.push(makeTombstone(stack))
  }
  if (added.length === 0) {
    return {
      ...after,
      tombstones: after.tombstones ?? before.tombstones ?? [],
    }
  }
  return {
    ...after,
    tombstones: [...(after.tombstones ?? before.tombstones ?? []), ...added],
  }
}

export function removeTombstone(
  battle: CombatBattle,
  tombId: string,
): CombatBattle {
  return {
    ...battle,
    tombstones: (battle.tombstones ?? []).filter((tomb) => tomb.id !== tombId),
  }
}

/** Rebuild a living stack from a tombstone at the revive qty. */
export function stackFromTombstone(
  tomb: CombatTombstone,
  catalog: ReferenceCatalog,
  qty: number,
): CombatStack {
  const n = Math.max(1, Math.min(tomb.startingQty, Math.floor(qty)))
  const health = Math.max(1, unitById(catalog, tomb.unitId)?.health ?? 1)
  return {
    id: tomb.id,
    side: tomb.side,
    slot: tomb.slot,
    unitId: tomb.unitId,
    qty: n,
    topHealth: health,
    startingQty: tomb.startingQty,
    q: tomb.q,
    r: tomb.r,
    hasActedThisRound: true,
    retaliationsLeft: 0,
    sessionStackId: tomb.sessionStackId,
    armySlot: tomb.armySlot,
  }
}

export function tombstoneMatchesReviveTarget(
  tomb: CombatTombstone,
  casterSide: CombatSide,
  catalog: ReferenceCatalog,
  requiredTag: number | null,
): boolean {
  if (tomb.side !== casterSide) {
    return false
  }
  if (requiredTag != null && requiredTag > 0) {
    return unitHasTag(unitById(catalog, tomb.unitId), requiredTag)
  }
  return true
}

export function tombstoneHexKeys(
  battle: CombatBattle,
  casterSide: CombatSide,
  catalog: ReferenceCatalog,
  requiredTag: number | null,
): string[] {
  return (battle.tombstones ?? [])
    .filter((tomb) =>
      tombstoneMatchesReviveTarget(tomb, casterSide, catalog, requiredTag),
    )
    .map((tomb) => occupancyKey(tomb.q, tomb.r))
}
