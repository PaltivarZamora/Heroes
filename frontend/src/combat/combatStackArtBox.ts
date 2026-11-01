import type { CombatSide } from './battle'
import { footprintExtent, type FootprintCode } from './footprint'
import type { BattleAnimSettings } from './battleAnimConfig'

export type StackArtBox = {
  width: number
  height: number
  left: number
  top: number
}

/** Same footprint box as static stack art on the battle field. */
export function stackArtBox(
  pos: { x: number; y: number },
  hexPx: number,
  code: FootprintCode,
  side: CombatSide,
): StackArtBox {
  const ext = footprintExtent(code)
  const width = hexPx * ext.cols
  const height = hexPx * (1 + Math.max(0, ext.rows - 1) * 0.75)
  const left =
    side === 'def' ? pos.x + hexPx / 2 - width : pos.x - hexPx / 2
  return { width, height, left, top: pos.y - height }
}

/** Foot point: box centre horizontally; fixed gap under feet (see battle_foot_offset_pct). */
export function stackArtBoxFoot(
  box: StackArtBox,
  hexPx: number,
  footOffsetPct: number,
): { footX: number; footY: number } {
  const centerX = box.left + box.width / 2
  const bottomY = box.top + box.height
  const footY = bottomY - (hexPx / 2) * ((100 - footOffsetPct) / 100)
  return { footX: centerX, footY }
}

/** Rest sprite height: footprint box height + (scalePct − 100)% of one hex. */
export function combatBattleUnitTargetRestHeight(
  boxHeight: number,
  hexPx: number,
  spriteScalePct: number,
): number {
  return boxHeight + hexPx * ((spriteScalePct - 100) / 100)
}

/**
 * Scale so rest body height matches combatBattleUnitTargetRestHeight; width cap
 * at spriteMaxWidthPct % of box width when configured.
 */
export function combatBattleUnitSpriteScale(
  hexPx: number,
  code: FootprintCode,
  side: CombatSide,
  restHeight: number,
  frameWidth: number,
  settings: BattleAnimSettings,
): number {
  if (restHeight < 1) {
    return 1
  }
  const box = stackArtBox({ x: 0, y: hexPx }, hexPx, code, side)
  const targetRest = combatBattleUnitTargetRestHeight(
    box.height,
    hexPx,
    settings.spriteScalePct,
  )
  let scale = targetRest / restHeight
  const maxPct = settings.spriteMaxWidthPct
  if (maxPct != null && frameWidth > 0) {
    const scaledW = frameWidth * scale
    const maxW = box.width * (maxPct / 100)
    if (scaledW > maxW) {
      scale *= maxW / scaledW
    }
  }
  return scale
}
