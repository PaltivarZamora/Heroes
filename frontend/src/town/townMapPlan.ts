import type { GameSession, Hero, Town } from '../session/types'
import { slotStatesForTown } from '../session/accessors'
import {
  armyBuildOptions,
  buildingById,
  emptySlotPreviewLines,
  genericRoot,
  genericSlotBuildings,
  hasPrerequisite,
  isArmySlot,
  isEmptyPlaceholderSlot,
  isUndesignedSlot,
  lockedArmyPrerequisiteLines,
  missingGenericPrerequisiteLine,
  townLayoutFor,
  type ReferenceCatalog,
  type TownLayoutRow,
} from './catalog'
import { townBuildingArtUrl, slotArtUrl } from './slotArt'
import {
  centerHexNumber,
  createTownMapGrid,
  placedTownHex,
  roadHexesNearestEntry,
  type TownHexPlaceContext,
  type TownMapGrid,
} from './townMapGrid'
import {
  planTownMapProps,
  type TownMapPropDraw,
  type TownMapPropStats,
} from './townMapProps'

export const TOWN_SIGN_ART = slotArtUrl('Billboard.png')

export type TownSlotDraw = {
  slot: number
  /** Placed hexes that open this slot (footprint + door). */
  hit: number[]
  built: boolean
  /** Hexes the picture is fitted to. Empty when the slot has no door and no footprint. */
  pictureHexes: number[]
  /** Unbuilt sign hex. Null when the slot is built or has nowhere to stand. */
  signHex: number | null
  /** Footprint had no blocked hexes (picture uses the door, one hex). */
  doorOnly: boolean
  artUrl: string | null
  /** Shown when the picture file is missing (UI-style label; not flipped). */
  artLabel: string
  tip: string
  dimmed: boolean
  scale: number
  dx: number
  dy: number
}

export type TownMapPlan = {
  grid: TownMapGrid
  flipped: boolean
  townTypeName: string
  terrainName: string
  entry: number | null
  /** Entry included. Placed (mirrored) hex numbers. */
  road: number[]
  slots: TownSlotDraw[]
  /** slot → winning hit hexes already applied (door wins over another footprint). */
  hexSlot: Map<number, number>
  /** Layout slots whose `blocked` list is empty. */
  emptyFootprintSlots: number[]
  /** Layout slots with neither a door nor a footprint. */
  unplacedSlots: number[]
  heroes: Hero[]
  /** Placed hex for each hero, entry first then nearest road hexes. */
  heroHexes: number[]
  /** Seeded scenery props (display only). */
  props: TownMapPropDraw[]
  propStats: TownMapPropStats
}

function signState(
  catalog: ReferenceCatalog,
  slotId: number,
  townTypeId: number,
  builtIds: ReadonlySet<number>,
): { dimmed: boolean; tip: string } {
  if (
    isUndesignedSlot(catalog, slotId, townTypeId) ||
    isEmptyPlaceholderSlot(catalog, slotId, townTypeId)
  ) {
    return {
      dimmed: true,
      tip: emptySlotPreviewLines(
        catalog,
        slotId,
        townTypeId,
        builtIds,
      ).join('\n'),
    }
  }
  if (isArmySlot(slotId)) {
    const options = armyBuildOptions(catalog, slotId, townTypeId, builtIds)
    if (options.length === 0) {
      return {
        dimmed: true,
        tip: lockedArmyPrerequisiteLines(
          catalog,
          slotId,
          townTypeId,
          builtIds,
        ).join('\n'),
      }
    }
    const labels = options
      .map((row) => row.name?.trim() || 'Building')
      .join(' / ')
    return { dimmed: false, tip: `Click to build: ${labels}` }
  }
  const root = genericRoot(genericSlotBuildings(catalog, slotId, townTypeId))
  if (!root) {
    return { dimmed: true, tip: 'No building defined for this slot.' }
  }
  if (!hasPrerequisite(root, builtIds)) {
    return {
      dimmed: true,
      tip: missingGenericPrerequisiteLine(catalog, root, builtIds),
    }
  }
  const name = root.name?.trim() || 'Building'
  return { dimmed: false, tip: `Click to build: ${name}` }
}

function placedList(
  numbers: readonly number[],
  flipped: boolean,
  ctx: TownHexPlaceContext,
  role: TownHexPlaceContext['role'],
): number[] {
  const out: number[] = []
  const seen = new Set<number>()
  for (const n of numbers) {
    const placed = placedTownHex(n, flipped, { ...ctx, role })
    if (placed == null || seen.has(placed)) {
      continue
    }
    seen.add(placed)
    out.push(placed)
  }
  return out
}

