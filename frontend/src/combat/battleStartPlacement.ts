/**
 * Battle-start army placement: whole-army layouts (classic → column → per-slot).
 * Never drops stacks.
 */
import type { Axial } from '../hex/hero'
import { neighborHexes } from '../hex/pathfinding'
import { ARMY_STACK_SLOTS } from '../session/types'
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
  armySlotRow,
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

export type PlacementLayoutMode =
  | 'classic'
  | 'columns-gapped'
  | 'columns-tight'
  | 'per-slot'

function placementLayoutLogLabel(mode: PlacementLayoutMode): string {
  switch (mode) {
    case 'classic':
      return 'classic'
    case 'columns-gapped':
      return 'columns, gapped'
    case 'columns-tight':
      return 'columns, tight'
    case 'per-slot':
      return 'per-slot fallback'
  }
}

function formatPlacementLogLine(
  atk: PlacementLayoutMode,
  def: PlacementLayoutMode,
): string {
  if (atk === def) {
    return `Placement: ${placementLayoutLogLabel(atk)}`
  }
  return `Placement: attackers ${placementLayoutLogLabel(atk)}, defenders ${placementLayoutLogLabel(def)}`
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
    tombstoneOccupancyBodies(battle.tombstones),
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
  for (const body of tombstoneOccupancyBodies(battle.tombstones)) {
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

function stackFitsAtTrial(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  battle: CombatBattle,
  tiles: CombatTile[],
  at: Axial,
  blockedKeys: ReadonlySet<string>,
  tileMap: Map<string, CombatTile>,
  opts: BattleStartPlacementOpts,
): boolean {
  if (!startingAreaAnchor(at, stack, catalog, tileMap, opts)) {
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

function columnAnchorOnOwnHalf(
  tiles: CombatTile[],
  colStart: number,
  columnWidth: number,
  side: CombatSide,
): boolean {
  const span = Math.max(1, columnWidth)
  const minCol = side === 'atk' ? colStart : colStart - span + 1
  const maxCol = side === 'atk' ? colStart + span - 1 : colStart
  for (let col = minCol; col <= maxCol; col += 1) {
    const tile = tiles.find((row) => row.col === col)
    if (!tile || !tileOnOwnSide(tile, side, tiles)) {
      return false
    }
  }
  return true
}

function footRowsForColumn(
  tiles: CombatTile[],
  col: number,
  minBodyTopRow: number,
): number[] {
  const rows = new Set<number>()
  for (const tile of tiles) {
    if (tile.col !== col || !isPlayableTile(tile)) {
      continue
    }
    if ((tile.row ?? 0) < HERO_ROW) {
      continue
    }
    rows.add(tile.row as number)
  }
  return [...rows]
    .filter((row) => row >= minBodyTopRow)
    .sort((a, b) => a - b)
}

function findColumnFootAnchor(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  battle: CombatBattle,
  tiles: CombatTile[],
  tileMap: Map<string, CombatTile>,
  opts: BattleStartPlacementOpts,
  colStart: number,
  minBodyTopRow: number,
  columnWidth: number,
  anchors: ReadonlyMap<string, Axial>,
): Axial | null {
  const side = stack.side
  const rows = footRowsForColumn(tiles, colStart, minBodyTopRow)
  for (const row of rows) {
    const origin = anchorAtColRow(tiles, colStart, row)
    if (!origin) {
      continue
    }
    const bounds = bodyGridBounds(origin, stack, catalog, tileMap)
    if (!bounds) {
      continue
    }
    if (side === 'atk' && bounds.minCol !== colStart) {
      continue
    }
    if (side === 'def' && bounds.maxCol !== colStart) {
      continue
    }
    if (columnWidth > 0 && bounds.width > columnWidth) {
      continue
    }
    if (bounds.topRow < minBodyTopRow) {
      continue
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
      continue
    }
    return origin
  }
  return null
}

function tryLayoutClassic(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  tileMap: Map<string, CombatTile>,
  opts: BattleStartPlacementOpts,
  side: CombatSide,
): Map<string, Axial> | null {
  const attackerCol = opts.attackerCol ?? ATTACKER_COL
  const defenderCol = opts.defenderCol ?? DEFENDER_COL
  const anchors = new Map<string, Axial>()
  for (const stack of stacksToPlaceOnSide(battle, side)) {
    const origin = classicSlotAnchor(
      stack,
      tiles,
      catalog,
      attackerCol,
      defenderCol,
    )
    if (!origin) {
      return null
    }
    const blocked = trialBlockKeysFromAnchors(battle, catalog, anchors, stack.id)
    if (
      !stackFitsAtTrial(
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
      return null
    }
    anchors.set(stack.id, origin)
  }
  return anchors
}

function tryLayoutColumns(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  tileMap: Map<string, CombatTile>,
  opts: BattleStartPlacementOpts,
  side: CombatSide,
  gapped: boolean,
): Map<string, Axial> | null {
  const stacks = stacksToPlaceOnSide(battle, side)
  if (stacks.length === 0) {
    return new Map()
  }
  const anchors = new Map<string, Axial>()
  let colStart = backDeployCol(side, opts)
  let columnWidth = 0
  let minBodyTopRow = HERO_ROW

  for (const stack of stacks) {
    let placed = false
    let guard = 0
    while (!placed) {
      guard += 1
      if (guard > 64) {
        return null
      }
      const origin = findColumnFootAnchor(
        stack,
        catalog,
        battle,
        tiles,
        tileMap,
        opts,
        colStart,
        minBodyTopRow,
        columnWidth,
        anchors,
      )
      if (origin) {
        const bounds = bodyGridBounds(origin, stack, catalog, tileMap)
        if (!bounds) {
          return null
        }
        columnWidth = Math.max(columnWidth, bounds.width)
        minBodyTopRow = gapped
          ? bounds.bottomRow + 2
          : bounds.bottomRow
        anchors.set(stack.id, origin)
        placed = true
        continue
      }
      const step = Math.max(1, columnWidth)
      colStart = side === 'atk' ? colStart + step : colStart - step
      if (!columnAnchorOnOwnHalf(tiles, colStart, step, side)) {
        return null
      }
      columnWidth = 0
      minBodyTopRow = HERO_ROW
    }
  }
  return anchors
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

function resolveSideLayout(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  tileMap: Map<string, CombatTile>,
  opts: BattleStartPlacementOpts,
  side: CombatSide,
): { mode: PlacementLayoutMode; anchors: Map<string, Axial> } {
  const tries: Array<{
    mode: PlacementLayoutMode
    run: () => Map<string, Axial> | null
  }> = [
    { mode: 'classic', run: () => tryLayoutClassic(battle, catalog, tiles, tileMap, opts, side) },
    {
      mode: 'columns-gapped',
      run: () => tryLayoutColumns(battle, catalog, tiles, tileMap, opts, side, true),
    },
    {
      mode: 'columns-tight',
      run: () => tryLayoutColumns(battle, catalog, tiles, tileMap, opts, side, false),
    },
  ]
  for (const attempt of tries) {
    const anchors = attempt.run()
    if (anchors) {
      return { mode: attempt.mode, anchors }
    }
  }
  return { mode: 'per-slot', anchors: new Map() }
}

function applyPerSlotFallback(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  tileMap: Map<string, CombatTile>,
  opts: BattleStartPlacementOpts,
  side: CombatSide,
  lines: string[],
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

function classicSlotFootGridRow(
  slotIndex: number,
  catalog: ReferenceCatalog,
  stack: CombatStack,
): number {
  const markerRow = armySlotRow(slotIndex)
  const code = combatBodyFootprint(stack, catalog)
  if (footprintExtent(code).rows <= 1) {
    return markerRow
  }
  // Slot marker row is the foot (body) hex; head extends north, not onto the row above the prior stack's body.
  return markerRow
}

function classicSlotAnchor(
  stack: CombatStack,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
  attackerCol: number,
  defenderCol: number,
): Axial | null {
  if (stack.slot < 0 || stack.slot >= ARMY_STACK_SLOTS) {
    return null
  }
  const col = stack.side === 'atk' ? attackerCol : defenderCol
  const row = classicSlotFootGridRow(stack.slot, catalog, stack)
  const tile = tiles.find((t) => t.col === col && t.row === row)
  if (!tile || !isPlayableTile(tile)) {
    return null
  }
  return { q: tile.q, r: tile.r }
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

function nudgeClashesHeroIcon(
  col: number,
  row: number,
  side: CombatSide,
): boolean {
  if (row !== HERO_ROW) {
    return false
  }
  const heroCol = side === 'atk' ? ATTACKER_HERO_COL : DEFENDER_HERO_COL
  return col === heroCol
}

function sortTilesBackEdgeFirst(
  a: CombatTile,
  b: CombatTile,
  side: CombatSide,
): number {
  const ca = a.col ?? 0
  const cb = b.col ?? 0
  return side === 'atk' ? ca - cb : cb - ca
}

/** Foot origins one grid row up/down: both diagonal neighbours on that row, back edge first. */
function rowStepOrigins(
  classic: Axial,
  stack: CombatStack,
  tiles: CombatTile[],
  rowDelta: number,
): Axial[] {
  const start = tiles.find((t) => t.q === classic.q && t.r === classic.r)
  if (start?.row == null) {
    return []
  }
  const targetRow = start.row + rowDelta
  const candidates = neighborHexes(classic)
    .map((n) => tiles.find((t) => t.q === n.q && t.r === n.r))
    .filter(
      (t): t is CombatTile =>
        !!t && isPlayableTile(t) && t.row === targetRow,
    )
  candidates.sort((a, b) => sortTilesBackEdgeFirst(a, b, stack.side))
  return candidates.map((t) => ({ q: t.q, r: t.r }))
}

/** b–e from classic foot anchor: back, up, forward, down (skip invalid / hero clashes). */
function slotNudgeAnchors(
  classic: Axial,
  stack: CombatStack,
  tiles: CombatTile[],
): Axial[] {
  const start = tiles.find((t) => t.q === classic.q && t.r === classic.r)
  if (start?.col == null || start.row == null) {
    return []
  }
  const col = start.col
  const row = start.row
  const backCol = stack.side === 'atk' ? col - 1 : col + 1
  const forwardCol = stack.side === 'atk' ? col + 1 : col - 1
  const out: Axial[] = []
  const back = anchorAtColRow(tiles, backCol, row)
  if (back && !nudgeClashesHeroIcon(backCol, row, stack.side)) {
    out.push(back)
  }
  for (const up of rowStepOrigins(classic, stack, tiles, -1)) {
    const tile = tiles.find((t) => t.q === up.q && t.r === up.r)
    if (
      tile?.col != null &&
      !nudgeClashesHeroIcon(tile.col, tile.row ?? 0, stack.side)
    ) {
      out.push(up)
    }
  }
  const forward = anchorAtColRow(tiles, forwardCol, row)
  if (forward) {
    out.push(forward)
  }
  for (const down of rowStepOrigins(classic, stack, tiles, 1)) {
    out.push(down)
  }
  return out
}

function firstFittingAnchor(
  origins: Axial[],
  stack: CombatStack,
  catalog: ReferenceCatalog,
  battle: CombatBattle,
  tiles: CombatTile[],
  zoneFilter: (origin: Axial) => boolean,
  placedIds: ReadonlySet<string>,
): Axial | null {
  for (const origin of origins) {
    if (!zoneFilter(origin)) {
      continue
    }
    if (stackFitsAt(stack, catalog, battle, tiles, origin, placedIds)) {
      return origin
    }
  }
  return null
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
  const attackerCol = opts.attackerCol ?? ATTACKER_COL
  const defenderCol = opts.defenderCol ?? DEFENDER_COL
  const classic = classicSlotAnchor(
    stack,
    tiles,
    catalog,
    attackerCol,
    defenderCol,
  )
  const inZone = (origin: Axial) =>
    startingAreaAnchor(origin, stack, catalog, tileMap, opts)

  const earlyOrigins: Axial[] = []
  if (classic) {
    earlyOrigins.push(classic, ...slotNudgeAnchors(classic, stack, tiles))
  }
  const early = firstFittingAnchor(
    earlyOrigins,
    stack,
    catalog,
    battle,
    tiles,
    inZone,
    placedIds,
  )
  if (early) {
    return early
  }

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

  const atk = resolveSideLayout(next, catalog, tiles, tileMap, opts, 'atk')
  const def = resolveSideLayout(next, catalog, tiles, tileMap, opts, 'def')

  const hadArmy =
    stacksToPlaceOnSide(next, 'atk').length > 0 ||
    stacksToPlaceOnSide(next, 'def').length > 0
  if (hadArmy) {
    lines.push(formatPlacementLogLine(atk.mode, def.mode))
  }

  if (atk.mode === 'per-slot') {
    next = applyPerSlotFallback(next, catalog, tiles, tileMap, opts, 'atk', lines)
  } else {
    next = applySideAnchors(next, atk.anchors)
  }

  if (def.mode === 'per-slot') {
    next = applyPerSlotFallback(next, catalog, tiles, tileMap, opts, 'def', lines)
  } else {
    next = applySideAnchors(next, def.anchors)
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
