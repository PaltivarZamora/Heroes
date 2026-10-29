import type { Hero } from '../session/types'
import {
  commandingHeroStats,
  dummyHeroStat,
  unitAttackShape,
  unitById,
  type ExtraTurnChanceConfig,
  type ReferenceCatalog,
} from '../town/catalog'
import { heroStatValueByStatId } from '../town/statCatalog'
import type { CombatBattle } from './battle'

function stackName(catalog: ReferenceCatalog, unitId: number): string {
  return unitById(catalog, unitId)?.name ?? 'Unknown'
}

function heroStatForConfig(
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

export function rollExtraTurnChance(
  catalog: ReferenceCatalog,
  config: ExtraTurnChanceConfig,
  hero: Hero | null | undefined,
  random: () => number,
): { triggered: boolean; chancePct: number } {
  const stat = heroStatForConfig(catalog, hero, config.heroStatId)
  const chancePct = Math.min(100, Math.max(0, stat * config.mult))
  if (chancePct <= 0) {
    return { triggered: false, chancePct }
  }
  const roll = random() * 100
  return { triggered: roll < chancePct, chancePct }
}

export type ExtraTurnChanceResult = {
  battle: CombatBattle
  grantExtraTurn: boolean
  line: string | null
}

export function applyExtraTurnChanceAfterAttack(
  battle: CombatBattle,
  attackerId: string,
  catalog: ReferenceCatalog,
  hero: Hero | null | undefined,
  random: () => number,
): ExtraTurnChanceResult {
  const actor = battle.stacks.find((row) => row.id === attackerId)
  if (!actor || actor.qty <= 0) {
    return { battle, grantExtraTurn: false, line: null }
  }
  const config = unitAttackShape(unitById(catalog, actor.unitId)).extraTurnChance
  if (!config) {
    return { battle, grantExtraTurn: false, line: null }
  }
  const chain = actor.extraTurnChanceChain ?? 0
  if (chain >= config.maxChain) {
    return { battle, grantExtraTurn: false, line: null }
  }
  const rolled = rollExtraTurnChance(catalog, config, hero, random)
  const name = stackName(catalog, actor.unitId)
  if (!rolled.triggered) {
    const battleCleared = setExtraTurnChain(battle, attackerId, 0)
    return { battle: battleCleared, grantExtraTurn: false, line: null }
  }
  const battleChained = setExtraTurnChain(battle, attackerId, chain + 1)
  return {
    battle: battleChained,
    grantExtraTurn: true,
    line: `${name} takes an extra turn`,
  }
}

export function setExtraTurnChain(
  battle: CombatBattle,
  stackId: string,
  chain: number,
): CombatBattle {
  return {
    ...battle,
    stacks: battle.stacks.map((row) =>
      row.id === stackId
        ? {
            ...row,
            extraTurnChanceChain: chain > 0 ? chain : undefined,
          }
        : row,
    ),
  }
}

export function clearExtraTurnChanceChain(
  battle: CombatBattle,
  stackId: string,
): CombatBattle {
  return setExtraTurnChain(battle, stackId, 0)
}
