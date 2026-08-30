import { armyTier, isArmySlot } from './catalog'

const TOWN_TYPE = 'Necropolis'

/**
 * Empty-slot art (confirm with Rod):
 *   Army:    {Town}_{Slot:02d}_{Tier}_Empty_0.png
 *            e.g. Necropolis_04_1_Empty_0.png
 *   Generic: {Town}_{Slot:02d}_Empty_0.png
 *            e.g. Necropolis_01_Empty_0.png
 *
 * Built slots load building.image_path from the database.
 */
export function emptySlotArtFilename(slotId: number): string {
  const slot = String(slotId).padStart(2, '0')
  if (isArmySlot(slotId)) {
    return `${TOWN_TYPE}_${slot}_${armyTier(slotId)}_Empty_0.png`
  }
  return `${TOWN_TYPE}_${slot}_Empty_0.png`
}

/** Built slots use building.image_path; empty slots keep the derived Empty name. */
export function slotArtFilename(
  slotId: number,
  level: number,
  imagePath: string | null,
): string {
  if (level <= 0 || !imagePath) {
    return emptySlotArtFilename(slotId)
  }
  return imagePath
}

export const GENERIC_EMPTY_ART_FILENAME = 'Empty.png'

/** Slot 0 placeholder — file lives in public/assets/heros/, not towns/. */
export const GARRISON_ART_FILENAME = 'Garrison.png'

export function slotArtUrl(filename: string): string {
  if (filename.startsWith('/')) {
    return filename
  }
  return `/assets/towns/${filename}`
}

export function heroPortraitUrl(filename: string): string {
  if (filename.startsWith('/')) {
    return filename
  }
  return `/assets/heros/${filename}`
}

export function itemArtUrl(filename: string): string {
  if (filename.startsWith('/')) {
    return filename
  }
  return `/assets/items/${filename}`
}

export function unitPortraitUrl(filename: string): string {
  if (filename.startsWith('/')) {
    return filename
  }
  return `/assets/units/${filename}`
}
