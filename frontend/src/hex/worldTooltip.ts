import { resourceById } from './resources'
import type { GameSession, Hero, Mob, Node, Town } from '../session/types'
import { mobLabel } from '../session/mobs'
import type { ReferenceCatalog } from '../town/catalog'

/** One reusable World-map hover label per object kind. */
export function worldHoverTooltipText(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  hit: {
    town?: Town
    hero?: Hero
    mob?: Mob
    node?: Node
  },
): string | null {
  if (hit.town) {
    return hit.town.name
  }
  if (hit.hero) {
    return hit.hero.name
  }
  if (hit.mob) {
    return mobLabel(session, catalog, hit.mob)
  }
  if (hit.node) {
    const resource = resourceById(hit.node.resource_id)
    const name = resource?.name ?? 'Resource'
    // Mines (claimable) = "{Resource} Node"; loose pickups = "{Resource}".
    if (hit.node.kind === 'mine') {
      return `${name} Node`
    }
    return name
  }
  return null
}
