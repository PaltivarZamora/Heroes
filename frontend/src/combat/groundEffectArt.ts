import { isSilentAssetLoadFail } from '../assets/devAssetResponse'
import type { ReferenceCatalog } from '../town/catalog'
import { appendBattleAnimCombatLog } from './battleAnimLogBridge'
import { battleAnimSettings, combatFootY } from './battleAnimConfig'
import {
  type BattleUnitAnimSheet,
  loadAnimSheetFromDir,
} from './battleUnitSheet'

export const GROUND_EFFECT_ART_DIR = '/assets/effects'

const sheetCache = new Map<string, BattleUnitAnimSheet | null>()
const sheetInflight = new Map<string, Promise<BattleUnitAnimSheet | null>>()
const idleFailCache = new Map<string, { url: string; reason: string }>()
const warnedGroundEffect = new Set<string>()

export function groundEffectFileName(
  imagePath: string | null | undefined,
): string | null {
  if (!imagePath?.trim()) {
    return null
  }
  const base = imagePath.trim().replace(/^.*[/\\]/, '')
  return base || null
}

export function groundEffectStem(
  imagePath: string | null | undefined,
): string | null {
  const file = groundEffectFileName(imagePath)
  if (!file) {
    return null
  }
  const stem = file.replace(/\.(png|webp|jpe?g)$/i, '')
  return stem || null
}

export function groundEffectStillUrl(imagePath: string | null | undefined): string | null {
  const file = groundEffectFileName(imagePath)
  if (!file) {
    return null
  }
  return `${GROUND_EFFECT_ART_DIR}/${file}`
}

export function groundEffectDisplayWidthPx(
  hexPx: number,
  catalog: ReferenceCatalog | null | undefined,
): number {
  const pct = battleAnimSettings(catalog).groundEffectWidthPct
  return hexPx * (pct / 100)
}

export function groundEffectFootPoint(
  pos: { x: number; y: number },
  hexPx: number,
  catalog: ReferenceCatalog | null | undefined,
): { footX: number; footY: number } {
  const footOffsetPct = battleAnimSettings(catalog).footOffsetPct
  return {
    footX: pos.x,
    footY: combatFootY(pos.y, hexPx, footOffsetPct),
  }
}

function cacheKey(stem: string): string {
  return stem.toLowerCase()
}

function isIdleNotFound(fail: { url: string; reason: string } | undefined): boolean {
  return (
    fail != null &&
    isSilentAssetLoadFail(fail.reason) &&
    fail.url.endsWith('_Idle.json')
  )
}

export function warnGroundEffectArtOnce(stem: string, message: string): void {
  const key = stem.toLowerCase()
  if (warnedGroundEffect.has(key)) {
    return
  }
  warnedGroundEffect.add(key)
  appendBattleAnimCombatLog(`[ground_effect] ${stem}: ${message}`)
}

export async function loadGroundEffectIdleSheet(
  stem: string,
): Promise<BattleUnitAnimSheet | null> {
  const key = cacheKey(stem)
  if (sheetCache.has(key)) {
    return sheetCache.get(key) ?? null
  }
  const inflight = sheetInflight.get(key)
  if (inflight) {
    return inflight
  }
  const promise = (async (): Promise<BattleUnitAnimSheet | null> => {
    const result = await loadAnimSheetFromDir(GROUND_EFFECT_ART_DIR, stem, 'Idle')
    if (result.sheet) {
      sheetCache.set(key, result.sheet)
      idleFailCache.delete(key)
      return result.sheet
    }
    sheetCache.set(key, null)
    if (result.fail && !isIdleNotFound(result.fail)) {
      idleFailCache.set(key, result.fail)
      warnGroundEffectArtOnce(
        stem,
        `idle sheet failed (${result.fail.url} — ${result.fail.reason})`,
      )
    }
    return null
  })()
  sheetInflight.set(key, promise)
  try {
    return await promise
  } finally {
    sheetInflight.delete(key)
  }
}

export function groundEffectIdleFrameIndex(
  sheet: BattleUnitAnimSheet,
  fps: number,
  paintNowMs: number,
): number {
  const n = sheet.frames.length
  if (n <= 0) {
    return 0
  }
  return Math.floor((paintNowMs / 1000) * fps) % n
}

export function resetGroundEffectArtWarnings(): void {
  warnedGroundEffect.clear()
}