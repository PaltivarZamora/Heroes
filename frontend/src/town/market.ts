import {
  isMarketplaceBuilding,
  type MarketRow,
  type ReferenceCatalog,
  type ResourceRow,
} from './catalog'

/** Marketplace screen only — do not reuse for HUD/resource strips. */
export function resourcesForMarketplace(catalog: ReferenceCatalog): ResourceRow[] {
  return catalog.resource.slice().sort((a, b) => {
    if (a.base_value !== b.base_value) {
      return a.base_value - b.base_value
    }
    return a.name.localeCompare(b.name)
  })
}

export function marketConversionRate(
  rows: MarketRow[],
  marketplaceCount: number,
): number | null {
  if (rows.length === 0) {
    return null
  }
  const minQty = Math.min(...rows.map((row) => row.qty))
  const maxQty = Math.max(...rows.map((row) => row.qty))
  const qty = Math.min(maxQty, Math.max(minQty, marketplaceCount))
  const match = rows.find((row) => row.qty === qty)
  return match && match.conversion_rate > 0 ? match.conversion_rate : null
}

function resourceBase(catalog: ReferenceCatalog, id: number): number | null {
  const row = catalog.resource.find((item) => item.id === id)
  if (!row || row.base_value <= 0) {
    return null
  }
  return row.base_value
}

/** Whole buy units for a given sell quantity. Rounds down (bank's favor). */
export function buyQtyFromSell(
  sellQty: number,
  rate: number,
  sellBase: number,
  buyBase: number,
): number {
  if (sellQty <= 0 || rate <= 0 || sellBase <= 0 || buyBase <= 0) {
    return 0
  }
  return Math.floor((sellQty * sellBase) / (rate * buyBase))
}

/** Whole sell units required for a given buy quantity. Rounds up (bank's favor). */
export function sellQtyFromBuy(
  buyQty: number,
  rate: number,
  sellBase: number,
  buyBase: number,
): number {
  if (buyQty <= 0 || rate <= 0 || sellBase <= 0 || buyBase <= 0) {
    return 0
  }
  return Math.ceil((buyQty * rate * buyBase) / sellBase)
}

export function quoteMarketTrade(
  catalog: ReferenceCatalog,
  sellId: number,
  buyId: number,
  rate: number,
  edited: 'sell' | 'buy',
  qty: number,
  ownedSell: number,
): { sellQty: number; buyQty: number } | null {
  if (sellId === buyId || qty < 0 || ownedSell < 0) {
    return null
  }
  const sellBase = resourceBase(catalog, sellId)
  const buyBase = resourceBase(catalog, buyId)
  if (sellBase == null || buyBase == null || rate <= 0) {
    return null
  }
  const owned = Math.floor(ownedSell)
  if (edited === 'sell') {
    const sellQty = Math.min(Math.floor(qty), owned)
    if (sellQty < 0) {
      return null
    }
    return { sellQty, buyQty: buyQtyFromSell(sellQty, rate, sellBase, buyBase) }
  }
  const maxBuy = buyQtyFromSell(owned, rate, sellBase, buyBase)
  const buyQty = Math.min(Math.floor(qty), maxBuy)
  if (buyQty < 0) {
    return null
  }
  return { sellQty: sellQtyFromBuy(buyQty, rate, sellBase, buyBase), buyQty }
}

export type MultiSellLine = {
  sellId: number
  sellQty: number
  buyQty: number
}

/** Full-owned sells only. Lines that round to 0 buy units are omitted. */
export function quoteMultiSell(
  catalog: ReferenceCatalog,
  sellIds: number[],
  buyId: number,
  rate: number,
  owned: Record<number, number>,
): { included: MultiSellLine[]; buyTotal: number } {
  const included: MultiSellLine[] = []
  const seen = new Set<number>()
  for (const sellId of sellIds) {
    if (seen.has(sellId) || sellId === buyId) {
      continue
    }
    seen.add(sellId)
    const ownedSell = Math.max(0, Math.floor(owned[sellId] ?? 0))
    const quote = quoteMarketTrade(
      catalog,
      sellId,
      buyId,
      rate,
      'sell',
      ownedSell,
      ownedSell,
    )
    if (!quote || quote.sellQty <= 0 || quote.buyQty <= 0) {
      continue
    }
    included.push({
      sellId,
      sellQty: quote.sellQty,
      buyQty: quote.buyQty,
    })
  }
  return {
    included,
    buyTotal: included.reduce((sum, line) => sum + line.buyQty, 0),
  }
}

export function ownedMarketplaceCount(
  catalog: ReferenceCatalog,
  ownedTownIds: ReadonlySet<string>,
  buildingStates: Array<{
    town_id: string
    building_id: number | null
    level: number
  }>,
): number {
  const marketIds = new Set(
    catalog.building.filter(isMarketplaceBuilding).map((row) => row.id),
  )
  if (marketIds.size === 0) {
    return 0
  }
  let count = 0
  for (const row of buildingStates) {
    if (
      ownedTownIds.has(row.town_id) &&
      row.level >= 1 &&
      row.building_id != null &&
      marketIds.has(row.building_id)
    ) {
      count += 1
    }
  }
  return count
}
