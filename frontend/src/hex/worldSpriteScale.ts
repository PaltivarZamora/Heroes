import { Sprite, type Texture } from 'pixi.js'
import { footprintExtent, type FootprintCode } from '../combat/footprint'
import type { GameSession } from '../session/types'
import { appendLogEntry, logViewPlayerId } from '../session/gameLog'
import {
  animConfigRaw,
  positiveAnimConfig,
} from '../config/animConfig'
import {
  type ReferenceCatalog,
} from '../town/catalog'

const devWarnings: string[] = []
let warnedInvalidScale = false
let warnedInvalidMaxWidth = false

/** Pointy-top hex outer height (honeycomb `dimensions` = center to vertex). */
export function pointyHexOuterHeight(hexRadius: number): number {
  return hexRadius * 2
}

/** Pointy-top hex flat-to-flat width at the same `dimensions` radius. */
export function pointyHexOuterWidth(hexRadius: number): number {
  return Math.sqrt(3) * hexRadius
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
  const raw = animConfigRaw(catalog, 'world_sprite_scale_pct')
  let n: number | null = null
  if (raw != null && raw.trim()) {
    const parsed = Number(raw.trim())
    n = Number.isFinite(parsed) ? parsed : null
  }
  if (n == null || n <= 0) {
    return { pct: 100, invalid: true }
  }
  return { pct: n, invalid: false }
}

function readWorldSpriteMaxWidthPct(
  catalog: ReferenceCatalog | null | undefined,
): { pct: number | null; invalid: boolean } {
  const raw = animConfigRaw(catalog, 'world_sprite_max_width_pct')
  let n: number | null = null
  if (raw != null && raw.trim()) {
    const parsed = Number(raw.trim())
    n = Number.isFinite(parsed) ? parsed : null
  }
  if (n == null || n <= 0) {
    return { pct: null, invalid: true }
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
    '[anim_config] world_sprite_scale_pct missing or invalid — using 100% hex height.'
  devWarnings.push(message)
  return appendLogEntry(session, logViewPlayerId(session), 'world', 'mount_anim', {
    message,
  })
}

export function ensureWorldSpriteMaxWidthWarning(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
): GameSession {
  const { invalid } = readWorldSpriteMaxWidthPct(catalog)
  if (!invalid || warnedInvalidMaxWidth) {
    return session
  }
  warnedInvalidMaxWidth = true
  const message =
    '[anim_config] world_sprite_max_width_pct missing or invalid — no width cap.'
  devWarnings.push(message)
  return appendLogEntry(session, logViewPlayerId(session), 'world', 'mount_anim', {
    message,
  })
}

export function worldSpriteTargetHeight(
  hexRadius: number,
  catalog: ReferenceCatalog | null | undefined,
): number {
  const pct =
    positiveAnimConfig(catalog, 'world_sprite_scale_pct') ?? 100
  return pointyHexOuterHeight(hexRadius) * (pct / 100)
}

export function worldHeroRingScaleFactor(
  targetHeight: number,
  hexRadius: number,
): number {
  const legacy = legacyWorldSpriteFitHeight(hexRadius)
  return legacy > 0 ? targetHeight / legacy : 1
}

/**
 * Scale sprite to target height; centre anchor at view origin (hex centre).
 * When hexRadius + catalog are set, uniform scale may shrink further to respect
 * world_sprite_max_width_pct of hex width.
 */
export function applyWorldSpriteScale(
  sprite: Sprite,
  texture: Texture,
  targetHeight: number,
  flipX = false,
  hexRadius?: number,
  catalog?: ReferenceCatalog | null,
): number {
  const texH = texture.height
  if (texH < 1) {
    return 1
  }
  let scale = targetHeight / texH
  if (hexRadius != null && hexRadius > 0 && catalog) {
    const { pct, invalid } = readWorldSpriteMaxWidthPct(catalog)
    if (!invalid && pct != null) {
      const maxW = pointyHexOuterWidth(hexRadius) * (pct / 100)
      const renderedW = texture.width * scale
      if (renderedW > maxW && texture.width >= 1) {
        scale = maxW / texture.width
      }
    }
  }
  sprite.anchor.set(0.5, 0.5)
  sprite.scale.set(flipX ? -scale : scale, scale)
  return scale
}

/** Footprint art box size (battle layout: cols wide, 1 + 0.75× extra rows tall). */
export function worldMobFootprintBoxSize(
  hexRadius: number,
  code: FootprintCode,
): { boxWidth: number; boxHeight: number } {
  const ext = footprintExtent(code)
  return {
    boxWidth: hexRadius * ext.cols,
    boxHeight: hexRadius * (1 + Math.max(0, ext.rows - 1) * 0.75),
  }
}

/** Rest sprite height from footprint box + world_sprite_scale_pct slack on one hex. */
export function worldMobSpriteTargetHeight(
  hexRadius: number,
  boxHeight: number,
  catalog: ReferenceCatalog | null | undefined,
  code?: FootprintCode,
): number {
  const pct =
    positiveAnimConfig(catalog, 'world_sprite_scale_pct') ?? 100
  const oneHex = pointyHexOuterHeight(hexRadius)
  if (code === '1x1') {
    return oneHex * (pct / 100)
  }
  return boxHeight + oneHex * ((pct - 100) / 100)
}

/**
 * Scale mob art to target height; cap width at world_sprite_max_width_pct of the
 * footprint box (not a single hex).
 */
export function applyWorldMobSpriteScale(
  sprite: Sprite,
  texture: Texture,
  targetHeight: number,
  boxWidth: number,
  flipX = false,
  catalog?: ReferenceCatalog | null,
): number {
  const texH = texture.height
  if (texH < 1) {
    return 1
  }
  let scale = targetHeight / texH
  if (boxWidth > 0 && catalog) {
    const { pct, invalid } = readWorldSpriteMaxWidthPct(catalog)
    if (!invalid && pct != null && texture.width >= 1) {
      const maxW = boxWidth * (pct / 100)
      const renderedW = texture.width * scale
      if (renderedW > maxW) {
        scale = maxW / texture.width
      }
    }
  }
  sprite.anchor.set(0.5, 0.5)
  sprite.scale.set(flipX ? -scale : scale, scale)
  return scale
}
