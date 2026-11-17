/**
 * Battle-start army placement: single back-column layout → per-slot fallback.
 * Never drops stacks.
 */
import type { Axial } from '../hex/hero'
import type { ReferenceCatalog } from '../town/catalog'
import { unitById } from '../town/catalog'
import {
  isHeroStack,
  type CombatBattle,
  type CombatSide,
  type CombatStack,
  type CombatTile,
} from './battle'
import {
  ATTACKER_COL,
  ATTACKER_HERO_COL,
  COMBAT_COLUMNS,
  DEFENDER_COL,
  DEFENDER_HERO_COL,
  HERO_ROW,
  isCombatFrameBorder,
  isSiegeExteriorCol,
  siegeWallColForRow,
} from './battlefield'
import {
  combatCanLandOn,
  combatEnterCost,
  groundEffectMovementBlockKeys,
  moveKindForUnit,
  type MoveKind,
} from './movement'
import {
  footprintBlockingHexes,
  footprintExtent,
} from './footprint'
import {
  combatBodyFootprint,
  footprintAlong,
  footprintFits,
  occupiedHexes,
  stackBlockingFootprint,
} from './occupancy'
import { tombstoneOccupancyBodies } from './tombstone'

export type PlacementLayoutMode = 'column' | 'column-squeezed' | 'per-slot'

type SideColumnResult = {
  mode: PlacementLayoutMode
  anchors: Map<string, Axial>
  fallbackCount: number
  squeezeSteps: number
}

function sidePlacementLogLabel(result: SideColumnResult): string {
  const columnPart =
    result.anchors.size > 0
      ? result.squeezeSteps > 0
        ? `column squeezed (${result.squeezeSteps})`
        : 'column'
      : ''
  if (result.fallbackCount === 0) {
    return columnPart || 'column'
  }
  const fallbackPart = `fallback for ${result.fallbackCount} stack${result.fallbackCount === 1 ? '' : 's'}`
  if (!columnPart) {
    return fallbackPart
  }
  return `${columnPart}, ${fallbackPart}`
}

function formatPlacementLogLine(atk: SideColumnResult, def: SideColumnResult): string {
  const atkLabel = sidePlacementLogLabel(atk)
  const defLabel = sidePlacementLogLabel(def)
  if (atkLabel === defLabel) {
    return `Placement: ${atkLabel}`
  }
  return `Placement: attackers ${atkLabel}, defenders ${defLabel}`
}

export type BattleStartPlacementOpts = {
  siege: boolean
  attackerCol?: number
  defenderCol?: number
  sessionHeroName?: (heroId: string) => string | null
}

export type BattleSlotMarker = {
  key: string
  side: CombatSide
  slot: number
  x: number
  y: number
  q: number
  r: number
}

function stackLabel(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  sessionHeroName?: (heroId: string) => string | null,
): string {
  if (isHeroStack(stack) && stack.heroId) {
    return sessionHeroName?.(stack.heroId)?.trim() || 'Hero'
  }
  return unitById(catalog, stack.unitId)?.name ?? 'Unit'
}

function isFixedStartStack(stack: CombatStack): boolean {
  if (isHeroStack(stack)) {
    return true
  }
  if (stack.id.startsWith('combat-wall-') || stack.id === 'combat-siege-engine') {
    return true
  }
  return false
}

function moveKindForStack(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): MoveKind {
  if (isHeroStack(stack)) {
    return 'ground'
  }
  return moveKindForUnit(unitById(catalog, stack.unitId), catalog)
}

function tileByHex(tiles: CombatTile[]): Map<string, CombatTile> {
  const map = new Map<string, CombatTile>()
  for (const tile of tiles) {
    map.set(`${tile.q},${tile.r}`, tile)
  }
  return map
}

