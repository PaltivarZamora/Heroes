import type { ReferenceCatalog } from '../town/catalog'

/** Raw text value from `anim_config` (numbers and colours stored as text). */
export function animConfigRaw(
  catalog: ReferenceCatalog | null | undefined,
  key: string,
): string | undefined {
  const row = catalog?.anim_config.find((entry) => entry.key === key)
  if (!row) {
    return undefined
  }
  const value = row.value
  return value === '' ? undefined : value
}

export function positiveAnimConfig(
  catalog: ReferenceCatalog | null | undefined,
  key: string,
): number | null {
  const raw = animConfigRaw(catalog, key)
  const n = raw == null ? NaN : Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    return null
  }
  return n
}

export function nonNegativeAnimConfig(
  catalog: ReferenceCatalog | null | undefined,
  key: string,
): number | null {
  const raw = animConfigRaw(catalog, key)
  const n = raw == null ? NaN : Number(raw)
  if (!Number.isFinite(n) || n < 0) {
    return null
  }
  return n
}

/** `#RRGGBB` or `#RGB` from anim_config. */
export function animConfigHexColor(
  catalog: ReferenceCatalog | null | undefined,
  key: string,
): string | null {
  const raw = animConfigRaw(catalog, key)?.trim()
  if (!raw) {
    return null
  }
  if (/^#[0-9A-Fa-f]{6}$/.test(raw)) {
    return raw
  }
  if (/^#[0-9A-Fa-f]{3}$/.test(raw)) {
    const r = raw[1]!
    const g = raw[2]!
    const b = raw[3]!
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return null
}
