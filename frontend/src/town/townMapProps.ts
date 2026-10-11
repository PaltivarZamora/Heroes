import {
  hexTerrainByName,
  mapCfg,
  type PropRow,
  type ReferenceCatalog,
  type TownGroundPlan,
  type TownLayoutRow,
} from './catalog'
import {
  axialDistance,
  centerHexNumber,
  placedTownHex,
  TOWN_HEX_NUMBERS_WITHOUT_MIRROR,
  TOWN_MAP_HEX_COUNT,
  type TownHexPlaceContext,
  type TownMapGrid,
} from './townMapGrid'

export type TownMapPropDraw = {
  /** Placed hex (mirrored when the town is flipped). */
  hex: number
  propId: number
  fileName: string
  variant: number
  flipped: boolean
  renderScale: number
}

let warnedTownPropPct = false

/** `map_config.town_prop_pct` — percent chance each free hex gets a prop. */
export function townPropScatterPct(
  catalog: ReferenceCatalog,
): number | null {
  const raw = mapCfg(catalog, 'town_prop_pct', null)
  if (raw === undefined || raw === null) {
    if (!warnedTownPropPct) {
      console.warn(
        '[town map] map_config.town_prop_pct missing — no town props',
      )
      warnedTownPropPct = true
    }
    return null
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    return null
  }
  return Math.min(100, n)
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function townPropSeed(gameSeed: number, townId: string): number {
  let h = gameSeed >>> 0
  for (let i = 0; i < townId.length; i += 1) {
    h = Math.imul(h ^ townId.charCodeAt(i), 0x9e3779b1)
    h ^= h >>> 16
  }
  return h >>> 0
}

function townScatterProps(catalog: ReferenceCatalog): PropRow[] {
  return catalog.prop.filter(
    (row) =>
      !row.wall &&
      !row.naval_only &&
      !row.bridge_only &&
      Object.keys(row.terrain_rules).length > 0,
  )
}

function propsEligibleForTerrain(
  catalog: ReferenceCatalog,
  terrainId: number,
): PropRow[] {
  return townScatterProps(catalog).filter((prop) => {
    const density = prop.terrain_rules[terrainId]
    return density != null && density > 0
  })
}

function terrainRuleWeight(density: number): number {
  const w = density > 1 ? density / 100 : density
  return Math.max(0, w)
}

/** One pick among terrain-eligible props; weights = terrain_rules density. */
function pickPropForTerrain(
  eligible: PropRow[],
  terrainId: number,
  rng: () => number,
): PropRow | null {
  if (eligible.length === 0) {
    return null
  }
  let total = 0
  const weights: number[] = []
  for (const prop of eligible) {
    const w = terrainRuleWeight(prop.terrain_rules[terrainId] ?? 0)
    weights.push(w)
    total += w
  }
  if (total <= 0) {
    return eligible[Math.floor(rng() * eligible.length)]!
  }
  let roll = rng() * total
  for (let i = 0; i < eligible.length; i += 1) {
    roll -= weights[i]!
    if (roll <= 0) {
      return eligible[i]!
    }
  }
  return eligible[eligible.length - 1]!
}

export type TownMapPropStats = {
  terrainName: string
  eligibleTypes: number
  placed: number
}

export type TownMapPropsPlan = {
  props: TownMapPropDraw[]
  stats: TownMapPropStats
}

function neighborLayoutHexes(grid: TownMapGrid, n: number): number[] {
  const cell = grid.byNumber.get(n)
  if (!cell) {
    return []
  }
  const out: number[] = []
  for (const other of grid.cells) {
    if (other.n === n) {
      continue
    }
    if (axialDistance(cell, other) === 1) {
      out.push(other.n)
    }
  }
  return out
}

function layoutSignHex(
  grid: TownMapGrid,
  row: TownLayoutRow,
  built: boolean,
): number | null {
  if (built) {
    return null
  }
  const blocked = row.hexes.blocked
  const door = row.hexes.door
  if (blocked.length > 0) {
    return centerHexNumber(grid, blocked)
  }
  return door
}

export function planTownMapProps(
  catalog: ReferenceCatalog,
  grid: TownMapGrid,
  terrainName: string,
  gameSeed: number,
  townId: string,
  townName: string,
  flipped: boolean,
  layout: TownLayoutRow[],
  ground: TownGroundPlan | null,
  slotBuilt: (slot: number) => boolean,
): TownMapPropsPlan {
  const terrain = hexTerrainByName(catalog, terrainName)
  const label =
    terrain?.name?.trim() || terrainName.trim() || 'unknown'
  const eligible = terrain
    ? propsEligibleForTerrain(catalog, terrain.id)
    : []
  const emptyStats: TownMapPropsPlan = {
    props: [],
    stats: { terrainName: label, eligibleTypes: eligible.length, placed: 0 },
  }
  const pct = townPropScatterPct(catalog)
  if (pct == null || !terrain || eligible.length === 0) {
    return emptyStats
  }

  const blocked = new Set<number>(TOWN_HEX_NUMBERS_WITHOUT_MIRROR)
  const add = (n: number | null | undefined) => {
    if (n != null && n >= 1 && n <= TOWN_MAP_HEX_COUNT) {
      blocked.add(n)
    }
  }

  for (const n of ground?.road ?? []) {
    add(n)
  }
  add(ground?.entry)

  for (const row of layout) {
    for (const n of row.hexes.blocked) {
      add(n)
    }
    add(row.hexes.door)
    add(layoutSignHex(grid, row, slotBuilt(row.slot)))
  }

  const approaches = new Set<number>()
  const doorAndEntry: number[] = []
  if (ground?.entry != null) {
    doorAndEntry.push(ground.entry)
  }
  for (const row of layout) {
    if (row.hexes.door != null) {
      doorAndEntry.push(row.hexes.door)
    }
  }
  for (const n of doorAndEntry) {
    for (const nb of neighborLayoutHexes(grid, n)) {
      approaches.add(nb)
    }
  }

  const free: number[] = []
  for (let n = 1; n <= TOWN_MAP_HEX_COUNT; n += 1) {
    if (blocked.has(n) || approaches.has(n)) {
      continue
    }
    free.push(n)
  }

  const rng = mulberry32(townPropSeed(gameSeed, townId))
  const hexCtx: TownHexPlaceContext = { townName }
  const out: TownMapPropDraw[] = []

  for (const layoutHex of free) {
    if (rng() * 100 >= pct) {
      continue
    }
    const pick = pickPropForTerrain(eligible, terrain.id, rng)
    if (!pick) {
      continue
    }
    const placed = placedTownHex(layoutHex, flipped, hexCtx)
    if (placed == null) {
      continue
    }
    const variant =
      Math.floor(rng() * Math.max(1, pick.variant_count)) + 1
    const flippedArt = pick.flippable && rng() < 0.5
    out.push({
      hex: placed,
      propId: pick.id,
      fileName: pick.file_name,
      variant,
      flipped: flippedArt,
      renderScale: pick.render_scale,
    })
  }

  return {
    props: out,
    stats: {
      terrainName: label,
      eligibleTypes: eligible.length,
      placed: out.length,
    },
  }
}