function slotDraw(
  catalog: ReferenceCatalog,
  row: TownLayoutRow,
  townTypeId: number,
  townTypeName: string,
  townName: string,
  flipped: boolean,
  builtIds: ReadonlySet<number>,
  level: number,
  buildingId: number | null,
  grid: TownMapGrid,
): TownSlotDraw {
  const hexCtx: TownHexPlaceContext = {
    townName,
    slot: row.slot,
  }
  const blocked = placedList(row.hexes.blocked, flipped, hexCtx, 'footprint')
  const door =
    row.hexes.door != null
      ? placedTownHex(row.hexes.door, flipped, { ...hexCtx, role: 'door' })
      : null
  const hit = blocked.slice()
  if (door != null && !hit.includes(door)) {
    hit.push(door)
  }
  const doorOnly = row.hexes.blocked.length === 0 && door != null
  const pictureHexes = blocked.length > 0 ? blocked : door != null ? [door] : []
  const display = row.mapDisplay
  const built = level > 0 && buildingId != null
  const building = built ? buildingById(catalog, buildingId) : null
  const file = building?.image_path?.trim() || ''
  const sign = signState(catalog, row.slot, townTypeId, builtIds)
  const signHex = built
    ? null
    : blocked.length > 0
      ? centerHexNumber(grid, blocked)
      : door
  return {
    slot: row.slot,
    hit,
    built,
    pictureHexes,
    signHex,
    doorOnly,
    artUrl: built
      ? file
        ? townBuildingArtUrl(file, townTypeName)
        : null
      : TOWN_SIGN_ART,
    artLabel: built
      ? file || building?.name || `Slot ${row.slot}`
      : 'Billboard.png',
    tip: built ? building?.name?.trim() || 'Building' : sign.tip,
    dimmed: built ? false : sign.dimmed,
    scale: display?.scale ?? 1,
    dx: (display?.dx ?? 0) * (flipped ? -1 : 1),
    dy: display?.dy ?? 0,
  }
}

export function heroesStandingInTown(
  session: GameSession,
  town: Town,
  preferredId?: string | null,
): Hero[] {
  const heroes = session.heroes.filter(
    (hero) =>
      !hero.flight &&
      hero.position.q === town.position.q &&
      hero.position.r === town.position.r,
  )
  heroes.sort((a, b) => {
    if (preferredId && a.id === preferredId) {
      return -1
    }
    if (preferredId && b.id === preferredId) {
      return 1
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return heroes
}

export function planTownMap(
  session: GameSession,
  catalog: ReferenceCatalog,
  town: Town,
  terrainName: string,
  preferredHeroId?: string | null,
): TownMapPlan {
  const grid = createTownMapGrid()
  const flipped = town.flipped === true
  const townName = town.name?.trim() || 'Town'
  const townTypeName =
    catalog.town.find((row) => row.id === town.town_type_id)?.name?.trim() ||
    'Necropolis'
  const hexCtx: TownHexPlaceContext = { townName }
  const layout = townLayoutFor(catalog, town.town_type_id)
  const slots = slotStatesForTown(session, town.id)
  const builtIds = new Set(
    session.building_states
      .filter(
        (row) =>
          row.town_id === town.id &&
          row.level >= 1 &&
          row.building_id != null,
      )
      .map((row) => Number(row.building_id))
      .filter((id) => Number.isInteger(id) && id > 0),
  )
  const draws = layout.map((row) => {
    const state = slots[row.slot - 1]
    return slotDraw(
      catalog,
      row,
      town.town_type_id,
      townTypeName,
      townName,
      flipped,
      builtIds,
      state?.level ?? 0,
      state?.buildingId ?? null,
      grid,
    )
  })
  // Footprints first, then doors, so a door hex always opens its own slot.
  const hexSlot = new Map<number, number>()
  for (const draw of draws) {
    if (draw.doorOnly) {
      continue
    }
    for (const n of draw.pictureHexes) {
      hexSlot.set(n, draw.slot)
    }
  }
  for (const draw of draws) {
    for (const n of draw.hit) {
      if (draw.doorOnly || !draw.pictureHexes.includes(n)) {
        hexSlot.set(n, draw.slot)
      }
    }
  }

  const ground = catalog.town.find((row) => row.id === town.town_type_id)?.map
  const entry =
    ground?.entry != null
      ? placedTownHex(ground.entry, flipped, { ...hexCtx, role: 'entry' })
      : null
  const roadBody = placedList(ground?.road ?? [], flipped, hexCtx, 'road').filter(
    (n) => n !== entry,
  )
  const road = entry != null ? [entry, ...roadBody] : roadBody
  const heroes = heroesStandingInTown(session, town, preferredHeroId)
  const nearest = roadHexesNearestEntry(grid, entry, roadBody)
  const stands: number[] = []
  if (entry != null && grid.byNumber.has(entry)) {
    stands.push(entry)
  }
  for (const n of nearest) {
    stands.push(n)
  }
  const heroHexes = heroes.map((_, index) => {
    if (stands.length === 0) {
      return 0
    }
    return stands[Math.min(index, stands.length - 1)]!
  })

  const { props, stats: propStats } = planTownMapProps(
    catalog,
    grid,
    terrainName,
    session.game?.seed ?? 0,
    town.id,
    townName,
    flipped,
    layout,
    ground ?? null,
    (slot) => {
      const state = slots[slot - 1]
      return (state?.level ?? 0) > 0 && state?.buildingId != null
    },
  )

  return {
    grid,
    flipped,
    townTypeName,
    terrainName,
    entry,
    road,
    slots: draws,
    hexSlot,
    emptyFootprintSlots: layout
      .filter((row) => row.hexes.blocked.length === 0)
      .map((row) => row.slot),
    unplacedSlots: draws.filter((draw) => draw.hit.length === 0).map((draw) => draw.slot),
    heroes,
    heroHexes,
    props,
    propStats,
  }
}
