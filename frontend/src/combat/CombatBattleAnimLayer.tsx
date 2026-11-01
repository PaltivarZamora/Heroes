import type { ReactNode } from 'react'
import {
  battleAnimSettings,
  battleIdleSettings,
  type BattleAnimSettings,
} from './battleAnimConfig'
import { combatBattleUnitSpriteScale, stackArtBox, stackArtBoxFoot } from './combatStackArtBox'
import {
  battleUnitSheetForUnit,
  flipBattleUnitForSide,
  type BattleUnitSheetSet,
} from './battleUnitSheet'
import {
  combatUnitDrawFootPosition,
  pickVisualFrame,
  progressForTimedAnim,
  travelFlipXForSlide,
  type CombatProjectileVisual,
  type StackBattleVisual,
} from './combatUnitAnimVisual'
import { CombatBattleProjectile, CombatBattleUnitArt } from './CombatBattleUnitArt'
import type { CombatBattle } from './battle'
import { isHeroStack } from './battle'
import type { ReferenceCatalog } from '../town/catalog'
import { unitById } from '../town/catalog'
import { combatStackFootprint, moveKindForUnit } from './movement'
import { proceduralIdleTransformCss } from './proceduralBattleIdle'
import { proceduralHitTransformCss, proceduralHitTransformOrigin } from './proceduralBattleHit'
import { stackShowsBattleSprites } from './combatUnitAnimPlayback'
import { advFallbackGlow } from '../town/unitArtFallback'
import {
  dieFallbackCorpseBodyVisible,
  dieFallbackEffectScale,
  dieFallbackFxFrame,
  dieFallbackFxOpacity,
  type DieFallbackEffectSheet,
} from './battleDieFallbackEffect'
import { CombatBattleStaticCorpseBody } from './CombatBattleStaticCorpseBody'
import {
  corpseDieFrameScale,
  corpseUsesOwnDieSheetHold,
  pickCorpseDieFrame,
  tombCorpseArtFootprintCode,
} from './combatCorpsePaint'
import type { FootprintCode } from './footprint'
import type { CombatSide } from './battle'

type HexAnchor = { q: number; r: number; x: number; y: number }

type LayerProps = {
  battle: CombatBattle
  field: {
    hexPx: number
    anchors: HexAnchor[]
  }
  catalog: ReferenceCatalog
  unitSheets: Map<number, BattleUnitSheetSet | null>
  stackVisuals: Record<string, StackBattleVisual>
  settings?: BattleAnimSettings
  paintNowMs: number
}

function resolveBattleUnitFlipX(
  side: 'atk' | 'def',
  visual: StackBattleVisual,
): boolean {
  return visual.flipX ?? flipBattleUnitForSide(side)
}

function anchorAt(anchors: HexAnchor[], q: number, r: number): HexAnchor | null {
  return anchors.find((row) => row.q === q && row.r === r) ?? null
}

function sheetSetForUnit(
  unitId: number,
  catalog: ReferenceCatalog,
  unitSheets: Map<number, BattleUnitSheetSet | null>,
): BattleUnitSheetSet | null {
  const cached = unitSheets.get(unitId)
  if (cached) {
    return cached
  }
  const unit = unitById(catalog, unitId)
  return unit ? battleUnitSheetForUnit(catalog, unit) : null
}

function corpseArtFootprintForTomb(
  tomb: import('./battle').CombatTombstone,
  catalog: ReferenceCatalog,
): FootprintCode {
  return tombCorpseArtFootprintCode(tomb, catalog)
}

function paintCorpseNode(
  id: string,
  unitId: number,
  q: number,
  r: number,
  side: CombatSide,
  footprint: FootprintCode,
  visual: StackBattleVisual | undefined,
  catalog: ReferenceCatalog,
  unitSheets: Map<number, BattleUnitSheetSet | null>,
  field: LayerProps['field'],
  settings: BattleAnimSettings,
  now: number,
): ReactNode | null {
  const anchor = anchorAt(field.anchors, q, r)
  if (!anchor) {
    return null
  }
  const drawFoot = combatUnitDrawFootPosition(
    { x: anchor.x, y: anchor.y },
    field.hexPx,
    settings.footOffsetPct,
    footprint,
    side,
    visual,
    now,
  )
  const set = sheetSetForUnit(unitId, catalog, unitSheets)
  const flipX = resolveBattleUnitFlipX(
    side,
    visual ?? { kind: 'idle', startedMs: 0, frameOffset: 0 },
  )

  if (corpseUsesOwnDieSheetHold(visual, set) && set && visual) {
    const die = set.sheets.Die
    const picked = pickCorpseDieFrame(set, visual, settings, now)
    if (!picked || !die) {
      return null
    }
    const scale = corpseDieFrameScale(
      field.hexPx,
      footprint,
      side,
      die.restHeight,
      picked.frame.w,
      settings,
    )
    const dieAnimSheet = set.sheets[picked.sheetKind]
    const dieGlow = dieAnimSheet?.borrowedGlow
      ? advFallbackGlow(catalog)
      : null
    return (
      <CombatBattleUnitArt
        key={`die:${id}`}
        frame={picked.frame}
        scale={scale}
        footX={drawFoot.footX}
        footY={drawFoot.footY}
        flipX={flipX}
        borrowGlow={
          dieGlow
            ? { color: dieGlow.color, px: Math.max(0.5, dieGlow.px * scale) }
            : null
        }
      />
    )
  }

  const schedule = visual?.dieFallbackFx
  if (schedule && !dieFallbackCorpseBodyVisible(schedule, now)) {
    return null
  }

  const tombUnit = unitById(catalog, unitId)
  if (!tombUnit) {
    return null
  }
  const unitName = tombUnit.name?.trim() || `unit ${unitId}`
  return (
    <CombatBattleStaticCorpseBody
      key={`corpse:${id}`}
      unitId={unitId}
      unitDisplayName={unitName}
      catalog={catalog}
      hexPx={field.hexPx}
      footprint={footprint}
      side={side}
      settings={settings}
      footX={drawFoot.footX}
      footY={drawFoot.footY}
      flipX={flipX}
    />
  )
}

