import {
  citadelHumanoidChancePct,
  HUMANOID_TAG,
} from '../combat/armyTags'
import {
  isConfluenceUnit,
  isFortressUnit,
  isGroveUnit,
  isNonLivingFactoryUnit,
  isTempleUnit,
  shamanTotemCount,
} from '../combat/heroArmyPassives'
import { isHeroClass } from '../combat/shadow'
import type { Hero, GameSession, UnitStack } from '../session/types'
import type { ReferenceCatalog } from './catalog'
import {
  commandingHeroStats,
  heroTypeName,
  unitById,
  unitHasTag,
} from './catalog'
import {
  heroPassiveStats,
  passiveStatNumber,
  passiveStatSourceValue,
  passiveStatString,
} from './heroPassiveStats'

/** `hero_type.passive_ability.display` for this hero's class. */
export function heroPassiveDisplay(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): string {
  if (!hero?.class_id) {
    return ''
  }
  const row = catalog.hero_type.find((entry) => entry.id === hero.class_id)
  const display = row?.passive_ability?.display
  return typeof display === 'string' ? display.trim() : ''
}

/** Ability panel header: "Druid — (INT × …)" */
export function heroAbilitiesHeader(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): string {
  const typeName = heroTypeName(catalog, hero?.class_id ?? null)
  const display = heroPassiveDisplay(catalog, hero)
  if (typeName && display) {
    return `${typeName} — ${display}`
  }
  if (typeName) {
    return `${typeName} Abilities`
  }
  return display || 'Abilities'
}

function armyUnitStacks(
  session: GameSession,
  hero: Hero,
): UnitStack[] {
  const out: UnitStack[] = []
  for (const id of hero.army.slots_1_to_6) {
    if (!id) {
      continue
    }
    const stack = session.units.find((row) => row.id === id)
    if (stack && stack.qty > 0) {
      out.push(stack)
    }
  }
  return out
}

/** Evoker-style: count matching army stacks (slots), never summed headcount. */
function countStacks(
  stacks: UnitStack[],
  match: (unitId: number) => boolean,
): number {
  let n = 0
  for (const stack of stacks) {
    if (match(stack.unit_id)) {
      n += 1
    }
  }
  return n
}

function countHumanoidHeadcount(
  stacks: UnitStack[],
  catalog: ReferenceCatalog,
): number {
  let n = 0
  for (const stack of stacks) {
    if (unitHasTag(unitById(catalog, stack.unit_id), HUMANOID_TAG)) {
      n += stack.qty
    }
  }
  return n
}

/**
 * Live computed army-scaled passive lines when the hero has a known army.
 * Returns [] when composition is unknown or the passive is not army-scaled.
 */
