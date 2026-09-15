import { slotsArmyValue } from '../ai/armyAlloc'
import { appendAiTrace } from '../ai/trace'
import {
  mobFleeFightAnywayPct,
  mobSurrenderRatio,
  mobSurrenderVsFleePct,
} from '../ai/weights'
import { unitById, type ReferenceCatalog } from '../town/catalog'
import {
  absorbPartsIntoHeroOrGarrison,
  canFullyAbsorbParts,
  findTownAt,
  type ArmyAbsorbPart,
} from './accessors'
import { removeWorldMob } from './mobs'
import type { GameSession, Hero, Mob, UnitStack } from './types'
import { awardScaledKillXp, levelUpNoticeForAward, type LevelUpNotice } from './xp'

export type MobPreBattleKind =
  | 'fight'
  | 'surrender'
  | 'flee'
  | 'surrender_offer'
  | 'flee_offer'

export type MobPreBattleResult = {
  kind: MobPreBattleKind
  session: GameSession
  ratio: number
  xpAwarded: number
  xpLines: string[]
  /** Present when kind is `surrender_offer` — units that would join on Yes. */
  offerParts?: ArmyAbsorbPart[]
  /** Human hero leveled from flee XP. */
  levelUpNotice?: LevelUpNotice | null
}

export type MobPreBattleOptions = {
  /**
   * AI auto-accepts. Humans pass false to get `surrender_offer` instead of
   * silently absorbing.
   */
  autoAcceptSurrender?: boolean
  /**
   * AI rolls `fight_anyway_pct`. Humans pass false to get `flee_offer`
   * instead of silently fleeing.
   */
  autoResolveFlee?: boolean
  random?: () => number
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

/** Prompt line: "Do you want 5 Skeletons to join your army?" */
export function surrenderOfferPrompt(
  catalog: ReferenceCatalog,
  parts: ArmyAbsorbPart[],
): string {
  if (parts.length === 0) {
    return 'Do you want these units to join your army?'
  }
  const chunks = parts.map((part) => {
    const name = unitById(catalog, part.unitId)?.name ?? 'Units'
    return `${part.qty} ${name}`
  })
  if (chunks.length === 1) {
    return `Do you want ${chunks[0]} to join your army?`
  }
  if (chunks.length === 2) {
    return `Do you want ${chunks[0]} and ${chunks[1]} to join your army?`
  }
  const last = chunks[chunks.length - 1]
  return `Do you want ${chunks.slice(0, -1).join(', ')}, and ${last} to join your army?`
}

export function fleeOfferPrompt(): string {
  return 'The Mob is fleeing!'
}

function applySurrender(
  session: GameSession,
  hero: Hero,
  mob: Mob,
  parts: ArmyAbsorbPart[],
): GameSession {
  const townId = absorbTownId(session, hero)
  let next = absorbPartsIntoHeroOrGarrison(session, hero.id, parts, townId)
  next = removeWorldMob(next, mob)
  return next
}

function applyFlee(
  session: GameSession,
  catalog: ReferenceCatalog,
  hero: Hero,
  mob: Mob,
  mobValue: number,
  attackerValue: number,
): Pick<MobPreBattleResult, 'session' | 'xpAwarded' | 'xpLines' | 'levelUpNotice'> {
  const xp = awardFleeXp(session, catalog, hero, mob, mobValue, attackerValue)
  return {
    session: removeWorldMob(xp.session, mob),
    xpAwarded: xp.awarded,
    xpLines: xp.lines,
    levelUpNotice: levelUpNoticeForAward(catalog, xp),
  }
}

/** Human chose Yes on a surrender offer. */
export function acceptMobSurrender(
  session: GameSession,
  hero: Hero,
  mob: Mob,
  parts: ArmyAbsorbPart[],
): MobPreBattleResult {
  const next = applySurrender(session, hero, mob, parts)
  appendAiTrace(`mob_encounter — ${hero.name} vs ${mob.id} surrender (accepted)`)
  return {
    kind: 'surrender',
    session: next,
    ratio: 0,
    xpAwarded: 0,
    xpLines: [],
  }
}

/** Human chose No — same outcome as Flee (XP, no army). */
export function declineMobSurrender(
  session: GameSession,
  catalog: ReferenceCatalog,
  hero: Hero,
  mob: Mob,
): MobPreBattleResult {
  const attackerValue = slotsArmyValue(session, catalog, hero.army.slots_1_to_6)
  const mobValue = slotsArmyValue(session, catalog, mob.slots_1_to_6)
  const fled = applyFlee(session, catalog, hero, mob, mobValue, attackerValue)
  appendAiTrace(`mob_encounter — ${hero.name} vs ${mob.id} surrender (declined → flee)`)
  return {
    kind: 'flee',
    session: fled.session,
    ratio: attackerValue > 0 ? mobValue / attackerValue : Number.POSITIVE_INFINITY,
    xpAwarded: fled.xpAwarded,
    xpLines: fled.xpLines,
    levelUpNotice: fled.levelUpNotice,
  }
}

/** Human chose Let Them Flee. */
export function letMobFlee(
  session: GameSession,
  catalog: ReferenceCatalog,
  hero: Hero,
  mob: Mob,
): MobPreBattleResult {
  const attackerValue = slotsArmyValue(session, catalog, hero.army.slots_1_to_6)
  const mobValue = slotsArmyValue(session, catalog, mob.slots_1_to_6)
  const fled = applyFlee(session, catalog, hero, mob, mobValue, attackerValue)
  appendAiTrace(`mob_encounter — ${hero.name} vs ${mob.id} flee (let them flee)`)
  return {
    kind: 'flee',
    session: fled.session,
    ratio: attackerValue > 0 ? mobValue / attackerValue : Number.POSITIVE_INFINITY,
    xpAwarded: fled.xpAwarded,
    xpLines: fled.xpLines,
    levelUpNotice: fled.levelUpNotice,
  }
}

/**
 * Pre-battle gate only. Once combat starts, mobs still fight Aggressive.
 * Pass `autoAcceptSurrender: false` / `autoResolveFlee: false` for humans.
 */
export function resolveMobPreBattle(
  session: GameSession,
  catalog: ReferenceCatalog,
  hero: Hero,
  mob: Mob,
  options: MobPreBattleOptions = {},
): MobPreBattleResult {
  const random = options.random ?? Math.random
  const autoAcceptSurrender = options.autoAcceptSurrender !== false
  const autoResolveFlee = options.autoResolveFlee !== false
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
    if (!autoAcceptSurrender) {
      appendAiTrace([...header, '  surrender_offer (awaiting human)'].join('\n'))
      return {
        kind: 'surrender_offer',
        session,
        ratio,
        xpAwarded: 0,
        xpLines: [],
        offerParts: parts,
      }
    }
    const next = applySurrender(session, hero, mob, parts)
    appendAiTrace([...header, '  surrender (absorbed)'].join('\n'))
    return { kind: 'surrender', session: next, ratio, xpAwarded: 0, xpLines: [] }
  }

  const fleeReason =
    wantSurrender && !canAbsorb ? 'flee (no room to absorb)' : 'flee'

  if (!autoResolveFlee) {
    appendAiTrace([...header, `  ${fleeReason}_offer (awaiting human)`].join('\n'))
    return {
      kind: 'flee_offer',
      session,
      ratio,
      xpAwarded: 0,
      xpLines: [],
    }
  }

  const player = session.players.find((row) => row.id === hero.player_id)
  const fightPct = player
    ? mobFleeFightAnywayPct(player, hero, catalog)
    : 40
  const fightRoll = random() * 100
  if (fightRoll < fightPct) {
    appendAiTrace(
      [
        ...header,
        `  ${fleeReason} → fight_anyway (roll=${fightRoll.toFixed(1)} < ${fightPct.toFixed(1)})`,
      ].join('\n'),
    )
    return { kind: 'fight', session, ratio, xpAwarded: 0, xpLines: [] }
  }

  const fled = applyFlee(session, catalog, hero, mob, mobValue, attackerValue)
  appendAiTrace(
    [
      ...header,
      `  ${fleeReason} → let_flee (roll=${fightRoll.toFixed(1)} >= ${fightPct.toFixed(1)})`,
    ].join('\n'),
  )
  return {
    kind: 'flee',
    session: fled.session,
    ratio,
    xpAwarded: fled.xpAwarded,
    xpLines: fled.xpLines,
    levelUpNotice: fled.levelUpNotice,
  }
}
