import { getSelectedMapHeroId } from '../hex/HexMap'
import {
  buildingById,
  buildingGrowth,
  getCachedCatalog,
  heroResourcePools,
  isAdvancedUnit,
  unitEffectiveTier,
  unitHasTag,
  type ReferenceCatalog,
  type UnitRow,
} from '../town/catalog'
import { DEFAULT_AI_ARCH_ID } from '../ai/types'
import { insertHeroArmyStack, nextUnitStackId } from './accessors'
import { startingResources } from './create'
import {
  ARMY_STACK_SLOTS,
  playerIdForSlot,
  type GameSession,
  type Hero,
  type Mob,
  type Player,
  type UnitStack,
} from './types'

export type FixedFightKind =
  | 'pit_fiends'
  | 'raise_demons'
  | 'holy_wrath'
  | 'for_the_hoard'
  | 'fight_yourself'

export type FixedFightOk = {
  session: GameSession
  heroId: string
  mobId: string | null
  defenderHeroId: string | null
  notice: string
}

export type FixedFightResult = FixedFightOk | { error: string }

/** Fortress ladder for Raise Demons (+ Pit Fiends enemy). */
const RAISE_DEMON_ENEMIES: ReadonlyArray<{ unitId: number; qty: number }> = [
  { unitId: 52, qty: 20 }, // Bandit T1
  { unitId: 56, qty: 15 }, // Gypsy T2
  { unitId: 58, qty: 10 }, // Yeti T3
  { unitId: 64, qty: 2 }, // Arsonist T4
  { unitId: 68, qty: 2 }, // Ninja T5
  { unitId: 72, qty: 2 }, // Assassin T6
]

const PIT_FIEND_ARCH_ID = 216
const PIT_FIEND_ARCH_QTY = 3
/** Imp (base + Advanced) → Horned Hellion for Raise Demons debug army. */
const IMP_UNIT_IDS = new Set([196, 197])
const HORNED_HELLION_ID = 204

/** BR S6-41: T1/T3/T3/T4/T5/T5 — skips T2/T6; intentional (data fit). */
const HOARD_TIERS: readonly number[] = [1, 3, 3, 4, 5, 5]
const HOARD_LEVEL = 25

function nextMobId(session: GameSession): string {
  let n = session.mobs.length + 1
  let id = `mob-${n}`
  while (session.mobs.some((row) => row.id === id)) {
    n += 1
    id = `mob-${n}`
  }
  return id
}

function nextHeroId(session: GameSession): string {
  let n = session.heroes.length + 1
  let id = `hero-${n}`
  while (session.heroes.some((row) => row.id === id)) {
    n += 1
    id = `hero-${n}`
  }
  return id
}

function clearHeroArmy(session: GameSession, heroId: string): GameSession {
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero) {
    return session
  }
  const drop = new Set(
    hero.army.slots_1_to_6.filter((id): id is string => id != null),
  )
  return {
    ...session,
    units: session.units.filter((row) => !drop.has(row.id)),
    heroes: session.heroes.map((row) =>
      row.id === heroId
        ? {
            ...row,
            army: {
              ...row.army,
              slots_1_to_6: Array.from(
                { length: ARMY_STACK_SLOTS },
                () => null,
              ),
            },
          }
        : row,
    ),
  }
}

/** Swap Imp stacks on this hero to Horned Hellions (204), keeping qty. */
function replaceHeroImpsWithHornedHellions(
  session: GameSession,
  heroId: string,
): GameSession {
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero) {
    return session
  }
  const heroStackIds = new Set(
    hero.army.slots_1_to_6.filter((id): id is string => id != null),
  )
  return {
    ...session,
    units: session.units.map((row) =>
      heroStackIds.has(row.id) && IMP_UNIT_IDS.has(row.unit_id)
        ? { ...row, unit_id: HORNED_HELLION_ID }
        : row,
    ),
  }
}

