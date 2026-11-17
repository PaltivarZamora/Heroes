import type { Axial } from '../hex/hero'
import type { ReferenceCatalog } from '../town/catalog'
import type { CombatSide, CombatStack } from './battle'
import { battleHeroMountFootprint } from './battleAnimConfig'
import {
  footprintBottomRowWidth,
  footprintExtent,
  footprintHexes,
  type FootprintCode,
} from './footprint'
import { footprintAlong } from './occupancy'
import {
  stackArtBox,
  stackArtBoxFoot,
  type StackArtBox,
} from './combatStackArtBox'

/**
 * Hero stack anchor = inward hex on the mount bottom row (same as draw). `footprintHexes`
 * origin is the outward end of that row.
 */
export function heroMountFootprintOrigin(
  stack: CombatStack,
  footprint: FootprintCode,
): Axial {
  const bottomW = footprintBottomRowWidth(footprint)
  const along = footprintAlong(stack.side)
  return {
    q: stack.q - (bottomW - 1) * along,
    r: stack.r,
  }
}

/** Hexes under the drawn mount (`battle_hero_footprint`); same anchor as art box. */
export function heroMountFootprintHexes(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): Axial[] {
  const footprint = battleHeroMountFootprint(catalog)
  const origin = heroMountFootprintOrigin(stack, footprint)
  return footprintHexes(origin, footprint, footprintAlong(stack.side))
}

/**
 * Hero mount art box: anchor hex is the inward column on the bottom row; width extends
 * outward off the grid; extra footprint rows extend upward (same height rule as units).
 */
export function heroBattleMountArtBox(
  pos: { x: number; y: number },
  hexPx: number,
  side: CombatSide,
  footprint: FootprintCode,
): StackArtBox {
  const ext = footprintExtent(footprint)
  const width = hexPx * ext.cols
  const height = hexPx * (1 + Math.max(0, ext.rows - 1) * 0.75)
  const outwardWidth = Math.max(0, ext.cols - 1) * hexPx
  const left =
    side === 'def'
      ? pos.x - hexPx / 2
      : pos.x - hexPx / 2 - outwardWidth
  return { width, height, left, top: pos.y - height }
}

export function heroBattleMountFoot(
  pos: { x: number; y: number },
  hexPx: number,
  footOffsetPct: number,
  side: CombatSide,
  footprint: FootprintCode,
): { footX: number; footY: number } {
  return stackArtBoxFoot(
    heroBattleMountArtBox(pos, hexPx, side, footprint),
    hexPx,
    footOffsetPct,
  )
}

/** Mount travel art faces left; face toward the battlefield center. */
export function flipHeroMountBattleForSide(side: CombatSide): boolean {
  return side === 'atk'
}

/** Footprint box for hero portrait fallback (unchanged from pre–G14-3). */
export function heroBattlePortraitArtBox(
  pos: { x: number; y: number },
  hexPx: number,
  side: CombatSide,
): StackArtBox {
  return stackArtBox(pos, hexPx, '1x1', side)
}
