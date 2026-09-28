import type { Axial } from './hero'
import { hexTransitionMoveCost, assignedTerrainForHex } from './terrainTransition'
import {
  appConfigNumber,
  getCachedCatalog,
  type ReferenceCatalog,
  type TerrainRow,
} from '../town/catalog'
import type { Boat, GameSession, Hero } from '../session/types'
import { hexDistance, neighborHexes } from './pathfinding'
import { isExplored } from './world'

/** Terrain ids looked up by name — never hardcoded. */
export function waterTerrainIds(catalog: ReferenceCatalog | null | undefined): {
  deep: number | null
  shallow: number | null
} {
  if (!catalog) {
    return { deep: null, shallow: null }
  }
  let deep: number | null = null
  let shallow: number | null = null
  for (const row of catalog.terrain) {
    const name = row.name?.trim().toLowerCase() ?? ''
    if (name === 'water') {
      deep = row.id
    } else if (name === 'shallow') {
      shallow = row.id
    }
  }
  return { deep, shallow }
}

export function boatCostGold(catalog: ReferenceCatalog | null | undefined): number {
  return Math.max(0, Math.floor(appConfigNumber(catalog, 'boat_cost', 500)))
}

export function isWaterOrShallowTerrain(
  catalog: ReferenceCatalog | null | undefined,
  terrain: TerrainRow | null | undefined,
): boolean {
  if (!terrain) {
    return false
  }
  const ids = waterTerrainIds(catalog)
  return terrain.id === ids.deep || terrain.id === ids.shallow
}

export function isDeepWaterTerrain(
  catalog: ReferenceCatalog | null | undefined,
  terrain: TerrainRow | null | undefined,
): boolean {
  if (!terrain) {
    return false
  }
  return terrain.id === waterTerrainIds(catalog).deep
}

/** Flat 1 MP sail cost on Water / Shallow; null elsewhere. */
export function boatEnterCost(q: number, r: number): number | null {
  const catalog = getCachedCatalog()
  if (!catalog) {
    return null
  }
  const terrain = assignedTerrainForHex(catalog, q, r)
  return isWaterOrShallowTerrain(catalog, terrain) ? 1 : null
}

export function findBoatAt(
  session: GameSession,
  q: number,
  r: number,
): Boat | undefined {
  return (session.boats ?? []).find(
    (boat) => boat.position.q === q && boat.position.r === r,
  )
}

export function findBoatById(
  session: GameSession,
  boatId: string,
): Boat | undefined {
  return (session.boats ?? []).find((boat) => boat.id === boatId)
}

export function boatOccupiedByHero(
  session: GameSession,
  heroId: string,
): Boat | undefined {
  return (session.boats ?? []).find((boat) => boat.occupant_hero_id === heroId)
}

export function heroIsBoarded(session: GameSession, heroId: string): boolean {
  return boatOccupiedByHero(session, heroId) != null
}

/**
 * Other boats block sailing except an **enemy-occupied** boat (naval battle
 * trigger, BR S9-12). Empty boats and friendly-occupied boats still block.
 */
export function otherBoatBlocks(
  session: GameSession,
  q: number,
  r: number,
  moverBoatId: string | null,
  moverPlayerId?: string | null,
): boolean {
  const boat = findBoatAt(session, q, r)
  if (!boat) {
    return false
  }
  if (moverBoatId != null && boat.id === moverBoatId) {
    return false
  }
  if (boat.occupant_hero_id == null) {
    return true
  }
  const occupant = session.heroes.find(
    (row) => row.id === boat.occupant_hero_id,
  )
  if (!occupant) {
    return true
  }
  if (moverPlayerId != null && occupant.player_id !== moverPlayerId) {
    // Enemy-occupied — path/destination allowed; HexMap starts naval combat.
    return false
  }
  return true
}

/** Enemy hero occupying a boat on this hex (naval battle target). */
export function enemyBoatOccupantAt(
  session: GameSession,
  q: number,
  r: number,
  moverPlayerId: string,
): { boat: Boat; hero: Hero } | null {
  const boat = findBoatAt(session, q, r)
  if (!boat?.occupant_hero_id) {
    return null
  }
  const hero = session.heroes.find((row) => row.id === boat.occupant_hero_id)
  if (!hero || hero.player_id === moverPlayerId) {
    return null
  }
  return { boat, hero }
}

/** Can a boarded hero sail onto this hex? */
export function canSailOnto(
  session: GameSession,
  q: number,
  r: number,
  moverBoatId: string,
  moverPlayerId?: string | null,
): boolean {
  if (!isExplored(q, r)) {
    return false
  }
  if (boatEnterCost(q, r) == null) {
    return false
  }
  if (otherBoatBlocks(session, q, r, moverBoatId, moverPlayerId)) {
    return false
  }
  return true
}

/** Walkable land hex (not water-only sail) — for disembark. */
export function isDisembarkLandHex(q: number, r: number): boolean {
  const catalog = getCachedCatalog()
  if (!catalog) {
    return false
  }
  const terrain = assignedTerrainForHex(catalog, q, r)
  if (!terrain || terrain.is_blocker || terrain.move_cost == null) {
    return false
  }
  // Shallow is walkable land for disembark; deep water is not.
  if (isDeepWaterTerrain(catalog, terrain)) {
    return false
  }
  return hexTransitionMoveCost(catalog, q, r) != null
}

export function emptyBoatBeside(
  session: GameSession,
  at: Axial,
): Boat | undefined {
  return (session.boats ?? []).find((boat) => {
    if (boat.occupant_hero_id != null) {
      return false
    }
    return hexDistance(at, boat.position) <= 1
  })
}

export function disembarkNeighbors(from: Axial): Axial[] {
  return neighborHexes(from).filter((n) => isDisembarkLandHex(n.q, n.r))
}

export function sameAxial(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r
}
