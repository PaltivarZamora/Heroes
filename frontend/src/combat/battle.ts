import type { GameSession, Hero, Town } from '../session/types'
import { NECROPOLIS_TOWN_TYPE_ID, slotFromPlayerId } from '../session/types'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import { retaliationCharges, unitById } from '../town/catalog'
import { stacksWithoutOverlap } from './occupancy'
import { siegeStructureStacks } from './siege'
import { tickRoundConditions, type ConditionExtra } from './condition'

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
  /** Polymorph-style extras keyed by condition.id. */
  conditionExtra?: Record<number, ConditionExtra>
  /** Flat speed change for the rest of the battle (Mass Slow). */
  speedMod?: number
  /** Multiplies catalog `max_dmg` before flat bonuses (Berserk). */
  maxDmgMult?: number
  /** Multiplies catalog `min_dmg` before flat bonuses (Berserk). */
  minDmgMult?: number
  /** When set, unit Defense is this value (Berserk). Ignores base and flat deltas. */
  defenseSet?: number
  /** Signed % on live Defense after base/flat, before the floor (Blood Lust). */
  defensePct?: number
  /** Floor for live Defense after % (Blood Lust). */
  defenseFloor?: number
  /** Added to the owning hero's crit_pct for this stack's attacks. */
  critPctBonus?: number
  /** Added to the owning hero's crit_amt for this stack's attacks. */
  critAmtBonus?: number
  /** Floor for a landed crit's bonus damage (standing rule default is 1). */
  minCritBonusDmg?: number
  /** Uses-based speed burst (Adrenaline Rush). Consumed when this stack's next real turn ends. */
  speedUses?: { amount: number; usesLeft: number }
  /** Furious Rush: consumed on this stack's next real turn (movement + one attack). */
  chargeRush?: {
    usesLeft: number
    coefficient: number
    guaranteedHit: boolean
    guaranteedMaxDmg: boolean
  }
  /** Steady Aim: this stack ignores the min-range penalty. */
  ignoreMinRangePenalty?: boolean
  /** Parry: remaining incoming physical attacks to fully negate. */
  parryPhysicalUses?: number
  /** Parry: retaliation never consumes or negates. */
  parryIgnoresRetaliation?: boolean
  /** Barrage: extra strike vs the same target at this dmg % before retaliation. */
  barragePct?: number
  /** Remaining Barrage second-attacks this battle. Omitted = uncapped. */
  barrageUsesLeft?: number
  /** Camouflage: flat miss chance for incoming attacks, ticked at round start. */
  evasion?: { pct: number; roundsLeft: number }
  /** Mark Target: remaining hits that deal the attacker's guaranteed max_dmg. */
  markHitsLeft?: number
  /** Ordinary attacks use Finger of Death overflow kills (Execute). */
  killOnOverflow?: boolean
  /** Flat deltas on live combat stats (Mutation). Current HP is never stored here. */
  statFlat?: CombatStatFlat
  /** Time Warp: extra turn after this stack's normal turn this round. */
  extraTurnThisRound?: boolean
  /** Unstable Rift: no longer fires, still occupies and blocks LOS. */
  silenced?: boolean
  /** Battle round when this stack was summoned. */
  spawnedRound?: number
  /** Remaining attacks before this Rift goes silent. Independent per stack. */
  silenceShotsLeft?: number
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

export type CombatStatFlat = {
  speed: number
  defense: number
  resistance: number
  minDmg: number
  maxDmg: number
  maxRange: number
  health: number
}

export function emptyStatFlat(): CombatStatFlat {
  return {
    speed: 0,
    defense: 0,
    resistance: 0,
    minDmg: 0,
    maxDmg: 0,
    maxRange: 0,
    health: 0,
  }
}

export function addStatFlat(
  current: CombatStatFlat | undefined,
  delta: number,
): CombatStatFlat {
  const base = current ?? emptyStatFlat()
  return {
    speed: base.speed + delta,
    defense: base.defense + delta,
    resistance: base.resistance + delta,
    minDmg: base.minDmg + delta,
    maxDmg: base.maxDmg + delta,
    maxRange: base.maxRange + delta,
    health: base.health + delta,
  }
}

