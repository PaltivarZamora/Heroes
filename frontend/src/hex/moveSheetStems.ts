/** Move-sheet stems (no extension). Shared by transports and class mounts — no hero module imports. */

export const BOAT_MOVE_STEM = 'Mount_Boat_Move'
export const WORLD_MOVE_STEM = 'Mount_World_Move'

export function moveSheetStaticFile(stem: string): string {
  return `${stem}.png`
}

/** True when `file` is a move-sheet atlas PNG (must not be loaded as a single texture). */
export function isMoveSheetImageFile(file: string): boolean {
  return /_Move\.png$/i.test(file.trim())
}

export function townMoveSheetStem(townTypeName: string): string {
  const base = townTypeName.trim().replace(/\s+/g, '_')
  return `Mount_${base}_Move`
}

export function classMountMoveSheetStem(className: string): string {
  const base = className.trim().replace(/\s+/g, '_')
  return `Mount_${base}_Move`
}
