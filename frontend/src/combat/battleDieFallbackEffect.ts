import { Assets, Spritesheet, type Texture } from 'pixi.js'
import type { GameSession } from '../session/types'
import { loadSoundFile, playSoundOnce } from '../audio/soundPlayer'
import {
  animConfigRaw,
  nonNegativeAnimConfig,
} from '../config/animConfig'
import type { ReferenceCatalog } from '../town/catalog'
import { appendBattleAnimWorldLog } from './battleAnimConfig'
import type { BattleAnimSettings } from './battleAnimConfig'
import type { BattleUnitFrame } from './battleUnitSheet'

export const DIE_FALLBACK_EFFECT_DIR = '/assets/effects'
const EFFECT_DIR = DIE_FALLBACK_EFFECT_DIR
const SOUND_DIR = '/assets/sounds'

export type DieFallbackEffectSheet = {
  name: string
  restHeight: number
  soundStartPct: number
  frames: BattleUnitFrame[]
  atlasUrl: string
}

export type DieFallbackFxSchedule = {
  effectName: string
  fadeInStartMs: number
  diePhaseStartMs: number
  sequenceEndMs: number
  soundStartPct: number
}

const effectCache = new Map<string, DieFallbackEffectSheet | null>()
const effectInflight = new Map<string, Promise<DieFallbackEffectSheet | null>>()
let warnedFallbackConfig = false

type RawFrame = {
  frame?: { x?: number; y?: number; w?: number; h?: number }
  anchor?: { x?: number; y?: number }
}

function readAnchor(raw: RawFrame): { x: number; y: number } {
  const ax = Number(raw.anchor?.x)
  const ay = Number(raw.anchor?.y)
  return {
    x: Number.isFinite(ax) ? ax : 0.5,
    y: Number.isFinite(ay) ? ay : 1,
  }
}