export function stackMaxHealth(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): number {
  const base = unitById(catalog, stack.unitId)?.health ?? 1
  return Math.max(1, base + (stack.statFlat?.health ?? 0))
}

export function stackDefense(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): number {
  if (stack.defenseSet != null) {
    return Math.max(0, stack.defenseSet)
  }
  const base = unitById(catalog, stack.unitId)?.defense ?? 0
  const flat = base + (stack.statFlat?.defense ?? 0)
  const pct = stack.defensePct ?? 0
  const scaled = pct
    ? Math.floor((flat * (100 + pct)) / 100)
    : flat
  const floor = stack.defenseFloor ?? 0
  return Math.max(floor, scaled)
}

export function stackResistance(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): number {
  const base = unitById(catalog, stack.unitId)?.resistance ?? 0
  return Math.max(0, base + (stack.statFlat?.resistance ?? 0))
}

export function stackMinDmg(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): number {
  const base = unitById(catalog, stack.unitId)?.min_dmg ?? 0
  const mult = stack.minDmgMult
  const scaled =
    mult != null && Number.isFinite(mult) && mult > 0
      ? Math.max(0, Math.floor(base * mult))
      : base
  return Math.max(0, scaled + (stack.statFlat?.minDmg ?? 0))
}

export function stackMaxDmg(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): number {
  const base = unitById(catalog, stack.unitId)?.max_dmg ?? 0
  const mult = stack.maxDmgMult
  const scaled =
    mult != null && Number.isFinite(mult) && mult > 0
      ? Math.max(0, Math.floor(base * mult))
      : base
  return Math.max(0, scaled + (stack.statFlat?.maxDmg ?? 0))
}

