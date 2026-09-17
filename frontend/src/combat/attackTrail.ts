import type { Axial } from '../hex/hero'
import type { Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import { unitAttackShape, unitById } from '../town/catalog'
import type { CombatBattle, CombatStack, CombatTile } from './battle'
import { isHeroStack } from './battle'
import {
  FIRE_GROUND_EFFECT_ID,
  placeFireOnHexKeys,
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
  const effectLabel =
    templateId === STORM_GROUND_EFFECT_ID
      ? 'Storm'
      : templateId === FIRE_GROUND_EFFECT_ID
        ? 'Fire'
        : 'ground effect'
  // S6-36 / S6-50: one aggregated leave-behind line (not per-hex spam).
  const lines: string[] =
    attempted > 0 && (chance < 100 || templateId === STORM_GROUND_EFFECT_ID)
      ? [
          templateId === STORM_GROUND_EFFECT_ID ||
          templateId === FIRE_GROUND_EFFECT_ID
            ? `${unitName} dropped ${effectLabel} ${hits}/${attempted} times` +
              (chance < 100 ? ` (${chance}% per hex).` : '.')
            : chanceRollLog(unitName, chance, hits > 0, {
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
