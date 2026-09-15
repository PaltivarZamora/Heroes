import type { Axial } from '../hex/hero'
import { neighborHexes } from '../hex/pathfinding'
import type { ReferenceCatalog } from '../town/catalog'
import { unitAttackShape, unitById, unitHasTag } from '../town/catalog'
import type {
  CombatBattle,
  CombatStack,
  CombatTerrainPatch,
  CombatTile,
} from './battle'
import { isHeroStack } from './battle'
import { occupancyKey } from './occupancy'
import { incomingDir } from './shapes'

export type { CombatTerrainPatch }

/** Goblin Hammersmith: ally with matching tag may be targeted for heal. */
export function isHealAllyTarget(
  attacker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
): boolean {
  if (
    isHeroStack(attacker) ||
    isHeroStack(target) ||
    attacker.id === target.id ||
    attacker.side !== target.side ||
    attacker.qty <= 0 ||
    target.qty <= 0
  ) {
    return false
  }
  const spec = unitAttackShape(unitById(catalog, attacker.unitId))
  if (!spec.healOnAllyTarget || spec.canTargetAllyIfTag == null) {
    return false
  }
  return unitHasTag(
    unitById(catalog, target.unitId),
    spec.canTargetAllyIfTag,
  )
}

export function healAmtForAllyRepair(
  attacker: CombatStack,
  catalog: ReferenceCatalog,
): number {
  const spec = unitAttackShape(unitById(catalog, attacker.unitId))
  const per = spec.healAmtPerUnit ?? 0
  return Math.max(0, Math.floor(per * attacker.qty))
}

function terrainImageName(terrainName: string): string | null {
  const base = terrainName.trim().replaceAll(' ', '_')
  return base.length > 0 ? `${base}_1.png` : null
}

function snapshotTile(tile: CombatTile): NonNullable<CombatTerrainPatch['previous']> {
  return {
    terrain: tile.terrain,
    blocked: tile.blocked,
    blocksLos: tile.blocksLos,
    movementCostMultiplier: tile.movementCostMultiplier,
  }
}

export function applyTerrainTypeToTiles(
  tiles: CombatTile[],
  hex: Axial,
  terrainTypeId: number,
  catalog: ReferenceCatalog,
): CombatTile[] {
  const spec = catalog.terrain_type.find((row) => row.id === terrainTypeId)
  if (!spec) {
    return tiles
  }
  const key = occupancyKey(hex.q, hex.r)
  return tiles.map((tile) => {
    if (occupancyKey(tile.q, tile.r) !== key) {
      return tile
    }
    return {
      ...tile,
      terrain: spec.name,
      blocked: spec.is_blocked,
      blocksLos: spec.blocks_los,
      movementCostMultiplier:
        spec.move_cost != null && Number.isFinite(spec.move_cost)
          ? spec.move_cost
          : tile.movementCostMultiplier,
    }
  })
}

function buildPatch(
  tile: CombatTile | undefined,
  hex: Axial,
  terrainTypeId: number,
  catalog: ReferenceCatalog,
): CombatTerrainPatch | null {
  const spec = catalog.terrain_type.find((row) => row.id === terrainTypeId)
  if (!spec) {
    return null
  }
  return {
    q: hex.q,
    r: hex.r,
    terrainTypeId,
    name: spec.name,
    imagePath: terrainImageName(spec.name),
    previous: tile ? snapshotTile(tile) : undefined,
  }
}

/** Stamp one or more terrain_type hexes; merges patches (latest wins per hex). */
export function placeTerrainPatches(
  battle: CombatBattle,
  tiles: CombatTile[],
  hexes: Axial[],
  terrainTypeId: number,
  catalog: ReferenceCatalog,
): { battle: CombatBattle; tiles: CombatTile[] } {
  let nextTiles = tiles
  const byKey = new Map(
    (battle.terrainPatches ?? []).map((row) => [
      occupancyKey(row.q, row.r),
      row,
    ]),
  )
  for (const hex of hexes) {
    const key = occupancyKey(hex.q, hex.r)
    const tile = nextTiles.find((row) => occupancyKey(row.q, row.r) === key)
    const patch = buildPatch(tile, hex, terrainTypeId, catalog)
    if (!patch) {
      continue
    }
    // Keep the oldest previous snapshot if re-stamping.
    const existing = byKey.get(key)
    if (existing?.previous && !patch.previous) {
      patch.previous = existing.previous
    } else if (existing?.previous) {
      patch.previous = existing.previous
    }
    byKey.set(key, patch)
    nextTiles = applyTerrainTypeToTiles(nextTiles, hex, terrainTypeId, catalog)
  }
  return {
    battle: { ...battle, terrainPatches: [...byKey.values()] },
    tiles: nextTiles,
  }
}

