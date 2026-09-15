import type { GameSession, Hero, Town } from '../session/types'
import { ARMY_STACK_SLOTS, slotFromPlayerId } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import { retaliationCharges, unitById } from '../town/catalog'
import { stacksWithoutOverlap } from './occupancy'
import { siegeStructureStacks } from './siege'
import { tickRoundConditions, type ConditionExtra } from './condition'
import { applyStackHeal } from './attack'
import type { CombatHeroes } from './attack'
import { tickShadowGrowth } from './shadow'
import { freezeArmyTagCounts, HUMANOID_TAG } from './armyTags'
import {
  applyBattleStartArmyPassives,
  freezeArmyTownCounts,
} from './heroArmyPassives'
import { applyTempleEndOfRoundPassives } from './templePassive'

export type CombatSide = 'atk' | 'def'

/** Tag id → creature qty per side, frozen when the battle opens. */
export type ArmyTagCounts = Record<number, Partial<Record<CombatSide, number>>>

/** Town-scoped counts for S6-46 army passives, frozen at battle start. */
export type ArmyTownCounts = Partial<
  Record<
    'grove' | 'fortress' | 'confluence' | 'factory_nonliving',
    Partial<Record<CombatSide, number>>
  >
>

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
  /** Hyper Focus: remaining condition-block attempts (any condition). */
  conditionImmunityUsesLeft?: number
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
  /** Signed % on live Resistance after base/flat (Druid Grove passive). */
  resistancePct?: number
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
  /** Deflect: flat % of attacker min roll, no mitigation; use budget. */
  deflect?: { pct: number; usesLeft: number }
  /** Double Tap: extra attack after the defender retaliates; use budget. */
  doubleTapUsesLeft?: number
  /** Preemptive Strike: retaliate before incoming damage; use budget. */
  preemptiveStrikeUsesLeft?: number
  /** Battle Cry: override retaliation damage % for a use budget. */
  battleCryRetaliation?: { pct: number; usesLeft: number }
  /** Charge: temporary flat speed from caster hero Speed. */
  speedBoost?: { amount: number; roundsLeft: number }
  /** Guard: Defense multiplier for a number of rounds. */
  defenseMult?: { mult: number; roundsLeft: number }
  /** Shield Wall: Resistance multiplier for a number of rounds. */
  resistanceMult?: { mult: number; roundsLeft: number }
  /** Immunity: remaining hits that deal zero damage (any source). */
  immunityHitsLeft?: number
  /** One-shot: this stack does not retaliate after the hit that just resolved. */
  skipRetaliationOnce?: boolean
  /** Camouflage: flat miss chance for incoming attacks, ticked at round start. */
  evasion?: { pct: number; roundsLeft: number }
  /** Mark Target: remaining hits that deal the attacker's guaranteed max_dmg. */
  markHitsLeft?: number
  /** Disarm: force outgoing min dmg; ticked at round start. */
  disarm?: { roundsLeft: number; physicalOnly: boolean }
  /** Sunder Armor: Physical (or all) attacks skip target Defense soak. */
  ignoreTargetArmor?: boolean
  /** When true with ignoreTargetArmor, only Physical attacks bypass soak. */
  ignoreTargetArmorPhysicalOnly?: boolean
  /** Reflect: bounce a % of incoming damage for a hit budget. */
  reflect?: { pct: number; hitsLeft: number; physicalOnly: boolean }
  /**
   * Spell Reflect: next Magic hits are redirected to a random enemy.
   * Uses consume per redirected attack (not bounce Reflect).
   */
  spellReflect?: { usesLeft: number }
  /** Expose: enemy stats visible on inspect for the rest of the battle. */
  exposed?: boolean
  /** Battle-start hex (Forced Retreat paths back here). */
  startHex?: { q: number; r: number }
  /** Forced Retreat: on next turn, walk toward startHex and end turn. */
  forcedRetreatPending?: boolean
  /**
   * Absolute Speed override for N rounds (Chronomancer Temporal Bolt swap).
   * When set, replaces live speed entirely (does not stack with speedBoost).
   */
  speedLock?: { value: number; roundsLeft: number }
  /** Fervor: chance to repeat turn/retaliation; ticked each round. */
  fervor?: { chancePct: number; roundsLeft: number; streak?: number }
  /** Ordinary attacks use Finger of Death overflow kills (Execute). */
  killOnOverflow?: boolean
  /**
   * Guardian Angel: cast-time qty snapshot. If a hit would wipe this stack,
   * restore to snapshotQty once, then clear. Separate from startingQty
   * (battle-start / vampiric / resurrection caps).
   */
  guardianAngel?: { snapshotQty: number; usesLeft: number }
  /** Fortify: ignore hits that would not kill at least one creature. */
  ignoresSublethal?: boolean
  /**
   * Last Stand: qty cannot drop below minQty; when floored, front unit
   * sits at lastUnitHp (other creatures remain implicitly full HP).
   */
  lastStand?: { minQty: number; lastUnitHp: number }
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

