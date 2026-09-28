export type TileData = {
  q: number
  r: number
  terrain: string
  /** Movement cost multiplier. `null` when unused (blocked types). */
  movementCostMultiplier: number | null
  /** Explicit blocked flag from generation / terrain catalog / blocking props. */
  blocked: boolean
  /** Generation chunk id for continuous terrain texturing. */
  chunkId?: number | null
  /** Seeded world prop (`prop` table id). */
  propId?: number | null
  /** 1-based prop art variant. */
  propVariant?: number | null
  /** Base prop file name under `/assets/props/` (no extension). */
  propFile?: string | null
  /**
   * Auto-generated road overlay. Does not replace `terrain` — only movement
   * cost (via `road_move_cost`) and placeholder road rendering.
   */
  hasRoad?: boolean
  /**
   * 6-bit mask of routed road edges. Bit i links the i-th axial neighbour
   * (E, NE, NW, W, SW, SE). Present on road hexes, including 0.
   */
  roadMask?: number
  /** Zone id from map generation (debug overlay). */
  zoneId?: number | null
  /** Passage left in a zone wall (debug overlay). */
  wallGap?: boolean
  /** Neighbour zone ids for which this hex sits on a walled chunk edge. */
  wallBorders?: number[] | null
  /** Treasure pocket id (debug overlay). Interior, ring, and entrance. */
  pocketId?: number | null
  /** Guard tier for that pocket. */
  pocketTier?: number | null
  /** The one open hex. The pocket guard stands here. */
  pocketEntrance?: boolean
  /** Island shoreline guard tier. Set only on landing hexes that hold a guard. */
  islandGuardTier?: number | null
}

export type MapObjectKind =
  | 'mine'
  | 'pickup'
  | 'town'
  | 'fountain'
  | 'chest'
  | 'sign'
  | 'library'
  | 'hanger'
  | 'dock'
  | 'recruits'
  | 'notice_board'

export type MapObjectLoot = {
  resourceId: number
  qty: number
}

export type MapObjectData = {
  q: number
  r: number
  kind: MapObjectKind
  resourceId?: number | null
  marker: string
  /** Flavor name for towns / chests. Unused for mines/pickups. */
  name?: string | null
  /** Town type table id. Unused for mines/pickups. */
  townTypeId?: number | null
  /** Horizontal mirror chosen at world placement when feature.flippable. */
  flipped?: boolean | null
  /**
   * Loose pile quantity rolled at generation (`resource.payload.loose_*`).
   * Unused for mines/towns.
   */
  qty?: number | null
  /** Chest level (`stats.level`). */
  level?: number | null
  /** Chest loot rolled at generation. */
  loot?: MapObjectLoot[] | null
  /** Adjacent guard hex for chests. */
  guardQ?: number | null
  guardR?: number | null
  /** Chosen `sign_text.id` at generation. */
  signTextId?: number | null
  /** World Library ability ids rolled at generation. */
  abilityIds?: number[] | null
  /** Dock boat-launch hex (deep Water). */
  launchQ?: number | null
  launchR?: number | null
  /** Notice Board permanent town link (entry hex). */
  linkedTownQ?: number | null
  linkedTownR?: number | null
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

export function mapObjectChestLevel(obj: MapObjectData): number | undefined {
  const extra = obj as MapObjectData & { Level?: unknown }
  return numericId(obj.level) ?? numericId(extra.Level)
}

export function mapObjectChestLoot(
  obj: MapObjectData,
): Array<{ resource_id: number; qty: number }> {
  const raw = obj.loot
  if (!Array.isArray(raw)) {
    return []
  }
  const out: Array<{ resource_id: number; qty: number }> = []
  for (const entry of raw) {
    const rec = entry as {
      resourceId?: unknown
      resource_id?: unknown
      qty?: unknown
    }
    const resourceId = numericId(rec.resourceId) ?? numericId(rec.resource_id)
    const qty = numericId(rec.qty)
    if (resourceId == null || qty == null || qty <= 0) {
      continue
    }
    out.push({ resource_id: resourceId, qty })
  }
  return out
}

export function mapObjectGuard(obj: MapObjectData): { q: number; r: number } | null {
  const extra = obj as MapObjectData & { guard_q?: unknown; guard_r?: unknown }
  const q = numericId(obj.guardQ) ?? numericId(extra.guard_q)
  const r = numericId(obj.guardR) ?? numericId(extra.guard_r)
  if (q == null || r == null) {
    return null
  }
  return { q, r }
}

export function mapObjectSignTextId(obj: MapObjectData): number | undefined {
  const extra = obj as MapObjectData & { sign_text_id?: unknown }
  return numericId(obj.signTextId) ?? numericId(extra.sign_text_id)
}

export function mapObjectAbilityIds(obj: MapObjectData): number[] {
  const extra = obj as MapObjectData & { ability_ids?: unknown }
  const raw = obj.abilityIds ?? extra.ability_ids
  if (!Array.isArray(raw)) {
    return []
  }
  const out: number[] = []
  for (const entry of raw) {
    const id = numericId(entry)
    if (id != null && id > 0) {
      out.push(id)
    }
  }
  return out
}

export function mapObjectLaunch(obj: MapObjectData): { q: number; r: number } | null {
  const extra = obj as MapObjectData & { launch_q?: unknown; launch_r?: unknown }
  const q = numericId(obj.launchQ) ?? numericId(extra.launch_q)
  const r = numericId(obj.launchR) ?? numericId(extra.launch_r)
  if (q == null || r == null) {
    return null
  }
  return { q, r }
}

export function mapObjectLinkedTown(
  obj: MapObjectData,
): { q: number; r: number } | null {
  const extra = obj as MapObjectData & {
    linked_town_q?: unknown
    linked_town_r?: unknown
  }
  const q = numericId(obj.linkedTownQ) ?? numericId(extra.linked_town_q)
  const r = numericId(obj.linkedTownR) ?? numericId(extra.linked_town_r)
  if (q == null || r == null) {
    return null
  }
  return { q, r }
}

export type TestGridResponse = {
  seed: number
  tiles: TileData[]
  objects: MapObjectData[]
  /** Town→endpoint branch polylines (axial), for continuous placeholder strokes. */
  roads?: Array<Array<{ q: number; r: number }>>
  /** Planned chain before washout and orphan trim. Display only. */
  roadPlan?: RoadPlan | null
}

export type RoadPlanLink = {
  from: string
  to: string
  hexes: Array<{ q: number; r: number }>
  /** Feature branch. Interstate links omit this or set it false. */
  branch?: boolean
}

export type RoadPlan = {
  links: RoadPlanLink[]
  washed: Array<{ q: number; r: number }>
  orphans: Array<{ q: number; r: number }>
}
