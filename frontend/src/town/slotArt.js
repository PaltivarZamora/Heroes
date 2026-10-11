/**
 * Empty-slot placeholder art (separate from building.image_path; Rod owns
 * disk renames for these files):
 *   {Town}_{Slot:02d}_Empty_1.png
 *   e.g. Grove_11_Empty_1.png
 *
 * Built slots always load building.image_path from the database — never
 * synthesize a filename from slot/level/name.
 */
export function emptySlotArtFilename(slotId, townTypeName = 'Necropolis') {
    const town = townTypeName.trim() || 'Necropolis';
    const slot = String(slotId).padStart(2, '0');
    return `${town}_${slot}_Empty_1.png`;
}
/** Built → building.image_path; empty → emptySlotArtFilename. */
export function slotArtFilename(slotId, level, imagePath, townTypeName = 'Necropolis') {
    if (level <= 0 || !imagePath) {
        return emptySlotArtFilename(slotId, townTypeName);
    }
    return imagePath;
}
/** Necropolis skyline is .png; other town skylines ship as .jpg. */
export function townSkylineFilename(townTypeName) {
    const town = townTypeName.trim() || 'Necropolis';
    if (town === 'Necropolis') {
        return `${town}_Skyline.png`;
    }
    return `${town}_Skyline.jpg`;
}
export const GENERIC_EMPTY_ART_FILENAME = 'Empty.png';
/** Slot 0 placeholder — file lives in public/assets/heroes/portraits/. */
export const GARRISON_ART_FILENAME = 'Garrison.png';
export function slotArtUrl(filename) {
    if (filename.startsWith('/')) {
        return filename;
    }
    return `/assets/towns/${filename}`;
}
/** Building stills live under `public/assets/towns/{TownType}/`. */
export function townBuildingArtUrl(filename, townTypeName = 'Necropolis') {
    if (filename.startsWith('/')) {
        return filename;
    }
    const trimmed = filename
        .replace(/^assets\/towns\//, '')
        .replace(/^\//, '');
    if (trimmed.includes('/')) {
        return `/assets/towns/${trimmed}`;
    }
    const town = townTypeName.trim() || 'Necropolis';
    return `/assets/towns/${town}/${trimmed}`;
}
/** Hero (and Garrison) stills under public/assets/heroes/portraits/. */
export function heroPortraitUrl(filename) {
    if (filename.startsWith('/')) {
        return filename;
    }
    const trimmed = filename.replace(/^assets\//, '').replace(/^\//, '');
    if (trimmed.startsWith('heroes/')) {
        return `/assets/${trimmed}`;
    }
    if (trimmed.startsWith('portraits/')) {
        return `/assets/heroes/${trimmed}`;
    }
    return `/assets/heroes/portraits/${trimmed}`;
}
export function itemArtUrl(filename) {
    if (filename.startsWith('/')) {
        return filename;
    }
    return `/assets/items/${filename}`;
}
export function terrainArtUrl(filename) {
    if (filename.startsWith('/')) {
        return filename;
    }
    // DB may store "Smoke_Cloud.png" or "terrain/Smoke_Cloud.png".
    const trimmed = filename.replace(/^assets\//, '').replace(/^\//, '');
    if (trimmed.startsWith('terrain/')) {
        return `/assets/${trimmed}`;
    }
    return `/assets/terrain/${trimmed}`;
}
export function unitPortraitUrl(filename) {
    if (filename.startsWith('/')) {
        return filename;
    }
    return `/assets/units/${filename}`;
}
