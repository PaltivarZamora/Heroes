import { slotsArmyValue } from '../ai/armyAlloc'
import type { GameSession, Hero, Mob } from '../session/types'
import { mapCfgNumber, type ReferenceCatalog } from '../town/catalog'

const NEIGHBORS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
] as const

function hexDistance(
  a: { q: number; r: number },
  b: { q: number; r: number },
): number {
  const dq = a.q - b.q
  const dr = a.r - b.r
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2
}

function key(q: number, r: number): string {
  return `${q},${r}`
}

/** 0 turns ambushes off. Reads the difficulty-merged map config. */
export function mobAggroRange(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, Math.floor(mapCfgNumber(catalog, 'mob_aggro_range', null, 1)))
}

export function mobAggroRatio(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return Math.max(0, mapCfgNumber(catalog, 'mob_aggro_ratio', null, 1.33))
}

/**
 * Aggressive when the mob's army value is at least the hero's times
 * `mob_aggro_ratio` (same qty × avg dmg × health as surrender).
 * Range 0 makes every mob passive.
 */
export function mobIsAggressive(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  hero: Hero,
  mob: Mob,
): boolean {
  if (!catalog || mobAggroRange(catalog) <= 0) {
    return false
  }
  const heroValue = slotsArmyValue(session, catalog, hero.army.slots_1_to_6)
  const mobValue = slotsArmyValue(session, catalog, mob.slots_1_to_6)
  return mobValue >= heroValue * mobAggroRatio(catalog)
}

/** Nearest aggressive mob whose ring contains `hex`, if the hero just entered it. */
export function ambushMobOnHex(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  hero: Hero,
  hex: { q: number; r: number },
): Mob | null {
  const range = mobAggroRange(catalog)
  if (!catalog || range <= 0) {
    return null
  }
  let best: Mob | null = null
  let bestDist = Infinity
  for (const mob of session.mobs) {
    const dist = hexDistance(hex, mob.position)
    if (dist > range || !mobIsAggressive(session, catalog, hero, mob)) {
      continue
    }
    if (
      dist < bestDist ||
      (dist === bestDist && best != null && mob.id < best.id)
    ) {
      best = mob
      bestDist = dist
    }
  }
  return best
}

/**
 * Path preview red: hex is inside an aggressive mob's ambush ring.
 * The path end is not red only when that hex is the deliberate approach to
 * `attackMob` (click-to-attack). Passive mobs never count.
 */
export function pathStepShowsAmbushDanger(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  hero: Hero,
  hex: { q: number; r: number },
  opts?: { isPathEnd?: boolean; attackMob?: Mob | null },
): boolean {
  const range = mobAggroRange(catalog)
  if (!catalog || range <= 0) {
    return false
  }
  for (const mob of session.mobs) {
    if (!mobIsAggressive(session, catalog, hero, mob)) {
      continue
    }
    if (hexDistance(hex, mob.position) > range) {
      continue
    }
    if (opts?.isPathEnd && opts.attackMob?.id === mob.id) {
      continue
    }
    return true
  }
  return false
}

/** Pathing ring is 1 hex, including the mob's own hex. Not the aggro range. */
export function mobPathRingKeys(session: GameSession): Set<string> {
  const keys = new Set<string>()
  for (const mob of session.mobs) {
    keys.add(key(mob.position.q, mob.position.r))
    for (const step of NEIGHBORS) {
      keys.add(key(mob.position.q + step.q, mob.position.r + step.r))
    }
  }
  return keys
}
