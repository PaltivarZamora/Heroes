import type { Axial } from '../hex/hero'
import { neighborHexes } from '../hex/pathfinding'
import type { Hero } from '../session/types'
import {
  commandingHeroStats,
  dummyHeroStat,
  type ReferenceCatalog,
} from '../town/catalog'
import { unitAttackShape, unitById, unitHasTag } from '../town/catalog'
import { heroStatValueByStatId } from '../town/statCatalog'
import type { CombatStack } from './battle'
import { isHeroStack } from './battle'
import { applyStackHeal, applyVampiricRevive } from './attack'
import { occupancyKey } from './occupancy'
import { incomingDir } from './shapes'

/** Goblin Hammersmith: ally with matching tag may be targeted for heal. */
export function isHealAllyTarget(
  attacker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
): boolean {
  if (
    isHeroStack(attacker) ||
    isHeroStack(target) ||
    attacker.id === target.id ||
    attacker.side !== target.side ||
    attacker.qty <= 0 ||
    target.qty <= 0
  ) {
    return false
  }
  const spec = unitAttackShape(unitById(catalog, attacker.unitId))
  if (!spec.healOnAllyTarget || spec.canTargetAllyIfTag == null) {
    return false
  }
  return unitHasTag(
    unitById(catalog, target.unitId),
    spec.canTargetAllyIfTag,
  )
}

export function healAmtForAllyRepair(
  attacker: CombatStack,
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): number {
  const spec = unitAttackShape(unitById(catalog, attacker.unitId))
  if (spec.healFormula) {
    const heroStat = hero
      ? heroStatValueByStatId(
          catalog,
          commandingHeroStats(catalog, hero),
          spec.healFormula.heroStatId,
        )
      : dummyHeroStat(catalog)
    const total = (heroStat / spec.healFormula.div) * attacker.qty
    return Math.max(0, Math.floor(total))
  }
  const per = spec.healAmtPerUnit ?? 0
  return Math.max(0, Math.floor(per * attacker.qty))
}

export function applyAllyStackRepair(
  target: CombatStack,
  amount: number,
  fullHealth: number,
  revive: boolean,
): { stack: CombatStack; healed: number; revived: number } {
  if (amount <= 0 || target.qty <= 0) {
    return { stack: target, healed: 0, revived: 0 }
  }
  if (revive) {
    const next = applyVampiricRevive(target, amount, fullHealth)
    return {
      stack: next.stack,
      healed: next.healed,
      revived: next.revived,
    }
  }
  const top = applyStackHeal(target, amount, fullHealth)
  return { stack: top.stack, healed: top.healed, revived: 0 }
}

export function formatAllyRepairLog(
  atkName: string,
  defName: string,
  healed: number,
  revived: number,
): string {
  if (healed <= 0 && revived <= 0) {
    return `${atkName} repairs ${defName}: no effect`
  }
  const bits = [`+${healed} HP`]
  if (revived > 0) {
    bits.push(`${revived} revived`)
  }
  return `${atkName} repairs ${defName}: ${bits.join(', ')}`
}

function isNeighbor(a: Axial, b: Axial): boolean {
  return neighborHexes(a).some((hex) => hex.q === b.q && hex.r === b.r)
}

/**
 * Barricade line: continuous empty hexes of length N centered on `aim`, along `dir`.
 * Skips occupied hexes when `avoidOccupied`; grows along the axis then
 * fills gaps via adjacent empty hexes when needed.
 */
export function barrierLineHexes(
  aim: Axial,
  length: number,
  dir: Axial,
  board: ReadonlySet<string>,
  occupied: ReadonlySet<string>,
  avoidOccupied: boolean,
): Axial[] {
  const want = Math.max(1, Math.floor(length))
  const open = (hex: Axial) => {
    const key = occupancyKey(hex.q, hex.r)
    if (!board.has(key)) {
      return false
    }
    if (avoidOccupied && occupied.has(key)) {
      return false
    }
    return true
  }
  const axis: Axial[] = []
  // Walk outward along ±dir from aim (aim first if open).
  if (open(aim)) {
    axis.push(aim)
  }
  for (let step = 1; axis.length < want * 2; step += 1) {
    const neg = { q: aim.q - dir.q * step, r: aim.r - dir.r * step }
    const pos = { q: aim.q + dir.q * step, r: aim.r + dir.r * step }
    if (open(neg)) {
      axis.unshift(neg)
    }
    if (open(pos)) {
      axis.push(pos)
    }
    if (!board.has(occupancyKey(neg.q, neg.r)) && !board.has(occupancyKey(pos.q, pos.r))) {
      break
    }
  }
  // Prefer a contiguous segment containing aim (or closest to it).
  let best: Axial[] = []
  for (let i = 0; i < axis.length; i += 1) {
    const run: Axial[] = [axis[i]!]
    for (let j = i + 1; j < axis.length; j += 1) {
      const prev = run[run.length - 1]!
      const next = axis[j]!
      if (!isNeighbor(prev, next)) {
        break
      }
      run.push(next)
    }
    if (run.length > best.length) {
      best = run
    }
    if (best.length >= want) {
      break
    }
  }
  if (best.length >= want) {
    // Center the window on aim when possible.
    const aimIdx = best.findIndex((hex) => hex.q === aim.q && hex.r === aim.r)
    if (aimIdx >= 0) {
      const half = Math.floor((want - 1) / 2)
      let start = Math.max(0, aimIdx - half)
      start = Math.min(start, Math.max(0, best.length - want))
      return best.slice(start, start + want)
    }
    return best.slice(0, want)
  }
  // Shortfall: grow from whatever we have using empty neighbors.
  const out = [...best]
  const seen = new Set(out.map((hex) => occupancyKey(hex.q, hex.r)))
  while (out.length < want) {
    let added: Axial | null = null
    for (const hex of out) {
      for (const n of neighborHexes(hex)) {
        const key = occupancyKey(n.q, n.r)
        if (seen.has(key) || !open(n)) {
          continue
        }
        added = n
        break
      }
      if (added) {
        break
      }
    }
    if (!added) {
      break
    }
    out.push(added)
    seen.add(occupancyKey(added.q, added.r))
  }
  return out.slice(0, want)
}

/** Direction for a barrier line. Prefer explicit cast orientation; else caster→aim. */
export function barrierLineDir(
  from: Axial | null,
  aim: Axial,
  chosen?: Axial | null,
): Axial {
  if (chosen && (chosen.q !== 0 || chosen.r !== 0)) {
    return { q: chosen.q, r: chosen.r }
  }
  if (!from || (from.q === aim.q && from.r === aim.r)) {
    return { q: 1, r: 0 }
  }
  return incomingDir(from, aim)
}
