import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  findWorldRecruitsById,
  recordWorldRecruitsKnowledge,
  recruitFromWorldRecruits,
  worldRecruitsMaxQty,
} from '../session/recruits'
import { walletFromSession } from '../session/accessors'
import { getSession, subscribe, updateSession } from '../session/store'
import {
  formatCost,
  getCachedCatalog,
  maxAffordableQty,
  scaleCost,
  subscribeCatalog,
  unitById,
  unitCost,
} from './catalog'
import { AbilityTip } from './AbilityTip'
import {
  formatToolkitRows,
  sessionUnitToolkitRows,
} from './UnitToolkitTip'
import { UnitStackFace } from './unitStack'

type WorldRecruitsProps = {
  featureId: string
  heroId: string
  onClose: () => void
}

/**
 * Compact Recruits for Hire popup (BR S9-9).
 * Graphic (stock on portrait) + qty/cost row + Confirm / Cancel.
 */
export function WorldRecruits({
  featureId,
  heroId,
  onClose,
}: WorldRecruitsProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const feature = findWorldRecruitsById(session, featureId)
  const hero = session.heroes.find((row) => row.id === heroId) ?? null
  const wallet = walletFromSession(session)
  const [error, setError] = useState<string | null>(null)
  const [qtyText, setQtyText] = useState('1')

  useEffect(() => {
    if (!hero || !feature) {
      return
    }
    updateSession((current) =>
      recordWorldRecruitsKnowledge(current, featureId, hero.player_id),
    )
  }, [featureId, hero?.id, hero?.player_id, feature?.id])

  const unit =
    catalog && feature && feature.unit_id > 0
      ? unitById(catalog, feature.unit_id)
      : null
  const perUnitCost = unitCost(unit)
  const stock = feature?.stock ?? 0
  const maxQty =
    catalog && feature && hero
      ? worldRecruitsMaxQty(session, catalog, feature, hero.id, wallet)
      : 0

  useEffect(() => {
    setQtyText(String(Math.max(1, maxQty > 0 ? maxQty : 1)))
    setError(null)
  }, [feature?.unit_id, feature?.stock, maxQty])

  const parsedQty = Math.max(1, Number.parseInt(qtyText, 10) || 1)
  const buyQty = Math.min(
    parsedQty,
    Math.max(1, maxAffordableQty(wallet, perUnitCost, stock)),
  )
  const canRecruit = stock >= 1 && unit != null && maxQty >= 1
  const tipRows =
    catalog && unit
      ? sessionUnitToolkitRows(catalog, unit.id, Math.max(1, stock))
      : []

  const recruit = () => {
    if (!catalog || !hero || !feature || !canRecruit) {
      return
    }
    let buyError: string | null = null
    let remaining = stock
    updateSession((current) => {
      const result = recruitFromWorldRecruits(
        current,
        catalog,
        featureId,
        hero.id,
        buyQty,
      )
      buyError = result.error
      if (!result.error) {
        const live = findWorldRecruitsById(result.session, featureId)
        remaining = live?.stock ?? 0
      }
      return result.error ? current : result.session
    })
    if (buyError) {
      setError(buyError)
      return
    }
    if (remaining < 1) {
      onClose()
    }
  }

  return (
    <div
      className="date-notice"
      role="dialog"
      aria-modal="true"
      aria-labelledby="world-recruits-title"
      onClick={onClose}
    >
      <div
        className="date-notice-card world-panel-card world-recruits-card"
        data-tip-contain=""
        onClick={(event) => event.stopPropagation()}
      >
        <h1 id="world-recruits-title">Recruits for Hire</h1>
        {!catalog || !feature || !hero ? (
          <p>Loading…</p>
        ) : !unit ? (
          <>
            <p>No units available this week.</p>
            <button type="button" className="date-notice-ok" onClick={onClose}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <AbilityTip description={formatToolkitRows(tipRows)}>
              <div className="world-recruits-art">
                <UnitStackFace
                  empty={false}
                  filename={unit.image_path?.trim() || null}
                  qty={stock}
                />
                <p className="world-recruits-name">{unit.name.trim()}</p>
              </div>
            </AbilityTip>
            {stock < 1 ? (
              <p>Sold out this week.</p>
            ) : (
              <div className="world-recruits-row">
                <label className="world-recruits-qty">
                  Qty
                  <input
                    type="number"
                    min={1}
                    max={stock}
                    value={qtyText}
                    onChange={(event) => setQtyText(event.target.value)}
                  />
                </label>
                <span className="world-recruits-cost">
                  Cost {formatCost(scaleCost(perUnitCost, buyQty))}
                </span>
              </div>
            )}
            {error ? <p className="world-recruits-error">{error}</p> : null}
            <button
              type="button"
              className="date-notice-ok"
              disabled={!canRecruit}
              onClick={recruit}
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
