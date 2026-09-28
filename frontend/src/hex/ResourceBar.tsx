import { useEffect, useState } from 'react'
import {
  formatAmount,
  RESOURCES,
  type ResourceDef,
  type ResourceEntry,
  type ResourceWallet,
} from '../hex/resources'
import { resolveResourceIconUrl } from './resourceIconCache'
import { subscribeCatalog } from '../town/catalog'

function ResourceIcon({ resource }: { resource: ResourceDef }) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const resolve = () => {
      void resolveResourceIconUrl(resource).then((url) => {
        if (!cancelled) {
          setSrc(url)
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
