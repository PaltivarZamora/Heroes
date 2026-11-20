/** Vite dev SPA fallback: missing static files often return 200 text/html. */

export const ASSET_NOT_FOUND_REASON = 'not found'

export function contentTypeIsHtml(contentType: string): boolean {
  return contentType.toLowerCase().includes('text/html')
}

/** Treat dev index HTML and HTTP 404 like a missing optional asset. */
export function isOptionalAssetNotFound(response: Response): boolean {
  if (!response.ok) {
    return response.status === 404
  }
  const contentType = response.headers.get('content-type') ?? ''
  return contentTypeIsHtml(contentType)
}

export function isSilentAssetLoadFail(reason: string): boolean {
  return reason === ASSET_NOT_FOUND_REASON || reason === 'HTTP 404'
}

export function optionalAssetNotFoundFail(url: string): { url: string; reason: string } {
  return { url, reason: ASSET_NOT_FOUND_REASON }
}

/** HTTP 200 (etc.) that is not dev SPA HTML — optional JSON/PNG/asset exists for load. */
export function isOptionalAssetPresent(response: Response): boolean {
  if (isOptionalAssetNotFound(response)) {
    return false
  }
  return response.ok
}

/** GET check before Pixi load so SPA HTML is not parsed as an image. */
export async function optionalImageUrlReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url)
    return isOptionalAssetPresent(response)
  } catch {
    return false
  }
}