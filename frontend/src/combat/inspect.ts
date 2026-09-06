import type { CombatStack } from './battle'
import {
  stackCombatSpeed,
  stackDefense,
  stackMaxDmg,
  stackMaxHealth,
  stackMaxRange,
  stackMinDmg,
  stackResistance,
} from './battle'
import type { ReferenceCatalog, UnitCombatAbilities, UnitRetaliation } from '../town/catalog'
import { conditionName, unitById, unitRetaliation } from '../town/catalog'

function scale(n: number, signedPct: number): number {
  if (n <= 0 || !signedPct) {
    return Math.max(0, n)
  }
  return Math.max(0, Math.floor((n * (100 + signedPct)) / 100))
}

function formatModified(base: number, pct: number): string {
  if (!pct) {
    return String(base)
  }
  if (base <= 0) {
    return `${pct > 0 ? '+' : ''}${pct}%`
  }
  return String(scale(base, pct))
}

function formatRetaliation(row: UnitRetaliation): string {
  const dmg = row.dmgPct === 'max' ? 'max dmg' : `${row.dmgPct}%`
  const times = row.times === 'unlimited' ? 'unlimited' : `${row.times}×`
  return `${dmg}, ${times}${row.preemptive ? ', preemptive' : ''}`
}

function formatAbilities(abilities: UnitCombatAbilities): string {
  return JSON.stringify(abilities, null, 0)
}

export type InspectRow = {
  label: string
  value: string
}

export type InspectCondition = {
  name: string
  remaining: string
}

export function inspectConditions(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): InspectCondition[] {
  return Object.entries(stack.conditions ?? {})
    .filter(([, remaining]) => (remaining ?? 0) > 0)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, remaining]) => {
      const extra = stack.conditionExtra?.[Number(id)]
      const unit = extra?.roundTick ? 'round' : 'turn'
      return {
        name: conditionName(catalog, Number(id)),
        remaining:
          remaining === 1 ? `this ${unit}` : `${remaining} ${unit}s`,
      }
    })
}

/** Live post-modifier stats for the inspect popup. */
export function inspectRows(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): InspectRow[] {
  const unit = unitById(catalog, stack.unitId)
  if (!unit) {
    return [{ label: 'name', value: `unit ${stack.unitId}` }]
  }
  const magic = (unit.dmg_type ?? '').toLowerCase() === 'magic'
  const out = stack.outputMods
  const totalPct = magic ? (out?.magicTotal ?? 0) : (out?.physicalTotal ?? 0)
  const minPct = magic ? (out?.magicMin ?? 0) : (out?.physicalMin ?? 0)
  const maxPct = magic ? (out?.magicMax ?? 0) : (out?.physicalMax ?? 0)
  const mit = stack.mitigationPct
  const minDmg = scale(scale(stackMinDmg(stack, catalog), minPct), totalPct)
  const maxDmg = scale(scale(stackMaxDmg(stack, catalog), maxPct), totalPct)
  const maxHp = stackMaxHealth(stack, catalog)
  return [
    { label: 'name', value: unit.name },
    { label: 'qty', value: `${stack.qty} / ${stack.startingQty}` },
    { label: 'health (max per creature)', value: String(maxHp) },
    { label: 'top HP', value: `${stack.topHealth} / ${maxHp}` },
    ...(stack.vampiricStrike
      ? [{ label: 'vampiric strike', value: 'active' }]
      : []),
    ...(stack.killOnOverflow
      ? [{ label: 'kill on overflow', value: 'active' }]
      : []),
    ...(stack.critPctBonus
      ? [{ label: 'crit chance bonus', value: `+${stack.critPctBonus}%` }]
      : []),
    ...(stack.critAmtBonus
      ? [{ label: 'crit damage bonus', value: `+${stack.critAmtBonus}%` }]
      : []),
    ...(stack.speedUses
      ? [
          {
            label: 'speed burst',
            value: `${stack.speedUses.amount > 0 ? '+' : ''}${stack.speedUses.amount} (${stack.speedUses.usesLeft} use${stack.speedUses.usesLeft === 1 ? '' : 's'})`,
          },
        ]
      : []),
    ...(stack.chargeRush
      ? [
          {
            label: 'furious rush',
            value: `×${stack.chargeRush.coefficient} (${stack.chargeRush.usesLeft} use${stack.chargeRush.usesLeft === 1 ? '' : 's'})`,
          },
        ]
      : []),
    ...(stack.ignoreMinRangePenalty
      ? [{ label: 'steady aim', value: 'no min-range penalty' }]
      : []),
    ...(stack.parryPhysicalUses
      ? [
          {
            label: 'parry',
            value: `${stack.parryPhysicalUses} physical hit${stack.parryPhysicalUses === 1 ? '' : 's'}`,
          },
        ]
      : []),
    ...(stack.barragePct
      ? [
          {
            label: 'barrage',
            value:
              stack.barrageUsesLeft != null
                ? `${stack.barragePct}% before retaliation (${stack.barrageUsesLeft} left)`
                : `${stack.barragePct}% before retaliation`,
          },
        ]
      : []),
    ...(stack.evasion
      ? [
          {
            label: 'camouflage',
            value: `${stack.evasion.pct}% evade (${stack.evasion.roundsLeft} round${stack.evasion.roundsLeft === 1 ? '' : 's'})`,
          },
        ]
      : []),
    ...(stack.markHitsLeft
      ? [
          {
            label: 'marked',
            value: `${stack.markHitsLeft} max-dmg hit${stack.markHitsLeft === 1 ? '' : 's'}`,
          },
        ]
      : []),
    ...(stack.silenced ? [{ label: 'rift', value: 'silent' }] : []),
    { label: 'dmg_type', value: unit.dmg_type ?? '—' },
    { label: 'min_dmg', value: String(minDmg) },
    { label: 'max_dmg', value: String(maxDmg) },
    { label: 'min_range', value: String(unit.min_range) },
    { label: 'max_range', value: String(stackMaxRange(stack, catalog)) },
    { label: 'defense', value: formatModified(stackDefense(stack, catalog), mit?.defense ?? 0) },
    {
      label: 'resistance',
      value: formatModified(stackResistance(stack, catalog), mit?.resistance ?? 0),
    },
    { label: 'speed', value: unit.speed == null ? '—' : String(stackCombatSpeed(stack, catalog) ?? unit.speed) },
    { label: 'retaliation', value: formatRetaliation(unitRetaliation(unit, catalog)) },
    { label: 'stationary', value: unit.stationary ? 'true' : 'false' },
    { label: 'abilities', value: formatAbilities(unit.abilities) },
  ]
}
