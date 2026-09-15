import type { Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import { heroEffectiveStats, unitById, unitHasTag } from '../town/catalog'
import type { ArmyTagCounts, CombatSide, CombatStack } from './battle'

/** unit_tag.id — Humanoid (Citadel Knight/Monk scale; reusable). */
export const HUMANOID_TAG = 2

/** Default S6-40 addendum: 0.25% per Humanoid. */
const DEFAULT_TRIGGER_PCT_PER_HUMANOID = 0.25
/** Knight: chance caps at STR × this. */
const DEFAULT_KNIGHT_CAP_PCT_STAT = 2
/** Monk: chance caps at STR × this. */
const DEFAULT_MONK_CAP_PCT_STAT = 3

/**
 * Frozen at battle start: tag id → qty of tagged creatures per side.
 * Not recalculated mid-battle (same freeze rule as Factory Non-Living ideas).
 */
export type { ArmyTagCounts }

/**
 * Sum stack quantities with `tagId` on one side (or both when `side` omitted).
 * Heroes are skipped; only tagged creature stacks count.
 */
export function countUnitsWithTag(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  tagId: number,
  side?: CombatSide,
): number {
  let total = 0
  for (const stack of stacks) {
    if (side != null && stack.side !== side) {
      continue
    }
    if (stack.qty <= 0 || stack.heroId) {
      continue
    }
    const unit = unitById(catalog, stack.unitId)
    if (!unitHasTag(unit, tagId)) {
      continue
    }
    total += stack.qty
  }
  return total
}

/** Snapshot tag counts for both sides — call once when the battle opens. */
export function freezeArmyTagCounts(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  tagIds: number[],
): ArmyTagCounts {
  const out: ArmyTagCounts = {}
  for (const tagId of tagIds) {
    out[tagId] = {
      atk: countUnitsWithTag(stacks, catalog, tagId, 'atk'),
      def: countUnitsWithTag(stacks, catalog, tagId, 'def'),
    }
  }
  return out
}

export function frozenTagCount(
  counts: ArmyTagCounts | undefined,
  tagId: number,
  side: CombatSide,
): number {
  return Math.max(0, counts?.[tagId]?.[side] ?? 0)
}

export function isCitadelUnit(
  catalog: ReferenceCatalog,
  unitId: number,
): boolean {
  const unit = unitById(catalog, unitId)
  if (!unit?.town_id) {
    return false
  }
  const citadelId = catalog.town.find(
    (row) => row.name.trim().toLowerCase() === 'citadel',
  )?.id
  return citadelId != null && unit.town_id === citadelId
}

function heroPassive(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): Record<string, unknown> | null {
  if (!hero) {
    return null
  }
  return (
    catalog.hero_type.find((row) => row.id === hero.class_id)?.passive_ability ??
    null
  )
}

function passiveNumber(
  passive: Record<string, unknown> | null | undefined,
  key: string,
  fallback: number,
): number {
  const n = Number(passive?.[key])
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/**
 * Citadel passives: min(humanoids × pct_per_unit, strength × cap_pct_stat).
 * Shared shape for Knight / Monk; only the cap multiplier differs.
 */
export function citadelHumanoidChancePct(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  humanoidCount: number,
  defaultCapPctStat: number,
): number {
  if (!hero) {
    return 0
  }
  const passive = heroPassive(catalog, hero)
  const per = passiveNumber(
    passive,
    'trigger_chance_pct_per_humanoid_unit',
    DEFAULT_TRIGGER_PCT_PER_HUMANOID,
  )
  const capStat = passiveNumber(passive, 'cap_pct_stat', defaultCapPctStat)
  const strength = heroEffectiveStats(
    catalog,
    hero.class_id,
    hero.current_level ?? 1,
  ).strength
  const raw = Math.max(0, humanoidCount * per)
  const cap = Math.max(0, strength * capStat)
  return Math.min(raw, cap)
}

export function knightCapPctStat(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): number {
  return passiveNumber(
    heroPassive(catalog, hero),
    'cap_pct_stat',
    DEFAULT_KNIGHT_CAP_PCT_STAT,
  )
}

export function monkCapPctStat(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): number {
  return passiveNumber(
    heroPassive(catalog, hero),
    'cap_pct_stat',
    DEFAULT_MONK_CAP_PCT_STAT,
  )
}
