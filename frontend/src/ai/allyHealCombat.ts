import type { Hero } from '../session/types'
import {
  aiCfgRaw,
  type ReferenceCatalog,
  unitAttackShape,
  unitById,
} from '../town/catalog'
import {
  applyAllyStackRepair,
  healAmtForAllyRepair,
  isHealAllyTarget,
} from '../combat/factory'
import { combatHover, type CombatHover } from '../combat/target'
import { stackMaxHealth } from '../combat/battle'
import type { CombatBattle, CombatStack, CombatTile } from '../combat/battle'
import type { CombatHeroes } from '../combat/attack'

let warnedMissingHealMinUsePct = false

function healMinUsePct(catalog: ReferenceCatalog): number | null {
  const raw = aiCfgRaw(catalog, 'heal_min_use_pct')
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) {
    return null
  }
  return Math.max(0, Math.min(100, n))
}

/** One Combat log line when ally-heal AI is disabled (no console). */
export function allyHealMissingConfigLogLine(
  catalog: ReferenceCatalog,
  stack: CombatStack,
): string | null {
  const spec = unitAttackShape(unitById(catalog, stack.unitId))
  if (!spec.healOnAllyTarget) {
    return null
  }
  if (healMinUsePct(catalog) != null) {
    return null
  }
  if (warnedMissingHealMinUsePct) {
    return null
  }
  warnedMissingHealMinUsePct = true
  return (
    '[ai_config] heal_min_use_pct is missing — ally repair AI disabled until ' +
    'Rod adds it.'
  )
}

function landedHealAmount(
  target: CombatStack,
  pool: number,
  catalog: ReferenceCatalog,
  revive: boolean,
): number {
  if (pool <= 0 || target.qty <= 0) {
    return 0
  }
  const full = stackMaxHealth(target, catalog)
  const result = applyAllyStackRepair(target, pool, full, revive)
  if (result.revived > 0) {
    return result.healed + result.revived * full
  }
  return result.healed
}

export function pickAllyHealCombatIntent(
  stack: CombatStack,
  battle: CombatBattle,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
  heroes: CombatHeroes,
  hero: Hero | null | undefined,
): CombatHover | null {
  const spec = unitAttackShape(unitById(catalog, stack.unitId))
  if (!spec.healOnAllyTarget) {
    return null
  }
  const minPct = healMinUsePct(catalog)
  if (minPct == null) {
    return null
  }
  const pool = healAmtForAllyRepair(stack, catalog, hero)
  if (pool <= 0) {
    return null
  }
  const threshold = (pool * minPct) / 100
  let best: { ally: CombatStack; landed: number } | null = null
  for (const row of battle.stacks) {
    if (!isHealAllyTarget(stack, row, catalog)) {
      continue
    }
    const landed = landedHealAmount(row, pool, catalog, spec.healRevive === true)
    if (landed < threshold) {
      continue
    }
    if (!best || landed > best.landed) {
      best = { ally: row, landed }
    }
  }
  if (!best) {
    return null
  }
  const intent = combatHover(
    stack,
    { q: best.ally.q, r: best.ally.r },
    battle,
    tiles,
    catalog,
    'center',
    heroes,
  )
  if (!intent?.fire || !intent.attackTargetId) {
    return null
  }
  return intent
}
