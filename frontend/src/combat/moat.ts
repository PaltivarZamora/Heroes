import type { ReferenceCatalog } from '../town/catalog'
import { unitById } from '../town/catalog'
import { applyStackDamage } from './attack'
import { applyBreaksOnDamage } from './condition'
import type { CombatBattle, CombatTile } from './battle'
import { noteUnitDeaths, stackMaxHealth } from './battle'
import { isMoatMechanic } from './groundEffect'
import { syncTombstonesFromWipes } from './tombstone'
import { hexKey, moveKindForUnit } from './movement'
import { occupancyKey, stackFootprint } from './occupancy'
import { isSiegeEngineUnit, isWallSegmentUnit, openBridgeMoatKeys } from './siege'

export type MoatTick = {
  battle: CombatBattle
  lines: string[]
  hitKeys: string[]
}

function noop(battle: CombatBattle): MoatTick {
  return { battle, lines: [], hitKeys: [] }
}

/**
 * Moat ground_effect (entry_and_turn_start_damage): flat HP loss from
 * snapshotted zone.flatDmg — do NOT run Defense, Resistance, or mitigation.
 * Flying and Hover never touch the water and are fully immune. Open
 * Drawbridge span is exempt.
 */
export function applyMoatEntryDamage(
  battle: CombatBattle,
  stackId: string,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): MoatTick {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || stack.qty <= 0 || stack.indestructible) {
    return noop(battle)
  }
  const unit = unitById(catalog, stack.unitId)
  if (isWallSegmentUnit(unit) || isSiegeEngineUnit(unit)) {
    return noop(battle)
  }
  const kind = moveKindForUnit(unit, catalog)
  if (kind === 'flying' || kind === 'hover') {
    return noop(battle)
  }
  const openBridge = openBridgeMoatKeys(battle, catalog, tiles)
  const standKeys = new Set(
    stackFootprint(stack, catalog).map((hex) => occupancyKey(hex.q, hex.r)),
  )
  let damage = 0
  for (const zone of battle.groundEffects ?? []) {
    if (
      !isMoatMechanic(zone.effect, zone.templateId) ||
      zone.flatDmg <= 0
    ) {
      continue
    }
    const hitting = zone.hexKeys.some(
      (key) => standKeys.has(key) && !openBridge.has(key),
    )
    if (!hitting) {
      continue
    }
    damage += zone.flatDmg
  }
  if (damage <= 0) {
    return noop(battle)
  }
  const full = stackMaxHealth(stack, catalog)
  const applied = applyStackDamage(stack, damage, full)
  const name = unit?.name ?? 'Unknown'
  let line = `${stack.qty} ${name} took ${damage} dmg from Moat`
  if (applied.killed > 0) {
    line += ` and ${applied.killed} ${name} died`
  }
  const broken =
    applied.stack && damage > 0
      ? applyBreaksOnDamage(applied.stack, catalog)
      : { stack: applied.stack, lines: [] as string[] }
  const stacks = broken.stack
    ? battle.stacks.map((row) => (row.id === stackId ? broken.stack! : row))
    : battle.stacks.filter((row) => row.id !== stackId)
  let nextBattle: CombatBattle = { ...battle, stacks }
  if (applied.killed > 0) {
    nextBattle = noteUnitDeaths(nextBattle, stack.unitId, applied.killed)
  }
  nextBattle = syncTombstonesFromWipes(battle, nextBattle, catalog)
  return {
    battle: nextBattle,
    lines: [`${line}.`, ...broken.lines],
    hitKeys: [hexKey(stack.q, stack.r)],
  }
}
