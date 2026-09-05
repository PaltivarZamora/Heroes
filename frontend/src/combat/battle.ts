import type { GameSession, Hero } from '../session/types'
import { NECROPOLIS_TOWN_TYPE_ID, slotFromPlayerId } from '../session/types'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import { retaliationCharges, unitById } from '../town/catalog'
import { stacksWithoutOverlap } from './occupancy'
import { siegeStructureStacks } from './siege'

export type CombatSide = 'atk' | 'def'

export type CombatTile = {
  q: number
  r: number
  /** Offset column, when known (combat grid). */
  col?: number
  /** Offset row, when known (combat grid). */
  row?: number
  terrain: string
  movementCostMultiplier: number | null
  blocked: boolean
  /** From terrain_type.blocks_los. Units never set this. */
  blocksLos: boolean
}

export type CombatStack = {
  id: string
  side: CombatSide
  /** Original army slot 0–5. Tie-break uses this, not the current hex. */
  slot: number
  unitId: number
  qty: number
  /** Live HP of the front creature. Starts at unit.health. */
  topHealth: number
  /** Unit count at battle start. Revival/Resurrection cap. */
  startingQty: number
  q: number
  r: number
  hasActedThisRound: boolean
  /** Remaining retaliations this round. Infinity = unlimited. */
  retaliationsLeft: number
  /** Wall-column ends. Never damaged. */
  indestructible?: boolean
  /** Session hero id when this stack is a Hero portrait, not a unit. */
  heroId?: string
  /** Signed % on this stack's outgoing damage (buff +, debuff −). */
  outputMods?: CombatOutputMods
  /** Extra incoming-mitigation % after unit soak and hero Defense/Resistance. */
  mitigationPct?: CombatMitigationPct
  /** Vampiric Strike: revive from damage this stack deals (whole battle). */
  vampiricStrike?: boolean
  /** Session unit id when this stack maps to a permanent army slot. */
  sessionStackId?: string
  /** Permanent army slot 0–5. Summons omit this. */
  armySlot?: number
  /** From the summoning ability's stats. Reconciliation reads this, not ability id. */
  persistOnSummon?: boolean
  /** Creation order for post-battle summon reconciliation. */
  summonSeq?: number
  /** Remaining forced turns by catalog condition.id. */
  conditions?: Record<number, number>
}

export type CombatOutputMods = {
  physicalTotal: number
  magicTotal: number
  physicalMin: number
  magicMin: number
  physicalMax: number
  magicMax: number
}

export type CombatMitigationPct = {
  defense: number
  resistance: number
}

export type SiegeGate = {
  q: number
  r: number
  moatQ: number
  moatR: number
}

export type CombatBattle = {
  round: number
  stacks: CombatStack[]
  order: string[]
  activeIndex: number
  attackerPlayer: number
  defenderPlayer: number
  /** Prevents a second start-of-turn Moat tick on the same stack. */
  moatStartKey?: string
  /** Siege Drawbridge + its Moat hex. Survives after the stack is destroyed. */
  siegeGate?: SiegeGate | null
  /** Kills this battle, keyed by catalog unit id. Source for tag-based summons. */
  unitDeaths: Record<number, number>
}

/**
 * Battle log grows toward this shape:
 *   16 Bats flew 6 spaces.
 *   16 Bats attacked 12 Worms for ## dmg and ## Worms died.
 *   ## Worms retaliated against 16 Bats for ## dmg and ## Bats died.
 *   Player 1 now has ## Bats and Player 2 has ## Worms.
 * Movement, attack, and melee retaliation are real.
 */
export type BattleLog = {
  lines: string[]
  /** Start-of-turn hazard: dismiss without advancing the active stack. */
  holdTurn?: boolean
}

export type SlotStart = {
  side: CombatSide
  slot: number
  q: number
  r: number
}

export function isHeroStack(
  stack: CombatStack | null | undefined,
): boolean {
  return stack != null && Boolean(stack.heroId)
}

