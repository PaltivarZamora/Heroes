/**
 * Single battle-start stand rule for column/fallback placement and deploy safety.
 * Hero stacks and hero mount art never block army stacks (S13-54 / S13-70).
 */
import type { Axial } from '../hex/hero'
import type { ReferenceCatalog } from '../town/catalog'
import { unitById } from '../town/catalog'
import { isHeroStack, type CombatBattle, type CombatStack, type CombatTile } from './battle'
import {
  combatCanLandOn,
  combatEnterCost,
  groundEffectMovementBlockKeys,
  moveKindForUnit,
  type MoveKind,
} from './movement'
import {
  footprintBlockingHexes,
  footprintHexes,
} from './footprint'
import {
  combatBodyFootprint,
  footprintAlong,
  footprintFits,
  occupancyKey,
  stackBlockingFootprint,
} from './occupancy'
import { tombstoneOccupancyBodies } from './tombstone'
import { heroMountFootprintHexes } from './combatHeroMountArt'
import { appendBattleAnimCombatLog } from './battleAnimLogBridge'

export type BattleStartFitContext = {
  /** Keys already occupied (column partial anchors, trial blocked set, etc.). */
  occupiedKeys?: ReadonlySet<string>
  /** Only count these army stacks toward occupancy (fallback placement). */
  armyIdsForOccupancy?: ReadonlySet<string>
  /** Use these anchors instead of stack.q/r when adding army/siege bodies. */
  anchorByStackId?: ReadonlyMap<string, Axial>
  /** Deploy check: this stack's own body is not an overlap. */
  exceptStackId?: string
}

function isFixedSiegeStack(stack: CombatStack): boolean {
  if (isHeroStack(stack)) {
    return false
  }
  if (stack.id.startsWith('combat-wall-') || stack.id === 'combat-siege-engine') {
    return true
  }
  return false
}

export function battleStartMoveKind(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): MoveKind {
  if (isHeroStack(stack)) {
    return 'ground'
  }
  return moveKindForUnit(unitById(catalog, stack.unitId), catalog)
}

/** Mount + hero anchor hexes — never block army placement. */
export function battleStartHeroIgnoreKeys(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
): Set<string> {
  const keys = new Set<string>()
  for (const stack of battle.stacks) {
    if (!isHeroStack(stack) || stack.qty <= 0) {
      continue
    }
    for (const hex of heroMountFootprintHexes(stack, catalog)) {
      keys.add(occupancyKey(hex.q, hex.r))
    }
    for (const hex of footprintHexes(
      { q: stack.q, r: stack.r },
      '1x1',
      footprintAlong(stack.side),
    )) {
      keys.add(occupancyKey(hex.q, hex.r))
    }
  }
  return keys
}

function stackAnchor(
  stack: CombatStack,
  anchorByStackId?: ReadonlyMap<string, Axial>,
): Axial {
  const over = anchorByStackId?.get(stack.id)
  return over ?? { q: stack.q, r: stack.r }
}

function blockingKeysAt(
  origin: Axial,
  stack: CombatStack,
  catalog: ReferenceCatalog,
): string[] {
  return footprintBlockingHexes(
    origin,
    combatBodyFootprint(stack, catalog),
    footprintAlong(stack.side),
  ).map((hex) => occupancyKey(hex.q, hex.r))
}

/** Bodies that block army stacks at battle start (no heroes). */
export function battleStartOccupiedKeys(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  ctx: BattleStartFitContext = {},
): Set<string> {
  const keys = new Set<string>(ctx.occupiedKeys ?? [])
  for (const body of tombstoneOccupancyBodies(battle.tombstones, catalog)) {
    for (const hex of body.hexes) {
      keys.add(occupancyKey(hex.q, hex.r))
    }
  }
  for (const stack of battle.stacks) {
    if (stack.qty <= 0 || isHeroStack(stack) || stack.id === ctx.exceptStackId) {
      continue
    }
    const fixed = isFixedSiegeStack(stack)
    const armyCounted =
      ctx.armyIdsForOccupancy == null ||
      ctx.armyIdsForOccupancy.has(stack.id)
    if (!fixed && !armyCounted) {
      continue
    }
    const origin = stackAnchor(stack, ctx.anchorByStackId)
    for (const key of blockingKeysAt(origin, stack, catalog)) {
      keys.add(key)
    }
  }
  return keys
}

function tileAt(
  tiles: CombatTile[],
  q: number,
  r: number,
): CombatTile | undefined {
  return tiles.find((row) => row.q === q && row.r === r)
}

function enterCostForKind(
  tiles: CombatTile[],
  battle: CombatBattle,
  kind: MoveKind,
  q: number,
  r: number,
): number | null {
  const blockKeys = groundEffectMovementBlockKeys(battle)
  const tile = tileAt(tiles, q, r)
  if (!combatCanLandOn(tile, kind, undefined, blockKeys)) {
    return null
  }
  return combatEnterCost(tile, kind, undefined, blockKeys)
}

export function battleStartStackStandsAt(
  stack: CombatStack,
  at: Axial,
  battle: CombatBattle,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
  ctx: BattleStartFitContext = {},
): boolean {
  const kind = battleStartMoveKind(stack, catalog)
  const occupied = battleStartOccupiedKeys(battle, catalog, {
    ...ctx,
    armyIdsForOccupancy: ctx.armyIdsForOccupancy,
  })
  const ignore =
    isHeroStack(stack) ? new Set<string>() : battleStartHeroIgnoreKeys(battle, catalog)
  const enterCost = (q: number, r: number) =>
    enterCostForKind(tiles, battle, kind, q, r)
  return footprintFits(
    at,
    combatBodyFootprint(stack, catalog),
    footprintAlong(stack.side),
    occupied,
    enterCost,
    ignore,
  )
}

