import type { GameSession } from '../session/types'
import {
  appendLogEntry,
  logViewPlayerId,
} from '../session/gameLog'
import { loadPlayerSettings } from '../settings/playerSettings'

export const SOUNDS_DIR = '/assets/sounds'

const loadCache = new Map<string, Promise<string | null>>()
const warnedFile = new Set<string>()
const devWarnings: string[] = []

let unlockInstalled = false

/** Effects channel 0–1 (Settings has no separate master slider). */
export function effectsVolume(): number {
  return Math.min(1, Math.max(0, loadPlayerSettings().volumeEffects / 100))
}

export function soundDevWarnings(): string[] {
  return devWarnings
}

export function logSoundProblem(
  session: GameSession,
  fileName: string,
  detail: string,
): GameSession {
  const key = fileName.trim().toLowerCase()
  if (warnedFile.has(key)) {
    return session
  }
  warnedFile.add(key)
  const message = `${fileName}: ${detail}`
  devWarnings.push(message)
  return appendLogEntry(session, logViewPlayerId(session), 'world', 'sound', {
    message,
  })
}

function applyPreservesPitch(audio: HTMLAudioElement): void {
  audio.preservesPitch = true
  const extended = audio as HTMLAudioElement & {
    mozPreservesPitch?: boolean
    webkitPreservesPitch?: boolean
  }
  extended.mozPreservesPitch = true
  extended.webkitPreservesPitch = true
}

function soundUrl(fileName: string): string {
  const bare = fileName.trim().replace(/^\/+/, '')
  return `${SOUNDS_DIR}/${bare}`
}

/** Load URL by file name; cache success/failure. */
export async function loadSoundFile(fileName: string): Promise<string | null> {
  const key = fileName.trim().toLowerCase()
  if (!key) {
    return null
  }
  const inflight = loadCache.get(key)
  if (inflight) {
    return inflight
  }
  const promise = (async () => {
    const url = soundUrl(fileName)
    try {
      const response = await fetch(url, { method: 'HEAD' })
      const type = response.headers.get('content-type') ?? ''
      if (
        !response.ok ||
        (!type.toLowerCase().includes('audio') &&
          !type.toLowerCase().includes('octet'))
      ) {
        return null
      }
      return url
    } catch {
      return null
    }
  })()
  loadCache.set(key, promise)
  return promise
}

/** First click/key marks audio allowed; play failures stay silent. */
export function installAudioUnlock(): void {
  if (unlockInstalled || typeof window === 'undefined') {
    return
  }
  unlockInstalled = true
  const mark = () => {
    /* gesture received — play() may succeed afterwards */
  }
  window.addEventListener('pointerdown', mark, { capture: true, once: true })
  window.addEventListener('keydown', mark, { capture: true, once: true })
}

export type SoundHandle = {
  setPlaybackRate(rate: number): void
  setVolume(volume: number): void
  stop(fadeMs?: number): void
}

type ActiveSound = {
  audio: HTMLAudioElement
  fadeRaf: number | null
  baseVolume: number
  onStopped?: () => void
}

function cancelFade(entry: ActiveSound): void {
  if (entry.fadeRaf != null) {
    cancelAnimationFrame(entry.fadeRaf)
    entry.fadeRaf = null
  }
}

function stopEntry(entry: ActiveSound, fadeMs: number): void {
  cancelFade(entry)
  const audio = entry.audio
  const finish = () => {
    audio.volume = entry.baseVolume
    entry.onStopped?.()
  }
  if (fadeMs <= 0) {
    audio.pause()
    try {
      audio.currentTime = 0
    } catch {
      /* ignore */
    }
    finish()
    return
  }
  const startVol = audio.volume
  const start = performance.now()
  const step = () => {
    const t = Math.min(1, (performance.now() - start) / fadeMs)
    audio.volume = startVol * (1 - t)
    if (t >= 1) {
      entry.fadeRaf = null
      audio.pause()
      try {
        audio.currentTime = 0
      } catch {
        /* ignore */
      }
      finish()
      return
    }
    entry.fadeRaf = requestAnimationFrame(step)
  }
  entry.fadeRaf = requestAnimationFrame(step)
}

function wrapHandle(entry: ActiveSound): SoundHandle {
  return {
    setPlaybackRate(rate: number) {
      if (Number.isFinite(rate) && rate > 0) {
        entry.audio.playbackRate = rate
      }
    },
    setVolume(volume: number) {
      entry.baseVolume = Math.min(1, Math.max(0, volume))
      if (entry.fadeRaf == null) {
        entry.audio.volume = entry.baseVolume
      }
    },
    stop(fadeMs = 200) {
      stopEntry(entry, fadeMs)
    },
  }
}

async function startSound(
  fileName: string,
  opts: { loop: boolean; rate: number; volume: number },
  onStopped?: () => void,
): Promise<SoundHandle | null> {
  const url = await loadSoundFile(fileName)
  if (!url) {
    return null
  }
  const audio = new Audio(url)
  applyPreservesPitch(audio)
  const entry: ActiveSound = {
    audio,
    fadeRaf: null,
    baseVolume: opts.volume,
    onStopped,
  }
  audio.volume = opts.volume
  audio.loop = opts.loop
  audio.playbackRate = opts.rate
  try {
    await audio.play()
  } catch {
    return null
  }
  return wrapHandle(entry)
}

/** Play once; volume = effects slider at start. */
export async function playSoundOnce(
  fileName: string,
  rate = 1,
): Promise<SoundHandle | null> {
  return startSound(
    fileName,
    { loop: false, rate, volume: effectsVolume() },
    undefined,
  )
}

let exclusiveLoop: SoundHandle | null = null
let exclusiveLoopStop: (() => void) | null = null

/** Single loop instance; stops any previous loop immediately. */
export async function playExclusiveLoop(
  fileName: string,
  rate: number,
): Promise<SoundHandle | null> {
  if (exclusiveLoop) {
    exclusiveLoop.stop(0)
    exclusiveLoop = null
    exclusiveLoopStop = null
  }
  const handle = await startSound(
    fileName,
    { loop: true, rate, volume: effectsVolume() },
    () => {
      if (exclusiveLoop === handle) {
        exclusiveLoop = null
        exclusiveLoopStop = null
      }
    },
  )
  if (handle) {
    exclusiveLoop = handle
    exclusiveLoopStop = () => handle.stop(0)
  }
  return handle
}

export function setExclusiveLoopRate(rate: number): void {
  exclusiveLoop?.setPlaybackRate(rate)
}

export function stopExclusiveLoop(fadeMs = 200): void {
  if (exclusiveLoop) {
    exclusiveLoop.stop(fadeMs)
    exclusiveLoop = null
    exclusiveLoopStop = null
  }
}

/** Hard stop (new move overriding a fading loop). */
export function cutExclusiveLoop(): void {
  exclusiveLoopStop?.()
  exclusiveLoop = null
  exclusiveLoopStop = null
}
