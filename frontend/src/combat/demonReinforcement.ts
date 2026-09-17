import type { GameSession, Hero } from '../session/types'
import { ARMY_STACK_SLOTS } from '../session/types'
import {
  addHeroStackQty,
  insertHeroArmyStack,
  nextUnitStackId,
} from '../session/accessors'
import type { ReferenceCatalog } from '../town/catalog'
import {
  isAdvancedUnit,
  unitById,
  unitEffectiveTier,
  unitHasTag,
} from '../town/catalog'
import {
  missingPassiveStatKey,
  passiveStatNumber,
  passiveStatSourceValue,
  passiveStatString,
  passiveStatStringList,
  requirePassiveStats,
} from '../town/heroPassiveStats'
import { isHeroClass } from './shadow'
import type { CombatBattle, CombatSide } from './battle'
import { isCreatureArmyUnit } from './siege'

/**
 * Pandemonium demon roster by creature tier (base + Advanced ids).
 * No Tier 2 unit exists — resolved Tier 2 rounds down to Tier 1.
 */
const DEMON_IDS_BY_TIER: Readonly<Record<number, readonly number[]>> = {
  1: [194, 195, 196, 197], // Homunculus / Imp
  3: [204, 205], // Horned Hellion
  4: [206, 207], // Succubus
  5: [210, 211], // Efreti
  6: [216, 217], // Pit Fiend Arch
}

const TIER1_BASE_CHOICES = [194, 196] as const // Homunculus, Imp

export type DemonGainLine = {
  qty: number
  unitName: string
}

export type DemonOpeningStack = {
  id: string
  side: CombatSide
  unitId: number
  qty: number
}