function spawnFixedMob(
  session: GameSession,
  position: { q: number; r: number },
  parts: ReadonlyArray<{ unitId: number; qty: number }>,
): { session: GameSession; mobId: string } | null {
  const mobId = nextMobId(session)
  const slots: Array<string | null> = Array.from(
    { length: ARMY_STACK_SLOTS },
    () => null,
  )
  let next = session
  let slot = 0
  for (const part of parts) {
    if (slot >= ARMY_STACK_SLOTS || part.qty <= 0) {
      continue
    }
    const id = nextUnitStackId(next)
    const stack: UnitStack = {
      id,
      unit_id: part.unitId,
      qty: part.qty,
      town_id: null,
      hero_id: null,
      mob_id: mobId,
    }
    next = { ...next, units: [...next.units, stack] }
    slots[slot] = id
    slot += 1
  }
  if (slot === 0) {
    return null
  }
  const mob: Mob = { id: mobId, position: { ...position }, slots_1_to_6: slots }
  return { session: { ...next, mobs: [...next.mobs, mob] }, mobId }
}

function pickDebugHero(session: GameSession) {
  const selectedId = getSelectedMapHeroId()
  const selected = selectedId
    ? session.heroes.find((row) => row.id === selectedId)
    : undefined
  const human = session.players.find((player) => !player.is_ai)
  return (
    selected ??
    (human
      ? session.heroes.find((row) => row.player_id === human.id)
      : undefined) ??
    session.heroes[0] ??
    null
  )
}

function tagIdByName(
  catalog: ReferenceCatalog,
  name: string,
): number | null {
  const needle = name.trim().toLowerCase()
  const row = catalog.unit_tag.find(
    (entry) => entry.value.trim().toLowerCase() === needle,
  )
  return row?.id ?? null
}

function citadelTownId(catalog: ReferenceCatalog): number | null {
  const row = catalog.town.find(
    (entry) => entry.name.trim().toLowerCase() === 'citadel',
  )
  return row?.id ?? null
}

function unitTownTypeId(
  catalog: ReferenceCatalog,
  unit: UnitRow,
): number | null {
  if (unit.town_id != null && unit.town_id > 0) {
    return unit.town_id
  }
  const building = buildingById(catalog, unit.bldg_id)
  return building != null && building.town_id > 0 ? building.town_id : null
}

/** Same dwelling-growth qty used when spawning world mobs. */
function growthQty(catalog: ReferenceCatalog, unit: UnitRow): number {
  return Math.max(1, buildingGrowth(buildingById(catalog, unit.bldg_id)))
}

function pickRandom<T>(pool: T[], random: () => number): T | null {
  if (pool.length === 0) {
    return null
  }
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!
}

function combatEligible(unit: UnitRow): boolean {
  return unit.has_abilities && (unit.speed ?? 0) > 0
}

function unitsMatchingTagsAtTier(
  catalog: ReferenceCatalog,
  tagIds: number[],
  tier: number,
  opts?: { townId?: number | null; humanoidOnly?: boolean },
): UnitRow[] {
  const wanted = new Set(tagIds.filter((id) => id > 0))
  if (wanted.size === 0) {
    return []
  }
  const base = catalog.unit.filter((unit) => {
    if (!combatEligible(unit) || isAdvancedUnit(unit)) {
      return false
    }
    if (unitEffectiveTier(catalog, unit) !== tier) {
      return false
    }
    if (opts?.townId != null && unitTownTypeId(catalog, unit) !== opts.townId) {
      return false
    }
    if (opts?.humanoidOnly) {
      const humanoid = tagIdByName(catalog, 'Humanoid')
      if (humanoid == null || !unitHasTag(unit, humanoid)) {
        return false
      }
    }
    return [...wanted].some((tagId) => unitHasTag(unit, tagId))
  })
  if (base.length > 0) {
    return base
  }
  // Fallback: allow Advanced if no base unit exists at this tier/tag.
  return catalog.unit.filter((unit) => {
    if (!combatEligible(unit)) {
      return false
    }
    if (unitEffectiveTier(catalog, unit) !== tier) {
      return false
    }
    if (opts?.townId != null && unitTownTypeId(catalog, unit) !== opts.townId) {
      return false
    }
    if (opts?.humanoidOnly) {
      const humanoid = tagIdByName(catalog, 'Humanoid')
      if (humanoid == null || !unitHasTag(unit, humanoid)) {
        return false
      }
    }
    return [...wanted].some((tagId) => unitHasTag(unit, tagId))
  })
}

function pickTaggedStack(
  catalog: ReferenceCatalog,
  tagIds: number[],
  tier: number,
  random: () => number,
  opts?: { townId?: number | null; humanoidOnly?: boolean },
): { unitId: number; qty: number } | null {
  const unit = pickRandom(
    unitsMatchingTagsAtTier(catalog, tagIds, tier, opts),
    random,
  )
  if (!unit) {
    return null
  }
  return { unitId: unit.id, qty: growthQty(catalog, unit) }
}