export function noteUnitDeaths(
  battle: CombatBattle,
  unitId: number,
  killed: number,
): CombatBattle {
  if (killed <= 0) {
    return battle
  }
  return {
    ...battle,
    unitDeaths: {
      ...(battle.unitDeaths ?? {}),
      [unitId]: (battle.unitDeaths?.[unitId] ?? 0) + killed,
    },
  }
}

export function mergeUnitDeaths(
  into: Record<number, number>,
  unitId: number,
  killed: number,
): Record<number, number> {
  if (killed <= 0) {
    return into
  }
  return { ...into, [unitId]: (into[unitId] ?? 0) + killed }
}

function fullHealth(catalog: ReferenceCatalog, unitId: number): number {
  return Math.max(1, unitById(catalog, unitId)?.health ?? 1)
}

function playerNumber(hero: Hero | undefined): number {
  return slotFromPlayerId(hero?.player_id ?? '') ?? 1
}

function necropolisUnits(catalog: ReferenceCatalog): UnitRow[] {
  const buildingIds = new Set(
    catalog.building
      .filter((row) => row.town_id === NECROPOLIS_TOWN_TYPE_ID)
      .map((row) => row.id),
  )
  const fromTown = catalog.unit.filter(
    (row) =>
      row.bldg_id != null &&
      buildingIds.has(row.bldg_id) &&
      (row.speed ?? 0) > 0,
  )
  const pool =
    fromTown.length > 0
      ? fromTown
      : catalog.unit.filter((row) => (row.speed ?? 0) > 0)
  return [...pool].sort((a, b) => a.id - b.id)
}

function heroTypeName(
  catalog: ReferenceCatalog,
  hero: Hero | undefined,
): string | undefined {
  if (hero?.class_id == null) {
    return undefined
  }
  return catalog.hero_type.find((row) => row.id === hero.class_id)?.name
}

function catalogUnitNamed(
  catalog: ReferenceCatalog,
  name: string,
): UnitRow | undefined {
  const key = name.trim().toLowerCase()
  return catalog.unit.find((row) => row.name.trim().toLowerCase() === key)
}

/**
 * Test-army only: Necromancer uses Skeleton Riders in place of Lich and
 * Shadow Dragon; Death Knight uses Shadow Dragon in place of Bats.
 */
function dummyUnitForHero(
  unit: UnitRow,
  catalog: ReferenceCatalog,
  hero: Hero | undefined,
): UnitRow {
  const typeName = heroTypeName(catalog, hero)
  if (
    typeName === 'Necromancer' &&
    (unit.name === 'Lich' || unit.name === 'Shadow Dragon')
  ) {
    return (
      catalogUnitNamed(catalog, 'Skeleton Riders') ??
      catalogUnitNamed(catalog, 'Skeletal Riders') ??
      unit
    )
  }
  if (typeName === 'Death Knight' && unit.name === 'Bats') {
    return catalogUnitNamed(catalog, 'Shadow Dragon') ?? unit
  }
  return unit
}

function stackFromArmySlot(
  session: GameSession,
  catalog: ReferenceCatalog,
  hero: Hero | undefined,
  side: CombatSide,
  start: SlotStart,
): CombatStack | null {
  const stackId = hero?.army.slots_1_to_6[start.slot] ?? null
  if (!stackId) {
    return null
  }
  const unitStack = session.units.find((row) => row.id === stackId)
  if (!unitStack) {
    return null
  }
  return {
    id: `combat-${side}-${start.slot}`,
    side,
    slot: start.slot,
    unitId: unitStack.unit_id,
    qty: unitStack.qty,
    topHealth: fullHealth(catalog, unitStack.unit_id),
    startingQty: unitStack.qty,
    q: start.q,
    r: start.r,
    hasActedThisRound: false,
    retaliationsLeft: retaliationCharges(unitById(catalog, unitStack.unit_id)),
    sessionStackId: unitStack.id,
    armySlot: start.slot,
  }
}

