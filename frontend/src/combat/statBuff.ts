import type { Hero } from '../session/types'
import { hexDistance } from '../hex/pathfinding'
import {
  commandingHeroStats,
  dummyHeroStat,
  unitById,
  type ReferenceCatalog,
  type StatShredTarget,
  type UnitAllyBuffConfig,
  type UnitStatShredConfig,
} from '../town/catalog'
import { heroStatValueByStatId } from '../town/statCatalog'
import type { CombatStack } from './battle'
import { stackMaxHealth } from './battle'
import {
  applyLayerIncrease,
  applyLayerIncreaseWithMinGain,
  isMagicDmgType,
  layerCritValues,
  layerFieldValue,
  layerValueForTarget,
  syncPermanentLayersBuff,
} from './combatStatLayer'
import { targetLabel } from './statShredLabels'

function stackName(catalog: ReferenceCatalog, unitId: number): string {
  return unitById(catalog, unitId)?.name ?? 'Unknown'
}

function attackerStatForBuff(
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

function layerAfterBuff(
  current: number,
  buffPct: number,
  floor: number,
  minGain: number,
): number {
  if (minGain > 0) {
    return applyLayerIncreaseWithMinGain(current, buffPct, floor, minGain)
  }
  return applyLayerIncrease(current, buffPct, floor)
}

function buffLogLine(
  subjectName: string,
  blesserName: string | undefined,
  statName: string,
  before: string,
  after: string,
): string {
  if (blesserName) {
    return `${blesserName} blesses ${subjectName}: ${statName} ${before} → ${after}`
  }
  return `${subjectName} grows stronger: ${statName} ${before} → ${after}`
}

function inspireStatLabel(
  catalog: ReferenceCatalog,
  targetStat: StatShredTarget,
): string {
  if (targetStat === 'crit') {
    return 'Crits'
  }
  return targetLabel(catalog, targetStat)
}

type BuffApplyResult = {
  stack: CombatStack
  lines: string[]
  delta: number
}

function applyBuffToStack(
  catalog: ReferenceCatalog,
  stack: CombatStack,
  config: UnitStatShredConfig,
  buffPct: number,
  hero: Hero | null | undefined,
  opts: { minGain?: number; blesserName?: string; quiet?: boolean },
): BuffApplyResult {
  const minGain = opts.minGain ?? 0
  const unit = unitById(catalog, stack.unitId)
  const name = stackName(catalog, stack.unitId)
  const statName = targetLabel(catalog, config.targetStat)
  const quiet = opts.quiet === true

  if (config.targetStat === 'phys_dmg' || config.targetStat === 'magic_dmg') {
    if (!unit) {
      return { stack, lines: [], delta: 0 }
    }
    const magic = isMagicDmgType(unit.dmg_type)
    if (
      (config.targetStat === 'phys_dmg' && magic) ||
      (config.targetStat === 'magic_dmg' && !magic)
    ) {
      return { stack, lines: [], delta: 0 }
    }
    const beforeMin = layerFieldValue(stack, catalog, 'minDmg')
    const beforeMax = layerFieldValue(stack, catalog, 'maxDmg')
    const afterMin = layerAfterBuff(beforeMin, buffPct, 1, minGain)
    const afterMax = layerAfterBuff(beforeMax, buffPct, 1, minGain)
    const next = syncPermanentLayersBuff(stack, {
      minDmg: afterMin,
      maxDmg: afterMax,
    })
    const delta = afterMin - beforeMin
    if (delta <= 0 && afterMax <= beforeMax) {
      return { stack, lines: [], delta: 0 }
    }
    return {
      stack: next,
      lines: quiet
        ? []
        : [
            buffLogLine(
              name,
              opts.blesserName,
              statName,
              `${beforeMin}–${beforeMax}`,
              `${afterMin}–${afterMax}`,
            ),
          ],
      delta: Math.max(delta, afterMax - beforeMax),
    }
  }

  if (config.targetStat === 'crit') {
    const before = layerCritValues(stack, catalog, hero)
    const afterPct = layerAfterBuff(before.pct, buffPct, 0, minGain)
    const afterAmt = layerAfterBuff(before.amt, buffPct, 0, minGain)
    const next = syncPermanentLayersBuff(stack, {
      critPct: afterPct,
      critAmt: afterAmt,
    })
    const delta = Math.max(afterPct - before.pct, afterAmt - before.amt)
    if (delta <= 0) {
      return { stack, lines: [], delta: 0 }
    }
    return {
      stack: next,
      lines: quiet
        ? []
        : [
            buffLogLine(
              name,
              opts.blesserName,
              statName,
              `${before.pct}%/${before.amt}%`,
              `${afterPct}%/${afterAmt}%`,
            ),
          ],
      delta,
    }
  }

  if (config.targetStat === 'max_hp') {
    if (!unit) {
      return { stack, lines: [], delta: 0 }
    }
    const before = layerFieldValue(stack, catalog, 'maxHp')
    const after = layerAfterBuff(before, buffPct, 1, minGain)
    const delta = after - before
    if (delta <= 0) {
      return { stack, lines: [], delta: 0 }
    }
    let next = syncPermanentLayersBuff(stack, { maxHp: after })
    next = {
      ...next,
      topHealth: Math.min(
        stackMaxHealth(next, catalog),
        next.topHealth + delta,
      ),
    }
    return {
      stack: next,
      lines: quiet
        ? []
        : [
            buffLogLine(
              name,
              opts.blesserName,
              statName,
              String(before),
              String(after),
            ),
          ],
      delta,
    }
  }

  const before = layerValueForTarget(
    stack,
    catalog,
    config.targetStat,
    hero,
  )
  if (before == null) {
    return { stack, lines: [], delta: 0 }
  }
  const floor =
    config.targetStat === 'speed'
      ? 1
      : config.targetStat === 'defense' || config.targetStat === 'resistance'
        ? 0
        : 0
  const after = layerAfterBuff(before, buffPct, floor, minGain)
  const delta = after - before
  if (delta <= 0) {
    return { stack, lines: [], delta: 0 }
  }
  const patch: Partial<CombatStack['statBuff']> = {}
  if (config.targetStat === 'speed') {
    patch.speed = after
  } else if (config.targetStat === 'defense') {
    patch.defense = after
  } else {
    patch.resistance = after
  }
  const next = syncPermanentLayersBuff(stack, patch)
  return {
    stack: next,
    lines: quiet
      ? []
      : [
          buffLogLine(
            name,
            opts.blesserName,
            statName,
            String(before),
            String(after),
          ),
        ],
    delta,
  }
}

function buffPctFromConfig(
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  config: UnitStatShredConfig,
): number {
  return Math.min(
    100,
    attackerStatForBuff(catalog, hero, config.heroStatId) * config.mult,
  )
}

function adjacentFriendlyStacks(
  attacker: CombatStack,
  stacks: CombatStack[],
): CombatStack[] {
  return stacks.filter(
    (row) =>
      row.id !== attacker.id &&
      row.side === attacker.side &&
      row.qty > 0 &&
      hexDistance(attacker, row) === 1,
  )
}

export function tryApplySelfBuffFromHit(
  catalog: ReferenceCatalog,
  attacker: CombatStack,
  config: UnitStatShredConfig,
  attackerHero: Hero | null | undefined,
): { stack: CombatStack; lines: string[] } {
  const buffPct = buffPctFromConfig(catalog, attackerHero, config)
  if (buffPct <= 0) {
    return { stack: attacker, lines: [] }
  }
  const applied = applyBuffToStack(
    catalog,
    attacker,
    config,
    buffPct,
    attackerHero,
    {},
  )
  return { stack: applied.stack, lines: applied.lines }
}

function pickRandomAlly(
  stacks: CombatStack[],
  attacker: CombatStack,
  random: () => number,
): CombatStack | null {
  const pool = stacks.filter(
    (row) =>
      row.id !== attacker.id && row.side === attacker.side && row.qty > 0,
  )
  if (pool.length === 0) {
    return null
  }
  return pool[Math.floor(random() * pool.length)] ?? null
}

function tryApplyAdjacentAlliesBuff(
  catalog: ReferenceCatalog,
  stacks: CombatStack[],
  attacker: CombatStack,
  config: UnitAllyBuffConfig,
  attackerHero: Hero | null | undefined,
  heroForStack: (stack: CombatStack) => Hero | null | undefined,
): { stacks: CombatStack[]; lines: string[] } {
  const buffPct = buffPctFromConfig(catalog, attackerHero, config)
  if (buffPct <= 0) {
    return { stacks, lines: [] }
  }
  const allies = adjacentFriendlyStacks(attacker, stacks)
  if (allies.length === 0) {
    return { stacks, lines: [] }
  }
  let nextStacks = stacks
  let inspireDelta = 0
  let any = false
  for (const ally of allies) {
    const live = nextStacks.find((row) => row.id === ally.id) ?? ally
    const blessed = applyBuffToStack(
      catalog,
      live,
      config,
      buffPct,
      heroForStack(live),
      { minGain: config.minGain, quiet: true },
    )
    if (blessed.delta > 0) {
      any = true
      if (inspireDelta === 0) {
        inspireDelta = blessed.delta
      }
      nextStacks = nextStacks.map((row) =>
        row.id === ally.id ? blessed.stack : row,
      )
    }
  }
  if (!any) {
    return { stacks, lines: [] }
  }
  const atkName = stackName(catalog, attacker.unitId)
  const label = inspireStatLabel(catalog, config.targetStat)
  return {
    stacks: nextStacks,
    lines: [
      `${atkName} inspires adjacent allies: ${label} +${inspireDelta}`,
    ],
  }
}

export function tryApplyAllyBuffFromHit(
  catalog: ReferenceCatalog,
  stacks: CombatStack[],
  attacker: CombatStack,
  config: UnitAllyBuffConfig,
  attackerHero: Hero | null | undefined,
  heroForStack: (stack: CombatStack) => Hero | null | undefined,
  random: () => number,
): { stacks: CombatStack[]; lines: string[] } {
  if (config.target === 'adjacent_allies') {
    return tryApplyAdjacentAlliesBuff(
      catalog,
      stacks,
      attacker,
      config,
      attackerHero,
      heroForStack,
    )
  }
  const ally = pickRandomAlly(stacks, attacker, random)
  if (!ally) {
    return { stacks, lines: [] }
  }
  const buffPct = buffPctFromConfig(catalog, attackerHero, config)
  if (buffPct <= 0) {
    return { stacks, lines: [] }
  }
  const blesserName = stackName(catalog, attacker.unitId)
  const blessed = applyBuffToStack(
    catalog,
    ally,
    config,
    buffPct,
    heroForStack(ally),
    {
      minGain: config.minGain,
      blesserName,
    },
  )
  if (blessed.lines.length === 0) {
    return { stacks, lines: [] }
  }
  return {
    stacks: stacks.map((row) => (row.id === ally.id ? blessed.stack : row)),
    lines: blessed.lines,
  }
}
