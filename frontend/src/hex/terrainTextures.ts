import { Assets, Graphics, Rectangle, Sprite, Texture, type Container } from 'pixi.js'
import type { Hex } from 'honeycomb-grid'

/** Slot 1 / 2 / 3 — renormalized among files that actually exist. */
const VARIANT_WEIGHTS = [50, 35, 15] as const

/** Axial neighbors — same set as pathfinding / terrain wedges. */
const AXIAL_NEIGHBORS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
] as const

export type TerrainTextureVariant = {
  texture: Texture
  weight: number
}

/**
 * One continuous photo placement for a connected terrain chunk.
 * Every hex in the chunk draws this same sprite (world x/y/scale) through its
 * own hex/wedge mask — stencil grid over one image, not per-hex crops.
 */
export type ChunkTextureDecor = {
  texture: Texture
  x: number
  y: number
  scaleX: number
  scaleY: number
  /** Pixel footprint covered (for diagnostics). */
  boundsW: number
  boundsH: number
  sourceW: number
  sourceH: number
}

function terrainTextureUrl(terrain: string, n: number): string {
  return `/assets/terrain/${terrain.replaceAll(' ', '_')}_${n}.png`
}

function isMoatTerrainName(terrain: string): boolean {
  return terrain.replaceAll(' ', '_').toLowerCase() === 'moat'
}

function u32(n: number): number {
  return n >>> 0
}

/** Grow the mask slightly so adjacent textures meet without a dark hairline. */
const MASK_EXPAND_PX = 2

/** Deterministic [0, 1) from the map seed and axial coords — not Math.random(). */
function hexUnit(seed: number, q: number, r: number): number {
  let h = u32(
    Math.imul(seed, 0x9e3779b1) ^
      Math.imul(q + 0x7f4a7c15, 0x85ebca6b) ^
      Math.imul(r + 0x165667b1, 0xc2b2ae35),
  )
  h = u32((h ^ (h >>> 16)) * 0x7feb352d)
  h = u32((h ^ (h >>> 15)) * 0x846ca68b)
  h = u32(h ^ (h >>> 16))
  return h / 4294967296
}

function coordKey(q: number, r: number): string {
  return `${q},${r}`
}

/**
 * Crop a window from `source` sized to the chunk's pixel footprint (clamped to
 * the image). Crop origin is deterministic from the chunk's seed key
 * (min q,r of the component), not per-hex. Orientation is never flipped or
 * rotated — 3rd-person terrain art must stay as authored.
 */
function chunkSampleTexture(
  source: Texture,
  boundsW: number,
  boundsH: number,
  seed: number,
  idQ: number,
  idR: number,
): { texture: Texture; sourceW: number; sourceH: number } {
  const tw = Math.max(1, Math.floor(source.width))
  const th = Math.max(1, Math.floor(source.height))
  const cropW = Math.min(tw, Math.max(1, Math.ceil(boundsW)))
  const cropH = Math.min(th, Math.max(1, Math.ceil(boundsH)))
  const maxOx = tw - cropW
  const maxOy = th - cropH
  const ox =
    maxOx <= 0
      ? 0
      : Math.min(maxOx, Math.floor(hexUnit(seed, idQ, idR) * (maxOx + 1)))
  const oy =
    maxOy <= 0
      ? 0
      : Math.min(
          maxOy,
          Math.floor(hexUnit(seed ^ 0xa511e9b3, idQ, idR) * (maxOy + 1)),
        )
  if (cropW >= tw && cropH >= th) {
    return { texture: source, sourceW: tw, sourceH: th }
  }
  return {
    texture: new Texture({
      source: source.source,
      frame: new Rectangle(ox, oy, cropW, cropH),
    }),
    sourceW: tw,
    sourceH: th,
  }
}

/**
 * Build one world-locked texture decor per generation chunk.
 * Prefers {@code chunkIdAt} (from map gen). Falls back to flood-fill of
 * connected same-terrain cells when chunk ids are absent.
 */
