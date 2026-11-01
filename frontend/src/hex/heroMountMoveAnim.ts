import { Assets, Spritesheet, type Texture } from 'pixi.js'
import type { GameSession, Hero } from '../session/types'
import {
  appendLogEntry,
  logViewPlayerId,
  playerSeesHex,
} from '../session/gameLog'
import { humanPlayer } from '../session/accessors'
import {
  positiveAnimConfig,
} from '../config/animConfig'
import {
  getCachedCatalog,
  heroTypeName,
  type ReferenceCatalog,
} from '../town/catalog'
import {
  HERO_TRAVEL_SPRITE_DIR,
  type HeroTravelFacing,
} from './heroTravelSprite'
import { classMountMoveSheetStem } from './moveSheetStems'

export type MountMoveSheet = {
  /** Static pose (`{stem}_Stand`, or first sorted frame if missing). */
  stand: Texture
  /** Walk cycle frames only — never includes `_Stand`. */
  loopFrames: Texture[]
}

/** Frame name for the static pose on any move sheet (transports/units later). */
export function spriteSheetStandFrameName(stem: string): string {
  return `${stem}_Stand`
}

function textureKeyMatchesStand(name: string, stem: string): boolean {
  const standName = spriteSheetStandFrameName(stem)
  return name === standName || name.endsWith(`/${standName}`)
}

function buildMountMoveSheet(
  stem: string,
  textures: Record<string, Texture>,
): MountMoveSheet | null {
  const frameNames = Object.keys(textures).sort()
  const valid = (name: string): Texture | null => {
    const tex = textures[name]
    return tex != null && tex.width >= 1 ? tex : null
  }
  const standKey = frameNames.find((name) => textureKeyMatchesStand(name, stem))
  const standFromKey = standKey ? valid(standKey) : null
  const loopNames = standKey
    ? frameNames.filter((name) => name !== standKey)
    : frameNames
  const loopFrames = loopNames
    .map((name) => valid(name))
    .filter((tex): tex is Texture => tex != null)
  const allFrames = frameNames
    .map((name) => valid(name))
    .filter((tex): tex is Texture => tex != null)
  if (allFrames.length === 0) {
    return null
  }
  const stand = standFromKey ?? allFrames[0]!
  return {
    stand,
    loopFrames: standFromKey ? loopFrames : allFrames,
  }
}

export function mountMoveLoopFrameCount(sheet: MountMoveSheet): number {
  return sheet.loopFrames.length
}

export type MountMoveSettings = {
  secPerHex: number | null
  animFps: number | null
}

const sheetCache = new Map<string, MountMoveSheet | null>()
const sheetInflight = new Map<string, Promise<MountMoveSheetLoadResult>>()
const warnedMissingStem = new Set<string>()
const warnedConfigKey = new Set<string>()
const devWarnings: string[] = []

function warnConfigOnce(
  session: GameSession,
  key: string,
  message: string,
): GameSession {
  if (warnedConfigKey.has(key)) {
    return session
  }
  warnedConfigKey.add(key)
  devWarnings.push(message)
  return appendLogEntry(session, logViewPlayerId(session), 'world', 'mount_anim', {
    message,
  })
}

/** Stem without extension, e.g. `Mount_Cleric_Move`. */
export function mountMoveSheetStem(className: string): string {
  return classMountMoveSheetStem(className)
}

export function mountMoveSettings(
  catalog: ReferenceCatalog | null | undefined,
): MountMoveSettings {
  return {
    secPerHex: positiveAnimConfig(catalog, 'mount_move_sec_per_hex'),
    animFps: positiveAnimConfig(catalog, 'mount_anim_fps'),
  }
}

export function ensureMountMoveConfigWarnings(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
): GameSession {
  let next = session
  const settings = mountMoveSettings(catalog)
  if (settings.secPerHex == null && !warnedConfigKey.has('mount_move_sec_per_hex')) {
    next = warnConfigOnce(
      next,
      'mount_move_sec_per_hex',
      '[anim_config] mount_move_sec_per_hex missing or invalid — hero map moves use step timing (no slide).',
    )
  }
  if (settings.animFps == null && !warnedConfigKey.has('mount_anim_fps')) {
    next = warnConfigOnce(
      next,
      'mount_anim_fps',
      '[anim_config] mount_anim_fps missing or invalid — mount move sheets stay static.',
    )
  }
  return next
}

export function mountAnimDevWarnings(): string[] {
  return devWarnings
}

export function reportMountMoveSheetMissing(
  session: GameSession,
  className: string,
  fail: { url: string; reason: string },
): GameSession {
  const stem = mountMoveSheetStem(className)
  if (warnedMissingStem.has(stem)) {
    return session
  }
  warnedMissingStem.add(stem)
  const message = `${stem}: ${fail.url} - ${fail.reason} (static used)`
  devWarnings.push(message)
  return appendLogEntry(session, logViewPlayerId(session), 'world', 'mount_anim', {
    message,
  })
}

export type MountMoveSheetLoadResult = {
  sheet: MountMoveSheet | null
  fail?: { url: string; reason: string }
}

