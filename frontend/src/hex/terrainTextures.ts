import { Assets, Graphics, Sprite, Texture, type Container } from 'pixi.js'
import type { Hex } from 'honeycomb-grid'
import type { TerrainType } from './types'
import { TERRAIN_COLORS } from './world'

/** Slot 1 / 2 / 3 — renormalized among files that actually exist. */
const VARIANT_WEIGHTS = [50, 35, 15] as const
const MAX_VARIANTS = 3

export type TerrainTextureVariant = {
  texture: Texture
  weight: number
}

function terrainTextureUrl(terrain: string, n: number): string {
  return `/assets/terrain/${terrain.replaceAll(' ', '_')}_${n}.png`
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

async function tryLoadTexture(url: string): Promise<Texture | null> {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok || !contentType.startsWith('image/')) {
      return null
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
): Promise<TerrainTextureVariant[] | null> {
  const loaded: TerrainTextureVariant[] = []
  for (let n = 1; n <= MAX_VARIANTS; n++) {
    const texture = await tryLoadTexture(terrainTextureUrl(terrain, n))
    if (!texture) {
      continue
    }
    loaded.push({ texture, weight: VARIANT_WEIGHTS[n - 1] })
  }
  return loaded.length > 0 ? loaded : null
}

let cachedByTerrain: Map<TerrainType, TerrainTextureVariant[]> | null = null
let loadAllPromise: Promise<Map<TerrainType, TerrainTextureVariant[]>> | null =
  null

/** Probe every terrain type; types with no PNGs are omitted (solid-color fallback). */
export function loadAllTerrainTextures(): Promise<
  Map<TerrainType, TerrainTextureVariant[]>
> {
  if (cachedByTerrain) {
    return Promise.resolve(cachedByTerrain)
  }
  if (!loadAllPromise) {
    loadAllPromise = (async () => {
      const byTerrain = new Map<TerrainType, TerrainTextureVariant[]>()
      await Promise.all(
        (Object.keys(TERRAIN_COLORS) as TerrainType[]).map(async (terrain) => {
          const variants = await loadTerrainTextureVariants(terrain)
          if (variants) {
            byTerrain.set(terrain, variants)
          }
        }),
      )
      cachedByTerrain = byTerrain
      return byTerrain
    })()
  }
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
