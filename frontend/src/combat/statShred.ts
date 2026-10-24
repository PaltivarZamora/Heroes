import type { Hero } from '../session/types'
import {
  commandingHeroStats,
  dummyHeroStat,
  unitById,
  type ReferenceCatalog,
  type UnitStatShredConfig,
} from '../town/catalog'
import { heroStatValueByStatId, statById } from '../town/statCatalog'
import type { CombatStack } from './battle'
import { stackResistance } from './battle'
import { formatChancePct } from './combatLog'

function stackName(catalog: ReferenceCatalog, unitId: number): string {
  return unitById(catalog, unitId)?.name ?? 'Unknown'
}

function targetLabel(
  catalog: ReferenceCatalog,
  target: UnitStatShredConfig['targetStat'],
): string {
  if (target === 'dmg') {
    return 'Damage'
  }
  if (target === 'speed') {
    return statById(catalog, 1)?.name ?? 'Speed'
  }
  if (target === 'defense') {
    return statById(catalog, 4)?.name ?? 'Defense'
  }
  return statById(catalog, 5)?.name ?? 'Resistance'
}

function shredLayerValue(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  target: UnitStatShredConfig['targetStat'],
): number | null {
  const unit = unitById(catalog, stack.unitId)
  if (!unit) {
    return null
  }
  const shred = stack.statShred
  switch (target) {
    case 'speed':
      if (unit.speed == null && shred?.speed == null) {
        return null
      }
      return shred?.speed != null ? shred.speed : (unit.speed ?? 0)
    case 'defense':
      return shred?.defense != null ? shred.defense : (unit.defense ?? 0)
    case 'resistance':
      return shred?.resistance != null
        ? shred.resistance
        : (unit.resistance ?? 0)
    case 'dmg':
      return null
    default:
      return null
  }
}

function applyShredPercent(current: number, shredPct: number): number {
  const decrease = Math.round((current * shredPct) / 100)
  return Math.max(0, current - decrease)
}

function mergeShred(
  stack: CombatStack,
  patch: Partial<NonNullable<CombatStack['statShred']>>,
): CombatStack {
  const next = { ...(stack.statShred ?? {}), ...patch }
  const hasAny = Object.values(next).some((v) => v != null)
  return {
    ...stack,
    statShred: hasAny ? next : undefined,
  }
}

export function statShredLoss(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  field: keyof NonNullable<CombatStack['statShred']>,
): number {
  const unit = unitById(catalog, stack.unitId)
  if (!unit || stack.statShred?.[field] == null) {
    return 0
  }
  let catalogVal = 0
  switch (field) {
    case 'speed':
      catalogVal = unit.speed ?? 0
      break
    case 'defense':
      catalogVal = unit.defense ?? 0
      break
    case 'resistance':
      catalogVal = unit.resistance ?? 0
      break
    case 'minDmg':
      catalogVal = unit.min_dmg ?? 0
      break
    case 'maxDmg':
      catalogVal = unit.max_dmg ?? 0
      break
    default:
      break
  }
  return Math.max(0, catalogVal - (stack.statShred[field] ?? catalogVal))
}

export function formatInspectStatWithShred(
  effective: number,
  stack: CombatStack,
  catalog: ReferenceCatalog,
  field: keyof NonNullable<CombatStack['statShred']>,
): string {
  const loss = statShredLoss(stack, catalog, field)
  if (loss <= 0) {
    return String(effective)
  }
  return `${effective} (−${loss} shred)`
}

function attackerStatForShred(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  heroStatId: number,
): number {
  if (!hero) {
    return dummyHeroStat(catalog)
  }
  return heroStatValueByStatId(
    catalog,
    commandingHeroStats(catalog, hero),
    heroStatId,
  )
}

export function tryApplyStatShredFromHit(
  catalog: ReferenceCatalog,
  attacker: CombatStack,
  target: CombatStack,
  config: UnitStatShredConfig,
  attackerHero: Hero | null | undefined,
  random: () => number,
): { stack: CombatStack; lines: string[] } {
  const applyChance = Math.max(0, 100 - stackResistance(target, catalog))
  const roll = Math.floor(random() * 10000) / 100
  const triggered = roll < applyChance
  const targetName = stackName(catalog, target.unitId)
  const attackerName = stackName(catalog, attacker.unitId)
  if (!triggered) {
    return {
      stack: target,
      lines: [
        `${targetName} resisted the shred (rolled ${formatChancePct(roll)} vs ${formatChancePct(applyChance)}%)`,
      ],
    }
  }

  const shredPct = Math.min(
    100,
    attackerStatForShred(catalog, attackerHero, config.heroStatId) *
      config.mult,
  )
  if (shredPct <= 0) {
    return { stack: target, lines: [] }
  }

  const statName = targetLabel(catalog, config.targetStat)

  if (config.targetStat === 'dmg') {
    const unit = unitById(catalog, target.unitId)
    if (!unit) {
      return { stack: target, lines: [] }
    }
    const beforeMin =
      target.statShred?.minDmg != null
        ? target.statShred.minDmg
        : (unit.min_dmg ?? 0)
    const beforeMax =
      target.statShred?.maxDmg != null
        ? target.statShred.maxDmg
        : (unit.max_dmg ?? 0)
    const afterMin = applyShredPercent(beforeMin, shredPct)
    const afterMax = applyShredPercent(beforeMax, shredPct)
    const next = mergeShred(target, { minDmg: afterMin, maxDmg: afterMax })
    return {
      stack: next,
      lines: [
        `${attackerName} shredded ${targetName} ${statName} ${beforeMin}–${beforeMax} → ${afterMin}–${afterMax}`,
      ],
    }
  }

  const before = shredLayerValue(target, catalog, config.targetStat)
  if (before == null) {
    return { stack: target, lines: [] }
  }
  const after = applyShredPercent(before, shredPct)
  const patch: Partial<NonNullable<CombatStack['statShred']>> = {}
  if (config.targetStat === 'speed') {
    patch.speed = after
  } else if (config.targetStat === 'defense') {
    patch.defense = after
  } else {
    patch.resistance = after
  }
  const next = mergeShred(target, patch)
  return {
    stack: next,
    lines: [
      `${attackerName} shredded ${targetName} ${statName} ${before} → ${after}`,
    ],
  }
}
