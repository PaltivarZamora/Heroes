import { giveItemToHero } from '../items/give'
import { rolledItemDisplayName } from '../items/display'
import type { ReferenceCatalog } from '../town/catalog'
import {
  findGroundItemAt,
  removeGroundItem,
} from './accessors'
import {
  logItemPickedUp,
  logMobItemLeftOnGround,
} from './gameLog'
import {
  onScreenBackpackFullGround,
  onScreenPickedUpMessage,
} from '../items/itemLogFormat'
import type { GameSession, MapFeature } from './types'
import type { RolledItem } from '../items/types'

export type GroundItemPickupResult = {
  session: GameSession
  message: string | null
}

function heroPlayerId(session: GameSession, heroId: string): string | null {
  return session.heroes.find((row) => row.id === heroId)?.player_id ?? null
}

export function tryPickupGroundItem(
  session: GameSession,
  catalog: ReferenceCatalog,
  featureId: string,
  heroId: string,
): GroundItemPickupResult {
  const feature = session.features?.find(
    (row): row is Extract<GameSession['features'][number], { kind: 'ground_item' }> =>
      row.kind === 'ground_item' && row.id === featureId,
  )
  if (!feature) {
    return { session, message: null }
  }
  const itemName = rolledItemDisplayName(catalog, feature.item)
  const playerId = heroPlayerId(session, heroId)
  const given = giveItemToHero(session, catalog, heroId, feature.item)
  if (given.ok) {
    let next = removeGroundItem(given.session, featureId)
    if (playerId) {
      next = logItemPickedUp(
        next,
        playerId,
        heroId,
        feature.item.uid,
        itemName,
      )
    }
    return {
      session: next,
      message: onScreenPickedUpMessage(catalog, feature.item),
    }
  }
  let next = session
  if (playerId) {
    next = logMobItemLeftOnGround(
      next,
      playerId,
      heroId,
      itemName,
      feature.position.q,
      feature.position.r,
    )
  }
  return {
    session: next,
    message: onScreenBackpackFullGround(catalog, feature.item),
  }
}

export function tryPickupGroundItemAtHex(
  session: GameSession,
  catalog: ReferenceCatalog,
  q: number,
  r: number,
  heroId: string,
): GroundItemPickupResult {
  const feature = findGroundItemAt(session, q, r)
  if (!feature) {
    return { session, message: null }
  }
  return tryPickupGroundItem(session, catalog, feature.id, heroId)
}

function nextGroundFeatureId(session: GameSession): string {
  let n = (session.features?.length ?? 0) + 1
  let id = `feature-${n}`
  while (session.features?.some((row) => row.id === id)) {
    n += 1
    id = `feature-${n}`
  }
  return id
}

/** Runtime unguarded drop (BR S9-43). Persists in session.features for save/load. */
export function spawnUnguardedGroundItem(
  session: GameSession,
  catalog: ReferenceCatalog,
  q: number,
  r: number,
  item: RolledItem,
  flipped: boolean,
): GameSession {
  if (findGroundItemAt(session, q, r)) {
    return session
  }
  const name = rolledItemDisplayName(catalog, item)
  const feature: Extract<MapFeature, { kind: 'ground_item' }> = {
    id: nextGroundFeatureId(session),
    kind: 'ground_item',
    position: { q, r },
    name,
    item,
    flipped,
    pocket_id: null,
    pocket_tier: null,
    guard: null,
    guard_tier: null,
    origin: 'mob_drop',
  }
  return {
    ...session,
    features: [...(session.features ?? []), feature],
  }
}
