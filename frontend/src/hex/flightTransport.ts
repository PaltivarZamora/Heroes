import { heroTypeName, type ReferenceCatalog } from '../town/catalog'
import { boatOccupiedByHero } from './boat'
import {
  BOAT_MOVE_STEM,
  WORLD_MOVE_STEM,
  classMountMoveSheetStem,
  moveSheetStaticFile,
  townMoveSheetStem,
} from './moveSheetStems'
import type { GameSession, Hero } from '../session/types'

export {
  BOAT_MOVE_STEM,
  WORLD_MOVE_STEM,
  moveSheetStaticFile,
  townMoveSheetStem,
} from './moveSheetStems'

/** @deprecated Use {@link moveSheetStaticFile} with {@link BOAT_MOVE_STEM}. */
export const TRANSPORT_BOAT_FILE = moveSheetStaticFile(BOAT_MOVE_STEM)

/** @deprecated Use {@link moveSheetStaticFile} with {@link WORLD_MOVE_STEM}. */
export const TRANSPORT_WORLD_FILE = moveSheetStaticFile(WORLD_MOVE_STEM)

/** `Mount_{Town}_Move.png` from catalog `town.name` of the departure town. */
export function transportMoveStemForTownType(
  catalog: ReferenceCatalog,
  townTypeId: number,
): string {
  const row = catalog.town.find((entry) => entry.id === townTypeId)
  const name = row?.name?.trim() || 'World'
  return townMoveSheetStem(name)
}

export function transportMoveStemForDeparture(
  catalog: ReferenceCatalog,
  originTown: { town_type_id: number } | null | undefined,
  fromWorldHanger: boolean,
): string {
  if (fromWorldHanger || !originTown) {
    return WORLD_MOVE_STEM
  }
  return transportMoveStemForTownType(catalog, originTown.town_type_id)
}

export function flightMoveSheetStem(
  flight: { transport_sprite?: string } | null | undefined,
  _catalog: ReferenceCatalog | null | undefined,
): string {
  const file = flight?.transport_sprite?.trim()
  if (!file) {
    return WORLD_MOVE_STEM
  }
  const noExt = file.replace(/\.png$/i, '')
  if (noExt.endsWith('_Move')) {
    return noExt
  }
  if (file.startsWith('Transport_')) {
    const town = file.replace(/^Transport_/, '').replace(/\.png$/i, '')
    if (town === 'World') {
      return WORLD_MOVE_STEM
    }
    return `Mount_${town}_Move`
  }
  if (noExt.startsWith('Mount_') && noExt.includes('_Move')) {
    return noExt
  }
  return WORLD_MOVE_STEM
}

/** Move sheet stem for map rendering / slide animation (null on foot without class). */
export function heroMoveSheetStem(
  hero: Hero,
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
): string | null {
  if (boatOccupiedByHero(session, hero.id) != null) {
    return BOAT_MOVE_STEM
  }
  if (hero.flight) {
    return flightMoveSheetStem(hero.flight, catalog)
  }
  const name = catalog ? heroTypeName(catalog, hero.class_id) : ''
  return name ? classMountMoveSheetStem(name) : null
}

/** @deprecated Use {@link transportMoveStemForDeparture} + {@link moveSheetStaticFile}. */
export function transportSpriteForDeparture(
  catalog: ReferenceCatalog,
  _session: GameSession,
  originTown: { town_type_id: number } | null | undefined,
  fromWorldHanger: boolean,
): string {
  return moveSheetStaticFile(
    transportMoveStemForDeparture(catalog, originTown, fromWorldHanger),
  )
}

export function preloadTransportMoveSheetStems(
  catalog: ReferenceCatalog | null | undefined,
  preloadStem: (stem: string) => void,
): void {
  preloadStem(BOAT_MOVE_STEM)
  preloadStem(WORLD_MOVE_STEM)
  if (!catalog) {
    return
  }
  for (const row of catalog.town) {
    if (row.name?.trim()) {
      preloadStem(townMoveSheetStem(row.name))
    }
  }
}
