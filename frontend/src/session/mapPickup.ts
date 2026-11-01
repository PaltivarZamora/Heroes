import type { MapObjectData } from '../hex/types'
import { resourceById } from '../hex/resources'
import {
  featureForResource,
  type ReferenceCatalog,
} from '../town/catalog'
import type { GameSession, Node } from './types'

function nextNodeId(session: GameSession): string {
  return `node-${session.nodes.length + 1}`
}

/** Same roll band as map generation ({@code resource.payload.loose_min/max}). */
export function rollLooseResourceQty(
  catalog: ReferenceCatalog,
  resourceId: number,
  random: () => number,
): number {
  const row = catalog.resource.find((entry) => entry.id === resourceId)
  let min = 1
  let max = 1
  const payload = row?.payload
  if (payload != null && typeof payload === 'object' && !Array.isArray(payload)) {
    const map = payload as Record<string, unknown>
    const lo = Math.floor(Number(map.loose_min))
    const hi = Math.floor(Number(map.loose_max))
    if (Number.isFinite(lo)) {
      min = Math.max(0, lo)
    }
    if (Number.isFinite(hi)) {
      max = Math.max(min, hi)
    } else {
      max = min
    }
  }
  if (max <= min) {
    return min
  }
  return min + Math.floor(random() * (max - min + 1))
}

function pickupFlipped(
  catalog: ReferenceCatalog,
  resourceId: number,
  random: () => number,
): boolean {
  const feature = featureForResource(catalog, resourceId, 'pickup')
  if (feature?.flippable !== true) {
    return false
  }
  return random() < 0.5
}

/** Map object + session node for a loose resource pile (matches test-grid pickup fields). */
export function mapObjectForPickupNode(node: Node): MapObjectData | null {
  if (node.kind !== 'pickup' || node.collected) {
    return null
  }
  const marker =
    resourceById(node.resource_id)?.marker ??
    node.resource_id.toString().charAt(0).toUpperCase()
  return {
    q: node.position.q,
    r: node.position.r,
    kind: 'pickup',
    resourceId: node.resource_id,
    marker,
    qty: node.qty,
    flipped: node.flipped === true,
  }
}

/**
 * Append a loose pickup node and return the matching map object for rendering.
 */
export function appendLooseResourcePickup(
  session: GameSession,
  catalog: ReferenceCatalog,
  q: number,
  r: number,
  resourceId: number,
  qty: number,
  random: () => number,
): { session: GameSession; mapObject: MapObjectData } {
  const flipped = pickupFlipped(catalog, resourceId, random)
  const node: Node = {
    id: nextNodeId(session),
    position: { q, r },
    resource_id: resourceId,
    kind: 'pickup',
    player_id: null,
    collected: false,
    qty,
    accrued_fraction: 0,
    flipped,
  }
  const mapObject = mapObjectForPickupNode(node)!
  return {
    session: { ...session, nodes: [...session.nodes, node] },
    mapObject,
  }
}
