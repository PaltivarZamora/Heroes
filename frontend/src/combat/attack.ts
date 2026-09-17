import { hexDistance } from '../hex/pathfinding'
import type { Axial } from '../hex/hero'
import type { Hero } from '../session/types'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import {
  commandingHeroStats,
  heroEffectiveStats,
  minRangePenaltyMult,
  shapeIsUntargeted,
  shapePulsesOnMove,
  unitAttackShape,
  unitAutoTarget,
  unitBlocksEnemyRetaliation,
  unitById,
  unitEffectiveTier,
  unitHasTag,
  unitRetaliation,
  wallDamageMult,
} from '../town/catalog'
import {
  combatSpeedChangedSides,
  isHeroStack,
  mergeUnitDeaths,
  moveStack,
  resortRemainingInitiativeForSides,
  tryFervorChain,
  scaleBySignedPct,
  stackCombatSpeed,
  stackDefense,
  stackMaxDmg,
  stackMaxHealth,
  stackMaxRange,
  stackMinDmg,
  stackResistance,
  type CombatBattle,
  type CombatSide,
  type CombatStack,
  type CombatTile,
} from './battle'
import { chanceRollLog, formatChancePct, rollChancePct } from './combatLog'
import {
  applySelfRezThenTombstones,
} from './confluence'
import { applySpiralFireFromAttacker } from './spiral'
import {
  clearGroundEffectTemplateHexes,
} from './groundEffect'
import {
  applyBreaksOnDamage,
  applyHitTickConditions,
  BLIND_MISS_PCT,
  isBlinded,
  isStunned,
  isVanished,
  isMagicAttackSilenced,
  liveResistance,
  tryInflictCondition,
} from './condition'
import { occupancyKey } from './occupancy'
import { relocateNearestTo } from './relocate'
import { poolMax } from './heroCast'
import { zoneEvasionPctForStack } from './groundEvasion'
import {
  necromancerShadowDamageBonusPct,
} from './shadow'
import {
  tryLeaveGroundEffectOnAttackPath,
} from './attackTrail'
import {
  healAmtForAllyRepair,
  isHealAllyTarget,
} from './factory'
import { boardKeys, geometricHexes, hasLineOfSight, resolveShapeHits } from './shapes'
import {
  isCreatureArmyUnit,
  isSiegeEngineUnit,
  isSiegeEngineWallTarget,
  isTerrainBlockerUnit,
  isUntargetableStack,
  isWallSegmentUnit,
} from './siege'
import {
  applyHighPriestessHealOnKill,
  auraExtraQty,
} from './templePassive'
import {
  citadelUnitGetsPassives,
  knightBonusChancePct,
  monkSuppressChancePct,
} from './citadelPassive'
import {
  fortressUnitGetsPassives,
  grantHeroEnergy,
  groveUnitGetsPassives,
  isDruidHero,
  isRogueHero,
  passiveManaPerAttack,
  rangerSuppressChancePct,
  rogueEnergyPerTrigger,
} from './heroArmyPassives'
import {
  grantHeroMana,
  isSorcererHero,
  isWizardHero,
  towerUnitGetsPassives,
} from './towerPassive'

export type DmgKind = 'physical' | 'magic'

export type CombatHeroes = {
  atk?: Hero
  def?: Hero
}

export type HitFlashColor = 'red' | 'yellow' | 'green' | 'blue'

export type AttackIconKind = 'magic' | 'melee' | 'ranged'

export function heroForSide(
  side: CombatStack['side'],
  heroes: CombatHeroes | undefined,
): Hero | undefined {
  if (!heroes) {
    return undefined
  }
  return side === 'atk' ? heroes.atk : heroes.def
}

export function damageKindOf(unit: UnitRow | null | undefined): DmgKind {
  return isMagic(unit?.dmg_type) ? 'magic' : 'physical'
}

function reduceByPct(n: number, pct: number): number {
  const cut = Math.min(100, Math.max(0, pct))
  if (cut <= 0) {
    return Math.max(0, n)
  }
  return Math.max(0, Math.floor((n * (100 - cut)) / 100))
}

function outputMinPct(stack: CombatStack, kind: DmgKind): number {
  const mods = stack.outputMods
  if (!mods) {
    return 0
  }
  return kind === 'magic' ? mods.magicMin : mods.physicalMin
}

function outputMaxPct(stack: CombatStack, kind: DmgKind): number {
  const mods = stack.outputMods
  if (!mods) {
    return 0
  }
  return kind === 'magic' ? mods.magicMax : mods.physicalMax
}

function outputTotalPct(stack: CombatStack, kind: DmgKind): number {
  const mods = stack.outputMods
  if (!mods) {
    return 0
  }
  return kind === 'magic' ? mods.magicTotal : mods.physicalTotal
}

/**
 * Flat unit soak (Defense/Resistance × defender qty) → hero % → stack buff %.
 * Flat soak scales with the defending stack: each creature blocks individually.
 * Default floor is 1 for the whole damage packet; callers that still need a
 * per-connecting-attacker chip floor pass `minDamage`.
 * `blocked` is the total taken off raw.
 */
export function mitigateIncoming(
  raw: number,
  target: CombatStack,
  catalog: ReferenceCatalog,
  kind: DmgKind,
  defenderHero: Hero | undefined,
  opts?: { ignoreArmor?: boolean; minDamage?: number },
): { damage: number; blocked: number; blockBy: BlockLabel | null } {
  if (raw <= 0 || target.indestructible) {
    return { damage: 0, blocked: Math.max(0, raw), blockBy: null }
  }
  // Arcane Shield: Magic damage is fully negated; Physical applies normally.
  if (
    kind === 'magic' &&
    unitAttackShape(unitById(catalog, target.unitId)).immuneToMagicDmg === true
  ) {
    return { damage: 0, blocked: Math.max(0, raw), blockBy: 'Resistance' }
  }
  const defQty = Math.max(0, target.qty)
  const soakPer =
    opts?.ignoreArmor === true
      ? 0
      : kind === 'magic'
        ? stackResistance(target, catalog)
        : stackDefense(target, catalog)
  const soak = soakPer * defQty
  const label: BlockLabel = kind === 'magic' ? 'Resistance' : 'Defense'
  const floor =
    opts?.ignoreArmor === true
      ? 0
      : Math.max(1, opts?.minDamage ?? 1)
  let dealt =
    opts?.ignoreArmor === true ? Math.max(0, raw) : Math.max(floor, raw - soak)
  let blocked = Math.max(0, raw - dealt)
  if (defenderHero) {
    const stats = heroEffectiveStats(
      catalog,
      defenderHero.class_id,
      defenderHero.current_level,
    )
    const heroPct = kind === 'magic' ? stats.resist : stats.defense
    const afterHero = reduceByPct(dealt, heroPct)
    blocked += dealt - afterHero
    dealt = afterHero
  }
  const buffPct =
    kind === 'magic'
      ? (target.mitigationPct?.resistance ?? 0)
      : (target.mitigationPct?.defense ?? 0)
  const afterBuff = reduceByPct(dealt, buffPct)
  blocked += dealt - afterBuff
  dealt = afterBuff
  return {
    damage: dealt,
    blocked,
    blockBy: soak > 0 || blocked > 0 ? label : null,
  }
}

function isMagic(dmgType: string | null | undefined): boolean {
  return (dmgType ?? '').toLowerCase() === 'magic'
}

export function attackIconFor(unit: UnitRow | null | undefined): AttackIconKind {
  if (isMagic(unit?.dmg_type)) {
    return 'magic'
  }
  if ((unit?.max_range ?? 1) <= 1) {
    return 'melee'
  }
  return 'ranged'
}

export function attackDistance(from: CombatStack, to: CombatStack): number {
  return hexDistance(
    { q: from.q, r: from.r },
    { q: to.q, r: to.r },
  )
}

/**
 * True if any living enemy is strictly closer than `min_range`.
 * Pulse never checks. One answer for the whole attack, not per hit.
 */
function minRangePenaltyApplies(
  striker: CombatStack,
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
): boolean {
  if (striker.ignoreMinRangePenalty === true) {
    return false
  }
  const unit = unitById(catalog, striker.unitId)
  if (shapePulsesOnMove(unitAttackShape(unit).shape)) {
    return false
  }
  const minRange = unit?.min_range ?? 0
  if (minRange <= 0) {
    return false
  }
  return stacks.some(
    (row) =>
      row.side !== striker.side &&
      row.qty > 0 &&
      hexDistance(striker, row) < minRange,
  )
}

export function attackRangeFrom(
  from: { q: number; r: number },
  target: CombatStack,
  catalog: ReferenceCatalog,
  attacker: CombatStack,
): boolean {
  if (target.qty <= 0) {
    return false
  }
  // charge_line is a full melee charge — never "in range" until adjacent,
  // even if the unit row still has a long max_range from an older shape.
  const shape = unitAttackShape(unitById(catalog, attacker.unitId)).shape
  const maxRange = shape === 'charge_line' ? 1 : stackMaxRange(attacker, catalog)
  const dist = hexDistance(from, { q: target.q, r: target.r })
  return dist >= 1 && dist <= maxRange
}

export function isValidAttackTarget(
  attacker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  stacks: CombatStack[],
  allowFriendly = false,
): boolean {
  if (attacker.id === target.id) {
    return false
  }
  if (attacker.side === target.side) {
    if (!allowFriendly && !isHealAllyTarget(attacker, target, catalog)) {
      return false
    }
  }
  if (isUntargetableStack(target, catalog)) {
    return false
  }
  if (isVanished(target, catalog)) {
    return false
  }
  const mode = unitAutoTarget(unitById(catalog, attacker.unitId))
  if (mode === 'random_wall_segment' && !isSiegeEngineWallTarget(target, catalog)) {
    return false
  }
  if (
    (mode === 'random_enemy' || mode === 'random_enemy_los') &&
    !isCreatureArmyUnit(unitById(catalog, target.unitId))
  ) {
    return false
  }
  return (
    attackRangeFrom(attacker, target, catalog, attacker) &&
    hasLineOfSight(
      attacker,
      { q: target.q, r: target.r },
      tiles,
      stacks,
      catalog,
    )
  )
}

/** Random auto-fire target. Null if none in range. */
export function pickAutoAttackTarget(
  attacker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  random: () => number = Math.random,
): CombatStack | null {
  const pool = battle.stacks.filter((row) =>
    isValidAttackTarget(attacker, row, catalog, tiles, battle.stacks),
  )
  if (pool.length === 0) {
    return null
  }
  const i = Math.min(pool.length - 1, Math.floor(random() * pool.length))
  return pool[i] ?? null
}

export function canAttackAnyone(
  attacker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): boolean {
  return battle.stacks.some((row) =>
    isValidAttackTarget(attacker, row, catalog, tiles, battle.stacks),
  )
}

export function stackAtHex(
  battle: CombatBattle,
  q: number,
  r: number,
): CombatStack | null {
  return battle.stacks.find((row) => row.q === q && row.r === r) ?? null
}

/** One independent roll in [minDmg, maxDmg] per creature, then summed. */
export function rollAttackDamage(
  qty: number,
  minDmg: number,
  maxDmg: number,
  random: () => number = Math.random,
): number {
  const lo = Math.min(minDmg, maxDmg)
  const hi = Math.max(minDmg, maxDmg)
  const span = hi - lo + 1
  let total = 0
  for (let i = 0; i < qty; i += 1) {
    total += lo + Math.floor(random() * span)
  }
  return total
}