/** Die clips and held corpses — always below living stacks. */
export function CombatBattleCorpseLayer({
  battle,
  field,
  catalog,
  unitSheets,
  stackVisuals,
  settings: settingsProp,
  paintNowMs,
}: LayerProps) {
  const settings = settingsProp ?? battleAnimSettings(catalog)
  const now = paintNowMs
  const nodes: ReactNode[] = []
  const painted = new Set<string>()

  const pushCorpse = (
    id: string,
    unitId: number,
    q: number,
    r: number,
    side: CombatSide,
    footprint: FootprintCode,
    visual: StackBattleVisual | undefined,
  ) => {
    if (painted.has(id)) {
      return
    }
    const node = paintCorpseNode(
      id,
      unitId,
      q,
      r,
      side,
      footprint,
      visual,
      catalog,
      unitSheets,
      field,
      settings,
      now,
    )
    if (node) {
      painted.add(id)
      nodes.push(node)
    }
  }

  for (const tomb of battle.tombstones ?? []) {
    const visual = stackVisuals[tomb.id]
    pushCorpse(
      tomb.id,
      tomb.unitId,
      tomb.q,
      tomb.r,
      tomb.side,
      corpseArtFootprintForTomb(tomb, catalog),
      visual,
    )
  }

  for (const stack of battle.stacks) {
    if (isHeroStack(stack) || stack.qty > 0) {
      continue
    }
    const visual = stackVisuals[stack.id]
    if (painted.has(stack.id)) {
      continue
    }
    pushCorpse(
      stack.id,
      stack.unitId,
      stack.q,
      stack.r,
      stack.side,
      combatStackFootprint(stack, catalog),
      visual,
    )
  }

  return (
    <div className="combat-battle-corpse-layer" aria-hidden="true">
      {nodes}
    </div>
  )
}

