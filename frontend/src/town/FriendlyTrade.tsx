import { useEffect, useState, useSyncExternalStore } from 'react'
import { formatResourceLine, RESOURCES, type ResourceWallet } from '../hex/resources'
import { getSession, subscribe } from '../session/store'
import { fetchCatalog, type ReferenceCatalog } from './catalog'
import { ArmyTransfer } from './ArmyTransfer'

type FriendlyTradeProps = {
  leftHeroId: string
  rightHeroId: string
  wallet: ResourceWallet
  onExit: () => void
}

export function FriendlyTrade({
  leftHeroId,
  rightHeroId,
  wallet,
  onExit,
}: FriendlyTradeProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const [catalog, setCatalog] = useState<ReferenceCatalog | null>(null)
  const left = session.heroes.find((hero) => hero.id === leftHeroId)
  const right = session.heroes.find((hero) => hero.id === rightHeroId)

  useEffect(() => {
    let cancelled = false
    void fetchCatalog()
      .then((data) => {
        if (!cancelled) {
          setCatalog(data)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div
      className="town-management trade-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="friendly-trade-title"
    >
      <header className="town-management-bar">
        <h1 id="friendly-trade-title">Friendly Trade</h1>
        <p className="town-resource-strip">
          {RESOURCES.map((resource) => (
            <span key={resource.id}>
              {formatResourceLine(resource, wallet[resource.id])}
            </span>
          ))}
        </p>
        <button type="button" onClick={onExit}>
          Done
        </button>
      </header>
      <div className="trade-army-dock">
        <ArmyTransfer
          session={session}
          townId=""
          catalog={catalog}
          rows={[
            {
              row: 'hero',
              heroId: leftHeroId,
              portraitLabel: left?.name ?? 'Hero',
              portraitFilename: left?.image_path ?? null,
            },
            {
              row: 'hero',
              heroId: rightHeroId,
              portraitLabel: right?.name ?? 'Hero',
              portraitFilename: right?.image_path ?? null,
            },
          ]}
        />
      </div>
    </div>
  )
}
