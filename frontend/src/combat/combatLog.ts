/**
 * S6-49 — Standing rule: percent-chance procs log the resolved % and
 * whether they fired. Use these helpers for every special trigger roll
 * (conditions, extra attacks/turns, retaliation passives, ground procs, …).
 * Do not change underlying formulas — logging only.
 */

/** Format a chance % for display (trim trailing .0). */
export function formatChancePct(chancePct: number): string {
  if (!Number.isFinite(chancePct)) {
    return '0'
  }
  const n = Math.round(chancePct * 10) / 10
  return Number.isInteger(n) ? String(n) : String(n)
}

export type ChanceRollLogOpts = {
  /** Extra formula note, e.g. "STR 5 × 1". */
  detail?: string
  /** Phrase after "chance", e.g. "to suppress retaliation". */
  action?: string
  success?: string
  fail?: string
}

/**
 * Default special-proc log line (S6-49).
 * Examples:
 *   Monk: 12% chance to suppress retaliation — triggered!
 *   Assassin: 25% chance to strike again — did not trigger.
 *   Inquisitor Grand: 5% chance (STR 5 × 1) to take an extra turn — triggered!
 */
export function chanceRollLog(
  label: string,
  chancePct: number,
  triggered: boolean,
  opts?: ChanceRollLogOpts,
): string {
  const pct = formatChancePct(chancePct)
  const detail = opts?.detail ? ` (${opts.detail})` : ''
  const action = opts?.action ? ` ${opts.action}` : ''
  const outcome = triggered
    ? (opts?.success ?? 'triggered!')
    : (opts?.fail ?? 'did not trigger.')
  return `${label}: ${pct}% chance${detail}${action} — ${outcome}`
}

/** Roll `chancePct` against random(); returns whether it fired and the d100 roll. */
export function rollChancePctDetailed(
  chancePct: number,
  random: () => number = Math.random,
): { triggered: boolean; roll: number } {
  if (!Number.isFinite(chancePct) || chancePct <= 0) {
    return { triggered: false, roll: 100 }
  }
  const roll = Math.floor(random() * 100)
  return { triggered: roll < chancePct, roll }
}

/** Roll `chancePct` against random(); returns whether it fired. */
export function rollChancePct(
  chancePct: number,
  random: () => number = Math.random,
): boolean {
  return rollChancePctDetailed(chancePct, random).triggered
}

/** S13-22 — blank line + round header for live combat / archive transcripts. */
export function combatRoundMarkerLines(round: number): string[] {
  return ['', `— Round ${round} —`]
}

/** S13-3 — one-line ground effect placement summary (move, attack, retaliate). */
export function summarizeGroundEffectLine(
  unitName: string,
  effect: string,
  chance: number,
  attempted: number,
  placed: number,
  rolls: number[],
  reason?: string,
): string {
  if (reason) {
    return `${unitName}: ${effect} — ${reason}.`
  }
  if (chance >= 100) {
    if (placed > 0) {
      return `${unitName}: ${effect} placed on ${placed}/${attempted} hex${attempted === 1 ? '' : 'es'}.`
    }
    return `${unitName}: ${effect} — none placed (${attempted} hex${attempted === 1 ? '' : 'es'} blocked).`
  }
  const rollText =
    rolls.length === 1
      ? String(rolls[0])
      : rolls.length > 1
        ? rolls.join(', ')
        : '?'
  if (placed > 0) {
    return `${unitName}: ${effect} ${formatChancePct(chance)}% — rolled ${rollText}, ${placed}/${attempted} placed.`
  }
  return `${unitName}: ${effect} ${formatChancePct(chance)}% — rolled ${rollText}, none placed.`
}
