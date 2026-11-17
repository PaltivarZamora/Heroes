import type { ReferenceCatalog } from '../town/catalog'
import type { CombatStack } from './battle'
import { appendBattleAnimCombatLog } from './battleAnimLogBridge'
import {
  polymorphBattleArtConfig,
  polymorphStandFilename,
  type PolymorphBattleArtConfig,
} from './battleAnimConfig'
import {
  invalidatePolymorphBattleSheetCache,
  loadPolymorphBattleIdleSheet,
  type BattleUnitSheetSet,
} from './battleUnitSheet'
import type { StackBattleVisual } from './combatUnitAnimVisual'
import { isPolymorphed } from './condition'
import { setDevPolymorphSheetStatus } from './polymorphDevLog'

const warnedMissingArt = new Set<string>()

export function polymorphArtConfigForStack(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): PolymorphBattleArtConfig | null {
  if (!isPolymorphed(stack, catalog)) {
    return null
  }
  return polymorphBattleArtConfig(catalog)
}

export function stackUsesPolymorphBattleArt(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  sheet: BattleUnitSheetSet | null | undefined,
): boolean {
  return isPolymorphed(stack, catalog) && sheet != null
}

export function stackUsesPolymorphStaticStill(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  sheet: BattleUnitSheetSet | null | undefined,
): boolean {
  if (!isPolymorphed(stack, catalog)) {
    return false
  }
  if (sheet != null) {
    return false
  }
  return polymorphBattleArtConfig(catalog) != null
}

export function polymorphStandImagePath(
  catalog: ReferenceCatalog,
): { filename: string; townFolder: string } | null {
  const cfg = polymorphBattleArtConfig(catalog)
  if (!cfg) {
    return null
  }
  return {
    filename: polymorphStandFilename(cfg.stem),
    townFolder: cfg.townFolder,
  }
}

export async function loadPolymorphBattleArt(
  catalog: ReferenceCatalog,
): Promise<BattleUnitSheetSet | null> {
  const cfg = polymorphBattleArtConfig(catalog)
  if (!cfg) {
    setDevPolymorphSheetStatus({
      kind: 'failed',
      reason: 'polymorph_stem / polymorph_town_id or town folder missing in catalog',
    })
    return null
  }
  invalidatePolymorphBattleSheetCache(cfg.stem, cfg.townFolder)
  const set = await loadPolymorphBattleIdleSheet(cfg.stem, cfg.townFolder)
  if (!set) {
    const warnKey = `${cfg.townFolder}/${cfg.stem}`
    if (!warnedMissingArt.has(warnKey)) {
      warnedMissingArt.add(warnKey)
      appendBattleAnimCombatLog(
        `[Dev] Polymorph art missing for ${cfg.stem} in /assets/units/${cfg.townFolder}/ — using unit art.`,
      )
    }
  }
  return set
}

export function resetPolymorphBattleArtWarnings(): void {
  warnedMissingArt.clear()
}

export function battleAnimSheetForStack(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  unitSheets: Map<number, BattleUnitSheetSet | null>,
  polymorphSheet: BattleUnitSheetSet | null | undefined,
): BattleUnitSheetSet | null {
  if (stackUsesPolymorphBattleArt(stack, catalog, polymorphSheet)) {
    return polymorphSheet ?? null
  }
  return unitSheets.get(stack.unitId) ?? null
}

/** Polymorphed stacks cannot Move/Attack; only Idle (+ procedural) and Hit draw on the field. */
export function clampPolymorphBattleVisual(
  visual: StackBattleVisual,
): StackBattleVisual {
  if (visual.kind === 'Move' || visual.kind === 'Attack') {
    return {
      ...visual,
      kind: 'idle',
      slide: undefined,
      footOverride: undefined,
    }
  }
  return visual
}