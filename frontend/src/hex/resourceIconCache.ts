import { featureArtUrl } from './featureTextures'
import { featureForResource, getCachedCatalog } from '../town/catalog'
import type { ResourceDef } from './resources'

const okByUrl = new Map<string, boolean>()
const pendingByUrl = new Map<string, Promise<boolean>>()

function resourceIconUrl(resource: ResourceDef): string | null {
  const catalog = getCachedCatalog()
  const primary = featureForResource(catalog, resource.id, 'pickup')?.image_path
  const nameBase = resource.name.trim().replaceAll(' ', '_')
  const file = primary?.trim() || `${nameBase}.png`
  if (/_node\.png$/i.test(file)) {
    return featureArtUrl(`${nameBase}.png`)
  }
  return featureArtUrl(file)
}

/** Resolve once per URL; avoids repeated HEAD/GET from the resource bar. */
export function resolveResourceIconUrl(resource: ResourceDef): Promise<string | null> {
  const url = resourceIconUrl(resource)
  if (!url) {
    return Promise.resolve(null)
  }
  if (okByUrl.has(url)) {
    return Promise.resolve(okByUrl.get(url) ? url : null)
  }
  let pending = pendingByUrl.get(url)
  if (!pending) {
    pending = fetch(url)
      .then((response) => {
        const contentType = response.headers.get('content-type') ?? ''
        const ok =
          response.ok && contentType.toLowerCase().startsWith('image/')
        okByUrl.set(url, ok)
        return ok
      })
      .catch(() => {
        okByUrl.set(url, false)
        return false
      })
      .finally(() => {
        pendingByUrl.delete(url)
      })
    pendingByUrl.set(url, pending)
  }
  return pending.then((ok) => (ok ? url : null))
}
