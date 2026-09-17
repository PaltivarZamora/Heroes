import type { ReactNode } from 'react'
import type { ReferenceCatalog } from './catalog'
import { unitById } from './catalog'
import type { CombatBattle, CombatSide, CombatStack } from '../combat/battle'
import {
  stackCombatSpeed,
  stackDefense,
  stackMaxDmg,
  stackMaxHealth,
  stackMinDmg,
  stackResistance,
} from '../combat/battle'
import type { CombatHeroes } from '../combat/attack'
import {
  inspectHoverRows,
  type InspectRow,
} from '../combat/inspect'
import { AbilityTip } from './AbilityTip'

/** Format inspect-style rows as AbilityTip text. */
export function formatToolkitRows(rows: InspectRow[]): string {
  return rows
    .map((row) => (row.value ? `${row.label}: ${row.value}` : row.label))
    .join('\n')
}

/**
 * Out-of-combat unit stack tip — same fields as battle hover (no live buffs).
 */
export function sessionUnitToolkitRows(
  catalog: ReferenceCatalog,
  unitId: number,
  qty: number,
): InspectRow[] {
  const unit = unitById(catalog, unitId)
  if (!unit) {
    return [{ label: 'name', value: `unit ${unitId}` }]
  }
  const minDmg = unit.min_dmg
  const maxDmg = unit.max_dmg
  return [
    { label: 'name', value: unit.name },
    { label: 'qty', value: String(qty) },
    { label: 'top HP', value: String(unit.health) },
    {
      label: 'dmg',
      value:
        minDmg != null && maxDmg != null
          ? `${minDmg}–${maxDmg}`
          : '—',
    },
    { label: 'defense', value: String(unit.defense ?? '—') },
    { label: 'resistance', value: String(unit.resistance ?? '—') },
    {
      label: 'speed',
      value: unit.speed == null ? '—' : String(unit.speed),
    },
  ]
}

/** Battle: reuse inspectHoverRows. */
export function battleUnitToolkitRows(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  viewerSide?: CombatSide | null,
  battle?: CombatBattle,
  heroes?: CombatHeroes,
): InspectRow[] {
  return inspectHoverRows(stack, catalog, viewerSide, battle, heroes)
}

/** Optional helper when a pseudo-stack is available outside combat. */
export function unitToolkitFromCombatStats(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): InspectRow[] {
  const unit = unitById(catalog, stack.unitId)
  if (!unit) {
    return [{ label: 'name', value: `unit ${stack.unitId}` }]
  }
  return [
    { label: 'name', value: unit.name },
    { label: 'qty', value: `${stack.qty} / ${stack.startingQty}` },
    {
      label: 'top HP',
      value: `${stack.topHealth} / ${stackMaxHealth(stack, catalog)}`,
    },
    {
      label: 'dmg',
      value: `${stackMinDmg(stack, catalog)}–${stackMaxDmg(stack, catalog)}`,
    },
    { label: 'defense', value: String(stackDefense(stack, catalog)) },
    { label: 'resistance', value: String(stackResistance(stack, catalog)) },
    {
      label: 'speed',
      value:
        unit.speed == null
          ? '—'
          : String(stackCombatSpeed(stack, catalog) ?? unit.speed),
    },
  ]
}

export function UnitToolkitTip({
  rows,
  children,
  className,
}: {
  rows: InspectRow[]
  children: ReactNode
  className?: string
}) {
  if (rows.length === 0) {
    return children
  }
  return (
    <AbilityTip className={className} description={formatToolkitRows(rows)}>
      {children}
    </AbilityTip>
  )
}
