import { setGameDifficultyCatalog } from '../town/catalog'
import type { GameSession } from './types'

/** Parsed `game.settings.difficulty`; missing or invalid → Normal (2). */
export function difficultyIdFromSettings(
  settings: { difficulty?: string } | null | undefined,
): number {
  const raw = Math.trunc(Number(settings?.difficulty))
  return raw > 0 ? raw : 2
}

export function syncGameDifficultyFromSession(session: GameSession): void {
  setGameDifficultyCatalog(difficultyIdFromSettings(session.game.settings))
}
