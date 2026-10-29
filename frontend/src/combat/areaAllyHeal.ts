import type { Axial } from '../hex/hero'
import type { Hero } from '../session/types'
import {
  commandingHeroStats,
  dummyHeroStat,
  unitById,
  unitHasTag,
  type AreaAllyHealConfig,
  type ReferenceCatalog,
  type UnitCombatAbilities,
} from '../town/catalog'
import { heroStatValueByStatId } from '../town/statCatalog'
import { applyStackHeal } from './attack'
import type { CombatBattle, CombatStack, CombatTile } from './battle'
import { isHeroStack, stackMaxHealth } from './battle'
import { occupancyKey } from './occupancy'
import { stackOccupyingHex } from './movement'
import { boardKeys, geometricHexes, type ShapeHit } from './shapes'

function stackName(catalog: ReferenceCatalog, unitId: number): string {
  return unitById(catalog, unitId)?.name ?? 'Unknown'
}

function healAmount(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  config: AreaAllyHealConfig,
): number {
  const statVal = hero
    ? heroStatValueByStatId(
        catalog,
        commandingHeroStats(catalog, hero),
        config.heroStatId,
      )
    : dummyHeroStat(catalog)
  return Math.max(0, Math.floor(statVal * config.mult))
}

function attackAreaHexes(
  spec: UnitCombatAbilities,
  attacker: CombatStack,
  aim: Axial,
  battle: CombatBattle,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
  hits: ShapeHit[],
  chargePathOrigin?: Axial | null,
): Axial[] {
  if (spec.shape === 'multi') {
    return hits.map((hit) => hit.hex)
  }
  const from = { q: attacker.q, r: attacker.r }
  const origin =
    spec.shape === 'charge_line'
      ? (chargePathOrigin ?? from)
      : from
  return geometricHexes(
    spec,
    origin,
    aim,
    battle,
    boardKeys(tiles),
    attacker.side,
    tiles,
    catalog,
  )
}

function qualifiesForAreaHeal(
  stack: CombatStack,
  attacker: CombatStack,
  catalog: ReferenceCatalog,
  allyTagId: number | null,
): boolean {
  if (stack.qty <= 0 || isHeroStack(stack)) {
    return false
  }
  if (stack.side !== attacker.side) {
    return false
  }
  if (allyTagId != null && !unitHasTag(unitById(catalog, stack.unitId), allyTagId)) {
    return false
  }
  return true
}

export function applyAreaAllyHealFromAttack(
  battle: CombatBattle,
  attacker: CombatStack,
  catalog: ReferenceCatalog,
  spec: UnitCombatAbilities,
  aim: Axial,
  hits: ShapeHit[],
  tiles: CombatTile[],
  hero: Hero | null | undefined,
  chargePathOrigin?: Axial | null,
): { battle: CombatBattle; lines: string[]; healKeys: string[] } {
  const config = spec.areaAllyHeal
  if (!config) {
    return { battle, lines: [], healKeys: [] }
  }
  const pool = healAmount(catalog, hero, config)
  if (pool <= 0) {
    return { battle, lines: [], healKeys: [] }
  }
  const hexes = attackAreaHexes(
    spec,
    attacker,
    aim,
    battle,
    tiles,
    catalog,
    hits,
    chargePathOrigin,
  )
  const seen = new Set<string>()
  const allies: CombatStack[] = []
  for (const hex of hexes) {
    const stack = stackOccupyingHex(
      battle.stacks,
      hex.q,
      hex.r,
      catalog,
    )
    if (!stack || seen.has(stack.id)) {
      continue
    }
    if (!qualifiesForAreaHeal(stack, attacker, catalog, config.allyTagId)) {
      continue
    }
    seen.add(stack.id)
    allies.push(stack)
  }
  if (allies.length === 0) {
    return { battle, lines: [], healKeys: [] }
  }
  const atkName = stackName(catalog, attacker.unitId)
  const lines: string[] = []
  const healKeys: string[] = []
  let stacks = battle.stacks
  for (const ally of allies) {
    const live = stacks.find((row) => row.id === ally.id) ?? ally
    const full = stackMaxHealth(live, catalog)
    const healed = applyStackHeal(live, pool, full)
    if (healed.healed <= 0) {
      continue
    }
    stacks = stacks.map((row) => (row.id === ally.id ? healed.stack : row))
    const allyName = stackName(catalog, live.unitId)
    lines.push(`${atkName} mends ${allyName}: +${healed.healed} HP`)
    healKeys.push(occupancyKey(live.q, live.r))
  }
  return {
    battle: { ...battle, stacks },
    lines,
    healKeys,
  }
}
