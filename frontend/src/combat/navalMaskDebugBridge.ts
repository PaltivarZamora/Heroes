export type NavalMaskDebugState = {
  available: boolean
  enabled: boolean
  onToggle: () => void
}

let state: NavalMaskDebugState | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function setNavalMaskDebugState(next: NavalMaskDebugState | null): void {
  state = next
  notify()
}

export function getNavalMaskDebugState(): NavalMaskDebugState | null {
  return state
}

export function subscribeNavalMaskDebug(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
