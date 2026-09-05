import { hexDistance } from '../hex/pathfinding'
import type { Hero } from '../session/types'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import {
  appConfigNumber,
  heroEffectiveStats,
  shapeIsUntargeted,
  shapePulsesOnMove,
  unitAttackShape,
  unitAutoTarget,
  unitBlocksEnemyRetaliation,
  unitById,
  unitRetaliation,
} from '../town/catalog'
import { mergeUnitDeaths, moveStack, type CombatBattle, type CombatStack, type CombatTile } from './battle'
import { tryInflictCondition } from './condition'
import { occupancyKey } from './occupancy'
import { hasLineOfSight, resolveShapeHits } from './shapes'
import {
  isCreatureArmyUnit,
  isSiegeEngineUnit,
  isSiegeEngineWallTarget,
  isUntargetableStack,
  isWallSegmentUnit,
} from './siege'

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

function scaleBySignedPct(n: number, signedPct: number): number {
  if (n <= 0 || !signedPct) {
    return Math.max(0, n)
  }
  return Math.max(0, Math.floor((n * (100 + signedPct)) / 100))
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
 * Flat unit soak (floor 1) → hero Defense/Resistance % → stack buff %.
 * `blocked` is the total taken off raw.
 */
export function mitigateIncoming(
  raw: number,
  target: CombatStack,
  catalog: ReferenceCatalog,
  kind: DmgKind,
  defenderHero: Hero | undefined,
): { damage: number; blocked: number; blockBy: BlockLabel | null } {
  if (raw <= 0 || target.indestructible) {
    return { damage: 0, blocked: Math.max(0, raw), blockBy: null }
  }
  const targetUnit = unitById(catalog, target.unitId)
  const soak =
    kind === 'magic'
      ? Math.max(0, targetUnit?.resistance ?? 0)
      : Math.max(0, targetUnit?.defense ?? 0)
  const label: BlockLabel = kind === 'magic' ? 'Resistance' : 'Defense'
  let dealt = Math.max(1, raw - soak)
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
  attackerUnitId: number,
): boolean {
  if (target.qty <= 0) {
    return false
  }
  const maxRange = unitById(catalog, attackerUnitId)?.max_range ?? 1
  const dist = hexDistance(from, { q: target.q, r: target.r })
  return dist >= 1 && dist <= maxRange
}

export function isValidAttackTarget(
  attacker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  stacks: CombatStack[],
): boolean {
  if (attacker.side === target.side || attacker.id === target.id) {
    return false
  }
  if (isUntargetableStack(target, catalog)) {
    return false
  }
  const mode = unitAutoTarget(unitById(catalog, attacker.unitId))
  if (mode === 'random_wall_segment' && !isSiegeEngineWallTarget(target, catalog)) {
    return false
  }
  if (mode === 'random_enemy' && !isCreatureArmyUnit(unitById(catalog, target.unitId))) {
    return false
  }
  return (
    attackRangeFrom(attacker, target, catalog, attacker.unitId) &&
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
): { stack: CombatStack | null; killed: number } {
  if (damage <= 0 || stack.qty <= 0 || stack.indestructible) {
    return { stack, killed: 0 }
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
  if (qty <= 0) {
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

type BlockLabel = 'Defense' | 'Resistance'

/**
 * Per creature, then summed (BR 4-12): roll → dmg_pct → min_range half →
 * unit soak floored at 1 → hero % → incoming buff %. Stack outgoing %
 * (Sap Strength and similar) is applied after that per-creature floor,
 * never to an aggregated total.
 */
export function computeStrikeDamage(
  striker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
  random: () => number = Math.random,
  dmgPct: number | 'max' = 100,
  rangePenalty = false,
  defenderHero?: Hero,
): { damage: number; blocked: number; rangePenalty: boolean } {
  const strikerUnit = unitById(catalog, striker.unitId)
  const kind = damageKindOf(strikerUnit)
  const minDmg = scaleBySignedPct(
    strikerUnit?.min_dmg ?? 0,
    outputMinPct(striker, kind),
  )
  const maxDmg = scaleBySignedPct(
    strikerUnit?.max_dmg ?? 0,
    outputMaxPct(striker, kind),
  )
  const pct =
    dmgPct === 'max' ? null : Math.min(100, Math.max(0, dmgPct))
  const totalPct = outputTotalPct(striker, kind)
  let damage = 0
  let blocked = 0
  for (let i = 0; i < striker.qty; i += 1) {
    let raw =
      dmgPct === 'max'
        ? maxDmg
        : rollAttackDamage(1, minDmg, maxDmg, random)
    if (pct != null) {
      raw = Math.floor((raw * pct) / 100)
    }
    if (rangePenalty) {
      raw = Math.floor(raw / 2)
    }
    const mit = mitigateIncoming(raw, target, catalog, kind, defenderHero)
    const dealt = scaleBySignedPct(mit.damage, totalPct)
    damage += dealt
    blocked += mit.blocked
    if (dealt < mit.damage) {
      blocked += mit.damage - dealt
    }
  }
  return { damage, blocked, rangePenalty }
}

function applyStrike(
  striker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
  random: () => number,
  dmgPct: number | 'max' = 100,
  rangePenalty = false,
  defenderHero?: Hero,
): {
  damage: number
  blocked: number
  blockBy: BlockLabel | null
  rangePenalty: boolean
  killed: number
  stack: CombatStack | null
} {
  const kind = damageKindOf(unitById(catalog, striker.unitId))
  const label: BlockLabel = kind === 'magic' ? 'Resistance' : 'Defense'
  if (target.indestructible) {
    return {
      damage: 0,
      blocked: 0,
      blockBy: null,
      rangePenalty,
      killed: 0,
      stack: target,
    }
  }
  const rolled = computeStrikeDamage(
    striker,
    target,
    catalog,
    random,
    dmgPct,
    rangePenalty,
    defenderHero,
  )
  let damage = rolled.damage
  let blocked = rolled.blocked
  if (
    isWallSegmentUnit(unitById(catalog, target.unitId)) &&
    !isSiegeEngineUnit(unitById(catalog, striker.unitId))
  ) {
    const mult = appConfigNumber(catalog, 'wall_damage_mult', 0.25)
    const reduced = Math.floor(damage * mult)
    blocked += damage - reduced
    damage = reduced
  }
  const full = Math.max(1, unitById(catalog, target.unitId)?.health ?? 1)
  const applied = applyStackDamage(target, damage, full)
  return {
    damage,
    blocked,
    blockBy: blocked > 0 ? label : null,
    rangePenalty,
    killed: applied.killed,
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
): string {
  const atkName = stackName(catalog, striker.unitId)
  const defName = stackName(catalog, targetBefore.unitId)
  let line = `${striker.qty} ${atkName} ${verb} ${targetBefore.qty} ${defName} for ${damage} dmg`
  const notes: string[] = []
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
): {
  battle: CombatBattle
  log: { lines: string[] }
  hitKeys: string[]
  healKeys: string[]
  hitColor: HitFlashColor
} | null {
  const before = battle.stacks.find((row) => row.id === attackerId)
  if (!before || before.qty <= 0) {
    return null
  }
  const stand = aim.stand ?? { q: before.q, r: before.r }
  battle = moveStack(battle, attackerId, stand.q, stand.r)
  const attacker = battle.stacks.find((row) => row.id === attackerId)
  if (!attacker || attacker.qty <= 0) {
    return null
  }
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

  const maxRange = atkUnit?.max_range ?? 1
  const aimDist = hexDistance(attacker, aim.hex)
  if (!noAim) {
    if (spec.shape === 'beam' || spec.shape === 'aoe') {
      if (aimDist < 1 || aimDist > maxRange) {
        return null
      }
      if (!hasLineOfSight(attacker, aim.hex, tiles, battle.stacks, catalog)) {
        return null
      }
    } else if (
      !aimed ||
      !isValidAttackTarget(attacker, aimed, catalog, tiles, battle.stacks)
    ) {
      return null
    }
  }

  const hits = resolveShapeHits(
    attacker,
    aim.hex,
    aimed && aimed.side !== attacker.side ? aimed : null,
    battle,
    catalog,
    tiles,
    random,
  )
  const rangePenalty = minRangePenaltyApplies(
    attacker,
    battle.stacks,
    catalog,
  )
  const blockedByAttacker = unitBlocksEnemyRetaliation(atkUnit)
  let stacks = battle.stacks
  let atk: CombatStack | null = attacker
  const lines: string[] = []
  const hitKeys: string[] = []
  const healKeys: string[] = []
  let unitDeaths = { ...(battle.unitDeaths ?? {}) }

  const live = (id: string) => stacks.find((row) => row.id === id) ?? null

  const applyVampiricFromDamage = (
    striker: CombatStack,
    pool: number,
  ): CombatStack => {
    if (!striker.vampiricStrike || pool <= 0) {
      return striker
    }
    const full = Math.max(1, unitById(catalog, striker.unitId)?.health ?? 1)
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

  const tryRetaliate = (preemptivePass: boolean) => {
    if (!atk || blockedByAttacker) {
      return
    }
    for (const id of uniqueHitIds) {
      if (!atk) {
        return
      }
      const def = live(id)
      if (!def || def.qty <= 0) {
        continue
      }
      const spec = unitRetaliation(unitById(catalog, def.unitId))
      if (spec.preemptive !== preemptivePass) {
        continue
      }
      if (attackDistance(atk, def) !== 1) {
        continue
      }
      if (def.retaliationsLeft <= 0) {
        continue
      }
      const before = atk
      const struck = applyStrike(
        def,
        atk,
        catalog,
        random,
        spec.dmgPct,
        minRangePenaltyApplies(def, stacks, catalog),
        heroForSide(atk.side, heroes),
      )
      lines.push(
        hitLogLine(
          def,
          before,
          catalog,
          struck.damage,
          struck.killed,
          'retaliated against',
          struck.blocked,
          struck.blockBy,
          struck.rangePenalty,
        ),
      )
      if (struck.damage > 0) {
        hitKeys.push(occupancyKey(before.q, before.r))
      }
      unitDeaths = mergeUnitDeaths(unitDeaths, before.unitId, struck.killed)
      // Unlimited retaliation + Vampiric Strike can revive every strike;
      // balance is deferred project-wide.
      let retaliator: CombatStack = {
        ...def,
        retaliationsLeft: spendRetaliationCharge(def.retaliationsLeft),
      }
      retaliator = applyVampiricFromDamage(retaliator, struck.damage)
      atk = struck.stack
      if (atk && struck.damage > 0) {
        const inf = tryInflictCondition(def, atk, catalog, random)
        atk = inf.stack
        lines.push(...inf.lines)
      }
      stacks = writeStack(stacks, id, retaliator)
      stacks = writeStack(stacks, attackerId, atk)
    }
  }

  tryRetaliate(true)

  if (atk && atk.qty > 0) {
    let offensivePool = 0
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
        atk,
        def,
        catalog,
        random,
        hit.dmgPct,
        rangePenalty,
        heroForSide(def.side, heroes),
      )
      lines.push(
        hitLogLine(
          atk,
          before,
          catalog,
          struck.damage,
          struck.killed,
          'attacked',
          struck.blocked,
          struck.blockBy,
          struck.rangePenalty,
        ),
      )
      if (struck.damage > 0) {
        hitKeys.push(occupancyKey(before.q, before.r))
      }
      unitDeaths = mergeUnitDeaths(unitDeaths, before.unitId, struck.killed)
      offensivePool += struck.damage
      stacks = writeStack(stacks, def.id, struck.stack)
      if (struck.stack && struck.damage > 0 && atk) {
        const inf = tryInflictCondition(atk, struck.stack, catalog, random)
        stacks = writeStack(stacks, def.id, inf.stack)
        lines.push(...inf.lines)
      }
    }
    atk = live(attackerId)
    if (atk && atk.qty > 0) {
      atk = applyVampiricFromDamage(atk, offensivePool)
      atk = { ...atk, hasActedThisRound: true }
      stacks = writeStack(stacks, attackerId, atk)
    }
  }

  tryRetaliate(false)

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
  return {
    battle: { ...battle, stacks, unitDeaths },
    log: { lines },
    hitKeys,
    healKeys,
    hitColor: 'red',
  }
}
