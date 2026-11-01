import type { BattleAnimSettings } from './battleAnimConfig'
import { combatBattleUnitSpriteScale } from './combatStackArtBox'
import type { CombatSide, CombatTombstone } from './battle'
import type { FootprintCode } from './footprint'
import {
  battleUnitOwnDieSheetDrawable,
  type BattleUnitSheetSet,
} from './battleUnitSheet'
import {
  combatUnitDrawFootPosition,
  isDieCorpseVisual,
  pickVisualFrame,
  type StackBattleVisual,
} from './combatUnitAnimVisual'
import type { ReferenceCatalog } from '../town/catalog'
import { CORPSE_BODY_REST_HEIGHT_PX } from '../town/unitCorpsePicture'
import { tombCorpseArtFootprintCode } from './tombstone'

export {
  tombBlockingFootprintCode,
  tombCorpseArtFootprintCode,
  tombFootprintCode,
} from './tombstone'

/** Die last frame only when this unit has its own Die sheet (not partner borrow). */
export function corpseUsesOwnDieSheetHold(
  visual: StackBattleVisual | undefined,
  set: BattleUnitSheetSet | null | undefined,
): boolean {
  if (!isDieCorpseVisual(visual)) {
    return false
  }
  return battleUnitOwnDieSheetDrawable(set)
}

export function tombCorpseDrawFoot(
  tomb: CombatTombstone,
  anchor: { x: number; y: number },
  hexPx: number,
  footOffsetPct: number,
  side: CombatSide,
  catalog: ReferenceCatalog,
  visual: StackBattleVisual | undefined,
  nowMs: number,
): { footX: number; footY: number } {
  return combatUnitDrawFootPosition(
    { x: anchor.x, y: anchor.y },
    hexPx,
    footOffsetPct,
    tombCorpseArtFootprintCode(tomb, catalog),
    side,
    visual,
    nowMs,
  )
}

export function corpseStaticImageScale(
  hexPx: number,
  footprint: FootprintCode,
  side: CombatSide,
  frameWidth: number,
  settings: BattleAnimSettings,
): number {
  return combatBattleUnitSpriteScale(
    hexPx,
    footprint,
    side,
    CORPSE_BODY_REST_HEIGHT_PX,
    frameWidth,
    settings,
  )
}

export function corpseDieFrameScale(
  hexPx: number,
  footprint: FootprintCode,
  side: CombatSide,
  dieRestHeight: number,
  frameWidth: number,
  settings: BattleAnimSettings,
): number {
  return combatBattleUnitSpriteScale(
    hexPx,
    footprint,
    side,
    dieRestHeight,
    frameWidth,
    settings,
  )
}

export function pickCorpseDieFrame(
  set: BattleUnitSheetSet,
  visual: StackBattleVisual,
  settings: BattleAnimSettings,
  nowMs: number,
) {
  return pickVisualFrame(set, visual, settings, nowMs)
}
