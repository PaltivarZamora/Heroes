import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from 'react'
import {
  formatAmount,
  formatResourceLine,
  RESOURCES,
} from '../hex/resources'
import {
  executeMarketMultiSell,
  executeMarketTrade,
  humanPlayer,
  playerMarketplaceCount,
  walletFromSession,
} from '../session/accessors'
import { getSession, subscribe, updateSession } from '../session/store'
import {
  getCachedCatalog,
  subscribeCatalog,
  type ResourceRow,
} from './catalog'
import {
  marketConversionRate,
  quoteMarketTrade,
  quoteMultiSell,
  resourcesForMarketplace,
  sellQtyFromBuy,
} from './market'

type MarketplaceProps = {
  onClose: () => void
}

function parseQty(raw: string, max: number): number | null {
  if (raw === '') {
    return 0
  }
  if (!/^\d+$/.test(raw)) {
    return null
  }
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0 || n > max) {
    return null
  }
  return n
}

function ResourceRowGrid({
  label,
  resources,
  selectedIds,
  owned,
  allowShift,
  onSelect,
}: {
  label: string
  resources: ResourceRow[]
  selectedIds: number[]
  owned: Record<number, number>
  allowShift?: boolean
  onSelect: (id: number, event: ReactMouseEvent<HTMLButtonElement>) => void
}) {
  const selected = new Set(selectedIds)
  return (
    <section className="marketplace-side">
      <h2>{label}</h2>
      <div className="marketplace-grid">
        {resources.map((resource) => (
          <button
            key={resource.id}
            type="button"
            className={
              selected.has(resource.id)
                ? 'marketplace-resource selected'
                : 'marketplace-resource'
            }
            onClick={(event) => onSelect(resource.id, event)}
          >
            <span className="marketplace-resource-name">{resource.name}</span>
            <span className="marketplace-resource-owned">
              {formatAmount(owned[resource.id] ?? 0)}
            </span>
          </button>
        ))}
      </div>
      {allowShift ? (
        <p className="marketplace-hint">Shift-click to sell more than one resource.</p>
      ) : null}
    </section>
  )
}

