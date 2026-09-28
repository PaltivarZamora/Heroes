import { useState, useSyncExternalStore } from 'react'
import { formatAmount, GOLD_RESOURCE_ID } from '../hex/resources'
import {
  findWorldHangerById,
  flightDestinationsFromOrigin,
  launchHeroFlight,
  walletFromSession,
} from '../session/accessors'
import { getSession, subscribe, updateSession } from '../session/store'
import {
  flightSpeed,
  getCachedCatalog,
  subscribeCatalog,
} from './catalog'

type WorldHangerFlightProps = {
  featureId: string
  heroId: string
  onClose: () => void
  onFlyLaunched: (heroId: string) => void
}

/**
 * Flight destination picker for a world-map Hanger (BR S9-6).
 */
export function WorldHangerFlight({
  featureId,
  heroId,
  onClose,
  onFlyLaunched,
}: WorldHangerFlightProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const feature = findWorldHangerById(session, featureId)
  const hero = session.heroes.find((row) => row.id === heroId) ?? null
  const [error, setError] = useState<string | null>(null)
  const wallet = walletFromSession(session)
  const goldOnHand = wallet[GOLD_RESOURCE_ID]?.stockpile ?? 0

  const dests =
    catalog && feature && hero
      ? flightDestinationsFromOrigin(
          session,
          catalog,
          feature.position,
          hero.player_id,
          hero.id,
        )
      : []

  const launch = (townId: string, blocked: boolean, goldCost: number) => {
    if (!hero || blocked) {
      if (blocked) {
        setError('That destination is blocked.')
      }
      return
    }
    if (goldOnHand < goldCost) {
      setError('Not enough gold.')
      return
    }
    let launchError: string | null = null
    updateSession((current) => {
      const result = launchHeroFlight(current, hero.id, townId)
      launchError = result.error
      return result.session
    })
    if (launchError) {
      setError(launchError)
      return
    }
    onFlyLaunched(hero.id)
  }

  return (
    <div
      className="date-notice"
      role="dialog"
      aria-modal="true"
      aria-labelledby="world-hanger-title"
      onClick={onClose}
    >
      <div
        className="date-notice-card world-panel-card"
        onClick={(event) => event.stopPropagation()}
      >
        <h1 id="world-hanger-title">Hanger</h1>
        {!catalog || !feature || !hero ? (
          <p>Loading…</p>
        ) : dests.length === 0 ? (
          <>
            <p>You have no towns with a Hanger.</p>
            <button type="button" className="date-notice-ok" onClick={onClose}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <p>Fly to:</p>
            <div className="world-panel-list">
              {dests.map((dest) => {
                const afford = goldOnHand >= dest.goldCost
                const selectable = afford && !dest.blocked
                const typeName =
                  catalog.town.find((row) => row.id === dest.town.town_type_id)
                    ?.name?.trim() || 'Town'
                const days = Math.max(
                  1,
                  Math.ceil(dest.distance / flightSpeed(catalog)),
                )
                return (
                  <button
                    key={dest.town.id}
                    type="button"
                    className="world-panel-choice"
                    disabled={!selectable}
                    onClick={() =>
                      launch(dest.town.id, dest.blocked, dest.goldCost)
                    }
                  >
                    {typeName}: {dest.town.name}
                    <span>
                      {formatAmount(dest.goldCost)} Gold · {days}{' '}
                      {days === 1 ? 'Day' : 'Days'}
                      {dest.blocked
                        ? ' · Blocked'
                        : afford
                          ? ''
                          : ' · Need gold'}
                    </span>
                  </button>
                )
              })}
            </div>
            {error ? <p className="world-panel-error">{error}</p> : null}
            <button type="button" className="date-notice-ok" onClick={onClose}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  )
}
