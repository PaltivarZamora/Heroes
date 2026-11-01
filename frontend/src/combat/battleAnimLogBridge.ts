import { devToolsEnabled } from '../settings/playerSettings'

let appendLiveCombatLine: ((line: string) => void) | null = null

/** CombatScreen registers while a battle is mounted (live combat transcript). */
export function setBattleAnimLogSink(
  sink: ((line: string) => void) | null,
): void {
  appendLiveCombatLine = sink
}

/** Dev-only: full text lines on the Combat log tab (live transcript). */
export function appendBattleAnimCombatLog(message: string): void {
  if (!devToolsEnabled()) {
    return
  }
  const text = message.trim()
  if (!text) {
    return
  }
  appendLiveCombatLine?.(text)
}