export function Marketplace({ onClose }: MarketplaceProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const [sellIds, setSellIds] = useState<number[]>([])
  const [buyId, setBuyId] = useState<number | null>(null)
  const [edited, setEdited] = useState<'sell' | 'buy'>('sell')
  const [qty, setQty] = useState(0)
  const [message, setMessage] = useState<string | null>(null)
  const hadPair = useRef(false)

  const wallet = walletFromSession(session)
  const player = humanPlayer(session)
  const owned: Record<number, number> = player?.resources ?? {}
  const resources = catalog ? resourcesForMarketplace(catalog) : []
  const marketCount = catalog ? playerMarketplaceCount(session, catalog) : 0
  const rate = catalog ? marketConversionRate(catalog.market, marketCount) : null
  const multi = sellIds.length > 1
  const sellId = sellIds.length === 1 ? (sellIds[0] ?? null) : null
  const ownedSell = sellId != null ? (owned[sellId] ?? 0) : 0

  const quote = useMemo(() => {
    if (!catalog || rate == null || sellId == null || buyId == null || multi) {
      return null
    }
    return quoteMarketTrade(
      catalog,
      sellId,
      buyId,
      rate,
      edited,
      qty,
      ownedSell,
    )
  }, [catalog, rate, sellId, buyId, edited, qty, ownedSell, multi])

  const multiQuote = useMemo(() => {
    if (!catalog || rate == null || !multi || buyId == null) {
      return null
    }
    return quoteMultiSell(catalog, sellIds, buyId, rate, owned)
  }, [catalog, rate, multi, buyId, sellIds, owned])

  const maxSell = Math.max(0, Math.floor(ownedSell))
  const maxBuy =
    catalog && rate != null && sellId != null && buyId != null && !multi
      ? (quoteMarketTrade(
          catalog,
          sellId,
          buyId,
          rate,
          'sell',
          maxSell,
          maxSell,
        )?.buyQty ?? 0)
      : 0

  useEffect(() => {
    const ready =
      sellId != null && buyId != null && catalog != null && rate != null && !multi
    if (ready && !hadPair.current) {
      const sellBase = catalog.resource.find((row) => row.id === sellId)
      const buyBase = catalog.resource.find((row) => row.id === buyId)
      if (sellBase && buyBase) {
        const forOne = sellQtyFromBuy(
          1,
          rate,
          sellBase.base_value,
          buyBase.base_value,
        )
        setQty((current) => {
          if (current > 0) {
            return Math.min(current, Math.max(0, Math.floor(ownedSell)))
          }
          return Math.min(forOne, Math.max(0, Math.floor(ownedSell)))
        })
      }
    }
    hadPair.current = ready
  }, [sellId, buyId, catalog, rate, ownedSell, multi])

  useEffect(() => {
    if (multi) {
      return
    }
    if (edited === 'sell' && qty > maxSell) {
      setQty(maxSell)
    }
    if (edited === 'buy' && qty > maxBuy) {
      setQty(maxBuy)
    }
  }, [edited, qty, maxSell, maxBuy, multi])

  const resetTrade = () => {
    setSellIds([])
    setBuyId(null)
    setEdited('sell')
    setQty(0)
    hadPair.current = false
  }

  const onSellQty = (raw: string) => {
    const next = parseQty(raw, maxSell)
    if (next == null) {
      return
    }
    setEdited('sell')
    setQty(next)
    setMessage(null)
  }

  const onBuyQty = (raw: string) => {
    const next = parseQty(raw, maxBuy)
    if (next == null) {
      return
    }
    setEdited('buy')
    setQty(next)
    setMessage(null)
  }

  const canTrade = multi
    ? multiQuote != null && multiQuote.buyTotal > 0 && multiQuote.included.length > 0
    : quote != null &&
      quote.sellQty > 0 &&
      quote.buyQty > 0 &&
      quote.sellQty <= maxSell

  const onTrade = () => {
    if (!catalog || buyId == null || !canTrade) {
      return
    }
    let error: string | null = null
    updateSession((current) => {
      const result = multi
        ? executeMarketMultiSell(current, catalog, sellIds, buyId)
        : sellId != null
          ? executeMarketTrade(current, catalog, sellId, buyId, edited, qty)
          : { session: current, error: 'Trade is not valid.' }
      error = result.error
      return result.error ? current : result.session
    })
    if (error) {
      setMessage(error)
      return
    }
    setMessage(null)
    resetTrade()
  }

  const buyName = resources.find((row) => row.id === buyId)?.name
  const sellName = sellId != null ? resources.find((row) => row.id === sellId)?.name : undefined

  const onSellSelect = (id: number, event: ReactMouseEvent<HTMLButtonElement>) => {
    setMessage(null)
    if (event.shiftKey) {
      setSellIds((current) =>
        current.includes(id) ? current.filter((row) => row !== id) : [...current, id],
      )
      return
    }
    setSellIds([id])
    setEdited('sell')
  }

  return (
    <div
      className="town-management marketplace-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="marketplace-title"
    >
      <header className="town-management-bar">
        <h1 id="marketplace-title">Marketplace</h1>
        <p className="town-resource-strip">
          {RESOURCES.map((resource) => (
            <span key={resource.id}>
              {formatResourceLine(resource, wallet[resource.id])}
            </span>
          ))}
        </p>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="marketplace-body">
        {!catalog ? (
          <p>Loading…</p>
        ) : rate == null ? (
          <p className="town-building-panel-msg">Market rates are not loaded.</p>
        ) : (
          <>
            <ResourceRowGrid
              label="Sell"
              resources={resources}
              selectedIds={sellIds}
              owned={owned}
              allowShift
              onSelect={onSellSelect}
            />
            {sellId != null && !multi ? (
              <label className="marketplace-qty town-recruit-qty">
                Sell Qty
                <input
                  type="number"
                  min={0}
                  max={maxSell}
                  step={1}
                  value={edited === 'sell' ? qty : (quote?.sellQty ?? 0)}
                  onChange={(event) => onSellQty(event.target.value)}
                />
              </label>
            ) : null}
            <ResourceRowGrid
              label="Buy"
              resources={resources}
              selectedIds={buyId != null ? [buyId] : []}
              owned={owned}
              onSelect={(id) => {
                setBuyId(id)
                setMessage(null)
              }}
            />
            {buyId != null && !multi ? (
              <label className="marketplace-qty town-recruit-qty">
                Buy Qty
                <input
                  type="number"
                  min={0}
                  max={maxBuy}
                  step={1}
                  value={edited === 'buy' ? qty : (quote?.buyQty ?? 0)}
                  onChange={(event) => onBuyQty(event.target.value)}
                />
              </label>
            ) : null}
            {multi && multiQuote && buyName && multiQuote.buyTotal > 0 ? (
              <p className="marketplace-quote">
                {formatAmount(multiQuote.buyTotal)} {buyName}
              </p>
            ) : null}
            {!multi && quote && sellName && buyName && quote.buyQty > 0 ? (
              <p className="marketplace-quote">
                {formatAmount(quote.sellQty)} {sellName} → {formatAmount(quote.buyQty)}{' '}
                {buyName}
              </p>
            ) : null}
            <button type="button" disabled={!canTrade} onClick={onTrade}>
              Trade
            </button>
            {message ? <p className="town-building-panel-msg">{message}</p> : null}
          </>
        )}
      </div>
    </div>
  )
}
