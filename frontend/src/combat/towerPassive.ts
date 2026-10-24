import type { Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import { heroPoolRegenProfile } from '../items/heroRegen'
import {
  ENERGY_RESOURCE_ID,
  MANA_RESOURCE_ID,
} from './abilityStatMath'
import type { CombatStack } from './battle'
import { poolMax } from './heroCast'
import { isUnitOfHeroFaction } from './heroFactionUnits'
import { hasPassiveKey, PASSIVE_KEY } from '../town/heroPassiveKey'

export function heroFactionUnitGetsPassives(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  stack: CombatStack | null | undefined,
): boolean {
  return (
    stack != null &&
    hero != null &&
    isUnitOfHeroFaction(catalog, hero, stack.unitId)
  )
}

export function isWizardHero(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): boolean {
  return hasPassiveKey(catalog, hero, PASSIVE_KEY.WIZARD_MANA)
}

export function isSorcererHero(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): boolean {
  return hasPassiveKey(catalog, hero, PASSIVE_KEY.SORCERER_MANA)
}

/** +amount mana, capped at the Hero's max mana pool. */
export function grantHeroMana(
  catalog: ReferenceCatalog,
  hero: Hero,
  amount: number,
): Hero {
  if (amount <= 0) {
    return hero
  }
  const max = poolMax(catalog, hero, MANA_RESOURCE_ID)
  const next = Math.min(max, hero.current_mana + amount)
  if (next === hero.current_mana) {
    return hero
  }
  return { ...hero, current_mana: next }
}

/** Sorcerer: +1 to the emptier pool (% of max); tie → Mana. */
export function grantSorcererMagicHitPool(
  catalog: ReferenceCatalog,
  hero: Hero,
): { hero: Hero; label: string } | null {
  const profile = heroPoolRegenProfile(catalog, hero)
  const manaMax = poolMax(catalog, hero, MANA_RESOURCE_ID)
  const energyMax = poolMax(catalog, hero, ENERGY_RESOURCE_ID)
  const hasMana = profile.mana && manaMax > 0
  const hasEnergy = profile.energy && energyMax > 0
  if (!hasMana && !hasEnergy) {
    return null
  }
  if (hasMana && !hasEnergy) {
    const next = grantHeroMana(catalog, hero, 1)
    if (next.current_mana === hero.current_mana) {
      return null
    }
    return {
      hero: next,
      label: `Sorcerer: +1 Mana (${next.current_mana}/${manaMax}).`,
    }
  }
  if (hasEnergy && !hasMana) {
    const next = Math.min(energyMax, hero.current_energy + 1)
    if (next === hero.current_energy) {
      return null
    }
    const updated = { ...hero, current_energy: next }
    return {
      hero: updated,
      label: `Sorcerer: +1 Energy (${updated.current_energy}/${energyMax}).`,
    }
  }
  const manaPct = manaMax > 0 ? hero.current_mana / manaMax : 1
  const energyPct = energyMax > 0 ? hero.current_energy / energyMax : 1
  if (energyPct < manaPct) {
    const next = Math.min(energyMax, hero.current_energy + 1)
    if (next === hero.current_energy) {
      return null
    }
    const updated = { ...hero, current_energy: next }
    return {
      hero: updated,
      label: `Sorcerer: +1 Energy (${updated.current_energy}/${energyMax}).`,
    }
  }
  const gained = grantHeroMana(catalog, hero, 1)
  if (gained.current_mana === hero.current_mana) {
    return null
  }
  return {
    hero: gained,
    label: `Sorcerer: +1 Mana (${gained.current_mana}/${manaMax}).`,
  }
}
