export type TileData = {
  q: number
  r: number
  terrain: string
  /** Movement cost multiplier. `null` when unused (blocked types). */
  movementCostMultiplier: number | null
  /** Explicit flag from terrain_type.is_blocked — do not infer from cost. */
  blocked: boolean
}

export type MapObjectKind = 'mine' | 'pickup' | 'town'

export type MapObjectData = {
  q: number
  r: number
  kind: MapObjectKind
  resourceId?: number | null
  marker: string
  /** Flavor name for towns. Unused for mines/pickups. */
  name?: string | null
  /** Town type table id. Unused for mines/pickups. */
  townTypeId?: number | null
  /** Frontend-only: mine or town claimed by the hero. */
  claimed?: boolean
  /** Frontend-only: pickup already collected. */
  collected?: boolean
}

function numericId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

const MARKER_TO_RESOURCE_ID: Record<string, number> = {
  g: 1,
  w: 2,
  o: 3,
  i: 4,
  c: 5,
  s: 6,
  a: 7,
  e: 8,
  n: 9,
  b: 10,
}

function resourceIdFromMarker(marker: string | undefined): number | undefined {
  if (!marker) {
    return undefined
  }
  return MARKER_TO_RESOURCE_ID[marker.trim().toLowerCase()]
}

/** Accept camelCase, snake_case, a numeric resource field, or the map marker. */
export function mapObjectResourceId(obj: MapObjectData): number | undefined {
  const extra = obj as MapObjectData & { resource_id?: unknown; resource?: unknown }
  return (
    numericId(obj.resourceId) ??
    numericId(extra.resource_id) ??
    numericId(extra.resource) ??
    resourceIdFromMarker(obj.marker)
  )
}

export function mapObjectTownTypeId(obj: MapObjectData): number | undefined {
  const extra = obj as MapObjectData & { town_type_id?: unknown }
  return numericId(obj.townTypeId) ?? numericId(extra.town_type_id)
}

export type TestGridResponse = {
  seed: number
  tiles: TileData[]
  objects: MapObjectData[]
}