/** Heroes: terrain/landing only — army stacks never block the fixed hero hex. */
export function battleStartHeroStandsAt(
  hero: CombatStack,
  at: Axial,
  battle: CombatBattle,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
): boolean {
  if (!isHeroStack(hero)) {
    return battleStartStackStandsAt(hero, at, battle, tiles, catalog)
  }
  const kind = battleStartMoveKind(hero, catalog)
  const enterCost = (q: number, r: number) =>
    enterCostForKind(tiles, battle, kind, q, r)
  return footprintFits(
    at,
    combatBodyFootprint(hero, catalog),
    footprintAlong(hero.side),
    new Set<string>(),
    enterCost,
    battleStartHeroIgnoreKeys(battle, catalog),
  )
}

function describeHexBlock(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  hex: Axial,
  tile: CombatTile | undefined,
  occupied: ReadonlySet<string>,
  ignore: ReadonlySet<string>,
  anchorByStackId?: ReadonlyMap<string, Axial>,
  exceptStackId?: string,
): string {
  const key = occupancyKey(hex.q, hex.r)
  if (tile?.propId != null) {
    return `prop #${tile.propId} (q=${hex.q} r=${hex.r})`
  }
  for (const stack of battle.stacks) {
    if (isHeroStack(stack) && stack.qty > 0) {
      if (
        heroMountFootprintHexes(stack, catalog).some(
          (row) => row.q === hex.q && row.r === hex.r,
        )
      ) {
        return `hero mount (${stack.side}, q=${hex.q} r=${hex.r})`
      }
    }
  }
  for (const stack of battle.stacks) {
    if (isFixedSiegeStack(stack) && stack.qty > 0) {
      if (
        stackBlockingFootprint(stack, catalog).some(
          (row) => row.q === hex.q && row.r === hex.r,
        )
      ) {
        return `siege ${stack.id} (q=${hex.q} r=${hex.r})`
      }
    }
  }
  if (anchorByStackId) {
    for (const [id, origin] of anchorByStackId) {
      const other = battle.stacks.find((row) => row.id === id)
      if (!other || other.qty <= 0 || isHeroStack(other) || other.id === exceptStackId) {
        continue
      }
      if (blockingKeysAt(origin, other, catalog).includes(key)) {
        return `stack body ${id} (q=${hex.q} r=${hex.r})`
      }
    }
  }
  for (const stack of battle.stacks) {
    if (
      isHeroStack(stack) ||
      stack.qty <= 0 ||
      isFixedSiegeStack(stack) ||
      stack.id === exceptStackId
    ) {
      continue
    }
    if (blockingKeysAt(stackAnchor(stack), stack, catalog).includes(key)) {
      return `army stack ${stack.id} (q=${hex.q} r=${hex.r})`
    }
  }
  if (!ignore.has(key) && occupied.has(key)) {
    return `occupied (q=${hex.q} r=${hex.r})`
  }
  if (tile == null) {
    return `missing tile (q=${hex.q} r=${hex.r})`
  }
  if (tile.blocked) {
    return `blocked terrain (${tile.terrain ?? '?'}, q=${hex.q} r=${hex.r})`
  }
  return `cannot land (${tile.terrain ?? '?'}, q=${hex.q} r=${hex.r})`
}

export function battleStartStackStandFailReason(
  stack: CombatStack,
  at: Axial,
  battle: CombatBattle,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
  ctx: BattleStartFitContext = {},
): string | null {
  if (isHeroStack(stack)) {
    if (battleStartHeroStandsAt(stack, at, battle, tiles, catalog)) {
      return null
    }
  } else if (battleStartStackStandsAt(stack, at, battle, tiles, catalog, ctx)) {
    return null
  }
  const kind = battleStartMoveKind(stack, catalog)
  const occupied = battleStartOccupiedKeys(battle, catalog, ctx)
  const ignore = isHeroStack(stack)
    ? battleStartHeroIgnoreKeys(battle, catalog)
    : battleStartHeroIgnoreKeys(battle, catalog)
  const along = footprintAlong(stack.side)
  const code = combatBodyFootprint(stack, catalog)
  for (const hex of footprintBlockingHexes(at, code, along)) {
    const tile = tileAt(tiles, hex.q, hex.r)
    const blockKeys = groundEffectMovementBlockKeys(battle)
    if (!combatCanLandOn(tile, kind, undefined, blockKeys)) {
      return `${describeHexBlock(
        battle,
        catalog,
        hex,
        tile,
        occupied,
        ignore,
        ctx.anchorByStackId,
        ctx.exceptStackId,
      )} [${kind}]`
    }
    const key = occupancyKey(hex.q, hex.r)
    if (!ignore.has(key) && occupied.has(key)) {
      return describeHexBlock(
        battle,
        catalog,
        hex,
        tile,
        occupied,
        ignore,
        ctx.anchorByStackId,
        ctx.exceptStackId,
      )
    }
  }
  return 'unknown'
}

export function logBattleStartFitFailure(
  phase: 'Placement' | 'Deploy',
  stack: CombatStack,
  catalog: ReferenceCatalog,
  at: Axial,
  reason: string,
  sessionHeroName?: (heroId: string) => string | null,
): void {
  const label = isHeroStack(stack) && stack.heroId
    ? sessionHeroName?.(stack.heroId)?.trim() || 'Hero'
    : (unitById(catalog, stack.unitId)?.name ?? 'Unit')
  appendBattleAnimCombatLog(
    `[${phase}] "${label}" at q=${at.q} r=${at.r} — ${reason}`,
  )
}