/** Standing rule: a landed crit never adds 0. */
export function critBonusDamage(
  baseDmg: number,
  critAmt: number,
  minBonus = 1,
): number {
  if (baseDmg <= 0) {
    return 0
  }
  return Math.max(minBonus, Math.floor((baseDmg * Math.max(0, critAmt)) / 100))
}

function liveCritStats(
  striker: CombatStack,
  catalog: ReferenceCatalog,
  attackerHero: Hero | undefined,
  extraPct = 0,
  extraAmt = 0,
): { pct: number; amt: number; minBonus: number } {
  const base = commandingHeroStats(catalog, attackerHero)
  return {
    pct: base.crit_pct + (striker.critPctBonus ?? 0) + extraPct,
    amt: base.crit_amt + (striker.critAmtBonus ?? 0) + extraAmt,
    minBonus: Math.max(1, striker.minCritBonusDmg ?? 1),
  }
}

/** One-attack overrides (Furious Rush). Omitted on ordinary strikes. */
export type StrikeMods = {
  guaranteedHit?: boolean
  /** Per-creature raw damage; skips the min–max roll. */
  guaranteedDamage?: number
  critPctAdd?: number
  critAmtAdd?: number
  /** Retaliation strike. Parry with ignores_retaliation skips this hit. */
  isRetaliation?: boolean
  /** Bounce from Reflect — do not re-reflect. */
  isReflect?: boolean
  /** Spell Reflect redirect — do not re-redirect. */
  skipSpellReflect?: boolean
  /** Smoke / passive ground-effect evasion while defender stands in zone. */
  zoneEvasionPct?: number
  /** Necromancer Shadow passive: extra outgoing % while on Shadow. */
  outgoingPctAdd?: number
  /** Living stacks for Spell Reflect redirect picks. */
  battleStacks?: CombatStack[]
  /** Hexes walked before this strike (CHARGE escalation). */
  chargeHexes?: number
  /** charge_line: pre-move origin for pierce corridor + LINE damage formula. */
  chargePathOrigin?: Axial
  /** Angelic Warrior second strike: force Physical/Magic soak path. */
  damageKind?: DmgKind
  /** Angelic Warrior second strike: override catalog min/max dmg. */
  minDmg?: number
  maxDmg?: number
}

/** Per-creature miss hook. Camouflage is rolled once in `applyStrike`. */
export function strikeConnects(mods?: StrikeMods): boolean {
  if (mods?.guaranteedHit === true) {
    return true
  }
  return true
}

function defenderEvades(
  target: CombatStack,
  mods: StrikeMods | undefined,
  random: () => number,
): { evades: boolean; chancePct: number } {
  if (mods?.guaranteedHit === true) {
    return { evades: false, chancePct: 0 }
  }
  const chancePct = Math.max(target.evasion?.pct ?? 0, mods?.zoneEvasionPct ?? 0)
  if (chancePct <= 0) {
    return { evades: false, chancePct: 0 }
  }
  return { evades: random() * 100 < chancePct, chancePct }
}

/** Blind on the striker: their attacks miss this often (unless guaranteed). */
function attackerBlindMisses(
  striker: CombatStack,
  catalog: ReferenceCatalog,
  mods: StrikeMods | undefined,
  random: () => number,
): boolean {
  if (mods?.guaranteedHit === true) {
    return false
  }
  if (!isBlinded(striker, catalog)) {
    return false
  }
  return random() * 100 < BLIND_MISS_PCT
}

function strikeModsFromCharge(
  striker: CombatStack,
  catalog: ReferenceCatalog,
  attackerHero: Hero | undefined,
): StrikeMods | undefined {
  const rush = striker.chargeRush
  if (!rush || rush.usesLeft <= 0) {
    return undefined
  }
  const live = liveCritStats(striker, catalog, attackerHero)
  return {
    guaranteedHit: rush.guaranteedHit,
    guaranteedDamage: rush.guaranteedMaxDmg
      ? Math.max(0, Math.floor(stackMaxDmg(striker, catalog) * rush.coefficient))
      : undefined,
    critPctAdd: live.pct * rush.coefficient,
    critAmtAdd: live.amt * rush.coefficient,
  }
}

/**
 * CHARGE: for each hex walked, strength% chance to escalate current damage
 * (× mult, floor; if gain &lt; minIncrease, force +minIncrease).
 */
export function escalateChargeDamage(
  base: number,
  hexes: number,
  strength: number,
  mult: number,
  chancePctStat: number,
  minIncrease: number,
  random: () => number,
): number {
  let current = Math.max(0, Math.floor(base))
  const chance = Math.max(0, strength * chancePctStat)
  const factor = mult > 0 ? mult : 1.5
  const floorGain = Math.max(1, Math.floor(minIncrease))
  const steps = Math.max(0, Math.floor(hexes))
  for (let i = 0; i < steps; i += 1) {
    if (random() * 100 >= chance) {
      continue
    }
    const next = Math.floor(current * factor)
    current = next - current < floorGain ? current + floorGain : next
  }
  return current
}

/** Chronomancer Temporal Bolt: swap Speeds when the target is faster. */
export function trySpeedSwapIfTargetFaster(
  striker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
): { striker: CombatStack; target: CombatStack; lines: string[]; swapped: boolean } {
  const spec = unitAttackShape(unitById(catalog, striker.unitId))
  if (!spec.speedSwapIfTargetFaster) {
    return { striker, target, lines: [], swapped: false }
  }
  if (
    target.indestructible ||
    isHeroStack(target) ||
    !isCreatureArmyUnit(unitById(catalog, target.unitId))
  ) {
    return { striker, target, lines: [], swapped: false }
  }
  const atkSpeed = stackCombatSpeed(striker, catalog)
  const defSpeed = stackCombatSpeed(target, catalog)
  if (atkSpeed == null || defSpeed == null || defSpeed <= atkSpeed) {
    return { striker, target, lines: [], swapped: false }
  }
  const duration = Math.max(1, spec.speedSwapDuration)
  const atkName = unitById(catalog, striker.unitId)?.name ?? 'Unknown'
  const defName = unitById(catalog, target.unitId)?.name ?? 'Unknown'
  return {
    striker: {
      ...striker,
      speedLock: { value: defSpeed, roundsLeft: duration },
    },
    target: {
      ...target,
      speedLock: { value: atkSpeed, roundsLeft: duration },
    },
    lines: [
      `Temporal Bolt: ${atkName} (${atkSpeed}) and ${defName} (${defSpeed}) swap Speed for ${duration} round${duration === 1 ? '' : 's'}.`,
    ],
    swapped: true,
  }
}

/** Gladiator flat Speed cut / Vines % Slow: chance + resist, then apply. */
export function tryFlatSpeedDebuff(
  striker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
  attackerHero: Hero | undefined,
  random: () => number,
): { stack: CombatStack; lines: string[] } {
  const spec = unitAttackShape(unitById(catalog, striker.unitId))
  const div = spec.speedDebuffFlatStatDiv
  const pct = spec.speedDebuffPct
  const usePct = pct != null && pct > 0
  const useFlat = div != null && div > 0
  if (!usePct && !useFlat) {
    return { stack: target, lines: [] }
  }
  if (
    target.indestructible ||
    isHeroStack(target) ||
    !isCreatureArmyUnit(unitById(catalog, target.unitId))
  ) {
    return { stack: target, lines: [] }
  }
  const chance = spec.chancePct ?? 100
  const chanceLines: string[] = []
  if (chance < 100) {
    const triggered = rollChancePct(chance, random)
    chanceLines.push(
      chanceRollLog(
        unitById(catalog, striker.unitId)?.name ?? 'Attacker',
        chance,
        triggered,
        { action: 'to slow' },
      ),
    )
    if (!triggered) {
      return {
        stack: target,
        lines: chanceLines,
      }
    }
  }
  const name = unitById(catalog, target.unitId)?.name ?? 'Unknown'
  if (spec.resistStat) {
    const resistChance = Math.min(
      100,
      liveResistance(target, catalog, spec.resistStat),
    )
    if (Math.floor(random() * 100) < resistChance) {
      return {
        stack: target,
        lines: [
          ...chanceLines,
          `${target.qty} ${name}: ${resistChance}% ${spec.resistStat} vs slow — resisted!`,
        ],
      }
    }
  }
  let cut = 0
  if (usePct) {
    const live = stackCombatSpeed(target, catalog) ?? 0
    cut = Math.max(0, Math.floor((live * pct!) / 100))
    if (cut === 0 && pct! > 0 && live > 0) {
      cut = 1
    }
  } else {
    const strength = commandingHeroStats(catalog, attackerHero).strength
    cut = Math.max(0, Math.floor(strength / div!))
  }
  if (cut <= 0) {
    return { stack: target, lines: chanceLines }
  }
  const duration = Math.max(1, spec.conditionDuration)
  const prev = target.speedBoost
  const nextAmount = (prev?.amount ?? 0) - cut
  return {
    stack: {
      ...target,
      speedBoost: {
        amount: nextAmount,
        roundsLeft: Math.max(prev?.roundsLeft ?? 0, duration),
      },
    },
    lines: [
      ...chanceLines,
      `${target.qty} ${name} are slowed (−${cut} Speed, ${duration} round${duration === 1 ? '' : 's'}).`,
    ],
  }
}

/**
 * Subtract damage from the top creature, overflow onto the next at full
 * unit.health. Incoming damage is already post-mitigation.
 * `killOnOverflow`: a remainder > 0 that would wound the next creature
 * kills it instead. Remainder exactly 0 does nothing extra.
 */
export function applyStackDamage(
  stack: CombatStack,
  damage: number,
  fullHealth: number,
  killOnOverflow = false,
): {
  stack: CombatStack | null
  killed: number
  guardianSaved?: boolean
  /** Fortify: hit fully negated (sub-lethal). */
  negated?: boolean
} {
  if (damage <= 0 || stack.qty <= 0 || stack.indestructible) {
    return { stack, killed: 0 }
  }
  // Fortify: fully negate non-lethal hits (would not kill even one creature).
  if (stack.ignoresSublethal === true && damage < stack.topHealth) {
    return { stack, killed: 0, negated: true }
  }
  let qty = stack.qty
  let hp = stack.topHealth
  let remaining = damage
  let killed = 0
  const maxHp = Math.max(1, fullHealth)
  while (remaining > 0 && qty > 0) {
    if (remaining >= hp) {
      remaining -= hp
      qty -= 1
      killed += 1
      hp = maxHp
    } else if (killOnOverflow) {
      qty -= 1
      killed += 1
      remaining = 0
      hp = maxHp
    } else {
      hp -= remaining
      remaining = 0
    }
  }
  // Last Stand: floor qty; last protected unit sits at lastUnitHp.
  const stand = stack.lastStand
  if (stand && stand.minQty > 0 && qty < stand.minQty) {
    const floor = Math.min(stack.qty, Math.max(1, Math.floor(stand.minQty)))
    killed = Math.max(0, stack.qty - floor)
    qty = floor
    hp = Math.max(1, Math.min(maxHp, Math.floor(stand.lastUnitHp)))
  }
  if (qty <= 0) {
    const angel = stack.guardianAngel
    if (angel && angel.usesLeft > 0 && angel.snapshotQty > 0) {
      const restored = Math.max(1, Math.floor(angel.snapshotQty))
      return {
        stack: {
          ...stack,
          qty: restored,
          topHealth: maxHp,
          guardianAngel: undefined,
        },
        killed: 0,
        guardianSaved: true,
      }
    }
    return { stack: null, killed }
  }
  return { stack: { ...stack, qty, topHealth: hp }, killed }
}

