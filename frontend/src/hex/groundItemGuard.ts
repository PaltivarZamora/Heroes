import { findMobAt } from '../session/mobs'
import { findGroundItemAt } from '../session/accessors'
import type { GameSession, Mob } from '../session/types'

export function guardMobForGroundItem(
  session: GameSession,
  feature: Extract<GameSession['features'][number], { kind: 'ground_item' }>,
): Mob | undefined {
  if (!feature.guard) {
    return undefined
  }
  return findMobAt(session, feature.guard.q, feature.guard.r)
}

export function groundItemGuardBlocksEntry(
  session: GameSession,
  q: number,
  r: number,
): Mob | null {
  const item = findGroundItemAt(session, q, r)
  if (!item) {
    return null
  }
  const mob = guardMobForGroundItem(session, item)
  return mob ?? null
}

/** Path preview: item hex is a fight while its standalone guard lives. */
export function pathStepShowsGroundItemFight(
  session: GameSession,
  hex: { q: number; r: number },
): boolean {
  return groundItemGuardBlocksEntry(session, hex.q, hex.r) != null
}
