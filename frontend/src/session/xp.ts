import { unitArmyValue } from '../ai/armyAlloc'
import { appendAiTrace } from '../ai/trace'
import { xpHpMult } from '../ai/weights'
import {
  HERO_STAT_KEYS,
  xpToReachLevel,
  unitById,
  type HeroStatKey,
  type ReferenceCatalog,
} from '../town/catalog'
import { setNamedProgress } from './accessors'
import { slotFromPlayerId, type GameSession } from './types'

export type XpKillPart = {
  unitId: number
  killed: number
}

export type XpValuePart = {
  unitId: number
  qty: number
}

export type AwardHeroXpResult = {
  session: GameSession
  awarded: number
  fromLevel: number
  toLevel: number
  xpBefore: number
  xpAfter: number
  levelsGained: number[]
  lines: string[]
}

const STAT_BUMP_LABEL: Record<HeroStatKey, string> = {
  speed: 'Speed',
  stamina: 'Stamina',
  strength: 'STR',
  intel: 'INT',
  defense: 'Defense',
  resist: 'Resist',
  crit_pct: 'Crit Chance',
  crit_amt: 'Crit Amount',
}

function emptyAward(session: GameSession): AwardHeroXpResult {
  return {
    session,
    awarded: 0,
    fromLevel: 1,
    toLevel: 1,
    xpBefore: 0,
    xpAfter: 0,
    levelsGained: [],
    lines: [],
  }
}

function formatBumpAmount(amount: number): string {
  if (amount > 0) {
    return `+${amount}`
  }
  return `${amount}`
}

function formatBumpsForLevel(
  catalog: ReferenceCatalog,
  classId: number | null,
  levelId: number,
): string | null {
  if (classId == null) {
    return null
  }
  const row = catalog.hero_levels.find(
    (entry) => entry.hero_type_id === classId && entry.level_id === levelId,
  )
  if (!row) {
    return null
  }
  const parts: string[] = []
  for (const key of HERO_STAT_KEYS) {
    const bump = row.stat_bumps[key]
    if (typeof bump !== 'number' || !Number.isFinite(bump) || bump === 0) {
      continue
    }
    parts.push(`${formatBumpAmount(bump)} ${STAT_BUMP_LABEL[key]}`)
  }
  if (parts.length === 0) {
    return null
  }
  return `Level ${levelId}: ${parts.join(', ')}`
}

/** "Leveled up to Level 2, 3, and 4" — every crossed threshold named. */
export function formatLeveledUpLine(levels: number[]): string | null {
  if (levels.length === 0) {
    return null
  }
  if (levels.length === 1) {
    return `Leveled up to Level ${levels[0]}`
  }
  if (levels.length === 2) {
    return `Leveled up to Level ${levels[0]} and ${levels[1]}`
  }
  const head = levels.slice(0, -1).join(', ')
  return `Leveled up to Level ${head}, and ${levels[levels.length - 1]}`
}

export function formatXpAwardLines(report: {
  player: number
  fromLevel: number
  xpBefore: number
  xpGained: number
  xpAfter: number
  levelsGained: number[]
  bumpLines: string[]
}): string[] {
  const lines = [
    `Player ${report.player} — Level ${report.fromLevel} with ${report.xpBefore} XP, +${report.xpGained} XP = ${report.xpAfter} XP`,
  ]
  const leveled = formatLeveledUpLine(report.levelsGained)
  if (leveled) {
    lines.push(leveled)
  }
  lines.push(...report.bumpLines)
  return lines
}

/** Same `qty × avg dmg × health` total used by ability/surrender ratio. */
export function partsArmyValue(
  catalog: ReferenceCatalog,
  parts: XpValuePart[],
): number {
  let total = 0
  for (const part of parts) {
    if (part.qty <= 0) {
      continue
    }
    total += unitArmyValue(catalog, part.unitId, part.qty)
  }
  return total
}

