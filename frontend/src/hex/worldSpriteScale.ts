import { Sprite, type Texture } from 'pixi.js'
import type { GameSession } from '../session/types'
import { appendLogEntry, logViewPlayerId } from '../session/gameLog'
import {
  mapCfg,
  mapCfgNumber,
  type ReferenceCatalog,
} from '../town/catalog'

const devWarnings: string[] = []
let warnedInvalidScale = false

/** Pointy-top hex outer height (honeycomb `dimensions` = center to vertex). */
export function pointyHexOuterHeight(hexRadius: number): number {
  return hexRadius * 2
}

/** Pre–G12-9 hero fit height (`hexSize * 0.9 * 2`). */
export function legacyWorldSpriteFitHeight(hexRadius: number): number {
  return hexRadius * 0.9 * 2
}

export function worldSpriteScaleDevWarnings(): string[] {
  return devWarnings
}

function readWorldSpriteScalePct(
  catalog: ReferenceCatalog | null | undefined,
): { pct: number; invalid: boolean } {
  const raw = mapCfg(catalog, 'world_sprite_scale_pct', null)
  let n: number | null = null
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    n = raw
  } else if (typeof raw === 'string' && raw.trim()) {
    const parsed = Number(raw.trim())
    n = Number.isFinite(parsed) ? parsed : null
  }
  if (n == null || n <= 0) {
    return { pct: 100, invalid: true }
  }
  return { pct: n, invalid: false }
}

export function ensureWorldSpriteScaleWarning(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
): GameSession {
  const { invalid } = readWorldSpriteScalePct(catalog)
  if (!invalid || warnedInvalidScale) {
    return session
  }
  warnedInvalidScale = true
  const message =
    '[map_config] world_sprite_scale_pct missing or invalid — using 100% hex height.'
  devWarnings.push(message)
  return appendLogEntry(session, logViewPlayerId(session), 'world', 'mount_anim', {
    message,
  })
}

export function worldSpriteTargetHeight(
  hexRadius: number,
  catalog: ReferenceCatalog | null | undefined,
): number {
  const pct = mapCfgNumber(catalog, 'world_sprite_scale_pct', null, 100)
  return pointyHexOuterHeight(hexRadius) * (pct / 100)
}

export function worldHeroRingScaleFactor(
  targetHeight: number,
  hexRadius: number,
): number {
  const legacy = legacyWorldSpriteFitHeight(hexRadius)
  return legacy > 0 ? targetHeight / legacy : 1
}

/** Scale sprite to target height; centre anchor at view origin (hex centre). */
export function applyWorldSpriteScale(
  sprite: Sprite,
  texture: Texture,
  targetHeight: number,
  flipX = false,
): number {
  const texH = texture.height
  if (texH < 1) {
    return 1
  }
  const scale = targetHeight / texH
  sprite.anchor.set(0.5, 0.5)
  sprite.scale.set(flipX ? -scale : scale, scale)
  return scale
}
