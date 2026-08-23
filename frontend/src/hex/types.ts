export type TerrainType =
  | 'Stone Path'
  | 'Dirt Path'
  | 'Grass'
  | 'Ash'
  | 'Rocky'
  | 'Lava'
  | 'Desert'
  | 'Snow'
  | 'Mud'
  | 'Swamp'
  | 'Shallows'
  | 'Forest'
  | 'Mountain'
  | 'Water'
  | 'Barrier'
  | 'Void'

export type TileData = {
  q: number
  r: number
  terrain: TerrainType
  /** Movement cost multiplier. `null` means impassable. */
  movementCostMultiplier: number | null
}

export type MapObjectKind = 'mine' | 'pickup' | 'town'

export type MapObjectData = {
  q: number
  r: number
  kind: MapObjectKind
  resource: string
  marker: string
  /** Flavor name for towns. Unused for mines/pickups. */
  name?: string | null
  /** Frontend-only: mine or town claimed by the hero. */
  claimed?: boolean
  /** Frontend-only: pickup already collected. */
  collected?: boolean
}

export type TestGridResponse = {
  seed: number
  tiles: TileData[]
  objects: MapObjectData[]
}
