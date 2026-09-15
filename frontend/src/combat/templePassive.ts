import type { ReferenceCatalog } from '../town/catalog'
import { heroEffectiveStats, unitById } from '../town/catalog'
import { hexDistance } from '../hex/pathfinding'
import {
  applyStackDamage,
  applyStackHeal,
  heroForSide,
  type CombatHeroes,
} from './attack'
import {
  isHeroStack,
  mergeUnitDeaths,
  stackMaxHealth,
  type CombatBattle,
  type CombatSide,
  type CombatStack,
} from './battle'
import { occupancyKey } from './occupancy'
import { isHeroClass } from './shadow'
import { isCreatureArmyUnit } from './siege'
import { syncTombstonesFromWipes } from './tombstone'

export function isTempleUnit(
  catalog: ReferenceCatalog,
  unitId: number,
): boolean {
  const unit = unitById(catalog, unitId)
  if (!unit?.town_id) {
    return false
  }
  const templeId = catalog.town.find(
    (row) => row.name.trim().toLowerCase() === 'temple',
  )?.id
  return templeId != null && unit.town_id === templeId
}

/** Live Temple creature count on a side — recalculated each call (not battle-start frozen). */
export function countTempleUnits(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  side: CombatSide,
): number {
  let total = 0
  for (const stack of battle.stacks) {
    if (
      stack.side !== side ||
      stack.qty <= 0 ||
      isHeroStack(stack) ||
      !isTempleUnit(catalog, stack.unitId)
    ) {
      continue
    }
    total += stack.qty
  }
  return total
}

function frontDeficit(stack: CombatStack, catalog: ReferenceCatalog): number {
  const max = stackMaxHealth(stack, catalog)
  return Math.max(0, max - stack.topHealth)
}

function isDamagedCreature(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): boolean {
  return (
    stack.qty > 0 &&
    !isHeroStack(stack) &&
    !stack.indestructible &&
    isCreatureArmyUnit(unitById(catalog, stack.unitId)) &&
    frontDeficit(stack, catalog) > 0
  )
}

function stackLabel(catalog: ReferenceCatalog, stack: CombatStack): string {
  return `${stack.qty} ${unitById(catalog, stack.unitId)?.name ?? 'unit'}`
}

/**
 * Cleric: intel × Temple count heal pool, spent on Temple stacks by
 * front-unit deficit descending (most hurt first).
 */
export function applyClericPooledHeal(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  heroes: CombatHeroes | undefined,
  side: CombatSide,
): { battle: CombatBattle; lines: string[]; healKeys: string[] } {
  const hero = heroForSide(side, heroes)
  if (!isHeroClass(catalog, hero, 'Cleric') || !hero) {
    return { battle, lines: [], healKeys: [] }
  }
  const templeCount = countTempleUnits(battle, catalog, side)
  const intel = heroEffectiveStats(
    catalog,
    hero.class_id,
    hero.current_level ?? 1,
  ).intel
  let pool = Math.max(0, Math.floor(intel * templeCount))
  if (pool <= 0) {
    return { battle, lines: [], healKeys: [] }
  }
  let stacks = [...battle.stacks]
  const lines: string[] = []
  const healKeys: string[] = []
  let totalHealed = 0
  while (pool > 0) {
    const candidates = stacks
      .filter(
        (row) =>
          row.side === side &&
          isTempleUnit(catalog, row.unitId) &&
          isDamagedCreature(row, catalog),
      )
      .sort((a, b) => {
        const da = frontDeficit(a, catalog)
        const db = frontDeficit(b, catalog)
        if (db !== da) {
          return db - da
        }
        return a.id.localeCompare(b.id)
      })
    const target = candidates[0]
    if (!target) {
      break
    }
    const full = stackMaxHealth(target, catalog)
    const need = frontDeficit(target, catalog)
    const spend = Math.min(pool, need)
    if (spend <= 0) {
      break
    }
    const live = stacks.find((row) => row.id === target.id) ?? target
    const healed = applyStackHeal(live, spend, full)
    if (healed.healed <= 0) {
      break
    }
    pool -= healed.healed
    totalHealed += healed.healed
    stacks = stacks.map((row) =>
      row.id === live.id ? healed.stack : row,
    )
    healKeys.push(occupancyKey(live.q, live.r))
    lines.push(
      `Cleric: healed ${stackLabel(catalog, healed.stack)} for ${healed.healed}.`,
    )
  }
  if (totalHealed <= 0) {
    return { battle, lines: [], healKeys: [] }
  }
  return {
    battle: { ...battle, stacks },
    lines: [
      `Cleric: Temple grace restores ${totalHealed} HP (pool ${Math.floor(intel)}×${templeCount}).`,
      ...lines,
    ],
    healKeys: [...new Set(healKeys)],
  }
}