function isDemonHero(catalog: ReferenceCatalog, hero: Hero): boolean {
  return (
    isHeroClass(catalog, hero, 'Warlock') ||
    isHeroClass(catalog, hero, 'Heretic')
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

/** Kill must match every tag named in passive_stats.kill_filter. */
function matchesKillFilter(
  catalog: ReferenceCatalog,
  unitId: number,
  filterNames: string[],
): boolean {
  if (filterNames.length === 0) {
    return false
  }
  const unit = unitById(catalog, unitId)
  for (const name of filterNames) {
    const tagId = tagIdByName(catalog, name)
    if (tagId == null || !unitHasTag(unit, tagId)) {
      return false
    }
  }
  return true
}

function enemyKillParts(
  opening: DemonOpeningStack[],
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  loserSide: CombatSide,
): Array<{ unitId: number; killed: number }> {
  return opening
    .filter((row) => {
      if (row.side !== loserSide || row.qty <= 0) {
        return false
      }
      return isCreatureArmyUnit(unitById(catalog, row.unitId))
    })
    .map((row) => {
      const live = battle.stacks.find((stack) => stack.id === row.id)
      const remaining = live?.qty ?? 0
      return {
        unitId: row.unitId,
        killed: Math.max(0, row.qty - remaining),
      }
    })
    .filter((part) => part.killed > 0)
}

function roundDownToDemonTier(tier: number): number | null {
  const available = Object.keys(DEMON_IDS_BY_TIER)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b)
  let best: number | null = null
  for (const n of available) {
    if (n <= tier) {
      best = n
    }
  }
  return best
}

function firstOpenArmySlot(hero: Hero): number | null {
  const slots = [...hero.army.slots_1_to_6]
  while (slots.length < ARMY_STACK_SLOTS) {
    slots.push(null)
  }
  const index = slots.findIndex((id) => id == null || id === '')
  return index >= 0 ? index : null
}

function matchingArmyStackId(
  session: GameSession,
  hero: Hero,
  unitId: number,
): string | null {
  for (const id of hero.army.slots_1_to_6) {
    if (!id) {
      continue
    }
    const row = session.units.find((unit) => unit.id === id)
    if (row && row.unit_id === unitId && row.qty > 0) {
      return id
    }
  }
  return null
}

/** Existing army unit ids that belong to this demon tier (slot order). */
function existingDemonUnitIds(
  session: GameSession,
  hero: Hero,
  tier: number,
): number[] {
  const pool = new Set(DEMON_IDS_BY_TIER[tier] ?? [])
  const out: number[] = []
  for (const id of hero.army.slots_1_to_6) {
    if (!id) {
      continue
    }
    const row = session.units.find((unit) => unit.id === id)
    if (row && row.qty > 0 && pool.has(row.unit_id)) {
      out.push(row.unit_id)
    }
  }
  return out
}

function pickNewDemonUnitId(
  catalog: ReferenceCatalog,
  tier: number,
  random: () => number,
): number | null {
  const pool = DEMON_IDS_BY_TIER[tier] ?? []
  if (tier === 1) {
    const choices = TIER1_BASE_CHOICES.filter((id) => unitById(catalog, id))
    if (choices.length > 0) {
      const index = Math.floor(random() * choices.length) % choices.length
      return choices[index] ?? null
    }
  }
  const rows = pool
    .map((id) => unitById(catalog, id))
    .filter((row): row is NonNullable<typeof row> => row != null)
  const base = rows.find((row) => !isAdvancedUnit(row))
  return (base ?? rows[0])?.id ?? null
}

/**
 * Reinforce existing stack, else open army slot, else discard (BR S6-1 order).
 */
function placeDemonQty(
  session: GameSession,
  hero: Hero,
  unitId: number,
  qty: number,
  catalog: ReferenceCatalog,
): { session: GameSession; gained: number; unitName: string } {
  const name = unitById(catalog, unitId)?.name ?? 'Demon'
  if (qty <= 0) {
    return { session, gained: 0, unitName: name }
  }
  const match = matchingArmyStackId(session, hero, unitId)
  if (match) {
    return {
      session: addHeroStackQty(session, match, qty),
      gained: qty,
      unitName: name,
    }
  }
  const liveHero = session.heroes.find((row) => row.id === hero.id) ?? hero
  const slot = firstOpenArmySlot(liveHero)
  if (slot == null) {
    return { session, gained: 0, unitName: name }
  }
  return {
    session: insertHeroArmyStack(session, hero.id, slot, {
      id: nextUnitStackId(session),
      unitId,
      qty,
    }),
    gained: qty,
    unitName: name,
  }
}

/**
 * Warlock / Heretic post-battle passive: convert Humanoid+Living enemy kills
 * into flat-INT demon reinforcements, tier-capped by intel and toughest foe.
 */
export function applyDemonReinforcement(
  session: GameSession,
  catalog: ReferenceCatalog,
  hero: Hero,
  battle: CombatBattle,
  opening: DemonOpeningStack[],
  loserSide: CombatSide,
  random: () => number = Math.random,
): { session: GameSession; gains: DemonGainLine[] } {
  if (!isDemonHero(catalog, hero)) {
    return { session, gains: [] }
  }
  const stats = requirePassiveStats(catalog, hero, 'demon reinforcement')
  if (!stats) {
    return { session, gains: [] }
  }
  const tierDivisor = passiveStatNumber(stats, 'tier_divisor')
  const qtyStat = passiveStatString(stats, 'qty_stat')
  const killFilter = passiveStatStringList(stats, 'kill_filter')
  if (tierDivisor == null || tierDivisor <= 0) {
    missingPassiveStatKey(catalog, hero, 'tier_divisor', 'demon reinforcement')
    return { session, gains: [] }
  }
  if (!qtyStat) {
    missingPassiveStatKey(catalog, hero, 'qty_stat', 'demon reinforcement')
    return { session, gains: [] }
  }
  if (killFilter.length === 0) {
    missingPassiveStatKey(catalog, hero, 'kill_filter', 'demon reinforcement')
    return { session, gains: [] }
  }
  const kills = enemyKillParts(opening, battle, catalog, loserSide)
  if (kills.length === 0) {
    return { session, gains: [] }
  }
  const qualifying = kills
    .filter((part) => matchesKillFilter(catalog, part.unitId, killFilter))
    .reduce((sum, part) => sum + part.killed, 0)
  if (qualifying < 1) {
    return { session, gains: [] }
  }
  let highestEnemyTier = 0
  for (const part of kills) {
    const unit = unitById(catalog, part.unitId)
    if (!unit) {
      continue
    }
    highestEnemyTier = Math.max(
      highestEnemyTier,
      unitEffectiveTier(catalog, unit),
    )
  }
  // Qty = flat qty_stat. Tier = min(floor(stat/tier_divisor), highest enemy tier).
  const qtyBase = passiveStatSourceValue(catalog, hero, qtyStat)
  const qty = Math.max(0, Math.floor(qtyBase))
  const maxFromIntel = Math.floor(qtyBase / tierDivisor)
  const resolved = Math.min(maxFromIntel, highestEnemyTier)
  const tier = roundDownToDemonTier(resolved)
  if (tier == null || qty <= 0) {
    return { session, gains: [] }
  }
  const liveHero = session.heroes.find((row) => row.id === hero.id)
  if (!liveHero) {
    return { session, gains: [] }
  }
  const existing = existingDemonUnitIds(session, liveHero, tier)
  const unitId =
    existing[0] ?? pickNewDemonUnitId(catalog, tier, random)
  if (unitId == null) {
    return { session, gains: [] }
  }
  const placed = placeDemonQty(session, liveHero, unitId, qty, catalog)
  if (placed.gained <= 0) {
    return { session: placed.session, gains: [] }
  }
  return {
    session: placed.session,
    gains: [{ qty: placed.gained, unitName: placed.unitName }],
  }
}
