import type { Axial } from '../hex/hero'
import { hexDistance } from '../hex/pathfinding'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import { unitAttackShape, unitById } from '../town/catalog'
import type { CombatBattle, CombatTile, CombatStack } from './battle'
import {
  scaleBySignedPct,
  stackMaxDmg,
  stackMaxRange,
  stackMinDmg,
} from './battle'
import {
  damageKindOf,
  outputMaxPct,
  outputMinPct,
  outputTotalPct,
  rollAttackDamage,
  strikeConnects,
  type DmgKind,
  type StrikeMods,
} from './attack'
import { hasLineOfSight } from './shapes'
import { occupancyKey, stackFootprint } from './occupancy'
import { combatMovementReachable } from './movement'
import { UNIT_TRAP_BLAST_EFFECT } from './groundEffect'
import { isHeroStack } from './battle'

export { UNIT_TRAP_BLAST_EFFECT }

export type UnitTrapConfig = {
  templateId: number
  blastRadius: number
}

export function unitPlacesTrap(unit: UnitRow | null | undefined): boolean {
  return unitAttackShape(unit).placesTrap === true
}

export function unitTrapConfig(
  unit: UnitRow | null | undefined,
): UnitTrapConfig | null {
  const spec = unitAttackShape(unit)
  if (!spec.placesTrap) {
    return null
  }
  const templateId = spec.trapGroundEffectId
  if (templateId == null || templateId <= 0) {
    return null
  }
  return {
    templateId,
    blastRadius: Math.max(0, Math.floor(spec.trapRadius ?? 0)),
  }
}

export function hexHasUnitTrap(battle: CombatBattle, q: number, r: number): boolean {
  const key = occupancyKey(q, r)
  return (battle.groundEffects ?? []).some(
    (zone) =>
      zone.mechanicType === 'trigger_zone' &&
      zone.effect === UNIT_TRAP_BLAST_EFFECT &&
      zone.hexKeys.includes(key),
  )
}

export function isHexOccupiedByStack(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  q: number,
  r: number,
): boolean {
  return battle.stacks.some(
    (row) =>
      row.qty > 0 &&
      stackFootprint(row, catalog).some((hex) => hex.q === q && hex.r === r),
  )
}

export function isTrapHexInRange(
  from: Axial,
  hex: Axial,
  attacker: CombatStack,
  catalog: ReferenceCatalog,
): boolean {
  const unit = unitById(catalog, attacker.unitId)
  const minR = Math.max(1, unit?.min_range ?? 1)
  const maxR = stackMaxRange(attacker, catalog)
  const dist = hexDistance(from, hex)
  return dist >= minR && dist <= maxR
}

export function isValidTrapPlacementHex(
  from: Axial,
  hex: Axial,
  attacker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): boolean {
  if (!unitTrapConfig(unitById(catalog, attacker.unitId))) {
    return false
  }
  if (!isTrapHexInRange(from, hex, attacker, catalog)) {
    return false
  }
  if (!hasLineOfSight(from, hex, tiles, battle.stacks, catalog)) {
    return false
  }
  if (isHexOccupiedByStack(battle, catalog, hex.q, hex.r)) {
    return false
  }
  if (hexHasUnitTrap(battle, hex.q, hex.r)) {
    return false
  }
  return true
}

export function trapBlastImpactKeys(
  center: Axial,
  blastRadius: number,
  tiles: CombatTile[],
): string[] {
  if (blastRadius <= 0) {
    return [occupancyKey(center.q, center.r)]
  }
  const keys: string[] = []
  for (const tile of tiles) {
    if (hexDistance(center, { q: tile.q, r: tile.r }) <= blastRadius) {
      keys.push(occupancyKey(tile.q, tile.r))
    }
  }
  return keys
}

/** Snapshot pre-mitigation attack roll for trap detonation (qty × per-creature rolls). */
export function rollTrapSnapshotDamage(
  striker: CombatStack,
  catalog: ReferenceCatalog,
  random: () => number = Math.random,
  mods?: StrikeMods,
): { damage: number; kind: DmgKind } {
  const strikerUnit = unitById(catalog, striker.unitId)
  const kind = mods?.damageKind ?? damageKindOf(strikerUnit)
  const minBase =
    mods?.minDmg != null ? mods.minDmg : stackMinDmg(striker, catalog)
  const maxBase =
    mods?.maxDmg != null ? mods.maxDmg : stackMaxDmg(striker, catalog)
  const minDmg = scaleBySignedPct(minBase, outputMinPct(striker, kind))
  const maxDmg = scaleBySignedPct(maxBase, outputMaxPct(striker, kind))
  const totalPct =
    outputTotalPct(striker, kind) + (mods?.outgoingPctAdd ?? 0)
  const disarm = striker.disarm
  const disarmForcesMin =
    disarm != null &&
    disarm.roundsLeft > 0 &&
    (!disarm.physicalOnly || kind === 'physical')
  const guaranteed = disarmForcesMin ? minDmg : mods?.guaranteedDamage
  let totalRaw = 0
  for (let i = 0; i < striker.qty; i += 1) {
    if (!strikeConnects(mods)) {
      continue
    }
    let raw: number
    if (guaranteed != null) {
      raw = guaranteed
    } else {
      raw = rollAttackDamage(1, minDmg, maxDmg, random)
    }
    if (totalPct !== 0) {
      raw = Math.floor((raw * (100 + totalPct)) / 100)
    }
    totalRaw += Math.max(0, raw)
  }
  return { damage: Math.max(0, totalRaw), kind }
}