/** `sum(health × xp_hp_mult × units_killed)` across stacks. */
export function xpFromKills(
  catalog: ReferenceCatalog,
  kills: XpKillPart[],
): number {
  const mult = xpHpMult(catalog)
  let total = 0
  for (const part of kills) {
    if (part.killed <= 0) {
      continue
    }
    const unit = unitById(catalog, part.unitId)
    if (!unit) {
      continue
    }
    total += unit.health * mult * part.killed
  }
  return total
}

/**
 * `enemy_army_value / own_army_value` — inverse of the ability remaining-rounds
 * ratio, same underlying army-value formula.
 */
export function difficultyRatio(enemyValue: number, ownValue: number): number {
  if (!(ownValue > 0)) {
    return 1
  }
  return enemyValue / ownValue
}

export function scaledXp(
  killsXp: number,
  enemyValue: number,
  ownValue: number,
): number {
  const ratio = difficultyRatio(enemyValue, ownValue)
  if (!Number.isFinite(killsXp) || !Number.isFinite(ratio)) {
    return 0
  }
  return Math.max(0, Math.floor(killsXp * ratio))
}

export function awardHeroXp(
  session: GameSession,
  catalog: ReferenceCatalog,
  heroId: string,
  amount: number,
): AwardHeroXpResult {
  const hero = session.heroes.find((row) => row.id === heroId)
  const awarded = Math.max(0, Math.floor(amount))
  if (!hero) {
    return emptyAward(session)
  }
  const fromLevel = hero.current_level
  const xpBefore = hero.current_xp
  let xp = xpBefore + awarded
  let level = fromLevel
  const maxLevel = catalog.levels.reduce(
    (max, row) => (row.id > max ? row.id : max),
    fromLevel,
  )
  const levelsGained: number[] = []
  while (level < maxLevel) {
    const need = xpToReachLevel(catalog, level + 1)
    if (need == null || xp < need) {
      break
    }
    level += 1
    levelsGained.push(level)
  }
  const bumpLines: string[] = []
  for (const gained of levelsGained) {
    const line = formatBumpsForLevel(catalog, hero.class_id, gained)
    if (line) {
      bumpLines.push(line)
    }
  }
  const player = slotFromPlayerId(hero.player_id) ?? 1
  const lines = formatXpAwardLines({
    player,
    fromLevel,
    xpBefore,
    xpGained: awarded,
    xpAfter: xp,
    levelsGained,
    bumpLines,
  })
  const heroes = session.heroes.map((row) =>
    row.id === heroId
      ? { ...row, current_xp: xp, current_level: level }
      : row,
  )
  const next = setNamedProgress(
    { ...session, heroes },
    hero.name,
    { current_level: level, current_xp: xp },
  )
  return {
    session: next,
    awarded,
    fromLevel,
    toLevel: level,
    xpBefore,
    xpAfter: xp,
    levelsGained,
    lines,
  }
}

export function awardScaledKillXp(
  session: GameSession,
  catalog: ReferenceCatalog,
  heroId: string,
  kills: XpKillPart[],
  enemyValue: number,
  ownValue: number,
  source: string,
): AwardHeroXpResult {
  const killsXp = xpFromKills(catalog, kills)
  const ratio = difficultyRatio(enemyValue, ownValue)
  const awarded = scaledXp(killsXp, enemyValue, ownValue)
  const result = awardHeroXp(session, catalog, heroId, awarded)
  const hero = result.session.heroes.find((row) => row.id === heroId)
  const name = hero?.name ?? heroId
  const ratioText = Number.isFinite(ratio) ? ratio.toFixed(2) : 'inf'
  const levelBit =
    result.levelsGained.length > 0
      ? ` L${result.fromLevel}→${result.toLevel}`
      : ` L${result.toLevel}`
  appendAiTrace(
    `xp — ${name} +${result.awarded} (${source}) kills=${killsXp.toFixed(1)} ratio=${ratioText} own=${ownValue.toFixed(0)} enemy=${enemyValue.toFixed(0)}${levelBit}`,
  )
  return result
}