export function CombatBattleAnimLayer({
  battle,
  field,
  catalog,
  unitSheets,
  stackVisuals,
  projectiles,
  settings: settingsProp,
  paintNowMs,
}: LayerProps & {
  projectiles: CombatProjectileVisual[]
}) {
  const settings = settingsProp ?? battleAnimSettings(catalog)
  const idleSettings = battleIdleSettings(catalog)
  const now = paintNowMs
  const nodes: ReactNode[] = []
  for (const stack of battle.stacks) {
    const stackVisualEarly = stackVisuals[stack.id]
    if (
      isHeroStack(stack) ||
      !stackShowsBattleSprites(
        stack,
        catalog,
        unitSheets,
        stackVisualEarly,
        now,
      )
    ) {
      continue
    }
    const footprint = combatStackFootprint(stack, catalog)
    const set = sheetSetForUnit(stack.unitId, catalog, unitSheets)
    if (!set?.animated) {
      continue
    }
    const visual = stackVisuals[stack.id] ?? {
      kind: 'idle' as const,
      startedMs: now,
      frameOffset: 0,
    }
    const anchor = anchorAt(field.anchors, stack.q, stack.r)
    if (!anchor) {
      continue
    }
    const drawFoot = combatUnitDrawFootPosition(
      anchor,
      field.hexPx,
      settings.footOffsetPct,
      footprint,
      stack.side,
      visual,
      now,
    )
    const picked = pickVisualFrame(set, visual, settings, now)
    if (!picked) {
      continue
    }
    const sheet =
      set.sheets[picked.sheetKind] ?? set.sheets.Idle ?? set.sheets.Move
    if (!sheet) {
      continue
    }
    const scale = combatBattleUnitSpriteScale(
      field.hexPx,
      footprint,
      stack.side,
      sheet.restHeight,
      picked.frame.w,
      settings,
    )
    const unit = unitById(catalog, stack.unitId)
    let motionTransform: string | undefined
    let motionTransformOrigin: string | undefined
    if (visual.kind === 'Hit' && visual.proceduralHit) {
      motionTransform = proceduralHitTransformCss(
        visual.startedMs,
        settings.hitSec,
        now,
        visual.proceduralHit,
        field.hexPx,
      )
      motionTransformOrigin = proceduralHitTransformOrigin(
        visual.proceduralHit,
        picked.frame.anchorX,
        picked.frame.anchorY,
      )
    } else if (
      visual.kind === 'idle' &&
      !visual.slide &&
      visual.proceduralIdle &&
      unit
    ) {
      motionTransform = proceduralIdleTransformCss(
        now,
        visual.proceduralIdle,
        moveKindForUnit(unit, catalog),
        field.hexPx,
        idleSettings,
      )
    }
    const proceduralHitScreen =
      visual.kind === 'Hit' && visual.proceduralHit != null
    const liveAnimSheet = set.sheets[picked.sheetKind]
    const spriteGlow = liveAnimSheet?.borrowedGlow
      ? advFallbackGlow(catalog)
      : null
    nodes.push(
      <CombatBattleUnitArt
        key={`anim:${stack.id}`}
        frame={picked.frame}
        scale={scale}
        footX={drawFoot.footX}
        footY={drawFoot.footY}
        flipX={visual.slide ? travelFlipXForSlide(visual.slide, now) : resolveBattleUnitFlipX(stack.side, visual)}
        motionTransform={motionTransform}
        transformOrigin={motionTransformOrigin}
        screenSpaceMotion={proceduralHitScreen}
        borrowGlow={
          spriteGlow
            ? {
                color: spriteGlow.color,
                px: Math.max(0.5, spriteGlow.px * scale),
              }
            : null
        }
      />,
    )
  }
  for (const proj of projectiles) {
    const t = progressForTimedAnim(proj.startedMs, proj.durationMs, now)
    const x = proj.fromX + (proj.toX - proj.fromX) * t
    const y = proj.fromY + (proj.toY - proj.fromY) * t
    const angleDeg =
      (Math.atan2(proj.toY - proj.fromY, proj.toX - proj.fromX) * 180) / Math.PI
    nodes.push(
      <CombatBattleProjectile
        key={proj.id}
        x={x}
        y={y}
        angleDeg={angleDeg}
        displayHeightPx={proj.displayHeightPx}
        imageUrl={proj.imageUrl}
      />,
    )
  }
  return (
    <div className="combat-battle-anim-layer" aria-hidden="true">
      {nodes}
    </div>
  )
}

type DieFxLayerProps = LayerProps & {
  dieFallbackEffects: Map<string, DieFallbackEffectSheet | null>
}

/** Shared die FX — above living battle sprites; never flipped. */
export function CombatBattleDieFxLayer({
  battle,
  field,
  catalog,
  stackVisuals,
  dieFallbackEffects,
  settings: settingsProp,
  paintNowMs,
}: DieFxLayerProps) {
  const settings = settingsProp ?? battleAnimSettings(catalog)
  const now = paintNowMs
  const nodes: ReactNode[] = []
  const seen = new Set<string>()

  const pushFx = (
    id: string,
    q: number,
    r: number,
    side: 'atk' | 'def',
    footprint: FootprintCode,
  ) => {
    if (seen.has(id)) {
      return
    }
    const schedule = stackVisuals[id]?.dieFallbackFx
    if (!schedule) {
      return
    }
    seen.add(id)
    const sheet = dieFallbackEffects.get(schedule.effectName)
    if (!sheet) {
      return
    }
    const opacity = dieFallbackFxOpacity(schedule, catalog, settings, now)
    if (opacity <= 0) {
      return
    }
    const frame = dieFallbackFxFrame(sheet, schedule, settings, now)
    if (!frame) {
      return
    }
    const anchor = anchorAt(field.anchors, q, r)
    if (!anchor) {
      return
    }
    const box = stackArtBox(anchor, field.hexPx, footprint, side)
    const foot = stackArtBoxFoot(box, field.hexPx, settings.footOffsetPct)
    const scale = dieFallbackEffectScale(box.height, sheet.restHeight)
    nodes.push(
      <div
        key={`die-fx:${id}`}
        className="combat-battle-die-fx-sprite"
        style={{ opacity }}
      >
        <CombatBattleUnitArt
          frame={frame}
          scale={scale}
          footX={foot.footX}
          footY={foot.footY}
          flipX={false}
        />
      </div>,
    )
  }

  for (const stack of battle.stacks) {
    if (isHeroStack(stack)) {
      continue
    }
    pushFx(
      stack.id,
      stack.q,
      stack.r,
      stack.side,
      combatStackFootprint(stack, catalog),
    )
  }
  for (const tomb of battle.tombstones ?? []) {
    pushFx(
      tomb.id,
      tomb.q,
      tomb.r,
      tomb.side,
      tombCorpseArtFootprintCode(tomb, catalog),
    )
  }

  return (
    <div className="combat-battle-die-fx-layer" aria-hidden="true">
      {nodes}
    </div>
  )
}