function stacksForSide(
  session: GameSession,
  catalog: ReferenceCatalog,
  hero: Hero | undefined,
  side: CombatSide,
  starts: SlotStart[],
  seedOffset: number,
  fillEmpty = true,
): CombatStack[] {
  const sideStarts = starts.filter((start) => start.side === side)
  const live: CombatStack[] = []
  for (const start of sideStarts) {
    const stack = stackFromArmySlot(session, catalog, hero, side, start)
    if (stack) {
      live.push(stack)
    }
  }
  if (live.length > 0 || !fillEmpty) {
    return live
  }
  const pool = necropolisUnits(catalog)
  if (pool.length === 0) {
    return []
  }
  return sideStarts.map((start, index) => {
    const unit = dummyUnitForHero(
      pool[(seedOffset + index) % pool.length]!,
      catalog,
      hero,
    )
    return {
      id: `combat-${side}-${start.slot}`,
      side,
      slot: start.slot,
      unitId: unit.id,
      qty: 16,
      topHealth: fullHealth(catalog, unit.id),
      startingQty: 16,
      q: start.q,
      r: start.r,
      hasActedThisRound: false,
      retaliationsLeft: retaliationCharges(unit),
      armySlot: start.slot,
    }
  })
}

function stackSpeed(stack: CombatStack, catalog: ReferenceCatalog): number | null {
  return unitById(catalog, stack.unitId)?.speed ?? null
}

function mergeTiedSides(
  atk: CombatStack[],
  def: CombatStack[],
  random: () => number,
): CombatStack[] {
  const out: CombatStack[] = []
  let i = 0
  let j = 0
  while (i < atk.length && j < def.length) {
    if (random() < 0.5) {
      out.push(atk[i]!)
      i += 1
    } else {
      out.push(def[j]!)
      j += 1
    }
  }
  while (i < atk.length) {
    out.push(atk[i]!)
    i += 1
  }
  while (j < def.length) {
    out.push(def[j]!)
    j += 1
  }
  return out
}

/** Recalculated every round: Speed desc, same-side slot asc, opposing sides random. */
export function initiativeOrder(
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  random: () => number,
): string[] {
  const bySpeed = new Map<number, CombatStack[]>()
  for (const stack of stacks) {
    const speed = stackSpeed(stack, catalog)
    if (speed == null) {
      continue
    }
    const list = bySpeed.get(speed) ?? []
    list.push(stack)
    bySpeed.set(speed, list)
  }
  const speeds = [...bySpeed.keys()].sort((a, b) => b - a)
  const order: CombatStack[] = []
  for (const speed of speeds) {
    const tied = bySpeed.get(speed) ?? []
    const atk = tied
      .filter((stack) => stack.side === 'atk')
      .sort((a, b) => a.slot - b.slot)
    const def = tied
      .filter((stack) => stack.side === 'def')
      .sort((a, b) => a.slot - b.slot)
    if (atk.length === 0) {
      order.push(...def)
    } else if (def.length === 0) {
      order.push(...atk)
    } else {
      order.push(...mergeTiedSides(atk, def, random))
    }
  }
  return order.map((stack) => stack.id)
}

export function startRound(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  random: () => number = Math.random,
): CombatBattle {
  const stacks = battle.stacks.map((stack) => ({
    ...stack,
    hasActedThisRound: false,
    retaliationsLeft: retaliationCharges(unitById(catalog, stack.unitId)),
  }))
  return {
    ...battle,
    round: battle.round + 1,
    stacks,
    order: initiativeOrder(stacks, catalog, random),
    activeIndex: 0,
  }
}

export type SiegeSetup = {
  townId: string
  wallHexes: { q: number; r: number }[]
  catapult: { q: number; r: number } | null
  drawbridge?: { q: number; r: number } | null
  drawbridgeMoat?: { q: number; r: number } | null
}

function makeHeroStack(
  hero: Hero,
  side: CombatSide,
  pos: { q: number; r: number },
): CombatStack {
  return {
    id: `combat-${side}-hero`,
    side,
    slot: -1,
    unitId: 0,
    qty: 1,
    topHealth: 1,
    startingQty: 1,
    q: pos.q,
    r: pos.r,
    hasActedThisRound: false,
    retaliationsLeft: 0,
    indestructible: true,
    heroId: hero.id,
  }
}

