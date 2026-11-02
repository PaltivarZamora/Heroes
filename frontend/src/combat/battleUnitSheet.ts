import { Assets, Spritesheet, type Texture } from 'pixi.js'
import type { GameSession } from '../session/types'
import {
  unitAssetsTownBase,
} from '../town/slotArt'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import {
  flushAdvancedBorrowDevLog,
  noteAdvancedSheetBorrow,
} from '../town/unitArtFallback'
import { basicPartnerForAdvanced } from '../town/unitUpgrade'
import { appendBattleAnimWorldLog } from './battleAnimConfig'

export const BATTLE_UNIT_ANIMS = ['Idle', 'Move', 'Attack', 'Hit', 'Die'] as const
export type BattleUnitAnimKind = (typeof BATTLE_UNIT_ANIMS)[number]

export type BattleUnitFrame = {
  texture: Texture
  w: number
  h: number
  anchorX: number
  anchorY: number
  atlasUrl: string
  atlasW: number
  atlasH: number
  rect: { x: number; y: number; w: number; h: number }
}

export type BattleUnitAnimSheet = {
  kind: BattleUnitAnimKind
  loop: boolean
  restHeight: number
  soundStartPct: number
  stand: BattleUnitFrame | null
  frames: BattleUnitFrame[]
  atlasUrl: string
  /** Basic partner sheet borrowed for an advanced unit (gold glow). */
  borrowedGlow?: boolean
}

export type BattleUnitSheetSet = {
  stem: string
  townFolder: string
  sheets: Partial<Record<BattleUnitAnimKind, BattleUnitAnimSheet>>
  /** True when at least one anim sheet loaded (not just static portrait). */
  animated: boolean
  hasDie: boolean
  /** Basic partner stem for per-anim sound fallback. */
  partnerSoundStem?: string | null
}

const sheetCache = new Map<string, BattleUnitSheetSet | null>()
const sheetInflight = new Map<string, Promise<BattleUnitSheetSet | null>>()
const sheetFailCache = new Map<string, { url: string; reason: string }>()
const warnedMissingSheet = new Set<string>()
const warnedMissingUnitType = new Set<number>()

/** Bare unit static filename from `unit.image_path` (no directory). */
export function unitStaticImageFileName(
  imagePath: string | null | undefined,
): string | null {
  if (!imagePath?.trim()) {
    return null
  }
  const base = imagePath.trim().replace(/^.*[/\\]/, '')
  return base || null
}

/**
 * Battle anim / sound / _Dead stem: `{name}_Stand.png` → `{name}`.
 * New unit static naming only — paths without `_Stand` before the extension yield null.
 */
function imageStem(imagePath: string | null | undefined): string | null {
  const file = unitStaticImageFileName(imagePath)
  if (!file) {
    return null
  }
  const withoutExt = file.replace(/\.(png|webp|jpe?g)$/i, '')
  if (!withoutExt || !/_Stand$/i.test(withoutExt)) {
    return null
  }
  const stem = withoutExt.replace(/_Stand$/i, '')
  return stem || null
}

export function unitBattleSpriteStem(unit: UnitRow | null | undefined): string | null {
  return imageStem(unit?.image_path)
}

export function unitBattleTownFolder(
  catalog: ReferenceCatalog,
  unit: UnitRow,
): string {
  const townId = unit.town_id
  if (townId != null && townId > 0) {
    const row = catalog.town.find((entry) => entry.id === townId)
    if (row?.name?.trim()) {
      return row.name.trim()
    }
  }
  return 'Citadel'
}

export function battleUnitTownDir(townFolder: string): string {
  return unitAssetsTownBase(townFolder)
}

/** @deprecated Use {@link battleUnitTownDir}. */
export function battleUnitSpritesDir(townFolder: string): string {
  return battleUnitTownDir(townFolder)
}

function standFrameName(stem: string, kind: BattleUnitAnimKind): string {
  return `${stem}_${kind}_Stand`
}

function textureKeyMatchesStand(name: string, stem: string, kind: BattleUnitAnimKind): boolean {
  const standName = standFrameName(stem, kind)
  return name === standName || name.endsWith(`/${standName}`)
}

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

