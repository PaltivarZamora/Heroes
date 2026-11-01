import type { Axial } from '../hex/hero'
import type { Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import { hexTerrainByName, unitAttackShape, unitById } from '../town/catalog'
import type { CombatBattle, CombatTile } from './battle'
import { isHeroStack } from './battle'
import {
  FIRE_GROUND_EFFECT_ID,
  filterFirePlaceableHexKeys,
  placeFireOnHexKeys,
  placeGroundEffectOnEmptyHexes,
  placeStormOnHexKeys,
  resolveUnitGroundEffectChancePct,
  STORM_GROUND_EFFECT_ID,
} from './groundEffect'
import { occupancyKey } from './occupancy'
import {
  placeShadowOnEmptyHexes,
  SHADOW_GROUND_EFFECT_ID,
} from './shadow'
import {
  rollChancePctDetailed,
  summarizeGroundEffectLine,
} from './combatLog'

function effectLabel(templateId: number): string {
  if (templateId === STORM_GROUND_EFFECT_ID) {
    return 'Storm'
  }
  if (templateId === FIRE_GROUND_EFFECT_ID) {
    return 'Fire'
  }
  if (templateId === SHADOW_GROUND_EFFECT_ID) {
    return 'Shadow'
  }
  return 'ground effect'
}

function terrainNameForKey(
  catalog: ReferenceCatalog,
  key: string,
  tiles: CombatTile[] | undefined,
): string | null {
  if (!tiles) {
    return null
  }
  const tile = tiles.find((row) => occupancyKey(row.q, row.r) === key)
  if (!tile) {
    return null
  }
  return hexTerrainByName(catalog, tile.terrain)?.name ?? tile.terrain
}

/**
 * Leave ground_effect on attack geometry (any shape via geometricHexes).
 * One Combat log line per call (placed, failed roll, fizzle, or missing key).
 */
export function tryLeaveGroundEffectOnAttackPath(
  battle: CombatBattle,
  stackId: string,
  catalog: ReferenceCatalog,
  hexes: Axial[],
  tiles?: CombatTile[],
  caster?: Hero | null,
  random: () => number = Math.random,
  source: 'attack' | 'retaliate' = 'attack',
): { battle: CombatBattle; tiles?: CombatTile[]; lines: string[] } {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || isHeroStack(stack) || stack.qty <= 0) {
    return { battle, lines: [], ...(tiles ? { tiles } : {}) }
  }
  const spec = unitAttackShape(unitById(catalog, stack.unitId))
  const templateId = spec.groundEffectId
  const leaves =
    source === 'retaliate'
      ? spec.leavesGroundEffectOnRetaliate
      : spec.leavesGroundEffectOnAttack
  if (!leaves || templateId == null || templateId <= 0) {
    return { battle, lines: [], ...(tiles ? { tiles } : {}) }
  }
  const unitName = unitById(catalog, stack.unitId)?.name ?? 'Attacker'
  const label = effectLabel(templateId)
  const resolved = resolveUnitGroundEffectChancePct(spec, unitName)
  if (resolved.missingLine) {
    return { battle, lines: [resolved.missingLine], ...(tiles ? { tiles } : {}) }
  }
  const chance = resolved.chance!
  const uniqueHexes: Axial[] = []
  const seen = new Set<string>()
  for (const hex of hexes) {
    const key = occupancyKey(hex.q, hex.r)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    uniqueHexes.push(hex)
  }
  const attempted = uniqueHexes.length
  if (attempted === 0) {
    return {
      battle,
      lines: [
        `${unitName}: ${label} — no valid hexes in attack geometry.`,
      ],
      ...(tiles ? { tiles } : {}),
    }
  }
  const rolls: number[] = []
  const rolledKeys: string[] = []
  for (const hex of uniqueHexes) {
    if (chance < 100) {
      const roll = rollChancePctDetailed(chance, random)
      rolls.push(roll.roll)
      if (!roll.triggered) {
        continue
      }
    }
    rolledKeys.push(occupancyKey(hex.q, hex.r))
  }
  let summaryReason: string | undefined
  let placedCount = 0
  let nextBattle = battle
  let nextTiles = tiles

  if (rolledKeys.length === 0) {
    const line = summarizeGroundEffectLine(
      unitName,
      label,
      chance,
      attempted,
      0,
      rolls,
    )
    return { battle, lines: [line], ...(tiles ? { tiles } : {}) }
  }

  if (templateId === SHADOW_GROUND_EFFECT_ID) {
    nextBattle = placeShadowOnEmptyHexes(nextBattle, rolledKeys, stack.side)
    placedCount = rolledKeys.length
  } else if (templateId === FIRE_GROUND_EFFECT_ID) {
    const fizzleIds = spec.fizzleTerrainIds
    const placeable = filterFirePlaceableHexKeys(
      rolledKeys,
      tiles,
      catalog,
      fizzleIds,
    )
    const fizzled = rolledKeys.filter((key) => !placeable.includes(key))
    if (fizzled.length > 0 && placeable.length === 0) {
      const terrain =
        terrainNameForKey(catalog, fizzled[0]!, tiles) ?? 'wet terrain'
      summaryReason = `${label} fizzled (${terrain})`
    }
    const fire = placeFireOnHexKeys(
      nextBattle,
      catalog,
      caster ?? null,
      stack.side,
      rolledKeys,
      tiles,
      null,
      fizzleIds,
    )
    nextBattle = fire.battle
    nextTiles = fire.tiles ?? nextTiles
    placedCount = fire.placedKeys.length
    if (placedCount === 0 && fizzled.length > 0 && !summaryReason) {
      summaryReason = `${label} fizzled (${terrainNameForKey(catalog, fizzled[0]!, tiles) ?? 'wet terrain'})`
    }
  } else if (templateId === STORM_GROUND_EFFECT_ID) {
    const storm = placeStormOnHexKeys(
      nextBattle,
      catalog,
      caster ?? null,
      stack.side,
      rolledKeys,
      tiles,
    )
    nextBattle = storm.battle
    nextTiles = storm.tiles ?? nextTiles
    placedCount = storm.placedKeys.length
  } else {
    const placed = placeGroundEffectOnEmptyHexes(
      nextBattle,
      rolledKeys,
      stack.side,
      templateId,
      catalog,
      tiles,
    )
    nextBattle = placed.battle
    nextTiles = placed.tiles ?? nextTiles
    placedCount = rolledKeys.length
  }

  const line = summarizeGroundEffectLine(
    unitName,
    label,
    chance,
    attempted,
    placedCount,
    rolls,
    summaryReason,
  )
  return {
    battle: nextBattle,
    lines: [line],
    ...(nextTiles ? { tiles: nextTiles } : tiles ? { tiles } : {}),
  }
}