function tileOnOwnSide(
  tile: CombatTile,
  side: CombatSide,
  tiles: CombatTile[],
): boolean {
  if (tile.col == null) {
    return true
  }
  const naval = tiles.some((row) => row.navalKind != null)
  if (naval) {
    const waterCols = tiles
      .filter(
        (row) => row.navalKind === 'water' || row.navalKind === 'gangplank',
      )
      .map((row) => row.col)
      .filter((col): col is number => col != null)
    if (waterCols.length === 0) {
      return true
    }
    const waterMin = Math.min(...waterCols)
    const waterMax = Math.max(...waterCols)
    if (side === 'atk') {
      return tile.col < waterMin
    }
    return tile.col > waterMax
  }
  const mid = Math.floor(COMBAT_COLUMNS / 2)
  if (side === 'atk') {
    return tile.col < mid
  }
  return tile.col > mid
}

function isPlayableTile(tile: CombatTile | undefined): tile is CombatTile {
  if (!tile) {
    return false
  }
  if (tile.displayOnly || isCombatFrameBorder(tile.col ?? 0, tile.row ?? 0)) {
    return false
  }
  return true
}

function deploymentColRange(side: CombatSide): { min: number; max: number } {
  if (side === 'atk') {
    return { min: ATTACKER_HERO_COL, max: ATTACKER_COL }
  }
  return { min: DEFENDER_COL, max: DEFENDER_HERO_COL }
}

function blockingFootprintAt(
  origin: Axial,
  stack: CombatStack,
  catalog: ReferenceCatalog,
): Axial[] {
  return footprintBlockingHexes(
    origin,
    combatBodyFootprint(stack, catalog),
    footprintAlong(stack.side),
  )
}

function everyBlockingFootprintTile(
  origin: Axial,
  stack: CombatStack,
  catalog: ReferenceCatalog,
  tiles: Map<string, CombatTile>,
  pred: (tile: CombatTile) => boolean,
): boolean {
  for (const hex of blockingFootprintAt(origin, stack, catalog)) {
    const tile = tiles.get(`${hex.q},${hex.r}`)
    if (!tile || !pred(tile)) {
      return false
    }
    if (!isPlayableTile(tile)) {
      return false
    }
  }
  return true
}

function inDeploymentBand(
  tile: CombatTile,
  side: CombatSide,
): boolean {
  if (tile.col == null) {
    return false
  }
  const { min, max } = deploymentColRange(side)
  return tile.col >= min && tile.col <= max
}

function startingAreaAnchor(
  origin: Axial,
  stack: CombatStack,
  catalog: ReferenceCatalog,
  tileMap: Map<string, CombatTile>,
  opts: BattleStartPlacementOpts,
): boolean {
  const side = stack.side
  const minRow = HERO_ROW
  return everyBlockingFootprintTile(origin, stack, catalog, tileMap, (tile) => {
    if ((tile.row ?? 0) < minRow) {
      return false
    }
    if (opts.siege && side === 'def') {
      const col = tile.col ?? 0
      const row = tile.row ?? 0
      return col >= siegeWallColForRow(row)
    }
    if (!inDeploymentBand(tile, side)) {
      return false
    }
    if (opts.siege && side === 'atk') {
      return isSiegeExteriorCol(tile.col ?? 0, tile.row ?? 0)
    }
    return true
  })
}

function outsideWallAnchor(
  origin: Axial,
  stack: CombatStack,
  catalog: ReferenceCatalog,
  tileMap: Map<string, CombatTile>,
): boolean {
  return everyBlockingFootprintTile(origin, stack, catalog, tileMap, (tile) =>
    isSiegeExteriorCol(tile.col ?? 0, tile.row ?? 0),
  )
}

/** Last resort: any playable tile; siege attackers stay outside the walls. */
function fieldFallbackAnchor(
  origin: Axial,
  stack: CombatStack,
  catalog: ReferenceCatalog,
  tileMap: Map<string, CombatTile>,
  opts: BattleStartPlacementOpts,
): boolean {
  return everyBlockingFootprintTile(origin, stack, catalog, tileMap, (tile) => {
    if ((tile.row ?? 0) < HERO_ROW) {
      return false
    }
    if (opts.siege && stack.side === 'atk') {
      return isSiegeExteriorCol(tile.col ?? 0, tile.row ?? 0)
    }
    return true
  })
}