export function dieFallbackEffectNames(
  catalog: ReferenceCatalog | null | undefined,
): string[] {
  const raw = animConfigRaw(catalog, 'die_fallback_effects')
  if (!raw?.trim()) {
    return []
  }
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

export function dieFxFadeInPct(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return nonNegativeAnimConfig(catalog, 'die_fx_fade_in_pct') ?? 50
}

export function dieFxFadeOutPct(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return nonNegativeAnimConfig(catalog, 'die_fx_fade_out_pct') ?? 30
}

export function warnDieFallbackUnavailable(
  session: GameSession,
  detail: string,
): GameSession {
  if (warnedFallbackConfig) {
    return session
  }
  warnedFallbackConfig = true
  return appendBattleAnimWorldLog(
    session,
    `[anim_config] die fallback effects: ${detail}`,
  )
}

export function resetDieFallbackSessionWarnings(): void {
  warnedFallbackConfig = false
}

export function formatDieFallbackCombatLogLine(
  unitName: string,
  effectName: string,
  sheet: DieFallbackEffectSheet | null | undefined,
): string {
  if (sheet) {
    return `${unitName} Die fallback: ${effectName} (loaded, ${sheet.frames.length} frames)`
  }
  return `${unitName} Die fallback: ${effectName} (missing: ${EFFECT_DIR}/${effectName}.json)`
}

function buildEffectSheet(
  name: string,
  textures: Record<string, Texture>,
  framesData: Record<string, RawFrame> | undefined,
  meta: Record<string, unknown>,
  atlasUrl: string,
  atlasW: number,
  atlasH: number,
): DieFallbackEffectSheet | null {
  const frameNames = Object.keys(textures).sort()
  const standName = `${name}_Stand`
  const standKey = frameNames.find(
    (key) => key === standName || key.endsWith(`/${standName}`),
  )
  const loopNames = standKey
    ? frameNames.filter((key) => key !== standKey)
    : frameNames
  const frames: BattleUnitFrame[] = []
  for (const key of loopNames) {
    const tex = textures[key]
    if (!tex || tex.width < 1) {
      continue
    }
    const raw = framesData?.[key]
    const anchor = raw ? readAnchor(raw) : { x: 0.5, y: 1 }
    const fr = raw?.frame
    frames.push({
      texture: tex,
      w: tex.width,
      h: tex.height,
      anchorX: anchor.x,
      anchorY: anchor.y,
      atlasUrl,
      atlasW,
      atlasH,
      rect: {
        x: Number(fr?.x) || 0,
        y: Number(fr?.y) || 0,
        w: Number(fr?.w) || tex.width,
        h: Number(fr?.h) || tex.height,
      },
    })
  }
  if (frames.length === 0) {
    return null
  }
  const restRaw = Number(meta.rest_height)
  const restHeight =
    Number.isFinite(restRaw) && restRaw > 0 ? restRaw : frames[0]!.h
  const soundRaw = Number(meta.sound_start_pct)
  const soundStartPct =
    Number.isFinite(soundRaw) && soundRaw >= 0 ? soundRaw : 0
  return {
    name,
    restHeight,
    soundStartPct,
    frames,
    atlasUrl,
  }
}

async function loadDieFallbackEffect(
  name: string,
): Promise<DieFallbackEffectSheet | null> {
  const key = name.toLowerCase()
  if (effectCache.has(key)) {
    return effectCache.get(key) ?? null
  }
  const inflight = effectInflight.get(key)
  if (inflight) {
    return inflight
  }
  const jsonUrl = `${EFFECT_DIR}/${name}.json`
  const promise = (async (): Promise<DieFallbackEffectSheet | null> => {
    try {
      const response = await fetch(jsonUrl)
      if (!response.ok) {
        effectCache.set(key, null)
        return null
      }
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.toLowerCase().includes('json')) {
        effectCache.set(key, null)
        return null
      }
      const data = (await response.json()) as {
        frames?: Record<string, RawFrame>
        meta?: Record<string, unknown> & { image?: string }
      }
      const imageName = data.meta?.image?.trim()
      const imageCandidates = [imageName, `${name}.png`].filter(
        (row): row is string => Boolean(row?.trim()),
      )
      if (imageCandidates.length === 0) {
        effectCache.set(key, null)
        return null
      }
      let atlasTexture: Texture | null = null
      let imageUrl = ''
      for (const candidate of imageCandidates) {
        imageUrl = `${EFFECT_DIR}/${candidate.replace(/^\/+/, '')}`
        try {
          const tex = await Assets.load<Texture>(imageUrl)
          if (tex.width >= 1 && tex.height >= 1) {
            atlasTexture = tex
            break
          }
        } catch {
          /* try next */
        }
      }
      if (!atlasTexture) {
        effectCache.set(key, null)
        return null
      }
      const metaSize = data.meta?.size as { w?: number; h?: number } | undefined
      const atlasW =
        Number(metaSize?.w) > 0 ? Number(metaSize?.w) : atlasTexture.width
      const atlasH =
        Number(metaSize?.h) > 0 ? Number(metaSize?.h) : atlasTexture.height
      const sheet = new Spritesheet({
        texture: atlasTexture,
        data: data as unknown as Spritesheet['data'],
        cachePrefix: `${name}/fx/`,
      })
      try {
        await sheet.parse()
      } catch {
        effectCache.set(key, null)
        return null
      }
      const built = buildEffectSheet(
        name,
        sheet.textures,
        data.frames,
        data.meta ?? {},
        imageUrl,
        atlasW,
        atlasH,
      )
      effectCache.set(key, built)
      return built
    } catch {
      effectCache.set(key, null)
      return null
    }
  })()
  effectInflight.set(key, promise)
  try {
    return await promise
  } finally {
    effectInflight.delete(key)
  }
}

export async function preloadDieFallbackEffects(
  catalog: ReferenceCatalog | null | undefined,
): Promise<Map<string, DieFallbackEffectSheet | null>> {
  const out = new Map<string, DieFallbackEffectSheet | null>()
  const names = dieFallbackEffectNames(catalog)
  await Promise.all(
    names.map(async (name) => {
      const sheet = await loadDieFallbackEffect(name)
      out.set(name, sheet)
    }),
  )
  return out
}

export function pickRandomLoadedDieFallbackEffect(
  catalog: ReferenceCatalog | null | undefined,
  loaded: Map<string, DieFallbackEffectSheet | null>,
): DieFallbackEffectSheet | null {
  const names = dieFallbackEffectNames(catalog).filter(
    (name) => loaded.get(name) != null,
  )
  if (names.length === 0) {
    return null
  }
  const pick = names[Math.floor(Math.random() * names.length)]!
  return loaded.get(pick) ?? null
}

export function computeDieFallbackSchedule(
  catalog: ReferenceCatalog | null | undefined,
  settings: BattleAnimSettings,
  effectName: string,
  soundStartPct: number,
  hitPhaseStartMs: number | null,
  nowMs = performance.now(),
): DieFallbackFxSchedule {
  const hitMs = settings.hitSec * 1000
  const dieMs = settings.dieSec * 1000
  const fadeInWindowMs = hitMs * (dieFxFadeInPct(catalog) / 100)
  let fadeInStartMs: number
  let diePhaseStartMs: number
  if (hitPhaseStartMs != null) {
    fadeInStartMs = hitPhaseStartMs + hitMs - fadeInWindowMs
    diePhaseStartMs = hitPhaseStartMs + hitMs
  } else {
    fadeInStartMs = nowMs
    diePhaseStartMs = nowMs + fadeInWindowMs
  }
  return {
    effectName,
    fadeInStartMs,
    diePhaseStartMs,
    sequenceEndMs: diePhaseStartMs + dieMs,
    soundStartPct,
  }
}