export function canPlaceTrapFrom(
  from: Axial,
  attacker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): boolean {
  if (!unitTrapConfig(unitById(catalog, attacker.unitId))) {
    return false
  }
  for (const tile of tiles) {
    if (
      isValidTrapPlacementHex(
        from,
        { q: tile.q, r: tile.r },
        attacker,
        battle,
        catalog,
        tiles,
      )
    ) {
      return true
    }
  }
  return false
}

export function canPlaceTrapAnyone(
  attacker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): boolean {
  const from = { q: attacker.q, r: attacker.r }
  if (canPlaceTrapFrom(from, attacker, battle, catalog, tiles)) {
    return true
  }
  const reachable = combatMovementReachable(attacker, battle, tiles, catalog)
  for (const steps of reachable.values()) {
    const last = steps[steps.length - 1]
    const stand = last ?? from
    if (canPlaceTrapFrom(stand, attacker, battle, catalog, tiles)) {
      return true
    }
  }
  return false
}

/** AI: empty trap hex between nearest enemy and friendly stacks. */
export function pickUnitTrapAimHex(
  attacker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): { aim: Axial; steps: Axial[] } | null {
  const cfg = unitTrapConfig(unitById(catalog, attacker.unitId))
  if (!cfg) {
    return null
  }
  const from = { q: attacker.q, r: attacker.r }
  const reachable = combatMovementReachable(attacker, battle, tiles, catalog)
  const stands: Array<{ stand: Axial; steps: Axial[] }> = [
    { stand: from, steps: [] },
  ]
  for (const [key, steps] of reachable) {
    if (steps.length === 0) {
      continue
    }
    const [qs, rs] = key.split(',')
    stands.push({ stand: { q: Number(qs), r: Number(rs) }, steps })
  }
  const enemies = battle.stacks.filter(
    (row) =>
      row.side !== attacker.side &&
      row.qty > 0 &&
      !isHeroStack(row),
  )
  if (enemies.length === 0) {
    return null
  }
  enemies.sort(
    (a, b) => hexDistance(attacker, a) - hexDistance(attacker, b),
  )
  const foe = enemies[0]!
  const allies = battle.stacks.filter(
    (row) =>
      row.side === attacker.side &&
      row.qty > 0 &&
      !isHeroStack(row),
  )
  const anchor =
    allies.length > 0
      ? allies.reduce((best, row) =>
          hexDistance(foe, row) < hexDistance(foe, best) ? row : best,
        )
      : attacker
  const mid = {
    q: Math.round((foe.q + anchor.q) / 2),
    r: Math.round((foe.r + anchor.r) / 2),
  }
  type TrapPick = { aim: Axial; steps: Axial[]; score: number }
  let best: TrapPick | null = null
  for (const { stand, steps } of stands) {
    for (const tile of tiles) {
      const aim = { q: tile.q, r: tile.r }
      if (
        !isValidTrapPlacementHex(
          stand,
          aim,
          attacker,
          battle,
          catalog,
          tiles,
        )
      ) {
        continue
      }
      const score =
        hexDistance(aim, foe) +
        hexDistance(aim, mid) * 0.5 -
        hexDistance(stand, aim) * 0.1
      if (!best || score < best.score) {
        best = { aim, steps, score }
      }
    }
  }
  return best ? { aim: best.aim, steps: best.steps } : null
}

export function bestTrapPlacementStand(
  attacker: CombatStack,
  aim: Axial,
  reachable: Map<string, Axial[]>,
  from: Axial,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): { stand: Axial; steps: Axial[] } | null {
  let bestStand: Axial | null = null
  let bestSteps: Axial[] = []
  let bestLen = Infinity
  const tryStand = (stand: Axial, steps: Axial[]) => {
    if (
      !isValidTrapPlacementHex(
        stand,
        aim,
        attacker,
        battle,
        catalog,
        tiles,
      )
    ) {
      return
    }
    const len = steps.length
    if (len < bestLen) {
      bestStand = stand
      bestSteps = steps
      bestLen = len
    }
  }
  tryStand(from, [])
  for (const steps of reachable.values()) {
    const last = steps[steps.length - 1]
    if (!last) {
      continue
    }
    tryStand(last, steps)
  }
  if (!bestStand) {
    return null
  }
  return { stand: bestStand, steps: bestSteps }
}