function backEdgeScanTiles(
  tiles: CombatTile[],
  side: CombatSide,
  scope: 'ownSide' | 'fullField' = 'ownSide',
): CombatTile[] {
  const playable = tiles.filter(
    (t) =>
      isPlayableTile(t) &&
      t.col != null &&
      (t.row ?? 0) >= HERO_ROW &&
      (scope === 'fullField' || tileOnOwnSide(t, side, tiles)),
  )
  const cols = [...new Set(playable.map((t) => t.col as number))].sort((a, b) =>
    side === 'atk' ? a - b : b - a,
  )
  const byCol = new Map<number, CombatTile[]>()
  for (const tile of playable) {
    const col = tile.col as number
    const list = byCol.get(col) ?? []
    list.push(tile)
    byCol.set(col, list)
  }
  const ordered: CombatTile[] = []
  for (const col of cols) {
    const rowTiles = byCol.get(col) ?? []
    rowTiles.sort((a, b) => (a.row ?? 0) - (b.row ?? 0))
    ordered.push(...rowTiles)
  }
  return ordered
}

function pickOverflowAnchor(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  battle: CombatBattle,
  tiles: CombatTile[],
  zoneFilter: (origin: Axial) => boolean,
  placedIds: ReadonlySet<string>,
  scanScope: 'ownSide' | 'fullField' = 'ownSide',
): Axial | null {
  for (const tile of backEdgeScanTiles(tiles, stack.side, scanScope)) {
    const origin = { q: tile.q, r: tile.r }
    if (!zoneFilter(origin)) {
      continue
    }
    if (stackFitsAt(stack, catalog, battle, tiles, origin, placedIds)) {
      return origin
    }
  }
  return null
}

function stacksForPlacementOccupancy(
  battle: CombatBattle,
  placedIds: ReadonlySet<string>,
): CombatStack[] {
  return battle.stacks.filter(
    (stack) =>
      stack.qty > 0 &&
      (isFixedStartStack(stack) || placedIds.has(stack.id)),
  )
}

function stackFitsAt(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  battle: CombatBattle,
  tiles: CombatTile[],
  at: Axial,
  placedIds: ReadonlySet<string>,
): boolean {
  const kind = moveKindForStack(stack, catalog)
  const blockKeys = groundEffectMovementBlockKeys(battle)
  const occupied = occupiedHexes(
    stacksForPlacementOccupancy(battle, placedIds),
    catalog,
    stack.id,
    tombstoneOccupancyBodies(battle.tombstones, catalog),
  )
  const enterCost = (q: number, r: number) => {
    const tile = tiles.find((row) => row.q === q && row.r === r)
    if (!combatCanLandOn(tile, kind, undefined, blockKeys)) {
      return null
    }
    return combatEnterCost(tile, kind, undefined, blockKeys)
  }
  return footprintFits(
    at,
    combatBodyFootprint(stack, catalog),
    footprintAlong(stack.side),
    occupied,
    enterCost,
  )
}

type BodyGridBounds = {
  topRow: number
  bottomRow: number
  minCol: number
  maxCol: number
  width: number
}

function bodyGridBounds(
  origin: Axial,
  stack: CombatStack,
  catalog: ReferenceCatalog,
  tileMap: Map<string, CombatTile>,
): BodyGridBounds | null {
  let topRow = Infinity
  let bottomRow = -Infinity
  let minCol = Infinity
  let maxCol = -Infinity
  for (const hex of blockingFootprintAt(origin, stack, catalog)) {
    const tile = tileMap.get(`${hex.q},${hex.r}`)
    if (!tile || tile.col == null || tile.row == null) {
      return null
    }
    topRow = Math.min(topRow, tile.row)
    bottomRow = Math.max(bottomRow, tile.row)
    minCol = Math.min(minCol, tile.col)
    maxCol = Math.max(maxCol, tile.col)
  }
  if (!Number.isFinite(topRow)) {
    return null
  }
  return {
    topRow,
    bottomRow,
    minCol,
    maxCol,
    width: maxCol - minCol + 1,
  }
}

function fixedStackBlockKeys(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
): Set<string> {
  const keys = new Set<string>()
  for (const stack of battle.stacks) {
    if (!isFixedStartStack(stack) || stack.qty <= 0) {
      continue
    }
    for (const hex of stackBlockingFootprint(stack, catalog)) {
      keys.add(`${hex.q},${hex.r}`)
    }
  }
  for (const body of tombstoneOccupancyBodies(battle.tombstones, catalog)) {
    for (const hex of body.hexes) {
      keys.add(`${hex.q},${hex.r}`)
    }
  }
  return keys
}