export function buildTerrainChunkDecors(
  members: ReadonlyArray<{ q: number; r: number; hex: Hex }>,
  terrainAt: (q: number, r: number) => string | null,
  chunkIdAt: (q: number, r: number) => number | null,
  textureFor: (terrain: string) => Texture | undefined,
  offsetX: number,
  offsetY: number,
  seed: number,
): Map<string, ChunkTextureDecor> {
  const byHex = new Map<string, ChunkTextureDecor>()
  const groups = new Map<string, Array<{ q: number; r: number; hex: Hex; terrain: string }>>()

  const hasChunkIds = members.some((m) => chunkIdAt(m.q, m.r) != null)
  if (hasChunkIds) {
    for (const m of members) {
      const terrain = terrainAt(m.q, m.r)
      const chunkId = chunkIdAt(m.q, m.r)
      if (!terrain || chunkId == null) {
        continue
      }
      const gk = `${terrain}#${chunkId}`
      const list = groups.get(gk) ?? []
      list.push({ ...m, terrain })
      groups.set(gk, list)
    }
  } else {
    // Legacy fallback: flood-fill connected same-terrain regions.
    const visited = new Set<string>()
    const terrainByKey = new Map<string, string>()
    const hexByKey = new Map<string, Hex>()
    for (const m of members) {
      const name = terrainAt(m.q, m.r)
      if (!name) {
        continue
      }
      terrainByKey.set(coordKey(m.q, m.r), name)
      hexByKey.set(coordKey(m.q, m.r), m.hex)
    }
    for (const m of members) {
      const startKey = coordKey(m.q, m.r)
      if (visited.has(startKey)) {
        continue
      }
      const terrain = terrainByKey.get(startKey)
      if (!terrain) {
        continue
      }
      const component: Array<{ q: number; r: number; hex: Hex; terrain: string }> =
        []
      const queue = [{ q: m.q, r: m.r }]
      visited.add(startKey)
      while (queue.length > 0) {
        const cur = queue.pop()!
        const curHex = hexByKey.get(coordKey(cur.q, cur.r))
        if (!curHex) {
          continue
        }
        component.push({ q: cur.q, r: cur.r, hex: curHex, terrain })
        for (const d of AXIAL_NEIGHBORS) {
          const nq = cur.q + d.q
          const nr = cur.r + d.r
          const nk = coordKey(nq, nr)
          if (visited.has(nk) || terrainByKey.get(nk) !== terrain) {
            continue
          }
          visited.add(nk)
          queue.push({ q: nq, r: nr })
        }
      }
      groups.set(`ff:${startKey}`, component)
    }
  }

  for (const component of groups.values()) {
    const terrain = component[0]?.terrain
    if (!terrain) {
      continue
    }
    const source = textureFor(terrain)
    if (!source) {
      continue
    }

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let idQ = component[0]!.q
    let idR = component[0]!.r
    for (const cell of component) {
      if (cell.q < idQ || (cell.q === idQ && cell.r < idR)) {
        idQ = cell.q
        idR = cell.r
      }
      for (const corner of cell.hex.corners) {
        const x = corner.x + offsetX
        const y = corner.y + offsetY
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
    const boundsW = Math.max(1, maxX - minX)
    const boundsH = Math.max(1, maxY - minY)
    const sampled = chunkSampleTexture(source, boundsW, boundsH, seed, idQ, idR)
    const tw = Math.max(1, sampled.texture.width)
    const th = Math.max(1, sampled.texture.height)
    const cover =
      Math.max(boundsW / tw, boundsH / th) *
      (1 + (MASK_EXPAND_PX * 2) / Math.max(boundsW, 1))
    const decor: ChunkTextureDecor = {
      texture: sampled.texture,
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      scaleX: cover,
      scaleY: cover,
      boundsW,
      boundsH,
      sourceW: sampled.sourceW,
      sourceH: sampled.sourceH,
    }
    if (boundsW > sampled.sourceW * 1.05 || boundsH > sampled.sourceH * 1.05) {
      console.warn(
        `[hex] chunk texture "${terrain}" footprint ${Math.round(boundsW)}×${Math.round(boundsH)} exceeds source ${sampled.sourceW}×${sampled.sourceH} — upscaling`,
      )
    }
    for (const cell of component) {
      byHex.set(coordKey(cell.q, cell.r), decor)
    }
  }
  return byHex
}

/** Draw a world-locked chunk texture through an arbitrary mask polygon. */
export function addChunkMaskedTerrain(
  parent: Container,
  maskPoints: Array<{ x: number; y: number }>,
  decor: ChunkTextureDecor,
): void {
  if (maskPoints.length < 3) {
    return
  }
  const mask = new Graphics()
  mask.poly(maskPoints)
  mask.fill({ color: 0xffffff })
  const sprite = new Sprite({
    texture: decor.texture,
    anchor: 0.5,
    x: decor.x,
    y: decor.y,
  })
  sprite.scale.set(decor.scaleX, decor.scaleY)
  sprite.mask = mask
  parent.addChild(sprite, mask)
}

export function pickTerrainVariantIndex(
  seed: number,
  q: number,
  r: number,
  variants: readonly { weight: number }[],
): number {
  if (variants.length === 0) {
    return 0
  }
  const t = hexUnit(seed, q, r)
  const total = variants.reduce((sum, variant) => sum + variant.weight, 0)
  let acc = 0
  for (let i = 0; i < variants.length; i++) {
    acc += variants[i].weight / total
    if (t < acc) {
      return i
    }
  }
  return variants.length - 1
}

function punchBlackToAlpha(image: HTMLImageElement): Texture | null {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, image.naturalWidth)
  canvas.height = Math.max(1, image.naturalHeight)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return null
  }
  ctx.drawImage(image, 0, 0)
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = pixels.data
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! + data[i + 1]! + data[i + 2]! < 24) {
      data[i + 3] = 0
    }
  }
  ctx.putImageData(pixels, 0, 0)
  return Texture.from(canvas)
}

