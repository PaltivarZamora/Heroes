import type { Hero } from '../session/types'
import type { HeroStats, ReferenceCatalog } from './catalog'
import { heroEffectiveStats, heroTypeName } from './catalog'

export type PassiveStats = Record<string, unknown>

/**
 * `hero_type.passive_stats` for this hero's class.
 * Returns null when missing — callers that need an active passive must
 * use `requirePassiveStats` so the gap is logged, not silently no-op'd.
 */
export function heroPassiveStats(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): PassiveStats | null {
  if (!hero?.class_id) {
    return null
  }
  const row = catalog.hero_type.find((entry) => entry.id === hero.class_id)
  const stats = row?.passive_stats
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
    return null
  }
  return stats
}

const warnedMissing = new Set<string>()

/**
 * Require passive_stats for an active hero passive. Logs once per
 * hero_type.id + context when the column is null/empty.
 */
export function requirePassiveStats(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  context: string,
): PassiveStats | null {
  const stats = heroPassiveStats(catalog, hero)
  if (stats) {
    return stats
  }
  if (!hero?.class_id) {
    return null
  }
  const key = `${hero.class_id}:${context}`
  if (!warnedMissing.has(key)) {
    warnedMissing.add(key)
    const name = heroTypeName(catalog, hero.class_id) || `id ${hero.class_id}`
    console.error(
      `[passive_stats] missing for ${name} (hero_type.id=${hero.class_id}) while applying ${context}`,
    )
  }
  return null
}

/** Named number from passive_stats (ability.stats style). Null if absent/invalid. */
export function passiveStatNumber(
  stats: PassiveStats | null | undefined,
  key: string,
): number | null {
  if (!stats) {
    return null
  }
  const n = Number(stats[key])
  return Number.isFinite(n) ? n : null
}

/** Named string from passive_stats. */
export function passiveStatString(
  stats: PassiveStats | null | undefined,
  key: string,
): string | null {
  if (!stats) {
    return null
  }
  const raw = stats[key]
  if (typeof raw !== 'string') {
    return null
  }
  const text = raw.trim()
  return text.length > 0 ? text : null
}

/** Named string list (or single string) from passive_stats. */
export function passiveStatStringList(
  stats: PassiveStats | null | undefined,
  key: string,
): string[] {
  if (!stats) {
    return []
  }
  const raw = stats[key]
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((text) => text.length > 0)
  }
  if (typeof raw === 'string' && raw.trim()) {
    return [raw.trim()]
  }
  return []
}

/** Resolve STR/INT/etc. from `stat_source` / `qty_stat` style keys. */
export function passiveStatSourceValue(
  catalog: ReferenceCatalog,
  hero: Hero,
  source: string | null | undefined,
): number {
  const stats = heroEffectiveStats(
    catalog,
    hero.class_id,
    hero.current_level ?? 1,
  )
  return pickHeroStat(stats, source)
}

function pickHeroStat(stats: HeroStats, source: string | null | undefined): number {
  const key = (source ?? '').trim().toUpperCase()
  if (key === 'STR' || key === 'STRENGTH') {
    return stats.strength
  }
  if (key === 'INT' || key === 'INTEL' || key === 'INTELLIGENCE') {
    return stats.intel
  }
  if (key === 'DEF' || key === 'DEFENSE') {
    return stats.defense
  }
  if (key === 'RES' || key === 'RESIST' || key === 'RESISTANCE') {
    return stats.resist
  }
  if (key === 'SPD' || key === 'SPEED') {
    return stats.speed
  }
  if (key === 'STA' || key === 'STAMINA') {
    return stats.stamina
  }
  return 0
}

/** Log once when a required key is absent from an otherwise-present passive_stats. */
export function missingPassiveStatKey(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  key: string,
  context: string,
): void {
  if (!hero?.class_id) {
    return
  }
  const warnKey = `${hero.class_id}:${context}:${key}`
  if (warnedMissing.has(warnKey)) {
    return
  }
  warnedMissing.add(warnKey)
  const name = heroTypeName(catalog, hero.class_id) || `id ${hero.class_id}`
  console.error(
    `[passive_stats] ${name} (hero_type.id=${hero.class_id}) missing key "${key}" for ${context}`,
  )
}
