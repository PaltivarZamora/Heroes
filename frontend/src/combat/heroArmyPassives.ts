import type { Hero } from '../session/types'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import { heroEffectiveStats, unitById, unitHasTag } from '../town/catalog'
import {
  missingPassiveStatKey,
  passiveStatNumber,
  passiveStatSourceValue,
  passiveStatString,
  requirePassiveStats,
} from '../town/heroPassiveStats'
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
  | 'temple'

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

export function isTempleUnit(
  catalog: ReferenceCatalog,
  unitId: number,
): boolean {
  return unitOfTown(catalog, unitId, 'Temple')
}

export function isNonLivingFactoryUnit(
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

/** Match unit_filter like "Non-Living Factory" (tag + town). */
function matchesUnitFilter(
  catalog: ReferenceCatalog,
  unitId: number,
  filter: string | null,
): boolean {
  if (!filter) {
    return false
  }
  const lower = filter.trim().toLowerCase()
  if (lower === 'non-living factory') {
    return isNonLivingFactoryUnit(catalog, unitId)
  }
  return unitOfTown(catalog, unitId, filter)
}

function townCountKeyForFilter(filter: string | null): ArmyTownCountKey | null {
  if (!filter) {
    return null
  }
  const lower = filter.trim().toLowerCase()
  if (lower === 'grove') {
    return 'grove'
  }
  if (lower === 'fortress') {
    return 'fortress'
  }
  if (lower === 'confluence') {
    return 'confluence'
  }
  if (lower === 'temple') {
    return 'temple'
  }
  if (lower === 'non-living factory') {
    return 'factory_nonliving'
  }
  return null
}

/** Count matching army stacks (slots), not summed headcount within stacks. */
function countMatchingStacks(
  stacks: CombatStack[],
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
    total += 1
  }
  return total
}

