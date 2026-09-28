import { Assets, Texture } from 'pixi.js'
import type { AxialPos, GameSession, Hero } from '../session/types'
import { getCachedCatalog, heroTypeName, type ReferenceCatalog } from '../town/catalog'
import { boatOccupiedByHero } from './boat'

/**
 * World-map hero travel sprites (BR S9-7).
 * Files live beside feature art under:
 *   `frontend/public/assets/heroes/sprites/`
 *   → served as `/assets/heroes/sprites/{Horse|Balloon|Boat}.png`
 */

export const HERO_TRAVEL_SPRITE_DIR = '/assets/heroes/sprites'

type TravelArt = {
  file: string
  /** Which way the raw PNG faces before any mirror. */
  artFaces: HeroTravelFacing
}

const TRAVEL_ART = {
  balloon: { file: 'Balloon.png', artFaces: 'right' },
  boat: { file: 'Boat.png', artFaces: 'right' },
  mount: { artFaces: 'left' },
} as const satisfies Record<string, TravelArt | { artFaces: HeroTravelFacing }>

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

/** Filenames only (preload / boat markers). */
export const HERO_TRAVEL_FILES = {
  balloon: TRAVEL_ART.balloon.file,
  boat: TRAVEL_ART.boat.file,
} as const

export type HeroTravelFacing = 'left' | 'right'

export type HeroTravelSprite = {
  /** Filename under {@link HERO_TRAVEL_SPRITE_DIR}. */
  file: string
  /** Horizontal mirror so the sprite faces {@link Hero.travel_facing}. */
  flipX: boolean
}

/**
 * Pick travel art from hero state. One place for Dock (Boat) / flight / land.
 * Missing files → loader returns null → HexMap keeps circle + name fallback.
 */
export function heroTravelSprite(
  hero: Hero,
  session?: GameSession | null,
): HeroTravelSprite {
  const boarded =
    session != null && boatOccupiedByHero(session, hero.id) != null
  if (boarded) {
    const facing = hero.travel_facing ?? 'right'
    return {
      file: TRAVEL_ART.boat.file,
      flipX: facing !== TRAVEL_ART.boat.artFaces,
    }
  }
  if (hero.flight) {
    const facing = hero.travel_facing ?? 'right'
    return {
      file: TRAVEL_ART.balloon.file,
      flipX: facing !== TRAVEL_ART.balloon.artFaces,
    }
  }
  const file = mountSpriteFileForHero(hero)
  const facing = hero.travel_facing ?? 'right'
  return {
    file,
    flipX: facing !== TRAVEL_ART.mount.artFaces,
  }
}

/**
 * Screen left/right for a pointy-top axial step.
 * W / SW / NW → left; E / NE / SE → right. Null when not moving.
 * Persists on the hero via `travel_facing` so idle markers keep last direction.
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
    // Legacy / mistaken drop paths from earlier passes.
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

/** Warm Balloon / Boat and all class mounts once with other map art. */
export function preloadHeroTravelSprites(catalog?: ReferenceCatalog | null): void {
  void loadTravelTexture(HERO_TRAVEL_FILES.balloon)
  void loadTravelTexture(HERO_TRAVEL_FILES.boat)
  const ref = catalog ?? getCachedCatalog()
  if (ref) {
    for (const row of ref.hero_type) {
      if (row.name?.trim()) {
        void loadTravelTexture(mountSpriteFile(row.name))
      }
    }
  }
}
