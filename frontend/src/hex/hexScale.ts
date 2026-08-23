export const HEX_SCALES = {
  Small: 21,
  Medium: 28,
  Large: 42,
} as const

export type HexScaleName = keyof typeof HEX_SCALES

export const DEFAULT_HEX_SCALE: HexScaleName = 'Small'

const MAP_SIZE_NAMES: Record<string, string> = {
  '36x36': 'Small',
  '72x72': 'Medium',
  '108x108': 'Large',
  '144x144': 'Extra Large',
  '180x180': 'Huge',
  '216x216': 'Extra Huge',
  '252x252': 'Giant',
}

export function mapSizeLabel(width: number, height: number): string {
  const name = MAP_SIZE_NAMES[`${width}x${height}`]
  return name ? `${name} (${width}×${height})` : `${width}×${height}`
}
