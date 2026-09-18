import type { AbilityRow, ReferenceCatalog } from '../town/catalog'
import { heroEffectiveStats } from '../town/catalog'
import type { Hero } from '../session/types'
import { BLIND_MISS_PCT } from './condition'
import {
  asFinite,
  barrageSecondAttackPct,
  barrierLineLength,
  bloodLustDmgPct,
  chargeSpeedBuff,
  durationTooltipClause,
  explosiveTrapChancePct,
  explosiveTrapFlatDmg,
  formatStatBonus,
  fervorChainChancePct,
  floorResourceDiv,
  giftOfGaiaClearPct,
  hitCountFromStatDiv,
  intDmgAmount,
  lastStandMinQty,
  massSlowSpeedCut,
  mirrorImageTopHealth,
  multiBoltCount,
  mutationStatDelta,
  polymorphBreakChancePct,
  pushBackDistance,
  raiseFromKillsPct,
  resistibleTooltipClause,
  resourceStat,
  sapStrengthPct,
  scaledResourceStat,
  seedsOfShadowCount,
  slowSpeedPct,
  smokeBombEvasionPct,
  summonQtyFromStatDiv,
  summonQtyResolved,
  usesFromStats,
  wildSurgeRollBounds,
} from './abilityStatMath'

export type AbilityTooltipHero = Pick<Hero, 'class_id' | 'current_level'>

export type AbilityBracketContext = {
  hero?: AbilityTooltipHero | null
  /** Required for Polymorph [pct] — combat uses the target's Resistance. */
  targetResistance?: number | null
  /** Mirror Image [hp] unit-max cap — omit to show INT×stat only. */
  targetMaxHp?: number | null
}

function heroPool(
  catalog: ReferenceCatalog,
  hero: AbilityTooltipHero,
): { strength: number; intel: number; speed: number } {
  const stats = heroEffectiveStats(
    catalog,
    hero.class_id,
    hero.current_level,
  )
  return { strength: stats.strength, intel: stats.intel, speed: stats.speed }
}

function abilityResource(
  catalog: ReferenceCatalog,
  hero: AbilityTooltipHero,
  ability: AbilityRow,
): number {
  const pool = heroPool(catalog, hero)
  return resourceStat(pool.strength, pool.intel, ability.resource_id)
}

/** Clause inserted for `[persists]` when `persists_on_summon` is true. */
export const PERSISTS_CLAUSE = ', can persist after battle'

/** Live `unit_tag.value` for `[eligible]` from `target_tag_required`. */
export function eligibleTagLabel(
  catalog: ReferenceCatalog,
  stats: Record<string, unknown>,
): string | undefined {
  const tagId = asFinite(stats.target_tag_required)
  if (tagId == null || tagId <= 0) {
    // No required-tag key — erase token (Rod omits bracket when unused).
    return ''
  }
  const row = catalog.unit_tag.find((entry) => entry.id === Math.floor(tagId))
  const label = typeof row?.value === 'string' ? row.value.trim() : ''
  // Missing catalog row: leave bracket unsubstituted so the gap is visible.
  return label.length > 0 ? label : undefined
}

/**
 * Live `unit_tag.value` list for `[tags]` from `bonus_dmg_tag` (array or single id).
 * Joined with ", " — e.g. "Undead, Demon". Same catalog lookup as [eligible].
 */
export function bonusDmgTagLabels(
  catalog: ReferenceCatalog,
  stats: Record<string, unknown>,
): string | undefined {
  const raw = stats.bonus_dmg_tag
  const ids: number[] = []
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const n = asFinite(entry)
      if (n != null && n > 0) {
        ids.push(Math.floor(n))
      }
    }
  } else {
    const single = asFinite(raw)
    if (single != null && single > 0) {
      ids.push(Math.floor(single))
    }
  }
  if (ids.length === 0) {
    // No bonus-tag key — erase token (Rod omits bracket when unused).
    return ''
  }
  const labels: string[] = []
  for (const id of ids) {
    const row = catalog.unit_tag.find((entry) => entry.id === id)
    const label = typeof row?.value === 'string' ? row.value.trim() : ''
    if (label.length === 0) {
      // Incomplete catalog: leave unsubstituted.
      return undefined
    }
    labels.push(label)
  }
  return labels.join(', ')
}

