import type { GameSession } from '../session/types'
import { findNodeAt } from '../session/accessors'
import {
  getCachedCatalog,
  roadMoveCost,
  type ReferenceCatalog,
} from '../town/catalog'
import {
  assignedTerrainForHex,
  hexTransitionMoveCost,
} from './terrainTransition'
import { getTile, isExplored } from './world'
import { isPathHexOpen, type WorldPathCostOptions } from './pathfinding'

/** Session mine at (q,r) owned by `moverPlayerId` — walk-through for routing only. */
export function isPlayerOwnedMineHex(
  session: GameSession,
  q: number,
  r: number,
  moverPlayerId: string | null | undefined,
): boolean {
  if (!moverPlayerId) {
    return false
  }
  const node = findNodeAt(session, q, r)
  return node?.kind === 'mine' && node.player_id === moverPlayerId
}

/** Neutral and enemy mines stay path obstacles; own mines do not. */
export function mineBlocksHeroPath(
  session: GameSession,
  q: number,
  r: number,
  moverPlayerId: string | null | undefined,
): boolean {
  const node = findNodeAt(session, q, r)
  if (node?.kind !== 'mine') {
    return false
  }
  if (node.player_id == null) {
    return true
  }
  if (!moverPlayerId) {
    return true
  }
  return node.player_id !== moverPlayerId
}

export function shouldBlockMapNodeForPath(
  session: GameSession,
  node: GameSession['nodes'][number],
  moverPlayerId: string | null | undefined,
): boolean {
  if (node.kind === 'pickup' && node.collected) {
    return false
  }
  if (
    node.kind === 'mine' &&
    !mineBlocksHeroPath(session, node.position.q, node.position.r, moverPlayerId)
  ) {
    return false
  }
  return true
}

/**
 * Enter cost for hero path preview and movement. Own-mine transit uses terrain
 * cost even when catalog `is_blocker` would block the hex for other travellers.
 */
export function hexHeroMovementEnterCost(
  catalog: ReferenceCatalog | null | undefined,
  session: GameSession,
  q: number,
  r: number,
  moverPlayerId: string | null | undefined,
): number | null {
  const base = hexTransitionMoveCost(catalog, q, r)
  if (base != null) {
    return base
  }
  if (!isPlayerOwnedMineHex(session, q, r, moverPlayerId) || !isExplored(q, r)) {
    return null
  }
  const tile = getTile(q, r)
  if (!tile) {
    return null
  }
  if (tile.hasRoad) {
    return roadMoveCost(catalog)
  }
  if (catalog) {
    const row = assignedTerrainForHex(catalog, q, r)
    if (row?.move_cost != null) {
      return row.move_cost
    }
  }
  if (tile.movementCostMultiplier != null && Number.isFinite(tile.movementCostMultiplier)) {
    return tile.movementCostMultiplier
  }
  return null
}

export function heroWorldPathCostOptions(
  session: GameSession,
  moverPlayerId: string | null | undefined,
  catalog: ReferenceCatalog | null | undefined = getCachedCatalog(),
): WorldPathCostOptions {
  return {
    enterCost: (q, r) =>
      hexHeroMovementEnterCost(catalog, session, q, r, moverPlayerId),
    hexOpen: (q, r, blocked) => {
      if (isPlayerOwnedMineHex(session, q, r, moverPlayerId)) {
        if (!isExplored(q, r)) {
          return false
        }
        if (blocked?.has(`${q},${r}`)) {
          return false
        }
        return hexHeroMovementEnterCost(catalog, session, q, r, moverPlayerId) != null
      }
      return isPathHexOpen(q, r, blocked, false)
    },
  }
}
