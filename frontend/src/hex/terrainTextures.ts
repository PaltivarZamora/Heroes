import { Assets, Graphics, Sprite, Texture, type Container } from 'pixi.js'
import type { Hex } from 'honeycomb-grid'
import type { TerrainTypeRow } from '../town/catalog'

/** Slot 1 / 2 / 3 — renormalized among files that actually exist. */
const VARIANT_WEIGHTS = [50, 35, 15] as const

export type TerrainTextureVariant = {
  texture: Texture
  weight: number
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

function typesKey(types: readonly TerrainTypeRow[]): string {
  return `v2|${types.map((row) => `${row.name}:${row.variants}`).join('|')}`
}

/** Load `{name}_1.png` … `{name}_{variants}.png` for each catalog row. */
export function loadAllTerrainTextures(
  types: readonly TerrainTypeRow[] = [],
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
        const variants = await loadTerrainTextureVariants(row.name, row.variants)
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

/** Grow the mask slightly so adjacent textures meet without a dark hairline. */
const MASK_EXPAND_PX = 2

/** Uniform scale to cover the hex bounds, then crop with a hex mask. */
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
