import type { Hero } from '../session/types'
import {
  commandingHeroStats,
  dummyHeroStat,
  unitById,
  type ReferenceCatalog,
  type StatShredTarget,
  type UnitStatShredConfig,
} from '../town/catalog'
import { heroStatValueByStatId } from '../town/statCatalog'
import type { CombatStack } from './battle'
import { stackMaxHealth, stackResistance } from './battle'
import {
  applyLayerDecrease,
  isMagicDmgType,
  layerCritValues,
  layerFieldValue,
  layerValueForTarget,
  statBuffGain,
  statShredLoss,
  syncPermanentLayers,
} from './combatStatLayer'
import { formatChancePct } from './combatLog'
import { targetLabel } from './statShredLabels'

function stackName(catalog: ReferenceCatalog, unitId: number): string {
  return unitById(catalog, unitId)?.name ?? 'Unknown'
}

export { statShredLoss, statBuffGain }

export function formatInspectStatWithShred(
  effective: number,
  stack: CombatStack,
  catalog: ReferenceCatalog,
  field: keyof NonNullable<CombatStack['statShred']>,
): string {
  const loss = statShredLoss(stack, catalog, field)
  const gain = statBuffGain(stack, catalog, field)
  if (loss <= 0 && gain <= 0) {
    return String(effective)
  }
  const parts: string[] = []
  if (loss > 0) {
    parts.push(`−${loss} debuff`)
  }
  if (gain > 0) {
    parts.push(`+${gain} buff`)
  }
  return `${effective} (${parts.join(', ')})`
}

