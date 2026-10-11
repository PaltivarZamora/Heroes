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
export const TAG_NATURE_TOTEM = 'nature_totem'
export const TAG_FIRE_TOTEM = 'fire_totem'
export const TAG_LIGHTNING_TOTEM = 'lightning_totem'
export const TAG_FACTION_CITADEL = 'faction_citadel'

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
