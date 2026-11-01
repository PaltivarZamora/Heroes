import type { Axial } from '../hex/hero'
import { hexDistance } from '../hex/pathfinding'
import type { FootprintCode } from './footprint'
import { footprintBlockingCode } from './footprint'
import { unitById, unitFootprint, unitHasTag, type ReferenceCatalog } from '../town/catalog'
import type {
  CombatBattle,
  CombatSide,
  CombatStack,
  CombatTile,
  CombatTombstone,
} from './battle'
import { isHeroStack } from './battle'
import type { OccupancyBody } from './occupancy'
import {
  combatBodyFootprint,
  combatBlockingFootprint,
  footprintAlong,
  footprintFits,
  footprintHexes,
  occupancyKey,
  occupiedHexes,
} from './occupancy'
import { combatCanLandOn, combatEnterCost, moveKindForUnit } from './movement'
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

export function makeTombstone(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): CombatTombstone {
  return {
    id: stack.id,
    side: stack.side,
    unitId: stack.unitId,
    q: stack.q,
    r: stack.r,
    footprint: combatBlockingFootprint(stack, catalog),
    startingQty: Math.max(1, stack.startingQty),
    deadQty: Math.max(1, stack.startingQty),
    sessionStackId: stack.sessionStackId,
    armySlot: stack.armySlot,
    slot: stack.slot,
  }
}

export function tombBlockingFootprintCode(
  tomb: CombatTombstone,
  catalog: ReferenceCatalog,
): FootprintCode {
  if (tomb.footprint) {
    return tomb.footprint
  }
  return footprintBlockingCode(unitFootprint(unitById(catalog, tomb.unitId)))
}

export function tombCorpseArtFootprintCode(
  tomb: CombatTombstone,
  catalog: ReferenceCatalog,
): FootprintCode {
  return unitFootprint(unitById(catalog, tomb.unitId))
}

export function tombstoneFootprintHexes(
  tomb: CombatTombstone,
  catalog: ReferenceCatalog,
): Axial[] {
  const code = tombBlockingFootprintCode(tomb, catalog)
  return footprintHexes({ q: tomb.q, r: tomb.r }, code, footprintAlong(tomb.side))
}

/** @deprecated Use tombCorpseArtFootprintCode for paint */
export function tombFootprintCode(
  tomb: CombatTombstone,
  catalog: ReferenceCatalog,
): FootprintCode {
  return tombCorpseArtFootprintCode(tomb, catalog)
}

export function tombstoneOccupiesHex(
  tomb: CombatTombstone,
  q: number,
  r: number,
  catalog: ReferenceCatalog,
): boolean {
  return tombstoneFootprintHexes(tomb, catalog).some(
    (hex) => hex.q === q && hex.r === r,
  )
}

/** Landing blockers only — units may path through tombstones but cannot stop on them. */
export function tombstoneOccupancyBodies(
  tombstones: CombatTombstone[] | undefined,
  catalog: ReferenceCatalog,
): OccupancyBody[] {
  return (tombstones ?? []).map((tomb) => ({
    id: tomb.id,
    hexes: tombstoneFootprintHexes(tomb, catalog),
  }))
}

export function tombstoneAt(
  battle: CombatBattle,
  q: number,
  r: number,
  catalog: ReferenceCatalog,
): CombatTombstone | null {
  return (
    (battle.tombstones ?? []).find((tomb) =>
      tombstoneOccupiesHex(tomb, q, r, catalog),
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
  const livingIds = new Set(
    after.stacks.filter((stack) => stack.qty > 0).map((stack) => stack.id),
  )
  const existing = new Set(
    (after.tombstones ?? before.tombstones ?? []).map((t) => t.id),
  )
  const added: CombatTombstone[] = []
  const consider = (stack: CombatStack) => {
    if (livingIds.has(stack.id) || existing.has(stack.id)) {
      return
    }
    if (added.some((tomb) => tomb.id === stack.id)) {
      return
    }
    if (!canLeaveTombstone(stack, catalog)) {
      return
    }
    added.push(makeTombstone(stack, catalog))
    existing.add(stack.id)
  }
  for (const stack of before.stacks) {
    consider(stack)
  }
  for (const stack of after.stacks) {
    if (stack.qty <= 0) {
      consider(stack)
    }
  }
  const stacks = after.stacks.filter((stack) => stack.qty > 0)
  if (added.length === 0) {
    return {
      ...after,
      stacks,
      tombstones: after.tombstones ?? before.tombstones ?? [],
    }
  }
  return {
    ...after,
    stacks,
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
    .flatMap((tomb) =>
      tombstoneFootprintHexes(tomb, catalog).map((hex) =>
        occupancyKey(hex.q, hex.r),
      ),
    )
}

function reviveAnchorCandidates(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[] | undefined,
): Axial[] {
  if (tiles && tiles.length > 0) {
    return tiles.map((tile) => ({ q: tile.q, r: tile.r }))
  }
  const seen = new Set<string>()
  const out: Axial[] = []
  const add = (hex: Axial) => {
    const key = occupancyKey(hex.q, hex.r)
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    out.push(hex)
  }
  for (const stack of battle.stacks) {
    add({ q: stack.q, r: stack.r })
    for (const hex of footprintHexes(
      { q: stack.q, r: stack.r },
      combatBodyFootprint(stack, catalog),
      footprintAlong(stack.side),
    )) {
      add(hex)
    }
  }
  for (const tomb of battle.tombstones ?? []) {
    add({ q: tomb.q, r: tomb.r })
    for (const hex of tombstoneFootprintHexes(tomb, catalog)) {
      add(hex)
    }
  }
  return out
}

/**
 * Prefer the tomb anchor; else nearest anchor where the wiped footprint fits
 * (same footprintFits rules as movement landing). Excludes `tomb` from blockers.
 */
export function nearestReviveAnchorForTombstone(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tomb: CombatTombstone,
  tiles?: CombatTile[],
): Axial | null {
  const unit = unitById(catalog, tomb.unitId)
  if (!unit) {
    return null
  }
  const code = tombBlockingFootprintCode(tomb, catalog)
  const along = footprintAlong(tomb.side)
  const tombsExcept = tombstoneOccupancyBodies(battle.tombstones, catalog).filter(
    (body) => body.id !== tomb.id,
  )
  const occupied = occupiedHexes(
    battle.stacks,
    catalog,
    undefined,
    tombsExcept,
    false,
  )
  const kind = moveKindForUnit(unit, catalog)
  const tileMap = new Map(
    (tiles ?? []).map((row) => [occupancyKey(row.q, row.r), row]),
  )
  const enterCost = (q: number, r: number) => {
    const tile = tileMap.get(occupancyKey(q, r))
    if (tiles && tiles.length > 0) {
      if (!tile || !combatCanLandOn(tile, kind)) {
        return null
      }
      return combatEnterCost(tile, kind)
    }
    return 1
  }
  const prefer = { q: tomb.q, r: tomb.r }
  const fits = (anchor: Axial) =>
    footprintFits(anchor, code, along, occupied, enterCost)
  if (fits(prefer)) {
    return prefer
  }
  const candidates = reviveAnchorCandidates(battle, catalog, tiles)
    .filter(fits)
    .sort((a, b) => {
      const da = hexDistance(a, prefer)
      const db = hexDistance(b, prefer)
      if (da !== db) {
        return da - db
      }
      return a.q - b.q || a.r - b.r
    })
  return candidates[0] ?? null
}
