export const RESOURCES = [
  { name: 'Gold', marker: 'G' },
  { name: 'Wood', marker: 'W' },
  { name: 'Ore', marker: 'O' },
  { name: 'Ichor', marker: 'I' },
  { name: 'Crystal', marker: 'C' },
  { name: 'Sap', marker: 'S' },
  { name: 'Ash', marker: 'A' },
  { name: 'Aether', marker: 'E' },
  { name: 'Incense', marker: 'N' },
  { name: 'Brimstone', marker: 'B' },
] as const

export type ResourceName = (typeof RESOURCES)[number]['name']

export type ResourceEntry = {
  claimedMines: number
  stockpile: number
}

export type ResourceWallet = Record<ResourceName, ResourceEntry>

/** Neutral / unclaimed mine and pickup marker fill. */
export const NEUTRAL_OBJECT_COLOR = 0x9e9e9e

/** One-time pickup adds this much to the stockpile. */
export const PICKUP_AMOUNT = 1

/** Daily yield per claimed mine — placeholder until BR 2-3c. */
export const YIELD_PER_MINE = 1

/**
 * Placeholder starting stockpile so town construction is testable until a
 * starting-treasury brief exists.
 */
const STARTING_STOCKPILE: Partial<Record<ResourceName, number>> = {
  Gold: 10000,
  Wood: 20,
  Ore: 20,
  Ichor: 20,
  Crystal: 10,
}

export function emptyWallet(): ResourceWallet {
  const wallet = {} as ResourceWallet
  for (const resource of RESOURCES) {
    wallet[resource.name] = {
      claimedMines: 0,
      stockpile: STARTING_STOCKPILE[resource.name] ?? 0,
    }
  }
  return wallet
}

/** Thousands separators for any displayed resource quantity. */
export function formatAmount(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

export function formatResourceLine(
  name: ResourceName,
  entry: ResourceEntry,
): string {
  const dailyYield = entry.claimedMines * YIELD_PER_MINE
  return `${name} (${formatAmount(entry.claimedMines)}/${formatAmount(dailyYield)}) ${formatAmount(entry.stockpile)}`
}

export function formatResourceLines(wallet: ResourceWallet): string[] {
  return RESOURCES.map((resource) =>
    formatResourceLine(resource.name, wallet[resource.name]),
  )
}

export function isResourceName(name: string): name is ResourceName {
  return RESOURCES.some((resource) => resource.name === name)
}

export function snapshotWallet(wallet: ResourceWallet): ResourceWallet {
  const next = emptyWallet()
  for (const resource of RESOURCES) {
    next[resource.name] = { ...wallet[resource.name] }
  }
  return next
}

export function canAfford(
  wallet: ResourceWallet,
  cost: Record<string, number>,
): string | null {
  for (const [name, amount] of Object.entries(cost)) {
    if (!isResourceName(name)) {
      return `Unknown resource in cost: ${name}`
    }
    const have = wallet[name].stockpile
    if (have < amount) {
      return `Not enough ${name} (need ${formatAmount(amount)}, have ${formatAmount(have)})`
    }
  }
  return null
}

export function deductCost(
  wallet: ResourceWallet,
  cost: Record<string, number>,
): ResourceWallet {
  const next = snapshotWallet(wallet)
  for (const [name, amount] of Object.entries(cost)) {
    if (isResourceName(name)) {
      next[name].stockpile -= amount
    }
  }
  return next
}

export function applyDailyTick(wallet: ResourceWallet): void {
  for (const resource of RESOURCES) {
    const entry = wallet[resource.name]
    entry.stockpile += entry.claimedMines * YIELD_PER_MINE
  }
}