export function formatInspectDamageRangeWithShred(
  minDmg: number,
  maxDmg: number,
  stack: CombatStack,
  catalog: ReferenceCatalog,
): string {
  const unit = unitById(catalog, stack.unitId)
  const kind = isMagicDmgType(unit?.dmg_type) ? 'Magic Dmg' : 'Phys Dmg'
  const loss = Math.max(
    statShredLoss(stack, catalog, 'minDmg'),
    statShredLoss(stack, catalog, 'maxDmg'),
  )
  const gain = Math.max(
    statBuffGain(stack, catalog, 'minDmg'),
    statBuffGain(stack, catalog, 'maxDmg'),
  )
  const range = `${minDmg}–${maxDmg}`
  if (loss <= 0 && gain <= 0) {
    return range
  }
  const parts: string[] = []
  if (loss > 0) {
    parts.push(`−${loss} debuff`)
  }
  if (gain > 0) {
    parts.push(`+${gain} buff`)
  }
  return `${kind} ${range} (${parts.join(', ')})`
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

export function stackCritStatsFromShred(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  attackerHero: Hero | undefined,
  extraPct = 0,
  extraAmt = 0,
): { pct: number; amt: number; minBonus: number; shredded: boolean } {
  const layered = layerCritValues(stack, catalog, attackerHero)
  const hasLayer =
    stack.statShred?.critPct != null ||
    stack.statShred?.critAmt != null ||
    stack.statBuff?.critPct != null ||
    stack.statBuff?.critAmt != null
  return {
    pct: Math.max(0, layered.pct + extraPct),
    amt: Math.max(0, layered.amt + extraAmt),
    minBonus: Math.max(1, stack.minCritBonusDmg ?? 1),
    shredded: hasLayer,
  }
}

const RANDOM_STAT_SHRED_POOL: StatShredTarget[] = [
  'speed',
  'defense',
  'resistance',
  'phys_dmg',
  'magic_dmg',
  'max_hp',
  'crit',
]

function statShredTargetCanApply(
  catalog: ReferenceCatalog,
  target: CombatStack,
  targetStat: StatShredTarget,
  defenderHero: Hero | null | undefined,
): boolean {
  if (targetStat === 'random') {
    return false
  }
  const unit = unitById(catalog, target.unitId)
  if (targetStat === 'phys_dmg' || targetStat === 'magic_dmg') {
    if (!unit) {
      return false
    }
    const magic = isMagicDmgType(unit.dmg_type)
    if (targetStat === 'phys_dmg' && magic) {
      return false
    }
    if (targetStat === 'magic_dmg' && !magic) {
      return false
    }
    return true
  }
  if (targetStat === 'max_hp') {
    return unit != null
  }
  if (targetStat === 'crit') {
    return true
  }
  return (
    layerValueForTarget(target, catalog, targetStat, defenderHero) != null
  )
}

function pickRandomStatShredTarget(
  catalog: ReferenceCatalog,
  target: CombatStack,
  defenderHero: Hero | null | undefined,
  random: () => number,
): StatShredTarget | null {
  const eligible = RANDOM_STAT_SHRED_POOL.filter((row) =>
    statShredTargetCanApply(catalog, target, row, defenderHero),
  )
  if (eligible.length === 0) {
    return null
  }
  const i = Math.min(
    eligible.length - 1,
    Math.floor(random() * eligible.length),
  )
  return eligible[i] ?? null
}

export function tryApplyStatShredFromHit(
  catalog: ReferenceCatalog,
  attacker: CombatStack,
  target: CombatStack,
  config: UnitStatShredConfig,
  attackerHero: Hero | null | undefined,
  defenderHero: Hero | null | undefined,
  random: () => number,
): { stack: CombatStack; lines: string[] } {
  let active = config
  if (config.targetStat === 'random') {
    const picked = pickRandomStatShredTarget(
      catalog,
      target,
      defenderHero,
      random,
    )
    if (!picked) {
      return { stack: target, lines: [] }
    }
    active = { ...config, targetStat: picked }
  }
  const applyChance = Math.max(0, 100 - stackResistance(target, catalog))
  const roll = Math.floor(random() * 10000) / 100
  const triggered = roll < applyChance
  const targetName = stackName(catalog, target.unitId)
  const attackerName = stackName(catalog, attacker.unitId)
  if (!triggered) {
    return {
      stack: target,
      lines: [
        `${targetName} resisted the debuff (rolled ${formatChancePct(roll)} vs ${formatChancePct(applyChance)}%)`,
      ],
    }
  }

  const shredPct = Math.min(
    100,
    attackerStatForShred(catalog, attackerHero, active.heroStatId) *
      active.mult,
  )
  if (shredPct <= 0) {
    return { stack: target, lines: [] }
  }

  const statName = targetLabel(catalog, active.targetStat)
  const unit = unitById(catalog, target.unitId)

  if (active.targetStat === 'phys_dmg' || active.targetStat === 'magic_dmg') {
    if (!unit) {
      return { stack: target, lines: [] }
    }
    const magic = isMagicDmgType(unit.dmg_type)
    if (
      (active.targetStat === 'phys_dmg' && magic) ||
      (active.targetStat === 'magic_dmg' && !magic)
    ) {
      return { stack: target, lines: [] }
    }
    const beforeMin = layerFieldValue(target, catalog, 'minDmg')
    const beforeMax = layerFieldValue(target, catalog, 'maxDmg')
    const afterMin = applyLayerDecrease(beforeMin, shredPct, 1)
    const afterMax = applyLayerDecrease(beforeMax, shredPct, 1)
    const next = syncPermanentLayers(target, {
      minDmg: afterMin,
      maxDmg: afterMax,
    })
    return {
      stack: next,
      lines:
        afterMin !== beforeMin || afterMax !== beforeMax
          ? [
              `${attackerName} debuffed ${targetName} ${statName} ${beforeMin}–${beforeMax} → ${afterMin}–${afterMax}`,
            ]
          : [],
    }
  }

  if (active.targetStat === 'crit') {
    const before = layerCritValues(target, catalog, defenderHero)
    const afterPct = applyLayerDecrease(before.pct, shredPct, 0)
    const afterAmt = applyLayerDecrease(before.amt, shredPct, 0)
    const next = syncPermanentLayers(target, {
      critPct: afterPct,
      critAmt: afterAmt,
    })
    return {
      stack: next,
      lines:
        afterPct !== before.pct || afterAmt !== before.amt
          ? [
              `${attackerName} debuffed ${targetName} ${statName} ${before.pct}%/${before.amt}% → ${afterPct}%/${afterAmt}%`,
            ]
          : [],
    }
  }

  if (active.targetStat === 'max_hp') {
    if (!unit) {
      return { stack: target, lines: [] }
    }
    const before = layerFieldValue(target, catalog, 'maxHp')
    const after = applyLayerDecrease(before, shredPct, 1)
    let next = syncPermanentLayers(target, { maxHp: after })
    const newMax = stackMaxHealth(next, catalog)
    if (next.topHealth > newMax) {
      next = { ...next, topHealth: newMax }
    }
    return {
      stack: next,
      lines:
        after !== before
          ? [
              `${attackerName} debuffed ${targetName} ${statName} ${before} → ${after}`,
            ]
          : [],
    }
  }

  const before = layerValueForTarget(
    target,
    catalog,
    active.targetStat,
    defenderHero,
  )
  if (before == null) {
    return { stack: target, lines: [] }
  }
  const floor =
    active.targetStat === 'speed'
      ? 1
      : active.targetStat === 'defense' || active.targetStat === 'resistance'
        ? 0
        : 0
  const after = applyLayerDecrease(before, shredPct, floor)
  const patch: Partial<CombatStack['statShred']> = {}
  if (active.targetStat === 'speed') {
    patch.speed = after
  } else if (active.targetStat === 'defense') {
    patch.defense = after
  } else {
    patch.resistance = after
  }
  const next = syncPermanentLayers(target, patch)
  return {
    stack: next,
    lines:
      after !== before
        ? [
            `${attackerName} debuffed ${targetName} ${statName} ${before} → ${after}`,
          ]
        : [],
  }
}
