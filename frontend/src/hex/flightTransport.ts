import { mountMoveSheetStem } from './heroMountMoveAnim'
import { heroTypeName, type ReferenceCatalog } from '../town/catalog'
import { boatOccupiedByHero } from './boat'
import type { GameSession, Hero } from '../session/types'

/** Move-sheet stem (no extension), e.g. `Mount_Boat_Move`. */
export const BOAT_MOVE_STEM = 'Mount_Boat_Move'
export const WORLD_MOVE_STEM = 'Mount_World_Move'

/** Static PNG when a move sheet fails to load (same basename as the sheet). */
export function moveSheetStaticFile(stem: string): string {
  return `${stem}.png`
}

/** @deprecated Use {@link moveSheetStaticFile} with {@link BOAT_MOVE_STEM}. */
export const TRANSPORT_BOAT_FILE = moveSheetStaticFile(BOAT_MOVE_STEM)

/** @deprecated Use {@link moveSheetStaticFile} with {@link WORLD_MOVE_STEM}. */
export const TRANSPORT_WORLD_FILE = moveSheetStaticFile(WORLD_MOVE_STEM)

export function townMoveSheetStem(townTypeName: string): string {
  const base = townTypeName.trim().replace(/\s+/g, '_')
  return `Mount_${base}_Move`
}

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

/** Legacy `Transport_*.png` or move-sheet static names on in-flight heroes. */
export function flightTransportSpriteFile(
  flight: { transport_sprite?: string } | null | undefined,
): string {
  const file = flight?.transport_sprite?.trim()
  if (!file) {
    return moveSheetStaticFile(WORLD_MOVE_STEM)
  }
  return file
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
  return name ? mountMoveSheetStem(name) : null
}

/** @deprecated Use {@link transportMoveStemForDeparture} + {@link moveSheetStaticFile}. */
export function transportSpriteForTownType(
  catalog: ReferenceCatalog,
  townTypeId: number,
): string {
  return moveSheetStaticFile(transportMoveStemForTownType(catalog, townTypeId))
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
