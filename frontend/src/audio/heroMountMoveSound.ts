import { mountMoveSheetStem } from '../hex/heroMountMoveAnim'
import {
  loadSoundFile,
  logSoundProblem,
  playExclusiveLoop,
  setExclusiveLoopRate,
  stopExclusiveLoop,
} from './soundPlayer'

import type { GameSession } from '../session/types'

const warnedMountStem = new Set<string>()
let mountLoopPlaying = false

export function mountMoveSoundFileNameForStem(stem: string): string {
  return `${stem}.mp3`
}

/** @deprecated Prefer {@link mountMoveSoundFileNameForStem}. */
export function mountMoveSoundFileName(className: string): string {
  return mountMoveSoundFileNameForStem(mountMoveSheetStem(className))
}

async function resolveMountMoveSoundFile(
  stem: string,
): Promise<{ file: string | null; primary: string }> {
  const primary = mountMoveSoundFileNameForStem(stem)
  if (await loadSoundFile(primary)) {
    return { file: primary, primary }
  }
  const fallback = 'Mount_Move.mp3'
  if (await loadSoundFile(fallback)) {
    return { file: fallback, primary }
  }
  return { file: null, primary }
}

export function warnMountMoveSoundMissingStem(
  session: GameSession,
  stem: string,
): GameSession {
  if (warnedMountStem.has(stem)) {
    return session
  }
  warnedMountStem.add(stem)
  return logSoundProblem(session, `${stem}.mp3`, 'not found, silent')
}

/** @deprecated Prefer {@link warnMountMoveSoundMissingStem}. */
export function warnMountMoveSoundMissing(
  session: GameSession,
  className: string,
): GameSession {
  return warnMountMoveSoundMissingStem(session, mountMoveSheetStem(className))
}

export type MountMoveSoundStart = 'playing' | 'missing' | 'blocked'

/** Start one loop for a path; replaces any prior mount loop. */
export async function beginMountMoveSoundForStem(
  stem: string,
  playbackRate: number,
): Promise<MountMoveSoundStart> {
  const { file } = await resolveMountMoveSoundFile(stem)
  if (!file) {
    mountLoopPlaying = false
    return 'missing'
  }
  const rate =
    Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1
  const handle = await playExclusiveLoop(file, rate)
  if (!handle) {
    mountLoopPlaying = false
    return 'blocked'
  }
  mountLoopPlaying = true
  return 'playing'
}

/** @deprecated Prefer {@link beginMountMoveSoundForStem}. */
export async function beginMountMoveSound(
  className: string,
  playbackRate: number,
): Promise<MountMoveSoundStart> {
  return beginMountMoveSoundForStem(mountMoveSheetStem(className), playbackRate)
}

export function setMountMoveSoundRate(playbackRate: number): void {
  if (!mountLoopPlaying) {
    return
  }
  const rate =
    Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1
  setExclusiveLoopRate(rate)
}

export function stopMountMoveSound(fadeMs = 200): void {
  mountLoopPlaying = false
  stopExclusiveLoop(fadeMs)
}

export function cutMountMoveSound(): void {
  mountLoopPlaying = false
  stopExclusiveLoop(0)
}
