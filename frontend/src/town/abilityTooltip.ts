import type { AbilityRow, ReferenceCatalog } from './catalog'
import {
  abilityBracketValues,
  interpolateAbilityBrackets,
  type AbilityBracketContext,
  type AbilityTooltipHero,
} from '../combat/abilityBrackets'

export type { AbilityBracketContext, AbilityTooltipHero }

function abilityCastLine(
  catalog: ReferenceCatalog | null | undefined,
  ability: AbilityRow,
): string {
  const resource = catalog?.ability_resource.find(
    (row) => row.id === ability.resource_id,
  )?.value
  const cooldown = catalog?.ability_cooldown.find(
    (row) => row.id === ability.cooldown_id,
  )
  const parts: string[] = []
  if (resource) {
    parts.push(`${ability.cost} ${resource}`)
  } else if (ability.cost > 0) {
    parts.push(String(ability.cost))
  }
  if (cooldown && cooldown.id !== 0) {
    parts.push(cooldown.value)
  }
  return parts.join(' · ')
}

/**
 * Ability description with live bracket interpolation (BR S7-12), plus cast cost line.
 * Pass `hero` so stat-scaled tokens update with the caster's current stats.
 */
export function abilityTooltip(
  catalog: ReferenceCatalog | null | undefined,
  ability: AbilityRow,
  hero?: AbilityTooltipHero | null,
  extras?: Omit<AbilityBracketContext, 'hero'>,
): string {
  const brackets = abilityBracketValues(catalog, ability, {
    hero: hero ?? null,
    targetResistance: extras?.targetResistance,
    targetMaxHp: extras?.targetMaxHp,
  })
  const description = interpolateAbilityBrackets(
    ability.description ?? '',
    brackets,
  )
  const extra = abilityCastLine(catalog, ability)
  if (!extra) {
    return description
  }
  if (!description) {
    return extra
  }
  return `${description}\n${extra}`
}
