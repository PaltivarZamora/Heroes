import { logConfigOnce } from '../session/configLog'
import type { ReferenceCatalog, UnitRow } from './catalog'

export function unitHasTag(
  unit: UnitRow | null | undefined,
  tagId: number,
): boolean {
  return Boolean(unit?.tags?.includes(tagId))
}

/** Resolve `unit_tag.value` (case-insensitive) to catalog id. */
export function unitTagId(
  catalog: ReferenceCatalog | null | undefined,
  tagName: string,
): number | null {
  if (!catalog) {
    return null
  }
  const needle = tagName.trim().toLowerCase()
  return (
    catalog.unit_tag.find((row) => row.value.trim().toLowerCase() === needle)
      ?.id ?? null
  )
}

export function unitHasNamedTag(
  catalog: ReferenceCatalog | null | undefined,
  unit: UnitRow | null | undefined,
  tagName: string,
): boolean {
  const id = unitTagId(catalog, tagName)
  return id != null && unitHasTag(unit, id)
}

/** Siege battlefield fixture / engine kinds (Rod tags units in SQL). */
export const TAG_SIEGE_WALL = 'siege_wall'
export const TAG_SIEGE_DRAWBRIDGE = 'siege_drawbridge'
export const TAG_SIEGE_SHOOTER = 'siege_shooter'
export const TAG_SIEGE_ENGINE = 'siege_engine'
export const TAG_AUTO_TARGET_RANDOM_WALL = 'auto_target_random_wall'
export const TAG_AUTO_TARGET_RANDOM_ENEMY = 'auto_target_random_enemy'
export const TAG_FIRE_TOTEM = 'fire_totem'
export const TAG_AIR_TOTEM = 'air_totem'
export const TAG_EARTH_TOTEM = 'earth_totem'
/** Wiped stacks skip tombstone, corpse art, and landing blockers (skull die FX only). */
export const TAG_NO_CORPSE = 'no_corpse'
/** Battle-only summon — does not count as army for wipe/victory; stripped at battle end. */
export const TAG_TEMPORARY = 'temporary'

let warnedMissingTemporaryTag = false

export function isTemporaryUnit(
  catalog: ReferenceCatalog | null | undefined,
  unit: UnitRow | null | undefined,
): boolean {
  if (!unit) {
    return false
  }
  const id = unitTagId(catalog, TAG_TEMPORARY)
  if (id == null) {
    if (!warnedMissingTemporaryTag && catalog) {
      warnedMissingTemporaryTag = true
      logConfigOnce(
        'unit_tag:temporary',
        `[unit_tag] "${TAG_TEMPORARY}" missing from catalog — temporary battle rules disabled.`,
      )
    }
    return false
  }
  return unitHasTag(unit, id)
}
export const TAG_FACTION_CITADEL = 'faction_citadel'

export function unitHasNoCorpseOnWipe(
  catalog: ReferenceCatalog | null | undefined,
  unit: UnitRow | null | undefined,
): boolean {
  return (
    unit != null && unitHasNamedTag(catalog, unit, TAG_NO_CORPSE)
  )
}

export function unitLeavesCorpseOnWipe(
  catalog: ReferenceCatalog | null | undefined,
  unit: UnitRow | null | undefined,
): boolean {
  return !unitHasNoCorpseOnWipe(catalog, unit)
}

export function firstUnitWithNamedTag(
  catalog: ReferenceCatalog,
  tagName: string,
): UnitRow | null {
  const id = unitTagId(catalog, tagName)
  if (id == null) {
    return null
  }
  return catalog.unit.find((row) => unitHasTag(row, id)) ?? null
}
