/**
 * S6-49 — Standing rule: percent-chance procs log the resolved % and
 * whether they fired. Use these helpers for every special trigger roll
 * (conditions, extra attacks/turns, retaliation passives, ground procs, …).
 * Do not change underlying formulas — logging only.
 */
/** Format a chance % for display (trim trailing .0). */
export function formatChancePct(chancePct) {
    if (!Number.isFinite(chancePct)) {
        return '0';
    }
    const n = Math.round(chancePct * 10) / 10;
    return Number.isInteger(n) ? String(n) : String(n);
}
/**
 * Default special-proc log line (S6-49).
 * Examples:
 *   Monk: 12% chance to suppress retaliation — triggered!
 *   Assassin: 25% chance to strike again — did not trigger.
 *   Inquisitor Grand: 5% chance (STR 5 × 1) to take an extra turn — triggered!
 */
export function chanceRollLog(label, chancePct, triggered, opts) {
    const pct = formatChancePct(chancePct);
    const detail = opts?.detail ? ` (${opts.detail})` : '';
    const action = opts?.action ? ` ${opts.action}` : '';
    const outcome = triggered
        ? (opts?.success ?? 'triggered!')
        : (opts?.fail ?? 'did not trigger.');
    return `${label}: ${pct}% chance${detail}${action} — ${outcome}`;
}
/** Roll `chancePct` against random(); returns whether it fired. */
export function rollChancePct(chancePct, random = Math.random) {
    if (!Number.isFinite(chancePct) || chancePct <= 0) {
        return false;
    }
    return random() * 100 < chancePct;
}