export function applyStackHeal(
  stack: CombatStack,
  amount: number,
  fullHealth: number,
): { stack: CombatStack; healed: number } {
  if (amount <= 0 || stack.qty <= 0) {
    return { stack, healed: 0 }
  }
  const maxHp = Math.max(1, fullHealth)
  const missing = Math.max(0, maxHp - stack.topHealth)
  const healed = Math.min(amount, missing)
  if (healed <= 0) {
    return { stack, healed: 0 }
  }
  return { stack: { ...stack, topHealth: stack.topHealth + healed }, healed }
}

/**
 * Heal the front creature, then revive fallen units from a post-mitigation
 * damage pool. Caps at startingQty. Partial leftover (< max HP) becomes
 * the new front unit; leftover after that is unused.
 */
export function applyVampiricRevive(
  stack: CombatStack,
  pool: number,
  fullHealth: number,
): { stack: CombatStack; healed: number; revived: number } {
  const maxHp = Math.max(1, fullHealth)
  let remaining = Math.max(0, Math.floor(pool))
  if (remaining <= 0 || stack.qty <= 0) {
    return { stack, healed: 0, revived: 0 }
  }
  const cap = Math.max(0, stack.startingQty)
  let qty = stack.qty
  let hp = stack.topHealth
  let healed = 0
  let revived = 0

  const missing = Math.max(0, maxHp - hp)
  const topOff = Math.min(remaining, missing)
  hp += topOff
  remaining -= topOff
  healed += topOff

  while (remaining >= maxHp && qty < cap) {
    qty += 1
    remaining -= maxHp
    revived += 1
  }

  if (remaining > 0 && remaining < maxHp && qty < cap) {
    qty += 1
    hp = remaining
    remaining = 0
    revived += 1
  }

  if (healed === 0 && revived === 0) {
    return { stack, healed: 0, revived: 0 }
  }
  return { stack: { ...stack, qty, topHealth: hp }, healed, revived }
}

function playerLabel(battle: CombatBattle, side: CombatStack['side']): number {
  return side === 'atk' ? battle.attackerPlayer : battle.defenderPlayer
}

function stackName(
  catalog: ReferenceCatalog,
  unitId: number,
): string {
  return unitById(catalog, unitId)?.name ?? 'Unknown'
}

function spendRetaliationCharge(left: number): number {
  if (!Number.isFinite(left)) {
    return left
  }
  return Math.max(0, left - 1)
}

export function writeCombatStack(
  stacks: CombatStack[],
  id: string,
  next: CombatStack | null,
): CombatStack[] {
  if (!next || next.qty <= 0) {
    return stacks.filter((row) => row.id !== id)
  }
  return stacks.map((row) => (row.id === id ? next : row))
}

function writeStack(
  stacks: CombatStack[],
  id: string,
  next: CombatStack | null,
): CombatStack[] {
  return writeCombatStack(stacks, id, next)
}

/** Reflect buff: bounce % of damage taken; consume one hit charge. */
function applyReflectDamage(
  defender: CombatStack,
  attacker: CombatStack,
  damageTaken: number,
  kind: DmgKind,
  catalog: ReferenceCatalog,
): {
  defender: CombatStack
  attacker: CombatStack | null
  lines: string[]
  damage: number
} {
  const buff = defender.reflect
  if (!buff || buff.hitsLeft <= 0 || damageTaken <= 0) {
    return { defender, attacker, lines: [], damage: 0 }
  }
  if (buff.physicalOnly && kind !== 'physical') {
    return { defender, attacker, lines: [], damage: 0 }
  }
  const left = buff.hitsLeft - 1
  const nextDef: CombatStack = {
    ...defender,
    reflect: left > 0 ? { ...buff, hitsLeft: left } : undefined,
  }
  const bounce = Math.floor((damageTaken * buff.pct) / 100)
  if (bounce <= 0 || attacker.qty <= 0) {
    return { defender: nextDef, attacker, lines: [], damage: 0 }
  }
  const full = stackMaxHealth(attacker, catalog)
  const applied = applyStackDamage(attacker, bounce, full)
  const defName = stackName(catalog, defender.unitId)
  const atkName = stackName(catalog, attacker.unitId)
  return {
    defender: nextDef,
    attacker: applied.stack,
    lines: [
      `Reflect: ${defender.qty} ${defName} bounced ${bounce} dmg to ${attacker.qty} ${atkName}.`,
    ],
    damage: bounce,
  }
}

/** Hit-tick conditions, breaks-on-damage, Reflect, then on-hit inflict. */
function afterDamageTaken(
  defender: CombatStack,
  attacker: CombatStack,
  damageTaken: number,
  kind: DmgKind,
  catalog: ReferenceCatalog,
  random: () => number,
): {
  defender: CombatStack
  attacker: CombatStack | null
  lines: string[]
  reflectDamage: number
} {
  const lines: string[] = []
  let def = defender
  let atk: CombatStack | null = attacker
  const hitTick = applyHitTickConditions(def, catalog)
  def = hitTick.stack
  lines.push(...hitTick.lines)
  const broken = applyBreaksOnDamage(def, catalog)
  def = broken.stack
  lines.push(...broken.lines)
  let reflectDamage = 0
  if (atk) {
    const bounced = applyReflectDamage(def, atk, damageTaken, kind, catalog)
    def = bounced.defender
    atk = bounced.attacker
    lines.push(...bounced.lines)
    reflectDamage = bounced.damage
    if (atk && atk.qty > 0) {
      const inf = tryInflictCondition(attacker, def, catalog, random)
      def = inf.stack
      lines.push(...inf.lines)
    }
  }
  return { defender: def, attacker: atk, lines, reflectDamage }
}

type BlockLabel = 'Defense' | 'Resistance'

/**
 * Per attacking creature roll, then one mitigation pass (BR 4-12):
 * roll → dmg_pct → min_range penalty (summed) → flat Defense/Resistance ×
 * defender qty (floor ≥ connecting attackers) → hero % → incoming buff % →
 * stack outgoing % → per-connecting crit → bonus_dmg_tag/mult on the total.
 */
export function computeStrikeDamage(
  striker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
  random: () => number = Math.random,
  dmgPct: number | 'max' = 100,
  rangePenalty = false,
  defenderHero?: Hero,
  attackerHero?: Hero,
  mods?: StrikeMods,
): { damage: number; blocked: number; rangePenalty: boolean; crits: number } {
  const strikerUnit = unitById(catalog, striker.unitId)
  const kind = mods?.damageKind ?? damageKindOf(strikerUnit)
  const minBase =
    mods?.minDmg != null
      ? mods.minDmg
      : stackMinDmg(striker, catalog)
  const maxBase =
    mods?.maxDmg != null
      ? mods.maxDmg
      : stackMaxDmg(striker, catalog)
  const minDmg = scaleBySignedPct(minBase, outputMinPct(striker, kind))
  const maxDmg = scaleBySignedPct(maxBase, outputMaxPct(striker, kind))
  const pct =
    dmgPct === 'max' ? null : Math.min(100, Math.max(0, dmgPct))
  const totalPct = outputTotalPct(striker, kind) + (mods?.outgoingPctAdd ?? 0)
  const crit = liveCritStats(
    striker,
    catalog,
    attackerHero,
    mods?.critPctAdd ?? 0,
    mods?.critAmtAdd ?? 0,
  )
  const disarm = striker.disarm
  const disarmForcesMin =
    disarm != null &&
    disarm.roundsLeft > 0 &&
    (!disarm.physicalOnly || kind === 'physical')
  const guaranteed = disarmForcesMin
    ? minDmg
    : mods?.guaranteedDamage
  const ignoreArmor =
    striker.ignoreTargetArmor === true &&
    (!striker.ignoreTargetArmorPhysicalOnly || kind === 'physical')
  const atkShape = unitAttackShape(strikerUnit)
  const bonusTags = atkShape.bonusDmgTags
  const bonusMult = atkShape.bonusDmgMult
  const targetUnit = unitById(catalog, target.unitId)
  const applyTagBonus =
    bonusTags.length > 0 &&
    bonusMult != null &&
    bonusMult > 0 &&
    bonusMult !== 1 &&
    bonusTags.some((tag) => unitHasTag(targetUnit, tag))
  let totalRaw = 0
  let connects = 0
  for (let i = 0; i < striker.qty; i += 1) {
    if (!strikeConnects(mods)) {
      continue
    }
    connects += 1
    let raw: number
    if (guaranteed != null) {
      raw = guaranteed
      if (pct != null) {
        raw = Math.floor((raw * pct) / 100)
      }
    } else {
      raw =
        dmgPct === 'max'
          ? maxDmg
          : rollAttackDamage(1, minDmg, maxDmg, random)
      if (pct != null) {
        raw = Math.floor((raw * pct) / 100)
      }
      if (rangePenalty) {
        raw = Math.floor(raw * minRangePenaltyMult(catalog))
      }
    }
    totalRaw += raw
  }
  if (connects <= 0) {
    return {
      damage: 0,
      blocked: 0,
      rangePenalty: guaranteed != null ? false : rangePenalty,
      crits: 0,
    }
  }
  // Flat soak uses defender qty; chip floor stays 1 per connecting attacker
  // (re-anchoring the floor to defender qty would inflate hits when raw < defQty).
  const mit = mitigateIncoming(totalRaw, target, catalog, kind, defenderHero, {
    ignoreArmor,
    minDamage: connects,
  })
  let damage = scaleBySignedPct(mit.damage, totalPct)
  let blocked = mit.blocked + Math.max(0, mit.damage - damage)
  let crits = 0
  // Crits still roll once per connecting creature against an equal share of
  // post-mitigation damage so multi-stack crit rate is unchanged.
  const critBase = connects > 0 ? Math.floor(damage / connects) : damage
  for (let i = 0; i < connects; i += 1) {
    if (damage > 0 && crit.pct > 0 && random() * 100 < crit.pct) {
      const base = critBase > 0 ? critBase : damage
      damage += critBonusDamage(base, crit.amt, crit.minBonus)
      crits += 1
    }
  }
  if (applyTagBonus && damage > 0) {
    const beforeTag = damage
    damage = Math.max(0, Math.floor(damage * bonusMult))
    if (damage < beforeTag) {
      blocked += beforeTag - damage
    }
  }
  return {
    damage,
    blocked,
    rangePenalty: guaranteed != null ? false : rangePenalty,
    crits,
  }
}