/** Restore stamped hexes inside `keys` (Sanctify / Gaia). */
export function clearTerrainPatchesOnKeys(
  battle: CombatBattle,
  tiles: CombatTile[],
  keys: ReadonlySet<string>,
  chancePct = 100,
  random: () => number = Math.random,
): { battle: CombatBattle; tiles: CombatTile[]; cleared: number; attempted: number } {
  const patches = battle.terrainPatches ?? []
  if (patches.length === 0 || keys.size === 0) {
    return { battle, tiles, cleared: 0, attempted: 0 }
  }
  const kept: CombatTerrainPatch[] = []
  const restore = new Map<string, NonNullable<CombatTerrainPatch['previous']>>()
  let cleared = 0
  let attempted = 0
  for (const patch of patches) {
    const key = occupancyKey(patch.q, patch.r)
    if (!keys.has(key)) {
      kept.push(patch)
      continue
    }
    attempted += 1
    if (chancePct < 100 && random() * 100 >= chancePct) {
      kept.push(patch)
      continue
    }
    cleared += 1
    if (patch.previous) {
      restore.set(key, patch.previous)
    }
  }
  if (cleared === 0) {
    return { battle, tiles, cleared: 0, attempted }
  }
  const nextTiles = tiles.map((tile) => {
    const prev = restore.get(occupancyKey(tile.q, tile.r))
    if (!prev) {
      return tile
    }
    return {
      ...tile,
      terrain: prev.terrain,
      blocked: prev.blocked,
      blocksLos: prev.blocksLos,
      movementCostMultiplier: prev.movementCostMultiplier,
    }
  })
  return {
    battle: { ...battle, terrainPatches: kept },
    tiles: nextTiles,
    cleared,
    attempted,
  }
}

/**
 * Void: before leaving hex, stamp terrain_type from abilities onto that hex.
 */
export function tryLeaveTerrainOnMove(
  battle: CombatBattle,
  stackId: string,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  from: Axial,
): { battle: CombatBattle; tiles: CombatTile[]; lines: string[] } {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || isHeroStack(stack) || stack.qty <= 0) {
    return { battle, tiles, lines: [] }
  }
  const terrainTypeId = unitAttackShape(
    unitById(catalog, stack.unitId),
  ).leavesTerrainTypeOnMove
  if (terrainTypeId == null || terrainTypeId <= 0) {
    return { battle, tiles, lines: [] }
  }
  const spec = catalog.terrain_type.find((row) => row.id === terrainTypeId)
  if (!spec) {
    return { battle, tiles, lines: [] }
  }
  const placed = placeTerrainPatches(battle, tiles, [from], terrainTypeId, catalog)
  return {
    battle: placed.battle,
    tiles: placed.tiles,
    lines: [`${spec.name} forms behind them.`],
  }
}

function isNeighbor(a: Axial, b: Axial): boolean {
  return neighborHexes(a).some((hex) => hex.q === b.q && hex.r === b.r)
}

/**
 * Barricade line: continuous empty hexes of length N centered on `aim`, along `dir`.
 * Skips occupied hexes when `avoidOccupied`; grows along the axis then
 * fills gaps via adjacent empty hexes when needed.
 */
export function barrierLineHexes(
  aim: Axial,
  length: number,
  dir: Axial,
  board: ReadonlySet<string>,
  occupied: ReadonlySet<string>,
  avoidOccupied: boolean,
): Axial[] {
  const want = Math.max(1, Math.floor(length))
  const open = (hex: Axial) => {
    const key = occupancyKey(hex.q, hex.r)
    if (!board.has(key)) {
      return false
    }
    if (avoidOccupied && occupied.has(key)) {
      return false
    }
    return true
  }
  const axis: Axial[] = []
  // Walk outward along ±dir from aim (aim first if open).
  if (open(aim)) {
    axis.push(aim)
  }
  for (let step = 1; axis.length < want * 2; step += 1) {
    const neg = { q: aim.q - dir.q * step, r: aim.r - dir.r * step }
    const pos = { q: aim.q + dir.q * step, r: aim.r + dir.r * step }
    if (open(neg)) {
      axis.unshift(neg)
    }
    if (open(pos)) {
      axis.push(pos)
    }
    if (!board.has(occupancyKey(neg.q, neg.r)) && !board.has(occupancyKey(pos.q, pos.r))) {
      break
    }
  }
  // Prefer a contiguous segment containing aim (or closest to it).
  let best: Axial[] = []
  for (let i = 0; i < axis.length; i += 1) {
    const run: Axial[] = [axis[i]!]
    for (let j = i + 1; j < axis.length; j += 1) {
      const prev = run[run.length - 1]!
      const next = axis[j]!
      if (!isNeighbor(prev, next)) {
        break
      }
      run.push(next)
    }
    if (run.length > best.length) {
      best = run
    }
    if (best.length >= want) {
      break
    }
  }
  if (best.length >= want) {
    // Center the window on aim when possible.
    const aimIdx = best.findIndex((hex) => hex.q === aim.q && hex.r === aim.r)
    if (aimIdx >= 0) {
      const half = Math.floor((want - 1) / 2)
      let start = Math.max(0, aimIdx - half)
      start = Math.min(start, Math.max(0, best.length - want))
      return best.slice(start, start + want)
    }
    return best.slice(0, want)
  }
  // Shortfall: grow from whatever we have using empty neighbors.
  const out = [...best]
  const seen = new Set(out.map((hex) => occupancyKey(hex.q, hex.r)))
  while (out.length < want) {
    let added: Axial | null = null
    for (const hex of out) {
      for (const n of neighborHexes(hex)) {
        const key = occupancyKey(n.q, n.r)
        if (seen.has(key) || !open(n)) {
          continue
        }
        added = n
        break
      }
      if (added) {
        break
      }
    }
    if (!added) {
      break
    }
    out.push(added)
    seen.add(occupancyKey(added.q, added.r))
  }
  return out.slice(0, want)
}

/** Direction for a barrier line. Prefer explicit cast orientation; else caster→aim. */
export function barrierLineDir(
  from: Axial | null,
  aim: Axial,
  chosen?: Axial | null,
): Axial {
  if (chosen && (chosen.q !== 0 || chosen.r !== 0)) {
    return { q: chosen.q, r: chosen.r }
  }
  if (!from || (from.q === aim.q && from.r === aim.r)) {
    return { q: 1, r: 0 }
  }
  return incomingDir(from, aim)
}
