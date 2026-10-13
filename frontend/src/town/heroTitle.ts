import type { Hero } from '../session/types'
import { heroTypeName, xpToReachLevel, type ReferenceCatalog } from './catalog'

export function heroTitleWithClass(
  catalog: ReferenceCatalog,
  hero: Hero,
): string {
  const className =
    hero.class_id != null ? heroTypeName(catalog, hero.class_id).trim() : ''
  if (className) {
    return `${hero.name} (${className})`
  }
  return hero.name
}

/** Inventory panel header: name (class) plus level and XP bar text. */
export function heroInventoryHeaderTitle(
  catalog: ReferenceCatalog,
  hero: Hero,
): string {
  const base = heroTitleWithClass(catalog, hero)
  const level = hero.current_level ?? 1
  const xp = hero.current_xp ?? 0
  const xpNext = xpToReachLevel(catalog, level)
  const xpFmt = (n: number) => n.toLocaleString('en-US')
  if (xpNext != null) {
    return `${base} - Lvl ${level} (${xpFmt(xp)} / ${xpFmt(xpNext)})`
  }
  return `${base} - Lvl ${level} (${xpFmt(xp)})`
}