export function applyStrike(
  striker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
  random: () => number,
  dmgPct: number | 'max' = 100,
  rangePenalty = false,
  defenderHero?: Hero,
  attackerHero?: Hero,
  mods?: StrikeMods,
): {
  damage: number
  blocked: number
  blockBy: BlockLabel | null
  rangePenalty: boolean
  killed: number
  crits: number
  parried: boolean
  missed: boolean
  /** When missed due to Blind (vs Camouflage evade). */
  blindMiss?: boolean
  /** Resolved miss chance % (Blind or evade) when `missed` is true. */
  missChancePct?: number
  guardianSaved: boolean
  /** Fortify negated a sub-lethal hit. */
  fortifyNegated?: boolean
  stack: CombatStack | null
  /** Original Spell Reflect buffee after consuming a use (when redirected). */
  spellReflectSource?: CombatStack
  /** True when this strike was redirected by Spell Reflect. */
  spellRedirected?: boolean
} {
  const kind = mods?.damageKind ?? damageKindOf(unitById(catalog, striker.unitId))
  const label: BlockLabel = kind === 'magic' ? 'Resistance' : 'Defense'
  if (target.indestructible) {
    return {
      damage: 0,
      blocked: 0,
      blockBy: null,
      rangePenalty,
      killed: 0,
      crits: 0,
      parried: false,
      missed: false,
      guardianSaved: false,
      stack: target,
    }
  }
  if (
    kind === 'physical' &&
    (target.parryPhysicalUses ?? 0) > 0 &&
    !(mods?.isRetaliation === true && target.parryIgnoresRetaliation === true)
  ) {
    const left = (target.parryPhysicalUses ?? 1) - 1
    return {
      damage: 0,
      blocked: 0,
      blockBy: null,
      rangePenalty: false,
      killed: 0,
      crits: 0,
      parried: true,
      missed: false,
      guardianSaved: false,
      stack: {
        ...target,
        parryPhysicalUses: left > 0 ? left : undefined,
        parryIgnoresRetaliation:
          left > 0 ? target.parryIgnoresRetaliation : undefined,
      },
    }
  }
  if (attackerBlindMisses(striker, catalog, mods, random)) {
    return {
      damage: 0,
      blocked: 0,
      blockBy: null,
      rangePenalty: false,
      killed: 0,
      crits: 0,
      parried: false,
      missed: true,
      blindMiss: true,
      missChancePct: BLIND_MISS_PCT,
      guardianSaved: false,
      stack: target,
    }
  }
  const evade = defenderEvades(target, mods, random)
  if (evade.evades) {
    return {
      damage: 0,
      blocked: 0,
      blockBy: null,
      rangePenalty: false,
      killed: 0,
      crits: 0,
      parried: false,
      missed: true,
      missChancePct: evade.chancePct,
      guardianSaved: false,
      stack: target,
    }
  }
  let strikeMods = mods
  let liveTarget = target
  // Immunity: blanket zero damage from any source (not Deflect's min-dmg redirect).
  if (
    (liveTarget.immunityHitsLeft ?? 0) > 0 &&
    mods?.isReflect !== true
  ) {
    const left = (liveTarget.immunityHitsLeft ?? 1) - 1
    return {
      damage: 0,
      blocked: 0,
      blockBy: null,
      rangePenalty: false,
      killed: 0,
      crits: 0,
      parried: false,
      missed: false,
      guardianSaved: false,
      stack: {
        ...liveTarget,
        immunityHitsLeft: left > 0 ? left : undefined,
        skipRetaliationOnce:
          liveTarget.parryIgnoresRetaliation === true
            ? true
            : liveTarget.skipRetaliationOnce,
      },
    }
  }
  // Spell Reflect: Magic attacks redirect to a random enemy before damage lands.
  if (
    kind === 'magic' &&
    mods?.skipSpellReflect !== true &&
    mods?.isReflect !== true &&
    (liveTarget.spellReflect?.usesLeft ?? 0) > 0 &&
    mods?.battleStacks &&
    mods.battleStacks.length > 0
  ) {
    const pool = mods.battleStacks.filter(
      (row) =>
        row.qty > 0 &&
        row.id !== liveTarget.id &&
        row.side !== liveTarget.side &&
        !isHeroStack(row) &&
        !row.indestructible &&
        isCreatureArmyUnit(unitById(catalog, row.unitId)) &&
        !isUntargetableStack(row, catalog),
    )
    if (pool.length > 0) {
      const pick =
        pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]!
      const left = (liveTarget.spellReflect?.usesLeft ?? 1) - 1
      const source: CombatStack = {
        ...liveTarget,
        spellReflect: left > 0 ? { usesLeft: left } : undefined,
      }
      const redirected = applyStrike(
        striker,
        pick,
        catalog,
        random,
        dmgPct,
        rangePenalty,
        defenderHero,
        attackerHero,
        { ...mods, skipSpellReflect: true },
      )
      return {
        ...redirected,
        spellReflectSource: source,
        spellRedirected: true,
      }
    }
  }
  // Deflect: full pipeline bypass — flat % of attacker's min possible roll.
  const deflect = liveTarget.deflect
  if (
    deflect &&
    deflect.usesLeft > 0 &&
    mods?.isReflect !== true
  ) {
    const minPer = stackMinDmg(striker, catalog)
    const minRoll = Math.max(0, minPer * striker.qty)
    const raw = Math.max(0, Math.floor((minRoll * deflect.pct) / 100))
    const left = deflect.usesLeft - 1
    const nextTarget: CombatStack = {
      ...liveTarget,
      deflect: left > 0 ? { pct: deflect.pct, usesLeft: left } : undefined,
    }
    const full = stackMaxHealth(nextTarget, catalog)
    const applied = applyStackDamage(nextTarget, raw, full, false)
    return {
      damage: applied.negated === true ? 0 : raw,
      blocked: 0,
      blockBy: null,
      rangePenalty: false,
      killed: applied.killed,
      crits: 0,
      parried: false,
      missed: false,
      guardianSaved: applied.guardianSaved === true,
      fortifyNegated: applied.negated === true,
      stack: applied.stack,
    }
  }
  if ((liveTarget.markHitsLeft ?? 0) > 0) {
    if (strikeMods?.guaranteedDamage == null) {
      strikeMods = {
        ...strikeMods,
        guaranteedDamage: stackMaxDmg(striker, catalog),
      }
    }
    const left = (liveTarget.markHitsLeft ?? 1) - 1
    liveTarget = {
      ...liveTarget,
      markHitsLeft: left > 0 ? left : undefined,
    }
  }
  const rolled = computeStrikeDamage(
    striker,
    liveTarget,
    catalog,
    random,
    dmgPct,
    rangePenalty,
    defenderHero,
    attackerHero,
    strikeMods,
  )
  let damage = rolled.damage
  let blocked = rolled.blocked
  const targetUnit = unitById(catalog, liveTarget.unitId)
  const strikerUnit = unitById(catalog, striker.unitId)
  if (
    !isSiegeEngineUnit(strikerUnit) &&
    (isWallSegmentUnit(targetUnit) || isTerrainBlockerUnit(targetUnit))
  ) {
    const mult = wallDamageMult(catalog)
    const reduced = Math.floor(damage * mult)
    blocked += damage - reduced
    damage = reduced
  }
  const full = stackMaxHealth(liveTarget, catalog)
  const overflowKill =
    striker.killOnOverflow === true ||
    unitAttackShape(strikerUnit).killOnOverflow === true
  const applied = applyStackDamage(
    liveTarget,
    damage,
    full,
    overflowKill,
  )
  return {
    damage: applied.negated === true ? 0 : damage,
    blocked: applied.negated === true ? 0 : blocked,
    blockBy: applied.negated === true ? null : blocked > 0 ? label : null,
    rangePenalty,
    killed: applied.killed,
    crits: applied.negated === true ? 0 : rolled.crits,
    parried: false,
    missed: false,
    guardianSaved: applied.guardianSaved === true,
    fortifyNegated: applied.negated === true,
    stack: applied.stack,
  }
}

export function attackLogLines(
  attacker: CombatStack,
  targetBefore: CombatStack,
  catalog: ReferenceCatalog,
  damage: number,
  killed: number,
  remainingQty: number,
  battle: CombatBattle,
): string[] {
  return [
    hitLogLine(attacker, targetBefore, catalog, damage, killed, 'attacked'),
    remainingLogLine(
      battle,
      attacker,
      targetBefore,
      catalog,
      attacker.qty,
      remainingQty,
    ),
  ]
}

/**
 * Bouncy Bomb death pulse: when kill_chain_pulse units die, deal
 * min_dmg × deaths to enemies in their pulse radius from the dying hex.
 */
function applyKillChainDeathPulse(
  dying: CombatStack,
  deaths: number,
  stacks: CombatStack[],
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  heroes: CombatHeroes | undefined,
  _random: () => number = Math.random,
): {
  stacks: CombatStack[]
  lines: string[]
  hitKeys: string[]
  unitDeaths: Record<number, number>
} {
  const empty = {
    stacks,
    lines: [] as string[],
    hitKeys: [] as string[],
    unitDeaths: {} as Record<number, number>,
  }
  if (deaths <= 0) {
    return empty
  }
  const abilities = unitAttackShape(unitById(catalog, dying.unitId))
  if (abilities.killChainPulse !== true) {
    return empty
  }
  const per = stackMinDmg(dying, catalog)
  const raw = Math.max(0, per * deaths)
  if (raw <= 0) {
    return empty
  }
  const pulseSpec: ReturnType<typeof unitAttackShape> = {
    ...abilities,
    shape: 'pulse',
    radius: Math.max(1, abilities.radius || 1),
  }
  const from = { q: dying.q, r: dying.r }
  const lines: string[] = [
    `Bounce Blast: ${deaths} death${deaths === 1 ? '' : 's'} → pulse for ${raw}!`,
  ]
  const pulseHits = resolveShapeHits(
    { ...dying, qty: Math.max(1, dying.qty) },
    from,
    null,
    { ...battle, stacks },
    catalog,
    tiles,
    _random,
    {
      shape: 'pulse',
      radius: Math.max(1, abilities.radius || 1),
    },
    false,
  )
  const hitKeys: string[] = geometricHexes(
    pulseSpec,
    from,
    from,
    { ...battle, stacks },
    boardKeys(tiles),
    dying.side,
    tiles,
    catalog,
  ).map((hex) => occupancyKey(hex.q, hex.r))
  let nextStacks = stacks
  let unitDeaths: Record<number, number> = {}
  const pulseStriker: CombatStack = { ...dying, qty: Math.max(1, dying.qty) }
  const seen = new Set<string>()
  for (const hit of pulseHits) {
    if (!hit.stack || hit.stack.id === dying.id || hit.stack.side === dying.side) {
      continue
    }
    if (seen.has(hit.stack.id)) {
      continue
    }
    seen.add(hit.stack.id)
    const victim = nextStacks.find((row) => row.id === hit.stack!.id)
    if (!victim || victim.qty <= 0 || isHeroStack(victim)) {
      continue
    }
    const before = victim
    const kind = damageKindOf(unitById(catalog, dying.unitId))
    const mit = mitigateIncoming(
      raw,
      before,
      catalog,
      kind,
      heroForSide(before.side, heroes),
    )
    const full = stackMaxHealth(before, catalog)
    const applied = applyStackDamage(before, mit.damage, full, false)
    const taken = applied.negated === true ? 0 : mit.damage
    unitDeaths = mergeUnitDeaths(unitDeaths, before.unitId, applied.killed)
    // Death pulse never provokes retaliation from units it hits.
    const nextVictim = applied.stack
      ? { ...applied.stack, skipRetaliationOnce: true }
      : null
    nextStacks = writeStack(nextStacks, before.id, nextVictim)
    lines.push(
      hitLogLine(
        pulseStriker,
        before,
        catalog,
        taken,
        applied.killed,
        'attacked',
        mit.blocked,
        mit.blockBy,
        false,
        0,
        false,
        false,
        applied.guardianSaved === true,
        false,
        applied.negated === true,
      ),
    )
    if (taken > 0 || applied.killed > 0) {
      hitKeys.push(occupancyKey(before.q, before.r))
    }
  }
  return { stacks: nextStacks, lines, hitKeys, unitDeaths }
}

