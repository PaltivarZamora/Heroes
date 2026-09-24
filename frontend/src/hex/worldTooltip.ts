import { formatAmount, resourceById } from './resources'
import type { GameSession, Hero, Mob, Node, Town } from '../session/types'
import { mobLabel } from '../session/mobs'
import {
  heroTypeName,
  resourceWeeklyNode,
  type ReferenceCatalog,
} from '../town/catalog'

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
    const typeName =
      catalog?.town.find((row) => row.id === hit.town!.town_type_id)?.name?.trim() ||
      null
    return typeName ? `${typeName}: ${hit.town.name}` : hit.town.name
  }
  if (hit.hero) {
    const className = catalog
      ? heroTypeName(catalog, hit.hero.class_id).trim()
      : ''
    const label = className ? `${className}: ${hit.hero.name}` : hit.hero.name
    return hit.hero.flight
      ? `${label}${hit.hero.flight.circling ? ' (circling)' : ' (in flight)'}`
      : label
  }
  if (hit.mob) {
    return mobLabel(session, catalog, hit.mob)
  }
  if (hit.node) {
    const resource = resourceById(hit.node.resource_id)
    const name = resource?.name ?? 'Resource'
    if (hit.node.kind === 'mine') {
      const weekly = resourceWeeklyNode(catalog, hit.node.resource_id)
      return `Generates ${formatAmount(weekly)} ${name} weekly but paid daily`
    }
    // Pile: name only — qty stays hidden until pickup.
    return name
  }
  return null
}
