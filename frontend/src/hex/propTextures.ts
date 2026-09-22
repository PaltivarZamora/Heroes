import { Assets, Sprite, Texture, type Container } from 'pixi.js'

const propTextureCache = new Map<string, Texture | null>()
const propLoadInflight = new Map<string, Promise<Texture | null>>()

function propUrls(fileName: string, variant: number): string[] {
  const base = fileName
    .trim()
    .replace(/\.png$/i, '')
    .replaceAll(' ', '_')
  if (!base) {
    return []
  }
  const n = Math.max(1, Math.floor(variant))
  return [
    `/assets/props/${base}_${n}.png`,
    `/assets/props/${base}.png`,
    `/assets/props/${base.replaceAll('_', ' ')}_${n}.png`,
    `/assets/props/${base.replaceAll('_', ' ')}.png`,
  ]
}

async function tryLoad(url: string): Promise<Texture | null> {
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

/** Resolve `{file}_{variant}.png` then `{file}.png` under `/assets/props/`. */
export async function loadPropTexture(
  fileName: string | null | undefined,
  variant: number | null | undefined,
): Promise<Texture | null> {
  if (!fileName || !fileName.trim()) {
    return null
  }
  const v = variant != null && variant > 0 ? Math.floor(variant) : 1
  const cacheKey = `${fileName.trim().toLowerCase()}#${v}`
  if (propTextureCache.has(cacheKey)) {
    return propTextureCache.get(cacheKey) ?? null
  }
  const inflight = propLoadInflight.get(cacheKey)
  if (inflight) {
    return inflight
  }
  const promise = (async () => {
    for (const url of propUrls(fileName, v)) {
      const texture = await tryLoad(url)
      if (texture) {
        propTextureCache.set(cacheKey, texture)
        return texture
      }
    }
    propTextureCache.set(cacheKey, null)
    return null
  })()
  propLoadInflight.set(cacheKey, promise)
  try {
    return await promise
  } finally {
    propLoadInflight.delete(cacheKey)
  }
}

/**
 * Uniform 1-based variant pick for props.
 * Unlike terrain's 50/35/15 weights, every variant is equal — works for any
 * `variant_count` without a fixed weight table.
 */
export function pickPropVariant(
  variantCount: number,
  random: () => number = Math.random,
): number {
  const n = Math.max(1, Math.floor(variantCount))
  return Math.min(n, Math.floor(random() * n) + 1)
}

/** Place a prop on a hex, grounded below center (not mid-float / not tip-pinned). */
export function addPropSprite(
  parent: Container,
  texture: Texture,
  cx: number,
  cy: number,
  hexWidth: number,
  hexHeight: number,
): Sprite {
  return addFootprintPropSprite(
    parent,
    texture,
    [{ x: cx, y: cy }],
    [{ x: cx, y: cy }],
    hexWidth,
    hexHeight,
  )
}

/**
 * One sprite spanning a multi-hex footprint. Anchor = bottom-center of the
 * bottom row (matches unit art grounding).
 */
export function addFootprintPropSprite(
  parent: Container,
  texture: Texture,
  centers: Array<{ x: number; y: number }>,
  bottomCenters: Array<{ x: number; y: number }>,
  hexWidth: number,
  hexHeight: number,
): Sprite {
  const sprite = new Sprite()
  layoutHexFootprintSprite(
    sprite,
    texture,
    centers,
    bottomCenters,
    hexWidth,
    hexHeight,
  )
  parent.addChild(sprite)
  return sprite
}

/**
 * Fit a sprite into a hex footprint the same way world props do:
 * box = max(0.9×hexW, footprintW) × max(0.95×hexH, footprintH),
 * uniform scale, bottom-center anchor grounded slightly below the hex.
 */
export function layoutHexFootprintSprite(
  sprite: Sprite,
  texture: Texture,
  centers: Array<{ x: number; y: number }>,
  bottomCenters: Array<{ x: number; y: number }>,
  hexWidth: number,
  hexHeight: number,
): void {
  const pts = centers.length > 0 ? centers : [{ x: 0, y: 0 }]
  const bottoms = bottomCenters.length > 0 ? bottomCenters : pts
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const c of pts) {
    minX = Math.min(minX, c.x - hexWidth * 0.5)
    maxX = Math.max(maxX, c.x + hexWidth * 0.5)
    minY = Math.min(minY, c.y - hexHeight * 0.5)
    maxY = Math.max(maxY, c.y + hexHeight * 0.5)
  }
  const boxW = Math.max(hexWidth * 0.9, maxX - minX)
  const boxH = Math.max(hexHeight * 0.95, maxY - minY)
  let bx = 0
  let by = -Infinity
  for (const c of bottoms) {
    bx += c.x
    by = Math.max(by, c.y)
  }
  bx /= bottoms.length
  const tw = Math.max(1, texture.width)
  const th = Math.max(1, texture.height)
  const scale = Math.min(boxW / tw, boxH / th)
  const groundY = by + hexHeight * 0.22
  sprite.texture = texture
  sprite.anchor.set(0.5, 0.92)
  sprite.position.set(bx, groundY)
  sprite.scale.set(scale)
}

/** 1×1 hex fit — same constants as {@link addPropSprite}. */
export function layoutHexSprite(
  sprite: Sprite,
  texture: Texture,
  cx: number,
  cy: number,
  hexWidth: number,
  hexHeight: number,
): void {
  layoutHexFootprintSprite(
    sprite,
    texture,
    [{ x: cx, y: cy }],
    [{ x: cx, y: cy }],
    hexWidth,
    hexHeight,
  )
}
