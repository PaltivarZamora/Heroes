import type { Hex } from 'honeycomb-grid'
import type { Container } from 'pixi.js'
import { appendBattleAnimCombatLog } from './battleAnimLogBridge'
import type { CombatTile } from './battle'
import {
  footprintBottomRowCentered,
  footprintExtent,
  footprintHexesCentered,
  parseFootprint,
} from './footprint'
import { addFootprintPropSprite, loadPropTexture } from '../hex/propTextures'
import { hexKey } from './movement'

export type CombatBattlefieldPropPaintCtx = {
  propLayer: Container
  hexByKey: Map<string, Hex>
  byOffset: Map<string, Hex>
  offsetX: number
  offsetY: number
  hexWidth: number
  hexHeight: number
}

const loggedMissingPropFiles = new Set<string>()

export function resetCombatBattlefieldPropPaintLog(): void {
  loggedMissingPropFiles.clear()
}

function logMissingPropFile(file: string, variant: number | null | undefined): void {
  const key = `${file.trim().toLowerCase()}#${variant ?? 1}`
  if (loggedMissingPropFiles.has(key)) {
    return
  }
  loggedMissingPropFiles.add(key)
  const v = variant != null && variant > 0 ? variant : 1
  appendBattleAnimCombatLog(`Obstacle picture missing: ${file.trim()} (variant ${v})`)
}

/** Draw / refresh battle obstacle sprites on the Pixi prop layer. */
export async function paintCombatBattlefieldProps(
  ctx: CombatBattlefieldPropPaintCtx,
  tiles: CombatTile[],
): Promise<void> {
  ctx.propLayer.removeChildren()
  await Promise.all(
    tiles.map(async (tile) => {
      if (!tile.propFile) {
        return
      }
      const hex = ctx.hexByKey.get(hexKey(tile.q, tile.r))
      if (!hex) {
        return
      }
      const texture = await loadPropTexture(tile.propFile, tile.propVariant)
      if (!texture) {
        logMissingPropFile(tile.propFile, tile.propVariant)
        return
      }
      const code = parseFootprint(tile.propFootprint ?? '1x1')
      const ext = footprintExtent(code)
      let cover: Array<{ q: number; r: number }>
      let bottoms: Array<{ q: number; r: number }>
      if (
        tile.col != null &&
        tile.row != null &&
        ext.rows === 1 &&
        ext.cols > 1
      ) {
        const half = Math.floor(ext.cols / 2)
        cover = []
        for (let dc = -half; dc <= half; dc += 1) {
          const cell = ctx.byOffset.get(`${tile.col + dc},${tile.row}`)
          if (cell) {
            cover.push({ q: cell.q, r: cell.r })
          }
        }
        bottoms = cover
      } else {
        cover = footprintHexesCentered({ q: tile.q, r: tile.r }, code)
        bottoms = footprintBottomRowCentered({ q: tile.q, r: tile.r }, code)
      }
      const centers: Array<{ x: number; y: number }> = []
      const bottomCenters: Array<{ x: number; y: number }> = []
      for (const h of cover) {
        const cell = ctx.hexByKey.get(hexKey(h.q, h.r))
        if (!cell) {
          continue
        }
        let cx = 0
        let cy = 0
        for (const c of cell.corners) {
          cx += c.x + ctx.offsetX
          cy += c.y + ctx.offsetY
        }
        centers.push({
          x: cx / cell.corners.length,
          y: cy / cell.corners.length,
        })
      }
      for (const h of bottoms) {
        const cell = ctx.hexByKey.get(hexKey(h.q, h.r))
        if (!cell) {
          continue
        }
        let cx = 0
        let cy = 0
        for (const c of cell.corners) {
          cx += c.x + ctx.offsetX
          cy += c.y + ctx.offsetY
        }
        bottomCenters.push({
          x: cx / cell.corners.length,
          y: cy / cell.corners.length,
        })
      }
      if (centers.length === 0) {
        let cx = 0
        let cy = 0
        for (const c of hex.corners) {
          cx += c.x + ctx.offsetX
          cy += c.y + ctx.offsetY
        }
        centers.push({
          x: cx / hex.corners.length,
          y: cy / hex.corners.length,
        })
      }
      addFootprintPropSprite(
        ctx.propLayer,
        texture,
        centers,
        bottomCenters.length > 0 ? bottomCenters : centers,
        ctx.hexWidth,
        ctx.hexHeight,
      )
    }),
  )
}
