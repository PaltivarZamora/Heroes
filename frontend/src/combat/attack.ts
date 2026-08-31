import { hexDistance } from '../hex/pathfinding'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import { unitById } from '../town/catalog'
import type { BattleLog, CombatBattle, CombatStack } from './battle'

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
): boolean {
  if (attacker.side === target.side || attacker.id === target.id) {
    return false
  }
  return attackRangeFrom(attacker, target, catalog, attacker.unitId)
}

export function canAttackAnyone(
  attacker: CombatStack,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
): boolean {
  return battle.stacks.some((row) => isValidAttackTarget(attacker, row, catalog))
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
 * unit.health. Defense/Resistance is NOT applied this pass.
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

export function attackLogLines(
  attacker: CombatStack,
  targetBefore: CombatStack,
  catalog: ReferenceCatalog,
  damage: number,
  killed: number,
  remainingQty: number,
  battle: CombatBattle,
): string[] {
  const atkName = unitById(catalog, attacker.unitId)?.name ?? 'Unknown'
  const defName = unitById(catalog, targetBefore.unitId)?.name ?? 'Unknown'
  let first = `${attacker.qty} ${atkName} attacked ${targetBefore.qty} ${defName} for ${damage} dmg`
  if (killed > 0) {
    first += ` and ${killed} ${defName} died`
  }
  first += '.'
  const atkPlayer = playerLabel(battle, attacker.side)
  const defPlayer = playerLabel(battle, targetBefore.side)
  const second =
    remainingQty <= 0
      ? `Player ${atkPlayer} now has ${attacker.qty} ${atkName} and Player ${defPlayer}'s ${defName} were destroyed.`
      : `Player ${atkPlayer} now has ${attacker.qty} ${atkName} and Player ${defPlayer} has ${remainingQty} ${defName}.`
  return [first, second]
}

export function resolveAttack(
  battle: CombatBattle,
  attackerId: string,
  targetId: string,
  catalog: ReferenceCatalog,
  random: () => number = Math.random,
): { battle: CombatBattle; log: { lines: string[] } } | null {
  const attacker = battle.stacks.find((row) => row.id === attackerId)
  const target = battle.stacks.find((row) => row.id === targetId)
  if (!attacker || !target || !isValidAttackTarget(attacker, target, catalog)) {
    return null
  }
  const atkUnit = unitById(catalog, attacker.unitId)
  const defUnit = unitById(catalog, target.unitId)
  const minDmg = atkUnit?.min_dmg ?? 0
  const maxDmg = atkUnit?.max_dmg ?? 0
  let damage = rollAttackDamage(attacker.qty, minDmg, maxDmg, random)
  const minRange = atkUnit?.min_range ?? 0
  if (attackDistance(attacker, target) < minRange) {
    damage = Math.floor(damage / 2)
  }
  const applied = applyStackDamage(
    target,
    damage,
    Math.max(1, defUnit?.health ?? 1),
  )
  const remainingQty = applied.stack?.qty ?? 0
  let stacks = battle.stacks.map((row) => {
    if (row.id === attackerId) {
      return { ...row, hasActedThisRound: true }
    }
    if (row.id === targetId) {
      return applied.stack ?? row
    }
    return row
  })
  if (!applied.stack) {
    stacks = stacks.filter((row) => row.id !== targetId)
  }
  const next: CombatBattle = { ...battle, stacks }
  const log: BattleLog = {
    lines: attackLogLines(
      attacker,
      target,
      catalog,
      damage,
      applied.killed,
      remainingQty,
      battle,
    ),
  }
  return { battle: next, log }
}