const sheetFailCache = new Map<string, { url: string; reason: string }>()

async function loadSheetByStem(stem: string): Promise<MountMoveSheetLoadResult> {
  const cacheKey = stem.toLowerCase()
  if (sheetCache.has(cacheKey)) {
    const cached = sheetCache.get(cacheKey)
    if (cached) {
      return { sheet: cached }
    }
    const fail = sheetFailCache.get(cacheKey)
    return fail ? { sheet: null, fail } : { sheet: null }
  }
  const inflight = sheetInflight.get(cacheKey)
  if (inflight) {
    return inflight
  }
  const jsonUrl = `${HERO_TRAVEL_SPRITE_DIR}/${stem}.json`
  const promise = (async (): Promise<MountMoveSheetLoadResult> => {
    const recordFail = (url: string, reason: string): MountMoveSheetLoadResult => {
      const fail = { url, reason }
      sheetCache.set(cacheKey, null)
      sheetFailCache.set(cacheKey, fail)
      return { sheet: null, fail }
    }
    try {
      const response = await fetch(jsonUrl)
      if (!response.ok) {
        return recordFail(jsonUrl, `HTTP ${response.status}`)
      }
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.toLowerCase().includes('json')) {
        return recordFail(
          jsonUrl,
          `unexpected content-type ${contentType.trim() || 'none'}`,
        )
      }
      const data = (await response.json()) as {
        frames?: Record<string, unknown>
        meta?: { image?: string }
      }
      const imageName = data.meta?.image?.trim()
      const imageCandidates = [
        imageName,
        `${stem}.png`,
      ].filter((name): name is string => Boolean(name?.trim()))
      if (imageCandidates.length === 0) {
        return recordFail(jsonUrl, 'json missing meta.image')
      }
      let atlasTexture: Texture | null = null
      let imageUrl = ''
      for (const candidate of imageCandidates) {
        imageUrl = `${HERO_TRAVEL_SPRITE_DIR}/${candidate.replace(/^\/+/, '')}`
        try {
          const tex = await Assets.load<Texture>(imageUrl)
          if (tex.width >= 1 && tex.height >= 1) {
            atlasTexture = tex
            break
          }
        } catch {
          /* try next candidate */
        }
      }
      if (!atlasTexture) {
        return recordFail(imageUrl || jsonUrl, 'texture load error')
      }
      const sheet = new Spritesheet({
        texture: atlasTexture,
        data: data as Spritesheet['data'],
        cachePrefix: `${stem}/`,
      })
      try {
        await sheet.parse()
      } catch {
        return recordFail(jsonUrl, 'spritesheet parse error')
      }
      const built = buildMountMoveSheet(stem, sheet.textures)
      if (!built) {
        return recordFail(jsonUrl, 'no frames after parse')
      }
      const loaded: MountMoveSheet = built
      sheetCache.set(cacheKey, loaded)
      sheetFailCache.delete(cacheKey)
      return { sheet: loaded }
    } catch {
      return recordFail(jsonUrl, 'load error')
    } finally {
      sheetInflight.delete(cacheKey)
    }
  })()
  sheetInflight.set(cacheKey, promise)
  return promise
}

export async function loadMountMoveSheetByStem(
  stem: string,
): Promise<MountMoveSheetLoadResult> {
  return loadSheetByStem(stem)
}

/** Sync HexMap stem map from the module loader cache (preload / prior loads). */
export function syncMoveSheetStemFromLoaderCache(
  stem: string,
  sheets: Map<string, MountMoveSheet | null>,
): MountMoveSheetLoadResult | null {
  const key = stem.toLowerCase()
  if (!sheetCache.has(key) && !sheetFailCache.has(key)) {
    return null
  }
  const sheet = sheetCache.get(key) ?? null
  const had = sheets.has(key)
  const prev = had ? sheets.get(key) : undefined
  sheets.set(key, sheet)
  const fail = sheetFailCache.get(key)
  const result = fail ? { sheet: null, fail } : { sheet }
  if (!had || prev !== sheet) {
    return result
  }
  return null
}

export function isMoveSheetStemLoading(stem: string): boolean {
  return sheetInflight.has(stem.toLowerCase())
}

export function reportMountMoveSheetMissingStem(
  session: GameSession,
  stem: string,
  fail: { url: string; reason: string },
): GameSession {
  if (warnedMissingStem.has(stem)) {
    return session
  }
  warnedMissingStem.add(stem)
  const message = `${stem}: ${fail.url} - ${fail.reason} (static used)`
  devWarnings.push(message)
  return appendLogEntry(session, logViewPlayerId(session), 'world', 'mount_anim', {
    message,
  })
}

export function ensureMoveSheetStemLoading(
  stem: string,
  sheets: Map<string, MountMoveSheet | null>,
  loading: Set<string>,
  onDone: (result: MountMoveSheetLoadResult) => void,
): void {
  const key = stem.toLowerCase()
  if (sheets.has(key)) {
    return
  }
  const synced = syncMoveSheetStemFromLoaderCache(stem, sheets)
  if (synced != null) {
    queueMicrotask(() => onDone(synced))
    return
  }
  if (loading.has(key)) {
    return
  }
  loading.add(key)
  void loadMountMoveSheetByStem(stem).then((result) => {
    sheets.set(key, result.sheet)
    loading.delete(key)
    queueMicrotask(() => onDone(result))
  })
}