export function loadTextureUrl(
  url: string,
  punchBlack = false,
): Promise<Texture | null> {
  return tryLoadTexture(url, punchBlack)
}

async function tryLoadTexture(
  url: string,
  punchBlack = false,
): Promise<Texture | null> {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok || !contentType.startsWith('image/')) {
      return null
    }
    if (punchBlack) {
      try {
        const image = new Image()
        image.src = url
        await image.decode()
        const punched = punchBlackToAlpha(image)
        if (punched && punched.width >= 1 && punched.height >= 1) {
          return punched
        }
      } catch {
        // Fall through to a normal load so the file still shows.
      }
    }
    const texture = await Assets.load<Texture>(url)
    if (texture.width < 1 || texture.height < 1) {
      return null
    }
    return texture
  } catch {
    return null
  }
}

async function loadTerrainTextureVariants(
  terrain: string,
  variantCount: number,
): Promise<TerrainTextureVariant[] | null> {
  const max = Math.max(0, Math.min(VARIANT_WEIGHTS.length, Math.trunc(variantCount)))
  const loaded: TerrainTextureVariant[] = []
  const moat = isMoatTerrainName(terrain)
  for (let n = 1; n <= max; n += 1) {
    const urls = [terrainTextureUrl(terrain, n)]
    if (moat) {
      urls.push(terrainTextureUrl('Necropolis_Moat', n))
    }
    let texture: Texture | null = null
    for (const url of urls) {
      texture = await tryLoadTexture(url, moat)
      if (texture) {
        break
      }
    }
    if (!texture) {
      continue
    }
    loaded.push({ texture, weight: VARIANT_WEIGHTS[n - 1]! })
  }
  return loaded.length > 0 ? loaded : null
}

let cachedKey = ''
let cachedByTerrain: Map<string, TerrainTextureVariant[]> | null = null
let loadAllPromise: Promise<Map<string, TerrainTextureVariant[]>> | null = null

/** Minimal row for variant loader — formerly TerrainTypeRow.variants. */
export type TerrainVariantSpec = {
  name: string
  /** How many `{name}_N.png` slots to try (default 1). */
  variants?: number
}

function typesKey(types: readonly TerrainVariantSpec[]): string {
  return `v3|${types.map((row) => `${row.name}:${row.variants ?? 1}`).join('|')}`
}

/** Load `{name}_1.png` … `{name}_{variants}.png` for each spec. */
export function loadAllTerrainTextures(
  types: readonly TerrainVariantSpec[] = [],
): Promise<Map<string, TerrainTextureVariant[]>> {
  const key = typesKey(types)
  if (cachedByTerrain && cachedKey === key) {
    return Promise.resolve(cachedByTerrain)
  }
  if (loadAllPromise && cachedKey === key) {
    return loadAllPromise
  }
  cachedKey = key
  loadAllPromise = (async () => {
    const byTerrain = new Map<string, TerrainTextureVariant[]>()
    await Promise.all(
      types.map(async (row) => {
        const variants = await loadTerrainTextureVariants(
          row.name,
          row.variants ?? 1,
        )
        if (variants) {
          byTerrain.set(row.name, variants)
          const spaced = row.name.replaceAll('_', ' ')
          const underscored = row.name.replaceAll(' ', '_')
          if (spaced !== row.name) {
            byTerrain.set(spaced, variants)
          }
          if (underscored !== row.name) {
            byTerrain.set(underscored, variants)
          }
        }
      }),
    )
    cachedByTerrain = byTerrain
    return byTerrain
  })()
  return loadAllPromise
}

