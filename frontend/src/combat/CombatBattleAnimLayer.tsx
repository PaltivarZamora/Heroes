import type { ReactNode } from 'react'
import {
  battleAnimSettings,
  battleHeroMountFootprint,
  battleIdleSettings,
  type BattleAnimSettings,
} from './battleAnimConfig'
import { combatBattleUnitScaleForSheetSet, combatBattleUnitSpriteScale, stackArtBox, stackArtBoxFoot } from './combatStackArtBox'
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
  type CombatImpactVisual,
  type CombatProjectileVisual,
  type CombatShapeVisual,
  type StackBattleVisual,
} from './combatUnitAnimVisual'
import {
  CombatBattleImpactEffect,
  CombatBattleProjectile,
  CombatBattleShapeVisual,
  CombatBattleUnitArt,
} from './CombatBattleUnitArt'
import type { CombatBattle } from './battle'
import { isHeroStack } from './battle'
import type { ReferenceCatalog } from '../town/catalog'
import { unitById, unitFootprint, unitSpriteScalePct } from '../town/catalog'
import { combatStackFootprint, moveKindForUnit } from './movement'
import { proceduralIdleMotionForStack, proceduralIdleTransformCss } from './proceduralBattleIdle'
import { proceduralHitTransformCss, proceduralHitTransformOrigin } from './proceduralBattleHit'
import {
  resolveCorpsePaintOrder,
  resolveLivingStacksPaintOrder,
  stackBattleFootPaintY,
  type CorpsePaintEntry,
} from './battleStackPaintOrder'
import { tombCorpseDrawFoot } from './combatCorpsePaint'
import { stackShowsBattleSprites } from './combatUnitAnimPlayback'
import {
  clampPolymorphBattleVisual,
  stackUsesPolymorphBattleArt,
} from './polymorphBattleArt'
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
  corpseBattleSpriteScale,
  corpseUsesOwnDieSheetHold,
  pickCorpseDieFrame,
  tombCorpseArtFootprintCode,
} from './combatCorpsePaint'
import type { FootprintCode } from './footprint'
import type { CombatSide } from './battle'
import {
  flipHeroMountBattleForSide,
  heroBattleMountFoot,
} from './combatHeroMountArt'
import type { HeroMountBattleArt } from './heroMountBattleSheet'
import {
  stackHiddenBeforeAppear,
  stackInAppearMotion,
  type ScheduledMidBattleAppear,
} from './battleAppear'
import { unitRainStillForBattle } from './battleUnitRainStill'
import type { MidBattleAppearPaint } from './battleAppearPresentation'
import {
  appearRiseBodyHeightPx,
  appearRiseFootClipStyle,
  resolveAppearPaintTransform,
} from './combatAppearPaint'
type HexAnchor = { q: number; r: number; x: number; y: number }

