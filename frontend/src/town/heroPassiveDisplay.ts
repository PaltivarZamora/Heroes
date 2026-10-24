import { isNonLivingFactoryUnit } from '../combat/heroArmyPassives'
import {
  heroClassTownId,
  isUnitOfTownId,
  passiveTownIdFromFilter,
} from '../combat/heroFactionUnits'
import { shamanTotemCount } from '../combat/heroArmyPassives'
import type { Hero, GameSession, UnitStack } from '../session/types'
import type { ReferenceCatalog } from './catalog'
import {
  commandingHeroStats,
  heroTypeName,
} from './catalog'
import { hasPassiveKey, PASSIVE_KEY } from './heroPassiveKey'
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

function countFactionStacks(
  catalog: ReferenceCatalog,
  hero: Hero,
  stacks: UnitStack[],
  filter?: unknown,
): number {
  const townId = passiveTownIdFromFilter(catalog, hero, filter)
  return countStacks(stacks, (id) => isUnitOfTownId(catalog, id, townId))
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
  const { intel } = commandingHeroStats(catalog, hero)
  const lines: string[] = []

  if (hasPassiveKey(catalog, hero, PASSIVE_KEY.DRUID_MANA)) {
    const stats = heroPassiveStats(catalog, hero)
    const mana = passiveStatNumber(stats, 'mana_per_attack') ?? 1
    lines.push(
      `+${mana} Mana when a Grove stack attacks (capped at max)`,
    )
  }
  if (hasPassiveKey(catalog, hero, PASSIVE_KEY.RANGER_SURPRISE)) {
    const stats = heroPassiveStats(catalog, hero)
    const grove = countFactionStacks(catalog, hero, stacks, stats?.town_filter)
    const mult = passiveStatNumber(stats, 'stack_multiplier') ?? 5
    const minPct = passiveStatNumber(stats, 'min_pct') ?? 1
    const maxPct = passiveStatNumber(stats, 'max_pct') ?? 90
    const base = passiveStatSourceValue(
      catalog,
      hero,
      passiveStatString(stats, 'stat_source') ?? 'STR',
    )
    const pct = Math.min(maxPct, Math.max(minPct, base + grove * mult))
    const townName =
      catalog.town.find((row) => row.id === heroClassTownId(catalog, hero))
        ?.name ?? 'faction'
    lines.push(
      `Surprise Attack: ${formatPct(pct)}% (${grove} ${townName} stack${grove === 1 ? '' : 's'})`,
    )
  }
  if (hasPassiveKey(catalog, hero, PASSIVE_KEY.BARBARIAN_ARMY_PHYS)) {
    const stats = heroPassiveStats(catalog, hero)
    const fortress = countFactionStacks(
      catalog,
      hero,
      stacks,
      stats?.town_filter,
    )
    const mult = passiveStatNumber(stats, 'stack_multiplier') ?? 1
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
  if (hasPassiveKey(catalog, hero, PASSIVE_KEY.FORGE_MASTER_ARMY_PHYS)) {
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
  if (hasPassiveKey(catalog, hero, PASSIVE_KEY.CONJURER_ARMY_MAGIC)) {
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
  if (hasPassiveKey(catalog, hero, PASSIVE_KEY.CLERIC_HEAL)) {
    const stats = heroPassiveStats(catalog, hero)
    const faction = countFactionStacks(
      catalog,
      hero,
      stacks,
      stats?.heal_town_filter,
    )
    const base = passiveStatSourceValue(
      catalog,
      hero,
      passiveStatString(stats, 'heal_stat_source') ?? 'INT',
    )
    const pool = Math.max(0, Math.floor(base * faction))
    const rezPct = passiveStatNumber(stats, 'rez_chance_pct') ?? 1
    const townName =
      catalog.town.find((row) => row.id === heroClassTownId(catalog, hero))
        ?.name ?? 'faction'
    lines.push(
      `End of round: heal pool ${pool} HP (${Math.floor(base)} INT × ${faction} ${townName} stack${faction === 1 ? '' : 's'}); end of battle: ${formatPct(rezPct)}% full ${townName} rez (casualties)`,
    )
  }
  if (hasPassiveKey(catalog, hero, PASSIVE_KEY.PALADIN_ARMY_BONUS)) {
    const stats = heroPassiveStats(catalog, hero)
    const faction = countFactionStacks(catalog, hero, stacks, stats?.town_filter)
    const mult = passiveStatNumber(stats, 'stack_multiplier') ?? 1
    const phys = Math.max(
      0,
      passiveStatSourceValue(
        catalog,
        hero,
        passiveStatString(stats, 'physical_stat_source') ?? 'STR',
      ) +
        faction * mult,
    )
    const mag = Math.max(
      0,
      passiveStatSourceValue(
        catalog,
        hero,
        passiveStatString(stats, 'magic_stat_source') ?? 'INT',
      ) +
        faction * mult,
    )
    const townName =
      catalog.town.find((row) => row.id === heroClassTownId(catalog, hero))
        ?.name ?? 'faction'
    lines.push(
      `Physical +${formatPct(phys)}% / Magic +${formatPct(mag)}% (${faction} ${townName} stack${faction === 1 ? '' : 's'})`,
    )
  }
  if (hasPassiveKey(catalog, hero, PASSIVE_KEY.EVOKER_SPELL_BONUS)) {
    const stats = heroPassiveStats(catalog, hero)
    const count = countFactionStacks(catalog, hero, stacks, stats?.town_filter)
    const base = passiveStatSourceValue(
      catalog,
      hero,
      passiveStatString(stats, 'stat_source') ?? 'INT',
    )
    const op = (passiveStatString(stats, 'stack_operator') ?? 'add')
      .trim()
      .toLowerCase()
    const mult = passiveStatNumber(stats, 'stack_multiplier') ?? 1
    const pct =
      op === 'add'
        ? Math.max(0, base + count * mult)
        : Math.max(0, base * count * mult)
    const townName =
      catalog.town.find((row) => row.id === heroClassTownId(catalog, hero))
        ?.name ?? 'faction'
    lines.push(
      `Spell Damage Bonus: +${formatPct(pct)}% (${count} ${townName} stack${count === 1 ? '' : 's'})`,
    )
  }
  if (hasPassiveKey(catalog, hero, PASSIVE_KEY.SHAMAN_TOTEMS)) {
    const totems = shamanTotemCount(catalog, hero)
    const stats = heroPassiveStats(catalog, hero)
    const div = passiveStatNumber(stats, 'totem_int_divisor') ?? 4
    const spawn = passiveStatNumber(stats, 'totem_spawn_per_round') ?? 1
    const healMult = passiveStatNumber(stats, 'nature_heal_multiplier') ?? 4
    const healBase = passiveStatSourceValue(
      catalog,
      hero,
      passiveStatString(stats, 'nature_heal_stat_source') ?? 'INT',
    )
    lines.push(
      `Totems: all ${totems} behind army at battle start; +${spawn}/round if below max (INT ${intel}, floor(INT/${div}) min ${passiveStatNumber(stats, 'totem_min') ?? 1})`,
    )
    lines.push(
      `Nature heal: ${Math.max(0, Math.floor(healBase * healMult))} (INT × ${healMult}) to most injured`,
    )
  }
  if (
    hasPassiveKey(catalog, hero, PASSIVE_KEY.HERETIC_DEMON_REINFORCEMENT) ||
    hasPassiveKey(catalog, hero, PASSIVE_KEY.WARLOCK_DEMON_REINFORCEMENT)
  ) {
    const stats = heroPassiveStats(catalog, hero)
    const div = passiveStatNumber(stats, 'tier_divisor')
    if (div != null) {
      lines.push(
        `Demon max tier: floor(INT/${div})=${Math.floor(intel / div)}`,
      )
    }
  }
  if (hasPassiveKey(catalog, hero, PASSIVE_KEY.DEATH_KNIGHT_SHADOW)) {
    const stats = heroPassiveStats(catalog, hero)
    const pctPer = passiveStatNumber(stats, 'pct_per_point') ?? 2
    const maxPct = passiveStatNumber(stats, 'max_reduction_pct') ?? 75
    const base = passiveStatSourceValue(
      catalog,
      hero,
      passiveStatString(stats, 'stat_source') ?? 'STR',
    )
    const reduction = Math.min((base * pctPer) / 100, maxPct / 100)
    const dmgMult = passiveStatNumber(stats, 'dmg_multiplier_pct') ?? 1
    const dmgBase = passiveStatSourceValue(
      catalog,
      hero,
      passiveStatString(stats, 'dmg_stat_source') ??
        passiveStatString(stats, 'stat_source') ??
        'STR',
    )
    const physBonus = Math.max(0, dmgBase * dmgMult)
    lines.push(
      `Shadow step cost ×${formatPct((1 - reduction) * 100)}% (${formatPct(reduction * 100)}% reduction)`,
    )
    lines.push(
      `On Shadow: +${formatPct(physBonus)}% Physical dmg (Ground)`,
    )
  }
  if (hasPassiveKey(catalog, hero, PASSIVE_KEY.KNIGHT_DOUBLE_RETALIATION)) {
    const stats = heroPassiveStats(catalog, hero)
    const mult = passiveStatNumber(stats, 'stat_multiplier') ?? 2.5
    const base = passiveStatSourceValue(
      catalog,
      hero,
      passiveStatString(stats, 'stat_source') ?? 'STR',
    )
    const chance = Math.max(0, base * mult)
    lines.push(`Retaliate twice: ${formatPct(chance)}% (STR × ${mult})`)
  }
  if (hasPassiveKey(catalog, hero, PASSIVE_KEY.MONK_REFLECT_RETALIATION)) {
    const stats = heroPassiveStats(catalog, hero)
    const mult = passiveStatNumber(stats, 'stat_multiplier') ?? 2.5
    const base = passiveStatSourceValue(
      catalog,
      hero,
      passiveStatString(stats, 'stat_source') ?? 'STR',
    )
    const chance = Math.max(0, base * mult)
    lines.push(`Reflect retaliation: ${formatPct(chance)}% (STR × ${mult})`)
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
