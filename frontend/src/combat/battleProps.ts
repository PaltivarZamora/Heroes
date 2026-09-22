import type { Axial } from '../hex/hero'
import { hexDistance, neighborHexes } from '../hex/pathfinding'
import { forEachTile, getTile } from '../hex/world'
import type { ReferenceCatalog, PropRow } from '../town/catalog'
import {
  battlePropDensityMultiplier,
  battlePropSampleRadiusConfig,
  hexTerrainByName,
  unitById,
} from '../town/catalog'
import {
  ATTACKER_COL,
  ATTACKER_HERO_COL,
  DEFENDER_COL,
  DEFENDER_HERO_COL,
} from './battlefield'
import { pickPropVariant } from '../hex/propTextures'
import type { CombatBattle, CombatStack, CombatTile } from './battle'
import { isHeroStack } from './battle'
import {
  footprintHexes,
  parseFootprint,
} from './footprint'
import { moveKindForUnit } from './movement'
import { occupancyKey } from './occupancy'

/** Default world-sample radius when app_config is unset (see catalog helper). */
export const DEFAULT_BATTLE_PROP_SAMPLE_RADIUS = 2

export function battlePropSampleRadius(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return battlePropSampleRadiusConfig(catalog)
}

/** True when this prop may sit on the given battle/world terrain name. */
export function propEligibleOnTerrain(
  prop: PropRow,
  terrainName: string,
  catalog: ReferenceCatalog,
): boolean {
  const terrain = hexTerrainByName(catalog, terrainName)
  if (!terrain) {
    return false
  }
  const density = prop.terrain_rules[terrain.id]
  return density != null && density > 0
}

type WorldPropSample = {
  propId: number
  propFile: string
  propVariant: number
  isBlocker: boolean
}

function sampleWorldPropsNear(
  origins: Axial[],
  radius: number,
  catalog: ReferenceCatalog,
): WorldPropSample[] {
  const found: WorldPropSample[] = []
  const seen = new Set<string>()
  forEachTile((q, r) => {
    const inRange = origins.some(
      (origin) => hexDistance(origin, { q, r }) <= radius,
    )
    if (!inRange) {
      return
    }
    const tile = getTile(q, r)
    if (!tile?.propId || !tile.propFile) {
      return
    }
    const key = `${q},${r}`
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    const def = catalog.prop.find((row) => row.id === tile.propId)
    found.push({
      propId: tile.propId,
      propFile: tile.propFile,
      propVariant: tile.propVariant ?? 1,
      isBlocker: def?.is_blocker === true,
    })
  })
  return found
}

/** Ground-walkable hex keys (terrain/prop blocked excluded). */
export function groundWalkableKeys(
  tiles: CombatTile[],
  extraBlocked?: ReadonlySet<string>,
): string[] {
  const out: string[] = []
  for (const tile of tiles) {
    const key = occupancyKey(tile.q, tile.r)
    if (extraBlocked?.has(key)) {
      continue
    }
    if (tile.blocked) {
      continue
    }
    if (tile.movementCostMultiplier == null) {
      continue
    }
    out.push(key)
  }
  return out
}

/** True when all ground-walkable hexes form one connected component. */
export function groundWalkGraphConnected(
  tiles: CombatTile[],
  extraBlocked?: ReadonlySet<string>,
): boolean {
  const walkable = new Set(groundWalkableKeys(tiles, extraBlocked))
  if (walkable.size <= 1) {
    return true
  }
  const byKey = new Map(tiles.map((tile) => [occupancyKey(tile.q, tile.r), tile]))
  let start: string | null = null
  for (const key of walkable) {
    start = key
    break
  }
  if (!start) {
    return true
  }
  const queue = [start]
  const seen = new Set<string>([start])
  while (queue.length > 0) {
    const key = queue.shift()!
    const tile = byKey.get(key)
    if (!tile) {
      continue
    }
    for (const n of neighborHexes({ q: tile.q, r: tile.r })) {
      const nk = occupancyKey(n.q, n.r)
      if (!walkable.has(nk) || seen.has(nk)) {
        continue
      }
      seen.add(nk)
      queue.push(nk)
    }
  }
  return seen.size === walkable.size
}