export async function loadMountMoveSheetForClassName(
  className: string,
): Promise<MountMoveSheetLoadResult> {
  const stem = mountMoveSheetStem(className)
  return loadSheetByStem(stem)
}

export async function loadMountMoveSheetForClass(
  catalog: ReferenceCatalog | null | undefined,
  classId: number,
): Promise<MountMoveSheetLoadResult> {
  const name = catalog ? heroTypeName(catalog, classId) : ''
  if (!name) {
    return { sheet: null, fail: { url: '', reason: 'unknown class' } }
  }
  return loadMountMoveSheetForClassName(name)
}

export function mountMoveFrameFromAcc(
  animFrameAcc: number,
  frameCount: number,
): number {
  if (frameCount <= 0) {
    return 0
  }
  const idx = Math.floor(animFrameAcc) % frameCount
  return idx < 0 ? idx + frameCount : idx
}

/** Standing or moving frame from a loaded sheet (`_Stand` when idle). */
export function textureFromMountMoveSheet(
  sheet: MountMoveSheet,
  opts: {
    moving: boolean
    animFrameAcc: number
    animFps: number | null
    flipXMoving: boolean
    flipXStanding: boolean
  },
): { texture: Texture; flipX: boolean } {
  const standing = sheet.stand
  const loopCount = sheet.loopFrames.length
  if (opts.moving && opts.animFps != null && loopCount > 0) {
    const idx = mountMoveFrameFromAcc(opts.animFrameAcc, loopCount)
    return {
      texture: sheet.loopFrames[idx] ?? standing,
      flipX: opts.flipXMoving,
    }
  }
  return {
    texture: standing,
    flipX: opts.moving ? opts.flipXMoving : opts.flipXStanding,
  }
}

export function ensureMountMoveSheetLoading(
  catalog: ReferenceCatalog | null | undefined,
  classId: number,
  sheets: Map<number, MountMoveSheet | null>,
  loading: Set<number>,
  onDone: (result: MountMoveSheetLoadResult) => void,
): void {
  if (sheets.has(classId) || loading.has(classId)) {
    return
  }
  loading.add(classId)
  void loadMountMoveSheetForClass(catalog, classId).then((result) => {
    sheets.set(classId, result.sheet)
    loading.delete(classId)
    onDone(result)
  })
}

export function preloadAllMountMoveSheets(
  catalog: ReferenceCatalog | null | undefined,
  sheets: Map<string, MountMoveSheet | null>,
  loading: Set<string>,
  onDone: (result: MountMoveSheetLoadResult, stem: string) => void,
): void {
  if (!catalog) {
    return
  }
  for (const row of catalog.hero_type) {
    if (!row.name?.trim()) {
      continue
    }
    const stem = mountMoveSheetStem(row.name)
    ensureMoveSheetStemLoading(stem, sheets, loading, (result) =>
      onDone(result, stem),
    )
  }
}

/** Same numeric cost charged for MP; invalid values log once and use 1 for timing. */
export function moveStepTimingCost(
  session: GameSession,
  q: number,
  r: number,
  chargedCost: number,
): { timingCost: number; session: GameSession } {
  if (Number.isFinite(chargedCost) && chargedCost > 0) {
    return { timingCost: chargedCost, session }
  }
  const message = `Move step (${q},${r}): invalid movement cost for slide timing — using 1.`
  devWarnings.push(message)
  return {
    timingCost: 1,
    session: appendLogEntry(session, logViewPlayerId(session), 'world', 'mount_anim', {
      message,
    }),
  }
}

export function mountMoveFrameIndex(
  animStartMs: number,
  fps: number,
  frameCount: number,
  now = performance.now(),
): number {
  if (frameCount <= 0 || fps <= 0) {
    return 0
  }
  const elapsed = Math.max(0, now - animStartMs)
  return Math.floor(elapsed / (1000 / fps)) % frameCount
}

export function flipMountForFacing(
  facing: HeroTravelFacing,
  artFaces: HeroTravelFacing = 'left',
): boolean {
  return facing !== artFaces
}

/** Human-facing heroes animate; enemy moves entirely in human fog stay instant. */
export function worldHeroMoveVisibleToHuman(
  session: GameSession,
  hero: Hero,
): boolean {
  const human = humanPlayer(session)
  if (!human) {
    return true
  }
  if (hero.player_id === human.id) {
    return true
  }
  return playerSeesHex(human, hero.position.q, hero.position.r)
}

export function preloadMountMoveSheets(catalog?: ReferenceCatalog | null): void {
  const ref = catalog ?? getCachedCatalog()
  if (!ref) {
    return
  }
  for (const row of ref.hero_type) {
    if (row.name?.trim()) {
      void loadMountMoveSheetForClassName(row.name)
    }
  }
}