/**
 * Apply a signed percentage to an integer-ish base (floor).
 * Nonzero modifiers that would otherwise round to no change get a ±1 floor
 * so a real buff/debuff is never indistinguishable from casting nothing.
 */
export function scaleBySignedPct(n: number, signedPct: number): number {
  if (!signedPct) {
    return Math.max(0, n)
  }
  if (n <= 0) {
    // 0 × anything % is still 0 before rounding — still force ±1 when the
    // modifier itself is nonzero so the cast is visible.
    return Math.max(0, signedPct > 0 ? 1 : 0)
  }
  const scaled = Math.floor((n * (100 + signedPct)) / 100)
  if (scaled === n) {
    return Math.max(0, n + (signedPct > 0 ? 1 : -1))
  }
  return Math.max(0, scaled)
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
  const mult = stack.defenseMult?.mult
  const multiplied =
    mult != null && Number.isFinite(mult) && mult > 0
      ? Math.max(0, Math.floor(flat * mult))
      : flat
  const pct = stack.defensePct ?? 0
  const scaled = scaleBySignedPct(multiplied, pct)
  const floor = stack.defenseFloor ?? 0
  return Math.max(floor, scaled)
}

export function stackResistance(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): number {
  const base = unitById(catalog, stack.unitId)?.resistance ?? 0
  const flat = Math.max(0, base + (stack.statFlat?.resistance ?? 0))
  const mult = stack.resistanceMult?.mult
  const multiplied =
    mult != null && Number.isFinite(mult) && mult > 0
      ? Math.max(0, Math.floor(flat * mult))
      : flat
  const pct = stack.resistancePct ?? 0
  return scaleBySignedPct(multiplied, pct)
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

/** Marker left when a creature stack is wiped. Battle-scoped only. */
export type CombatTombstone = {
  /** Former combat stack id — reused on successful Resurrection. */
  id: string
  side: CombatSide
  unitId: number
  q: number
  r: number
  /** Revive qty cap (battle-start count). */
  startingQty: number
  /** Creatures lost when the stack was wiped (usually === startingQty). */
  deadQty: number
  sessionStackId?: string
  armySlot?: number
  slot: number
}

/**
 * Placed battlefield zone from a `ground_effect` template + casting ability.
 * Numbers are snapshotted at cast time; template only defines mechanic kind.
 */
export type CombatGroundEffect = {
  id: string
  templateId: number
  name: string
  imagePath: string | null
  /** From ground_effect.display_rules.layer — default below units. */
  layer: 'above_units' | 'below_units'
  hexKeys: string[]
  casterSide: CombatSide
  /** Invisible to opposing UI/AI; caster still sees it. */
  hidden: boolean
  /** Null = until cleared / triggered. */
  roundsLeft: number | null
  mechanicType: string
  effect: string
  triggerMoveTypes: Array<'ground' | 'flying' | 'hover' | 'submerge'>
  evasionPct: number
  flatDmg: number
  explodeRadius: number
  stunChancePct: number
  stunConditionId: number
  resistStat: 'resistance' | 'defense' | null
  consumeOnTrigger: boolean
  /** When false, detonation never damages/stuns the caster's side. */
  friendlyTakesDmg: boolean
  /** Barricade-style: hexes block standing / pathing. */
  blocksMovement?: boolean
  /** Barricade-style: hexes block line of sight. */
  blocksLos?: boolean
  /**
   * Tile snapshots taken when this zone stamped blocking onto the board.
   * Restored when Sanctify / Gaia / overlap-replace clears the zone.
   */
  tilePrevious?: Array<{
    q: number
    r: number
    terrain: string
    blocked: boolean
    blocksLos: boolean
    movementCostMultiplier: number | null
  }>
}

/** Mid-battle terrain stamp (Void leave-behind). */
export type CombatTerrainPatch = {
  q: number
  r: number
  terrainTypeId: number
  name: string
  imagePath: string | null
  /** Snapshot of the hex before the stamp (for Sanctify / Gaia clear). */
  previous?: {
    terrain: string
    blocked: boolean
    blocksLos: boolean
    movementCostMultiplier: number | null
  }
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
  /** Kills this round only (Phoenix self-rez). Cleared when a new round starts. */
  roundUnitDeaths?: Record<number, number>
  /**
   * Markers for fully wiped creature stacks. Block movement; Resurrection
   * may revive own-side tombstones. Cleared when combat ends (battle state).
   */
  tombstones: CombatTombstone[]
  /**
   * Reusable battlefield zones (Smoke, traps, …). Newest placement replaces
   * any overlapping zone hex. Hidden zones must not inform AI decisions.
   */
  groundEffects: CombatGroundEffect[]
  /**
   * Tag → side → creature qty, frozen at battle start (Humanoid for Citadel
   * passives; reusable for Factory Non-Living-style synergies later).
   */
  armyTagCounts?: ArmyTagCounts
  /**
   * Town / scoped counts frozen at battle start (Grove, Fortress, Confluence,
   * Non-Living Factory) for S6-46 army passives.
   */
  armyTownCounts?: ArmyTownCounts
  /** Void leave-behind: terrain_type stamps on vacated hexes. */
  terrainPatches?: CombatTerrainPatch[]
  /** Start-of-round condition logs (Polymorph break/expiry). */
  roundLog?: string[]
  /** End-of-round splash keys (Paladin execute / Cleric heal). */
  roundHitKeys?: string[]
  roundHealKeys?: string[]
  /** Brisk Renewal-style heals: tick at end of every round for the side. */
  recurringHeals?: Array<{
    side: CombatSide
    healPctStat: number
    healMin: number
    intel: number
  }>
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
    roundUnitDeaths: {
      ...(battle.roundUnitDeaths ?? {}),
      [unitId]: (battle.roundUnitDeaths?.[unitId] ?? 0) + killed,
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

function padArmySlots(
  slots: Array<string | null> | undefined,
): Array<string | null> {
  const next = (slots ?? []).slice(0, ARMY_STACK_SLOTS)
  while (next.length < ARMY_STACK_SLOTS) {
    next.push(null)
  }
  return next
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
    startHex: { q: start.q, r: start.r },
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

/** Defending hero army if present, else town garrison. */
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

/** True when this siege fights the town garrison, not a visiting hero's army. */
export function defenderArmyIsGarrison(
  session: GameSession,
  town: Town,
  attackerId: string,
): boolean {
  const hero = defendingHero(session, town, attackerId)
  if (hasLivingStacks(session, hero?.army.slots_1_to_6)) {
    return false
  }
  return hasLivingStacks(session, town.garrison.slots_1_to_6)
}

/**
 * Army slot index N maps only to the battlefield start for slot N.
 * Empty army slots leave the matching battlefield stand empty — never pack
 * living stacks upward to fill gaps.
 */
function stacksForSide(
  session: GameSession,
  catalog: ReferenceCatalog,
  slotIds: Array<string | null> | undefined,
  side: CombatSide,
  starts: SlotStart[],
): CombatStack[] {
  const slots = padArmySlots(slotIds)
  const startBySlot = new Map<number, SlotStart>()
  for (const start of starts) {
    if (start.side !== side) {
      continue
    }
    if (start.slot < 0 || start.slot >= ARMY_STACK_SLOTS) {
      continue
    }
    startBySlot.set(start.slot, start)
  }
  const live: CombatStack[] = []
  for (let slot = 0; slot < ARMY_STACK_SLOTS; slot += 1) {
    const start = startBySlot.get(slot)
    if (!start) {
      continue
    }
    const stack = stackFromSlotId(session, catalog, slots[slot], side, start)
    if (stack) {
      live.push(stack)
    }
  }
  return live
}

export function stackCombatSpeed(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): number | null {
  const base = unitById(catalog, stack.unitId)?.speed
  if (base == null) {
    return null
  }
  if (stack.speedLock != null) {
    return Math.max(0, stack.speedLock.value)
  }
  return Math.max(
    0,
    base +
      (stack.speedMod ?? 0) +
      (stack.statFlat?.speed ?? 0) +
      (stack.speedUses?.amount ?? 0) +
      (stack.speedBoost?.amount ?? 0),
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
 * Sides whose live combat speed changed between two battle snapshots
 * (buff or debuff). Used to re-sort initiative for the affected side(s).
 */
export function combatSpeedChangedSides(
  before: CombatBattle,
  after: CombatBattle,
  catalog: ReferenceCatalog,
): CombatSide[] {
  const prev = new Map(
    before.stacks.map((stack) => [
      stack.id,
      stackCombatSpeed(stack, catalog),
    ]),
  )
  const sides = new Set<CombatSide>()
  for (const stack of after.stacks) {
    if (stack.qty <= 0) {
      continue
    }
    const was = prev.get(stack.id)
    const now = stackCombatSpeed(stack, catalog)
    if (was !== now) {
      sides.add(stack.side)
    }
  }
  return [...sides]
}

/**
 * Re-sort only the remaining (not-yet-acted) suffix of this round's queue.
 * Prefix through the current actor is frozen. Other sides' suffix slots stay
 * put; `side`'s remaining entries permute among their existing suffix slots by
 * live speed (desc), then army slot (asc). No RNG.
 *
 * Call once per side that had a speed buff or debuff — slowed enemies must
 * shift later the same way hastened allies shift earlier.
 */
export function resortRemainingInitiative(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  side: CombatSide,
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
      stack.side !== side ||
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

/** Re-sort each listed side's remaining initiative (buff or debuff). */
export function resortRemainingInitiativeForSides(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  sides: readonly CombatSide[],
): CombatBattle {
  let next = battle
  for (const side of sides) {
    next = resortRemainingInitiative(next, catalog, side)
  }
  return next
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
  // Wall / Arcane Shield / other null-speed fixtures never join the queue.
  if (stackCombatSpeed(stack, catalog) == null) {
    return {
      ...battle,
      order: battle.order.filter((id) => id !== stackId),
    }
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

function tickDisarm(stack: CombatStack): CombatStack {
  const debuff = stack.disarm
  if (!debuff) {
    return stack
  }
  const left = debuff.roundsLeft - 1
  if (left <= 0) {
    return { ...stack, disarm: undefined }
  }
  return { ...stack, disarm: { ...debuff, roundsLeft: left } }
}

function tickFervor(stack: CombatStack): CombatStack {
  const buff = stack.fervor
  if (!buff) {
    return stack
  }
  const left = buff.roundsLeft - 1
  if (left <= 0) {
    return { ...stack, fervor: undefined }
  }
  return { ...stack, fervor: { ...buff, roundsLeft: left } }
}

function tickSpeedBoost(stack: CombatStack): CombatStack {
  const boost = stack.speedBoost
  if (!boost) {
    return stack
  }
  const left = boost.roundsLeft - 1
  if (left <= 0) {
    return { ...stack, speedBoost: undefined }
  }
  return { ...stack, speedBoost: { ...boost, roundsLeft: left } }
}

function tickSpeedLock(stack: CombatStack): CombatStack {
  const lock = stack.speedLock
  if (!lock) {
    return stack
  }
  const left = lock.roundsLeft - 1
  if (left <= 0) {
    return { ...stack, speedLock: undefined }
  }
  return { ...stack, speedLock: { ...lock, roundsLeft: left } }
}

function tickDefenseMult(stack: CombatStack): CombatStack {
  const buff = stack.defenseMult
  if (!buff) {
    return stack
  }
  const left = buff.roundsLeft - 1
  if (left <= 0) {
    return { ...stack, defenseMult: undefined }
  }
  return { ...stack, defenseMult: { ...buff, roundsLeft: left } }
}

function tickResistanceMult(stack: CombatStack): CombatStack {
  const buff = stack.resistanceMult
  if (!buff) {
    return stack
  }
  const left = buff.roundsLeft - 1
  if (left <= 0) {
    return { ...stack, resistanceMult: undefined }
  }
  return { ...stack, resistanceMult: { ...buff, roundsLeft: left } }
}

function tickDurationBuffs(stack: CombatStack): CombatStack {
  return tickResistanceMult(
    tickDefenseMult(
      tickSpeedLock(tickSpeedBoost(tickFervor(tickDisarm(tickEvasion(stack))))),
    ),
  )
}

export function startRound(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  random: () => number = Math.random,
  opts?: { skipDurationTicks?: boolean },
): CombatBattle {
  const skipTicks = opts?.skipDurationTicks === true
  const ticked = skipTicks
    ? { stacks: battle.stacks, lines: [] as string[] }
    : tickRoundConditions(battle.stacks, catalog, random)
  const newRound = battle.round + 1
  const stacks: CombatStack[] = ticked.stacks.map((stack) => {
    const reset: CombatStack = {
      ...stack,
      hasActedThisRound: false,
      extraTurnThisRound: false,
      retaliationsLeft: retaliationCharges(unitById(catalog, stack.unitId)),
    }
    return skipTicks ? reset : tickDurationBuffs(reset)
  })
  const order = initiativeOrder(stacks, catalog, random)
  let groundEffects = battle.groundEffects ?? []
  if (!skipTicks && groundEffects.length > 0) {
    groundEffects = groundEffects
      .map((row) =>
        row.roundsLeft == null
          ? row
          : { ...row, roundsLeft: row.roundsLeft - 1 },
      )
      .filter((row) => row.roundsLeft == null || row.roundsLeft > 0)
  }
  return {
    ...battle,
    round: newRound,
    stacks,
    order,
    activeIndex: 0,
    roundLog: ticked.lines,
    groundEffects,
    roundUnitDeaths: {},
  }
}

/** End-of-round recurring heals (Brisk Renewal), then start the next round. */
function applyRecurringEndOfRoundHeals(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
): { battle: CombatBattle; lines: string[] } {
  const entries = battle.recurringHeals ?? []
  if (entries.length === 0) {
    return { battle, lines: [] }
  }
  let stacks = battle.stacks
  const lines: string[] = []
  for (const entry of entries) {
    const amount = Math.max(
      entry.healMin,
      Math.floor(entry.intel * (entry.healPctStat / 100)),
    )
    if (amount <= 0) {
      continue
    }
    for (const stack of stacks) {
      if (
        stack.side !== entry.side ||
        stack.qty <= 0 ||
        isHeroStack(stack) ||
        stack.indestructible
      ) {
        continue
      }
      const full = stackMaxHealth(stack, catalog)
      if (stack.topHealth >= full) {
        continue
      }
      const healed = applyStackHeal(stack, amount, full)
      if (healed.healed <= 0) {
        continue
      }
      stacks = stacks.map((row) =>
        row.id === stack.id ? healed.stack : row,
      )
      const unit = unitById(catalog, stack.unitId)
      lines.push(
        `Brisk Renewal: ${stack.qty} ${unit?.name ?? 'unit'} healed ${healed.healed}.`,
      )
    }
  }
  return {
    battle: { ...battle, stacks },
    lines,
  }
}

export function advanceTurn(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  random: () => number = Math.random,
  opts?: {
    tiles?: CombatTile[]
    heroes?: CombatHeroes
  },
): CombatBattle {
  const next = battle.order.findIndex((id) => {
    const stack = battle.stacks.find((row) => row.id === id)
    return stack != null && !stack.hasActedThisRound
  })
  if (next < 0) {
    return forceEndRound(battle, catalog, random, {
      skipDurationTicks: false,
      tiles: opts?.tiles,
      heroes: opts?.heroes,
    })
  }
  return { ...battle, activeIndex: next, roundLog: [] }
}

/** Jump straight to the next round (Rally). Optionally skip duration ticks. */
export function forceEndRound(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  random: () => number = Math.random,
  opts?: {
    skipDurationTicks?: boolean
    tiles?: CombatTile[]
    heroes?: CombatHeroes
  },
): CombatBattle {
  const healed = applyRecurringEndOfRoundHeals(battle, catalog)
  const temple = applyTempleEndOfRoundPassives(
    healed.battle,
    catalog,
    opts?.heroes,
  )
  const grown =
    opts?.tiles && opts.tiles.length > 0
      ? tickShadowGrowth(
          temple.battle,
          catalog,
          opts.heroes,
          opts.tiles,
          random,
        )
      : { battle: temple.battle, lines: [] as string[] }
  const started = startRound(grown.battle, catalog, random, {
    skipDurationTicks: opts?.skipDurationTicks,
  })
  const prefix = [...healed.lines, ...temple.lines, ...grown.lines]
  const hitKeys = [...(temple.hitKeys ?? [])]
  const healKeys = [...(temple.healKeys ?? [])]
  if (prefix.length === 0 && hitKeys.length === 0 && healKeys.length === 0) {
    return started
  }
  return {
    ...started,
    roundLog: [...prefix, ...(started.roundLog ?? [])],
    roundHitKeys: hitKeys.length > 0 ? hitKeys : undefined,
    roundHealKeys: healKeys.length > 0 ? healKeys : undefined,
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
    startHex: { q: pos.q, r: pos.r },
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
  defenderMobId?: string | null,
): CombatBattle {
  const attacker = session.heroes.find((hero) => hero.id === attackerHeroId)
  const defender = defenderHeroId
    ? session.heroes.find((hero) => hero.id === defenderHeroId)
    : undefined
  const town = siege
    ? session.towns.find((row) => row.id === siege.townId)
    : undefined
  const mob = defenderMobId
    ? session.mobs.find((row) => row.id === defenderMobId)
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
  )
  const defSlots = siege && town
    ? siegeDefenderSlots(session, town, attackerHeroId)
    : (mob?.slots_1_to_6 ?? defender?.army.slots_1_to_6)
  const def = stacksForSide(
    session,
    catalog,
    defSlots,
    'def',
    starts,
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
  const stacksRaw = stacksWithoutOverlap(
    [...portraits, ...atk, ...def, ...extra],
    catalog,
  ).map((stack) => ({
    ...stack,
    startingQty: stack.qty,
    startHex: stack.startHex ?? { q: stack.q, r: stack.r },
  }))
  const armyTownCounts = freezeArmyTownCounts(stacksRaw, catalog)
  const stacks = applyBattleStartArmyPassives(
    stacksRaw,
    catalog,
    { atk: attacker, def: defender },
    armyTownCounts,
  )
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
        : slotFromPlayerId(town?.player_id ?? '') ?? (mob ? 2 : 1),
      siegeGate: gate,
      unitDeaths: {},
      roundUnitDeaths: {},
      tombstones: [],
      groundEffects: [],
      armyTagCounts: freezeArmyTagCounts(stacks, catalog, [HUMANOID_TAG]),
      armyTownCounts,
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

/** Hard stop so STR×pct ≈ 100% cannot hang the engine. */
export const FERVOR_CHAIN_SAFETY = 32

export function rollFervorChain(
  stack: CombatStack | null | undefined,
  random: () => number = Math.random,
): boolean {
  return tryFervorChain(stack, random).triggered
}

/** Fervor roll with chance% for battle-log formatting. */
export function tryFervorChain(
  stack: CombatStack | null | undefined,
  random: () => number = Math.random,
): { triggered: boolean; chancePct: number } {
  const buff = stack?.fervor
  const chancePct = buff?.chancePct ?? 0
  if (!buff || buff.roundsLeft <= 0 || chancePct <= 0) {
    return { triggered: false, chancePct }
  }
  if ((buff.streak ?? 0) >= FERVOR_CHAIN_SAFETY) {
    return { triggered: false, chancePct }
  }
  return { triggered: random() * 100 < chancePct, chancePct }
}

/** After a completed turn, Fervor lets the stack act again immediately. */
export function grantFervorExtraTurn(
  battle: CombatBattle,
  stackId: string,
): CombatBattle {
  return {
    ...battle,
    stacks: battle.stacks.map((row) => {
      if (row.id !== stackId) {
        return row
      }
      const buff = row.fervor
      return {
        ...row,
        hasActedThisRound: false,
        fervor: buff
          ? { ...buff, streak: (buff.streak ?? 0) + 1 }
          : undefined,
      }
    }),
  }
}

export function clearFervorStreak(
  battle: CombatBattle,
  stackId: string,
): CombatBattle {
  return {
    ...battle,
    stacks: battle.stacks.map((row) => {
      if (row.id !== stackId || !row.fervor || row.fervor.streak == null) {
        return row
      }
      return { ...row, fervor: { ...row.fervor, streak: 0 } }
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