function buildHolyWrathEnemies(
  catalog: ReferenceCatalog,
  random: () => number,
): Array<{ unitId: number; qty: number }> | null {
  const demon = tagIdByName(catalog, 'Demon')
  const undead = tagIdByName(catalog, 'Undead')
  if (demon == null || undead == null) {
    return null
  }
  const parts: Array<{ unitId: number; qty: number }> = []
  const t1 = pickTaggedStack(catalog, [demon], 1, random)
  const t2 = pickTaggedStack(catalog, [undead], 2, random)
  if (!t1 || !t2) {
    return null
  }
  parts.push(t1, t2)
  for (let tier = 3; tier <= 6; tier += 1) {
    const tag = random() < 0.5 ? demon : undead
    const part = pickTaggedStack(catalog, [tag], tier, random)
    if (!part) {
      // If the chosen tag has no unit at this tier, try the other.
      const other = tag === demon ? undead : demon
      const fallback = pickTaggedStack(catalog, [other], tier, random)
      if (!fallback) {
        return null
      }
      parts.push(fallback)
    } else {
      parts.push(part)
    }
  }
  return parts
}

function buildHoardArmy(
  catalog: ReferenceCatalog,
  random: () => number,
): Array<{ unitId: number; qty: number }> | null {
  const humanoid = tagIdByName(catalog, 'Humanoid')
  const townId = citadelTownId(catalog)
  if (humanoid == null || townId == null) {
    return null
  }
  const parts: Array<{ unitId: number; qty: number }> = []
  for (const tier of HOARD_TIERS) {
    const part = pickTaggedStack(catalog, [humanoid], tier, random, {
      townId,
      humanoidOnly: true,
    })
    if (!part) {
      return null
    }
    parts.push(part)
  }
  return parts
}

function knightClassId(catalog: ReferenceCatalog): number | null {
  const row = catalog.hero_type.find(
    (entry) => entry.name.trim().toLowerCase() === 'knight',
  )
  return row?.id ?? null
}

function configureKnightHero(
  session: GameSession,
  heroId: string,
  catalog: ReferenceCatalog,
  classId: number,
): GameSession {
  const pools = heroResourcePools(catalog, {
    class_id: classId,
    current_level: HOARD_LEVEL,
  })
  return {
    ...session,
    heroes: session.heroes.map((row) =>
      row.id === heroId
        ? {
            ...row,
            class_id: classId,
            current_level: HOARD_LEVEL,
            current_xp: 0,
            learned_abilities: [],
            used_abilities_this_battle: [],
            used_abilities_today: [],
            current_mana: pools.current_mana,
            current_energy: pools.current_energy,
          }
        : row,
    ),
  }
}

function fillHeroArmy(
  session: GameSession,
  heroId: string,
  parts: ReadonlyArray<{ unitId: number; qty: number }>,
): GameSession {
  let next = clearHeroArmy(session, heroId)
  let slot = 0
  for (const part of parts) {
    if (slot >= ARMY_STACK_SLOTS || part.qty <= 0) {
      continue
    }
    next = insertHeroArmyStack(next, heroId, slot, {
      id: nextUnitStackId(next),
      unitId: part.unitId,
      qty: part.qty,
    })
    slot += 1
  }
  return next
}

/** Solo debug games may only have player-1; hero vs hero needs a distinct defender slot. */
function opponentPlayerForFixedFight(
  session: GameSession,
  attacker: Hero,
): { session: GameSession; player: Player } {
  const existing =
    session.players.find((player) => player.is_ai) ??
    session.players.find((player) => player.id !== attacker.player_id)
  if (existing) {
    return { session, player: existing }
  }
  const slot = session.players.length + 1
  const player: Player = {
    id: playerIdForSlot(slot),
    is_ai: true,
    ai_spectator: false,
    arch_id: DEFAULT_AI_ARCH_ID,
    eliminated: false,
    resources: startingResources(),
    hero_ids: [],
    town_ids: [],
    explored: [],
  }
  return {
    session: { ...session, players: [...session.players, player] },
    player,
  }
}

