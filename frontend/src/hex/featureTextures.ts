import { Assets, Texture } from 'pixi.js'

const featureTextureCache = new Map<string, Texture | null>()
const featureLoadInflight = new Map<string, Promise<Texture | null>>()

function normalizeFeatureBase(fileName: string): string {
  return fileName
    .trim()
    .replace(/\.png$/i, '')
    .replaceAll(' ', '_')
}

/** Prefer the exact catalog filename; then bare / variant fallbacks. */
function featureUrls(fileName: string, variant: number): string[] {
  const trimmed = fileName.trim()
  if (!trimmed) {
    return []
  }
  const base = normalizeFeatureBase(trimmed)
  if (!base) {
    return []
  }
  const n = Math.max(1, Math.floor(variant))
  const spaced = base.replaceAll('_', ' ')
  const urls = [
    // Exact path from feature.image_path (e.g. Gold_Node.png)
    trimmed.startsWith('/')
      ? trimmed
      : `/assets/features/${trimmed.replace(/^\/+/, '')}`,
    `/assets/features/${base}.png`,
    `/assets/features/${base}_${n}.png`,
    `/assets/features/${spaced}.png`,
    `/assets/features/${spaced}_${n}.png`,
  ]
  return [...new Set(urls)]
}

async function tryLoad(url: string): Promise<Texture | null> {
  try {
    // Avoid HEAD-only checks: Vite SPA fallback returns 200 text/html for
    // missing files, which looks "ok" until we inspect content-type / decode.
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

/**
 * Load under `/assets/features/`. Tries `image_path` as-is, then bare / variant
 * names (prop-style fallback; features currently have one file per row).
 */
export async function loadFeatureTexture(
  fileName: string | null | undefined,
  variant: number | null | undefined = 1,
): Promise<Texture | null> {
  if (!fileName || !fileName.trim()) {
    return null
  }
  const v = variant != null && variant > 0 ? Math.floor(variant) : 1
  const cacheKey = `${fileName.trim().toLowerCase()}#${v}`
  if (featureTextureCache.has(cacheKey)) {
    return featureTextureCache.get(cacheKey) ?? null
  }
  const inflight = featureLoadInflight.get(cacheKey)
  if (inflight) {
    return inflight
  }
  const promise = (async () => {
    for (const url of featureUrls(fileName, v)) {
      const texture = await tryLoad(url)
      if (texture) {
        featureTextureCache.set(cacheKey, texture)
        return texture
      }
    }
    featureTextureCache.set(cacheKey, null)
    return null
  })()
  featureLoadInflight.set(cacheKey, promise)
  try {
    return await promise
  } finally {
    featureLoadInflight.delete(cacheKey)
  }
}

/**
 * Load primary path, then optional fallbacks (e.g. Loose → Node while
 * `{Resource}.png` assets are still landing).
 */
export async function loadFeatureTextureWithFallback(
  primary: string | null | undefined,
  fallbacks: readonly string[] = [],
): Promise<Texture | null> {
  const seen = new Set<string>()
  const candidates = [primary, ...fallbacks].filter((name): name is string => {
    if (!name || !name.trim()) {
      return false
    }
    const key = name.trim().toLowerCase()
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
  for (const name of candidates) {
    const texture = await loadFeatureTexture(name)
    if (texture) {
      return texture
    }
  }
  return null
}

/** Public URL for UI `<img>` tags (resource bar, etc.). */
export function featureArtUrl(fileName: string | null | undefined): string | null {
  if (!fileName || !fileName.trim()) {
    return null
  }
  const file = fileName
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
  const slash = file.lastIndexOf('/')
  const base = slash >= 0 ? file.slice(slash + 1) : file
  if (!base) {
    return null
  }
  return `/assets/features/${base}`
}
