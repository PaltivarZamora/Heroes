import { hexDistance } from '../hex/pathfinding'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import {
  shapeIsUntargeted,
  shapePulsesOnMove,
  unitAttackShape,
  unitBlocksEnemyRetaliation,
  unitById,
  unitRetaliation,
} from '../town/catalog'
import { moveStack, type CombatBattle, type CombatStack, type CombatTile } from './battle'
import { hasLineOfSight, resolveShapeHits } from './shapes'

export type AttackIconKind = 'magic' | 'melee' | 'ranged'

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
): boolean {
  if (attacker.side === target.side || attacker.id === target.id) {
    return false
  }
  return (
    attackRangeFrom(attacker, target, catalog, attacker.unitId) &&
    hasLineOfSight(attacker, { q: target.q, r: target.r }, tiles)
  )
}

export function canAttackAnyone(
  attacker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): boolean {
  return battle.stacks.some((row) =>
    isValidAttackTarget(attacker, row, catalog, tiles),
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
 */
export function applyStackDamage(
  stack: CombatStack,
  damage: number,
  fullHealth: number,
): { stack: CombatStack | null; killed: number } {
  if (damage <= 0 || stack.qty <= 0) {
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

function writeStack(
  stacks: CombatStack[],
  id: string,
  next: CombatStack | null,
): CombatStack[] {
  if (!next || next.qty <= 0) {
    return stacks.filter((row) => row.id !== id)
  }
  return stacks.map((row) => (row.id === id ? next : row))
}

type BlockLabel = 'Defense' | 'Resistance'

function mitigationOf(
  strikerUnit: UnitRow | null | undefined,
  targetUnit: UnitRow | null | undefined,
): { soak: number; label: BlockLabel } {
  if (isMagic(strikerUnit?.dmg_type)) {
    return {
      soak: Math.max(0, targetUnit?.resistance ?? 0),
      label: 'Resistance',
    }
  }
  return {
    soak: Math.max(0, targetUnit?.defense ?? 0),
    label: 'Defense',
  }
}

/**
 * Per creature: roll (or forced max), optional dmg_pct, min_range half
 * (caller decides if it applies), then subtract target Defense/Resistance,
 * floor at 1, then sum. `blocked` is the sum of per-creature reductions.
 */
export function computeStrikeDamage(
  striker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
  random: () => number = Math.random,
  dmgPct: number | 'max' = 100,
  rangePenalty = false,
): { damage: number; blocked: number; rangePenalty: boolean } {
  const strikerUnit = unitById(catalog, striker.unitId)
  const { soak } = mitigationOf(
    strikerUnit,
    unitById(catalog, target.unitId),
  )
  const minDmg = strikerUnit?.min_dmg ?? 0
  const maxDmg = strikerUnit?.max_dmg ?? 0
  const pct =
    dmgPct === 'max' ? null : Math.min(100, Math.max(0, dmgPct))
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
    const dealt = Math.max(1, raw - soak)
    damage += dealt
    blocked += Math.max(0, raw - dealt)
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
): {
  damage: number
  blocked: number
  blockBy: BlockLabel | null
  rangePenalty: boolean
  killed: number
  stack: CombatStack | null
} {
  const mit = mitigationOf(
    unitById(catalog, striker.unitId),
    unitById(catalog, target.unitId),
  )
  const { damage, blocked } = computeStrikeDamage(
    striker,
    target,
    catalog,
    random,
    dmgPct,
    rangePenalty,
  )
  const full = Math.max(1, unitById(catalog, target.unitId)?.health ?? 1)
  const applied = applyStackDamage(target, damage, full)
  return {
    damage,
    blocked,
    blockBy: mit.soak > 0 ? mit.label : null,
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
  random: () => number = Math.random,
): { battle: CombatBattle; log: { lines: string[] } } | null {
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
      if (!hasLineOfSight(attacker, aim.hex, tiles)) {
        return null
      }
    } else if (!aimed || !isValidAttackTarget(attacker, aimed, catalog, tiles)) {
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

  const live = (id: string) => stacks.find((row) => row.id === id) ?? null

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
      const spent = {
        ...def,
        retaliationsLeft: spendRetaliationCharge(def.retaliationsLeft),
      }
      atk = struck.stack
      stacks = writeStack(stacks, id, spent)
      stacks = writeStack(stacks, attackerId, atk)
    }
  }

  tryRetaliate(true)

  if (atk && atk.qty > 0) {
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
      stacks = writeStack(stacks, def.id, struck.stack)
    }
    atk = live(attackerId)
    if (atk && atk.qty > 0) {
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
  return { battle: { ...battle, stacks }, log: { lines } }
}
