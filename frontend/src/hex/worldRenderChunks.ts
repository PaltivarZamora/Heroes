/**
 * World-map terrain bake + fog + prop incremental paint + viewport cull (BR S9-16).
 *
 * Render chunks are fixed 16×16 blocks in odd-r offset (col,row) space.
 * Each chunk with explored hexes bakes terrain+wedges into one RenderTexture.
 * Wedges live on the painted hex (cell-masked), so cross-chunk neighbors only
 * need terrain lookups — no shared pixels between chunk textures.
 */

import {
  Container,
  Graphics,
  RenderTexture,
  Sprite,
  type Application,
  type Texture,
} from 'pixi.js'
import type { Grid, Hex } from 'honeycomb-grid'
import type { ReferenceCatalog } from '../town/catalog'
import {
  addChunkMaskedTerrain,
  addMaskedTerrainWedge,
  buildTerrainChunkDecors,
  type ChunkTextureDecor,
} from './terrainTextures'
import {
  assignedTerrainForHex,
  assignedTerrainName,
  parseCssHexColor,
  wedgesForHex,
} from './terrainTransition'
import { layoutWorldMapPropSprite, type PropCullBox } from './propTextures'
import { propRowById } from '../town/catalog'
import { forEachTile, getTile, isExplored } from './world'

/** Fixed bake / cull block size in offset hexes. */
export const RENDER_CHUNK_SIZE = 16

const UNEXPLORED_COLOR = 0x3a3a3a
const CULL_MARGIN_PX = 128

export type Axial = { q: number; r: number }

export type WorldRenderStats = {
  fps: number
  frameMs: number
  avgFrameMs: number
  lastRepaintMs: number
  displayObjectsTotal: number
  displayObjectsVisible: number
  exploredHexes: number
  bakedChunks: number
  visibleChunks: number
  chunkSize: number
}

type ChunkCell = {
  q: number
  r: number
  hex: Hex
  col: number
  row: number
}

type ChunkBucket = {
  cx: number
  cy: number
  cells: ChunkCell[]
  /** World AABB of all hexes in this chunk (for RT size + cull). */
  minX: number
  minY: number
  maxX: number
  maxY: number
  terrainSprite: Sprite | null
  terrainRt: RenderTexture | null
  fogGfx: Graphics
  dirty: boolean
}

function offsetFromZero(axis: number): number {
  return (axis + -1 * (axis & 1)) >> 1
}

function axialToOffset(q: number, r: number): { col: number; row: number } {
  return { col: q + offsetFromZero(r), row: r }
}

function chunkCoord(col: number, row: number): { cx: number; cy: number } {
  return {
    cx: Math.floor(col / RENDER_CHUNK_SIZE),
    cy: Math.floor(row / RENDER_CHUNK_SIZE),
  }
}