/** Snapshot town/tag stack counts for S6-46 army passives — frozen at battle start. */
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
    { key: 'temple', match: (id) => isTempleUnit(catalog, id) },
  ]
  for (const { key, match } of keys) {
    const per: Partial<Record<CombatSide, number>> = {}
    for (const side of sides) {
      per[side] = countMatchingStacks(stacks, side, match)
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

/**
 * Bake army-wide / tag-scoped passive % onto stacks at battle start.
 * Tunables from hero_type.passive_stats (BR S7-2).
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

    if (isHeroClass(catalog, hero, 'Barbarian')) {
      const stats = requirePassiveStats(catalog, hero, 'Barbarian army passive')
      const stackMult = passiveStatNumber(stats, 'stack_multiplier')
      const townFilter = passiveStatString(stats, 'town_filter')
      const statSource = passiveStatString(stats, 'stat_source')
      if (stackMult == null) {
        missingPassiveStatKey(catalog, hero, 'stack_multiplier', 'Barbarian')
      } else {
        const countKey = townCountKeyForFilter(townFilter) ?? 'fortress'
        const stacksN = frozenTownCount(townCounts, countKey, stack.side)
        const base = passiveStatSourceValue(catalog, hero, statSource ?? 'STR')
        const phys = Math.max(0, base + stacksN * stackMult)
        if (phys > 0) {
          next = {
            ...next,
            outputMods: addOutput(next.outputMods, phys, 0),
          }
        }
      }
    }

    if (isHeroClass(catalog, hero, 'Forge Master')) {
      const stats = requirePassiveStats(catalog, hero, 'Forge Master passive')
      const stackMult = passiveStatNumber(stats, 'stack_multiplier')
      const unitFilter = passiveStatString(stats, 'unit_filter')
      const statSource = passiveStatString(stats, 'stat_source')
      if (stackMult == null) {
        missingPassiveStatKey(catalog, hero, 'stack_multiplier', 'Forge Master')
      } else if (matchesUnitFilter(catalog, stack.unitId, unitFilter)) {
        const count = frozenTownCount(
          townCounts,
          'factory_nonliving',
          stack.side,
        )
        const base = passiveStatSourceValue(catalog, hero, statSource ?? 'STR')
        const phys = Math.max(0, base + count * stackMult)
        if (phys > 0) {
          next = {
            ...next,
            outputMods: addOutput(next.outputMods, phys, 0),
          }
        }
      }
    }

    if (isHeroClass(catalog, hero, 'Conjurer')) {
      const stats = requirePassiveStats(catalog, hero, 'Conjurer passive')
      const stackMult = passiveStatNumber(stats, 'stack_multiplier')
      const unitFilter = passiveStatString(stats, 'unit_filter')
      const statSource = passiveStatString(stats, 'stat_source')
      if (stackMult == null) {
        missingPassiveStatKey(catalog, hero, 'stack_multiplier', 'Conjurer')
      } else if (matchesUnitFilter(catalog, stack.unitId, unitFilter)) {
        const count = frozenTownCount(
          townCounts,
          'factory_nonliving',
          stack.side,
        )
        const base = passiveStatSourceValue(catalog, hero, statSource ?? 'INT')
        const mag = Math.max(0, base + count * stackMult)
        if (mag > 0) {
          next = {
            ...next,
            outputMods: addOutput(next.outputMods, 0, mag),
          }
        }
      }
    }

    if (isHeroClass(catalog, hero, 'Paladin')) {
      const stats = requirePassiveStats(catalog, hero, 'Paladin passive')
      const stackMult = passiveStatNumber(stats, 'stack_multiplier')
      const townFilter = passiveStatString(stats, 'town_filter')
      const physSource = passiveStatString(stats, 'physical_stat_source')
      const magSource = passiveStatString(stats, 'magic_stat_source')
      if (stackMult == null) {
        missingPassiveStatKey(catalog, hero, 'stack_multiplier', 'Paladin')
      } else if (
        matchesUnitFilter(catalog, stack.unitId, townFilter ?? 'Temple')
      ) {
        const countKey = townCountKeyForFilter(townFilter) ?? 'temple'
        const temple = frozenTownCount(townCounts, countKey, stack.side)
        const phys = Math.max(
          0,
          passiveStatSourceValue(catalog, hero, physSource ?? 'STR') +
            temple * stackMult,
        )
        const mag = Math.max(
          0,
          passiveStatSourceValue(catalog, hero, magSource ?? 'INT') +
            temple * stackMult,
        )
        if (phys > 0 || mag > 0) {
          next = {
            ...next,
            outputMods: addOutput(next.outputMods, phys, mag),
          }
        }
      }
    }

    return next
  })
}

/** Ranger: chance% from passive_stats (stat + stacks×mult, min/max clamped). */
export function rangerSuppressChancePct(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  battle: CombatBattle,
  side: CombatSide,
): number {
  if (!isHeroClass(catalog, hero, 'Ranger') || !hero) {
    return 0
  }
  const stats = requirePassiveStats(catalog, hero, 'Ranger passive')
  if (!stats) {
    return 0
  }
  const stackMult = passiveStatNumber(stats, 'stack_multiplier')
  const minPct = passiveStatNumber(stats, 'min_pct')
  const maxPct = passiveStatNumber(stats, 'max_pct')
  const townFilter = passiveStatString(stats, 'town_filter')
  const statSource = passiveStatString(stats, 'stat_source')
  if (stackMult == null || minPct == null || maxPct == null) {
    if (stackMult == null) {
      missingPassiveStatKey(catalog, hero, 'stack_multiplier', 'Ranger')
    }
    if (minPct == null) {
      missingPassiveStatKey(catalog, hero, 'min_pct', 'Ranger')
    }
    if (maxPct == null) {
      missingPassiveStatKey(catalog, hero, 'max_pct', 'Ranger')
    }
    return 0
  }
  const countKey = townCountKeyForFilter(townFilter) ?? 'grove'
  const grove = frozenTownCount(battle.armyTownCounts, countKey, side)
  const base = passiveStatSourceValue(catalog, hero, statSource ?? 'STR')
  const raw = base + grove * stackMult
  return Math.min(maxPct, Math.max(minPct, raw))
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

export function isDruidHero(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): boolean {
  return isHeroClass(catalog, hero, 'Druid')
}

/** Rogue energy gain amount from passive_stats.energy_per_trigger. */
export function rogueEnergyPerTrigger(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): number {
  if (!hero || !isRogueHero(catalog, hero)) {
    return 0
  }
  const stats = requirePassiveStats(catalog, hero, 'Rogue energy')
  const n = passiveStatNumber(stats, 'energy_per_trigger')
  if (n == null) {
    missingPassiveStatKey(catalog, hero, 'energy_per_trigger', 'Rogue energy')
    return 0
  }
  return Math.max(0, n)
}

/** Wizard/Sorcerer/Druid mana gain from passive_stats.mana_per_attack. */
export function passiveManaPerAttack(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  context: string,
): number {
  if (!hero) {
    return 0
  }
  const stats = requirePassiveStats(catalog, hero, context)
  const n = passiveStatNumber(stats, 'mana_per_attack')
  if (n == null) {
    missingPassiveStatKey(catalog, hero, 'mana_per_attack', context)
    return 0
  }
  return Math.max(0, n)
}

/**
 * Evoker: (stat × confluence stacks × stack_multiplier)% on hero spell damage.
 */
export function applyEvokerSpellBonus(
  raw: number,
  catalog: ReferenceCatalog,
  caster: Hero,
  casterSide: CombatSide,
  battle: CombatBattle,
): number {
  if (raw <= 0 || !isHeroClass(catalog, caster, 'Evoker')) {
    return raw
  }
  const stats = requirePassiveStats(catalog, caster, 'Evoker spell bonus')
  if (!stats) {
    return raw
  }
  const stackMult = passiveStatNumber(stats, 'stack_multiplier')
  const townFilter = passiveStatString(stats, 'town_filter')
  const statSource = passiveStatString(stats, 'stat_source')
  if (stackMult == null) {
    missingPassiveStatKey(catalog, caster, 'stack_multiplier', 'Evoker')
    return raw
  }
  const countKey = townCountKeyForFilter(townFilter) ?? 'confluence'
  const count = frozenTownCount(battle.armyTownCounts, countKey, casterSide)
  const base = passiveStatSourceValue(catalog, caster, statSource ?? 'INT')
  const pct = Math.max(0, base * count * stackMult)
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

/** Target totem count from passive_stats (floor(INT/divisor), min totem_min). */
export function shamanTotemCount(
  catalog: ReferenceCatalog,
  hero: Hero,
): number {
  const stats = requirePassiveStats(catalog, hero, 'Shaman totems')
  const divisor = passiveStatNumber(stats, 'totem_int_divisor')
  const minTotems = passiveStatNumber(stats, 'totem_min')
  if (divisor == null || divisor <= 0) {
    missingPassiveStatKey(catalog, hero, 'totem_int_divisor', 'Shaman totems')
    return 0
  }
  if (minTotems == null) {
    missingPassiveStatKey(catalog, hero, 'totem_min', 'Shaman totems')
    return 0
  }
  const intel = heroEffectiveStats(
    catalog,
    hero.class_id,
    hero.current_level ?? 1,
  ).intel
  return Math.max(minTotems, Math.floor(intel / divisor))
}

/** Living Fire/Lightning Totem stacks on this side (Shaman summons). */
export function isShamanTotemStack(
  catalog: ReferenceCatalog,
  stack: { unitId: number; qty: number },
): boolean {
  if (stack.qty <= 0) {
    return false
  }
  const name = unitById(catalog, stack.unitId)?.name ?? ''
  return name === 'Fire Totem' || name === 'Lightning Totem'
}
