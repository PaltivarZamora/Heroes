import { Assets, Texture } from 'pixi.js'
import type { AxialPos, GameSession, Hero } from '../session/types'
import { getCachedCatalog, heroTypeName, type ReferenceCatalog } from '../town/catalog'
import { boatOccupiedByHero } from './boat'
import {
  BOAT_MOVE_STEM,
  moveSheetStaticFile,
  preloadTransportMoveSheetStems,
  WORLD_MOVE_STEM,
  flightMoveSheetStem,
} from './flightTransport'
import {
  loadMountMoveSheetByStem,
  preloadMountMoveSheets,
} from './heroMountMoveAnim'

/**
 * World-map hero travel sprites (BR S9-7 / S9-27).
 * Files live under `frontend/public/assets/heroes/sprites/`.
 */

export const HERO_TRAVEL_SPRITE_DIR = '/assets/heroes/sprites'

const TRAVEL_ART = {
  transport: { artFaces: 'left' as HeroTravelFacing },
  mount: { artFaces: 'left' as HeroTravelFacing },
} as const

/** Land mount filename from hero_type.name (spaces → underscores). */
export function mountSpriteFile(className: string): string {
  const base = className.trim().replace(/\s+/g, '_')
  return `Mount_${base}.png`
}

export function mountSpriteFileForHero(
  hero: Hero,
  catalog?: ReferenceCatalog | null,
): string {
  const ref = catalog ?? getCachedCatalog()
  const name = ref ? heroTypeName(ref, hero.class_id) : ''
  if (!name) {
    throw new Error(`hero ${hero.id} missing class mount (class_id=${hero.class_id})`)
  }
  return mountSpriteFile(name)
}

/** Filenames only (preload). */
export const HERO_TRAVEL_FILES = {
  boat: moveSheetStaticFile(BOAT_MOVE_STEM),
} as const

export type HeroTravelFacing = 'left' | 'right'

export type HeroTravelSprite = {
  /** Filename under {@link HERO_TRAVEL_SPRITE_DIR}. */
  file: string
  /** Horizontal mirror so the sprite faces {@link Hero.travel_facing}. */
  flipX: boolean
}

/**
 * Pick travel art from hero state. One place for boat / flight / land.
 * Missing files → loader returns null → HexMap keeps circle + name fallback.
 */
export function heroTravelSprite(
  hero: Hero,
  session?: GameSession | null,
): HeroTravelSprite {
  const facing = hero.travel_facing ?? 'right'
  const boarded =
    session != null && boatOccupiedByHero(session, hero.id) != null
  if (boarded) {
    return {
      file: moveSheetStaticFile(BOAT_MOVE_STEM),
      flipX: facing !== TRAVEL_ART.transport.artFaces,
    }
  }
  if (hero.flight) {
    const catalog = getCachedCatalog()
    const stem = flightMoveSheetStem(hero.flight, catalog)
    return {
      file: moveSheetStaticFile(stem),
      flipX: facing !== TRAVEL_ART.transport.artFaces,
    }
  }
  const file = mountSpriteFileForHero(hero)
  return {
    file,
    flipX: facing !== TRAVEL_ART.mount.artFaces,
  }
}

/**
 * Screen left/right for a pointy-top axial step.
 * W / SW / NW → left; E / NE / SE → right. Null when not moving.
 */
export function facingFromMove(
  from: AxialPos,
  to: AxialPos,
): HeroTravelFacing | null {
  if (from.q === to.q && from.r === to.r) {
    return null
  }
  const dq = to.q - from.q
  const dr = to.r - from.r
  if (dq < 0 || (dq === 0 && dr < 0)) {
    return 'left'
  }
  return 'right'
}

const travelTextureCache = new Map<string, Texture | null>()
const travelLoadInflight = new Map<string, Promise<Texture | null>>()

function travelUrls(fileName: string): string[] {
  const trimmed = fileName.trim()
  if (!trimmed) {
    return []
  }
  const base = trimmed.replace(/\.png$/i, '').replaceAll(' ', '_')
  const bare = trimmed.replace(/^\/+/, '')
  return [
    trimmed.startsWith('/') ? trimmed : `${HERO_TRAVEL_SPRITE_DIR}/${bare}`,
    `${HERO_TRAVEL_SPRITE_DIR}/${base}.png`,
    `/assets/travel/${base}.png`,
    `/assets/features/${base}.png`,
  ]
}

async function tryLoad(url: string): Promise<Texture | null> {
  try {
    const response = await fetch(url)
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok || !contentType.toLowerCase().startsWith('image/')) {
      return null
    }
    const texture = await Assets.load<Texture>(url)
    if (texture.width < 1 || texture.height < 1) {
      return null
    }
    return texture
  } catch {
    return null
  }
}

/** Load travel art; missing file → null (caller keeps circle + name). */
export async function loadTravelTexture(
  fileName: string | null | undefined,
): Promise<Texture | null> {
  if (!fileName || !fileName.trim()) {
    return null
  }
  const cacheKey = fileName.trim().toLowerCase()
  if (travelTextureCache.has(cacheKey)) {
    return travelTextureCache.get(cacheKey) ?? null
  }
  const inflight = travelLoadInflight.get(cacheKey)
  if (inflight) {
    return inflight
  }
  const promise = (async () => {
    for (const url of travelUrls(fileName)) {
      const texture = await tryLoad(url)
      if (texture) {
        travelTextureCache.set(cacheKey, texture)
        return texture
      }
    }
    travelTextureCache.set(cacheKey, null)
    return null
  })()
  travelLoadInflight.set(cacheKey, promise)
  try {
    return await promise
  } finally {
    travelLoadInflight.delete(cacheKey)
  }
}

/** Warm transport move sheets, world/town static pngs, and class mounts. */
export function preloadHeroTravelSprites(catalog?: ReferenceCatalog | null): void {
  const ref = catalog ?? getCachedCatalog()
  void loadTravelTexture(moveSheetStaticFile(BOAT_MOVE_STEM))
  void loadTravelTexture(moveSheetStaticFile(WORLD_MOVE_STEM))
  preloadTransportMoveSheetStems(ref, (stem) => {
    void loadMountMoveSheetByStem(stem)
    void loadTravelTexture(moveSheetStaticFile(stem))
  })
  if (ref) {
    for (const row of ref.hero_type) {
      if (row.name?.trim()) {
        void loadTravelTexture(mountSpriteFile(row.name))
      }
    }
    preloadMountMoveSheets(ref)
  }
}
