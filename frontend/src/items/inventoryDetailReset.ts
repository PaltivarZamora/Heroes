/** Clear hover/detail panes on all open {@link HeroInventory} panels (trade, etc.). */
const listeners = new Set<() => void>()

export function subscribeInventoryDetailReset(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function resetAllInventoryDetails(): void {
  for (const listener of listeners) {
    listener()
  }
}
