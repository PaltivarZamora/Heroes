import type { Axial } from './hero'
import { hexDistance } from './pathfinding'
import { getTile, isPassable } from './world'
import { hexHeroMovementEnterCost } from './worldHeroPath'
import {
  footprintBlockingHexes,
  footprintHeadHexes,
  footprintHexes,
  footprintExtent,
  type FootprintCode,
} from '../combat/footprint'
import {
  stackArtBox,
  type StackArtBox,
} from '../combat/combatStackArtBox'
import { townBlockedHex } from './townFootprint'
import { propRowById, unitById, unitFootprint, type ReferenceCatalog } from '../town/catalog'
import type { GameSession, Mob } from '../session/types'
import { mobLeadStack } from '../session/mobs'

/** World mobs extend footprint bottom row toward +q (same as attacker / props). */
export const WORLD_MOB_FOOTPRINT_ALONG: 1 | -1 = 1

function posKey(q: number, r: number): string {
  return `${q},${r}`
}

export function mobFootprintCode(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  mob: Mob,
): FootprintCode {
  const lead = mobLeadStack(session, mob)
  if (!lead) {
    return '1x1'
  }
  return unitFootprint(unitById(catalog, lead.unit_id))
}

export function mobShapeHexes(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  mob: Mob,
): Axial[] {
  const code = mobFootprintCode(session, catalog, mob)
  return footprintHexes(mob.position, code, WORLD_MOB_FOOTPRINT_ALONG)
}

export function mobBodyHexes(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  mob: Mob,
): Axial[] {
  const code = mobFootprintCode(session, catalog, mob)
  return footprintBlockingHexes(mob.position, code, WORLD_MOB_FOOTPRINT_ALONG)
}

export function mobHeadHexes(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  mob: Mob,
): Axial[] {
  const code = mobFootprintCode(session, catalog, mob)
  return footprintHeadHexes(mob.position, code, WORLD_MOB_FOOTPRINT_ALONG)
}

export function mobShapeKeys(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  mob: Mob,
): string[] {
  return mobShapeHexes(session, catalog, mob).map((hex) => posKey(hex.q, hex.r))
}

export function findMobAtHex(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  q: number,
  r: number,
): Mob | undefined {
  const key = posKey(q, r)
  for (const mob of session.mobs) {
    if (mobShapeKeys(session, catalog, mob).includes(key)) {
      return mob
    }
  }
  return undefined
}

export function hexDistanceToMobShape(
  hex: Axial,
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  mob: Mob,
): number {
  let best = Infinity
  for (const part of mobShapeHexes(session, catalog, mob)) {
    best = Math.min(best, hexDistance(hex, part))
  }
  return best
}

export function mobShapeBlocksHeroPath(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
): Set<string> {
  const keys = new Set<string>()
  for (const mob of session.mobs) {
    for (const key of mobShapeKeys(session, catalog, mob)) {
      keys.add(key)
    }
  }
  return keys
}

function featureAt(session: GameSession, q: number, r: number): boolean {
  return (session.features ?? []).some(
    (row) => row.position.q === q && row.position.r === r,
  )
}

function roadFeatureAt(session: GameSession, q: number, r: number): boolean {
  const tile = getTile(q, r)
  if (!tile?.hasRoad || !featureAt(session, q, r)) {
    return false
  }
  return true
}

function townFootprintKeys(session: GameSession): Set<string> {
  const keys = new Set<string>()
  for (const town of session.towns) {
    keys.add(posKey(town.position.q, town.position.r))
    const keep = townBlockedHex(town.position, town.flipped)
    keys.add(posKey(keep.q, keep.r))
  }
  return keys
}

function pickupAt(session: GameSession, q: number, r: number): boolean {
  return session.nodes.some(
    (node) =>
      node.kind === 'pickup' &&
      !node.collected &&
      node.position.q === q &&
      node.position.r === r,
  )
}

