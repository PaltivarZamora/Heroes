import type { RolledItem, RolledItemStatLine } from './types'

export type ApiRolledItem = {
  itemId: number
  rarityId: number
  adjId: number | null
  variation: number
  stats: RolledItemStatLine[]
}

export type RollItemsResponse = {
  seed: number
  count: number
  items: ApiRolledItem[]
}

export async function rollItemsFromServer(
  count: number,
  seed: number,
  rarityId?: number | null,
): Promise<RollItemsResponse> {
  const params = new URLSearchParams({
    count: String(count),
    seed: String(seed),
  })
  if (rarityId != null && rarityId > 0) {
    params.set('rarityId', String(rarityId))
  }
  const response = await fetch(`/api/items/roll?${params}`)
  if (!response.ok) {
    throw new Error(`Item roll failed (${response.status})`)
  }
  return (await response.json()) as RollItemsResponse
}

export async function rollDebugItemsFromServer(
  count: number,
  seed: number,
  rarityId?: number | null,
): Promise<RollItemsResponse> {
  const params = new URLSearchParams({
    count: String(count),
    seed: String(seed),
  })
  if (rarityId != null && rarityId > 0) {
    params.set('rarityId', String(rarityId))
  }
  const response = await fetch(`/api/debug/items/roll?${params}`)
  if (!response.ok) {
    throw new Error(`Debug item roll failed (${response.status})`)
  }
  return (await response.json()) as RollItemsResponse
}

export function apiItemToRolled(
  row: ApiRolledItem,
  uid: string,
): RolledItem {
  return {
    uid,
    itemId: row.itemId,
    rarityId: row.rarityId,
    adjId: row.adjId,
    variation: row.variation,
    stats: row.stats.map((line) => ({
      statId: line.statId,
      amt: line.amt,
    })),
  }
}
