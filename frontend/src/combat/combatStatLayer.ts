import type { Hero } from '../session/types'
import {
  commandingHeroStats,
  unitById,
  type ReferenceCatalog,
  type StatShredTarget,
} from '../town/catalog'
import type { CombatStack } from './battle'
import type { CombatStatShred } from './battle'

export type CombatStatBuff = CombatStatShred

export function isMagicDmgType(dmgType: string | null | undefined): boolean {
  return (dmgType ?? '').trim().toLowerCase() === 'magic'
}

type LayerField = keyof CombatStatShred

function catalogValue(
  catalog: ReferenceCatalog,
  stack: CombatStack,
  field: LayerField,
): number {
  const unit = unitById(catalog, stack.unitId)
  if (!unit) {
    return 0
  }
  switch (field) {
    case 'speed':
      return unit.speed ?? 0
    case 'defense':
      return unit.defense ?? 0
    case 'resistance':
      return unit.resistance ?? 0
    case 'minDmg':
      return unit.min_dmg ?? 0
    case 'maxDmg':
      return unit.max_dmg ?? 0
    case 'maxHp':
      return unit.health ?? 1
    default:
      return 0
  }
}

/** Effective permanent layer (buff overrides shred when both set). */
export function layerFieldValue(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  field: LayerField,
): number {
  const cat = catalogValue(catalog, stack, field)
  const shredded = stack.statShred?.[field]
  const buffed = stack.statBuff?.[field]
  if (buffed != null) {
    return buffed
  }
  if (shredded != null) {
    return shredded
  }
  return cat
}

export function layerCritValues(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
): { pct: number; amt: number } {
  const buff = stack.statBuff
  const shred = stack.statShred
  if (buff?.critPct != null || buff?.critAmt != null) {
    return {
      pct: Math.max(0, buff.critPct ?? 0),
      amt: Math.max(0, buff.critAmt ?? 0),
    }
  }
  if (shred?.critPct != null || shred?.critAmt != null) {
    return {
      pct: Math.max(0, shred.critPct ?? 0),
      amt: Math.max(0, shred.critAmt ?? 0),
    }
  }
  const heroStats = hero
    ? commandingHeroStats(catalog, hero)
    : { crit_pct: 0, crit_amt: 0 }
  return {
    pct: Math.max(0, heroStats.crit_pct + (stack.critPctBonus ?? 0)),
    amt: Math.max(0, heroStats.crit_amt + (stack.critAmtBonus ?? 0)),
  }
}

export function layerValueForTarget(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  target: StatShredTarget,
  hero: Hero | null | undefined,
): number | null {
  const unit = unitById(catalog, stack.unitId)
  if (!unit) {
    return null
  }
  switch (target) {
    case 'speed':
      if (unit.speed == null && stack.statShred?.speed == null && stack.statBuff?.speed == null) {
        return null
      }
      return layerFieldValue(stack, catalog, 'speed')
    case 'defense':
      return layerFieldValue(stack, catalog, 'defense')
    case 'resistance':
      return layerFieldValue(stack, catalog, 'resistance')
    case 'phys_dmg':
      if (isMagicDmgType(unit.dmg_type)) {
        return null
      }
      return layerFieldValue(stack, catalog, 'minDmg')
    case 'magic_dmg':
      if (!isMagicDmgType(unit.dmg_type)) {
        return null
      }
      return layerFieldValue(stack, catalog, 'minDmg')
    case 'max_hp':
      return layerFieldValue(stack, catalog, 'maxHp')
    case 'crit':
      return layerCritValues(stack, catalog, hero).pct
    default:
      return null
  }
}

export function applyLayerDecrease(
  current: number,
  pct: number,
  floor = 0,
): number {
  const decrease = Math.round((current * pct) / 100)
  return Math.max(floor, current - decrease)
}

export function applyLayerIncrease(
  current: number,
  pct: number,
  floor = 0,
): number {
  const increase = Math.round((current * pct) / 100)
  return Math.max(floor, current + increase)
}

/** Ally buff: raise by at least `minGain` from the % roll. */
export function applyLayerIncreaseWithMinGain(
  current: number,
  pct: number,
  floor: number,
  minGain: number,
): number {
  const increase = Math.max(minGain, Math.round((current * pct) / 100))
  return Math.max(floor, current + increase)
}

export function mergeStatShred(
  stack: CombatStack,
  patch: Partial<CombatStatShred>,
): CombatStack {
  const next = { ...(stack.statShred ?? {}), ...patch }
  const hasAny = Object.values(next).some((v) => v != null)
  return {
    ...stack,
    statShred: hasAny ? next : undefined,
  }
}

export function mergeStatBuff(
  stack: CombatStack,
  patch: Partial<CombatStatBuff>,
): CombatStack {
  const next = { ...(stack.statBuff ?? {}), ...patch }
  const hasAny = Object.values(next).some((v) => v != null)
  return {
    ...stack,
    statBuff: hasAny ? next : undefined,
  }
}

/** Keep both permanent layers aligned after a change. */
export function syncPermanentLayers(
  stack: CombatStack,
  patch: Partial<CombatStatShred>,
): CombatStack {
  let next = stack
  if (Object.keys(patch).length > 0) {
    next = mergeStatShred(next, patch)
    if (next.statBuff) {
      next = mergeStatBuff(next, patch)
    }
  }
  return next
}

export function syncPermanentLayersBuff(
  stack: CombatStack,
  patch: Partial<CombatStatBuff>,
): CombatStack {
  let next = mergeStatBuff(stack, patch)
  if (next.statShred) {
    next = mergeStatShred(next, patch)
  }
  return next
}

export function statShredLoss(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  field: LayerField,
): number {
  if (stack.statShred?.[field] == null) {
    return 0
  }
  const cat = catalogValue(catalog, stack, field)
  return Math.max(0, cat - stack.statShred[field]!)
}

export function statBuffGain(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  field: LayerField,
): number {
  if (stack.statBuff?.[field] == null) {
    return 0
  }
  const floor = stack.statShred?.[field] ?? catalogValue(catalog, stack, field)
  return Math.max(0, stack.statBuff[field]! - floor)
}
