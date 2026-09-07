import { getCachedCatalog, startingStockpileFor, yieldPerMine } from '../town/catalog'

export type ResourceDef = {
  id: number
  name: string
  marker: string
}

const MARKERS_BY_ID: Record<number, string> = {
  1: 'G',
  2: 'W',
  3: 'O',
  4: 'I',
  5: 'C',
  6: 'S',
  7: 'A',
  8: 'E',
  9: 'N',
  10: 'B',
}

export const GOLD_RESOURCE_ID = 1

const FALLBACK_RESOURCES: ResourceDef[] = [
  { id: 1, name: 'Gold', marker: 'G' },
  { id: 2, name: 'Wood', marker: 'W' },
  { id: 3, name: 'Ore', marker: 'O' },
  { id: 4, name: 'Ichor', marker: 'I' },
  { id: 5, name: 'Crystal', marker: 'C' },
  { id: 6, name: 'Sap', marker: 'S' },
  { id: 7, name: 'Ash', marker: 'A' },
  { id: 8, name: 'Aether', marker: 'E' },
  { id: 9, name: 'Incense', marker: 'N' },
  { id: 10, name: 'Brimstone', marker: 'B' },
]

/** Live binding: catalog load replaces names from the resource table. */
export let RESOURCES: ResourceDef[] = FALLBACK_RESOURCES

export type ResourceEntry = {
  claimedMines: number
  stockpile: number
}

export type ResourceWallet = Record<number, ResourceEntry>

/** Neutral / unclaimed mine and pickup marker fill. */
export const NEUTRAL_OBJECT_COLOR = 0x9e9e9e

export function applyResourceCatalog(rows: Array<{ id: number; name: string }>): void {
  const next = rows
    .filter((row) => Number.isInteger(row.id) && typeof row.name === 'string' && row.name)
    .sort((a, b) => a.id - b.id)
    .map((row) => ({
      id: row.id,
      name: row.name,
      marker: MARKERS_BY_ID[row.id] ?? row.name.charAt(0).toUpperCase(),
    }))
  if (next.length > 0) {
    RESOURCES = next
  }
}

export function resourceById(id: number): ResourceDef | undefined {
  return RESOURCES.find((resource) => resource.id === id)
}

export function emptyWallet(): ResourceWallet {
  const wallet: ResourceWallet = {}
  const catalog = getCachedCatalog()
  for (const resource of RESOURCES) {
    wallet[resource.id] = {
      claimedMines: 0,
      stockpile: startingStockpileFor(catalog, resource),
    }
  }
  return wallet
}

/** Thousands separators for any displayed resource quantity. */
export function formatAmount(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

export function formatResourceLine(
  resource: ResourceDef,
  entry: ResourceEntry | undefined,
): string {
  const claimed = entry?.claimedMines ?? 0
  const stockpile = entry?.stockpile ?? 0
  const dailyYield = claimed * yieldPerMine(getCachedCatalog())
  return `${resource.name} (${formatAmount(claimed)}/${formatAmount(dailyYield)}) ${formatAmount(stockpile)}`
}

export function formatResourceLines(wallet: ResourceWallet): string[] {
  return RESOURCES.map((resource) =>
    formatResourceLine(resource, wallet[resource.id]),
  )
}

export function isKnownResourceId(id: number | null | undefined): id is number {
  return typeof id === 'number' && RESOURCES.some((resource) => resource.id === id)
}

export function snapshotWallet(wallet: ResourceWallet): ResourceWallet {
  const next = emptyWallet()
  for (const resource of RESOURCES) {
    const entry = wallet[resource.id]
    if (entry) {
      next[resource.id] = { ...entry }
    }
  }
  return next
}

export function canAfford(
  wallet: ResourceWallet,
  cost: Record<number, number> | Record<string, number>,
): string | null {
  for (const [key, amount] of Object.entries(cost)) {
    const id = costResourceId(key)
    const resource = id != null ? resourceById(id) : undefined
    if (id == null || !resource) {
      return `Unknown resource in cost: ${key}`
    }
    const have = wallet[id]?.stockpile ?? 0
    if (have < amount) {
      return `Not enough ${resource.name} (need ${formatAmount(amount)}, have ${formatAmount(have)})`
    }
  }
  return null
}

function costResourceId(key: string): number | null {
  const asNumber = Number(key)
  if (Number.isInteger(asNumber) && resourceById(asNumber)) {
    return asNumber
  }
  const byName = RESOURCES.find(
    (resource) => resource.name.toLowerCase() === key.trim().toLowerCase(),
  )
  return byName ? byName.id : null
}

export function deductCost(
  wallet: ResourceWallet,
  cost: Record<number, number> | Record<string, number>,
): ResourceWallet {
  const next = snapshotWallet(wallet)
  for (const [key, amount] of Object.entries(cost)) {
    const id = costResourceId(key)
    if (id != null && next[id]) {
      next[id].stockpile -= amount
    }
  }
  return next
}

export function applyDailyTick(wallet: ResourceWallet): void {
  for (const resource of RESOURCES) {
    const entry = wallet[resource.id]
    if (entry) {
      entry.stockpile += entry.claimedMines * yieldPerMine(getCachedCatalog())
    }
  }
}