function ensureOpponentHero(
  session: GameSession,
  attacker: Hero,
  catalog: ReferenceCatalog,
  classId: number,
): { session: GameSession; heroId: string } | null {
  const { session: withPlayer, player: aiPlayer } = opponentPlayerForFixedFight(
    session,
    attacker,
  )
  session = withPlayer
  const existing = session.heroes.find(
    (row) => row.player_id === aiPlayer.id && row.id !== attacker.id,
  )
  if (existing) {
    return { session, heroId: existing.id }
  }
  const id = nextHeroId(session)
  const pools = heroResourcePools(catalog, {
    class_id: classId,
    current_level: HOARD_LEVEL,
  })
  const hero: Hero = {
    id,
    player_id: aiPlayer.id,
    name: 'Hoard Rival',
    class_id: classId,
    image_path: null,
    position: { ...attacker.position },
    movement_remaining: 0,
    army: {
      slot_0: 'Hoard Rival',
      slots_1_to_6: Array.from({ length: ARMY_STACK_SLOTS }, () => null),
    },
    learned_abilities: [],
    current_level: HOARD_LEVEL,
    current_xp: 0,
    used_abilities_this_battle: [],
    used_abilities_today: [],
    arch_id: null,
    current_mana: pools.current_mana,
    current_energy: pools.current_energy,
  }
  return {
    session: {
      ...session,
      heroes: [...session.heroes, hero],
      players: session.players.map((player) =>
        player.id === aiPlayer.id
          ? { ...player, hero_ids: [...player.hero_ids, id] }
          : player,
      ),
    },
    heroId: id,
  }
}

function prepareHolyWrath(
  session: GameSession,
  hero: Hero,
  catalog: ReferenceCatalog,
  random: () => number,
): FixedFightResult {
  const enemies = buildHolyWrathEnemies(catalog, random)
  if (!enemies) {
    return { error: 'Holy Wrath: could not pick Demon/Undead stacks' }
  }
  const spawned = spawnFixedMob(session, hero.position, enemies)
  if (!spawned) {
    return { error: 'Could not spawn Holy Wrath enemies' }
  }
  return {
    session: spawned.session,
    heroId: hero.id,
    mobId: spawned.mobId,
    defenderHeroId: null,
    notice: `${hero.name}: Holy Wrath`,
  }
}

function ensureMirrorDefender(
  session: GameSession,
  attacker: Hero,
): { session: GameSession; heroId: string } {
  const { session: withPlayer, player: aiPlayer } = opponentPlayerForFixedFight(
    session,
    attacker,
  )
  session = withPlayer
  const existing = session.heroes.find(
    (row) => row.player_id === aiPlayer.id && row.id !== attacker.id,
  )
  if (existing) {
    return { session, heroId: existing.id }
  }
  const id = nextHeroId(session)
  const hero: Hero = {
    id,
    player_id: aiPlayer.id,
    name: `${attacker.name} (Mirror)`,
    class_id: attacker.class_id,
    image_path: attacker.image_path,
    position: { ...attacker.position },
    movement_remaining: 0,
    army: {
      slot_0: attacker.army.slot_0,
      slots_1_to_6: Array.from({ length: ARMY_STACK_SLOTS }, () => null),
    },
    learned_abilities: [...attacker.learned_abilities],
    current_level: attacker.current_level,
    current_xp: attacker.current_xp,
    used_abilities_this_battle: [],
    used_abilities_today: [],
    arch_id: attacker.arch_id,
    current_mana: attacker.current_mana,
    current_energy: attacker.current_energy,
  }
  return {
    session: {
      ...session,
      heroes: [...session.heroes, hero],
      players: session.players.map((player) =>
        player.id === aiPlayer.id
          ? { ...player, hero_ids: [...player.hero_ids, id] }
          : player,
      ),
    },
    heroId: id,
  }
}

function cloneHeroAsMirror(
  session: GameSession,
  fromHeroId: string,
  toHeroId: string,
): GameSession {
  const from = session.heroes.find((row) => row.id === fromHeroId)
  if (!from) {
    return session
  }
  let next = clearHeroArmy(session, toHeroId)
  for (let slot = 0; slot < ARMY_STACK_SLOTS; slot += 1) {
    const stackId = from.army.slots_1_to_6[slot]
    if (!stackId) {
      continue
    }
    const stack = next.units.find((row) => row.id === stackId)
    if (!stack || stack.qty <= 0) {
      continue
    }
    next = insertHeroArmyStack(next, toHeroId, slot, {
      id: nextUnitStackId(next),
      unitId: stack.unit_id,
      qty: stack.qty,
    })
  }
  return {
    ...next,
    heroes: next.heroes.map((row) =>
      row.id === toHeroId
        ? {
            ...row,
            name: `${from.name} (Mirror)`,
            class_id: from.class_id,
            image_path: from.image_path,
            army: { ...row.army, slot_0: from.army.slot_0 },
            learned_abilities: [...from.learned_abilities],
            current_level: from.current_level,
            current_xp: from.current_xp,
            arch_id: from.arch_id,
            current_mana: from.current_mana,
            current_energy: from.current_energy,
            used_abilities_this_battle: [],
            used_abilities_today: [],
          }
        : row,
    ),
  }
}

