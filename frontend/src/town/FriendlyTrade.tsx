import { useEffect, useSyncExternalStore } from 'react'
import type { ResourceWallet } from '../hex/resources'
import { ResourceBar } from '../hex/ResourceBar'
import { getSession, subscribe } from '../session/store'
import { fetchCatalog, getCachedCatalog, subscribeCatalog } from './catalog'
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
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const left = session.heroes.find((hero) => hero.id === leftHeroId)
  const right = session.heroes.find((hero) => hero.id === rightHeroId)

  useEffect(() => {
    if (getCachedCatalog()) {
      return
    }
    void fetchCatalog().catch(() => {})
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
        <ResourceBar wallet={wallet} className="town-resource-strip" />
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
