import type { Hero } from '../session/types'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import { heroEffectiveStats, unitById, unitHasTag } from '../town/catalog'
import type {
  ArmyTownCounts,
  CombatBattle,
  CombatOutputMods,
  CombatSide,
  CombatStack,
} from './battle'
import { emptyStatFlat, isHeroStack } from './battle'
import { poolMax } from './heroCast'
import { isHeroClass } from './shadow'
import { isCreatureArmyUnit } from './siege'

const ENERGY_RESOURCE_ID = 1

export type ArmyTownCountKey =
  | 'grove'
  | 'fortress'
  | 'confluence'
  | 'factory_nonliving'

function townIdByName(
  catalog: ReferenceCatalog,
  name: string,
): number | null {
  const needle = name.trim().toLowerCase()
  return (
    catalog.town.find((row) => row.name.trim().toLowerCase() === needle)?.id ??
    null
  )
}

function tagIdByName(
  catalog: ReferenceCatalog,
  name: string,
): number | null {
  const needle = name.trim().toLowerCase()
  return (
    catalog.unit_tag.find((row) => row.value.trim().toLowerCase() === needle)
      ?.id ?? null
  )
}

function unitOfTown(
  catalog: ReferenceCatalog,
  unitId: number,
  townName: string,
): boolean {
  const unit = unitById(catalog, unitId)
  if (!unit?.town_id) {
    return false
  }
  const id = townIdByName(catalog, townName)
  return id != null && unit.town_id === id
}

export function isGroveUnit(
  catalog: ReferenceCatalog,
  unitId: number,
): boolean {
  return unitOfTown(catalog, unitId, 'Grove')
}

export function isFortressUnit(
  catalog: ReferenceCatalog,
  unitId: number,
): boolean {
  return unitOfTown(catalog, unitId, 'Fortress')
}

export function isFactoryUnit(
  catalog: ReferenceCatalog,
  unitId: number,
): boolean {
  return unitOfTown(catalog, unitId, 'Factory')
}

export function isConfluenceUnit(
  catalog: ReferenceCatalog,
  unitId: number,
): boolean {
  return unitOfTown(catalog, unitId, 'Confluence')
}

function isNonLivingFactoryUnit(
  catalog: ReferenceCatalog,
  unitId: number,
): boolean {
  if (!isFactoryUnit(catalog, unitId)) {
    return false
  }
  const nonLiving = tagIdByName(catalog, 'Non-Living')
  if (nonLiving == null) {
    return false
  }
  return unitHasTag(unitById(catalog, unitId), nonLiving)
}

function countMatchingUnits(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  side: CombatSide,
  match: (unitId: number) => boolean,
): number {
  let total = 0
  for (const stack of stacks) {
    if (stack.side !== side || stack.qty <= 0 || isHeroStack(stack)) {
      continue
    }
    if (!match(stack.unitId)) {
      continue
    }
    total += stack.qty
  }
  return total
}

/** Snapshot town/tag counts for S6-46 army passives — frozen at battle start. */
export function freezeArmyTownCounts(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
): ArmyTownCounts {
  const sides: CombatSide[] = ['atk', 'def']
  const out: ArmyTownCounts = {}
  const keys: Array<{
    key: ArmyTownCountKey
    match: (unitId: number) => boolean
  }> = [
    { key: 'grove', match: (id) => isGroveUnit(catalog, id) },
    { key: 'fortress', match: (id) => isFortressUnit(catalog, id) },
    { key: 'confluence', match: (id) => isConfluenceUnit(catalog, id) },
    {
      key: 'factory_nonliving',
      match: (id) => isNonLivingFactoryUnit(catalog, id),
    },
  ]
  for (const { key, match } of keys) {
    const per: Partial<Record<CombatSide, number>> = {}
    for (const side of sides) {
      per[side] = countMatchingUnits(stacks, catalog, side, match)
    }
    out[key] = per
  }
  return out
}

export function frozenTownCount(
  counts: ArmyTownCounts | undefined,
  key: ArmyTownCountKey,
  side: CombatSide,
): number {
  return Math.max(0, counts?.[key]?.[side] ?? 0)
}

function emptyOutput(): CombatOutputMods {
  return {
    physicalTotal: 0,
    magicTotal: 0,
    physicalMin: 0,
    magicMin: 0,
    physicalMax: 0,
    magicMax: 0,
  }
}

function addOutput(
  current: CombatOutputMods | undefined,
  physicalTotal: number,
  magicTotal: number,
): CombatOutputMods {
  const next = { ...(current ?? emptyOutput()) }
  next.physicalTotal += physicalTotal
  next.magicTotal += magicTotal
  return next
}

function heroStrIntel(
  catalog: ReferenceCatalog,
  hero: Hero,
): { strength: number; intel: number } {
  const stats = heroEffectiveStats(
    catalog,
    hero.class_id,
    hero.current_level ?? 1,
  )
  return { strength: stats.strength, intel: stats.intel }
}

/**
 * Bake army-wide / tag-scoped passive % onto stacks at battle start
 * (counts frozen; uses opening hero STR/INT).
 */
