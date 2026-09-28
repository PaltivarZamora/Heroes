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
    // Avoid HEAD-only checks: Vite SPA fallback returns 200 text/html for
    // missing files (e.g. Rope.png), which would otherwise look "ok".
    const response = await fetch(url)
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok || !contentType.toLowerCase().startsWith('image/')) {
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
 * bottom-center anchor grounded slightly below the hex.
 * Multi-hex footprints stretch to fill the box (gangplank 3x1, etc.);
 * 1×1 keeps uniform contain so single-hex props are unchanged.
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
  const groundY = by + hexHeight * 0.22
  sprite.texture = texture
  sprite.anchor.set(0.5, 0.92)
  sprite.position.set(bx, groundY)
  if (pts.length > 1) {
    // Span the full footprint (e.g. 3x1 gangplank across deck–water–deck).
    sprite.scale.set(boxW / tw, boxH / th)
  } else {
    const scale = Math.min(boxW / tw, boxH / th)
    sprite.scale.set(scale)
  }
}

/** Deterministic [0, 1) from map seed + hex + salt (world prop jitter). */
export function propVisualUnit01(
  mapSeed: number,
  q: number,
  r: number,
  salt: string,
): number {
  let h = (mapSeed | 0) ^ Math.imul(q | 0, 0x9e3779b1) ^ Math.imul(r | 0, 0x85ebca6b)
  for (let i = 0; i < salt.length; i++) {
    h = Math.imul(h ^ salt.charCodeAt(i), 0x5bd1e995)
  }
  h ^= h >>> 13
  h = Math.imul(h, 0x5bd1e995)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

export type WorldPropVisualOpts = {
  renderScale: number
  wall: boolean
  mapSeed: number
  q: number
  r: number
  flipped: boolean
}

/** Visual-only scale + x shift (blocking unchanged). Call after base layout, before flip. */
export function applyWorldPropVisual(
  sprite: Sprite,
  opts: Omit<WorldPropVisualOpts, 'flipped'> & { hexWidth: number },
): void {
  let scaleMult = opts.renderScale > 0 ? opts.renderScale : 1
  let dx = 0
  if (opts.wall) {
    const uScale = propVisualUnit01(opts.mapSeed, opts.q, opts.r, 'wall-prop-scale')
    const uX = propVisualUnit01(opts.mapSeed, opts.q, opts.r, 'wall-prop-x')
    scaleMult *= 1 + (uScale * 2 - 1) * 0.08
    dx = (uX * 2 - 1) * 0.1 * opts.hexWidth
  }
  sprite.scale.x *= scaleMult
  sprite.scale.y *= scaleMult
  sprite.x += dx
}

export type PropCullBox = { cullX: number; cullY: number; cullMargin: number }

/**
 * World-map prop draw order: layout → render_scale → wall jitter → flip (last).
 */
export function layoutWorldMapPropSprite(
  sprite: Sprite,
  texture: Texture,
  cx: number,
  cy: number,
  hexWidth: number,
  hexHeight: number,
  opts: WorldPropVisualOpts,
): PropCullBox {
  layoutHexFootprintSprite(
    sprite,
    texture,
    [{ x: cx, y: cy }],
    [{ x: cx, y: cy }],
    hexWidth,
    hexHeight,
  )
  applyWorldPropVisual(sprite, { ...opts, hexWidth })
  if (opts.flipped) {
    sprite.scale.x = -Math.abs(sprite.scale.x)
  }
  const jitterScale = opts.wall ? 1.08 : 1
  const margin = hexWidth * (opts.renderScale > 0 ? opts.renderScale : 1) * jitterScale * 1.5
  return { cullX: sprite.x, cullY: sprite.y, cullMargin: margin }
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

/** Visual-only scale for world-map features (no jitter). After base layout, before flip. */
export function applyWorldFeatureRenderScale(
  sprite: Sprite,
  renderScale: number,
): void {
  const mult = renderScale > 0 ? renderScale : 1
  sprite.scale.x *= mult
  sprite.scale.y *= mult
}

export function worldMapFeatureCullMargin(
  hexWidth: number,
  renderScale: number,
  sizeFactor = 1,
): number {
  return hexWidth * (renderScale > 0 ? renderScale : 1) * sizeFactor * 1.5
}

/**
 * World-map feature draw order: layout (incl. kind tweaks) → render_scale → flip.
 * `cullAnchorWorld` is the grounded anchor in world space (not getBounds()).
 */
export function finishWorldMapFeatureSprite(
  sprite: Sprite,
  renderScale: number,
  flipped: boolean,
  cullAnchorWorld: { x: number; y: number },
  hexWidth: number,
  cullSizeFactor = 1,
): PropCullBox {
  applyWorldFeatureRenderScale(sprite, renderScale)
  if (flipped) {
    sprite.scale.x = -Math.abs(sprite.scale.x)
  }
  return {
    cullX: cullAnchorWorld.x,
    cullY: cullAnchorWorld.y,
    cullMargin: worldMapFeatureCullMargin(hexWidth, renderScale, cullSizeFactor),
  }
}