function prepareFightYourself(
  session: GameSession,
  hero: Hero,
): FixedFightResult {
  if (hero.class_id == null) {
    return { error: 'Fight Yourself: hero has no class' }
  }
  const defender = ensureMirrorDefender(session, hero)
  const next = cloneHeroAsMirror(defender.session, hero.id, defender.heroId)
  return {
    session: next,
    heroId: hero.id,
    mobId: null,
    defenderHeroId: defender.heroId,
    notice: `${hero.name}: Fight Yourself`,
  }
}

function prepareForTheHoard(
  session: GameSession,
  hero: Hero,
  catalog: ReferenceCatalog,
  random: () => number,
): FixedFightResult {
  const classId = knightClassId(catalog)
  if (classId == null) {
    return { error: 'For the Hoard: Knight hero type missing' }
  }
  const army = buildHoardArmy(catalog, random)
  if (!army) {
    return { error: 'For the Hoard: could not pick Citadel Humanoid stacks' }
  }
  const rival = ensureOpponentHero(session, hero, catalog, classId)
  if (!rival) {
    return { error: 'For the Hoard: need an AI/opponent player' }
  }
  let next = rival.session
  next = configureKnightHero(next, hero.id, catalog, classId)
  next = configureKnightHero(next, rival.heroId, catalog, classId)
  next = fillHeroArmy(next, hero.id, army)
  next = fillHeroArmy(next, rival.heroId, army)
  return {
    session: next,
    heroId: hero.id,
    mobId: null,
    defenderHeroId: rival.heroId,
    notice: `${hero.name}: For the Hoard (Knight L${HOARD_LEVEL})`,
  }
}

/**
 * Debug: stage army + fixed mob/hero for an immediate fight (no flee/surrender gate).
 * Pit Fiends replaces the hero army; Raise Demons swaps Imps → Horned Hellions.
 */
export function prepareFixedFight(
  session: GameSession,
  kind: FixedFightKind,
  random: () => number = Math.random,
): FixedFightResult {
  const hero = pickDebugHero(session)
  if (!hero) {
    return { error: 'No hero for Fixed Fight' }
  }
  if (
    kind === 'holy_wrath' ||
    kind === 'for_the_hoard' ||
    kind === 'fight_yourself'
  ) {
    if (kind === 'fight_yourself') {
      return prepareFightYourself(session, hero)
    }
    const catalog = getCachedCatalog()
    if (!catalog) {
      return { error: 'Catalog not loaded' }
    }
    return kind === 'holy_wrath'
      ? prepareHolyWrath(session, hero, catalog, random)
      : prepareForTheHoard(session, hero, catalog, random)
  }
  let next = session
  if (kind === 'pit_fiends') {
    next = clearHeroArmy(next, hero.id)
    next = insertHeroArmyStack(next, hero.id, 0, {
      id: nextUnitStackId(next),
      unitId: PIT_FIEND_ARCH_ID,
      qty: PIT_FIEND_ARCH_QTY,
    })
  } else {
    next = replaceHeroImpsWithHornedHellions(next, hero.id)
  }
  const enemies =
    kind === 'pit_fiends'
      ? [{ unitId: 72, qty: 2 }]
      : RAISE_DEMON_ENEMIES
  const spawned = spawnFixedMob(next, hero.position, enemies)
  if (!spawned) {
    return { error: 'Could not spawn Fixed Fight enemies' }
  }
  const notice =
    kind === 'pit_fiends'
      ? `${hero.name}: Pit Fiends (3 Arch vs Assassin×2)`
      : `${hero.name}: Raise Demons`
  return {
    session: spawned.session,
    heroId: hero.id,
    mobId: spawned.mobId,
    defenderHeroId: null,
    notice,
  }
}
