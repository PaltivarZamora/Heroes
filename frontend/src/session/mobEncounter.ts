import { slotsArmyValue } from '../ai/armyAlloc'
import { appendAiTrace } from '../ai/trace'
import { mobSurrenderRatio, mobSurrenderVsFleePct } from '../ai/weights'
import type { ReferenceCatalog } from '../town/catalog'
import {
  absorbPartsIntoHeroOrGarrison,
  canFullyAbsorbParts,
  findTownAt,
  type ArmyAbsorbPart,
} from './accessors'
import { removeWorldMob } from './mobs'
import type { GameSession, Hero, Mob, UnitStack } from './types'
import { awardScaledKillXp } from './xp'

export type MobPreBattleKind = 'fight' | 'surrender' | 'flee'

export type MobPreBattleResult = {
  kind: MobPreBattleKind
  session: GameSession
  ratio: number
  xpAwarded: number
  xpLines: string[]
}

function livingInSlots(
  session: GameSession,
  slots: Array<string | null>,
): UnitStack[] {
  const out: UnitStack[] = []
  for (const id of slots) {
    if (!id) {
      continue
    }
    const row = session.units.find((unit) => unit.id === id)
    if (row && row.qty > 0) {
      out.push(row)
    }
  }
  return out
}

function consolidatedParts(session: GameSession, mob: Mob): ArmyAbsorbPart[] {
  const byType = new Map<number, number>()
  for (const stack of livingInSlots(session, mob.slots_1_to_6)) {
    byType.set(stack.unit_id, (byType.get(stack.unit_id) ?? 0) + stack.qty)
  }
  return [...byType.entries()].map(([unitId, qty]) => ({ unitId, qty }))
}

function absorbTownId(session: GameSession, hero: Hero): string | null {
  const town = findTownAt(session, hero.position.q, hero.position.r)
  if (!town || town.player_id !== hero.player_id) {
    return null
  }
  return town.id
}

/**
 * Flee awards XP as if the whole mob army were killed (same health ×
 * xp_hp_mult × qty term), then scaled by the same difficulty ratio.
 */
export function awardFleeXp(
  session: GameSession,
  catalog: ReferenceCatalog,
  hero: Hero,
  mob: Mob,
  enemyValue: number,
  ownValue: number,
) {
  const kills = livingInSlots(session, mob.slots_1_to_6).map((stack) => ({
    unitId: stack.unit_id,
    killed: stack.qty,
  }))
  return awardScaledKillXp(
    session,
    catalog,
    hero.id,
    kills,
    enemyValue,
    ownValue,
    'flee',
  )
}

/**
 * Pre-battle gate only. Once combat starts, mobs still fight Aggressive.
 */
export function resolveMobPreBattle(
  session: GameSession,
  catalog: ReferenceCatalog,
  hero: Hero,
  mob: Mob,
  random: () => number = Math.random,
): MobPreBattleResult {
  const attackerValue = slotsArmyValue(session, catalog, hero.army.slots_1_to_6)
  const mobValue = slotsArmyValue(session, catalog, mob.slots_1_to_6)
  const ratio = attackerValue > 0 ? mobValue / attackerValue : Number.POSITIVE_INFINITY
  const threshold = mobSurrenderRatio(catalog)
  const fleePct = 100 - mobSurrenderVsFleePct(catalog)
  const header = [
    `mob_encounter — ${hero.name} vs ${mob.id} ratio=${Number.isFinite(ratio) ? ratio.toFixed(2) : 'inf'} threshold=${threshold}`,
  ]

  if (!(ratio < threshold)) {
    appendAiTrace([...header, '  fight'].join('\n'))
    return { kind: 'fight', session, ratio, xpAwarded: 0, xpLines: [] }
  }

  const parts = consolidatedParts(session, mob)
  const townId = absorbTownId(session, hero)
  const wantSurrender = random() * 100 >= fleePct
  const canAbsorb = canFullyAbsorbParts(session, hero.id, parts, townId)
  if (wantSurrender && canAbsorb) {
    let next = absorbPartsIntoHeroOrGarrison(session, hero.id, parts, townId)
    next = removeWorldMob(next, mob)
    appendAiTrace([...header, '  surrender (absorbed)'].join('\n'))
    return { kind: 'surrender', session: next, ratio, xpAwarded: 0, xpLines: [] }
  }

  const xp = awardFleeXp(session, catalog, hero, mob, mobValue, attackerValue)
  const next = removeWorldMob(xp.session, mob)
  appendAiTrace(
    [
      ...header,
      wantSurrender && !canAbsorb
        ? '  flee (no room to absorb)'
        : '  flee',
    ].join('\n'),
  )
  return { kind: 'flee', session: next, ratio, xpAwarded: xp.awarded, xpLines: xp.lines }
}
