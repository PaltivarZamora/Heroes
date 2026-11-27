/**
 * Battle-start safeguard: never leave a stack/hero on a hex it cannot occupy
 * under combat movement landing rules (e.g. Walker/Flyer on naval water).
 */
import type { Axial } from '../hex/hero'
import { hexDistance } from '../hex/pathfinding'
import type { ReferenceCatalog } from '../town/catalog'
import { unitById } from '../town/catalog'
import {
  isHeroStack,
  moveStack,
  type CombatBattle,
  type CombatSide,
  type CombatStack,
  type CombatTile,
} from './battle'
import { COMBAT_COLUMNS } from './battlefield'
import {
  battleStartHeroStandsAt,
  battleStartStackStandFailReason,
  battleStartStackStandsAt,
  logBattleStartFitFailure,
} from './battleStartFit'

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

/** Half-board ownership for deploy repair (left = atk, right = def). */
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
        (row) =>
          row.navalKind === 'water' || row.navalKind === 'gangplank',
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

function stackStandsHere(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  battle: CombatBattle,
  at: Axial,
): boolean {
  if (isHeroStack(stack)) {
    return battleStartHeroStandsAt(stack, at, battle, tiles, catalog)
  }
  return battleStartStackStandsAt(stack, at, battle, tiles, catalog, {
    exceptStackId: stack.id,
  })
}

function nearestValidOnOwnSide(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  battle: CombatBattle,
): Axial | null {
  const origin = { q: stack.q, r: stack.r }
  const ranked = tiles
    .filter((tile) => tileOnOwnSide(tile, stack.side, tiles))
    .sort((a, b) => {
      const da = hexDistance(origin, a)
      const db = hexDistance(origin, b)
      if (da !== db) {
        return da - db
      }
      if (a.q !== b.q) {
        return a.q - b.q
      }
      return a.r - b.r
    })
  for (const tile of ranked) {
    const at = { q: tile.q, r: tile.r }
    if (stackStandsHere(stack, catalog, tiles, battle, at)) {
      return at
    }
  }
  const any = [...tiles].sort((a, b) => {
    const da = hexDistance(origin, a)
    const db = hexDistance(origin, b)
    return da - db
  })
  for (const tile of any) {
    const at = { q: tile.q, r: tile.r }
    if (stackStandsHere(stack, catalog, tiles, battle, at)) {
      return at
    }
  }
  return null
}

/**
 * Move stacks/heroes that start on illegal hexes to the nearest valid hex
 * on their own side. Uses the same stand rule as battle-start placement.
 */
export function ensureValidDeployments(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  sessionHeroName?: (heroId: string) => string | null,
): { battle: CombatBattle; lines: string[] } {
  const lines: string[] = []
  let next = battle
  const ordered = [...next.stacks].sort((a, b) => {
    const ha = isHeroStack(a) ? 1 : 0
    const hb = isHeroStack(b) ? 1 : 0
    if (ha !== hb) {
      return ha - hb
    }
    if (a.side !== b.side) {
      return a.side === 'atk' ? -1 : 1
    }
    return a.slot - b.slot
  })
  for (const stack of ordered) {
    if (stack.qty <= 0) {
      continue
    }
    const live = next.stacks.find((row) => row.id === stack.id)
    if (!live || live.qty <= 0) {
      continue
    }
    const here = { q: live.q, r: live.r }
    if (stackStandsHere(live, catalog, tiles, next, here)) {
      continue
    }
    const reason =
      battleStartStackStandFailReason(
        live,
        here,
        next,
        tiles,
        catalog,
        isHeroStack(live) ? {} : { exceptStackId: live.id },
      ) ?? 'unknown'
    const dest = nearestValidOnOwnSide(live, catalog, tiles, next)
    if (!dest || (dest.q === live.q && dest.r === live.r)) {
      continue
    }
    logBattleStartFitFailure(
      'Deploy',
      live,
      catalog,
      here,
      reason,
      sessionHeroName,
    )
    if (isHeroStack(live)) {
      next = {
        ...next,
        stacks: next.stacks.map((row) =>
          row.id === live.id
            ? {
                ...row,
                q: dest.q,
                r: dest.r,
                startHex: { q: dest.q, r: dest.r },
              }
            : row,
        ),
      }
    } else {
      next = moveStack(next, live.id, dest.q, dest.r)
      next = {
        ...next,
        stacks: next.stacks.map((row) =>
          row.id === live.id
            ? { ...row, startHex: { q: dest.q, r: dest.r } }
            : row,
        ),
      }
    }
    const label = stackLabel(live, catalog, sessionHeroName)
    lines.push(`${label} repositioned to a valid hex`)
  }
  return { battle: next, lines }
}