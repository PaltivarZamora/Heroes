import type { Axial } from '../hex/hero'
import { neighborHexes } from '../hex/pathfinding'
import type { GameSession } from '../session/types'
import { slotStatesForTown } from '../session/accessors'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import { retaliationCharges, unitById } from '../town/catalog'
import {
  COMBAT_COLUMNS,
  COMBAT_ROWS,
  SIEGE_CATAPULT_COL,
  SIEGE_CATAPULT_ROW,
  siegeWallColForRow,
} from './battlefield'
import { isHeroStack, type CombatBattle, type CombatStack, type CombatTile } from './battle'

const RAMPARTS_SLOT_INDEX = 2

type WallKind = 'end' | 'shooter' | 'wall' | 'drawbridge'

const WALL_KIND_BY_ROW: WallKind[] = [
  'end',
  'shooter',
  'wall',
  'shooter',
  'wall',
  'drawbridge',
  'wall',
  'shooter',
  'wall',
  'shooter',
  'end',
]

export const DRAWBRIDGE_ROW_INDEX = WALL_KIND_BY_ROW.indexOf('drawbridge')

function unitNamed(
  catalog: ReferenceCatalog,
  name: string,
): UnitRow | null {
  const key = name.trim().toLowerCase()
  return (
    catalog.unit.find((row) => row.name.trim().toLowerCase() === key) ?? null
  )
}

export function wallSegmentNames(): Set<string> {
  return new Set(['wall', 'drawbridge', 'shooter'])
}

export function isWallSegmentUnit(unit: UnitRow | null | undefined): boolean {
  return wallSegmentNames().has((unit?.name ?? '').trim().toLowerCase())
}

export function isDrawbridgeUnit(unit: UnitRow | null | undefined): boolean {
  return (unit?.name ?? '').trim().toLowerCase() === 'drawbridge'
}

export function livingDrawbridge(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
): CombatStack | null {
  return (
    stacks.find(
      (stack) =>
        stack.qty > 0 && isDrawbridgeUnit(unitById(catalog, stack.unitId)),
    ) ?? null
  )
}

function tileAt(
  tiles: CombatTile[],
  q: number,
  r: number,
): CombatTile | undefined {
  return tiles.find((tile) => tile.q === q && tile.r === r)
}

/** Town-side neighbor of the Drawbridge (higher offset col). */
export function isInteriorBehindDrawbridge(
  hex: Axial,
  gate: Axial,
  tiles: CombatTile[],
): boolean {
  const nextToGate = neighborHexes(gate).some(
    (n) => n.q === hex.q && n.r === hex.r,
  )
  if (!nextToGate) {
    return false
  }
  const hexTile = tileAt(tiles, hex.q, hex.r)
  const gateTile = tileAt(tiles, gate.q, gate.r)
  if (hexTile?.col == null || gateTile?.col == null) {
    return false
  }
  return hexTile.col > gateTile.col
}

function unitIsAirborne(
  unit: UnitRow | null | undefined,
  catalog: ReferenceCatalog,
): boolean {
  if (unit?.move_type_id == null) {
    return false
  }
  const name =
    catalog.move_type
      .find((row) => row.id === unit.move_type_id)
      ?.name.toLowerCase() ?? ''
  if (name.includes('fly') || name.includes('hover')) {
    return true
  }
  return unit.move_type_id === 2 || unit.move_type_id === 4
}

/**
 * Open if destroyed, if any unit stands on the Drawbridge hex, or if a
 * ground/submerge creature stands in the interior hex behind it.
 */
export function isDrawbridgeOpen(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  gate: { q: number; r: number } | null | undefined,
): boolean {
  const live = livingDrawbridge(stacks, catalog)
  if (!live) {
    return gate != null
  }
  const at = { q: live.q, r: live.r }
  for (const stack of stacks) {
    if (stack.qty <= 0 || stack.id === live.id) {
      continue
    }
    if (stack.q === at.q && stack.r === at.r) {
      return true
    }
    if (!isCreatureArmyUnit(unitById(catalog, stack.unitId))) {
      continue
    }
    if (unitIsAirborne(unitById(catalog, stack.unitId), catalog)) {
      continue
    }
    if (isInteriorBehindDrawbridge({ q: stack.q, r: stack.r }, at, tiles)) {
      return true
    }
  }
  return false
}

export function openBridgeMoatKeys(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): Set<string> {
  const keys = new Set<string>()
  const gate = battle.siegeGate
  if (!gate) {
    return keys
  }
  if (!isDrawbridgeOpen(battle.stacks, catalog, tiles, gate)) {
    return keys
  }
  keys.add(`${gate.moatQ},${gate.moatR}`)
  return keys
}

/** Closed Drawbridge hex: stop here is allowed; pathing through is not. */
export function closedDrawbridgeKeys(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  gate?: { q: number; r: number } | null,
): Set<string> {
  const keys = new Set<string>()
  const at = livingDrawbridge(stacks, catalog) ?? gate ?? null
  if (!at) {
    return keys
  }
  if (isDrawbridgeOpen(stacks, catalog, tiles, at)) {
    return keys
  }
  keys.add(`${at.q},${at.r}`)
  return keys
}

export function isSiegeEngineUnit(unit: UnitRow | null | undefined): boolean {
  const name = (unit?.name ?? '').trim().toLowerCase()
  return name === 'siege' || name === 'catapult'
}

/** Siege/Catapult cannot be chosen or hit as a target. */
export function isUntargetableUnit(unit: UnitRow | null | undefined): boolean {
  return isSiegeEngineUnit(unit)
}