export function createBattle(
  session: GameSession,
  catalog: ReferenceCatalog,
  attackerHeroId: string,
  defenderHeroId: string | null,
  starts: SlotStart[],
  random: () => number = Math.random,
  siege?: SiegeSetup | null,
  heroStarts?: { atk?: { q: number; r: number }; def?: { q: number; r: number } },
): CombatBattle {
  const attacker = session.heroes.find((hero) => hero.id === attackerHeroId)
  const defender = defenderHeroId
    ? session.heroes.find((hero) => hero.id === defenderHeroId)
    : undefined
  const town = siege
    ? session.towns.find((row) => row.id === siege.townId)
    : undefined
  const portraits: CombatStack[] = []
  if (attacker && heroStarts?.atk) {
    portraits.push(makeHeroStack(attacker, 'atk', heroStarts.atk))
  }
  if (defender && heroStarts?.def) {
    portraits.push(makeHeroStack(defender, 'def', heroStarts.def))
  }
  const atk = stacksForSide(session, catalog, attacker, 'atk', starts, 0)
  // TODO: standing garrison defends the town (persistent army). Preset
  // 16-qty stacks match hero-vs-hero test battles until that exists.
  const def = siege
    ? stacksForSide(session, catalog, undefined, 'def', starts, 6)
    : stacksForSide(session, catalog, defender, 'def', starts, 6)
  const extra = siege
    ? siegeStructureStacks(
        session,
        catalog,
        siege.townId,
        siege.wallHexes,
        siege.catapult,
      )
    : []
  const stacks = stacksWithoutOverlap(
    [...portraits, ...atk, ...def, ...extra],
    catalog,
  ).map((stack) => ({ ...stack, startingQty: stack.qty }))
  const gate =
    siege?.drawbridge && siege.drawbridgeMoat
      ? {
          q: siege.drawbridge.q,
          r: siege.drawbridge.r,
          moatQ: siege.drawbridgeMoat.q,
          moatR: siege.drawbridgeMoat.r,
        }
      : null
  return startRound(
    {
      round: 0,
      stacks,
      order: [],
      activeIndex: 0,
      attackerPlayer: playerNumber(attacker),
      defenderPlayer: defender
        ? playerNumber(defender)
        : slotFromPlayerId(town?.player_id ?? '') ?? 1,
      siegeGate: gate,
      unitDeaths: {},
    },
    catalog,
    random,
  )
}

export function activeStack(battle: CombatBattle): CombatStack | null {
  const id = battle.order[battle.activeIndex]
  if (!id) {
    return null
  }
  return battle.stacks.find((stack) => stack.id === id) ?? null
}

export function moveStack(
  battle: CombatBattle,
  stackId: string,
  q: number,
  r: number,
): CombatBattle {
  const target = battle.stacks.find((stack) => stack.id === stackId)
  if (isHeroStack(target)) {
    return battle
  }
  return {
    ...battle,
    stacks: battle.stacks.map((stack) =>
      stack.id === stackId ? { ...stack, q, r } : stack,
    ),
  }
}

export function endStackTurn(
  battle: CombatBattle,
  stackId: string,
): CombatBattle {
  return {
    ...battle,
    stacks: battle.stacks.map((stack) =>
      stack.id === stackId ? { ...stack, hasActedThisRound: true } : stack,
    ),
  }
}

export function applyMove(
  battle: CombatBattle,
  stackId: string,
  q: number,
  r: number,
): CombatBattle {
  return endStackTurn(moveStack(battle, stackId, q, r), stackId)
}

export function advanceTurn(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  random: () => number = Math.random,
): CombatBattle {
  const next = battle.order.findIndex((id) => {
    const stack = battle.stacks.find((row) => row.id === id)
    return stack != null && !stack.hasActedThisRound
  })
  if (next < 0) {
    return startRound(battle, catalog, random)
  }
  return { ...battle, activeIndex: next }
}