function trialBlockKeysFromAnchors(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  anchors: ReadonlyMap<string, Axial>,
  exceptId?: string,
): Set<string> {
  const keys = fixedStackBlockKeys(battle, catalog)
  for (const [id, origin] of anchors) {
    if (id === exceptId) {
      continue
    }
    const stack = battle.stacks.find((row) => row.id === id)
    if (!stack) {
      continue
    }
    for (const hex of blockingFootprintAt(origin, stack, catalog)) {
      keys.add(`${hex.q},${hex.r}`)
    }
  }
  return keys
}

function stacksToPlaceOnSide(
  battle: CombatBattle,
  side: CombatSide,
): CombatStack[] {
  return battle.stacks
    .filter((stack) => !isFixedStartStack(stack) && stack.qty > 0 && stack.side === side)
    .sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id))
}

function backDeployCol(side: CombatSide, opts: BattleStartPlacementOpts): number {
  return side === 'atk'
    ? (opts.attackerCol ?? ATTACKER_COL)
    : (opts.defenderCol ?? DEFENDER_COL)
}

function columnLayoutZoneAnchor(
  origin: Axial,
  stack: CombatStack,
  catalog: ReferenceCatalog,
  tileMap: Map<string, CombatTile>,
  tiles: CombatTile[],
  opts: BattleStartPlacementOpts,
): boolean {
  const side = stack.side
  return everyBlockingFootprintTile(origin, stack, catalog, tileMap, (tile) => {
    if ((tile.row ?? 0) < HERO_ROW) {
      return false
    }
    if (!tileOnOwnSide(tile, side, tiles)) {
      return false
    }
    if (opts.siege && side === 'def') {
      const col = tile.col ?? 0
      const row = tile.row ?? 0
      return col >= siegeWallColForRow(row)
    }
    if (opts.siege && side === 'atk') {
      return isSiegeExteriorCol(tile.col ?? 0, tile.row ?? 0)
    }
    return true
  })
}

function stackFitsAtColumnTrial(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  battle: CombatBattle,
  tiles: CombatTile[],
  at: Axial,
  blockedKeys: ReadonlySet<string>,
  tileMap: Map<string, CombatTile>,
  opts: BattleStartPlacementOpts,
): boolean {
  if (!columnLayoutZoneAnchor(at, stack, catalog, tileMap, tiles, opts)) {
    return false
  }
  const kind = moveKindForStack(stack, catalog)
  const blockKeys = groundEffectMovementBlockKeys(battle)
  const occupied = new Set(blockedKeys)
  const enterCost = (q: number, r: number) => {
    const tile = tiles.find((row) => row.q === q && row.r === r)
    if (!combatCanLandOn(tile, kind, undefined, blockKeys)) {
      return null
    }
    return combatEnterCost(tile, kind, undefined, blockKeys)
  }
  return footprintFits(
    at,
    combatBodyFootprint(stack, catalog),
    footprintAlong(stack.side),
    occupied,
    enterCost,
  )
}

function maxPlayableBodyRow(tiles: CombatTile[]): number {
  let max = HERO_ROW
  for (const tile of tiles) {
    if (isPlayableTile(tile) && (tile.row ?? 0) >= HERO_ROW) {
      max = Math.max(max, tile.row ?? 0)
    }
  }
  return max
}

function stackFootprintRowSpan(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): number {
  return footprintExtent(combatBodyFootprint(stack, catalog)).rows
}

/** Blank playable rows between stack i feet and stack i+1 head; gaps length = stacks - 1. */
function buildFootRowsForStacks(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  blankGaps: number[],
  footAdjust: number[],
): number[] {
  const footRows: number[] = []
  let foot = HERO_ROW + (footAdjust[0] ?? 0)
  for (let i = 0; i < stacks.length; i += 1) {
    if (i > 0) {
      const blank = blankGaps[i - 1] ?? 1
      const span = stackFootprintRowSpan(stacks[i]!, catalog)
      foot =
        footRows[i - 1]! + blank + span
      foot += footAdjust[i] ?? 0
    }
    footRows.push(foot)
  }
  return footRows
}