function blockingPropAt(
  catalog: ReferenceCatalog | null | undefined,
  q: number,
  r: number,
): boolean {
  const tile = getTile(q, r)
  if (!tile?.propId) {
    return false
  }
  const prop = propRowById(catalog, tile.propId)
  return prop?.is_blocker === true
}

function headHexForbidden(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  q: number,
  r: number,
  occupied: Set<string>,
  exceptMobId?: string,
): boolean {
  const key = posKey(q, r)
  if (occupied.has(key)) {
    return true
  }
  if (townFootprintKeys(session).has(key)) {
    return true
  }
  if (featureAt(session, q, r) || roadFeatureAt(session, q, r)) {
    return true
  }
  if (pickupAt(session, q, r)) {
    return true
  }
  if (session.heroes.some((hero) => hero.position.q === q && hero.position.r === r)) {
    return true
  }
  for (const mob of session.mobs) {
    if (exceptMobId != null && mob.id === exceptMobId) {
      continue
    }
    if (mobShapeKeys(session, catalog, mob).includes(key)) {
      return true
    }
  }
  return false
}

function bodyHexOk(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  q: number,
  r: number,
  occupied: Set<string>,
): boolean {
  const key = posKey(q, r)
  if (occupied.has(key)) {
    return false
  }
  if (!isPassable(q, r)) {
    return false
  }
  if (hexHeroMovementEnterCost(catalog, session, q, r, null) == null) {
    return false
  }
  if (blockingPropAt(catalog, q, r)) {
    return false
  }
  if (townFootprintKeys(session).has(key)) {
    return false
  }
  if (featureAt(session, q, r) || roadFeatureAt(session, q, r)) {
    return false
  }
  return true
}

/** Validate anchor for a mob with the given lead footprint (world gen / event spawn). */
export function mobWorldAnchorFits(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  origin: Axial,
  code: FootprintCode,
  occupied: Set<string>,
  exceptMobId?: string,
): boolean {
  const body = footprintBlockingHexes(origin, code, WORLD_MOB_FOOTPRINT_ALONG)
  for (const hex of body) {
    if (!bodyHexOk(session, catalog, hex.q, hex.r, occupied)) {
      return false
    }
  }
  for (const hex of footprintHeadHexes(origin, code, WORLD_MOB_FOOTPRINT_ALONG)) {
    if (headHexForbidden(session, catalog, hex.q, hex.r, occupied, exceptMobId)) {
      return false
    }
  }
  return true
}

export function mobWorldPlacementFits(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  mob: Mob,
  occupied: Set<string>,
): boolean {
  const code = mobFootprintCode(session, catalog, mob)
  return mobWorldAnchorFits(
    session,
    catalog,
    mob.position,
    code,
    occupied,
    mob.id,
  )
}

/** World-map anchor: footprint box centre (1×1 = hex centre). */
export function worldMobFootprintCenter(
  originCenterX: number,
  originCenterY: number,
  hexRadius: number,
  code: FootprintCode,
): { centerX: number; centerY: number; boxWidth: number; boxHeight: number } {
  const ext = footprintExtent(code)
  const boxWidth = hexRadius * ext.cols
  const boxHeight = hexRadius * (1 + Math.max(0, ext.rows - 1) * 0.75)
  if (code === '1x1') {
    return {
      centerX: originCenterX,
      centerY: originCenterY,
      boxWidth,
      boxHeight,
    }
  }
  const anchor = { x: originCenterX, y: originCenterY + hexRadius }
  const box: StackArtBox = stackArtBox(anchor, hexRadius, code, 'atk')
  return {
    centerX: box.left + box.width / 2,
    centerY: box.top + box.height / 2,
    boxWidth: box.width,
    boxHeight: box.height,
  }
}

/** Sort key: larger Y draws in front (south / lower on screen). */
export function mobShapeSortY(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  mob: Mob,
  hexCenter: (q: number, r: number) => { x: number; y: number },
): number {
  let best = -Infinity
  for (const hex of mobShapeHexes(session, catalog, mob)) {
    best = Math.max(best, hexCenter(hex.q, hex.r).y)
  }
  return best
}
