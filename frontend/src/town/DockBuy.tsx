import { useState, useSyncExternalStore } from 'react'
import { formatAmount, GOLD_RESOURCE_ID } from '../hex/resources'
import { boatCostGold, findBoatAt } from '../hex/boat'
import {
  buyBoatAtDock,
  findWorldDockById,
} from '../session/boat'
import { walletFromSession } from '../session/accessors'
import { getSession, subscribe, updateSession } from '../session/store'
import { getCachedCatalog, subscribeCatalog } from './catalog'

type DockBuyProps = {
  featureId: string
  heroId: string
  onClose: () => void
}

/**
 * Dock buy-boat popup (BR S9-8).
 */
export function DockBuy({ featureId, heroId, onClose }: DockBuyProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const dock = findWorldDockById(session, featureId)
  const hero = session.heroes.find((row) => row.id === heroId) ?? null
  const [error, setError] = useState<string | null>(null)
  const wallet = walletFromSession(session)
  const goldOnHand = wallet[GOLD_RESOURCE_ID]?.stockpile ?? 0
  const cost = boatCostGold(catalog)
  const launchBoat = dock
    ? findBoatAt(session, dock.launch.q, dock.launch.r)
    : undefined
  const boatWaiting = launchBoat != null
  const afford = goldOnHand >= cost
  const canBuy = !boatWaiting && afford && hero != null

  const buy = () => {
    if (!hero || !canBuy) {
      return
    }
    let buyError: string | null = null
    updateSession((current) => {
      const result = buyBoatAtDock(current, featureId, hero.player_id)
      buyError = result.error
      return result.session
    })
    if (buyError) {
      setError(buyError)
      return
    }
    onClose()
  }

  const disabledReason = boatWaiting
    ? 'A boat is already waiting.'
    : !afford
      ? `Not enough Gold (need ${formatAmount(cost)}, have ${formatAmount(goldOnHand)})`
      : null

  return (
    <div
      className="date-notice"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dock-buy-title"
      onClick={onClose}
    >
      <div
        className="date-notice-card world-panel-card"
        onClick={(event) => event.stopPropagation()}
      >
        <h1 id="dock-buy-title">Dock</h1>
        {!dock || !hero ? (
          <p>Loading…</p>
        ) : (
          <>
            <p className="world-panel-cost">
              Cost {formatAmount(cost)} Gold
            </p>
            {error ? <p className="world-panel-error">{error}</p> : null}
            {disabledReason && !error ? (
              <p className="world-panel-error">{disabledReason}</p>
            ) : null}
            <button
              type="button"
              className="date-notice-ok"
              disabled={!canBuy}
              onClick={buy}
            >
              Confirm
            </button>
            <button type="button" className="date-notice-ok" onClick={onClose}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  )
}