function columnFootRowsFit(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  footRows: number[],
  maxRow: number,
): boolean {
  for (let i = 0; i < stacks.length; i += 1) {
    const span = stackFootprintRowSpan(stacks[i]!, catalog)
    const foot = footRows[i]!
    const top = foot - (span - 1)
    if (foot > maxRow || top < 0) {
      return false
    }
    if (foot < HERO_ROW) {
      return false
    }
    if (i === 0) {
      continue
    }
    if (top < HERO_ROW) {
      return false
    }
  }
  return true
}

type ColumnPlaceResult = {
  anchors: Map<string, Axial>
  /** Index of first stack not placed; stacks.length when all placed. */
  failedFrom: number
}

function footAnchorAlignedToBackCol(
  origin: Axial,
  stack: CombatStack,
  catalog: ReferenceCatalog,
  tileMap: Map<string, CombatTile>,
  colStart: number,
): boolean {
  const bounds = bodyGridBounds(origin, stack, catalog, tileMap)
  if (!bounds) {
    return false
  }
  if (stack.side === 'atk' && bounds.minCol !== colStart) {
    return false
  }
  if (stack.side === 'def' && bounds.maxCol !== colStart) {
    return false
  }
  return true
}

function stackFootRowsInBounds(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  footRow: number,
  maxRow: number,
  stackIndex: number,
): boolean {
  const span = stackFootprintRowSpan(stack, catalog)
  const top = footRow - (span - 1)
  if (footRow > maxRow || top < 0 || footRow < HERO_ROW) {
    return false
  }
  if (stackIndex === 0) {
    return true
  }
  return top >= HERO_ROW
}

function tryPlaceColumnAtFootRows(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  tileMap: Map<string, CombatTile>,
  opts: BattleStartPlacementOpts,
  side: CombatSide,
  stacks: CombatStack[],
  footRowsIn: number[],
): ColumnPlaceResult | null {
  const colStart = backDeployCol(side, opts)
  const maxRow = maxPlayableBodyRow(tiles)
  const anchors = new Map<string, Axial>()

  for (let i = 0; i < stacks.length; i += 1) {
    const stack = stacks[i]!
    const footRow = footRowsIn[i]!
    if (!stackFootRowsInBounds(stack, catalog, footRow, maxRow, i)) {
      return i === 0 ? null : { anchors, failedFrom: i }
    }
    const origin = anchorAtColRow(tiles, colStart, footRow)
    if (!origin) {
      return i === 0 ? null : { anchors, failedFrom: i }
    }
    if (!footAnchorAlignedToBackCol(origin, stack, catalog, tileMap, colStart)) {
      return i === 0 ? null : { anchors, failedFrom: i }
    }
    const blocked = trialBlockKeysFromAnchors(battle, catalog, anchors, stack.id)
    if (
      !stackFitsAtColumnTrial(
        stack,
        catalog,
        battle,
        tiles,
        origin,
        blocked,
        tileMap,
        opts,
      )
    ) {
      return { anchors, failedFrom: i }
    }
    anchors.set(stack.id, origin)
  }
  return { anchors, failedFrom: stacks.length }
}

