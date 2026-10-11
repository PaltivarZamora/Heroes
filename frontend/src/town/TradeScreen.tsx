import { useSyncExternalStore } from 'react'
import { getSelectedMapHeroId } from '../hex/HexMap'
import { GameWindowModal } from '../layout/GameWindowModal'
import { GameWindowOverlay } from '../layout/GameWindowOverlay'
import { getSession, subscribe } from '../session/store'
import { getCachedCatalog, subscribeCatalog } from './catalog'
import { HeroInventory } from './HeroInventory'

type TradeScreenProps = {
  /** Hero who initiated the meet (map selection). */
  activeHeroId: string
  /** The other friendly hero. */
  partnerHeroId: string
  onClose: () => void
}

export function TradeScreen({
  activeHeroId,
  partnerHeroId,
  onClose,
}: TradeScreenProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const active =
    session.heroes.find((row) => row.id === activeHeroId) ??
    session.heroes.find((row) => row.id === getSelectedMapHeroId()) ??
    null
  const partner =
    session.heroes.find((row) => row.id === partnerHeroId) ?? null

  if (!catalog || !active || !partner) {
    return null
  }

  return (
    <GameWindowOverlay className="trade-screen-embedded game-window-overlay-host">
      <GameWindowModal
        className="trade-screen-modal"
        aria-modal="true"
        aria-labelledby="trade-screen-title"
        onBackdropClick={onClose}
      >
        <h1 id="trade-screen-title" className="trade-screen-title">
          Trade — {active.name} &amp; {partner.name}
        </h1>
        <div className="trade-screen-body" data-tip-contain>
          <section className="trade-screen-half" aria-label={`${partner.name} inventory`}>
            <HeroInventory
              catalog={catalog}
              hero={partner}
              inCombat={false}
              tradePeerHeroId={active.id}
            />
          </section>
          <section className="trade-screen-half" aria-label={`${active.name} inventory`}>
            <HeroInventory
              catalog={catalog}
              hero={active}
              inCombat={false}
              tradePeerHeroId={partner.id}
            />
          </section>
        </div>
      </GameWindowModal>
    </GameWindowOverlay>
  )
}