export function dieFallbackFxOpacity(
  schedule: DieFallbackFxSchedule,
  catalog: ReferenceCatalog | null | undefined,
  settings: BattleAnimSettings,
  nowMs: number,
): number {
  if (nowMs < schedule.fadeInStartMs) {
    return 0
  }
  const fadeOutStartMs =
    schedule.sequenceEndMs -
    settings.dieSec * 1000 * (dieFxFadeOutPct(catalog) / 100)
  if (nowMs < schedule.diePhaseStartMs) {
    const span = schedule.diePhaseStartMs - schedule.fadeInStartMs
    if (span <= 0) {
      return 1
    }
    return Math.min(
      1,
      Math.max(0, (nowMs - schedule.fadeInStartMs) / span),
    )
  }
  if (nowMs >= schedule.sequenceEndMs) {
    return 0
  }
  if (nowMs >= fadeOutStartMs) {
    const span = schedule.sequenceEndMs - fadeOutStartMs
    if (span <= 0) {
      return 0
    }
    return Math.min(
      1,
      Math.max(0, (schedule.sequenceEndMs - nowMs) / span),
    )
  }
  return 1
}

/** Static _Dead corpse under the skull once fade-in completes (die phase start). */
export function dieFallbackCorpseBodyVisible(
  schedule: DieFallbackFxSchedule | undefined,
  nowMs: number,
): boolean {
  if (!schedule) {
    return true
  }
  return nowMs >= schedule.diePhaseStartMs
}

export function dieFallbackFxFrame(
  sheet: DieFallbackEffectSheet,
  schedule: DieFallbackFxSchedule,
  settings: BattleAnimSettings,
  nowMs: number,
): BattleUnitFrame | null {
  if (nowMs < schedule.diePhaseStartMs) {
    return sheet.frames[0] ?? null
  }
  const dieMs = settings.dieSec * 1000
  const progress = Math.min(
    1,
    Math.max(0, (nowMs - schedule.diePhaseStartMs) / dieMs),
  )
  const idx = Math.min(
    sheet.frames.length - 1,
    Math.floor(progress * sheet.frames.length),
  )
  return sheet.frames[idx] ?? sheet.frames[0] ?? null
}

export function dieFallbackEffectScale(
  boxHeight: number,
  restHeight: number,
): number {
  if (restHeight < 1) {
    return 1
  }
  return boxHeight / restHeight
}

async function sleepUntil(targetMs: number, isCancelled?: () => boolean): Promise<void> {
  while (performance.now() < targetMs) {
    if (isCancelled?.()) {
      return
    }
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, Math.min(32, targetMs - performance.now()))
    })
  }
}

export async function playDieFallbackSoundIfPresent(
  effectName: string,
): Promise<void> {
  const file = `${SOUND_DIR}/${effectName}.mp3`
  if (!(await loadSoundFile(file))) {
    return
  }
  void playSoundOnce(file, 1)
}

export function applyDieFallbackScheduleVisual(
  setStackVisuals: import('react').Dispatch<
    import('react').SetStateAction<
      Record<string, import('./combatUnitAnimVisual').StackBattleVisual>
    >
  >,
  stackId: string,
  schedule: DieFallbackFxSchedule,
  merge?: import('./combatUnitAnimVisual').StackBattleVisual,
): void {
  setStackVisuals((prev) => ({
    ...prev,
    [stackId]: {
      ...(merge ?? prev[stackId] ?? {
        kind: 'idle' as const,
        startedMs: schedule.fadeInStartMs,
        frameOffset: 0,
      }),
      dieFallbackFx: schedule,
    },
  }))
}

