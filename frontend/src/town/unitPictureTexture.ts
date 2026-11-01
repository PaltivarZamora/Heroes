import type { Texture } from 'pixi.js'
import { loadTextureUrl } from '../hex/terrainTextures'
import type { UnitStaticArtCandidate } from './unitArtFallback'

export type UnitPictureResolved =
  | { kind: 'texture'; texture: Texture; url: string; borrowedGlow: boolean }
  | { kind: 'none' }

const failedUrls = new Set<string>()
const resolvedByUnitId = new Map<number, UnitPictureResolved>()
const inflightByUnitId = new Map<number, Promise<UnitPictureResolved>>()

export function unitPictureResolved(
  unitId: number,
): UnitPictureResolved | undefined {
  return resolvedByUnitId.get(unitId)
}

export function isUnitPictureUrlKnownFailed(url: string): boolean {
  const key = url.trim()
  return key !== '' && failedUrls.has(key)
}

/** Session-only; hard refresh clears. */
export function markUnitPictureUrlFailed(url: string): void {
  const key = url.trim()
  if (key) {
    failedUrls.add(key)
  }
}

export function markUnitPictureNone(unitId: number): void {
  if (!resolvedByUnitId.has(unitId)) {
    resolvedByUnitId.set(unitId, { kind: 'none' })
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

/** One resolve per unit id per session; skips remembered bad URLs. */
export function resolveUnitPictureTexture(
  unitId: number,
  candidates: readonly UnitStaticArtCandidate[],
): Promise<UnitPictureResolved> {
  const cached = resolvedByUnitId.get(unitId)
  if (cached) {
    return Promise.resolve(cached)
  }
  const inflight = inflightByUnitId.get(unitId)
  if (inflight) {
    return inflight
  }
  const promise = (async (): Promise<UnitPictureResolved> => {
    if (candidates.length === 0) {
      const none: UnitPictureResolved = { kind: 'none' }
      resolvedByUnitId.set(unitId, none)
      return none
    }
    for (const candidate of candidates) {
      if (isUnitPictureUrlKnownFailed(candidate.url)) {
        continue
      }
      const texture = await tryLoadUnitPictureUrl(candidate.url)
      if (texture) {
        const result: UnitPictureResolved = {
          kind: 'texture',
          texture,
          url: candidate.url,
          borrowedGlow: candidate.glow,
        }
        resolvedByUnitId.set(unitId, result)
        return result
      }
    }
    const none: UnitPictureResolved = { kind: 'none' }
    resolvedByUnitId.set(unitId, none)
    return none
  })()
  inflightByUnitId.set(unitId, promise)
  return promise.finally(() => {
    inflightByUnitId.delete(unitId)
  })
}
