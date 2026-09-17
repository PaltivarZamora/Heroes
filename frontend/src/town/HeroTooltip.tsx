import type { ReactNode } from 'react'
import type { Hero, GameSession } from '../session/types'
import type { ReferenceCatalog } from './catalog'
import { heroTypeName } from './catalog'
import { AbilityTip } from './AbilityTip'
import {
  disciplineResourceId,
  poolCurrent,
  poolMax,
  resourceLabel,
} from '../combat/heroCast'
import { classDisciplines } from './libraryRules'
import {
  heroPassiveDisplay,
  heroPassiveLiveLines,
} from './heroPassiveDisplay'

function primaryResourceId(
  catalog: ReferenceCatalog,
  hero: Hero,
): number {
  const disciplines = classDisciplines(catalog, hero.class_id ?? -1)
  if (disciplines[0]) {
    return disciplineResourceId(catalog, disciplines[0].id)
  }
  return 2
}

/** Shared Hero tooltip body for Hero screen, Town, and Battle. */
export function heroTooltipText(
  catalog: ReferenceCatalog,
  hero: Hero,
  session?: GameSession | null,
): string {
  const className = heroTypeName(catalog, hero.class_id) || '—'
  const level = hero.current_level ?? 1
  const resourceId = primaryResourceId(catalog, hero)
  const label = resourceLabel(catalog, resourceId)
  const current = poolCurrent(hero, resourceId)
  const max = poolMax(catalog, hero, resourceId)
  const passive = heroPassiveDisplay(catalog, hero)
  const lines = [
    hero.name,
    `Class: ${className}`,
    `Level: ${level}`,
    `${label}: ${current} / ${max}`,
  ]
  if (passive) {
    lines.push('', `Passive: ${passive}`)
  }
  if (session) {
    const live = heroPassiveLiveLines(catalog, hero, session)
    if (live.length > 0) {
      lines.push('', ...live)
    }
  }
  return lines.join('\n')
}

export function HeroTooltip({
  catalog,
  hero,
  session,
  children,
  className,
}: {
  catalog: ReferenceCatalog
  hero: Hero
  session?: GameSession | null
  children: ReactNode
  className?: string
}) {
  return (
    <AbilityTip
      className={className}
      description={heroTooltipText(catalog, hero, session)}
    >
      {children}
    </AbilityTip>
  )
}