/** Uniform scale to cover the hex bounds, then crop with a hex mask (single-cell). */
export function addMaskedTerrainHex(
  parent: Container,
  hex: Hex,
  offsetX: number,
  offsetY: number,
  texture: Texture,
  fit: 'cover' | 'contain' = 'cover',
): void {
  const corners = hex.corners.map((corner) => ({
    x: corner.x + offsetX,
    y: corner.y + offsetY,
  }))
  let cx = 0
  let cy = 0
  for (const corner of corners) {
    cx += corner.x
    cy += corner.y
  }
  cx /= corners.length
  cy /= corners.length

  const expanded = corners.map((corner) => {
    const dx = corner.x - cx
    const dy = corner.y - cy
    const len = Math.hypot(dx, dy) || 1
    return {
      x: corner.x + (dx / len) * MASK_EXPAND_PX,
      y: corner.y + (dy / len) * MASK_EXPAND_PX,
    }
  })

  const mask = new Graphics()
  mask.poly(expanded)
  mask.fill({ color: 0xffffff })

  const tw = Math.max(1, texture.width)
  const th = Math.max(1, texture.height)
  const scale =
    fit === 'contain'
      ? Math.min(hex.width / tw, hex.height / th)
      : Math.max(hex.width / tw, hex.height / th) *
        (1 + (MASK_EXPAND_PX * 2) / Math.max(hex.width, 1))

  const sprite = new Sprite({
    texture,
    anchor: 0.5,
    x: cx,
    y: cy,
  })
  sprite.scale.set(scale)
  sprite.mask = mask

  parent.addChild(sprite, mask)
}

/**
 * Single reusable wedge: triangle from hex center through one edge.
 * Prefer {@link addChunkMaskedTerrain} for chunk-continuous textures.
 */
export function addMaskedTerrainWedge(
  parent: Container,
  points: Array<{ x: number; y: number }>,
  fill:
    | { kind: 'color'; color: number }
    | { kind: 'chunk'; decor: ChunkTextureDecor }
    | {
        kind: 'texture'
        texture: Texture
        hex: Hex
        offsetX: number
        offsetY: number
      },
): void {
  if (points.length < 3) {
    return
  }

  if (fill.kind === 'color') {
    const g = new Graphics()
    g.poly(points)
    g.fill({ color: fill.color })
    parent.addChild(g)
    return
  }

  if (fill.kind === 'chunk') {
    addChunkMaskedTerrain(parent, points, fill.decor)
    return
  }

  const mask = new Graphics()
  mask.poly(points)
  mask.fill({ color: 0xffffff })

  const { texture, hex, offsetX, offsetY } = fill
  let cx = 0
  let cy = 0
  for (const corner of hex.corners) {
    cx += corner.x + offsetX
    cy += corner.y + offsetY
  }
  cx /= hex.corners.length
  cy /= hex.corners.length

  const tw = Math.max(1, texture.width)
  const th = Math.max(1, texture.height)
  const scale =
    Math.max(hex.width / tw, hex.height / th) *
    (1 + (MASK_EXPAND_PX * 2) / Math.max(hex.width, 1))

  const sprite = new Sprite({
    texture,
    anchor: 0.5,
    x: cx,
    y: cy,
  })
  sprite.scale.set(scale)
  sprite.mask = mask
  parent.addChild(sprite, mask)
}

/** Load textures keyed by terrain.name from terrain.image_path (single file). */
export async function loadHexTerrainTextures(
  rows: readonly { name: string; image_path: string | null }[],
): Promise<Map<string, Texture>> {
  const byName = new Map<string, Texture>()
  await Promise.all(
    rows.map(async (row) => {
      if (!row.image_path) {
        return
      }
      const file = row.image_path.replace(/^\/+/, '')
      const urls = [
        `/assets/terrain/${file}`,
        `/assets/terrain/${file.replaceAll(' ', '_')}`,
      ]
      for (const url of urls) {
        const texture = await tryLoadTexture(url)
        if (texture) {
          byName.set(row.name, texture)
          const spaced = row.name.replaceAll('_', ' ')
          const underscored = row.name.replaceAll(' ', '_')
          if (spaced !== row.name) {
            byName.set(spaced, texture)
          }
          if (underscored !== row.name) {
            byName.set(underscored, texture)
          }
          return
        }
      }
    }),
  )
  return byName
}
