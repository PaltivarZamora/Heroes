import type { CombatStack } from './battle'
import type { ReferenceCatalog, UnitCombatAbilities, UnitRetaliation } from '../town/catalog'
import { conditionName, unitById } from '../town/catalog'

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
  const minDmg = scale(scale(unit.min_dmg, minPct), totalPct)
  const maxDmg = scale(scale(unit.max_dmg, maxPct), totalPct)
  const maxHp = Math.max(1, unit.health)
  return [
    { label: 'name', value: unit.name },
    { label: 'qty', value: `${stack.qty} / ${stack.startingQty}` },
    { label: 'health (max per creature)', value: String(maxHp) },
    { label: 'top HP', value: `${stack.topHealth} / ${maxHp}` },
    ...(stack.vampiricStrike
      ? [{ label: 'vampiric strike', value: 'active' }]
      : []),
    ...Object.entries(stack.conditions ?? {})
      .filter(([, remaining]) => (remaining ?? 0) > 0)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([id, remaining]) => ({
        label: conditionName(catalog, Number(id)).toLowerCase(),
        value: remaining === 1 ? 'this turn' : `${remaining} turns`,
      })),
    { label: 'dmg_type', value: unit.dmg_type ?? '—' },
    { label: 'min_dmg', value: String(minDmg) },
    { label: 'max_dmg', value: String(maxDmg) },
    { label: 'min_range', value: String(unit.min_range) },
    { label: 'max_range', value: String(unit.max_range) },
    { label: 'defense', value: formatModified(unit.defense, mit?.defense ?? 0) },
    {
      label: 'resistance',
      value: formatModified(unit.resistance, mit?.resistance ?? 0),
    },
    { label: 'speed', value: unit.speed == null ? '—' : String(unit.speed) },
    { label: 'retaliation', value: formatRetaliation(unit.retaliation) },
    { label: 'stationary', value: unit.stationary ? 'true' : 'false' },
    { label: 'abilities', value: formatAbilities(unit.abilities) },
  ]
}
