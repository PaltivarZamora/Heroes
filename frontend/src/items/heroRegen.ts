import type { GameSession, Hero } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import {
  heroResourcePools,
  regenHybrid,
  regenPure,
} from '../town/catalog'
import { classDisciplines } from '../town/libraryRules'
import { disciplineResourceId } from '../combat/heroCast'
import {
  ENERGY_RESOURCE_ID,
  MANA_RESOURCE_ID,
} from '../combat/abilityStatMath'
import { equippedItemBonuses } from './bonuses'

const warnedMissingConfig = new Set<string>()

function warnMissingAppConfig(key: string): void {
  if (warnedMissingConfig.has(key)) {
    return
  }
  warnedMissingConfig.add(key)
  console.warn(`[app_config] Missing ${key}; using default for daily regen.`)
}

function appConfigRegenValue(
  catalog: ReferenceCatalog,
  key: 'regen_pure' | 'regen_hybrid',
  fallback: number,
): number {
  const row = catalog.app_config.find((entry) => entry.key === key)
  if (!row || row.value == null || String(row.value).trim() === '') {
    warnMissingAppConfig(key)
    return fallback
  }
  const n = Number(row.value)
  if (!Number.isFinite(n)) {
    warnMissingAppConfig(key)
    return fallback
  }
  return Math.max(0, Math.floor(n))
}

export type HeroPoolRegenProfile = {
  mana: boolean
  energy: boolean
}

/**
 * Which Mana/Energy pools this hero uses — same discipline → resource mapping as
 * Hero screen / combat ability bars (`classDisciplines` + `disciplineResourceId`).
 */
export function heroPoolRegenProfile(
  catalog: ReferenceCatalog,
  hero: Hero,
): HeroPoolRegenProfile {
  if (hero.class_id == null) {
    return { mana: false, energy: false }
  }
  const disciplines = classDisciplines(catalog, hero.class_id)
  let energy = false
  let mana = false
  for (const row of disciplines) {
    const resourceId = disciplineResourceId(catalog, row.id)
    if (resourceId === ENERGY_RESOURCE_ID) {
      energy = true
    }
    if (resourceId === MANA_RESOURCE_ID) {
      mana = true
    }
  }
  return { mana, energy }
}

export type DailyPoolRegen = {
  mana: number
  energy: number
}

/** Class base only (no items). */
export function heroDailyRegenBase(
  catalog: ReferenceCatalog,
  hero: Hero,
): DailyPoolRegen {
  const profile = heroPoolRegenProfile(catalog, hero)
  const pure = appConfigRegenValue(catalog, 'regen_pure', regenPure(catalog))
  const hybrid = appConfigRegenValue(catalog, 'regen_hybrid', regenHybrid(catalog))
  const poolCount = (profile.mana ? 1 : 0) + (profile.energy ? 1 : 0)
  if (poolCount >= 2) {
    return {
      mana: profile.mana ? hybrid : 0,
      energy: profile.energy ? hybrid : 0,
    }
  }
  return {
    mana: profile.mana ? pure : 0,
    energy: profile.energy ? pure : 0,
  }
}

export function heroDailyRegenFromItems(
  catalog: ReferenceCatalog,
  hero: Hero,
): DailyPoolRegen {
  const profile = heroPoolRegenProfile(catalog, hero)
  const items = equippedItemBonuses(catalog, hero)
  return {
    mana: profile.mana ? items.manaRegen : 0,
    energy: profile.energy ? items.energyRegen : 0,
  }
}

export function heroDailyRegenEffective(
  catalog: ReferenceCatalog,
  hero: Hero,
): DailyPoolRegen {
  const base = heroDailyRegenBase(catalog, hero)
  const fromItems = heroDailyRegenFromItems(catalog, hero)
  return {
    mana: base.mana + fromItems.mana,
    energy: base.energy + fromItems.energy,
  }
}

/** Apply daily Mana/Energy regen for every hero (cap at pool max). */
export function applyDailyHeroPoolRegen(
  session: GameSession,
  catalog: ReferenceCatalog,
): GameSession {
  let changed = false
  const heroes = session.heroes.map((hero) => {
    const pools = heroResourcePools(catalog, hero)
    const profile = heroPoolRegenProfile(catalog, hero)
    const regen = heroDailyRegenEffective(catalog, hero)
    let current_mana = hero.current_mana
    let current_energy = hero.current_energy
    if (profile.mana && pools.current_mana > 0 && regen.mana > 0) {
      const next = Math.min(pools.current_mana, current_mana + regen.mana)
      if (next !== current_mana) {
        current_mana = next
        changed = true
      }
    }
    if (profile.energy && pools.current_energy > 0 && regen.energy > 0) {
      const next = Math.min(pools.current_energy, current_energy + regen.energy)
      if (next !== current_energy) {
        current_energy = next
        changed = true
      }
    }
    if (
      current_mana === hero.current_mana &&
      current_energy === hero.current_energy
    ) {
      return hero
    }
    return { ...hero, current_mana, current_energy }
  })
  return changed ? { ...session, heroes } : session
}