export function stackMaxRange(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): number {
  const base = unitById(catalog, stack.unitId)?.max_range ?? 1
  return Math.max(1, base + (stack.statFlat?.maxRange ?? 0))
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
  /** Start-of-round condition logs (Polymorph break/expiry). */
  roundLog?: string[]
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

function stackFromSlotId(
  session: GameSession,
  catalog: ReferenceCatalog,
  slotId: string | null | undefined,
  side: CombatSide,
  start: SlotStart,
): CombatStack | null {
  if (!slotId) {
    return null
  }
  const unitStack = session.units.find((row) => row.id === slotId)
  if (!unitStack || unitStack.qty <= 0) {
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

function hasLivingStacks(
  session: GameSession,
  slots: Array<string | null> | undefined,
): boolean {
  if (!slots) {
    return false
  }
  return slots.some((id) => {
    if (!id) {
      return false
    }
    const row = session.units.find((unit) => unit.id === id)
    return row != null && row.qty > 0
  })
}

function defendingHero(
  session: GameSession,
  town: Town,
  attackerId: string,
): Hero | undefined {
  return session.heroes.find((hero) => {
    if (hero.id === attackerId) {
      return false
    }
    if (
      hero.position.q !== town.position.q ||
      hero.position.r !== town.position.r
    ) {
      return false
    }
    if (town.player_id && hero.player_id !== town.player_id) {
      return false
    }
    return true
  })
}

/** Defending hero army if present, else town garrison. Empty → generated fill. */
function siegeDefenderSlots(
  session: GameSession,
  town: Town,
  attackerId: string,
): Array<string | null> | undefined {
  const hero = defendingHero(session, town, attackerId)
  const heroSlots = hero?.army.slots_1_to_6
  if (hasLivingStacks(session, heroSlots)) {
    return heroSlots
  }
  const garrison = town.garrison.slots_1_to_6
  if (hasLivingStacks(session, garrison)) {
    return garrison
  }
  return heroSlots ?? garrison
}

function stacksForSide(
  session: GameSession,
  catalog: ReferenceCatalog,
  slotIds: Array<string | null> | undefined,
  side: CombatSide,
  starts: SlotStart[],
  seedOffset: number,
  flavorHero?: Hero,
): CombatStack[] {
  const sideStarts = starts.filter((start) => start.side === side)
  const live: CombatStack[] = []
  for (const start of sideStarts) {
    const stack = stackFromSlotId(
      session,
      catalog,
      slotIds?.[start.slot],
      side,
      start,
    )
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
    const unit = dummyUnitForHero(
      pool[(seedOffset + index) % pool.length]!,
      catalog,
      flavorHero,
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

export function stackCombatSpeed(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): number | null {
  const base = unitById(catalog, stack.unitId)?.speed
  if (base == null) {
    return null
  }
  return Math.max(
    0,
    base +
      (stack.speedMod ?? 0) +
      (stack.statFlat?.speed ?? 0) +
      (stack.speedUses?.amount ?? 0),
  )
}

/** Movement budget this turn. Furious Rush multiplies live speed; initiative does not. */
export function stackMoveSpeed(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): number | null {
  const live = stackCombatSpeed(stack, catalog)
  if (live == null) {
    return null
  }
  const coeff = stack.chargeRush?.coefficient
  if (coeff == null || coeff <= 0) {
    return live
  }
  return Math.max(0, live * coeff)
}

function stackSpeed(stack: CombatStack, catalog: ReferenceCatalog): number | null {
  return stackCombatSpeed(stack, catalog)
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

/**
 * Re-sort only the remaining (not-yet-acted) suffix of this round's queue.
 * Prefix through the current actor is frozen. Enemy suffix slots stay put;
 * friendly remaining entries permute among their existing suffix slots by
 * live speed (desc), then army slot (asc). No RNG.
 */
export function resortRemainingInitiative(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  casterSide: CombatSide,
): CombatBattle {
  const actorIdx = battle.activeIndex
  if (actorIdx < 0 || actorIdx >= battle.order.length) {
    return battle
  }
  const prefix = battle.order.slice(0, actorIdx + 1)
  const suffix = battle.order.slice(actorIdx + 1)
  if (suffix.length === 0) {
    return battle
  }
  const byId = new Map(battle.stacks.map((stack) => [stack.id, stack]))
  const movable: { index: number; stack: CombatStack }[] = []
  suffix.forEach((id, index) => {
    const stack = byId.get(id)
    if (
      !stack ||
      stack.qty <= 0 ||
      stack.side !== casterSide ||
      stack.hasActedThisRound
    ) {
      return
    }
    movable.push({ index, stack })
  })
  if (movable.length < 2) {
    return battle
  }
  const sorted = [...movable].sort((a, b) => {
    const speedA = stackCombatSpeed(a.stack, catalog) ?? 0
    const speedB = stackCombatSpeed(b.stack, catalog) ?? 0
    if (speedB !== speedA) {
      return speedB - speedA
    }
    return a.stack.slot - b.stack.slot
  })
  const nextSuffix = [...suffix]
  movable.forEach((slot, i) => {
    nextSuffix[slot.index] = sorted[i]!.stack.id
  })
  const nextOrder = [...prefix, ...nextSuffix]
  if (nextOrder.join('\0') === battle.order.join('\0')) {
    return battle
  }
  return { ...battle, order: nextOrder }
}

/**
 * Splice a newly summoned stack into the remaining (not-yet-acted) suffix
 * by live speed, descending. Prefix through the current actor is frozen.
 */
export function insertIntoRemainingInitiative(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  stackId: string,
): CombatBattle {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (!stack || stack.qty <= 0) {
    return battle
  }
  const speed = stackCombatSpeed(stack, catalog) ?? 0
  const actorIdx = Math.max(0, battle.activeIndex)
  const without = battle.order.filter((id) => id !== stackId)
  const prefix = without.slice(0, Math.min(actorIdx + 1, without.length))
  const suffix = without.slice(prefix.length)
  const byId = new Map(battle.stacks.map((row) => [row.id, row]))
  let insertAt = suffix.length
  for (let i = 0; i < suffix.length; i += 1) {
    const other = byId.get(suffix[i]!)
    const otherSpeed = other ? (stackCombatSpeed(other, catalog) ?? 0) : 0
    if (speed > otherSpeed) {
      insertAt = i
      break
    }
  }
  return {
    ...battle,
    order: [...prefix, ...suffix.slice(0, insertAt), stackId, ...suffix.slice(insertAt)],
  }
}

/** After this Rift's turn: count down shots, silence when the last one is spent. */
export function applyOwnSilenceAfterTurn(
  battle: CombatBattle,
  stackId: string,
  catalog: ReferenceCatalog,
): { battle: CombatBattle; line: string | null } {
  const stack = battle.stacks.find((row) => row.id === stackId)
  if (
    !stack ||
    stack.silenced ||
    stack.silenceShotsLeft == null ||
    stack.qty <= 0
  ) {
    return { battle, line: null }
  }
  const left = stack.silenceShotsLeft - 1
  if (left > 0) {
    return {
      battle: {
        ...battle,
        stacks: battle.stacks.map((row) =>
          row.id === stackId ? { ...row, silenceShotsLeft: left } : row,
        ),
      },
      line: null,
    }
  }
  const name = unitById(catalog, stack.unitId)?.name ?? 'Unknown'
  return {
    battle: {
      ...battle,
      stacks: battle.stacks.map((row) =>
        row.id === stackId
          ? { ...row, silenceShotsLeft: 0, silenced: true }
          : row,
      ),
    },
    line: `${name} goes silent.`,
  }
}

function tickEvasion(stack: CombatStack): CombatStack {
  const ev = stack.evasion
  if (!ev) {
    return stack
  }
  const left = ev.roundsLeft - 1
  if (left <= 0) {
    return { ...stack, evasion: undefined }
  }
  return { ...stack, evasion: { ...ev, roundsLeft: left } }
}

export function startRound(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  random: () => number = Math.random,
): CombatBattle {
  const ticked = tickRoundConditions(battle.stacks, catalog, random)
  const newRound = battle.round + 1
  const stacks: CombatStack[] = ticked.stacks.map((stack) =>
    tickEvasion({
      ...stack,
      hasActedThisRound: false,
      extraTurnThisRound: false,
      retaliationsLeft: retaliationCharges(unitById(catalog, stack.unitId)),
    }),
  )
  const order = initiativeOrder(stacks, catalog, random)
  return {
    ...battle,
    round: newRound,
    stacks,
    order,
    activeIndex: 0,
    roundLog: ticked.lines,
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
  const atk = stacksForSide(
    session,
    catalog,
    attacker?.army.slots_1_to_6,
    'atk',
    starts,
    0,
    attacker,
  )
  const defHero = siege && town
    ? defendingHero(session, town, attackerHeroId)
    : defender
  const defSlots = siege && town
    ? siegeDefenderSlots(session, town, attackerHeroId)
    : defender?.army.slots_1_to_6
  const def = stacksForSide(
    session,
    catalog,
    defSlots,
    'def',
    starts,
    6,
    defHero ?? defender,
  )
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
  wasteExtraTurn = false,
): CombatBattle {
  const current = battle.stacks.find((stack) => stack.id === stackId)
  const grantExtra = !wasteExtraTurn && current?.extraTurnThisRound === true
  return {
    ...battle,
    stacks: battle.stacks.map((stack) => {
      if (stack.id !== stackId) {
        return stack
      }
      const spent = consumeTurnUses(stack)
      if (grantExtra) {
        return { ...spent, hasActedThisRound: false, extraTurnThisRound: false }
      }
      return { ...spent, hasActedThisRound: true, extraTurnThisRound: false }
    }),
  }
}

function consumeTurnUses(stack: CombatStack): CombatStack {
  return consumeChargeRush(consumeSpeedUse(stack))
}

function consumeSpeedUse(stack: CombatStack): CombatStack {
  const burst = stack.speedUses
  if (!burst) {
    return stack
  }
  const left = burst.usesLeft - 1
  if (left <= 0) {
    return { ...stack, speedUses: undefined }
  }
  return { ...stack, speedUses: { amount: burst.amount, usesLeft: left } }
}

function consumeChargeRush(stack: CombatStack): CombatStack {
  const rush = stack.chargeRush
  if (!rush) {
    return stack
  }
  const left = rush.usesLeft - 1
  if (left <= 0) {
    return { ...stack, chargeRush: undefined }
  }
  return { ...stack, chargeRush: { ...rush, usesLeft: left } }
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
  return { ...battle, activeIndex: next, roundLog: [] }
}