export async function awaitDieFallbackTimelineTail(opts: {
  schedule: DieFallbackFxSchedule
  settings: BattleAnimSettings
  effectName: string
  onDieStart?: () => void
  isCancelled?: () => boolean
  /** When true, caller already waited until die phase start. */
  atDiePhase?: boolean
}): Promise<void> {
  if (!opts.atDiePhase) {
    await sleepUntil(opts.schedule.diePhaseStartMs, opts.isCancelled)
  }
  if (opts.isCancelled?.()) {
    return
  }
  opts.onDieStart?.()
  const soundAt =
    opts.schedule.diePhaseStartMs +
    opts.settings.dieSec * 1000 * opts.schedule.soundStartPct
  await sleepUntil(soundAt, opts.isCancelled)
  if (!opts.isCancelled?.()) {
    void playDieFallbackSoundIfPresent(opts.effectName)
  }
  await sleepUntil(opts.schedule.sequenceEndMs, opts.isCancelled)
}

export async function runBattleDieFallbackTimeline(opts: {
  stackId: string
  catalog: ReferenceCatalog
  settings: BattleAnimSettings
  loadedEffects: Map<string, DieFallbackEffectSheet | null>
  setStackVisuals: import('react').Dispatch<
    import('react').SetStateAction<
      Record<string, import('./combatUnitAnimVisual').StackBattleVisual>
    >
  >
  hitPhaseStartMs: number | null
  onDieStart?: () => void
  isCancelled?: () => boolean
}): Promise<boolean> {
  const effect = pickRandomLoadedDieFallbackEffect(
    opts.catalog,
    opts.loadedEffects,
  )
  if (!effect) {
    return false
  }
  const schedule = computeDieFallbackSchedule(
    opts.catalog,
    opts.settings,
    effect.name,
    effect.soundStartPct,
    opts.hitPhaseStartMs,
    opts.hitPhaseStartMs ?? performance.now(),
  )
  applyDieFallbackScheduleVisual(
    opts.setStackVisuals,
    opts.stackId,
    schedule,
  )
  if (opts.hitPhaseStartMs == null) {
    await sleepUntil(schedule.diePhaseStartMs, opts.isCancelled)
  } else {
    await sleepUntil(schedule.diePhaseStartMs, opts.isCancelled)
  }
  if (opts.isCancelled?.()) {
    return true
  }
  await awaitDieFallbackTimelineTail({
    schedule,
    settings: opts.settings,
    effectName: effect.name,
    onDieStart: opts.onDieStart,
    isCancelled: opts.isCancelled,
    atDiePhase: true,
  })
  opts.setStackVisuals((prev) => {
    const row = prev[opts.stackId]
    if (!row?.dieFallbackFx) {
      return prev
    }
    const { dieFallbackFx: _drop, ...rest } = row
    return {
      ...prev,
      [opts.stackId]: {
        ...rest,
        kind: 'idle' as const,
        startedMs: performance.now(),
        frameOffset: 0,
        flipX: rest.flipX ?? row.flipX,
        corpseBody: true,
      },
    }
  })
  return true
}

export async function runBattleDieFallbackAfterHit(opts: {
  stackId: string
  catalog: ReferenceCatalog
  settings: BattleAnimSettings
  schedule: DieFallbackFxSchedule
  setStackVisuals: import('react').Dispatch<
    import('react').SetStateAction<
      Record<string, import('./combatUnitAnimVisual').StackBattleVisual>
    >
  >
  onDieStart?: () => void
  isCancelled?: () => boolean
}): Promise<void> {
  await awaitDieFallbackTimelineTail({
    schedule: opts.schedule,
    settings: opts.settings,
    effectName: opts.schedule.effectName,
    onDieStart: opts.onDieStart,
    isCancelled: opts.isCancelled,
    atDiePhase: true,
  })
  opts.setStackVisuals((prev) => {
    const row = prev[opts.stackId]
    if (!row?.dieFallbackFx) {
      return prev
    }
    const { dieFallbackFx: _drop, ...rest } = row
    return {
      ...prev,
      [opts.stackId]: {
        ...rest,
        kind: 'idle' as const,
        startedMs: performance.now(),
        frameOffset: 0,
        flipX: rest.flipX ?? row.flipX,
        corpseBody: true,
      },
    }
  })
}

export function tryPrimeDieFallbackSchedule(
  catalog: ReferenceCatalog,
  settings: BattleAnimSettings,
  loadedEffects: Map<string, DieFallbackEffectSheet | null>,
  hitPhaseStartMs: number,
): { schedule: DieFallbackFxSchedule; effect: DieFallbackEffectSheet } | null {
  const effect = pickRandomLoadedDieFallbackEffect(catalog, loadedEffects)
  if (!effect) {
    return null
  }
  const schedule = computeDieFallbackSchedule(
    catalog,
    settings,
    effect.name,
    effect.soundStartPct,
    hitPhaseStartMs,
    hitPhaseStartMs,
  )
  return { schedule, effect }
}
