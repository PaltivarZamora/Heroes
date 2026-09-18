/** Shared combat display / resolution math (no catalog imports — avoids cycles). */

export const ENERGY_RESOURCE_ID = 1
export const MANA_RESOURCE_ID = 2

export const STR_OVER_BASE = 10

export function asFinite(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function resourceStat(
  strength: number,
  intel: number,
  resourceId: number,
): number {
  return resourceId === ENERGY_RESOURCE_ID ? strength : intel
}

/**
 * Default: max(0, stat − 10). `no_stat_threshold` is a per-ability exception.
 * Same path as combat buff scaling (Bless, Barrage flat add, crit buffs).
 */
export function scaledResourceStat(
  raw: number,
  stats: Record<string, unknown>,
): number {
  if (stats.no_stat_threshold === true) {
    return Math.max(0, raw)
  }
  return Math.max(0, raw - STR_OVER_BASE)
}

export function statDiv(
  stats: Record<string, unknown>,
  key: string,
): number | null {
  const div = asFinite(stats[key])
  if (div == null || div <= 0) {
    return null
  }
  return div
}

export function formatStatBonus(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
}

/** Multi-shape bolt count — same rules as resolveAbility multi branch. */
export function multiBoltCount(
  intel: number,
  stats: Record<string, unknown>,
): number {
  const boltsStat = asFinite(stats.bolts_stat)
  if (boltsStat != null) {
    return Math.max(1, Math.floor(intel * boltsStat))
  }
  const boltsDiv = statDiv(stats, 'bolts_stat_div')
  if (boltsDiv != null) {
    return Math.max(1, Math.floor(intel / boltsDiv))
  }
  return Math.max(
    1,
    Math.floor(asFinite(stats.bolts) ?? asFinite(stats.targets) ?? 1),
  )
}

/** floor(resourceStat / hit_count_stat_div). */
export function hitCountFromStatDiv(
  resource: number,
  stats: Record<string, unknown>,
): number | null {
  const hitDiv = statDiv(stats, 'hit_count_stat_div')
  if (hitDiv == null) {
    return null
  }
  return Math.max(0, Math.floor(resource / hitDiv))
}

/** Barrage combined second-attack % — base + scaled flat. */
export function barrageSecondAttackPct(
  scaledStat: number,
  stats: Record<string, unknown>,
): number | null {
  const barrage = asFinite(stats.grants_second_attack_pct)
  if (barrage == null || barrage <= 0) {
    return null
  }
  const flat = asFinite(stats.second_attack_pct_flat_stat) ?? 0
  return Math.max(0, Math.floor(barrage + scaledStat * flat))
}

/** Smoke Bomb ground evasion % — strength × evasion_pct_flat_stat. */
export function smokeBombEvasionPct(
  strength: number,
  stats: Record<string, unknown>,
): number | null {
  const evasionMult = asFinite(stats.evasion_pct_flat_stat)
  if (evasionMult == null) {
    return null
  }
  return Math.max(0, Math.floor(strength * evasionMult))
}

/** Fervor chain chance — strength × chain_trigger_pct_stat. */
export function fervorChainChancePct(
  strength: number,
  stats: Record<string, unknown>,
): number | null {
  const chainPctStat = asFinite(stats.chain_trigger_pct_stat)
  if (chainPctStat == null || chainPctStat <= 0) {
    return null
  }
  return Math.max(0, Math.floor(strength * chainPctStat))
}

/** Summon qty — floor(resourceStat / summon_qty_stat_div). */
export function summonQtyFromStatDiv(
  resource: number,
  stats: Record<string, unknown>,
): number | null {
  const qtyDiv = asFinite(stats.summon_qty_stat_div)
  if (qtyDiv == null || qtyDiv <= 0) {
    return null
  }
  return Math.max(0, Math.floor(resource / qtyDiv))
}

/** Barrier line length — floor(resourceStat / line_length_stat_div). */
export function barrierLineLength(
  resource: number,
  stats: Record<string, unknown>,
): number | null {
  const lengthDiv = asFinite(stats.line_length_stat_div)
  if (lengthDiv == null || lengthDiv <= 0) {
    return null
  }
  return Math.max(1, Math.floor(resource / lengthDiv))
}

/** Last Stand min qty — floor(resourceStat / min_qty_stat_div). */
export function lastStandMinQty(
  resource: number,
  stats: Record<string, unknown>,
): number | null {
  const minQtyDiv = asFinite(stats.min_qty_stat_div)
  if (minQtyDiv == null || minQtyDiv <= 0) {
    return null
  }
  return Math.max(0, Math.floor(resource / minQtyDiv))
}

/** Push Back distance — flat push_dist or floor(resource / push_dist_stat_div). */
export function pushBackDistance(
  resource: number,
  stats: Record<string, unknown>,
): number | null {
  const flatDist = asFinite(stats.push_dist)
  if (flatDist != null && flatDist > 0) {
    return Math.max(0, Math.floor(flatDist))
  }
  const pushDiv = asFinite(stats.push_dist_stat_div)
  if (pushDiv == null || pushDiv <= 0) {
    return null
  }
  return Math.max(0, Math.floor(resource / pushDiv))
}

/**
 * Polymorph break chance — min(100, floor(targetRes × break_chance_pct_stat)).
 * Needs a target's live Resistance; without it the bracket stays unsubstituted.
 */
export function polymorphBreakChancePct(
  targetResistance: number,
  stats: Record<string, unknown>,
): number | null {
  const mult = asFinite(stats.break_chance_pct_stat)
  if (mult == null) {
    return null
  }
  return Math.min(100, Math.floor(targetResistance * mult))
}

/**
 * Mirror Image front-unit HP — floor(INT × duplicate_hp_cap_stat), capped at
 * the source stack's max HP. Same path combat uses in applyMirrorImage.
 * When `unitMaxHp` is omitted (tooltip with no target), only the INT cap applies.
 */
export function mirrorImageTopHealth(
  intel: number,
  stats: Record<string, unknown>,
  unitMaxHp?: number | null,
): number | null {
  const capMult = asFinite(stats.duplicate_hp_cap_stat)
  if (capMult == null) {
    return null
  }
  const intelCap = Math.max(1, Math.floor(intel * Math.max(0, capMult)))
  if (unitMaxHp == null || !Number.isFinite(unitMaxHp)) {
    return intelCap
  }
  const maxHp = Math.max(1, Math.floor(unitMaxHp))
  return Math.max(1, Math.min(intelCap, maxHp))
}

/**
 * Tooltip clause for `[duration]` (S7-12 addendum).
 * - `duration_stat_div` → ` for N rounds` (N = floor(resource / div); needs resource)
 * - `duration: x` → ` for x rounds`
 * - `duration: null` → ` for the battle`
 * - no duration-family key → `''` (erase token; Rod omits bracket when unused)
 * - `duration_stat_div` present but no resource yet → `undefined` (leave literal)
 */
export function durationTooltipClause(
  stats: Record<string, unknown>,
  resource: number | null,
): string | undefined {
  const hasDivKey = Object.prototype.hasOwnProperty.call(
    stats,
    'duration_stat_div',
  )
  const hasDurationKey = Object.prototype.hasOwnProperty.call(stats, 'duration')
  if (!hasDivKey && !hasDurationKey) {
    return ''
  }

  // Prefer stat-scaled path — same ordering combat uses when both exist.
  const div = statDiv(stats, 'duration_stat_div')
  if (div != null) {
    if (resource == null) {
      return undefined
    }
    const rounds = Math.max(0, Math.floor(resource / div))
    return ` for ${rounds} rounds`
  }

  if (hasDurationKey && stats.duration === null) {
    return ' for the battle'
  }

  const flat = asFinite(stats.duration)
  if (flat != null) {
    return ` for ${Math.max(0, Math.floor(flat))} rounds`
  }

  return ''
}

/** Seeds of Shadow — floor(INT × seed_count_stat). */
export function seedsOfShadowCount(
  intel: number,
  stats: Record<string, unknown>,
): number | null {
  const factor = asFinite(stats.seed_count_stat)
  if (factor == null) {
    return null
  }
  return Math.max(0, Math.floor(intel * factor))
}

/** Gift of Gaia clear chance — INT × clear_chance_pct_stat. */
export function giftOfGaiaClearPct(
  intel: number,
  stats: Record<string, unknown>,
): number | null {
  const factor = asFinite(stats.clear_chance_pct_stat)
  if (factor == null) {
    return null
  }
  return Math.max(0, intel * factor)
}

/** Explosive Trap flat damage — STR × flat_dmg_flat_stat. */
export function explosiveTrapFlatDmg(
  strength: number,
  stats: Record<string, unknown>,
): number | null {
  const mult = asFinite(stats.flat_dmg_flat_stat)
  if (mult == null) {
    return null
  }
  return Math.max(0, Math.floor(strength * mult))
}

/**
 * Explosive Trap stun chance — prefer flat `chance_pct`; else STR ×
 * `chance_pct_flat_stat` (same path as groundEffect placement).
 */
export function explosiveTrapChancePct(
  strength: number,
  stats: Record<string, unknown>,
): number | null {
  const flat = asFinite(stats.chance_pct)
  if (flat != null) {
    return Math.max(0, Math.min(100, Math.floor(flat)))
  }
  const mult = asFinite(stats.chance_pct_flat_stat)
  if (mult == null) {
    return null
  }
  return Math.max(0, Math.floor(strength * mult))
}

/**
 * Bound Spirit / Mud Golem / Illusions qty.
 * `summon_qty_stat_div` wins when present: floor(resource / div);
 * else floor(INT × summon_qty_int_stat).
 */
export function summonQtyResolved(
  resource: number,
  intel: number,
  stats: Record<string, unknown>,
): number | null {
  const fromDiv = summonQtyFromStatDiv(resource, stats)
  if (fromDiv != null) {
    return fromDiv
  }
  const intStat = asFinite(stats.summon_qty_int_stat)
  if (intStat == null) {
    return null
  }
  return Math.max(0, Math.floor(intel * intStat))
}

/**
 * Raise Skeleton / Recruit the Dead — % of tagged deaths raised:
 * floor(resource × kill_pct_stat).
 */
export function raiseFromKillsPct(
  resource: number,
  stats: Record<string, unknown>,
): number | null {
  const pct = asFinite(stats.kill_pct_stat)
  if (pct == null) {
    return null
  }
  return Math.max(0, Math.floor(resource * pct))
}

/** Spell / buff use count — uses_stat_div or flat uses. */
export function usesFromStats(
  resource: number,
  stats: Record<string, unknown>,
): number | null {
  const usesDiv = statDiv(stats, 'uses_stat_div')
  if (usesDiv != null) {
    return Math.max(0, Math.floor(resource / usesDiv))
  }
  const flat = asFinite(stats.uses)
  if (flat == null) {
    return null
  }
  return Math.max(0, Math.floor(flat))
}

/** floor(resource / key) for bonus/buff/speed divides. */
export function floorResourceDiv(
  resource: number,
  stats: Record<string, unknown>,
  key: string,
): number | null {
  const div = statDiv(stats, key)
  if (div == null) {
    return null
  }
  return Math.max(0, Math.floor(resource / div))
}

/** INT × int_dmg — Radiant Smite / Meteor per-hit damage. */
export function intDmgAmount(
  intel: number,
  stats: Record<string, unknown>,
): number | null {
  const factor = asFinite(stats.int_dmg)
  if (factor == null) {
    return null
  }
  return Math.max(0, Math.floor(intel * factor))
}

/**
 * Wild Surge roll bounds — lo = magic_dmg_total_roll_min;
 * hi = floor(magic_dmg_total_roll_max_stat + INT). Same as applyRollAndSpeedKeys.
 */
export function wildSurgeRollBounds(
  intel: number,
  stats: Record<string, unknown>,
): { min: number; max: number } | null {
  const loRaw = asFinite(stats.magic_dmg_total_roll_min)
  const maxStat = asFinite(stats.magic_dmg_total_roll_max_stat)
  if (loRaw == null && maxStat == null) {
    return null
  }
  const min = Math.floor(loRaw ?? 1)
  const max = Math.floor((maxStat ?? min) + intel)
  return { min, max }
}

/**
 * Blood Lust / strength-swing damage % — floor((stat−10) × dmg_buff_pct_stat),
 * with nonzero raw flooring to at least 1 (same as applyStrengthSwing).
 */
export function bloodLustDmgPct(
  strength: number,
  stats: Record<string, unknown>,
): number | null {
  const dmgStat = asFinite(stats.dmg_buff_pct_stat)
  if (dmgStat == null) {
    return null
  }
  const over = scaledResourceStat(strength, stats)
  const raw = over * dmgStat
  let pct = Math.max(0, Math.floor(raw))
  if (pct === 0 && raw > 0) {
    pct = 1
  }
  return pct
}

/** Charge — floor(heroSpeed × speed_buff_flat_stat). */
export function chargeSpeedBuff(
  heroSpeed: number,
  stats: Record<string, unknown>,
): number | null {
  const factor = asFinite(stats.speed_buff_flat_stat)
  if (factor == null) {
    return null
  }
  return Math.max(0, Math.floor(heroSpeed * factor))
}

/** Mutation magnitude — floor(INT × delta_all_stats_stat). */
export function mutationStatDelta(
  intel: number,
  stats: Record<string, unknown>,
): number | null {
  const factor = asFinite(stats.delta_all_stats_stat)
  if (factor == null) {
    return null
  }
  return Math.max(0, Math.floor(intel * factor))
}

/**
 * Sap Strength physical-total % — floor(resource × physical_dmg_total_stat)
 * (absolute magnitude; sign comes from ability type in combat).
 */
export function sapStrengthPct(
  resource: number,
  stats: Record<string, unknown>,
): number | null {
  const factor = asFinite(stats.physical_dmg_total_stat)
  if (factor == null) {
    return null
  }
  return Math.max(0, Math.floor(resource * factor))
}

/** Mass Slow flat speed cut — floor(resource / speed_debuff_stat_div). */
export function massSlowSpeedCut(
  resource: number,
  stats: Record<string, unknown>,
): number | null {
  return floorResourceDiv(resource, stats, 'speed_debuff_stat_div')
}

/**
 * Slow % of live speed — floor(resource × speed_debuff_pct_stat). Absolute hex
 * cut needs a target; tooltip shows the percentage combat applies first.
 */
export function slowSpeedPct(
  resource: number,
  stats: Record<string, unknown>,
): number | null {
  const factor = asFinite(stats.speed_debuff_pct_stat)
  if (factor == null) {
    return null
  }
  return Math.max(0, Math.floor(resource * factor))
}

/** `[resistible]` clause — present when resist_stat is a non-empty string. */
export function resistibleTooltipClause(
  stats: Record<string, unknown>,
): string {
  const raw = stats.resist_stat
  return typeof raw === 'string' && raw.trim().length > 0 ? 'resistible' : ''
}