/**
 * Paladin: intel × Temple count damage pool. Spends only enough to kill
 * exactly 1 creature on the neediest damaged enemy (front deficit desc),
 * then re-picks (may revisit if still wounded). Fresh Temple count each round.
 */
export function applyPaladinPooledExecute(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  heroes: CombatHeroes | undefined,
  side: CombatSide,
): { battle: CombatBattle; lines: string[]; hitKeys: string[] } {
  const hero = heroForSide(side, heroes)
  if (!isHeroClass(catalog, hero, 'Paladin') || !hero) {
    return { battle, lines: [], hitKeys: [] }
  }
  const templeCount = countTempleUnits(battle, catalog, side)
  const intel = heroEffectiveStats(
    catalog,
    hero.class_id,
    hero.current_level ?? 1,
  ).intel
  let pool = Math.max(0, Math.floor(intel * templeCount))
  if (pool <= 0) {
    return { battle, lines: [], hitKeys: [] }
  }
  let stacks = [...battle.stacks]
  let unitDeaths = { ...(battle.unitDeaths ?? {}) }
  const lines: string[] = []
  const hitKeys: string[] = []
  let kills = 0
  while (pool > 0) {
    const candidates = stacks
      .filter(
        (row) =>
          row.side !== side &&
          isDamagedCreature(row, catalog),
      )
      .sort((a, b) => {
        const da = frontDeficit(a, catalog)
        const db = frontDeficit(b, catalog)
        if (db !== da) {
          return db - da
        }
        // Closer to death on equal deficit: lower remaining HP first.
        if (a.topHealth !== b.topHealth) {
          return a.topHealth - b.topHealth
        }
        return a.id.localeCompare(b.id)
      })
    const target = candidates[0]
    if (!target) {
      break
    }
    const live = stacks.find((row) => row.id === target.id) ?? target
    // Minimum damage to kill exactly one creature = current front HP.
    const spend = Math.max(1, live.topHealth)
    if (spend > pool) {
      break
    }
    const full = stackMaxHealth(live, catalog)
    const applied = applyStackDamage(live, spend, full, false)
    pool -= spend
    kills += applied.killed
    unitDeaths = mergeUnitDeaths(unitDeaths, live.unitId, applied.killed)
    hitKeys.push(occupancyKey(live.q, live.r))
    const name = unitById(catalog, live.unitId)?.name ?? 'unit'
    if (applied.stack == null || applied.stack.qty <= 0) {
      stacks = stacks.filter((row) => row.id !== live.id)
      lines.push(`Paladin: smote the last of ${name}.`)
    } else {
      stacks = stacks.map((row) =>
        row.id === live.id ? applied.stack! : row,
      )
      lines.push(
        `Paladin: executed 1 ${name} (${applied.stack.qty} remain).`,
      )
    }
  }
  if (kills <= 0) {
    return { battle, lines: [], hitKeys: [] }
  }
  const next = syncTombstonesFromWipes(
    battle,
    { ...battle, stacks, unitDeaths },
    catalog,
  )
  return {
    battle: next,
    lines: [
      `Paladin: Temple judgment claims ${kills} enem${kills === 1 ? 'y' : 'ies'} (pool ${Math.floor(intel)}×${templeCount}).`,
      ...lines,
    ],
    hitKeys: [...new Set(hitKeys)],
  }
}