export function heroPassiveLiveLines(
  catalog: ReferenceCatalog,
  hero: Hero,
  session: GameSession | null | undefined,
): string[] {
  if (!session) {
    return []
  }
  const stacks = armyUnitStacks(session, hero)
  if (stacks.length === 0 && !hero.army.slots_1_to_6.some(Boolean)) {
    // Empty army is still "knowable" — show 0-stack values for scaled passives.
  }
  const { intel } = commandingHeroStats(catalog, hero)
  const lines: string[] = []

  if (isHeroClass(catalog, hero, 'Druid')) {
    const stats = heroPassiveStats(catalog, hero)
    const mana = passiveStatNumber(stats, 'mana_per_attack') ?? 1
    lines.push(
      `+${mana} Mana when a Grove stack attacks (capped at max)`,
    )
  }
  if (isHeroClass(catalog, hero, 'Ranger')) {
    const stats = heroPassiveStats(catalog, hero)
    const grove = countStacks(stacks, (id) => isGroveUnit(catalog, id))
    const mult = passiveStatNumber(stats, 'stack_multiplier') ?? 3
    const minPct = passiveStatNumber(stats, 'min_pct') ?? 1
    const maxPct = passiveStatNumber(stats, 'max_pct') ?? 90
    const base = passiveStatSourceValue(
      catalog,
      hero,
      passiveStatString(stats, 'stat_source') ?? 'STR',
    )
    const pct = Math.min(maxPct, Math.max(minPct, base + grove * mult))
    lines.push(
      `Surprise Attack: ${formatPct(pct)}% (${grove} Grove stack${grove === 1 ? '' : 's'})`,
    )
  }
  if (isHeroClass(catalog, hero, 'Barbarian')) {
    const stats = heroPassiveStats(catalog, hero)
    const fortress = countStacks(stacks, (id) =>
      isFortressUnit(catalog, id),
    )
    const mult = passiveStatNumber(stats, 'stack_multiplier') ?? 2
    const base = passiveStatSourceValue(
      catalog,
      hero,
      passiveStatString(stats, 'stat_source') ?? 'STR',
    )
    const phys = Math.max(0, base + fortress * mult)
    lines.push(
      `Physical Bonus: +${formatPct(phys)}% (${fortress} stack${fortress === 1 ? '' : 's'})`,
    )
  }
  if (isHeroClass(catalog, hero, 'Forge Master')) {
    const stats = heroPassiveStats(catalog, hero)
    const count = countStacks(stacks, (id) =>
      isNonLivingFactoryUnit(catalog, id),
    )
    const mult = passiveStatNumber(stats, 'stack_multiplier') ?? 2
    const base = passiveStatSourceValue(
      catalog,
      hero,
      passiveStatString(stats, 'stat_source') ?? 'STR',
    )
    const phys = Math.max(0, base + count * mult)
    lines.push(
      `Physical Bonus (Non-Living): +${formatPct(phys)}% (${count} stack${count === 1 ? '' : 's'})`,
    )
  }
  if (isHeroClass(catalog, hero, 'Conjurer')) {
    const stats = heroPassiveStats(catalog, hero)
    const count = countStacks(stacks, (id) =>
      isNonLivingFactoryUnit(catalog, id),
    )
    const mult = passiveStatNumber(stats, 'stack_multiplier') ?? 2
    const base = passiveStatSourceValue(
      catalog,
      hero,
      passiveStatString(stats, 'stat_source') ?? 'INT',
    )
    const mag = Math.max(0, base + count * mult)
    lines.push(
      `Magic Bonus (Non-Living): +${formatPct(mag)}% (${count} stack${count === 1 ? '' : 's'})`,
    )
  }
  if (isHeroClass(catalog, hero, 'Cleric')) {
    const stats = heroPassiveStats(catalog, hero)
    const temple = countStacks(stacks, (id) => isTempleUnit(catalog, id))
    const base = passiveStatSourceValue(
      catalog,
      hero,
      passiveStatString(stats, 'heal_stat_source') ?? 'INT',
    )
    const pool = Math.max(0, Math.floor(base * temple))
    const rezPct = passiveStatNumber(stats, 'rez_chance_pct') ?? 1
    lines.push(
      `End of battle: ${formatPct(rezPct)}% full Temple rez (casualties); heal pool ${pool} HP (${Math.floor(base)} INT × ${temple} stack${temple === 1 ? '' : 's'})`,
    )
  }
  if (isHeroClass(catalog, hero, 'Paladin')) {
    const stats = heroPassiveStats(catalog, hero)
    const temple = countStacks(stacks, (id) => isTempleUnit(catalog, id))
    const mult = passiveStatNumber(stats, 'stack_multiplier') ?? 1
    const phys = Math.max(
      0,
      passiveStatSourceValue(
        catalog,
        hero,
        passiveStatString(stats, 'physical_stat_source') ?? 'STR',
      ) +
        temple * mult,
    )
    const mag = Math.max(
      0,
      passiveStatSourceValue(
        catalog,
        hero,
        passiveStatString(stats, 'magic_stat_source') ?? 'INT',
      ) +
        temple * mult,
    )
    lines.push(
      `Physical +${formatPct(phys)}% / Magic +${formatPct(mag)}% (${temple} Temple stack${temple === 1 ? '' : 's'})`,
    )
  }
  if (isHeroClass(catalog, hero, 'Evoker')) {
    const stats = heroPassiveStats(catalog, hero)
    const count = countStacks(stacks, (id) =>
      isConfluenceUnit(catalog, id),
    )
    const mult = passiveStatNumber(stats, 'stack_multiplier') ?? 1
    const base = passiveStatSourceValue(
      catalog,
      hero,
      passiveStatString(stats, 'stat_source') ?? 'INT',
    )
    const pct = Math.max(0, base * count * mult)
    lines.push(
      `Spell Damage Bonus: +${formatPct(pct)}% (${count} Confluence stack${count === 1 ? '' : 's'})`,
    )
  }
  if (isHeroClass(catalog, hero, 'Shaman')) {
    const totems = shamanTotemCount(catalog, hero)
    const stats = heroPassiveStats(catalog, hero)
    const div = passiveStatNumber(stats, 'totem_int_divisor') ?? 6
    lines.push(
      `Totems each round: ${totems} (INT ${intel}, floor(INT/${div}) min ${passiveStatNumber(stats, 'totem_min') ?? 1})`,
    )
  }
  if (isHeroClass(catalog, hero, 'Heretic') || isHeroClass(catalog, hero, 'Warlock')) {
    const stats = heroPassiveStats(catalog, hero)
    const div = passiveStatNumber(stats, 'tier_divisor')
    if (div != null) {
      lines.push(
        `Demon max tier: floor(INT/${div})=${Math.floor(intel / div)}`,
      )
    }
  }
  if (isHeroClass(catalog, hero, 'Death Knight')) {
    const stats = heroPassiveStats(catalog, hero)
    const pctPer = passiveStatNumber(stats, 'pct_per_point') ?? 2
    const maxPct = passiveStatNumber(stats, 'max_reduction_pct') ?? 75
    const base = passiveStatSourceValue(
      catalog,
      hero,
      passiveStatString(stats, 'stat_source') ?? 'STR',
    )
    const reduction = Math.min((base * pctPer) / 100, maxPct / 100)
    lines.push(
      `Shadow step cost ×${formatPct((1 - reduction) * 100)}% (${formatPct(reduction * 100)}% reduction)`,
    )
  }
  if (isHeroClass(catalog, hero, 'Knight')) {
    const humanoids = countHumanoidHeadcount(stacks, catalog)
    const chance = citadelHumanoidChancePct(catalog, hero, humanoids)
    lines.push(
      `Bonus Strike Chance: ${formatPct(chance)}% (${humanoids} Humanoid${humanoids === 1 ? '' : 's'})`,
    )
  }
  if (isHeroClass(catalog, hero, 'Monk')) {
    const humanoids = countHumanoidHeadcount(stacks, catalog)
    const chance = citadelHumanoidChancePct(catalog, hero, humanoids)
    lines.push(
      `Suppress Retaliation: ${formatPct(chance)}% (${humanoids} Humanoid${humanoids === 1 ? '' : 's'})`,
    )
  }

  return lines
}

function formatPct(n: number): string {
  if (!Number.isFinite(n)) {
    return '0'
  }
  const rounded = Math.round(n * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}
