import { appendLogEntry, logViewPlayerId } from './gameLog'
import type { GameSession } from './types'

const onceKeys = new Set<string>()
const devLines: string[] = []

/** Once-per-key config/data notice (Dev copy buffer; no browser console). */
export function logConfigOnce(key: string, message: string): void {
  if (onceKeys.has(key)) {
    return
  }
  onceKeys.add(key)
  devLines.push(message)
}

export function configDevWarnings(): string[] {
  return devLines
}

/** World tab line when session is available (also records in Dev buffer). */
export function logConfigWorldNotice(
  session: GameSession,
  key: string,
  message: string,
): GameSession {
  const onceKey = `world:${key}`
  if (onceKeys.has(onceKey)) {
    return session
  }
  logConfigOnce(onceKey, message)
  return appendLogEntry(
    session,
    logViewPlayerId(session),
    'world',
    'config_notice',
    { message },
  )
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback
}
