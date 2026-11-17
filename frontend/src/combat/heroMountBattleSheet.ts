import { Texture } from 'pixi.js'
import type { GameSession, Hero } from '../session/types'
import { HERO_TRAVEL_SPRITE_DIR } from '../hex/heroTravelSprite'
import {
  loadMountMoveSheetByStem,
  spriteSheetStandFrameName,
} from '../hex/heroMountMoveAnim'
import { heroMoveSheetStem } from '../hex/flightTransport'
import type { ReferenceCatalog } from '../town/catalog'
import { isHeroStack, type CombatStack } from './battle'
import type { BattleUnitFrame } from './battleUnitSheet'
import { appendBattleAnimCombatLog } from './battleAnimLogBridge'

export type HeroMountBattleArt = {
  frame: BattleUnitFrame
  restHeight: number
}

const artCache = new Map<string, HeroMountBattleArt | null>()
const warnedStem = new Set<string>()

type RawFrame = {
  frame?: { x?: number; y?: number; w?: number; h?: number }
  anchor?: { x?: number; y?: number }
}

function readAnchor(raw: RawFrame | undefined): { x: number; y: number } {
  const ax = Number(raw?.anchor?.x)
  const ay = Number(raw?.anchor?.y)
  return {
    x: Number.isFinite(ax) ? ax : 0.5,
    y: Number.isFinite(ay) ? ay : 1,
  }
}

function standFrameFromJson(
  stem: string,
  data: {
    frames?: Record<string, RawFrame>
    meta?: { image?: string; rest_height?: number }
  },
): HeroMountBattleArt | null {
  const frames = data.frames ?? {}
  const standName = spriteSheetStandFrameName(stem)
  const standKey =
    Object.keys(frames).find(
      (name) => name === standName || name.endsWith(`/${standName}`),
    ) ?? Object.keys(frames).sort()[0]
  if (!standKey) {
    return null
  }
  const raw = frames[standKey]
  const fr = raw?.frame
  const w = Number(fr?.w)
  const h = Number(fr?.h)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) {
    return null
  }
  const imageName = data.meta?.image?.trim() || `${stem}.png`
  const atlasUrl = `${HERO_TRAVEL_SPRITE_DIR}/${imageName.replace(/^\/+/, '')}`
  const atlasW = Number((data.meta as { size?: { w?: number } } | undefined)?.size?.w)
  const atlasH = Number((data.meta as { size?: { h?: number } } | undefined)?.size?.h)
  const anchor = readAnchor(raw)
  const restRaw = Number(data.meta?.rest_height)
  const restHeight =
    Number.isFinite(restRaw) && restRaw > 0 ? restRaw : h
  const frame: BattleUnitFrame = {
    texture: Texture.EMPTY,
    w,
    h,
    anchorX: anchor.x,
    anchorY: anchor.y,
    atlasUrl,
    atlasW: Number.isFinite(atlasW) && atlasW > 0 ? atlasW : w,
    atlasH: Number.isFinite(atlasH) && atlasH > 0 ? atlasH : h,
    rect: {
      x: Number(fr?.x) || 0,
      y: Number(fr?.y) || 0,
      w,
      h,
    },
  }
  return { frame, restHeight }
}

export function reportHeroMountBattleMissing(stem: string, detail: string): void {
  if (warnedStem.has(stem)) {
    return
  }
  warnedStem.add(stem)
  appendBattleAnimCombatLog(
    `Hero battle mount missing: ${stem} — ${detail} (portrait fallback)`,
  )
}

export async function loadHeroMountBattleArt(
  stem: string,
): Promise<HeroMountBattleArt | null> {
  const key = stem.toLowerCase()
  if (artCache.has(key)) {
    return artCache.get(key) ?? null
  }
  const moveResult = await loadMountMoveSheetByStem(stem)
  if (!moveResult.sheet) {
    const reason = moveResult.fail?.reason ?? 'sheet unavailable'
    reportHeroMountBattleMissing(stem, reason)
    artCache.set(key, null)
    return null
  }
  const jsonUrl = `${HERO_TRAVEL_SPRITE_DIR}/${stem}.json`
  try {
    const response = await fetch(jsonUrl)
    if (!response.ok) {
      reportHeroMountBattleMissing(stem, `HTTP ${response.status}`)
      artCache.set(key, null)
      return null
    }
    const data = (await response.json()) as {
      frames?: Record<string, RawFrame>
      meta?: { image?: string; rest_height?: number; size?: { w?: number; h?: number } }
    }
    const art = standFrameFromJson(stem, data)
    if (!art) {
      reportHeroMountBattleMissing(stem, 'no Stand frame in json')
      artCache.set(key, null)
      return null
    }
    artCache.set(key, art)
    return art
  } catch {
    reportHeroMountBattleMissing(stem, 'json load error')
    artCache.set(key, null)
    return null
  }
}

export async function preloadHeroMountBattleArt(
  stacks: CombatStack[],
  session: GameSession,
  catalog: ReferenceCatalog,
  heroes: { atk: Hero | null | undefined; def: Hero | null | undefined },
): Promise<Map<string, HeroMountBattleArt | null>> {
  const out = new Map<string, HeroMountBattleArt | null>()
  const tasks = stacks
    .filter(isHeroStack)
    .map(async (stack) => {
      const hero =
        session.heroes.find((row) => row.id === stack.heroId) ??
        (stack.side === 'atk' ? heroes.atk : heroes.def)
      const stem = hero ? heroMoveSheetStem(hero, session, catalog) : null
      if (!stem) {
        out.set(stack.id, null)
        return
      }
      const art = await loadHeroMountBattleArt(stem)
      out.set(stack.id, art)
    })
  await Promise.all(tasks)
  return out
}

export function resetHeroMountBattleSheetCache(): void {
  artCache.clear()
  warnedStem.clear()
}
