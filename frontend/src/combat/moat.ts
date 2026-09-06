import type { ReferenceCatalog } from '../town/catalog'
import { terrainByName, unitById } from '../town/catalog'
import { applyStackDamage } from './attack'
import { applyBreaksOnDamage } from './condition'
import type { CombatBattle, CombatTile } from './battle'
import { noteUnitDeaths, stackMaxHealth } from './battle'
import { hexKey, moveKindForUnit } from './movement'
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
 * Moat `entry_damage` is a terrain hazard, not an attack.
 * Apply the catalog value as flat HP loss — do NOT run Defense,
 * Resistance, or mitigationOf. Flying and Hover never touch the water
 * and are fully immune.
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
  if (openBridgeMoatKeys(battle, catalog, tiles).has(hexKey(stack.q, stack.r))) {
    return noop(battle)
  }
  const tile = tiles.find((row) => row.q === stack.q && row.r === stack.r)
  if (!tile) {
    return noop(battle)
  }
  const spec = terrainByName(catalog, tile.terrain)
  const damage = spec?.entry_damage ?? 0
  if (damage <= 0) {
    return noop(battle)
  }
  const full = stackMaxHealth(stack, catalog)
  const applied = applyStackDamage(stack, damage, full)
  const name = unit?.name ?? 'Unknown'
  const terrainName = (spec?.name ?? tile.terrain).replaceAll('_', ' ')
  let line = `${stack.qty} ${name} took ${damage} dmg from ${terrainName}`
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
  return {
    battle: nextBattle,
    lines: [`${line}.`, ...broken.lines],
    hitKeys: [hexKey(stack.q, stack.r)],
  }
}
