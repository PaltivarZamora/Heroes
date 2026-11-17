import type { UnitStackView } from '../town/unitStack'
import type { ReferenceCatalog } from '../town/catalog'
import type { CombatStack } from './battle'
import {
  stackHidesFootprintBoxChrome,
  stackShowsBattleSprites,
} from './combatUnitAnimPlayback'
import type { StackBattleVisual } from './combatUnitAnimVisual'
import type { BattleUnitSheetSet } from './battleUnitSheet'
import { isPolymorphed } from './condition'
import {
  stackUsesPolymorphBattleArt,
  stackUsesPolymorphStaticStill,
} from './polymorphBattleArt'
import type { PolymorphPaintPath } from './polymorphDevLog'

export function stackConditionsFingerprint(stack: CombatStack): string {
  return Object.entries(stack.conditions ?? {})
    .filter(([, left]) => (left ?? 0) > 0)
    .map(([id, left]) => `${id}:${left}`)
    .sort()
    .join(',')
}

/** Paint routing for one stack (from resolved battle stack, not paint-order cache). */
export function resolvePolymorphPaintPath(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  view: UnitStackView | null | undefined,
  unitBattleSheets: Map<number, BattleUnitSheetSet | null>,
  polymorphBattleSheet: BattleUnitSheetSet | null | undefined,
  stackVisual: StackBattleVisual | undefined,
  paintNow: number,
  battleSheetPreloadActive: boolean,
): PolymorphPaintPath {
  const useBattleAnim = stackShowsBattleSprites(
    stack,
    catalog,
    unitBattleSheets,
    stackVisual,
    paintNow,
    polymorphBattleSheet,
  )
  const hideFootprintBox = stackHidesFootprintBoxChrome(
    stack,
    catalog,
    unitBattleSheets,
    battleSheetPreloadActive,
    stackVisual,
    polymorphBattleSheet,
  )
  const polymorphStaticStill = stackUsesPolymorphStaticStill(
    stack,
    catalog,
    polymorphBattleSheet,
  )
  const showStackStatic =
    !useBattleAnim &&
    !hideFootprintBox &&
    (!polymorphStaticStill || view?.preferFilename)
  if (
    stackUsesPolymorphBattleArt(stack, catalog, polymorphBattleSheet) &&
    useBattleAnim
  ) {
    return 'battle sheet'
  }
  if (showStackStatic && view?.preferFilename && isPolymorphed(stack, catalog)) {
    return 'static Stand'
  }
  return 'unit art'
}