function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`
}

function hexKey(q: number, r: number): string {
  return `${q},${r}`
}

function hexCenter(hex: Hex, offsetX: number, offsetY: number) {
  const corners = hex.corners
  let x = 0
  let y = 0
  for (const corner of corners) {
    x += corner.x
    y += corner.y
  }
  const n = corners.length
  return { x: x / n + offsetX, y: y / n + offsetY }
}

function countDisplayTree(
  root: Container,
): { total: number; visible: number } {
  let total = 0
  let visible = 0
  const walk = (node: Container, parentVisible: boolean) => {
    total += 1
    const on =
      parentVisible && node.visible !== false && node.renderable !== false
    if (on) {
      visible += 1
    }
    for (const child of node.children) {
      if (child instanceof Container) {
        walk(child, on)
      } else {
        total += 1
        const leaf = child as { visible?: boolean; renderable?: boolean }
        if (on && leaf.visible !== false && leaf.renderable !== false) {
          visible += 1
        }
      }
    }
  }
  walk(root, true)
  return { total, visible }
}

export type WorldChunkRendererOpts = {
  app: Application
  grid: Grid<Hex>
  terrainLayer: Container
  fogLayer: Container
  propLayer: Container
  offsetX: number
  offsetY: number
  hexSize: number
  seed: number
  useTerrainImages: boolean
  showHexOutlines: boolean
  wedgesEnabled: () => boolean
  hexTerrainTextures: Map<string, Texture>
  getCatalog: () => ReferenceCatalog | null
}

export class WorldChunkRenderer {
  readonly chunkSize = RENDER_CHUNK_SIZE
  private readonly app: Application
  private readonly grid: Grid<Hex>
  private readonly terrainLayer: Container
  private readonly fogLayer: Container
  private readonly propLayer: Container
  private readonly offsetX: number
  private readonly offsetY: number
  private readonly hexSize: number
  private readonly seed: number
  private useTerrainImages: boolean
  private showHexOutlines: boolean
  private readonly wedgesEnabled: () => boolean
  private readonly hexTerrainTextures: Map<string, Texture>
  private readonly getCatalog: () => ReferenceCatalog | null

  private buckets = new Map<string, ChunkBucket>()
  private chunkDecors = new Map<string, ChunkTextureDecor>()
  private propByHex = new Map<string, Sprite>()
  private propCullByHex = new Map<string, PropCullBox>()
  private lastRepaintMs = 0
  private frameMs = 16.7
  private avgFrameMs = 16.7
  private fps = 60
  private exploredCount = 0

  constructor(opts: WorldChunkRendererOpts) {
    this.app = opts.app
    this.grid = opts.grid
    this.terrainLayer = opts.terrainLayer
    this.fogLayer = opts.fogLayer
    this.propLayer = opts.propLayer
    this.offsetX = opts.offsetX
    this.offsetY = opts.offsetY
    this.hexSize = opts.hexSize
    this.seed = opts.seed
    this.useTerrainImages = opts.useTerrainImages
    this.showHexOutlines = opts.showHexOutlines
    this.wedgesEnabled = opts.wedgesEnabled
    this.hexTerrainTextures = opts.hexTerrainTextures
    this.getCatalog = opts.getCatalog
    this.propLayer.sortableChildren = true
    this.buildBuckets()
    this.rebuildDecors()
  }

  private buildBuckets() {
    this.buckets.clear()
    this.grid.forEach((hex) => {
      const { col, row } = axialToOffset(hex.q, hex.r)
      const { cx, cy } = chunkCoord(col, row)
      const key = chunkKey(cx, cy)
      let bucket = this.buckets.get(key)
      if (!bucket) {
        bucket = {
          cx,
          cy,
          cells: [],
          minX: Infinity,
          minY: Infinity,
          maxX: -Infinity,
          maxY: -Infinity,
          terrainSprite: null,
          terrainRt: null,
          fogGfx: new Graphics(),
          dirty: true,
        }
        this.fogLayer.addChild(bucket.fogGfx)
        this.buckets.set(key, bucket)
      }
      bucket.cells.push({ q: hex.q, r: hex.r, hex, col, row })
      for (const corner of hex.corners) {
        const x = corner.x + this.offsetX
        const y = corner.y + this.offsetY
        if (x < bucket.minX) bucket.minX = x
        if (y < bucket.minY) bucket.minY = y
        if (x > bucket.maxX) bucket.maxX = x
        if (y > bucket.maxY) bucket.maxY = y
      }
    })
    const pad = this.hexSize * 0.75
    for (const bucket of this.buckets.values()) {
      bucket.minX -= pad
      bucket.minY -= pad
      bucket.maxX += pad
      bucket.maxY += pad
    }
  }

  /** Generation-chunk UV decors — once per map (or after settings that remount). */
  rebuildDecors() {
    const members: Array<{ q: number; r: number; hex: Hex }> = []
    this.grid.forEach((hex) => {
      members.push({ q: hex.q, r: hex.r, hex })
    })
    this.chunkDecors = this.useTerrainImages
      ? buildTerrainChunkDecors(
          members,
          (q, r) => assignedTerrainName(q, r),
          (q, r) => getTile(q, r)?.chunkId ?? null,
          (name) =>
            this.hexTerrainTextures.get(name) ??
            this.hexTerrainTextures.get(name.replaceAll(' ', '_')),
          this.offsetX,
          this.offsetY,
          this.seed,
        )
      : new Map()
  }

  setAppearanceFlags(opts: {
    useTerrainImages?: boolean
    showHexOutlines?: boolean
  }) {
    if (opts.useTerrainImages != null) {
      this.useTerrainImages = opts.useTerrainImages
    }
    if (opts.showHexOutlines != null) {
      this.showHexOutlines = opts.showHexOutlines
    }
  }

  /**
   * Full terrain+fog rebuild for all chunks that have any explored hex.
   * Used on first paint and when wedge/image/outline settings change.
   */
  rebakeAll(): number {
    const t0 = performance.now()
    this.rebuildDecors()
    let explored = 0
    for (const bucket of this.buckets.values()) {
      bucket.dirty = true
      let any = false
      for (const cell of bucket.cells) {
        if (isExplored(cell.q, cell.r)) {
          any = true
          explored += 1
        }
      }
      if (any) {
        this.bakeChunk(bucket)
      } else {
        this.clearChunkTerrain(bucket)
      }
      this.paintChunkFog(bucket)
    }
    this.exploredCount = explored
    this.lastRepaintMs = performance.now() - t0
    return this.lastRepaintMs
  }

  /**
   * Reveal newly explored hexes: rebake only affected chunks + their fog.
   * Returns false when `hexes` is empty (caller should skip props too).
   */
  revealHexes(hexes: readonly Axial[]): boolean {
    if (hexes.length === 0) {
      this.lastRepaintMs = 0
      return false
    }
    const t0 = performance.now()
    const dirty = new Set<string>()
    for (const { q, r } of hexes) {
      const { col, row } = axialToOffset(q, r)
      const { cx, cy } = chunkCoord(col, row)
      dirty.add(chunkKey(cx, cy))
    }
    for (const key of dirty) {
      const bucket = this.buckets.get(key)
      if (!bucket) {
        continue
      }
      this.bakeChunk(bucket)
      this.paintChunkFog(bucket)
    }
    this.exploredCount = 0
    forEachTile((q, r) => {
      if (isExplored(q, r)) {
        this.exploredCount += 1
      }
    })
    this.lastRepaintMs = performance.now() - t0
    return true
  }

  private clearChunkTerrain(bucket: ChunkBucket) {
    if (bucket.terrainSprite) {
      this.terrainLayer.removeChild(bucket.terrainSprite)
      bucket.terrainSprite.destroy()
      bucket.terrainSprite = null
    }
    if (bucket.terrainRt) {
      bucket.terrainRt.destroy(true)
      bucket.terrainRt = null
    }
  }

  private bakeChunk(bucket: ChunkBucket) {
    const catalog = this.getCatalog()
    if (!catalog || catalog.terrain.length === 0) {
      return
    }
    const exploredCells = bucket.cells.filter((c) => isExplored(c.q, c.r))
    if (exploredCells.length === 0) {
      this.clearChunkTerrain(bucket)
      bucket.dirty = false
      return
    }

    const w = Math.max(1, Math.ceil(bucket.maxX - bucket.minX))
    const h = Math.max(1, Math.ceil(bucket.maxY - bucket.minY))
    const stage = new Container()
    stage.position.set(-bucket.minX, -bucket.minY)

    for (const cell of exploredCells) {
      this.paintHexInto(stage, cell.hex, catalog)
    }

    const rt =
      bucket.terrainRt &&
      bucket.terrainRt.width === w &&
      bucket.terrainRt.height === h
        ? bucket.terrainRt
        : RenderTexture.create({
            width: w,
            height: h,
            resolution: 1,
            antialias: true,
          })
    if (rt !== bucket.terrainRt) {
      this.clearChunkTerrain(bucket)
      bucket.terrainRt = rt
    }

    this.app.renderer.render({
      container: stage,
      target: rt,
      clear: true,
    })
    stage.destroy({ children: true })

    if (!bucket.terrainSprite) {
      bucket.terrainSprite = new Sprite(rt)
      bucket.terrainSprite.position.set(bucket.minX, bucket.minY)
      this.terrainLayer.addChild(bucket.terrainSprite)
    } else {
      bucket.terrainSprite.texture = rt
      bucket.terrainSprite.position.set(bucket.minX, bucket.minY)
    }
    bucket.dirty = false
  }

  /** Same paint path as the former live per-hex terrain (visual parity). */
  private paintHexInto(
    parent: Container,
    hex: Hex,
    catalog: ReferenceCatalog,
  ) {
    const base = assignedTerrainForHex(catalog, hex.q, hex.r)
    if (!base) {
      return
    }
    const poly = hex.corners.map((corner) => ({
      x: corner.x + this.offsetX,
      y: corner.y + this.offsetY,
    }))

    const cell = new Container()
    const cellMask = new Graphics()
    cellMask.poly(poly)
    cellMask.fill({ color: 0xffffff })
    cell.addChild(cellMask)
    cell.mask = cellMask

    if (this.useTerrainImages) {
      const decor = this.chunkDecors.get(`${hex.q},${hex.r}`)
      if (decor) {
        let cx = 0
        let cy = 0
        for (const p of poly) {
          cx += p.x
          cy += p.y
        }
        cx /= poly.length
        cy /= poly.length
        const expanded = poly.map((corner) => {
          const dx = corner.x - cx
          const dy = corner.y - cy
          const len = Math.hypot(dx, dy) || 1
          return {
            x: corner.x + (dx / len) * 2,
            y: corner.y + (dy / len) * 2,
          }
        })
        addChunkMaskedTerrain(cell, expanded, decor)
      } else {
        const g = new Graphics()
        g.poly(poly)
        g.fill({ color: parseCssHexColor(base.color) })
        cell.addChild(g)
      }
    } else {
      const g = new Graphics()
      g.poly(poly)
      g.fill({ color: parseCssHexColor(base.color) })
      cell.addChild(g)
    }

    if (this.wedgesEnabled()) {
      const wedges = wedgesForHex(
        catalog,
        hex,
        this.offsetX,
        this.offsetY,
        hex.q,
        hex.r,
        (nq, nr) => {
          const nHex = this.grid.getHex({ q: nq, r: nr })
          if (!nHex) {
            return null
          }
          return hexCenter(nHex, this.offsetX, this.offsetY)
        },
      )
      for (const wedge of wedges) {
        if (this.useTerrainImages) {
          if (wedge.fromBuffer) {
            const bufTex =
              this.hexTerrainTextures.get(wedge.terrain.name) ??
              this.hexTerrainTextures.get(
                wedge.terrain.name.replaceAll(' ', '_'),
              )
            if (bufTex) {
              addMaskedTerrainWedge(cell, wedge.points, {
                kind: 'texture',
                texture: bufTex,
                hex,
                offsetX: this.offsetX,
                offsetY: this.offsetY,
              })
              continue
            }
          } else {
            const decor = this.chunkDecors.get(`${wedge.nq},${wedge.nr}`)
            if (decor) {
              addMaskedTerrainWedge(cell, wedge.points, {
                kind: 'chunk',
                decor,
              })
              continue
            }
          }
        }
        addMaskedTerrainWedge(cell, wedge.points, {
          kind: 'color',
          color: parseCssHexColor(wedge.terrain.color),
        })
      }
    }

    parent.addChild(cell)

    if (this.showHexOutlines) {
      const stroke = new Graphics()
      stroke.poly(poly)
      stroke.stroke({ width: 1.5, color: 0x111111 })
      parent.addChild(stroke)
    }
  }

  private paintChunkFog(bucket: ChunkBucket) {
    const g = bucket.fogGfx
    g.clear()
    for (const cell of bucket.cells) {
      if (isExplored(cell.q, cell.r)) {
        continue
      }
      g.poly(
        cell.hex.corners.map((corner) => ({
          x: corner.x + this.offsetX,
          y: corner.y + this.offsetY,
        })),
      )
      g.fill({ color: UNEXPLORED_COLOR })
      g.stroke({ width: 1.5, color: 0x2a2a2a })
    }
  }

  /** Add prop sprites for newly explored hexes (skip if already present). */
  async addPropsForHexes(
    hexes: readonly Axial[],
    loadProp: (
      file: string,
      variant: number,
    ) => Promise<Texture | null>,
    _addSprite: (
      parent: Container,
      texture: Texture,
      x: number,
      y: number,
      hexW: number,
      hexH: number,
    ) => Sprite,
  ) {
    void _addSprite
    const jobs: Array<{
      key: string
      q: number
      r: number
      file: string
      variant: number
      flipped: boolean
      propId: number | null
      hex: Hex
    }> = []
    for (const { q, r } of hexes) {
      const key = hexKey(q, r)
      if (this.propByHex.has(key)) {
        continue
      }
      const tile = getTile(q, r)
      if (!tile?.propFile) {
        continue
      }
      const hex = this.grid.getHex({ q, r })
      if (!hex) {
        continue
      }
      jobs.push({
        key,
        q,
        r,
        file: tile.propFile,
        variant: tile.propVariant ?? 1,
        flipped: tile.propFlipped === true,
        propId: tile.propId ?? null,
        hex,
      })
    }
    await Promise.all(
      jobs.map(async (job) => {
        const texture = await loadProp(job.file, job.variant)
        if (!texture || this.propByHex.has(job.key)) {
          return
        }
        const center = hexCenter(job.hex, this.offsetX, this.offsetY)
        const tile = getTile(job.q, job.r)
        const row = propRowById(this.getCatalog(), job.propId)
        const renderScale =
          tile?.propRenderScale ??
          row?.render_scale ??
          1
        const sprite = new Sprite()
        this.propLayer.addChild(sprite)
        const cull = layoutWorldMapPropSprite(
          sprite,
          texture,
          center.x,
          center.y,
          job.hex.width,
          job.hex.height,
          {
            renderScale,
            wall: row?.wall === true,
            mapSeed: this.seed,
            q: job.q,
            r: job.r,
            flipped: job.flipped,
          },
        )
        this.propByHex.set(job.key, sprite)
        this.propCullByHex.set(job.key, cull)
      }),
    )
    this.syncPropDrawOrder()
  }

  /** Lower on screen (larger y) draws in front — props and feature views together. */
  syncMapArtDepth(
    featureViews: Array<{ container: Container; sortY: number }>,
  ) {
    for (const sprite of this.propByHex.values()) {
      sprite.zIndex = Math.round(sprite.y * 1000)
    }
    for (const { container, sortY } of featureViews) {
      container.zIndex = Math.round(sortY * 1000)
    }
    this.propLayer.sortChildren()
  }

  /** @deprecated internal — use {@link syncMapArtDepth} from the map after feature layout. */
  private syncPropDrawOrder() {
    this.syncMapArtDepth([])
  }

  /** Axis-aligned cull in world space (same margins as props / chunks). */
  cullWorldBox(
    box: PropCullBox,
    cameraX: number,
    cameraY: number,
    viewW: number,
    viewH: number,
  ): boolean {
    const left = cameraX - CULL_MARGIN_PX
    const top = cameraY - CULL_MARGIN_PX
    const right = cameraX + viewW + CULL_MARGIN_PX
    const bottom = cameraY + viewH + CULL_MARGIN_PX
    const { cullX: cx, cullY: cy, cullMargin: margin } = box
    return (
      cx + margin >= left &&
      cx - margin <= right &&
      cy + margin >= top &&
      cy - margin <= bottom
    )
  }

  /** Full prop resync (hotseat / remount). */
  async rebuildAllProps(
    loadProp: (
      file: string,
      variant: number,
    ) => Promise<Texture | null>,
    addSprite: (
      parent: Container,
      texture: Texture,
      x: number,
      y: number,
      hexW: number,
      hexH: number,
    ) => Sprite,
  ) {
    this.propByHex.clear()
    this.propCullByHex.clear()
    for (const child of this.propLayer.removeChildren()) {
      child.destroy({ children: true })
    }
    const hexes: Axial[] = []
    forEachTile((q, r) => {
      if (isExplored(q, r)) {
        hexes.push({ q, r })
      }
    })
    await this.addPropsForHexes(hexes, loadProp, addSprite)
  }

  /**
   * Viewport cull for baked chunks, fog, and props.
   * Callers should also cull feature/town/hero/mob views via
   * {@link cullWorldPoint}.
   */
  updateCull(
    cameraX: number,
    cameraY: number,
    viewW: number,
    viewH: number,
  ) {
    const left = cameraX - CULL_MARGIN_PX
    const top = cameraY - CULL_MARGIN_PX
    const right = cameraX + viewW + CULL_MARGIN_PX
    const bottom = cameraY + viewH + CULL_MARGIN_PX
    let visibleChunks = 0
    for (const bucket of this.buckets.values()) {
      const on =
        bucket.maxX >= left &&
        bucket.minX <= right &&
        bucket.maxY >= top &&
        bucket.minY <= bottom
      if (on) {
        visibleChunks += 1
      }
      if (bucket.terrainSprite) {
        bucket.terrainSprite.visible = on
        bucket.terrainSprite.renderable = on
      }
      bucket.fogGfx.visible = on
      bucket.fogGfx.renderable = on
    }
    for (const [key, sprite] of this.propByHex) {
      const cull = this.propCullByHex.get(key)
      const cx = cull?.cullX ?? sprite.x
      const cy = cull?.cullY ?? sprite.y
      const margin =
        cull?.cullMargin ?? this.hexSize * 1.5
      const on =
        cx + margin >= left &&
        cx - margin <= right &&
        cy + margin >= top &&
        cy - margin <= bottom
      sprite.visible = on
      sprite.renderable = on
    }
    return visibleChunks
  }

  /** Point-in-viewport test (margin included) for markers / features. */
  cullWorldPoint(
    worldX: number,
    worldY: number,
    cameraX: number,
    cameraY: number,
    viewW: number,
    viewH: number,
  ): boolean {
    const left = cameraX - CULL_MARGIN_PX
    const top = cameraY - CULL_MARGIN_PX
    const right = cameraX + viewW + CULL_MARGIN_PX
    const bottom = cameraY + viewH + CULL_MARGIN_PX
    return worldX >= left && worldX <= right && worldY >= top && worldY <= bottom
  }

  noteFrame(deltaMS: number) {
    this.frameMs = deltaMS
    this.avgFrameMs = this.avgFrameMs * 0.9 + deltaMS * 0.1
    this.fps = deltaMS > 0 ? 1000 / this.avgFrameMs : 0
  }

  stats(worldRoot: Container): WorldRenderStats {
    const counts = countDisplayTree(worldRoot)
    let baked = 0
    let visibleChunks = 0
    for (const bucket of this.buckets.values()) {
      if (bucket.terrainSprite) {
        baked += 1
        if (bucket.terrainSprite.visible && bucket.terrainSprite.renderable) {
          visibleChunks += 1
        }
      }
    }
    return {
      fps: this.fps,
      frameMs: this.frameMs,
      avgFrameMs: this.avgFrameMs,
      lastRepaintMs: this.lastRepaintMs,
      displayObjectsTotal: counts.total,
      displayObjectsVisible: counts.visible,
      exploredHexes: this.exploredCount,
      bakedChunks: baked,
      visibleChunks,
      chunkSize: RENDER_CHUNK_SIZE,
    }
  }

  destroy() {
    for (const bucket of this.buckets.values()) {
      this.clearChunkTerrain(bucket)
      bucket.fogGfx.destroy()
    }
    this.buckets.clear()
    this.propByHex.clear()
    this.propCullByHex.clear()
    this.chunkDecors.clear()
  }
}

/** Module-level latest stats for the Debug panel (updated by HexMap ticker). */
let latestStats: WorldRenderStats | null = null

export function setWorldRenderStats(stats: WorldRenderStats | null) {
  latestStats = stats
}

export function getWorldRenderStats(): WorldRenderStats | null {
  return latestStats
}
