import type { ReferenceCatalog } from '../town/catalog'
import type { CombatHeroes } from './attack'
import type { CombatBattle, CombatTile } from './battle'
import { applyTerrainGrowth } from './confluence'
import { applyFireGroundDamage } from './groundEffect'
import { applyMoatEntryDamage, type MoatTick } from './moat'

export type HazardTick = MoatTick & {
  fireDamage: number
  fireHits: number
  fireKilled: number
  fireLabel: string
  /** Moat / non-fire lines only (Fire is summarized separately when walking). */
  moatLines: string[]
}

/**
 * Moat + Fire/Storm + terrain growth. Call at turn-start, walk entry, and
 * turn-end (skip turn-end when walk entry already applied hazards this action).
 */
export function applyStandingHazards(
  battle: CombatBattle,
  stackId: string,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  heroes?: CombatHeroes,
  random: () => number = Math.random,
): HazardTick {
  const moat = applyMoatEntryDamage(battle, stackId, catalog, tiles)
  const fire = applyFireGroundDamage(
    moat.battle,
    stackId,
    catalog,
    tiles,
    heroes,
    random,
  )
  const growth = applyTerrainGrowth(fire.battle, stackId, catalog, tiles)
  return {
    battle: growth.battle,
    lines: [...moat.lines, ...fire.lines, ...growth.lines],
    hitKeys: [...new Set([...moat.hitKeys, ...fire.hitKeys])],
    fireDamage: fire.damage,
    fireHits: fire.damage > 0 ? 1 : 0,
    fireKilled: fire.killed,
    fireLabel: fire.label,
    moatLines: moat.lines,
  }
}
