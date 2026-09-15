import type { GameSession, Hero } from '../session/types'
import { ARMY_STACK_SLOTS } from '../session/types'
import {
  addHeroStackQty,
  insertHeroArmyStack,
  nextUnitStackId,
} from '../session/accessors'
import type { ReferenceCatalog } from '../town/catalog'
import {
  heroEffectiveStats,
  isAdvancedUnit,
  unitById,
  unitEffectiveTier,
  unitHasTag,
} from '../town/catalog'
import { isHeroClass } from './shadow'
import type { CombatBattle, CombatSide } from './battle'
import { isCreatureArmyUnit } from './siege'

/** unit_tag.id — both required for demon-reinforcement kill credit. */
const HUMANOID_TAG = 2
const LIVING_TAG = 10

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

function isHumanoidLiving(
  catalog: ReferenceCatalog,
  unitId: number,
): boolean {
  const unit = unitById(catalog, unitId)
  return unitHasTag(unit, HUMANOID_TAG) && unitHasTag(unit, LIVING_TAG)
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
  const kills = enemyKillParts(opening, battle, catalog, loserSide)
  if (kills.length === 0) {
    return { session, gains: [] }
  }
  const qualifying = kills
    .filter((part) => isHumanoidLiving(catalog, part.unitId))
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
  const intel = heroEffectiveStats(
    catalog,
    hero.class_id,
    hero.current_level ?? 1,
  ).intel
  // Qty = flat INT. Tier = min(floor(INT/6), highest enemy tier killed), then
  // snap down to a real Pandemonium demon tier (no T2 unit → T2 becomes T1).
  // So INT 12–17 always yields Tier 1; Hellions need INT ≥ 18 (and a T3+ kill).
  const qty = Math.max(0, Math.floor(intel))
  const maxFromIntel = Math.floor(intel / 6)
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
