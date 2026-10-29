import type { Hero } from '../session/types'
import {
  commandingHeroStats,
  dummyHeroStat,
  unitAttackShape,
  unitById,
  type ReferenceCatalog,
} from '../town/catalog'
import { heroStatValueByStatId } from '../town/statCatalog'
import type { CombatBattle, CombatStack } from './battle'

type CombatHeroes = { atk?: Hero; def?: Hero }

function heroForSide(
  side: CombatStack['side'],
  heroes: CombatHeroes | undefined,
): Hero | undefined {
  if (!heroes) {
    return undefined
  }
  return side === 'atk' ? heroes.atk : heroes.def
}

export function isSiegeBattle(battle: CombatBattle | null | undefined): boolean {
  return Boolean(battle?.siegeGate)
}

/** +heroStat × mult % physical damage during siege battles. */
export function siegePhysBonusPct(
  catalog: ReferenceCatalog,
  striker: CombatStack,
  heroes: CombatHeroes | undefined,
  battle: CombatBattle | null | undefined,
): number {
  if (!isSiegeBattle(battle)) {
    return 0
  }
  const unit = unitById(catalog, striker.unitId)
  const cfg = unitAttackShape(unit).siegeBonusPhys
  if (!cfg) {
    return 0
  }
  const hero = heroForSide(striker.side, heroes)
  const stat = hero
    ? heroStatValueByStatId(
        catalog,
        commandingHeroStats(catalog, hero),
        cfg.heroStatId,
      )
    : dummyHeroStat(catalog)
  if (!Number.isFinite(stat) || stat <= 0 || cfg.mult <= 0) {
    return 0
  }
  return stat * cfg.mult
}

export function siegePhysBonusPctForHero(
  catalog: ReferenceCatalog,
  unitId: number,
  hero: Hero | null | undefined,
  battle: CombatBattle | null | undefined,
): number {
  if (!isSiegeBattle(battle)) {
    return 0
  }
  const unit = unitById(catalog, unitId)
  const cfg = unitAttackShape(unit).siegeBonusPhys
  if (!cfg) {
    return 0
  }
  const stat = hero
    ? heroStatValueByStatId(
        catalog,
        commandingHeroStats(catalog, hero),
        cfg.heroStatId,
      )
    : dummyHeroStat(catalog)
  if (!Number.isFinite(stat) || stat <= 0 || cfg.mult <= 0) {
    return 0
  }
  return stat * cfg.mult
}