function hitLogLine(
  striker: CombatStack,
  targetBefore: CombatStack,
  catalog: ReferenceCatalog,
  damage: number,
  killed: number,
  verb: 'attacked' | 'retaliated against',
  blocked = 0,
  blockBy: BlockLabel | null = null,
  rangePenalty = false,
  crits = 0,
  parried = false,
  missed = false,
  guardianSaved = false,
  blindMiss = false,
  fortifyNegated = false,
  missChancePct?: number,
): string {
  const atkName = stackName(catalog, striker.unitId)
  const defName = stackName(catalog, targetBefore.unitId)
  let line = `${striker.qty} ${atkName} ${verb} ${targetBefore.qty} ${defName} for ${damage} dmg`
  const notes: string[] = []
  if (parried) {
    notes.push('parried')
  }
  if (missed) {
    if (blindMiss) {
      notes.push(
        `missed (Blind ${formatChancePct(missChancePct ?? BLIND_MISS_PCT)}%)`,
      )
    } else if (missChancePct != null && missChancePct > 0) {
      notes.push(`missed (${formatChancePct(missChancePct)}% evade)`)
    } else {
      notes.push('missed')
    }
  }
  if (fortifyNegated) {
    notes.push('Fortify')
  }
  if (guardianSaved) {
    notes.push('Guardian Angel')
  }
  if (crits > 0) {
    notes.push(crits === 1 ? 'crit' : `${crits} crits`)
  }
  if (rangePenalty) {
    notes.push('range penalty')
  }
  if (blockBy) {
    notes.push(`${blocked} blocked by ${blockBy}`)
  }
  if (notes.length > 0) {
    line += ` (${notes.join(', ')})`
  }
  if (killed > 0) {
    line += ` and ${killed} ${defName} died`
  }
  return `${line}.`
}

function remainingLogLine(
  battle: CombatBattle,
  attacker: CombatStack,
  defender: CombatStack,
  catalog: ReferenceCatalog,
  atkQty: number,
  defQty: number,
): string {
  const atkName = stackName(catalog, attacker.unitId)
  const defName = stackName(catalog, defender.unitId)
  const atkPlayer = playerLabel(battle, attacker.side)
  const defPlayer = playerLabel(battle, defender.side)
  if (atkQty <= 0) {
    return defQty <= 0
      ? `Player ${atkPlayer}'s ${atkName} were destroyed and Player ${defPlayer}'s ${defName} were destroyed.`
      : `Player ${defPlayer} now has ${defQty} ${defName} and Player ${atkPlayer}'s ${atkName} were destroyed.`
  }
  return defQty <= 0
    ? `Player ${atkPlayer} now has ${atkQty} ${atkName} and Player ${defPlayer}'s ${defName} were destroyed.`
    : `Player ${atkPlayer} now has ${atkQty} ${atkName} and Player ${defPlayer} has ${defQty} ${defName}.`
}

export type AttackAim = {
  targetId: string | null
  hex: { q: number; r: number }
  /** Where the attacker stands for this attack. Omit = current hex. */
  stand?: { q: number; r: number }
}

