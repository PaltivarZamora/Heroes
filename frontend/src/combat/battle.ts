import type { TerrainType } from '../hex/types'
import type { GameSession, Hero } from '../session/types'
import { NECROPOLIS_TOWN_TYPE_ID, slotFromPlayerId } from '../session/types'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import { unitById } from '../town/catalog'

export type CombatSide = 'atk' | 'def'

export type CombatTile = {
  q: number
  r: number
  terrain: TerrainType
  movementCostMultiplier: number | null
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
  q: number
  r: number
  hasActedThisRound: boolean
}

export type CombatBattle = {
  round: number
  stacks: CombatStack[]
  order: string[]
  activeIndex: number
  attackerPlayer: number
  defenderPlayer: number
}

/**
 * Battle log grows toward this shape:
 *   16 Bats flew 6 spaces.
 *   16 Bats attacked 12 Worms for ## dmg and ## Worms died.
 *   ## Worms retaliated against 16 Bats for ## dmg and ## Bats died.
 *   Player 1 now has ## Bats and Player 2 has ## Worms.
 * Movement + attack lines are real. Retaliation is not yet.
 */
export type BattleLog = {
  lines: string[]
}

export type SlotStart = {
  side: CombatSide
  slot: number
  q: number
  r: number
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
      row.speed > 0,
  )
  const pool =
    fromTown.length > 0
      ? fromTown
      : catalog.unit.filter((row) => row.speed > 0)
  return [...pool].sort((a, b) => a.id - b.id)
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
    q: start.q,
    r: start.r,
    hasActedThisRound: false,
  }
}

function stacksForSide(
  session: GameSession,
  catalog: ReferenceCatalog,
  hero: Hero | undefined,
  side: CombatSide,
  starts: SlotStart[],
  seedOffset: number,
): CombatStack[] {
  const sideStarts = starts.filter((start) => start.side === side)
  const live: CombatStack[] = []
  for (const start of sideStarts) {
    const stack = stackFromArmySlot(session, catalog, hero, side, start)
    if (stack) {
      live.push(stack)
    }
  }
  if (live.length > 0) {
    return live
  }
  const pool = necropolisUnits(catalog)
  if (pool.length === 0) {
    return []
  }
  return sideStarts.map((start, index) => {
    const unit = pool[(seedOffset + index) % pool.length]!
    return {
      id: `combat-${side}-${start.slot}`,
      side,
      slot: start.slot,
      unitId: unit.id,
      qty: 16,
      topHealth: fullHealth(catalog, unit.id),
      q: start.q,
      r: start.r,
      hasActedThisRound: false,
    }
  })
}

function stackSpeed(stack: CombatStack, catalog: ReferenceCatalog): number {
  return unitById(catalog, stack.unitId)?.speed ?? 0
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
  }))
  return {
    ...battle,
    round: battle.round + 1,
    stacks,
    order: initiativeOrder(stacks, catalog, random),
    activeIndex: 0,
  }
}

export function createBattle(
  session: GameSession,
  catalog: ReferenceCatalog,
  attackerHeroId: string,
  defenderHeroId: string,
  starts: SlotStart[],
  random: () => number = Math.random,
): CombatBattle {
  const attacker = session.heroes.find((hero) => hero.id === attackerHeroId)
  const defender = session.heroes.find((hero) => hero.id === defenderHeroId)
  const stacks = [
    ...stacksForSide(session, catalog, attacker, 'atk', starts, 0),
    ...stacksForSide(session, catalog, defender, 'def', starts, 6),
  ]
  return startRound(
    {
      round: 0,
      stacks,
      order: [],
      activeIndex: 0,
      attackerPlayer: playerNumber(attacker),
      defenderPlayer: playerNumber(defender),
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
