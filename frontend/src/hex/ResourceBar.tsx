import { useEffect, useState } from 'react'
import {
  formatAmount,
  RESOURCES,
  type ResourceDef,
  type ResourceEntry,
  type ResourceWallet,
} from '../hex/resources'
import { featureArtUrl } from '../hex/featureTextures'
import {
  featureForResource,
  getCachedCatalog,
  subscribeCatalog,
} from '../town/catalog'

/** Loose pickup / UI icon only — never `{Resource}_Node.png`. */
function resourceIconUrl(resource: ResourceDef): string | null {
  const catalog = getCachedCatalog()
  const primary = featureForResource(catalog, resource.id, 'pickup')?.image_path
  const nameBase = resource.name.trim().replaceAll(' ', '_')
  const file = primary?.trim() || `${nameBase}.png`
  // Guard against a mis-pointed catalog row.
  if (/_node\.png$/i.test(file)) {
    return featureArtUrl(`${nameBase}.png`)
  }
  return featureArtUrl(file)
}

async function isImageUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url)
    const contentType = response.headers.get('content-type') ?? ''
    return response.ok && contentType.toLowerCase().startsWith('image/')
  } catch {
    return false
  }
}

function ResourceIcon({ resource }: { resource: ResourceDef }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const resolve = () => {
      const url = resourceIconUrl(resource)
      if (!url) {
        if (!cancelled) {
          setSrc(null)
        }
        return
      }
      void isImageUrl(url).then((ok) => {
        if (!cancelled) {
          setSrc(ok ? url : null)
        }
      })
    }
    resolve()
    const unsub = subscribeCatalog(resolve)
    return () => {
      cancelled = true
      unsub()
    }
  }, [resource.id, resource.name])

  if (!src) {
    return (
      <span className="resource-bar-fallback" aria-hidden title={resource.name}>
        {resource.marker}
      </span>
    )
  }
  return (
    <img
      className="resource-bar-icon"
      src={src}
      alt=""
      title={resource.name}
      draggable={false}
      onError={() => setSrc(null)}
    />
  )
}

function resourceCounts(entry: ResourceEntry | undefined): string {
  const weekly = entry?.weeklyIncome ?? 0
  const stockpile = entry?.stockpile ?? 0
  return `(${formatAmount(weekly)}/wk) ${formatAmount(stockpile)}`
}

type ResourceBarProps = {
  wallet: ResourceWallet
  className?: string
}

/** Top / town resource strip: icon + (weekly income/wk) stockpile. */
export function ResourceBar({ wallet, className }: ResourceBarProps) {
  const [, bump] = useState(0)
  useEffect(() => subscribeCatalog(() => bump((n) => n + 1)), [])

  return (
    <p className={className ?? 'resource-debug'}>
      {RESOURCES.map((resource) => (
        <span key={resource.id} className="resource-bar-item">
          <ResourceIcon resource={resource} />
          <span className="resource-bar-counts">
            {resourceCounts(wallet[resource.id])}
          </span>
        </span>
      ))}
    </p>
  )
}
