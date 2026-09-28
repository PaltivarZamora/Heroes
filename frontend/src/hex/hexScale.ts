import {
  defaultSizeName,
  sizeDim,
  sizeDims,
  sizeNames,
  type ReferenceCatalog,
} from '../town/catalog'

export const HEX_SCALES = {
  Small: 21,
  Medium: 28,
  Large: 42,
} as const

export type HexScaleName = keyof typeof HEX_SCALES

/** Default world hex display size (New Game / Options). */
export const DEFAULT_HEX_SCALE: HexScaleName = 'Medium'

/** Catalog-driven size name (`map_config.sizes`). */
export type MapSizeName = string

/** Display label for live grid dims (includes legacy save sizes). */
const MAP_SIZE_LABELS: Record<string, string> = {
  '36x36': 'Small',
  '72x72': 'Normal',
  '108x108': 'Large',
  '144x144': 'Large',
  '180x180': 'Huge',
  '216x216': 'Giant',
  '252x252': 'Giant',
}

/** Map size names from `map_config.sizes` (fallback when catalog empty). */
export function mapSizes(catalog?: ReferenceCatalog | null): MapSizeName[] {
  return sizeNames(catalog)
}

/** Side length in hexes keyed by size name. */
export function mapSizeDims(
  catalog?: ReferenceCatalog | null,
): Record<string, number> {
  return sizeDims(catalog)
}

export function mapSizeDim(
  catalog: ReferenceCatalog | null | undefined,
  name: string,
): number {
  return sizeDim(catalog, name)
}

export function defaultMapSizeName(
  catalog?: ReferenceCatalog | null,
): MapSizeName {
  return defaultSizeName(catalog)
}

export function mapSizeLabel(width: number, height: number): string {
  const name = MAP_SIZE_LABELS[`${width}x${height}`]
  return name ? `${name} (${width}×${height})` : `${width}×${height}`
}

export function mapSizeChoiceLabel(
  name: MapSizeName,
  catalog?: ReferenceCatalog | null,
): string {
  const dim = mapSizeDim(catalog, name)
  const label =
    name.length > 0
      ? name.charAt(0).toUpperCase() + name.slice(1)
      : name
  return `${label} (${dim}×${dim})`
}
