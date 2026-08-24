import { createInitialSession } from './create'
import type { GameSession } from './types'

let session: GameSession = createInitialSession()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function getSession(): GameSession {
  return session
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setSession(next: GameSession): void {
  session = next
  emit()
}

export function updateSession(fn: (current: GameSession) => GameSession): GameSession {
  session = fn(session)
  emit()
  return session
}