function tryColumnLayout(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  tileMap: Map<string, CombatTile>,
  opts: BattleStartPlacementOpts,
  side: CombatSide,
): { anchors: Map<string, Axial>; squeezeSteps: number } | null {
  const stacks = stacksToPlaceOnSide(battle, side)
  if (stacks.length === 0) {
    return { anchors: new Map(), squeezeSteps: 0 }
  }
  const maxRow = maxPlayableBodyRow(tiles)
  const gapCount = Math.max(0, stacks.length - 1)
  const blankGaps = Array(gapCount).fill(1)
  const footAdjust = Array(stacks.length).fill(0)
  let squeezeSteps = 0

  const tryPlaceAtLayout = (): ColumnPlaceResult | 'no-rows' => {
    const footRows = buildFootRowsForStacks(
      stacks,
      catalog,
      blankGaps,
      footAdjust,
    )
    if (!columnFootRowsFit(stacks, catalog, footRows, maxRow)) {
      return 'no-rows'
    }
    const placed = tryPlaceColumnAtFootRows(
      battle,
      catalog,
      tiles,
      tileMap,
      opts,
      side,
      stacks,
      footRows,
    )
    return placed ?? { anchors: new Map(), failedFrom: 0 }
  }

  while (true) {
    const placed = tryPlaceAtLayout()
    if (placed !== 'no-rows') {
      if (placed.failedFrom === stacks.length) {
        return { anchors: placed.anchors, squeezeSteps }
      }
      if (placed.anchors.size > 0) {
        return { anchors: placed.anchors, squeezeSteps }
      }
      return null
    }

    let stepped = false
    for (let i = 0; i < stacks.length; i += 1) {
      footAdjust[i]! -= 1
      const footRows = buildFootRowsForStacks(
        stacks,
        catalog,
        blankGaps,
        footAdjust,
      )
      if (!columnFootRowsFit(stacks, catalog, footRows, maxRow)) {
        footAdjust[i]! += 1
        continue
      }
      squeezeSteps += 1
      stepped = true
      break
    }
    if (stepped) {
      continue
    }

    for (let i = 0; i < gapCount; i += 1) {
      if (blankGaps[i]! <= 0) {
        continue
      }
      blankGaps[i]! -= 1
      const footRows = buildFootRowsForStacks(
        stacks,
        catalog,
        blankGaps,
        footAdjust,
      )
      if (!columnFootRowsFit(stacks, catalog, footRows, maxRow)) {
        blankGaps[i]! += 1
        continue
      }
      squeezeSteps += 1
      stepped = true
      break
    }
    if (stepped) {
      continue
    }
    return null
  }
}

function resolveSideColumnLayout(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  tileMap: Map<string, CombatTile>,
  opts: BattleStartPlacementOpts,
  side: CombatSide,
): SideColumnResult {
  const stacks = stacksToPlaceOnSide(battle, side)
  if (stacks.length === 0) {
    return { mode: 'column', anchors: new Map(), fallbackCount: 0, squeezeSteps: 0 }
  }
  const column = tryColumnLayout(battle, catalog, tiles, tileMap, opts, side)
  if (column) {
    const placedCount = column.anchors.size
    const fallbackCount = stacks.length - placedCount
    return {
      mode:
        fallbackCount === 0 && column.squeezeSteps > 0
          ? 'column-squeezed'
          : 'column',
      anchors: column.anchors,
      fallbackCount,
      squeezeSteps: column.squeezeSteps,
    }
  }
  return {
    mode: 'per-slot',
    anchors: new Map(),
    fallbackCount: stacks.length,
    squeezeSteps: 0,
  }
}

function applySideAnchors(
  battle: CombatBattle,
  anchors: ReadonlyMap<string, Axial>,
): CombatBattle {
  let next = battle
  for (const [id, at] of anchors) {
    next = placeStackAt(next, id, at)
  }
  return next
}

function applyPerSlotFallback(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  tileMap: Map<string, CombatTile>,
  opts: BattleStartPlacementOpts,
  side: CombatSide,
  lines: string[],
  keepColumnIds: ReadonlySet<string> = new Set(),
): CombatBattle {
  let next = battle
  const placedIds = new Set<string>()
  for (const row of next.stacks) {
    if (row.qty <= 0) {
      continue
    }
    if (isFixedStartStack(row)) {
      placedIds.add(row.id)
    } else if (row.side !== side) {
      placedIds.add(row.id)
    }
  }
  for (const stack of stacksToPlaceOnSide(next, side)) {
    if (keepColumnIds.has(stack.id)) {
      continue
    }
    const live = next.stacks.find((row) => row.id === stack.id)
    if (!live || live.qty <= 0) {
      continue
    }
    const anchor = pickAnchor(live, catalog, next, tiles, tileMap, opts, placedIds)
    if (!anchor) {
      const label = stackLabel(live, catalog, opts.sessionHeroName)
      lines.push(`${label} could not be placed — no room on the battlefield`)
      continue
    }
    next = placeStackAt(next, live.id, anchor)
    placedIds.add(live.id)
  }
  return next
}

