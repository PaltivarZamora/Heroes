/**
 * Empty-slot placeholder art (separate from building.image_path; Rod owns
 * disk renames for these files):
 *   {Town}_{Slot:02d}_Empty_1.png
 *   e.g. Grove_11_Empty_1.png
 *
 * Built slots always load building.image_path from the database — never
 * synthesize a filename from slot/level/name.
 */
export function emptySlotArtFilename(
  slotId: number,
  townTypeName = 'Necropolis',
): string {
  const town = townTypeName.trim() || 'Necropolis'
  const slot = String(slotId).padStart(2, '0')
  return `${town}_${slot}_Empty_1.png`
}

/** Built → building.image_path; empty → emptySlotArtFilename. */
export function slotArtFilename(
  slotId: number,
  level: number,
  imagePath: string | null,
  townTypeName = 'Necropolis',
): string {
  if (level <= 0 || !imagePath) {
    return emptySlotArtFilename(slotId, townTypeName)
  }
  return imagePath
}

/** Necropolis skyline is .png; other town skylines ship as .jpg. */
export function townSkylineFilename(townTypeName: string): string {
  const town = townTypeName.trim() || 'Necropolis'
  if (town === 'Necropolis') {
    return `${town}_Skyline.png`
  }
  return `${town}_Skyline.jpg`
}

export const GENERIC_EMPTY_ART_FILENAME = 'Empty.png'

/** Slot 0 placeholder — file lives in public/assets/heroes/portraits/. */
export const GARRISON_ART_FILENAME = 'Garrison.png'

export function slotArtUrl(filename: string): string {
  if (filename.startsWith('/')) {
    return filename
  }
  return `/assets/towns/${filename}`
}

/** Building stills live under `public/assets/towns/{TownType}/`. */
export function townBuildingArtUrl(
  filename: string,
  townTypeName = 'Necropolis',
): string {
  if (filename.startsWith('/')) {
    return filename
  }
  const trimmed = filename
    .replace(/^assets\/towns\//, '')
    .replace(/^\//, '')
  if (trimmed.includes('/')) {
    return `/assets/towns/${trimmed}`
  }
  const town = townTypeName.trim() || 'Necropolis'
  return `/assets/towns/${town}/${trimmed}`
}

/** Hero (and Garrison) stills under public/assets/heroes/portraits/. */
export function heroPortraitUrl(filename: string): string {
  if (filename.startsWith('/')) {
    return filename
  }
  const trimmed = filename.replace(/^assets\//, '').replace(/^\//, '')
  if (trimmed.startsWith('heroes/')) {
    return `/assets/${trimmed}`
  }
  if (trimmed.startsWith('portraits/')) {
    return `/assets/heroes/${trimmed}`
  }
  return `/assets/heroes/portraits/${trimmed}`
}

export function itemArtUrl(filename: string): string {
  if (filename.startsWith('/')) {
    return filename
  }
  return `/assets/items/${filename}`
}

export function terrainArtUrl(filename: string): string {
  if (filename.startsWith('/')) {
    return filename
  }
  // DB may store "Smoke_Cloud.png" or "terrain/Smoke_Cloud.png".
  const trimmed = filename.replace(/^assets\//, '').replace(/^\//, '')
  if (trimmed.startsWith('terrain/')) {
    return `/assets/${trimmed}`
  }
  return `/assets/terrain/${trimmed}`
}

/** Strip to a bare filename under `assets/units/`. */
export function normalizeUnitAssetFileName(filename: string): string {
  const trimmed = filename.trim().replace(/^\/+/, '')
  if (!trimmed) {
    return ''
  }
  const noUnitsPrefix = trimmed.replace(/^assets\/units\//, '')
  return noUnitsPrefix.replace(/^.*[/\\]/, '')
}

/** Town folder for unit stills and battle sheets: `/assets/units/{town}/`. */
export function unitAssetsTownBase(townName: string): string {
  const town = townName.trim()
  return `/assets/units/${town}`
}

/**
 * Static unit picture URLs: town folder first, then legacy flat `assets/units/`.
 * No log when the flat fallback is used.
 */
export function unitStaticPictureUrls(
  filename: string,
  townName?: string | null,
): string[] {
  const bare = normalizeUnitAssetFileName(filename)
  if (!bare) {
    return []
  }
  const paths: string[] = []
  const town = townName?.trim()
  if (town) {
    paths.push(`${unitAssetsTownBase(town)}/${bare}`)
  }
  paths.push(`/assets/units/${bare}`)
  return paths
}

/** Primary static unit art URL (first lookup candidate). */
export function unitPortraitUrl(
  filename: string,
  townName?: string | null,
): string {
  const paths = unitStaticPictureUrls(filename, townName)
  if (paths.length > 0) {
    return paths[0]!
  }
  return `/assets/units/${filename}`
}

/** Battle anim sheet JSON under the unit's town folder. */
export function unitBattleAnimSheetJsonUrl(
  townName: string,
  stem: string,
  anim: string,
): string {
  return `${unitAssetsTownBase(townName)}/${stem}_${anim}.json`
}

/** Optional projectile still under the unit's town folder. */
export function unitBattleProjectileUrl(townName: string, stem: string): string {
  return `${unitAssetsTownBase(townName)}/${stem}_Projectile.png`
}
