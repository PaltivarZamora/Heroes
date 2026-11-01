import { animConfigRaw } from '../config/animConfig'
import { battleIdleSettings } from '../combat/battleAnimConfig'
import { moveKindForUnit, type MoveKind } from '../combat/movement'
import {
  proceduralIdleMotionAdjust,
  proceduralIdleMotionForStack,
  type ProceduralIdleMotion,
} from '../combat/proceduralBattleIdle'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import type { Container, Sprite } from 'pixi.js'

export function worldMobsIdleEnabled(
  catalog: ReferenceCatalog | null | undefined,
): boolean {
  return animConfigRaw(catalog, 'world_mobs_idle')?.trim().toLowerCase() === 'true'
}

/** World map sprites use centre anchor (see worldSpriteScale). */
const WORLD_MOB_SPRITE_ANCHOR_Y = 0.5

export type WorldMobIdleBase = {
  motion: ProceduralIdleMotion
  moveKind: MoveKind
  baseScaleX: number
  baseScaleY: number
  baseSpriteY: number
  breathDisplayHeight: number
  baseX: number
  baseY: number
}

export function captureWorldMobIdleBase(
  mobId: string,
  unit: UnitRow,
  catalog: ReferenceCatalog,
  sprite: Sprite,
  view: Container,
): WorldMobIdleBase | undefined {
  if (!worldMobsIdleEnabled(catalog)) {
    return undefined
  }
  const settings = battleIdleSettings(catalog)
  if (!settings.enabled || unit.stationary === true) {
    return undefined
  }
  return {
    motion: proceduralIdleMotionForStack(mobId, settings.periodSec),
    moveKind: moveKindForUnit(unit, catalog),
    baseScaleX: sprite.scale.x,
    baseScaleY: sprite.scale.y,
    baseSpriteY: sprite.position.y,
    breathDisplayHeight:
      sprite.texture.height >= 1
        ? sprite.texture.height * Math.abs(sprite.scale.y)
        : 0,
    baseX: view.position.x,
    baseY: view.position.y,
  }
}

export function shouldTickWorldMobProceduralIdle(
  entries: Iterable<{
    view: Container
    sprite: Sprite
    idleBase?: WorldMobIdleBase
  }>,
  catalog: ReferenceCatalog | null | undefined,
): boolean {
  if (!worldMobsIdleEnabled(catalog)) {
    return false
  }
  if (!battleIdleSettings(catalog).enabled) {
    return false
  }
  for (const entry of entries) {
    if (!entry.idleBase) {
      continue
    }
    if (entry.view.visible && entry.view.renderable && entry.sprite.visible) {
      return true
    }
  }
  return false
}

export function tickWorldMobProceduralIdle(
  entries: Iterable<{
    view: Container
    sprite: Sprite
    idleBase?: WorldMobIdleBase
  }>,
  catalog: ReferenceCatalog | null | undefined,
  hexPx: number,
  nowMs: number,
): void {
  if (!worldMobsIdleEnabled(catalog)) {
    return
  }
  const settings = battleIdleSettings(catalog)
  if (!settings.enabled) {
    return
  }
  for (const entry of entries) {
    const base = entry.idleBase
    if (!base) {
      continue
    }
    if (!entry.view.visible || !entry.view.renderable || !entry.sprite.visible) {
      continue
    }
    const adj = proceduralIdleMotionAdjust(
      nowMs,
      base.motion,
      base.moveKind,
      hexPx,
      settings,
      {
        displayHeight: base.breathDisplayHeight,
        anchorY: WORLD_MOB_SPRITE_ANCHOR_Y,
      },
    )
    if (!adj) {
      continue
    }
    entry.sprite.scale.set(base.baseScaleX, base.baseScaleY * adj.scaleYMult)
    entry.sprite.position.y = base.baseSpriteY + adj.spriteOffsetY
    entry.view.position.set(
      base.baseX + adj.offsetX,
      base.baseY + adj.offsetY,
    )
  }
}