function anchorAtColRow(
  tiles: CombatTile[],
  col: number,
  row: number,
): Axial | null {
  const tile = tiles.find((t) => t.col === col && t.row === row)
  if (!tile || !isPlayableTile(tile)) {
    return null
  }
  return { q: tile.q, r: tile.r }
}

function pickAnchor(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  battle: CombatBattle,
  tiles: CombatTile[],
  tileMap: Map<string, CombatTile>,
  opts: BattleStartPlacementOpts,
  placedIds: ReadonlySet<string>,
): Axial | null {
  const inZone = (origin: Axial) =>
    startingAreaAnchor(origin, stack, catalog, tileMap, opts)

  const anchor = pickOverflowAnchor(
    stack,
    catalog,
    battle,
    tiles,
    inZone,
    placedIds,
  )
  if (anchor) {
    return anchor
  }
  if (opts.siege && stack.side === 'def') {
    const outside = pickOverflowAnchor(
      stack,
      catalog,
      battle,
      tiles,
      (origin) => outsideWallAnchor(origin, stack, catalog, tileMap),
      placedIds,
    )
    if (outside) {
      return outside
    }
  }
  return pickOverflowAnchor(
    stack,
    catalog,
    battle,
    tiles,
    (origin) => fieldFallbackAnchor(origin, stack, catalog, tileMap, opts),
    placedIds,
    'fullField',
  )
}

function placeStackAt(
  battle: CombatBattle,
  stackId: string,
  at: Axial,
): CombatBattle {
  return {
    ...battle,
    stacks: battle.stacks.map((row) =>
      row.id === stackId
        ? {
            ...row,
            q: at.q,
            r: at.r,
            startHex: { q: at.q, r: at.r },
          }
        : row,
    ),
  }
}

/**
 * Assign opening hexes for army stacks. Heroes and siege structures stay put.
 */
export function applyBattleStartPlacement(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  opts: BattleStartPlacementOpts,
): { battle: CombatBattle; lines: string[] } {
  const lines: string[] = []
  const tileMap = tileByHex(tiles)
  let next = battle

  const atk = resolveSideColumnLayout(next, catalog, tiles, tileMap, opts, 'atk')
  const def = resolveSideColumnLayout(next, catalog, tiles, tileMap, opts, 'def')

  const hadArmy =
    stacksToPlaceOnSide(next, 'atk').length > 0 ||
    stacksToPlaceOnSide(next, 'def').length > 0
  if (hadArmy) {
    lines.push(formatPlacementLogLine(atk, def))
  }

  if (atk.anchors.size > 0) {
    next = applySideAnchors(next, atk.anchors)
  }
  if (atk.fallbackCount > 0) {
    next = applyPerSlotFallback(
      next,
      catalog,
      tiles,
      tileMap,
      opts,
      'atk',
      lines,
      new Set(atk.anchors.keys()),
    )
  }

  if (def.anchors.size > 0) {
    next = applySideAnchors(next, def.anchors)
  }
  if (def.fallbackCount > 0) {
    next = applyPerSlotFallback(
      next,
      catalog,
      tiles,
      tileMap,
      opts,
      'def',
      lines,
      new Set(def.anchors.keys()),
    )
  }

  return { battle: next, lines }
}

/** Slot markers follow actual stack anchors after start placement (empty slots unchanged). */
export function battleStartDisplayMarkers(
  classicMarkers: readonly BattleSlotMarker[],
  stacks: CombatStack[],
  anchors: ReadonlyArray<{ q: number; r: number; x: number; y: number }>,
): BattleSlotMarker[] {
  return classicMarkers.map((marker) => {
    const stack = stacks.find(
      (row) =>
        row.side === marker.side &&
        row.slot === marker.slot &&
        row.qty > 0 &&
        !isFixedStartStack(row),
    )
    if (!stack) {
      return marker
    }
    const pos =
      anchors.find((row) => row.q === stack.q && row.r === stack.r) ?? null
    if (!pos) {
      return { ...marker, q: stack.q, r: stack.r }
    }
    return {
      ...marker,
      q: stack.q,
      r: stack.r,
      x: pos.x,
      y: pos.y,
    }
  })
}