export function applyBattleStartArmyPassives(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  heroes: { atk?: Hero; def?: Hero },
  townCounts: ArmyTownCounts,
): CombatStack[] {
  return stacks.map((stack) => {
    if (stack.qty <= 0 || isHeroStack(stack) || stack.indestructible) {
      return stack
    }
    if (!isCreatureArmyUnit(unitById(catalog, stack.unitId))) {
      return stack
    }
    const hero = heroes[stack.side]
    if (!hero) {
      return stack
    }
    let next = stack
    const { strength, intel } = heroStrIntel(catalog, hero)

    if (isHeroClass(catalog, hero, 'Druid') && isGroveUnit(catalog, stack.unitId)) {
      const grove = frozenTownCount(townCounts, 'grove', stack.side)
      const pct = Math.max(0, intel * grove)
      if (pct > 0) {
        next = {
          ...next,
          resistancePct: (next.resistancePct ?? 0) + pct,
        }
      }
    }

    if (
      isHeroClass(catalog, hero, 'Barbarian') &&
      isFortressUnit(catalog, stack.unitId)
    ) {
      const fortress = frozenTownCount(townCounts, 'fortress', stack.side)
      const phys = Math.max(0, (strength / 3) * fortress)
      if (phys > 0) {
        next = {
          ...next,
          outputMods: addOutput(next.outputMods, phys, 0),
          defensePct: (next.defensePct ?? 0) - phys / 2,
        }
      }
    }

    if (
      isHeroClass(catalog, hero, 'Forge Master') &&
      isNonLivingFactoryUnit(catalog, stack.unitId)
    ) {
      const count = frozenTownCount(townCounts, 'factory_nonliving', stack.side)
      const phys = Math.max(0, (strength / 5) * count)
      if (phys > 0) {
        next = {
          ...next,
          outputMods: addOutput(next.outputMods, phys, 0),
        }
      }
    }

    if (
      isHeroClass(catalog, hero, 'Conjurer') &&
      isNonLivingFactoryUnit(catalog, stack.unitId)
    ) {
      const count = frozenTownCount(townCounts, 'factory_nonliving', stack.side)
      const mag = Math.max(0, (intel / 5) * count)
      if (mag > 0) {
        next = {
          ...next,
          outputMods: addOutput(next.outputMods, 0, mag),
        }
      }
    }

    return next
  })
}

/** Ranger: (STR/6 × Grove units)% chance Grove attack skips retaliation. */
export function rangerSuppressChancePct(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  battle: CombatBattle,
  side: CombatSide,
): number {
  if (!isHeroClass(catalog, hero, 'Ranger') || !hero) {
    return 0
  }
  const grove = frozenTownCount(battle.armyTownCounts, 'grove', side)
  const { strength } = heroStrIntel(catalog, hero)
  return Math.max(0, (strength / 6) * grove)
}

export function groveUnitGetsPassives(
  catalog: ReferenceCatalog,
  stack: CombatStack | null | undefined,
): boolean {
  return stack != null && isGroveUnit(catalog, stack.unitId)
}

export function fortressUnitGetsPassives(
  catalog: ReferenceCatalog,
  stack: CombatStack | null | undefined,
): boolean {
  return stack != null && isFortressUnit(catalog, stack.unitId)
}

/** +amount Energy, capped at the Hero's max Energy pool. */
export function grantHeroEnergy(
  catalog: ReferenceCatalog,
  hero: Hero,
  amount: number,
): Hero {
  if (amount <= 0) {
    return hero
  }
  const max = poolMax(catalog, hero, ENERGY_RESOURCE_ID)
  const next = Math.min(max, hero.current_energy + amount)
  if (next === hero.current_energy) {
    return hero
  }
  return { ...hero, current_energy: next }
}

export function isRogueHero(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): boolean {
  return isHeroClass(catalog, hero, 'Rogue')
}

function isArcaneDiscipline(
  catalog: ReferenceCatalog,
  disciplineId: number,
): boolean {
  const row = catalog.discipline.find((entry) => entry.id === disciplineId)
  return (row?.name ?? '').trim().toLowerCase() === 'arcane'
}

/**
 * Evoker: (INT × Confluence units)% bonus on the hero's own Arcane spell damage.
 */
export function applyEvokerArcaneSpellBonus(
  raw: number,
  catalog: ReferenceCatalog,
  ability: { discipline_id: number },
  caster: Hero,
  casterSide: CombatSide,
  battle: CombatBattle,
): number {
  if (raw <= 0 || !isHeroClass(catalog, caster, 'Evoker')) {
    return raw
  }
  if (!isArcaneDiscipline(catalog, ability.discipline_id)) {
    return raw
  }
  const count = frozenTownCount(battle.armyTownCounts, 'confluence', casterSide)
  const { intel } = heroStrIntel(catalog, caster)
  const pct = Math.max(0, intel * count)
  if (pct <= 0) {
    return raw
  }
  return Math.max(0, Math.floor((raw * (100 + pct)) / 100))
}

export function totemUnitByName(
  catalog: ReferenceCatalog,
  name: 'Fire Totem' | 'Lightning Totem',
): UnitRow | null {
  const needle = name.toLowerCase()
  return (
    catalog.unit.find((row) => row.name.trim().toLowerCase() === needle) ?? null
  )
}

/** Totem HP override extras from summoning hero INT. */
export function totemSpawnExtras(
  unit: UnitRow,
  intel: number,
): Partial<CombatStack> {
  const hp = Math.max(1, Math.floor(intel))
  const base = Math.max(0, unit.health ?? 0)
  return {
    topHealth: hp,
    startingQty: 1,
    spawnedRound: 0,
    statFlat: {
      ...emptyStatFlat(),
      health: hp - base,
    },
  }
}

export function shamanTotemCount(
  catalog: ReferenceCatalog,
  hero: Hero,
): number {
  const { intel } = heroStrIntel(catalog, hero)
  return Math.max(0, Math.floor(intel / 8))
}