export function resolveAttack(
  battle: CombatBattle,
  attackerId: string,
  catalog: ReferenceCatalog,
  aim: AttackAim,
  tiles: CombatTile[],
  heroes?: CombatHeroes,
  random: () => number = Math.random,
  strike?: StrikeMods,
  allowFriendly = false,
): {
  battle: CombatBattle
  log: { lines: string[] }
  hitKeys: string[]
  healKeys: string[]
  hitColor: HitFlashColor
  /** Updated hero mana from Tower Wizard/Sorcerer passives (when changed). */
  heroes?: CombatHeroes
} | null {
  const before = battle.stacks.find((row) => row.id === attackerId)
  if (!before || before.qty <= 0) {
    return null
  }
  if (isMagicAttackSilenced(before, catalog)) {
    return null
  }
  const stand = aim.stand ?? { q: before.q, r: before.r }
  battle = moveStack(battle, attackerId, stand.q, stand.r)
  const attacker = battle.stacks.find((row) => row.id === attackerId)
  if (!attacker || attacker.qty <= 0) {
    return null
  }
  const rushMods = strikeModsFromCharge(
    attacker,
    catalog,
    heroForSide(attacker.side, heroes),
  )
  const strikeMods: StrikeMods | undefined =
    strike || rushMods ? { ...rushMods, ...strike } : undefined
  const atkUnit = unitById(catalog, attacker.unitId)
  const spec = unitAttackShape(atkUnit)
  const noAim =
    shapeIsUntargeted(spec.shape) || shapePulsesOnMove(spec.shape)
  const aimed =
    (aim.targetId
      ? battle.stacks.find((row) => row.id === aim.targetId)
      : null) ??
    battle.stacks.find(
      (row) => row.q === aim.hex.q && row.r === aim.hex.r,
    ) ??
    null

  const maxRange = stackMaxRange(attacker, catalog)
  const aimDist = hexDistance(attacker, aim.hex)
  if (!noAim) {
    if (spec.shape === 'beam' || spec.shape === 'aoe' || spec.shape === 'line') {
      if (aimDist < 1 || aimDist > maxRange) {
        return null
      }
      if (!hasLineOfSight(attacker, aim.hex, tiles, battle.stacks, catalog)) {
        return null
      }
      // Beam / Line require a living unit on the aim hex — no ground-only clicks.
      if (spec.shape === 'beam' || spec.shape === 'line') {
        if (
          !aimed ||
          !isValidAttackTarget(
            attacker,
            aimed,
            catalog,
            tiles,
            battle.stacks,
            allowFriendly,
          )
        ) {
          return null
        }
      }
    } else if (
      !aimed ||
      !isValidAttackTarget(
        attacker,
        aimed,
        catalog,
        tiles,
        battle.stacks,
        allowFriendly,
      )
    ) {
      return null
    }
  }

  // Goblin Hammersmith Repair Strike: heal tagged ally instead of damaging.
  if (aimed && isHealAllyTarget(attacker, aimed, catalog)) {
    const amount = healAmtForAllyRepair(attacker, catalog)
    const full = stackMaxHealth(aimed, catalog)
    const healed = applyStackHeal(aimed, amount, full)
    const atkName = stackName(catalog, attacker.unitId)
    const defName = stackName(catalog, aimed.unitId)
    const stacks = writeStack(
      writeStack(battle.stacks, aimed.id, healed.stack),
      attackerId,
      { ...attacker, hasActedThisRound: true },
    )
    return {
      battle: { ...battle, stacks },
      log: {
        lines: [
          healed.healed > 0
            ? `${attacker.qty} ${atkName} repaired ${aimed.qty} ${defName} for ${healed.healed} HP.`
            : `${attacker.qty} ${atkName} repaired ${aimed.qty} ${defName} (already full).`,
        ],
      },
      hitKeys: [],
      healKeys: [occupancyKey(aimed.q, aimed.r)],
      hitColor: 'green',
    }
  }

  let strikeModsLive: StrikeMods | null | undefined = strikeMods
  const chargeHexes = strikeMods?.chargeHexes ?? 0
  if (spec.chargeDmgEscalation && chargeHexes > 0) {
    const hero = heroForSide(attacker.side, heroes)
    const strength = commandingHeroStats(catalog, hero).strength
    const kind = damageKindOf(atkUnit)
    const minDmg = scaleBySignedPct(
      stackMinDmg(attacker, catalog),
      outputMinPct(attacker, kind),
    )
    const maxDmg = scaleBySignedPct(
      stackMaxDmg(attacker, catalog),
      outputMaxPct(attacker, kind),
    )
    const base =
      strikeModsLive?.guaranteedDamage ??
      rollAttackDamage(1, minDmg, maxDmg, random)
    const escalated = escalateChargeDamage(
      base,
      chargeHexes,
      strength,
      spec.escalationMult ?? 1.5,
      spec.escalationChancePctStat ?? 1,
      spec.escalationMinIncrease ?? 1,
      random,
    )
    strikeModsLive = { ...(strikeModsLive ?? {}), guaranteedDamage: escalated }
  }

  const hits = resolveShapeHits(
    attacker,
    aim.hex,
    aimed && (allowFriendly || aimed.side !== attacker.side) ? aimed : null,
    battle,
    catalog,
    tiles,
    random,
    null,
    allowFriendly,
    {
      chargePathOrigin:
        strikeMods?.chargePathOrigin ??
        (spec.shape === 'charge_line'
          ? { q: before.q, r: before.r }
          : null),
    },
  )
  // Attack-trail leave-behind (Skeleton Caster Shadow, Imp Fire, Storm, etc.).
  // Multi: one roll per landed bolt hex (Tesla Coil). Others: full geometry.
  const trailLines: string[] = []
  {
    const trail =
      spec.shape === 'multi'
        ? hits.map((hit) => hit.hex)
        : spec.shape === 'spiral'
          ? []
          : geometricHexes(
              spec,
              { q: attacker.q, r: attacker.r },
              aim.hex,
              battle,
              boardKeys(tiles),
              attacker.side,
              tiles,
              catalog,
            )
    if (trail.length > 0) {
      const left = tryLeaveGroundEffectOnAttackPath(
        battle,
        attackerId,
        catalog,
        trail,
        tiles,
        heroForSide(attacker.side, heroes),
        random,
      )
      battle = left.battle
      trailLines.push(...left.lines)
    }
  }
  // Tidal Caller: extinguish Fire (or other) along the line path.
  if (spec.clearsGroundEffectId != null && spec.clearsGroundEffectId > 0) {
    const clearHexes =
      spec.shape === 'line' || spec.shape === 'charge_line'
        ? geometricHexes(
            spec,
            { q: attacker.q, r: attacker.r },
            aim.hex,
            battle,
            boardKeys(tiles),
            attacker.side,
            tiles,
            catalog,
          ).map((hex) => occupancyKey(hex.q, hex.r))
        : hits.map((hit) => occupancyKey(hit.hex.q, hit.hex.r))
    const cleared = clearGroundEffectTemplateHexes(
      battle,
      clearHexes,
      spec.clearsGroundEffectId,
      tiles,
    )
    battle = cleared.battle
    if (cleared.cleared > 0) {
      const label =
        spec.clearsGroundEffectId === 6
          ? 'Fire'
          : `ground effect ${spec.clearsGroundEffectId}`
      trailLines.push(
        `${stackName(catalog, attacker.unitId)}: extinguished ${cleared.cleared} ${label} tile${cleared.cleared === 1 ? '' : 's'}.`,
      )
    }
  }
  const rangePenalty = minRangePenaltyApplies(
    attacker,
    battle.stacks,
    catalog,
  )
  const blockedByAttacker = unitBlocksEnemyRetaliation(atkUnit)
  let stacks = battle.stacks
  let atk: CombatStack | null = attacker
  const lines: string[] = [...trailLines]
  const hitKeys: string[] = []
  const healKeys: string[] = []
  let unitDeaths = { ...(battle.unitDeaths ?? {}) }
  let roundUnitDeaths = { ...(battle.roundUnitDeaths ?? {}) }
  const noteKill = (unitId: number, killed: number) => {
    unitDeaths = mergeUnitDeaths(unitDeaths, unitId, killed)
    roundUnitDeaths = mergeUnitDeaths(roundUnitDeaths, unitId, killed)
  }
  // S6-44 Tower passives: track offensive Magic damage only (never retaliation).
  let wizardMagicDealt = false
  const sorcererMagicTaken = new Map<string, CombatSide>()
  let heroState: CombatHeroes = { atk: heroes?.atk, def: heroes?.def }

  const live = (id: string) => stacks.find((row) => row.id === id) ?? null

  const applyVampiricFromDamage = (
    striker: CombatStack,
    pool: number,
  ): CombatStack => {
    if (!striker.vampiricStrike || pool <= 0) {
      return striker
    }
    const full = stackMaxHealth(striker, catalog)
    const next = applyVampiricRevive(striker, pool, full)
    if (next.healed <= 0 && next.revived <= 0) {
      return striker
    }
    const name = stackName(catalog, striker.unitId)
    lines.push(
      `Vampiric Strike: ${striker.qty} ${name} now ${next.stack.qty}/${next.stack.startingQty} (front ${next.stack.topHealth}/${full}).`,
    )
    healKeys.push(occupancyKey(striker.q, striker.r))
    return next.stack
  }

  const uniqueHitIds = [
    ...new Set(
      hits
        .map((hit) => hit.stack?.id)
        .filter((id): id is string => id != null),
    ),
  ]

  let didRetaliate = false
  const tryRetaliate = (preemptivePass: boolean) => {
    if (!atk || blockedByAttacker) {
      return
    }
    // Monk / Ranger: attack may suppress post-attack retaliation only.
    if (!preemptivePass) {
      if (citadelUnitGetsPassives(catalog, atk)) {
        const chance = monkSuppressChancePct(
          catalog,
          heroForSide(atk.side, heroes),
          { ...battle, stacks },
          atk.side,
        )
        if (chance > 0) {
          const triggered = rollChancePct(chance, random)
          lines.push(
            chanceRollLog('Monk', chance, triggered, {
              action: 'to suppress retaliation',
            }),
          )
          if (triggered) {
            return
          }
        }
      }
      if (groveUnitGetsPassives(catalog, atk)) {
        const chance = rangerSuppressChancePct(
          catalog,
          heroForSide(atk.side, heroes),
          { ...battle, stacks },
          atk.side,
        )
        if (chance > 0) {
          const triggered = rollChancePct(chance, random)
          lines.push(
            chanceRollLog('Ranger', chance, triggered, {
              action: 'for Surprise Attack (no retaliation)',
            }),
          )
          if (triggered) {
            return
          }
        }
      }
    }
    for (const id of uniqueHitIds) {
      if (!atk) {
        return
      }
      const def = live(id)
      if (!def || def.qty <= 0) {
        continue
      }
      if (def.skipRetaliationOnce) {
        stacks = writeStack(stacks, id, {
          ...def,
          skipRetaliationOnce: undefined,
        })
        continue
      }
      const spec = unitRetaliation(unitById(catalog, def.unitId), catalog)
      const buffPreemptive = (def.preemptiveStrikeUsesLeft ?? 0) > 0
      const isPreemptive = spec.preemptive === true || buffPreemptive
      if (isPreemptive !== preemptivePass) {
        continue
      }
      if (attackDistance(atk, def) !== 1) {
        continue
      }
      if (def.retaliationsLeft <= 0) {
        continue
      }
      if (isStunned(def, catalog)) {
        continue
      }
      if (isMagicAttackSilenced(def, catalog)) {
        continue
      }

      const fireRetaliationStrike = (retaliator: CombatStack): CombatStack => {
        if (!atk || atk.qty <= 0 || retaliator.qty <= 0) {
          return retaliator
        }
        const cry = retaliator.battleCryRetaliation
        const useCry = cry != null && cry.usesLeft > 0
        const basePct: number | 'max' = useCry ? cry.pct : spec.dmgPct
        const aim = { q: atk.q, r: atk.r }
        const shaped =
          spec.shape != null && spec.shape !== 'single'
            ? resolveShapeHits(
                retaliator,
                aim,
                atk,
                { ...battle, stacks },
                catalog,
                tiles,
                random,
                {
                  shape: spec.shape,
                  radius: spec.radius ?? 1,
                  ...(spec.jumps != null ? { jumps: spec.jumps } : {}),
                  ...(spec.falloff != null ? { falloff: spec.falloff } : {}),
                },
              )
            : [
                {
                  hex: aim,
                  stack: atk,
                  dmgPct: 100,
                },
              ]
        let nextRetaliator = retaliator
        for (const hit of shaped) {
          if (!atk || atk.qty <= 0 || nextRetaliator.qty <= 0) {
            break
          }
          const defLive = hit.stack ? live(hit.stack.id) : null
          if (!defLive || defLive.qty <= 0 || defLive.side === nextRetaliator.side) {
            continue
          }
          const strikePct: number | 'max' =
            basePct === 'max'
              ? 'max'
              : Math.max(
                  0,
                  Math.floor((basePct * Math.max(0, hit.dmgPct)) / 100),
                )
          const before = defLive
          const struck = applyStrike(
            nextRetaliator,
            defLive,
            catalog,
            random,
            strikePct,
            minRangePenaltyApplies(nextRetaliator, stacks, catalog),
            heroForSide(defLive.side, heroes),
            heroForSide(nextRetaliator.side, heroes),
            {
              isRetaliation: true,
              battleStacks: stacks,
              zoneEvasionPct: zoneEvasionPctForStack(
                { ...battle, stacks },
                defLive,
                catalog,
              ),
              outgoingPctAdd: necromancerShadowDamageBonusPct(
                nextRetaliator,
                { ...battle, stacks },
                catalog,
                heroes,
              ),
            },
          )
          const hitVictim = struck.spellRedirected
            ? struck.stack
            : before
          const pulseVictim =
            struck.spellRedirected && struck.stack
              ? (live(struck.stack.id) ?? struck.stack)
              : before
          lines.push(
            hitLogLine(
              nextRetaliator,
              hitVictim ?? before,
              catalog,
              struck.damage,
              struck.killed,
          'retaliated against',
              struck.blocked,
              struck.blockBy,
              struck.rangePenalty,
              struck.crits,
              struck.parried,
              struck.missed,
              struck.guardianSaved,
              struck.blindMiss === true,
              struck.fortifyNegated === true,
              struck.missChancePct,
            ),
          )
          if (struck.spellReflectSource) {
            stacks = writeStack(stacks, before.id, struck.spellReflectSource)
            if (struck.spellRedirected) {
              lines.push(
                `Spell Reflect: ${before.qty} ${unitById(catalog, before.unitId)?.name ?? 'Unknown'} redirects the attack!`,
              )
            }
          }
          if (struck.damage > 0 && hitVictim) {
            hitKeys.push(occupancyKey(hitVictim.q, hitVictim.r))
          }
          noteKill(pulseVictim.unitId, struck.killed)
          nextRetaliator = applyVampiricFromDamage(
            nextRetaliator,
            struck.damage,
          )
          stacks = writeStack(
            stacks,
            struck.spellRedirected && struck.stack
              ? struck.stack.id
              : defLive.id,
            struck.stack,
          )
          if (
            (struck.spellRedirected ? struck.stack?.id : defLive.id) ===
            attackerId
          ) {
            atk = struck.stack
          }
          if (struck.killed > 0) {
            const boom = applyKillChainDeathPulse(
              pulseVictim,
              struck.killed,
              stacks,
              battle,
              catalog,
              tiles,
              heroes,
            )
            stacks = boom.stacks
            lines.push(...boom.lines)
            hitKeys.push(...boom.hitKeys)
            for (const [uid, n] of Object.entries(boom.unitDeaths)) {
              noteKill(Number(uid), n)
            }
            if (
              (struck.spellRedirected ? struck.stack?.id : defLive.id) ===
              attackerId
            ) {
              atk = live(attackerId)
            }
            const refreshedRet = live(nextRetaliator.id)
            if (refreshedRet) {
              nextRetaliator = refreshedRet
            }
          }
          if (struck.stack && struck.damage > 0) {
            const damagedId =
              struck.spellRedirected && struck.stack
                ? struck.stack.id
                : defLive.id
            const postDef = live(damagedId) ?? struck.stack
            const post = afterDamageTaken(
              postDef,
              nextRetaliator,
              struck.damage,
              damageKindOf(unitById(catalog, nextRetaliator.unitId)),
              catalog,
              random,
            )
            stacks = writeStack(stacks, damagedId, post.defender)
            if (damagedId === attackerId) {
              atk = post.defender
            }
            nextRetaliator = post.attacker ?? nextRetaliator
            lines.push(...post.lines)
            if (post.reflectDamage > 0) {
              hitKeys.push(occupancyKey(nextRetaliator.q, nextRetaliator.r))
            }
          }
        }
        if (useCry && cry) {
          const left = cry.usesLeft - 1
          nextRetaliator = {
            ...nextRetaliator,
            battleCryRetaliation:
              left > 0 ? { pct: cry.pct, usesLeft: left } : undefined,
          }
        }
        if ((nextRetaliator.preemptiveStrikeUsesLeft ?? 0) > 0 && preemptivePass) {
          const left = (nextRetaliator.preemptiveStrikeUsesLeft ?? 1) - 1
          nextRetaliator = {
            ...nextRetaliator,
            preemptiveStrikeUsesLeft: left > 0 ? left : undefined,
          }
        }
        return nextRetaliator
      }

      // Unlimited retaliation + Vampiric Strike can revive every strike;
      // balance is deferred project-wide.
      let retaliator: CombatStack = {
        ...def,
        retaliationsLeft: spendRetaliationCharge(def.retaliationsLeft),
      }
      retaliator = fireRetaliationStrike(retaliator)
      didRetaliate = true
      // Rogue: Energy when a Fortress unit's attack is retaliated against.
      if (
        atk &&
        fortressUnitGetsPassives(catalog, atk) &&
        isRogueHero(catalog, heroForSide(atk.side, heroState))
      ) {
        const rogue = heroForSide(atk.side, heroState)
        if (rogue) {
          const amount = rogueEnergyPerTrigger(catalog, rogue)
          const gained = grantHeroEnergy(catalog, rogue, amount)
          if (gained.current_energy > rogue.current_energy) {
            heroState =
              atk.side === 'atk'
                ? { ...heroState, atk: gained }
                : { ...heroState, def: gained }
            lines.push(
              `Rogue: +${amount} Energy (${gained.current_energy}/${poolMax(catalog, gained, 1)}).`,
            )
          }
        }
      }
      // Chronomancer: teleport is tied to the retaliation event, not damage landing.
      if (
        spec.teleportsAttacker === true &&
        atk &&
        atk.qty > 0 &&
        !isHeroStack(atk)
      ) {
        const chance = Math.max(0, Math.floor(spec.teleportChancePct ?? 0))
        const atkName = stackName(catalog, atk.unitId)
        if (chance > 0) {
          const triggered = rollChancePct(chance, random)
          if (!triggered) {
            lines.push(
              chanceRollLog('Chronomancer', chance, false, {
                action: 'to displace the attacker',
              }),
            )
          } else {
            let resisted = false
            if (spec.resistStat) {
              const resistChance = Math.min(
                100,
                liveResistance(atk, catalog, spec.resistStat),
              )
              if (Math.floor(random() * 100) < resistChance) {
                resisted = true
                lines.push(
                  chanceRollLog('Chronomancer', chance, true, {
                    action: 'to displace the attacker',
                    success: `resisted (${resistChance}% ${spec.resistStat}).`,
                  }),
                )
              }
            }
            if (!resisted) {
              const goal = atk.startHex ?? { q: atk.q, r: atk.r }
              const moved = relocateNearestTo(
                { ...battle, stacks },
                catalog,
                tiles,
                atk.id,
                goal,
              )
              stacks = moved.battle.stacks
              atk = live(attackerId)
              if (moved.moved && moved.to) {
                hitKeys.push(occupancyKey(moved.to.q, moved.to.r))
                lines.push(
                  chanceRollLog('Chronomancer', chance, true, {
                    action: 'to displace the attacker',
                    success: `${atkName} flung to starting position!`,
                  }),
                )
              } else {
                lines.push(
                  chanceRollLog('Chronomancer', chance, true, {
                    action: 'to displace the attacker',
                    success: 'triggered, but no open hex.',
                  }),
                )
              }
            }
          }
        }
      }
      let chains = 0
      while (atk && atk.qty > 0 && retaliator.qty > 0) {
        const fervor = tryFervorChain(retaliator, random)
        if (fervor.chancePct <= 0) {
          break
        }
        lines.push(
          chanceRollLog('Fervor', fervor.chancePct, fervor.triggered, {
            action: 'to retaliate again',
          }),
        )
        if (!fervor.triggered) {
          break
        }
        chains += 1
        const buff = retaliator.fervor
        retaliator = {
          ...retaliator,
          fervor: buff
            ? { ...buff, streak: (buff.streak ?? 0) + 1 }
            : undefined,
        }
        retaliator = fireRetaliationStrike(retaliator)
      }
      if (retaliator.fervor && (retaliator.fervor.streak ?? 0) > 0) {
        retaliator = {
          ...retaliator,
          fervor: { ...retaliator.fervor, streak: 0 },
        }
      }
      stacks = writeStack(stacks, id, retaliator)
      stacks = writeStack(stacks, attackerId, atk)
    }
  }

  tryRetaliate(true)

  const fireOffensive = (
    dmgPctForHit: (hitPct: number | 'max') => number | 'max',
    waveMods?: StrikeMods & { qtyOverride?: number },
  ): { pool: number; kills: number } => {
    if (!atk || atk.qty <= 0) {
      return { pool: 0, kills: 0 }
    }
    let pool = 0
    let kills = 0
    const strikeQty =
      waveMods?.qtyOverride != null && waveMods.qtyOverride > 0
        ? waveMods.qtyOverride
        : atk.qty
    const striker: CombatStack = { ...atk, qty: strikeQty }
    const waveStrikeMods: StrikeMods = {
      ...strikeModsLive,
      ...waveMods,
    }
    for (const hit of hits) {
      if (!atk || atk.qty <= 0) {
        break
      }
      if (!hit.stack) {
        continue
      }
      const def = live(hit.stack.id)
      if (!def || def.qty <= 0 || def.side === atk.side) {
        continue
      }
      const before = def
      const struck = applyStrike(
        striker,
        def,
        catalog,
        random,
        dmgPctForHit(hit.dmgPct),
        rangePenalty,
        heroForSide(def.side, heroes),
        heroForSide(atk.side, heroes),
        {
          ...waveStrikeMods,
          ...(hit.flatPerCreature != null
            ? { guaranteedDamage: hit.flatPerCreature }
            : {}),
          battleStacks: stacks,
          zoneEvasionPct: Math.max(
            waveStrikeMods.zoneEvasionPct ?? 0,
            zoneEvasionPctForStack({ ...battle, stacks }, def, catalog),
          ),
          outgoingPctAdd:
            (waveStrikeMods.outgoingPctAdd ?? 0) +
            necromancerShadowDamageBonusPct(
              atk,
              { ...battle, stacks },
              catalog,
              heroes,
            ),
        },
      )
      const hitVictim = struck.spellRedirected
        ? struck.stack
        : before
      const pulseVictim =
        struck.spellRedirected && struck.stack
          ? (live(struck.stack.id) ?? struck.stack)
          : before
      lines.push(
        hitLogLine(
          atk,
          hitVictim ?? before,
          catalog,
          struck.damage,
          struck.killed,
          'attacked',
          struck.blocked,
          struck.blockBy,
          struck.rangePenalty,
          struck.crits,
          struck.parried,
          struck.missed,
          struck.guardianSaved,
          struck.blindMiss === true,
          struck.fortifyNegated === true,
          struck.missChancePct,
        ),
      )
      if (struck.spellReflectSource) {
        stacks = writeStack(stacks, before.id, struck.spellReflectSource)
        if (struck.spellRedirected) {
          lines.push(
            `Spell Reflect: ${before.qty} ${unitById(catalog, before.unitId)?.name ?? 'Unknown'} redirects the attack!`,
          )
        }
      }
      if (struck.damage > 0 && hitVictim) {
        hitKeys.push(occupancyKey(hitVictim.q, hitVictim.r))
        // Tower Wizard/Sorcerer: offensive Magic damage only (this path never
        // runs for retaliation strikes).
        const waveKind =
          waveMods?.damageKind ?? damageKindOf(unitById(catalog, atk.unitId))
        if (waveKind === 'magic') {
          wizardMagicDealt = true
          if (towerUnitGetsPassives(catalog, hitVictim)) {
            sorcererMagicTaken.set(hitVictim.id, hitVictim.side)
          }
        }
      }
      const deathUnitId = pulseVictim.unitId
      noteKill(deathUnitId, struck.killed)
      pool += struck.damage
      kills += struck.killed
      stacks = writeStack(
        stacks,
        struck.spellRedirected && struck.stack ? struck.stack.id : def.id,
        struck.stack,
      )
      // Bouncy Bomb: deaths on THIS stack pulse min_dmg × deaths at enemies.
      if (struck.killed > 0) {
        const boom = applyKillChainDeathPulse(
          pulseVictim,
          struck.killed,
          stacks,
          battle,
          catalog,
          tiles,
          heroes,
        )
        stacks = boom.stacks
        lines.push(...boom.lines)
        hitKeys.push(...boom.hitKeys)
        for (const [uid, n] of Object.entries(boom.unitDeaths)) {
          noteKill(Number(uid), n)
        }
        if (atk) {
          atk = live(attackerId)
        }
      }
      // Kill absorb: Flesh Golem (chance per Living kill) or Pit Fiend Arch
      // (guaranteed +1 per attack vs Tier-6 Humanoid+Living).
      if (struck.killed > 0 && atk && (spec.growsQtyOnKill ?? 0) > 0) {
        const victim = unitById(catalog, pulseVictim.unitId)
        const tagsRequired = spec.killAbsorbTagsRequired ?? []
        const hasAbsorbGate =
          (spec.killAbsorbChancePct != null && spec.killAbsorbChancePct > 0) ||
          tagsRequired.length > 0 ||
          spec.killAbsorbTagRequired != null ||
          spec.killAbsorbRequiresTier != null ||
          spec.killAbsorbTrigger != null
        if (hasAbsorbGate) {
          const tagsOk =
            tagsRequired.length > 0
              ? tagsRequired.every((tag) => unitHasTag(victim, tag))
              : spec.killAbsorbTagRequired == null ||
                unitHasTag(victim, spec.killAbsorbTagRequired)
          const tierOk =
            spec.killAbsorbRequiresTier == null ||
            (victim != null &&
              unitEffectiveTier(catalog, victim) ===
                spec.killAbsorbRequiresTier)
          if (tagsOk && tierOk) {
            const grow = Math.max(1, spec.growsQtyOnKill ?? 1)
            let gained = 0
            if (spec.killAbsorbTrigger === 'per_attack') {
              gained = grow
            } else if (
              spec.killAbsorbChancePct != null &&
              spec.killAbsorbChancePct > 0
            ) {
              const absorbChance = spec.killAbsorbChancePct
              for (let i = 0; i < struck.killed; i += 1) {
                const triggered = rollChancePct(absorbChance, random)
                lines.push(
                  chanceRollLog(
                    stackName(catalog, atk.unitId),
                    absorbChance,
                    triggered,
                    { action: 'to absorb the kill' },
                  ),
                )
                if (triggered) {
                  gained += grow
                }
              }
            } else {
              gained = struck.killed * grow
            }
            if (gained > 0) {
              atk = {
                ...atk,
                qty: atk.qty + gained,
                startingQty: atk.startingQty + gained,
              }
              stacks = writeStack(stacks, attackerId, atk)
              lines.push(
                `${stackName(catalog, atk.unitId)} grow by ${gained}!`,
              )
              healKeys.push(occupancyKey(atk.q, atk.r))
            }
          }
        }
      }
      if (struck.damage > 0 && atk) {
        const damagedId =
          struck.spellRedirected && struck.stack ? struck.stack.id : def.id
        const postDef = live(damagedId) ?? struck.stack
        if (postDef && postDef.qty > 0) {
          const post = afterDamageTaken(
            postDef,
            atk,
            struck.damage,
            waveMods?.damageKind ??
              damageKindOf(unitById(catalog, atk.unitId)),
            catalog,
            random,
          )
          let defender = post.defender
          atk = post.attacker
          lines.push(...post.lines)
          if (defender.qty > 0 && atk) {
            const slow = tryFlatSpeedDebuff(
              atk,
              defender,
              catalog,
              heroForSide(atk.side, heroes),
              random,
            )
            defender = slow.stack
            lines.push(...slow.lines)
          }
          stacks = writeStack(stacks, damagedId, defender)
          stacks = writeStack(stacks, attackerId, atk)
          if (post.reflectDamage > 0 && atk) {
            hitKeys.push(occupancyKey(atk.q, atk.r))
          }
        }
      }
    }
    return { pool, kills }
  }

  const auraQty =
    spec.auraCountsAlliesAsExtraQty === true &&
    spec.auraRadius != null &&
    spec.auraRadius >= 1 &&
    atk
      ? atk.qty + auraExtraQty(atk, stacks, catalog, spec.auraRadius)
      : null
  const qtyOverride =
    auraQty != null && atk && auraQty > atk.qty ? auraQty : undefined

  let skipInitiativeResort = false
  let offensiveKills = 0
  if (atk && atk.qty > 0) {
    let { pool: offensivePool, kills: waveKills } = fireOffensive(
      (pct) => pct,
      qtyOverride != null ? { qtyOverride } : undefined,
    )
    offensiveKills += waveKills
    // Angelic Warrior: guaranteed second strike before retaliation.
    if (spec.dualAttack === true) {
      const liveAtk = live(attackerId)
      if (liveAtk && liveAtk.qty > 0) {
        const secondKind: DmgKind =
          (spec.secondAttackDmgType ?? 'Physical').toLowerCase() === 'magic'
            ? 'magic'
            : 'physical'
        atk = liveAtk
        lines.push(
          `Dual Strike: ${liveAtk.qty} ${stackName(catalog, liveAtk.unitId)} strike again (${secondKind})!`,
        )
        const second = fireOffensive((pct) => pct, {
          damageKind: secondKind,
          ...(spec.secondAttackMinDmg != null
            ? { minDmg: spec.secondAttackMinDmg }
            : {}),
          ...(spec.secondAttackMaxDmg != null
            ? { maxDmg: spec.secondAttackMaxDmg }
            : {}),
          ...(qtyOverride != null ? { qtyOverride } : {}),
        })
        offensivePool += second.pool
        offensiveKills += second.kills
      }
    }
    // Assassin-style chance second attack (own turn only — never retaliation).
    {
      const liveAtk = live(attackerId)
      const atkAbilities = unitAttackShape(
        unitById(catalog, liveAtk?.unitId ?? atk.unitId),
      )
      if (
        liveAtk &&
        liveAtk.qty > 0 &&
        atkAbilities.chancePct != null &&
        atkAbilities.chancePct > 0 &&
        atkAbilities.extraAttackOnAttackOnly
      ) {
        const chance = atkAbilities.chancePct
        const triggered = rollChancePct(chance, random)
        lines.push(
          chanceRollLog('Assassin', chance, triggered, {
            action: 'to strike again',
          }),
        )
        if (triggered) {
          atk = liveAtk
          const again = fireOffensive(
            (pct) => pct,
            qtyOverride != null ? { qtyOverride } : undefined,
          )
          offensivePool += again.pool
          offensiveKills += again.kills
        }
      }
    }
    // Ninja (68/69): STR × chancePctFlatStat % bonus attacks; halve and re-roll
    // until a failure (own turn only). Always logs each attempt (S6-49).
    {
      const liveAtk = live(attackerId)
      const unitId = liveAtk?.unitId ?? before.unitId
      const atkAbilities = unitAttackShape(unitById(catalog, unitId))
      const unitName = (unitById(catalog, unitId)?.name ?? '')
        .trim()
        .toLowerCase()
      const isNinjaUnit =
        unitId === 68 ||
        unitId === 69 ||
        unitName === 'ninja' ||
        unitName === 'advanced ninja'
      const factor =
        atkAbilities.chancePctFlatStat != null &&
        atkAbilities.chancePctFlatStat > 0
          ? atkAbilities.chancePctFlatStat
          : isNinjaUnit
            ? 2
            : null
      const wantsChain =
        liveAtk != null &&
        liveAtk.qty > 0 &&
        !atkAbilities.extraAttackOnAttackOnly &&
        factor != null &&
        (isNinjaUnit ||
          atkAbilities.chanceHalvesEachAttempt === true ||
          atkAbilities.grantsSecondAttack === true)
      if (wantsChain && liveAtk && factor != null) {
        const hero = heroForSide(liveAtk.side, heroState)
        const strength = commandingHeroStats(catalog, hero).strength
        let chance = Math.max(0, Math.floor(strength * factor))
        const label = stackName(catalog, liveAtk.unitId)
        const halves =
          atkAbilities.chanceHalvesEachAttempt === true || isNinjaUnit
        const safety = 20
        // Always run/log at least one attempt — even at 0% — so S6-49 rolls are visible.
        for (let attempt = 0; attempt < safety; attempt += 1) {
          const striker = live(attackerId)
          if (!striker || striker.qty <= 0) {
            break
          }
          const triggered = rollChancePct(chance, random)
          lines.push(
            chanceRollLog(label, chance, triggered, {
              detail: `STR ${strength} × ${factor}${
                attempt > 0 ? `, attempt ${attempt + 1}` : ''
              }`,
              action: 'to strike again',
            }),
          )
          if (!triggered) {
            break
          }
          atk = striker
          const again = fireOffensive(
            (pct) => pct,
            qtyOverride != null ? { qtyOverride } : undefined,
          )
          offensivePool += again.pool
          offensiveKills += again.kills
          if (!halves) {
            break
          }
          chance = Math.max(0, chance / 2)
        }
      }
    }
    // Chronomancer Temporal Bolt: swap Speeds with a faster primary target.
    {
      const liveAtk = live(attackerId)
      const liveDef = aimed ? live(aimed.id) : null
      if (liveAtk && liveDef && liveAtk.qty > 0 && liveDef.qty > 0) {
        const swapped = trySpeedSwapIfTargetFaster(liveAtk, liveDef, catalog)
        if (swapped.swapped) {
          stacks = writeStack(stacks, liveAtk.id, swapped.striker)
          stacks = writeStack(stacks, liveDef.id, swapped.target)
          atk = swapped.striker
          lines.push(...swapped.lines)
          // Explicit exception: this swap must NOT re-sort remaining initiative.
          skipInitiativeResort = true
        }
      }
    }
    const barragePct = atk?.barragePct
    const barrageUses = atk?.barrageUsesLeft
    const fireBarrage =
      barragePct != null &&
      barragePct > 0 &&
      (barrageUses == null || barrageUses > 0)
    let usesLeft = barrageUses
    if (fireBarrage) {
      atk = live(attackerId)
      const again = fireOffensive(
        () => barragePct,
        qtyOverride != null ? { qtyOverride } : undefined,
      )
      offensivePool += again.pool
      offensiveKills += again.kills
      if (usesLeft != null) {
        usesLeft = usesLeft - 1
      }
    }
    // High Priestess: once per kill-triggering attack, fully heal most-injured Temple.
    if (
      offensiveKills > 0 &&
      spec.healMostInjuredOnKill === true &&
      spec.healFull === true
    ) {
      atk = live(attackerId)
      if (atk && atk.qty > 0) {
        const healed = applyHighPriestessHealOnKill(stacks, atk, catalog)
        stacks = healed.stacks
        lines.push(...healed.lines)
        healKeys.push(...healed.healKeys)
      }
    }
    atk = live(attackerId)
    if (atk && atk.qty > 0) {
      atk = applyVampiricFromDamage(atk, offensivePool)
      const spent =
        fireBarrage && usesLeft != null
          ? {
              barrageUsesLeft: usesLeft > 0 ? usesLeft : undefined,
              barragePct: usesLeft > 0 ? atk.barragePct : undefined,
            }
          : {}
      atk = { ...atk, hasActedThisRound: true, ...spent }
      stacks = writeStack(stacks, attackerId, atk)
    }
  }

  tryRetaliate(false)

  // Drop unused one-shot retaliation skips (e.g. death-pulse victims not in
  // uniqueHitIds) so they don't suppress a later turn's retaliation.
  stacks = stacks.map((row) =>
    row.skipRetaliationOnce
      ? { ...row, skipRetaliationOnce: undefined }
      : row,
  )

  // Double Tap / Knight: bonus attack only when a defender actually retaliated.
  // Uncapped chain (like Fervor): each bonus that is itself retaliated may roll again.
  while (true) {
    atk = live(attackerId)
    if (!didRetaliate || !atk || atk.qty <= 0) {
      break
    }
    const doubleTapLeft = atk.doubleTapUsesLeft ?? 0
    let label: string | null = null
    let nextDoubleTap: number | undefined = atk.doubleTapUsesLeft
    if (doubleTapLeft > 0) {
      label = 'Double Tap'
      const left = doubleTapLeft - 1
      nextDoubleTap = left > 0 ? left : undefined
    } else if (citadelUnitGetsPassives(catalog, atk)) {
      const chance = knightBonusChancePct(
        catalog,
        heroForSide(atk.side, heroes),
        { ...battle, stacks },
        atk.side,
      )
      if (chance > 0) {
        const triggered = rollChancePct(chance, random)
        lines.push(
          chanceRollLog('Knight', chance, triggered, {
            action: 'to strike again after retaliation',
          }),
        )
        if (triggered) {
          label = 'Knight'
        }
      }
    }
    if (!label) {
      break
    }
    if (label === 'Double Tap') {
      lines.push(
        `Double Tap: ${atk.qty} ${stackName(catalog, atk.unitId)} strike again!`,
      )
    }
    fireOffensive((pct) => pct)
    atk = live(attackerId)
    if (atk && atk.qty > 0 && doubleTapLeft > 0) {
      atk = {
        ...atk,
        doubleTapUsesLeft: nextDoubleTap,
      }
      stacks = writeStack(stacks, attackerId, atk)
    }
    didRetaliate = false
    tryRetaliate(false)
  }

  atk = live(attackerId)
  if (uniqueHitIds.length === 1) {
    const id = uniqueHitIds[0]!
    const original =
      battle.stacks.find((row) => row.id === id) ?? aimed ?? attacker
    const defNow = live(id)
    lines.push(
      remainingLogLine(
        battle,
        attacker,
        original,
        catalog,
        atk?.qty ?? 0,
        defNow?.qty ?? 0,
      ),
    )
  }
  let nextBattle = { ...battle, stacks, unitDeaths, roundUnitDeaths }
  // Pyromaniac SPIRAL: Fire trail after the primary hit (no AOE damage).
  if (spec.shape === 'spiral' && atk) {
    const spiral = applySpiralFireFromAttacker(
      nextBattle,
      catalog,
      heroForSide(atk.side, heroState),
      attackerId,
      aim.hex,
      tiles,
      random,
    )
    nextBattle = spiral.battle
    lines.push(...spiral.lines)
  }
  {
    const rez = applySelfRezThenTombstones(
      battle,
      nextBattle,
      catalog,
      heroState,
      random,
    )
    nextBattle = rez.battle
    lines.push(...rez.lines)
  }
  // S6-44 Tower passives — apply after all offensive waves (never retaliation).
  // BR S7-1 Druid: +1 Mana when a Grove stack attacks (any dmg type), once per
  // attack action, capped at max — same grantHeroMana path as Wizard.
  {
    const attackerSide = before.side
    if (
      wizardMagicDealt &&
      towerUnitGetsPassives(catalog, before) &&
      isWizardHero(catalog, heroForSide(attackerSide, heroState))
    ) {
      const wizard = heroForSide(attackerSide, heroState)
      if (wizard) {
        const amount = passiveManaPerAttack(catalog, wizard, 'Wizard mana')
        const gained = grantHeroMana(catalog, wizard, amount)
        if (gained.current_mana > wizard.current_mana) {
          heroState =
            attackerSide === 'atk'
              ? { ...heroState, atk: gained }
              : { ...heroState, def: gained }
          lines.push(
            `Wizard: +${amount} Mana (${gained.current_mana}/${poolMax(catalog, gained, 2)}).`,
          )
        }
      }
    }
    if (
      groveUnitGetsPassives(catalog, before) &&
      isDruidHero(catalog, heroForSide(attackerSide, heroState))
    ) {
      const druid = heroForSide(attackerSide, heroState)
      if (druid) {
        const amount = passiveManaPerAttack(catalog, druid, 'Druid mana')
        const gained = grantHeroMana(catalog, druid, amount)
        if (gained.current_mana > druid.current_mana) {
          heroState =
            attackerSide === 'atk'
              ? { ...heroState, atk: gained }
              : { ...heroState, def: gained }
          lines.push(
            `Druid: +${amount} Mana (${gained.current_mana}/${poolMax(catalog, gained, 2)}).`,
          )
        }
      }
    }
    for (const [, side] of sorcererMagicTaken) {
      if (!isSorcererHero(catalog, heroForSide(side, heroState))) {
        continue
      }
      const sorcerer = heroForSide(side, heroState)
      if (!sorcerer) {
        continue
      }
      const amount = passiveManaPerAttack(catalog, sorcerer, 'Sorcerer mana')
      const gained = grantHeroMana(catalog, sorcerer, amount)
      if (gained.current_mana > sorcerer.current_mana) {
        heroState =
          side === 'atk'
            ? { ...heroState, atk: gained }
            : { ...heroState, def: gained }
        lines.push(
          `Sorcerer: +${amount} Mana (${gained.current_mana}/${poolMax(catalog, gained, 2)}).`,
        )
      }
    }
  }
  // Gladiator-style Slow (and any other mid-strike speed change): shift the
  // affected side's remaining initiative immediately, same as haste buffs.
  // Chronomancer Temporal Bolt is an explicit exception (skipInitiativeResort).
  const slowedSides = combatSpeedChangedSides(battle, nextBattle, catalog)
  if (slowedSides.length > 0 && !skipInitiativeResort) {
    nextBattle = resortRemainingInitiativeForSides(
      nextBattle,
      catalog,
      slowedSides,
    )
  }
  const heroesChanged =
    heroState.atk !== heroes?.atk || heroState.def !== heroes?.def
  // Inquisitor Grand: after a kill, STR × chancePctFlatStat % to act again.
  // Always log the roll outcome so silence ≠ "never fired."
  let grantExtraTurn = false
  if (offensiveKills > 0 && spec.extraTurnOnKill === true) {
    const actor = live(attackerId)
    if (actor && actor.qty > 0) {
      const hero = heroForSide(actor.side, heroState)
      const strength = commandingHeroStats(catalog, hero).strength
      const factor = spec.chancePctFlatStat ?? 1
      const chance = Math.max(0, strength * factor)
      const detail = `STR ${strength} × ${Number.isInteger(factor) ? factor : factor}`
      const triggered = rollChancePct(chance, random)
      grantExtraTurn = triggered
      lines.push(
        chanceRollLog('Inquisitor Grand', chance, triggered, {
          detail,
          action: 'to take an extra turn',
        }),
      )
    }
  }
  return {
    battle: nextBattle,
    log: { lines },
    hitKeys,
    healKeys,
    hitColor: 'red',
    ...(heroesChanged ? { heroes: heroState } : {}),
    ...(grantExtraTurn ? { grantExtraTurn: true } : {}),
  }
}