function buildAnimSheet(
  stem: string,
  kind: BattleUnitAnimKind,
  textures: Record<string, Texture>,
  framesData: Record<string, RawFrame> | undefined,
  meta: Record<string, unknown>,
  atlasUrl: string,
  atlasW: number,
  atlasH: number,
): BattleUnitAnimSheet | null {
  const frameNames = Object.keys(textures).sort()
  const standKey = frameNames.find((name) =>
    textureKeyMatchesStand(name, stem, kind),
  )
  const loopNames = standKey
    ? frameNames.filter((name) => name !== standKey)
    : frameNames
  const frames: BattleUnitFrame[] = []
  for (const name of loopNames) {
    const tex = textures[name]
    if (!tex || tex.width < 1) {
      continue
    }
    const raw = framesData?.[name]
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
  let stand: BattleUnitFrame | null = null
  if (standKey) {
    const tex = textures[standKey]
    if (tex && tex.width >= 1) {
      const raw = framesData?.[standKey]
      const anchor = raw ? readAnchor(raw) : { x: 0.5, y: 1 }
      const fr = raw?.frame
      stand = {
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
      }
    }
  }
  if (frames.length === 0 && !stand) {
    return null
  }
  const loopRaw = meta.loop
  const loop =
    typeof loopRaw === 'boolean'
      ? loopRaw
      : kind === 'Idle' || kind === 'Move'
  const restRaw = Number(meta.rest_height)
  const restHeight = Number.isFinite(restRaw) && restRaw > 0 ? restRaw : frames[0]?.h ?? stand?.h ?? 1
  const soundRaw = Number(meta.sound_start_pct)
  const soundStartPct =
    Number.isFinite(soundRaw) && soundRaw >= 0 && soundRaw <= 1 ? soundRaw : 0
  return {
    kind,
    loop,
    restHeight,
    soundStartPct,
    stand,
    frames,
    atlasUrl,
  }
}

async function loadOneAnimSheet(
  dir: string,
  stem: string,
  kind: BattleUnitAnimKind,
): Promise<{ sheet: BattleUnitAnimSheet | null; fail?: { url: string; reason: string } }> {
  const sheetStem = `${stem}_${kind}`
  const jsonUrl = `${dir}/${sheetStem}.json`
  try {
    const response = await fetch(jsonUrl)
    if (!response.ok) {
      return { sheet: null, fail: { url: jsonUrl, reason: `HTTP ${response.status}` } }
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().includes('json')) {
      return {
        sheet: null,
        fail: {
          url: jsonUrl,
          reason: `unexpected content-type ${contentType.trim() || 'none'}`,
        },
      }
    }
    const data = (await response.json()) as {
      frames?: Record<string, RawFrame & Record<string, unknown>>
      meta?: Record<string, unknown> & { image?: string }
    }
    const imageName = data.meta?.image?.trim()
    const imageCandidates = [imageName, `${sheetStem}.png`].filter(
      (name): name is string => Boolean(name?.trim()),
    )
    if (imageCandidates.length === 0) {
      return { sheet: null, fail: { url: jsonUrl, reason: 'json missing meta.image' } }
    }
    let atlasTexture: Texture | null = null
    let imageUrl = ''
    for (const candidate of imageCandidates) {
      imageUrl = `${dir}/${candidate.replace(/^\/+/, '')}`
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
      return {
        sheet: null,
        fail: { url: imageUrl || jsonUrl, reason: 'texture load error' },
      }
    }
    const metaSize = data.meta?.size as { w?: number; h?: number } | undefined
    const atlasW =
      Number(metaSize?.w) > 0
        ? Number(metaSize?.w)
        : atlasTexture.width
    const atlasH =
      Number(metaSize?.h) > 0
        ? Number(metaSize?.h)
        : atlasTexture.height
    const sheet = new Spritesheet({
      texture: atlasTexture,
      data: data as unknown as Spritesheet['data'],
      cachePrefix: `${sheetStem}/`,
    })
    try {
      await sheet.parse()
    } catch {
      return { sheet: null, fail: { url: jsonUrl, reason: 'spritesheet parse error' } }
    }
    const built = buildAnimSheet(
      stem,
      kind,
      sheet.textures,
      data.frames as Record<string, RawFrame> | undefined,
      data.meta ?? {},
      imageUrl,
      atlasW,
      atlasH,
    )
    return { sheet: built }
  } catch {
    return { sheet: null, fail: { url: jsonUrl, reason: 'load error' } }
  }
}

function cacheKey(stem: string, townFolder: string): string {
  return `${townFolder}/${stem}`.toLowerCase()
}

export function reportBattleUnitSheetMissing(
  session: GameSession,
  sheetStem: string,
  fail: { url: string; reason: string },
): GameSession {
  if (warnedMissingSheet.has(sheetStem)) {
    return session
  }
  warnedMissingSheet.add(sheetStem)
  const message = `${sheetStem}: ${fail.url} - ${fail.reason} (static used)`
  return appendBattleAnimWorldLog(session, message)
}

export function reportBattleUnitTypeStatic(
  session: GameSession,
  unitId: number,
  stem: string,
): GameSession {
  if (warnedMissingUnitType.has(unitId)) {
    return session
  }
  warnedMissingUnitType.add(unitId)
  return appendBattleAnimWorldLog(
    session,
    `${stem} (unit ${unitId}): no battle sprite sheets — static portrait in combat.`,
  )
}

export async function loadBattleUnitSheetSet(
  catalog: ReferenceCatalog,
  unit: UnitRow,
): Promise<BattleUnitSheetSet | null> {
  const stem = unitBattleSpriteStem(unit)
  if (!stem) {
    return null
  }
  const townFolder = unitBattleTownFolder(catalog, unit)
  const key = cacheKey(stem, townFolder)
  if (sheetCache.has(key)) {
    return sheetCache.get(key) ?? null
  }
  const inflight = sheetInflight.get(key)
  if (inflight) {
    return inflight
  }
  const dir = battleUnitTownDir(townFolder)
  const partner = basicPartnerForAdvanced(catalog, unit)
  const partnerStem = partner ? unitBattleSpriteStem(partner) : null
  const promise = (async (): Promise<BattleUnitSheetSet | null> => {
    const sheets: Partial<Record<BattleUnitAnimKind, BattleUnitAnimSheet>> = {}
    for (const kind of BATTLE_UNIT_ANIMS) {
      let result = await loadOneAnimSheet(dir, stem, kind)
      if (!result.sheet && partnerStem) {
        const borrowed = await loadOneAnimSheet(dir, partnerStem, kind)
        if (borrowed.sheet) {
          result = {
            sheet: { ...borrowed.sheet, borrowedGlow: true },
          }
          noteAdvancedSheetBorrow(unit.id, kind)
        } else if (borrowed.fail) {
          sheetFailCache.set(`${key}:${kind}`, borrowed.fail)
        }
      } else if (result.fail) {
        sheetFailCache.set(`${key}:${kind}`, result.fail)
      }
      if (result.sheet) {
        sheets[kind] = result.sheet
      }
    }
    const animated = BATTLE_UNIT_ANIMS.some((kind) => sheets[kind] != null)
    if (!animated) {
      sheetCache.set(key, null)
      flushAdvancedBorrowDevLog(catalog, unit)
      return null
    }
    const set: BattleUnitSheetSet = {
      stem,
      townFolder,
      sheets,
      animated: true,
      hasDie: sheets.Die != null,
      partnerSoundStem: partnerStem,
    }
    sheetCache.set(key, set)
    flushAdvancedBorrowDevLog(catalog, unit)
    return set
  })()
  sheetInflight.set(key, promise)
  try {
    return await promise
  } finally {
    sheetInflight.delete(key)
  }
}

export async function preloadBattleUnitSheetsForBattle(
  catalog: ReferenceCatalog,
  unitIds: number[],
  unitByIdFn: (id: number) => UnitRow | null | undefined,
): Promise<Map<number, BattleUnitSheetSet | null>> {
  const { sheets } = await preloadBattleUnitSheetsForBattleOpening(
    catalog,
    unitIds,
    unitByIdFn,
    Number.POSITIVE_INFINITY,
  )
  return sheets
}

export const BATTLE_OPENING_SHEET_PRELOAD_MS = 2000

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

/** Parallel sheet load; resolves early at capMs with whatever finished (cache hits finish immediately). */
export async function preloadBattleUnitSheetsForBattleOpening(
  catalog: ReferenceCatalog,
  unitIds: number[],
  unitByIdFn: (id: number) => UnitRow | null | undefined,
  capMs: number,
): Promise<{
  sheets: Map<number, BattleUnitSheetSet | null>
  finishRemaining: () => Promise<Map<number, BattleUnitSheetSet | null>>
}> {
  const out = new Map<number, BattleUnitSheetSet | null>()
  const seen = new Set<number>()
  const tasks: Promise<void>[] = []
  for (const id of unitIds) {
    if (seen.has(id)) {
      continue
    }
    seen.add(id)
    const unit = unitByIdFn(id)
    if (!unit) {
      continue
    }
    tasks.push(
      loadBattleUnitSheetSet(catalog, unit).then((set) => {
        out.set(id, set)
      }),
    )
  }
  const allDone = Promise.all(tasks).then(() => out)
  if (Number.isFinite(capMs) && capMs > 0) {
    await Promise.race([allDone, sleepMs(capMs)])
  } else {
    await allDone
  }
  const sheets = new Map(out)
  return {
    sheets,
    finishRemaining: async () => {
      await allDone
      return new Map(out)
    },
  }
}

export function battleUnitSheetForUnit(
  catalog: ReferenceCatalog,
  unit: UnitRow | null | undefined,
): BattleUnitSheetSet | null {
  if (!unit) {
    return null
  }
  const stem = unitBattleSpriteStem(unit)
  if (!stem) {
    return null
  }
  const townFolder = unitBattleTownFolder(catalog, unit)
  return sheetCache.get(cacheKey(stem, townFolder)) ?? null
}

export function frameAtProgress(
  sheet: BattleUnitAnimSheet,
  progress: number,
  fps: number,
  startedMs: number,
  randomFrameOffset = 0,
): BattleUnitFrame {
  const loopFrames = sheet.frames
  if (loopFrames.length === 0) {
    return sheet.stand ?? loopFrames[0]!
  }
  if (sheet.loop) {
    const elapsed = Math.max(0, performance.now() - startedMs)
    const idx =
      (Math.floor((elapsed / 1000) * fps) + randomFrameOffset) %
      loopFrames.length
    return loopFrames[idx] ?? loopFrames[0]!
  }
  const clamped = Math.min(1, Math.max(0, progress))
  const idx = Math.min(
    loopFrames.length - 1,
    Math.floor(clamped * loopFrames.length),
  )
  return loopFrames[idx] ?? loopFrames[0]!
}

export function idleFrame(
  set: BattleUnitSheetSet,
  fps: number,
  startedMs: number,
  randomFrameOffset: number,
): BattleUnitFrame | null {
  const idle = set.sheets.Idle
  if (!idle) {
    return null
  }
  return frameAtProgress(idle, 0, fps, startedMs, randomFrameOffset)
}

export function flushBattleSheetLoadFailuresToLog(
  session: GameSession,
): GameSession {
  let next = session
  for (const [cacheKey, fail] of sheetFailCache.entries()) {
    const colon = cacheKey.lastIndexOf(':')
    if (colon < 0) {
      continue
    }
    const kind = cacheKey.slice(colon + 1)
    const keyPart = cacheKey.slice(0, colon)
    const stem = keyPart.split('/').pop() ?? keyPart
    const sheetStem = `${stem}_${kind}`
    next = reportBattleUnitSheetMissing(next, sheetStem, fail)
  }
  return next
}

/** Combat art faces right; defender mirrors toward the attacker. */
export function flipBattleUnitForSide(side: 'atk' | 'def'): boolean {
  return side === 'def'
}

/** Face unflipped art toward the target hex (screen X). */
export function battleAttackFlipTowardTarget(
  attackerFoot: { x: number; y: number },
  targetFoot: { x: number; y: number } | null | undefined,
): boolean | undefined {
  if (!targetFoot) {
    return undefined
  }
  return targetFoot.x < attackerFoot.x
}

export function battleUnitDieSheetDrawable(
  sheet: BattleUnitAnimSheet | null | undefined,
): boolean {
  return Boolean(sheet && (sheet.frames.length > 0 || sheet.stand))
}

/** Die sheet loaded for this unit (not borrowed from basic partner). */
export function battleUnitOwnDieSheetDrawable(
  set: BattleUnitSheetSet | null | undefined,
): boolean {
  const die = set?.sheets.Die
  if (!battleUnitDieSheetDrawable(die)) {
    return false
  }
  return die?.borrowedGlow !== true
}

export function battleUnitHasDrawableDieSheet(
  set: BattleUnitSheetSet | null | undefined,
): boolean {
  return battleUnitDieSheetDrawable(set?.sheets.Die)
}

export function battleUnitHasOwnDrawableDieSheet(
  set: BattleUnitSheetSet | null | undefined,
): boolean {
  return battleUnitOwnDieSheetDrawable(set)
}

const warnedDieNotDrawable = new Set<string>()

export function reportBattleUnitDieNotDrawable(
  session: GameSession,
  stem: string,
): GameSession {
  if (warnedDieNotDrawable.has(stem)) {
    return session
  }
  warnedDieNotDrawable.add(stem)
  return appendBattleAnimWorldLog(
    session,
    `${stem}: Die sheet not drawable — tombstone used.`,
  )
}

export function resetBattleUnitSheetSessionWarnings(): void {
  warnedMissingUnitType.clear()
  warnedDieNotDrawable.clear()
}

/** Drop cached sheets so the next battle preload picks up new JSON/png. */
export function resetBattleUnitSheetLoadCache(): void {
  sheetCache.clear()
  sheetInflight.clear()
}

export { reportBattleUnitTypeStatic as warnBattleUnitTypeStaticOnce }