type LayerProps = {
  battle: CombatBattle
  field: {
    hexPx: number
    height: number
    anchors: HexAnchor[]
  }
  catalog: ReferenceCatalog
  unitSheets: Map<number, BattleUnitSheetSet | null>
  stackVisuals: Record<string, StackBattleVisual>
  heroMountArt?: Map<string, HeroMountBattleArt | null>
  polymorphBattleSheet?: BattleUnitSheetSet | null
  settings?: BattleAnimSettings
  paintNowMs: number
  appearPaint?: MidBattleAppearPaint | null
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
  const tombUnit = unitById(catalog, unitId)
  const drawPct = unitSpriteScalePct(tombUnit)
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
    const scale = corpseBattleSpriteScale(
      field.hexPx,
      footprint,
      side,
      set,
      settings,
      drawPct,
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
      spriteScale={
        set
          ? corpseBattleSpriteScale(
              field.hexPx,
              footprint,
              side,
              set,
              settings,
              drawPct,
            )
          : undefined
      }
      unitDrawScalePct={drawPct}
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
  const corpseEntries: CorpsePaintEntry[] = []

  const queueCorpse = (
    id: string,
    unitId: number,
    q: number,
    r: number,
    side: CombatSide,
    footprint: FootprintCode,
    visual: StackBattleVisual | undefined,
    footY: number,
  ) => {
    if (painted.has(id)) {
      return
    }
    corpseEntries.push({
      id,
      unitId,
      q,
      r,
      side,
      footprint,
      visual,
      footY,
    })
  }

  for (const tomb of battle.tombstones ?? []) {
    const visual = stackVisuals[tomb.id]
    const anchor = anchorAt(field.anchors, tomb.q, tomb.r)
    if (!anchor) {
      continue
    }
    const foot = tombCorpseDrawFoot(
      tomb,
      anchor,
      field.hexPx,
      settings.footOffsetPct,
      tomb.side,
      catalog,
      visual,
      now,
    )
    queueCorpse(
      tomb.id,
      tomb.unitId,
      tomb.q,
      tomb.r,
      tomb.side,
      corpseArtFootprintForTomb(tomb, catalog),
      visual,
      foot.footY,
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
    const anchor = anchorAt(field.anchors, stack.q, stack.r)
    const footY =
      anchor != null
        ? stackBattleFootPaintY(
            stack,
            anchor,
            field.hexPx,
            settings.footOffsetPct,
            catalog,
            visual,
            now,
          )
        : 0
    queueCorpse(
      stack.id,
      stack.unitId,
      stack.q,
      stack.r,
      stack.side,
      combatStackFootprint(stack, catalog),
      visual,
      footY,
    )
  }

  for (const entry of resolveCorpsePaintOrder(corpseEntries)) {
    const node = paintCorpseNode(
      entry.id,
      entry.unitId,
      entry.q,
      entry.r,
      entry.side,
      entry.footprint,
      entry.visual,
      catalog,
      unitSheets,
      field,
      settings,
      now,
    )
    if (node) {
      painted.add(entry.id)
      nodes.push(node)
    }
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
  heroMountArt,
  polymorphBattleSheet = null,
  projectiles,
  impacts,
  shapes,
  settings: settingsProp,
  paintNowMs,
  appearPaint = null,
}: LayerProps & {
  projectiles: CombatProjectileVisual[]
  impacts?: CombatImpactVisual[]
  shapes?: CombatShapeVisual[]
}) {
  const settings = settingsProp ?? battleAnimSettings(catalog)
  const idleSettings = battleIdleSettings(catalog)
  const now = paintNowMs
  const nodes: ReactNode[] = []
  const paintStacks = resolveLivingStacksPaintOrder(
    battle.stacks,
    field.anchors,
    catalog,
    stackVisuals,
    field.hexPx,
    settings.footOffsetPct,
    now,
  )
  const scheduled: ScheduledMidBattleAppear[] = appearPaint?.scheduled ?? []
  for (const stack of paintStacks) {
    const stackVisualEarly = stackVisuals[stack.id]
    if (
      scheduled.length > 0 &&
      stackHiddenBeforeAppear(stack.id, now, scheduled)
    ) {
      continue
    }
    if (isHeroStack(stack)) {
      if (stack.qty <= 0) {
        continue
      }
      const mountArt = heroMountArt?.get(stack.id)
      if (!mountArt) {
        continue
      }
      const anchor = anchorAt(field.anchors, stack.q, stack.r)
      if (!anchor) {
        continue
      }
      const heroFootprint = battleHeroMountFootprint(catalog)
      const foot = heroBattleMountFoot(
        anchor,
        field.hexPx,
        settings.footOffsetPct,
        stack.side,
        heroFootprint,
      )
      const scale = combatBattleUnitSpriteScale(
        field.hexPx,
        heroFootprint,
        stack.side,
        mountArt.restHeight,
        mountArt.frame.w,
        settings,
      )
      const idleMotion = proceduralIdleMotionForStack(
        stack.id,
        idleSettings.periodSec,
      )
      const motionTransform = idleSettings.enabled
        ? proceduralIdleTransformCss(
            now,
            idleMotion,
            'ground',
            field.hexPx,
            idleSettings,
          )
        : undefined
      nodes.push(
        <CombatBattleUnitArt
          key={`hero-mount:${stack.id}`}
          frame={mountArt.frame}
          scale={scale}
          footX={foot.footX}
          footY={foot.footY}
          flipX={flipHeroMountBattleForSide(stack.side)}
          motionTransform={motionTransform}
        />,
      )
      continue
    }
    if (
      !stackShowsBattleSprites(
        stack,
        catalog,
        unitSheets,
        stackVisualEarly,
        now,
        polymorphBattleSheet,
      )
    ) {
      continue
    }
    const unitFootprint = combatStackFootprint(stack, catalog)
    const polymorphActive = stackUsesPolymorphBattleArt(
      stack,
      catalog,
      polymorphBattleSheet,
    )
    const footprint: FootprintCode = polymorphActive ? '1x1' : unitFootprint
    const set = polymorphActive
      ? polymorphBattleSheet
      : sheetSetForUnit(stack.unitId, catalog, unitSheets)
    if (!set?.animated) {
      continue
    }
    let visual = stackVisuals[stack.id] ?? {
      kind: 'idle' as const,
      startedMs: now,
      frameOffset: 0,
    }
    if (polymorphActive) {
      visual = clampPolymorphBattleVisual(visual)
    }
    const anchor = anchorAt(field.anchors, stack.q, stack.r)
    if (!anchor) {
      continue
    }
    const drawFoot = combatUnitDrawFootPosition(
      anchor,
      field.hexPx,
      settings.footOffsetPct,
      unitFootprint,
      stack.side,
      visual,
      now,
    )
    const appearRow = scheduled.find((row) => row.stackId === stack.id)
    const unit = unitById(catalog, stack.unitId)
    const drawPct = polymorphActive ? 100 : unitSpriteScalePct(unit)
    const riseBody = appearRiseBodyHeightPx(
      field.hexPx,
      unitFootprint,
      stack.side,
      set,
      settings,
      unit,
    )
    const appearMotion =
      appearRow && stackInAppearMotion(stack.id, now, scheduled)
        ? resolveAppearPaintTransform(
            appearRow,
            scheduled,
            now,
            field.hexPx,
            field.height,
            riseBody,
            set,
            settings,
          )
        : null
    const rainStill =
      appearRow?.kind === 'rain' && appearMotion
        ? unitRainStillForBattle(stack.unitId)
        : null
    const picked = appearMotion?.appearSheetFrame
      ? {
          frame: appearMotion.appearSheetFrame,
          sheetKind: 'Idle' as const,
        }
      : rainStill
        ? { frame: rainStill, sheetKind: 'Idle' as const }
        : pickVisualFrame(set, visual, settings, now)
    if (!picked) {
      continue
    }
    const sheet =
      set.sheets[picked.sheetKind] ?? set.sheets.Idle ?? set.sheets.Move
    if (!sheet) {
      continue
    }
    const scale = combatBattleUnitScaleForSheetSet(
      field.hexPx,
      footprint,
      stack.side,
      set,
      settings,
      drawPct,
    )
    let motionTransform: string | undefined
    let motionTransformOrigin: string | undefined
    let footX = drawFoot.footX
    let footY = drawFoot.footY
    const riseRestFootY =
      appearRow?.kind === 'rise' && appearMotion != null
        ? drawFoot.footY
        : null
    if (appearMotion) {
      footY += appearMotion.offsetY
    }
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
      unit &&
      !rainStill
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
    const art = (
      <CombatBattleUnitArt
        frame={picked.frame}
        scale={scale}
        footX={footX}
        footY={footY}
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
      />
    )
    nodes.push(
      riseRestFootY != null ? (
        <div
          key={`anim:${stack.id}`}
          className="combat-appear-rise-foot-clip"
          style={appearRiseFootClipStyle(riseRestFootY)}
        >
          {art}
        </div>
      ) : (
        art
      ),
    )
  }
  for (const proj of projectiles) {
    const t = progressForTimedAnim(proj.startedMs, proj.durationMs, now)
    const x = proj.fromX + (proj.toX - proj.fromX) * t
    const y = proj.fromY + (proj.toY - proj.fromY) * t
    const dx = proj.toX - proj.fromX
    const dy = proj.toY - proj.fromY
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
    const flipY = dx < 0
    let sheetFrame = null
    if (proj.sheetFrames && proj.sheetFrames.length > 0) {
      const elapsed = (now - proj.startedMs) / 1000
      const idx =
        Math.floor(elapsed * proj.animFps) %
        (proj.sheetLoop
          ? proj.sheetFrames.length
          : Math.max(1, proj.sheetFrames.length))
      sheetFrame = proj.sheetFrames[
        Math.min(idx, proj.sheetFrames.length - 1)
      ]!
    }
    nodes.push(
      <CombatBattleProjectile
        key={proj.id}
        x={x}
        y={y}
        angleDeg={angleDeg}
        displayHeightPx={proj.displayHeightPx}
        staticUrl={proj.staticUrl}
        sheetFrame={sheetFrame}
        flipY={flipY}
      />,
    )
  }
  for (const sh of shapes ?? []) {
    const progress = progressForTimedAnim(sh.startedMs, sh.durationMs, now)
    if (progress >= 1) {
      continue
    }
    const elapsed = (now - sh.startedMs) / 1000
    const frameIdx = Math.min(
      sh.frames.length - 1,
      Math.floor(elapsed * sh.animFps),
    )
    const frame = sh.frames[frameIdx]
    if (!frame) {
      continue
    }
    nodes.push(
      <CombatBattleShapeVisual
        key={sh.id}
        x={sh.x}
        y={sh.y}
        frame={frame}
        displayWidthPx={sh.displayWidthPx}
        displayHeightPx={sh.displayHeightPx}
        angleDeg={sh.angleDeg}
        flipY={sh.flipY}
        rotate={sh.rotate}
        scaleUniform={sh.scaleUniform !== false}
        pinAnchorX={sh.pinAnchorX}
        pinAnchorY={sh.pinAnchorY}
      />,
    )
  }
  for (const fx of impacts ?? []) {
    const progress = progressForTimedAnim(fx.startedMs, fx.durationMs, now)
    if (progress >= 1) {
      continue
    }
    const elapsed = (now - fx.startedMs) / 1000
    const frameIdx = Math.min(
      fx.frames.length - 1,
      Math.floor(elapsed * fx.animFps),
    )
    const frame = fx.frames[frameIdx]
    if (!frame) {
      continue
    }
    nodes.push(
      <CombatBattleImpactEffect
        key={fx.id}
        x={fx.x}
        y={fx.y}
        frame={frame}
        displayHeightPx={fx.displayHeightPx}
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
  for (const [id, visual] of Object.entries(stackVisuals)) {
    if (!visual?.dieFallbackFx || seen.has(id)) {
      continue
    }
    const anchor = visual.dieFxAnchor
    if (!anchor) {
      continue
    }
    pushFx(
      id,
      anchor.q,
      anchor.r,
      anchor.side,
      unitFootprint(unitById(catalog, anchor.unitId)),
    )
  }

  return (
    <div className="combat-battle-die-fx-layer" aria-hidden="true">
      {nodes}
    </div>
  )
}