function isGroundMobileStack(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): boolean {
  if (stack.qty <= 0 || isHeroStack(stack) || stack.indestructible) {
    return false
  }
  const unit = unitById(catalog, stack.unitId)
  if (!unit || (unit.speed ?? 0) <= 0) {
    return false
  }
  const kind = moveKindForUnit(unit, catalog)
  return kind === 'ground' || kind === 'submerge'
}

/**
 * Every ground-mobile stack keeps ≥1 adjacent landable hex after `extraBlocked`
 * (and live stacks) occupy space. Prevents fully enclosed pockets.
 */
export function groundStacksKeepAdjacentEscape(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  extraBlocked?: ReadonlySet<string>,
): boolean {
  const byKey = new Map(tiles.map((tile) => [occupancyKey(tile.q, tile.r), tile]))
  const occupied = new Set<string>()
  for (const stack of battle.stacks) {
    if (stack.qty <= 0) {
      continue
    }
    occupied.add(occupancyKey(stack.q, stack.r))
  }
  for (const stack of battle.stacks) {
    if (!isGroundMobileStack(stack, catalog)) {
      continue
    }
    let open = 0
    for (const n of neighborHexes({ q: stack.q, r: stack.r })) {
      const key = occupancyKey(n.q, n.r)
      if (extraBlocked?.has(key) || occupied.has(key)) {
        continue
      }
      const tile = byKey.get(key)
      if (!tile || tile.blocked || tile.movementCostMultiplier == null) {
        continue
      }
      open += 1
    }
    if (open < 1) {
      return false
    }
  }
  return true
}

/** Indestructible summon blockers + proposed keys (permanent walls). */
export function permanentBlockKeys(
  battle: CombatBattle | null,
  proposed: ReadonlySet<string> = new Set(),
): Set<string> {
  const out = new Set(proposed)
  if (!battle) {
    return out
  }
  for (const stack of battle.stacks) {
    if (stack.qty > 0 && stack.indestructible) {
      out.add(occupancyKey(stack.q, stack.r))
    }
  }
  return out
}

/**
 * Safe to add these blocker hex keys without trapping units or splitting the
 * ground-walk graph into enclosed pockets.
 */
