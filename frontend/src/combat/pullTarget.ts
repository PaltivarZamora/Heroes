import type { Axial } from '../hex/hero'
import { hexDistance } from '../hex/pathfinding'
import {
  unitById,
  unitIsStationary,
  type ReferenceCatalog,
} from '../town/catalog'
import {
  isHeroStack,
  stackMaxRange,
  type CombatBattle,
  type CombatStack,
  type CombatTile,
} from './battle'
import { hexKey } from './movement'
import {
  actionOriginFootprintHex,
} from './actionOrigin'
import { minFootprintHexDistance, stackFootprint } from './occupancy'
import { landableHexes, relocateToHex } from './relocate'
import { hexLine, hasLineOfSight } from './shapes'
import {
  isSiegeEngineWallTarget,
  isUntargetableStack,
} from './siege'
import { isVanished } from './condition'

function stackName(catalog: ReferenceCatalog, unitId: number): string {
  return unitById(catalog, unitId)?.name ?? 'Unknown'
}

export function pullRangeOk(
  from: Axial,
  target: CombatStack,
  catalog: ReferenceCatalog,
  attacker: CombatStack,
): boolean {
  const unit = unitById(catalog, attacker.unitId)
  const minR = Math.max(0, unit?.min_range ?? 0)
  const maxR = stackMaxRange(attacker, catalog)
  const dist = minFootprintHexDistance(from, attacker, target, catalog)
  const needMin = minR > 0 ? minR : 1
  return dist >= needMin && dist <= maxR
}

export function canBePullTarget(
  target: CombatStack,
  catalog: ReferenceCatalog,
): boolean {
  if (target.qty <= 0 || isHeroStack(target)) {
    return false
  }
  if (isUntargetableStack(target, catalog) || isVanished(target, catalog)) {
    return false
  }
  if (isSiegeEngineWallTarget(target, catalog)) {
    return false
  }
  const unit = unitById(catalog, target.unitId)
  if (!unit || unitIsStationary(unit)) {
    return false
  }
  return true
}

function hexAdjacentToAttackerFootprint(
  hex: Axial,
  attacker: CombatStack,
  catalog: ReferenceCatalog,
): boolean {
  return stackFootprint(attacker, catalog).some(
    (a) => hexDistance(hex, a) === 1,
  )
}

function preferredPullAdjacent(
  attacker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
): Axial | null {
  const origin = actionOriginFootprintHex(
    { q: attacker.q, r: attacker.r },
    attacker,
    catalog,
    { q: target.q, r: target.r },
  )
  const line = hexLine({ q: target.q, r: target.r }, origin)
  for (let i = line.length - 2; i >= 0; i -= 1) {
    const hex = line[i]!
    if (hexDistance(hex, origin) === 1) {
      return hex
    }
  }
  return null
}

/** Nearest empty hex adjacent to attacker the target can occupy. */
export function computePullLandingHex(
  battle: CombatBattle,
  attacker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): Axial | null {
  if (!canBePullTarget(target, catalog)) {
    return null
  }
  const fromTarget = { q: target.q, r: target.r }
  const prefer = preferredPullAdjacent(attacker, target, catalog)
  const unit = unitById(catalog, target.unitId)
  if (!unit) {
    return null
  }
  const open = landableHexes(battle, catalog, tiles, target, unit)
  const candidates = open.filter(
    (hex) =>
      hexAdjacentToAttackerFootprint(hex, attacker, catalog) &&
      (hex.q !== target.q || hex.r !== target.r),
  )
  if (candidates.length === 0) {
    return null
  }
  if (prefer && candidates.some((h) => h.q === prefer.q && h.r === prefer.r)) {
    return prefer
  }
  let best = candidates[0]!
  let bestDist = hexDistance(best, fromTarget)
  for (const hex of candidates) {
    const dist = hexDistance(hex, fromTarget)
    if (
      dist < bestDist ||
      (dist === bestDist &&
        (hex.q < best.q || (hex.q === best.q && hex.r < best.r)))
    ) {
      best = hex
      bestDist = dist
    }
  }
  return best
}

export function pullLandingPreviewKeys(
  battle: CombatBattle,
  attacker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): string[] {
  const landing = computePullLandingHex(
    battle,
    attacker,
    target,
    catalog,
    tiles,
  )
  return landing ? [hexKey(landing.q, landing.r)] : []
}

export function isValidPullAttackTarget(
  attacker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  stacks: CombatStack[],
): boolean {
  if (attacker.id === target.id || attacker.side === target.side) {
    return false
  }
  if (!canBePullTarget(target, catalog)) {
    return false
  }
  if (!pullRangeOk(attacker, target, catalog, attacker)) {
    return false
  }
  return hasLineOfSight(
    attacker,
    { q: target.q, r: target.r },
    tiles,
    stacks,
    catalog,
  )
}

export function tryPullTargetBeforeAttack(
  battle: CombatBattle,
  attacker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): {
  battle: CombatBattle
  pulled: boolean
  line: string | null
  target: CombatStack | null
} {
  if (!canBePullTarget(target, catalog)) {
    return { battle, pulled: false, line: null, target }
  }
  const landing = computePullLandingHex(
    battle,
    attacker,
    target,
    catalog,
    tiles,
  )
  if (!landing) {
    return { battle, pulled: false, line: null, target }
  }
  const moved = relocateToHex(battle, catalog, tiles, target.id, landing)
  if (!moved.moved) {
    return { battle, pulled: false, line: null, target }
  }
  const nextTarget =
    moved.battle.stacks.find((row) => row.id === target.id) ?? null
  const atkName = stackName(catalog, attacker.unitId)
  const defName = stackName(catalog, target.unitId)
  return {
    battle: moved.battle,
    pulled: true,
    line: `${atkName} pulls ${defName}`,
    target: nextTarget,
  }
}
