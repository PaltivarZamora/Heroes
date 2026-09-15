import type { Axial } from '../hex/hero'
import type { Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import { unitAttackShape, unitById } from '../town/catalog'
import type { CombatBattle, CombatStack, CombatTile } from './battle'
import { isHeroStack } from './battle'
import {
  buildPassiveZoneFromTemplate,
  filterFirePlaceableHexKeys,
  FIRE_GROUND_EFFECT_ID,
  placeFireOnHexKeys,
  placeGroundEffectOnBattle,
  placeGroundEffectOnEmptyHexes,
  placeStormOnHexKeys,
  STORM_GROUND_EFFECT_ID,
} from './groundEffect'
import { occupancyKey } from './occupancy'
import {
  placeShadowOnEmptyHexes,
  SHADOW_GROUND_EFFECT_ID,
} from './shadow'
import { chanceRollLog, rollChancePct } from './combatLog'
import { leaveBehindChancePct } from './confluence'

/**
 * Leave ground_effect on attack geometry (any shape via geometricHexes).
 * Shadow: empty-hex only, never overwrite. Fire: overwrite + wet-terrain fizzle.
 * Per-hex chance_pct (default 100 when omitted — Skeleton Caster).
 */
export function tryLeaveGroundEffectOnAttackPath(
  battle: CombatBattle,
  stackId: string,
  catalog: ReferenceCatalog,
  hexes: Axial[],
  tiles?: CombatTile[],
  caster?: Hero | null,
  random: () => number = Math.random,
): { battle: CombatBattle; tiles?: CombatTile[]; lines: string[] } {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || isHeroStack(stack) || stack.qty <= 0) {
    return { battle, lines: [], ...(tiles ? { tiles } : {}) }
  }
  const spec = unitAttackShape(unitById(catalog, stack.unitId))
  const templateId = spec.groundEffectId
  if (!spec.leavesGroundEffectOnAttack || templateId == null || templateId <= 0) {
    return { battle, lines: [], ...(tiles ? { tiles } : {}) }
  }
  const chance = leaveBehindChancePct(
    catalog,
    caster ?? null,
    spec.chancePct,
    spec.chancePctIntelStat,
  )
  const rolledKeys: string[] = []
  let attempted = 0
  let hits = 0
  for (const hex of hexes) {
    attempted += 1
    if (chance < 100 && !rollChancePct(chance, random)) {
      continue
    }
    hits += 1
    rolledKeys.push(occupancyKey(hex.q, hex.r))
  }
  const unitName = unitById(catalog, stack.unitId)?.name ?? 'Attacker'
  const lines: string[] =
    chance < 100 && attempted > 0
      ? [
          chanceRollLog(unitName, chance, hits > 0, {
            action: 'to leave ground effect per hex',
            success: `${hits}/${attempted} hexes.`,
            fail: `0/${attempted} hexes.`,
          }),
        ]
      : []
  if (rolledKeys.length === 0) {
    return { battle, lines, ...(tiles ? { tiles } : {}) }
  }
  if (templateId === SHADOW_GROUND_EFFECT_ID) {
    return {
      battle: placeShadowOnEmptyHexes(battle, rolledKeys, stack.side),
      lines,
      ...(tiles ? { tiles } : {}),
    }
  }
  if (templateId === FIRE_GROUND_EFFECT_ID) {
    return {
      ...leaveFireOnAttackPath(
        battle,
        stack,
        catalog,
        rolledKeys,
        tiles,
        caster ?? null,
      ),
      lines,
    }
  }
  if (templateId === STORM_GROUND_EFFECT_ID) {
    return {
      ...leaveStormOnAttackPath(
        battle,
        stack,
        catalog,
        rolledKeys,
        tiles,
        caster ?? null,
      ),
      lines,
    }
  }
  return {
    ...placeGroundEffectOnEmptyHexes(
      battle,
      rolledKeys,
      stack.side,
      templateId,
      catalog,
      tiles,
    ),
    lines,
  }
}

function leaveFireOnAttackPath(
  battle: CombatBattle,
  stack: CombatStack,
  catalog: ReferenceCatalog,
  rolledKeys: string[],
  tiles: CombatTile[] | undefined,
  caster: Hero | null,
): { battle: CombatBattle; tiles?: CombatTile[] } {
  if (!caster) {
    const keys = filterFirePlaceableHexKeys(rolledKeys, tiles, catalog)
    if (keys.length === 0) {
      return { battle, ...(tiles ? { tiles } : {}) }
    }
    const zone = buildPassiveZoneFromTemplate(
      catalog,
      FIRE_GROUND_EFFECT_ID,
      keys,
      stack.side,
    )
    if (!zone) {
      return { battle, ...(tiles ? { tiles } : {}) }
    }
    return placeGroundEffectOnBattle(battle, zone, tiles)
  }
  const fire = placeFireOnHexKeys(
    battle,
    catalog,
    caster,
    stack.side,
    rolledKeys,
    tiles,
  )
  return {
    battle: fire.battle,
    ...(fire.tiles ? { tiles: fire.tiles } : tiles ? { tiles } : {}),
  }
}

function leaveStormOnAttackPath(
  battle: CombatBattle,
  stack: CombatStack,
  catalog: ReferenceCatalog,
  rolledKeys: string[],
  tiles: CombatTile[] | undefined,
  caster: Hero | null,
): { battle: CombatBattle; tiles?: CombatTile[] } {
  if (!caster) {
    const zone = buildPassiveZoneFromTemplate(
      catalog,
      STORM_GROUND_EFFECT_ID,
      rolledKeys,
      stack.side,
    )
    if (!zone) {
      return { battle, ...(tiles ? { tiles } : {}) }
    }
    return placeGroundEffectOnBattle(battle, zone, tiles)
  }
  const storm = placeStormOnHexKeys(
    battle,
    catalog,
    caster,
    stack.side,
    rolledKeys,
    tiles,
  )
  return {
    battle: storm.battle,
    ...(storm.tiles ? { tiles: storm.tiles } : tiles ? { tiles } : {}),
  }
}
