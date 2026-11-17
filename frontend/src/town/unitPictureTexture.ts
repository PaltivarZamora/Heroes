import type { Texture } from 'pixi.js'
import { loadTextureUrl } from '../hex/terrainTextures'
import type { UnitStaticArtCandidate } from './unitArtFallback'

export type UnitPictureResolved = {
  kind: 'texture'
  texture: Texture
  url: string
  borrowedGlow: boolean
}

const resolvedByUnitId = new Map<number, UnitPictureResolved>()
const inflightByUnitId = new Map<number, Promise<UnitPictureResolved | null>>()
/** Skip repeated full resolve passes after all candidates failed (Pixi / map only). */
const resolveExhaustedUnitIds = new Set<number>()

export function unitPictureResolved(
  unitId: number,
): UnitPictureResolved | undefined {
  return resolvedByUnitId.get(unitId)
}

export function isUnitPictureUrlKnownFailed(url: string): boolean {
  const key = url.trim()
  return key !== '' && failedUrls.has(key)
}

const failedUrls = new Set<string>()

/** Session-only; hard refresh clears. */
export function markUnitPictureUrlFailed(url: string): void {
  const key = url.trim()
  if (key) {
    failedUrls.add(key)
  }
}

async function tryLoadUnitPictureUrl(url: string): Promise<Texture | null> {
  const key = url.trim()
  if (!key || failedUrls.has(key)) {
    return null
  }
  const texture = await loadTextureUrl(key)
  if (texture) {
    return texture
  }
  failedUrls.add(key)
  return null
}

/** One successful resolve per unit id per session; failures are not cached on the unit. */
export function resolveUnitPictureTexture(
  unitId: number,
  candidates: readonly UnitStaticArtCandidate[],
): Promise<UnitPictureResolved | null> {
  if (candidates.length === 0) {
    return Promise.resolve(null)
  }
  if (resolveExhaustedUnitIds.has(unitId)) {
    return Promise.resolve(null)
  }
  const cached = resolvedByUnitId.get(unitId)
  if (cached) {
    return Promise.resolve(cached)
  }
  const inflight = inflightByUnitId.get(unitId)
  if (inflight) {
    return inflight
  }
  const loadable = candidates.filter(
    (c) => !isUnitPictureUrlKnownFailed(c.url),
  )
  if (loadable.length === 0) {
    resolveExhaustedUnitIds.add(unitId)
    return Promise.resolve(null)
  }
  const promise = (async (): Promise<UnitPictureResolved | null> => {
    for (const candidate of loadable) {
      const texture = await tryLoadUnitPictureUrl(candidate.url)
      if (texture) {
        const result: UnitPictureResolved = {
          kind: 'texture',
          texture,
          url: candidate.url,
          borrowedGlow: candidate.glow,
        }
        resolvedByUnitId.set(unitId, result)
        resolveExhaustedUnitIds.delete(unitId)
        return result
      }
    }
    resolveExhaustedUnitIds.add(unitId)
    return null
  })()
  inflightByUnitId.set(unitId, promise)
  return promise.finally(() => {
    inflightByUnitId.delete(unitId)
  })
}