export function blockerPlacementKeepsEscapeRoutes(
  battle: CombatBattle | null,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  newBlockedKeys: ReadonlySet<string>,
): boolean {
  const permanent = permanentBlockKeys(battle, newBlockedKeys)
  if (!groundWalkGraphConnected(tiles, permanent)) {
    return false
  }
  if (
    battle &&
    !groundStacksKeepAdjacentEscape(battle, catalog, tiles, permanent)
  ) {
    return false
  }
  return true
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

function reservedBattleCols(): Set<number> {
  // Keep army / hero columns clear of blocking scenery.
  return new Set([
    ATTACKER_HERO_COL,
    ATTACKER_COL,
    DEFENDER_COL,
    DEFENDER_HERO_COL,
  ])
}

/**
 * Dress the battlefield from world props near attacker/defender.
 * Bag composition follows nearby world density/types; placement is jittered
 * so two fights at the same world spot are not pixel-identical.
 */
export function seedBattlePropsFromWorld(
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
  attacker: Axial,
  defender: Axial,
  opts?: {
    seed?: number
    random?: () => number
    siege?: boolean
  },
): CombatTile[] {
  const radius = battlePropSampleRadius(catalog)
  const samples = sampleWorldPropsNear([attacker, defender], radius, catalog)
  if (samples.length === 0 || catalog.prop.length === 0) {
    return tiles
  }

  // Density from world sample: props / hexes examined in the two disks.
  let sampleHexes = 0
  const counted = new Set<string>()
  for (const origin of [attacker, defender]) {
    forEachTile((q, r) => {
      if (hexDistance(origin, { q, r }) > radius) {
        return
      }
      const key = `${q},${r}`
      if (counted.has(key)) {
        return
      }
      counted.add(key)
      sampleHexes += 1
    })
  }
  const worldRate = samples.length / Math.max(1, sampleHexes)
  const densityMult = battlePropDensityMultiplier(catalog)
  const battleRate = worldRate * densityMult

  const reservedCols = reservedBattleCols()
  const candidates = tiles.filter((tile) => {
    if (tile.blocked || tile.movementCostMultiplier == null) {
      return false
    }
    if (tile.col != null && reservedCols.has(tile.col)) {
      return false
    }
    if (opts?.siege) {
      const name = tile.terrain.replaceAll(' ', '_').toLowerCase()
      if (name === 'moat' || name === 'siege_floor') {
        return false
      }
    }
    return true
  })
  if (candidates.length === 0) {
    return tiles
  }

  // Jitter target count ±25% so rematches aren't identical.
  const random =
    opts?.random ??
    mulberry32(
      ((opts?.seed ?? 1) ^ ((Math.random() * 0xffffffff) >>> 0)) >>> 0,
    )
  const jitter = 0.75 + random() * 0.5
  const target = Math.min(
    candidates.length,
    Math.max(0, Math.round(candidates.length * battleRate * jitter)),
  )
  if (target <= 0) {
    return tiles
  }

  const bag = [...samples]
  const next = tiles.map((tile) => ({ ...tile }))
  const byKey = new Map(next.map((tile) => [occupancyKey(tile.q, tile.r), tile]))
  const open = candidates
    .map((tile) => occupancyKey(tile.q, tile.r))
    .filter((key) => byKey.has(key))
  const reserved = new Set<string>()

  let placed = 0
  let attempts = 0
  const maxAttempts = target * 12
  while (placed < target && open.length > 0 && attempts < maxAttempts) {
    attempts += 1
    const bagIdx = Math.min(bag.length - 1, Math.floor(random() * bag.length))
    const sample = bag[bagIdx]
    if (!sample) {
      break
    }
    const prop = catalog.prop.find((row) => row.id === sample.propId)
    if (!prop) {
      continue
    }
    const code = parseFootprint(prop.footprint)
    const openIdx = Math.min(open.length - 1, Math.floor(random() * open.length))
    const key = open[openIdx]!
    open.splice(openIdx, 1)
    const tile = byKey.get(key)
    if (!tile) {
      continue
    }
    if (reserved.has(key)) {
      continue
    }
    if (!propEligibleOnTerrain(prop, tile.terrain, catalog)) {
      open.push(key)
      continue
    }
    const cover = footprintHexes({ q: tile.q, r: tile.r }, code, 1)
    let coverOk = true
    const coverKeys: string[] = []
    for (const hex of cover) {
      const ck = occupancyKey(hex.q, hex.r)
      coverKeys.push(ck)
      const cell = byKey.get(ck)
      if (!cell || reserved.has(ck)) {
        coverOk = false
        break
      }
      if (cell.blocked || cell.movementCostMultiplier == null) {
        coverOk = false
        break
      }
      if (cell.col != null && reservedCols.has(cell.col)) {
        coverOk = false
        break
      }
      if (!propEligibleOnTerrain(prop, cell.terrain, catalog)) {
        coverOk = false
        break
      }
      if (opts?.siege) {
        const name = cell.terrain.replaceAll(' ', '_').toLowerCase()
        if (name === 'moat' || name === 'siege_floor') {
          coverOk = false
          break
        }
      }
    }
    if (!coverOk) {
      open.push(key)
      continue
    }
    // Equal weight across all variants (not terrain's 50/35/15 table).
    const variant = pickPropVariant(prop.variant_count, random)
    const blocker = prop.is_blocker === true
    const losBlocker = prop.is_los_blocker === true
    if (blocker) {
      const extra = new Set(coverKeys)
      if (!blockerPlacementKeepsEscapeRoutes(null, catalog, next, extra)) {
        open.push(key)
        continue
      }
    }
    // Anchor carries art; every covered hex is reserved (and blocked if blocker).
    tile.propId = prop.id
    tile.propFile = prop.file_name
    tile.propVariant = variant
    tile.propFootprint = code
    for (const ck of coverKeys) {
      reserved.add(ck)
      const cell = byKey.get(ck)
      if (!cell) {
        continue
      }
      if (blocker) {
        cell.blocked = true
      }
      if (losBlocker) {
        cell.blocksLos = true
      }
    }
    placed += 1
  }
  return next
}
