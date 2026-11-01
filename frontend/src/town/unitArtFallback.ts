import { BlurFilter, Sprite, type Container } from 'pixi.js'
import { appendBattleAnimCombatLog } from '../combat/battleAnimLogBridge'
import {
  animConfigHexColor,
  positiveAnimConfig,
} from '../config/animConfig'
import { devToolsEnabled } from '../settings/playerSettings'
import type { ReferenceCatalog, UnitRow } from './catalog'
import { isAdvancedUnit, townNameForUnit } from './catalog'
import { unitStaticPictureUrls } from './slotArt'
import {
  basicPartnerForAdvanced,
} from './unitUpgrade'
import type { BattleUnitAnimKind } from '../combat/battleUnitSheet'
import { unitBattleSpriteStem } from '../combat/battleUnitSheet'
import { appendLogEntry, logViewPlayerId } from '../session/gameLog'

export { basicPartnerForAdvanced } from './unitUpgrade'

export type UnitStaticArtCandidate = {
  url: string
  glow: boolean
}

export type AdvFallbackGlow = {
  color: string
  px: number
}

let warnedGlowConfig = false

export function advFallbackGlow(
  catalog: ReferenceCatalog | null | undefined,
): AdvFallbackGlow | null {
  const color = animConfigHexColor(catalog, 'adv_fallback_glow_color')
  const px = positiveAnimConfig(catalog, 'adv_fallback_glow_px')
  if (color != null && px != null) {
    return { color, px }
  }
  return null
}

export function ensureAdvFallbackGlowWarning(
  session: import('../session/types').GameSession,
  catalog: ReferenceCatalog | null | undefined,
): import('../session/types').GameSession {
  if (warnedGlowConfig || advFallbackGlow(catalog)) {
    return session
  }
  warnedGlowConfig = true
  const message =
    '[anim_config] adv_fallback_glow_color or adv_fallback_glow_px missing or invalid — advanced borrow art has no glow.'
  return appendLogEntry(session, logViewPlayerId(session), 'world', 'config', {
    message,
  })
}

/** CSS filter string kept for callers that cannot use a baked image. */
export function advBorrowGlowCssFilter(
  catalog: ReferenceCatalog | null | undefined,
  scale = 1,
): string | undefined {
  const glow = advFallbackGlow(catalog)
  if (!glow) {
    return undefined
  }
  const px = Math.max(0.5, glow.px * scale)
  const c = glow.color
  return `drop-shadow(0 0 ${px}px ${c}) drop-shadow(0 0 ${px * 0.55}px ${c})`
}

export function applyPixiAdvBorrowGlow(
  parent: Container,
  sprite: Sprite,
  catalog: ReferenceCatalog | null | undefined,
  displayScale: number,
): void {
  const glow = advFallbackGlow(catalog)
  if (!glow) {
    return
  }
  const screenBlur = Math.max(1, glow.px * displayScale * 0.35)
  const halo = new Sprite(sprite.texture)
  halo.anchor.copyFrom(sprite.anchor)
  halo.scale.copyFrom(sprite.scale)
  halo.x = sprite.x
  halo.y = sprite.y
  halo.tint = Number.parseInt(glow.color.slice(1), 16)
  halo.alpha = 0.55
  halo.filters = [new BlurFilter({ strength: screenBlur })]
  parent.addChildAt(halo, parent.getChildIndex(sprite))
}

export function unitStaticArtCandidates(
  catalog: ReferenceCatalog | null | undefined,
  unit: UnitRow | null | undefined,
): UnitStaticArtCandidate[] {
  if (!unit) {
    return []
  }
  const town = townNameForUnit(catalog, unit)
  const out: UnitStaticArtCandidate[] = []
  const advFile = unit.image_path?.trim()
  if (advFile) {
    for (const url of unitStaticPictureUrls(advFile, town)) {
      out.push({ url, glow: false })
    }
  }
  const partner = basicPartnerForAdvanced(catalog, unit)
  const partnerFile = partner?.image_path?.trim()
  if (partnerFile) {
    const partnerTown = townNameForUnit(catalog, partner)
    for (const url of unitStaticPictureUrls(partnerFile, partnerTown)) {
      out.push({ url, glow: true })
    }
  }
  return out
}

const borrowSheetKinds = new Map<number, Set<BattleUnitAnimKind>>()
const borrowPicture = new Set<number>()
const borrowLogged = new Set<number>()

export function resetAdvancedBorrowSessionLog(): void {
  borrowSheetKinds.clear()
  borrowPicture.clear()
  borrowLogged.clear()
  warnedGlowConfig = false
}

export function noteAdvancedSheetBorrow(
  unitId: number,
  kind: BattleUnitAnimKind,
): void {
  let set = borrowSheetKinds.get(unitId)
  if (!set) {
    set = new Set()
    borrowSheetKinds.set(unitId, set)
  }
  set.add(kind)
}

export function noteAdvancedPictureBorrow(unitId: number): void {
  borrowPicture.add(unitId)
}

export function flushAdvancedBorrowDevLog(
  catalog: ReferenceCatalog | null | undefined,
  unit: UnitRow | null | undefined,
): void {
  if (!devToolsEnabled() || !catalog || !unit || !isAdvancedUnit(catalog, unit)) {
    return
  }
  if (borrowLogged.has(unit.id)) {
    return
  }
  const partner = basicPartnerForAdvanced(catalog, unit)
  if (!partner) {
    return
  }
  const sheetKinds = borrowSheetKinds.get(unit.id)
  const parts: string[] = []
  if (sheetKinds) {
    for (const kind of ['Idle', 'Move', 'Attack', 'Hit', 'Die'] as const) {
      if (sheetKinds.has(kind)) {
        parts.push(kind)
      }
    }
  }
  if (borrowPicture.has(unit.id)) {
    parts.push('picture')
  }
  if (parts.length === 0) {
    return
  }
  borrowLogged.add(unit.id)
  const advStem = unitBattleSpriteStem(unit) ?? unit.name
  const basicStem = unitBattleSpriteStem(partner) ?? partner.name
  appendBattleAnimCombatLog(
    `${advStem}: ${parts.join(', ')} borrowed from ${basicStem}`,
  )
}