/** Fixture-instance flag plus unit-type untargetable (Siege, wall ends). */
export function isUntargetableStack(
  stack: CombatStack | null | undefined,
  catalog: ReferenceCatalog,
): boolean {
  if (!stack) {
    return true
  }
  if (stack.indestructible || isHeroStack(stack)) {
    return true
  }
  return isUntargetableUnit(unitById(catalog, stack.unitId))
}

/** Creature army only — not Wall/Shooter/Drawbridge and not Siege. */
export function isCreatureArmyUnit(unit: UnitRow | null | undefined): boolean {
  return !isWallSegmentUnit(unit) && !isUntargetableUnit(unit)
}

/** Living Wall/Shooter/Drawbridge. Indestructible ends are not segments. */
export function isSiegeEngineWallTarget(
  stack: CombatStack | null | undefined,
  catalog: ReferenceCatalog,
): boolean {
  if (!stack || stack.qty <= 0 || stack.indestructible) {
    return false
  }
  return isWallSegmentUnit(unitById(catalog, stack.unitId))
}

/** Live stacks that block sight. Drawbridge stays on closedDrawbridgeKeys. */
export function liveWallLosKeys(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  tiles: CombatTile[] = [],
  gate?: { q: number; r: number } | null,
): Set<string> {
  const keys = closedDrawbridgeKeys(stacks, catalog, tiles, gate)
  for (const stack of stacks) {
    if (stack.qty <= 0) {
      continue
    }
    const unit = unitById(catalog, stack.unitId)
    if (isDrawbridgeUnit(unit)) {
      continue
    }
    if (unit?.blocks_los === true || isWallSegmentUnit(unit)) {
      keys.add(`${stack.q},${stack.r}`)
    }
  }
  return keys
}

export function siegeEngineArt(townName: string): string {
  return `${townName}_Siege.png`
}

export function rampartsTier(session: GameSession, townId: string): number {
  const level = slotStatesForTown(session, townId)[RAMPARTS_SLOT_INDEX]?.level ?? 0
  if (level >= 1 && level <= 3) {
    return level
  }
  return 1
}

export function townTypeName(
  catalog: ReferenceCatalog,
  townTypeId: number,
): string {
  return catalog.town.find((row) => row.id === townTypeId)?.name ?? 'Necropolis'
}

function roleName(kind: WallKind): 'Wall' | 'Shooter' | 'Drawbridge' {
  if (kind === 'shooter') {
    return 'Shooter'
  }
  if (kind === 'drawbridge') {
    return 'Drawbridge'
  }
  return 'Wall'
}

export function siegeDrawbridgeDownArt(townName: string): string {
  return `${townName}_Drawbridge_Down.png`
}

export function siegeSegmentArt(
  townName: string,
  unitName: string,
  qty: number,
): string {
  const n = Math.min(3, Math.max(1, Math.floor(qty)))
  const role = unitName.trim().replaceAll(' ', '_')
  return `${townName}_${role}_${n}.png`
}

export function hexesInOffsetColumn(
  byOffset: Map<string, { q: number; r: number }>,
  col: number,
): Axial[] {
  const hexes: Axial[] = []
  for (let row = 0; row < COMBAT_ROWS; row += 1) {
    const hex = byOffset.get(`${col},${row}`)
    if (hex) {
      hexes.push({ q: hex.q, r: hex.r })
    }
  }
  return hexes
}

export function siegeWallHexes(
  byOffset: Map<string, { q: number; r: number }>,
): Axial[] {
  const hexes: Axial[] = []
  for (let row = 0; row < COMBAT_ROWS; row += 1) {
    const col = siegeWallColForRow(row)
    if (col < 0 || col >= COMBAT_COLUMNS) {
      continue
    }
    const hex = byOffset.get(`${col},${row}`)
    if (hex) {
      hexes.push({ q: hex.q, r: hex.r })
    }
  }
  return hexes
}

export function siegeCatapultHex(
  byOffset: Map<string, { q: number; r: number }>,
): Axial | null {
  const hex = byOffset.get(`${SIEGE_CATAPULT_COL},${SIEGE_CATAPULT_ROW}`)
  return hex ? { q: hex.q, r: hex.r } : null
}

function makeStack(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  side: CombatStack['side'],
  slot: number,
  hex: Axial,
  qty: number,
  id: string,
  indestructible: boolean,
): CombatStack {
  return {
    id,
    side,
    slot,
    unitId: unit.id,
    qty,
    topHealth: Math.max(1, unitById(catalog, unit.id)?.health ?? 1),
    startingQty: qty,
    q: hex.q,
    r: hex.r,
    hasActedThisRound: false,
    retaliationsLeft: retaliationCharges(unitById(catalog, unit.id)),
    indestructible,
  }
}

/** Wall column stacks + Catapult/Siege in the attacker corner. */
export function siegeStructureStacks(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
  wallHexes: Axial[],
  catapultHex: Axial | null,
): CombatStack[] {
  const qty = rampartsTier(session, townId)
  const stacks: CombatStack[] = []
  for (let i = 0; i < wallHexes.length; i += 1) {
    const kind = WALL_KIND_BY_ROW[i] ?? 'wall'
    const unit = unitNamed(catalog, roleName(kind))
    const hex = wallHexes[i]
    if (!unit || !hex) {
      continue
    }
    stacks.push(
      makeStack(
        catalog,
        unit,
        'def',
        100 + i,
        hex,
        qty,
        `combat-wall-${i}`,
        kind === 'end',
      ),
    )
  }
  const engine =
    unitNamed(catalog, 'Siege') ?? unitNamed(catalog, 'Catapult')
  if (engine && catapultHex) {
    stacks.push(
      makeStack(
        catalog,
        engine,
        'atk',
        90,
        catapultHex,
        1,
        'combat-siege-engine',
        false,
      ),
    )
  }
  return stacks
}