export function applyTempleEndOfRoundPassives(
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  heroes: CombatHeroes | undefined,
): {
  battle: CombatBattle
  lines: string[]
  hitKeys: string[]
  healKeys: string[]
} {
  let next = battle
  const lines: string[] = []
  const hitKeys: string[] = []
  const healKeys: string[] = []
  for (const side of ['atk', 'def'] as CombatSide[]) {
    const healed = applyClericPooledHeal(next, catalog, heroes, side)
    next = healed.battle
    lines.push(...healed.lines)
    healKeys.push(...healed.healKeys)
    const smote = applyPaladinPooledExecute(next, catalog, heroes, side)
    next = smote.battle
    lines.push(...smote.lines)
    hitKeys.push(...smote.hitKeys)
  }
  return {
    battle: next,
    lines,
    hitKeys: [...new Set(hitKeys)],
    healKeys: [...new Set(healKeys)],
  }
}

/**
 * High Priestess: after a kill-triggering attack, fully heal the single
 * most-injured Temple stack on the attacker's side (once per attack).
 * HP top-off only — never restores quantity / revives dead creatures.
 */
export function applyHighPriestessHealOnKill(
  stacks: CombatStack[],
  attacker: CombatStack,
  catalog: ReferenceCatalog,
): { stacks: CombatStack[]; lines: string[]; healKeys: string[] } {
  const candidates = stacks
    .filter(
      (row) =>
        row.side === attacker.side &&
        row.qty > 0 &&
        !isHeroStack(row) &&
        !row.indestructible &&
        isTempleUnit(catalog, row.unitId) &&
        isCreatureArmyUnit(unitById(catalog, row.unitId)) &&
        frontDeficit(row, catalog) > 0,
    )
    .sort((a, b) => {
      const da = frontDeficit(a, catalog)
      const db = frontDeficit(b, catalog)
      if (db !== da) {
        return db - da
      }
      return a.id.localeCompare(b.id)
    })
  const target = candidates[0]
  if (!target) {
    return { stacks, lines: [], healKeys: [] }
  }
  const full = stackMaxHealth(target, catalog)
  const need = frontDeficit(target, catalog)
  const healed = applyStackHeal(target, need, full)
  if (healed.healed <= 0) {
    return { stacks, lines: [], healKeys: [] }
  }
  const name = unitById(catalog, healed.stack.unitId)?.name ?? 'unit'
  return {
    stacks: stacks.map((row) =>
      row.id === target.id ? healed.stack : row,
    ),
    lines: [
      `High Priestess: ${healed.stack.qty} ${name} heal to full.`,
    ],
    healKeys: [occupancyKey(target.q, target.r)],
  }
}

/**
 * Divine Aura Master: +1 effective attack qty per Temple ally stack within
 * aura radius (not including self). Stack size does not matter — each stack
 * contributes a flat +1. Same ally can contribute to multiple Aura Masters.
 */
export function auraExtraQty(
  attacker: CombatStack,
  stacks: CombatStack[],
  catalog: ReferenceCatalog,
  radius: number,
): number {
  if (radius < 1) {
    return 0
  }
  let extra = 0
  for (const row of stacks) {
    if (
      row.id === attacker.id ||
      row.side !== attacker.side ||
      row.qty <= 0 ||
      isHeroStack(row) ||
      !isTempleUnit(catalog, row.unitId) ||
      !isCreatureArmyUnit(unitById(catalog, row.unitId))
    ) {
      continue
    }
    const dist = hexDistance(
      { q: attacker.q, r: attacker.r },
      { q: row.q, r: row.r },
    )
    if (dist <= radius) {
      extra += 1
    }
  }
  return extra
}

/** Battlefield hex keys inside an aura radius (inclusive of the caster hex). */
export function auraRadiusHexKeys(
  center: { q: number; r: number },
  radius: number,
  tiles: { q: number; r: number }[],
): string[] {
  if (radius < 1) {
    return []
  }
  const keys: string[] = []
  for (const tile of tiles) {
    if (hexDistance(center, { q: tile.q, r: tile.r }) <= radius) {
      keys.push(occupancyKey(tile.q, tile.r))
    }
  }
  return keys
}