/**
 * BR S7-12: explicit ability-id → bracket token values.
 * Values reuse combat formulas via abilityStatMath — never inferred from key names.
 *
 * Conditional / lookup clause tokens (addenda): not combat-number swaps.
 * - `[persists]`: `persists_on_summon` → clause or erase
 * - `[duration]`: flat / stat-div rounds, explicit null → battle, absent → erase
 * - `[eligible]`: live `unit_tag.value` for `target_tag_required` (e.g. Living)
 * - `[tags]`: live `unit_tag.value` list for `bonus_dmg_tag` (e.g. "Undead, Demon")
 * - `[resistible]`: non-empty `resist_stat` → "resistible", else erase
 * Rod: omit these brackets from copy when the ability does not need them.
 *
 * Transitional aliases keep live DB copy working until Rod renames tokens
 * ([count]→[qty], [chance]→[pct], [amount]→[qty]/[amt], [counter]→[qty]).
 */
export function abilityBracketValues(
  catalog: ReferenceCatalog | null | undefined,
  ability: AbilityRow,
  ctx: AbilityBracketContext = {},
): Record<string, string> {
  const out: Record<string, string> = {}
  const stats = (ability.stats ?? {}) as Record<string, unknown>
  const hero = ctx.hero ?? null

  // Boolean-gated clause — empty string removes the bracket (not left literal).
  out.persists =
    stats.persists_on_summon === true ? PERSISTS_CLAUSE : ''

  out.resistible = resistibleTooltipClause(stats)

  const resourceForDuration =
    catalog && hero ? abilityResource(catalog, hero, ability) : null
  const durationClause = durationTooltipClause(stats, resourceForDuration)
  if (durationClause !== undefined) {
    out.duration = durationClause
  }

  if (catalog) {
    const eligible = eligibleTagLabel(catalog, stats)
    if (eligible !== undefined) {
      out.eligible = eligible
    }
  } else if (asFinite(stats.target_tag_required) == null) {
    out.eligible = ''
  }

  if (!catalog) {
    return out
  }

  const put = (token: string, value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) {
      return
    }
    out[token] = formatStatBonus(value)
  }

  /** Write primary + transitional aliases with the same numeric value. */
  const putAliased = (
    value: number | null | undefined,
    primary: string,
    ...aliases: string[]
  ) => {
    if (value == null || !Number.isFinite(value)) {
      return
    }
    const formatted = formatStatBonus(value)
    out[primary] = formatted
    for (const alias of aliases) {
      out[alias] = formatted
    }
  }

  switch (ability.id) {
    // ── Environment ────────────────────────────────────────────────
    case 1: // Seeds of Shadow — [qty]
      if (hero) {
        put('qty', seedsOfShadowCount(heroPool(catalog, hero).intel, stats))
      }
      break
    case 12: // Gift of Gaia — [pct]
      if (hero) {
        putAliased(
          giftOfGaiaClearPct(heroPool(catalog, hero).intel, stats),
          'pct',
          'chance',
        )
      }
      break
    case 21: // Sanctify Grounds — no numeric brackets
    case 53: // Forced Retreat — hardcoded, no tunables
    case 65: // Steady Aim — flag only
    case 72: // Overcharge — stack max_dmg, not ability-level number
    case 84: // Execute — grants_kill_on_overflow only
      break
    case 51: // Expose — [duration] only (sticky null)
      break
    case 60: // Smoke Bomb — [pct]
      if (hero) {
        putAliased(
          smokeBombEvasionPct(heroPool(catalog, hero).strength, stats),
          'pct',
          'chance',
        )
      }
      break
    case 61: {
      // Explosive Trap — [amt] flat dmg, [pct] stun chance
      if (hero) {
        const strength = heroPool(catalog, hero).strength
        put('amt', explosiveTrapFlatDmg(strength, stats))
        putAliased(explosiveTrapChancePct(strength, stats), 'pct', 'chance')
      }
      break
    }

    // ── Summon ─────────────────────────────────────────────────────
    case 6: // Raise Skeleton
    case 82: // Recruit the Dead — [pct], [persists]
      if (hero) {
        putAliased(
          raiseFromKillsPct(abilityResource(catalog, hero, ability), stats),
          'pct',
          'chance',
        )
      }
      break
    case 8: // Summon Bound Spirit — [qty], [persists]
      if (hero) {
        const pool = heroPool(catalog, hero)
        putAliased(
          summonQtyResolved(
            abilityResource(catalog, hero, ability),
            pool.intel,
            stats,
          ),
          'qty',
          'count',
        )
      }
      break
    case 13: // Summon Mud Golem
    case 29: // Illusions
    case 30: // Animate Weapon
    case 68: // Call Beast — [qty] (+ persists where keyed)
      if (hero) {
        putAliased(
          summonQtyFromStatDiv(
            abilityResource(catalog, hero, ability),
            stats,
          ),
          'qty',
          'count',
        )
      }
      break
    case 31: // Mirror Image — [hp]
      if (hero) {
        put(
          'hp',
          mirrorImageTopHealth(
            heroPool(catalog, hero).intel,
            stats,
            ctx.targetMaxHp,
          ),
        )
      }
      break
    case 37: // Unstable Rift — [qty] flat summon_count
      putAliased(asFinite(stats.summon_count), 'qty', 'count')
      break

    // ── Debuff ─────────────────────────────────────────────────────
    case 2: // Curse — [duration] only
    case 91: // Disarm — [duration] only
      break
    case 3: // Sap Strength — [amt], [duration]
      if (hero) {
        put('amt', sapStrengthPct(abilityResource(catalog, hero, ability), stats))
      }
      break
    case 27: // Mass Silence — [pct], [resistible], [duration]
      putAliased(asFinite(stats.chance_pct), 'pct', 'chance')
      break
    case 36: {
      // Polymorph — [eligible], [pct], [resistible], [duration]
      if (ctx.targetResistance != null) {
        putAliased(
          polymorphBreakChancePct(ctx.targetResistance, stats),
          'pct',
          'chance',
        )
      }
      break
    }
    case 40: // Mass Slow — [amt], [duration]
      if (hero) {
        put(
          'amt',
          massSlowSpeedCut(abilityResource(catalog, hero, ability), stats),
        )
      }
      break
    case 59: // Confuse — [resistible], [duration]
    case 95: // Fear — [resistible], [duration]
      break
    case 67: // Mark Target — [qty]
      if (hero) {
        putAliased(
          hitCountFromStatDiv(abilityResource(catalog, hero, ability), stats),
          'qty',
          'count',
        )
      }
      break
    case 78: // Push Back — [distance]
      if (hero) {
        put(
          'distance',
          pushBackDistance(abilityResource(catalog, hero, ability), stats),
        )
      }
      break
    case 89: // Rend — [amt]=set_defense, [duration]
      put('amt', asFinite(stats.set_defense))
      break
    case 90: // Slow — [amt] pct of live speed, [duration]
      if (hero) {
        put(
          'amt',
          slowSpeedPct(abilityResource(catalog, hero, ability), stats),
        )
      }
      break
    case 93: // Blind — [pct]=condition miss default, [duration]
      putAliased(BLIND_MISS_PCT, 'pct', 'chance')
      break

    // ── Buff ───────────────────────────────────────────────────────
    case 11: // Stoneskin — [amt] Res bonus, [duration]
      if (hero) {
        put(
          'amt',
          floorResourceDiv(
            abilityResource(catalog, hero, ability),
            stats,
            'res_bonus_stat_div',
          ),
        )
      }
      break
    case 18: {
      // Bless — [chance], [amount] DISTINCT; [duration] sticky
      if (hero) {
        const base = scaledResourceStat(
          abilityResource(catalog, hero, ability),
          stats,
        )
        const pctStat = asFinite(stats.crit_pct_flat_stat)
        const amtStat = asFinite(stats.crit_amt_flat_stat)
        if (pctStat != null) {
          put('chance', base * pctStat)
        }
        if (amtStat != null) {
          put('amount', base * amtStat)
        }
      }
      break
    }
    case 23: // Guardian Angel — [uses]
      put('uses', asFinite(stats.uses) ?? 1)
      break
    case 28: // Hyper Focus — [qty] use-count (not rounds)
      putAliased(asFinite(stats.uses) ?? 1, 'qty', 'count', 'uses')
      break
    case 34: // Mutation — [amt], [duration]
      if (hero) {
        put('amt', mutationStatDelta(heroPool(catalog, hero).intel, stats))
      }
      break
    case 35: {
      // Wild Surge — [amt] min, [amt2] max of rolled magic %
      if (hero) {
        const bounds = wildSurgeRollBounds(
          heroPool(catalog, hero).intel,
          stats,
        )
        if (bounds) {
          put('amt', bounds.min)
          put('amt2', bounds.max)
        }
      }
      break
    }
    case 43: // Haste — [qty] speed, [duration]
    case 52: // Inspire — [qty] speed, [duration]
      if (hero) {
        putAliased(
          floorResourceDiv(
            abilityResource(catalog, hero, ability),
            stats,
            'speed_buff_stat_div',
          ),
          'qty',
          'count',
        )
      }
      break
    case 46: // Spell Reflect — [qty] uses_stat_div
    case 49: // Battle Cry — [qty] uses_stat_div
    case 64: // Preemptive Strike — [qty] uses_stat_div
      if (hero) {
        putAliased(
          usesFromStats(abilityResource(catalog, hero, ability), stats),
          'qty',
          'count',
          'uses',
        )
      }
      break
    case 50: // Charge — [qty] speed from hero Speed, [duration]
      if (hero) {
        putAliased(
          chargeSpeedBuff(heroPool(catalog, hero).speed, stats),
          'qty',
          'count',
        )
      }
      break
    case 54: // Guard — [qty] Def bonus, [duration]
      if (hero) {
        putAliased(
          floorResourceDiv(
            abilityResource(catalog, hero, ability),
            stats,
            'def_bonus_stat_div',
          ),
          'qty',
          'count',
        )
      }
      break
    case 56: // Fervor — [pct], [duration]
      if (hero) {
        putAliased(
          fervorChainChancePct(heroPool(catalog, hero).strength, stats),
          'pct',
          'chance',
        )
      }
      break
    case 58: {
      // Deflect — [pct] dmg_taken_pct, [qty] uses
      putAliased(asFinite(stats.dmg_taken_pct), 'pct', 'chance', 'amount')
      if (hero) {
        putAliased(
          usesFromStats(abilityResource(catalog, hero, ability), stats),
          'qty',
          'count',
          'uses',
        )
      }
      break
    }
    case 62: // Double Tap — [qty] uses (stat-div or flat)
      if (hero) {
        putAliased(
          usesFromStats(abilityResource(catalog, hero, ability), stats),
          'qty',
          'count',
          'uses',
        )
      }
      break
    case 63: // Vanish — [duration] only
    case 74: // Fortify — [duration] only
    case 92: // Sunder Armor — [duration] only
      break
    case 66: // Parry — [qty] uses flat
    case 87: // Furious Rush — [qty] uses flat
      putAliased(asFinite(stats.uses) ?? 1, 'qty', 'count', 'uses')
      break
    case 69: {
      // Critical Chance — [qty] crit %, [duration] sticky
      if (hero) {
        const base = scaledResourceStat(
          abilityResource(catalog, hero, ability),
          stats,
        )
        const pctStat = asFinite(stats.crit_pct_flat_stat)
        if (pctStat != null) {
          putAliased(base * pctStat, 'qty', 'amount', 'count')
        }
      }
      break
    }
    case 70: // Camouflage — [pct] evasion flat, [duration]
      putAliased(asFinite(stats.evasion_pct), 'pct', 'chance', 'amount')
      break
    case 71: {
      // Barrage — [pct] combined second-attack, [qty] uses
      if (hero) {
        const resource = abilityResource(catalog, hero, ability)
        const scaled = scaledResourceStat(resource, stats)
        putAliased(
          barrageSecondAttackPct(scaled, stats),
          'pct',
          'amount',
          'chance',
        )
        putAliased(usesFromStats(resource, stats), 'qty', 'count', 'uses')
      }
      break
    }
    case 75: // Barrier — [length]
      if (hero) {
        put(
          'length',
          barrierLineLength(abilityResource(catalog, hero, ability), stats),
        )
      }
      break
    case 76: // Last Stand — [qty] min units
      if (hero) {
        putAliased(
          lastStandMinQty(abilityResource(catalog, hero, ability), stats),
          'qty',
          'count',
        )
      }
      break
    case 77: {
      // Shield Wall — [qty] Def/Res mult (same live value), [duration]
      if (hero) {
        const resource = abilityResource(catalog, hero, ability)
        putAliased(
          floorResourceDiv(resource, stats, 'def_mult_stat_div') ??
            floorResourceDiv(resource, stats, 'res_mult_stat_div'),
          'qty',
          'count',
        )
      }
      break
    }
    case 80: // Immunity — [qty]
      if (hero) {
        putAliased(
          hitCountFromStatDiv(abilityResource(catalog, hero, ability), stats),
          'qty',
          'count',
        )
      }
      break
    case 81: // Intimidate — [qty]; alias [counter] for live DB copy
      if (hero) {
        putAliased(
          hitCountFromStatDiv(abilityResource(catalog, hero, ability), stats),
          'qty',
          'count',
          'counter',
        )
      }
      break
    case 83: {
      // Berserk — [qty] dmg mult, [amt] Def=0, [amt2] Res=0, [duration]
      const maxMult = asFinite(stats.max_dmg_mult)
      const minMult = asFinite(stats.min_dmg_mult)
      putAliased(maxMult ?? minMult, 'qty', 'count')
      put('amt', asFinite(stats.set_defense))
      put('amt2', asFinite(stats.set_resistance))
      break
    }
    case 85: {
      // Adrenaline Rush — [qty] speed, [qty2] uses — DISTINCT
      if (hero) {
        const resource = abilityResource(catalog, hero, ability)
        putAliased(
          floorResourceDiv(resource, stats, 'speed_buff_stat_div'),
          'qty',
          'count',
        )
        put('qty2', usesFromStats(resource, stats) ?? asFinite(stats.uses) ?? 1)
      }
      break
    }
    case 86: {
      // Critical Attacks — [qty] crit amount, [duration] sticky
      if (hero) {
        const base = scaledResourceStat(
          abilityResource(catalog, hero, ability),
          stats,
        )
        const amtStat = asFinite(stats.crit_amt_flat_stat)
        if (amtStat != null) {
          putAliased(base * amtStat, 'qty', 'amount', 'count')
        }
      }
      break
    }
    case 88: // Blood Lust — [qty] dmg %, [duration]; Def text is literal
      if (hero) {
        putAliased(
          bloodLustDmgPct(heroPool(catalog, hero).strength, stats),
          'qty',
          'count',
          'amount',
        )
      }
      break
    case 94: // Taunt — [qty]
      if (hero) {
        putAliased(
          hitCountFromStatDiv(abilityResource(catalog, hero, ability), stats),
          'qty',
          'count',
        )
      }
      break
    case 96: {
      // Reflect — [pct] reflect_pct, [qty] hits
      putAliased(
        asFinite(stats.reflect_pct) != null
          ? Math.floor(asFinite(stats.reflect_pct)!)
          : null,
        'pct',
        'amount',
        'chance',
      )
      if (hero) {
        putAliased(
          hitCountFromStatDiv(abilityResource(catalog, hero, ability), stats),
          'qty',
          'count',
        )
      }
      break
    }

    // ── Attack ─────────────────────────────────────────────────────
    case 9: // Earth Spikes — [count]/[qty] bolts
      if (hero) {
        putAliased(
          multiBoltCount(heroPool(catalog, hero).intel, stats),
          'qty',
          'count',
        )
      }
      break
    case 17: {
      // Radiant Smite — [amt] INT dmg, [qty] bonus mult, [tags]
      if (hero) {
        put('amt', intDmgAmount(heroPool(catalog, hero).intel, stats))
      }
      putAliased(asFinite(stats.bonus_dmg_mult), 'qty', 'amount', 'count')
      const tags = bonusDmgTagLabels(catalog, stats)
      if (tags !== undefined) {
        out.tags = tags
      }
      break
    }
    case 25: // Arcane Missile — bolts_stat_div
      if (hero) {
        putAliased(
          multiBoltCount(heroPool(catalog, hero).intel, stats),
          'qty',
          'count',
        )
      }
      break
    case 26: // Mind Spike — flat chance_pct (Silence side-effect)
      putAliased(asFinite(stats.chance_pct), 'pct', 'chance')
      break
    case 38: // Chaos Bolts — [qty] flat bolts
      putAliased(
        asFinite(stats.bolts) ?? asFinite(stats.targets),
        'qty',
        'count',
      )
      break
    case 47: {
      // Meteor — [qty] bolt count, [amt] dmg each — DISTINCT
      if (hero) {
        const intel = heroPool(catalog, hero).intel
        putAliased(multiBoltCount(intel, stats), 'qty', 'count')
        put('amt', intDmgAmount(intel, stats))
      }
      break
    }

    default:
      break
  }

  return out
}

/**
 * Replace `[token]` when a mapped value exists (including `''` for erased
 * conditional clauses like `[persists]` / `[duration]` / `[eligible]` /
 * `[tags]` / `[resistible]`). Unknown brackets stay literal.
 */
export function interpolateAbilityBrackets(
  description: string,
  values: Record<string, string>,
): string {
  if (!description || Object.keys(values).length === 0) {
    return description
  }
  return description.replace(
    /\[([a-zA-Z_][a-zA-Z0-9_]*)\]/g,
    (match, key: string) => {
      if (!Object.prototype.hasOwnProperty.call(values, key)) {
        return match
      }
      return values[key]!
    },
  )
}
