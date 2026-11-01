import type { GameSession } from '../session/types'
import { loadSoundFile, logSoundProblem } from '../audio/soundPlayer'
import {
  cutExclusiveLoop,
  playExclusiveLoop,
  playSoundOnce,
  stopExclusiveLoop,
  type SoundHandle,
} from '../audio/soundPlayer'
import { appendBattleAnimCombatLog } from './battleAnimLogBridge'

const warnedStem = new Set<string>()

export function battleUnitSoundFile(stem: string, kind: 'Move' | 'Attack' | 'Hit' | 'Die'): string {
  return `${stem}_${kind}.mp3`
}

export function warnBattleUnitSoundMissing(
  session: GameSession,
  fileName: string,
): GameSession {
  const key = fileName.toLowerCase()
  if (warnedStem.has(key)) {
    return session
  }
  warnedStem.add(key)
  return logSoundProblem(session, fileName, 'not found, silent')
}

export async function beginBattleUnitMoveSound(
  stem: string,
  fallbackStem?: string | null,
): Promise<'playing' | 'missing' | 'blocked'> {
  const file = await resolveBattleUnitSoundFile(stem, 'Move', fallbackStem)
  if (!file) {
    return 'missing'
  }
  const handle = await playExclusiveLoop(file, 1)
  if (!handle) {
    return 'missing'
  }
  return 'playing'
}

export function stopBattleUnitMoveSound(fadeMs = 200): void {
  stopExclusiveLoop(fadeMs)
}

export function cutBattleUnitMoveSound(): void {
  cutExclusiveLoop()
}

export async function playBattleUnitHitSoundIfPresent(
  stem: string,
  fallbackStem?: string | null,
): Promise<SoundHandle | null> {
  const file = await resolveBattleUnitSoundFile(stem, 'Hit', fallbackStem)
  if (!file) {
    return null
  }
  return playSoundOnce(file, 1)
}

async function resolveBattleUnitSoundFile(
  stem: string,
  kind: 'Move' | 'Attack' | 'Hit' | 'Die',
  fallbackStem?: string | null,
): Promise<string | null> {
  const primary = battleUnitSoundFile(stem, kind)
  if (await loadSoundFile(primary)) {
    return primary
  }
  if (fallbackStem) {
    const alt = battleUnitSoundFile(fallbackStem, kind)
    if (await loadSoundFile(alt)) {
      return alt
    }
  }
  return null
}

export async function playBattleUnitSoundOnce(
  stem: string,
  kind: 'Attack' | 'Hit' | 'Die',
  soundLog?: { unitName: string; actionStartedMs: number },
  fallbackStem?: string | null,
): Promise<SoundHandle | null> {
  const fileName = await resolveBattleUnitSoundFile(stem, kind, fallbackStem)
  if (!fileName) {
    return null
  }
  const handle = await playSoundOnce(fileName, 1)
  if (handle && soundLog) {
    const ms = Math.round(performance.now() - soundLog.actionStartedMs)
    appendBattleAnimCombatLog(
      `${soundLog.unitName} (${stem}) ${kind} sound: ${fileName} at ${ms}ms since action start`,
    )
  }
  return handle
}

export function resetBattleUnitSoundWarnings(): void {
  warnedStem.clear()
}
