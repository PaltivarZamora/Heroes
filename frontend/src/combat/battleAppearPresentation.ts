import type { Dispatch, SetStateAction } from 'react'
import type { ReferenceCatalog } from '../town/catalog'
import { occupancyKey } from './occupancy'
import type { CombatBattle } from './battle'
import {
  appearEffectTriggerMs,
  latestAppearEndMs,
  type MidBattleAppearSlot,
  type ScheduledMidBattleAppear,
  scheduleMidBattleAppears,
  stackHiddenBeforeAppear,
} from './battleAppear'
import { battleAnimSettings, type BattleAnimSettings } from './battleAnimConfig'
import type { BattleUnitSheetSet } from './battleUnitSheet'
import { preloadBattleUnitSheetsForBattle } from './battleUnitSheet'
import { preloadUnitRainStills } from './battleUnitRainStill'
import { unitById } from '../town/catalog'
import type { HitFlashColor } from './attack'
import { spawnBattleImpactVisual } from './attackPresentation'
import { loadBattleImpactEffectArt } from './battleProjectile'
import { combatStackFootprint } from './movement'
import {
  combatUnitDrawFootPosition,
  type CombatImpactVisual,
} from './combatUnitAnimVisual'

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export type MidBattleAppearPaint = {
  scheduled: ScheduledMidBattleAppear[]
  startedMs: number
}

export function stacksHiddenForAppearPaint(
  paint: MidBattleAppearPaint | null | undefined,
  paintNowMs: number,
): Set<string> {
  const hidden = new Set<string>()
  if (!paint) {
    return hidden
  }
  for (const row of paint.scheduled) {
    if (stackHiddenBeforeAppear(row.stackId, paintNowMs, paint.scheduled)) {
      hidden.add(row.stackId)
    }
  }
  return hidden
}

export function filterFlashesForHiddenAppears(
  groups: Array<{ keys: string[]; color: HitFlashColor }>,
  battle: CombatBattle,
  hidden: Set<string>,
): Array<{ keys: string[]; color: HitFlashColor }> {
  if (hidden.size === 0) {
    return groups
  }
  const hiddenKeys = new Set<string>()
  for (const stack of battle.stacks) {
    if (hidden.has(stack.id)) {
      hiddenKeys.add(occupancyKey(stack.q, stack.r))
    }
  }
  return groups
    .map((group) => ({
      ...group,
      keys: group.keys.filter((key) => !hiddenKeys.has(key)),
    }))
    .filter((group) => group.keys.length > 0)
}

export function appearRevealFlashes(
  battle: CombatBattle,
  scheduled: ScheduledMidBattleAppear[],
  revealMs: number,
  windowMs = 32,
): Array<{ keys: string[]; color: HitFlashColor }> {
  const keys: string[] = []
  for (const row of scheduled) {
    if (Math.abs(row.startMs - revealMs) > windowMs) {
      continue
    }
    const stack = battle.stacks.find((s) => s.id === row.stackId)
    if (stack) {
      keys.push(occupancyKey(stack.q, stack.r))
    }
  }
  if (keys.length === 0) {
    return []
  }
  return [{ keys, color: 'green' }]
}

export async function runMidBattleAppearPresentation(opts: {
  catalog: ReferenceCatalog
  battle: CombatBattle
  slots: MidBattleAppearSlot[]
  originMs: number
  beatStartMs: number[]
  beatStackIds: string[][]
  sheets: Map<number, BattleUnitSheetSet | null>
  hexPx: number
  fieldHeight: number
  setPaint: (paint: MidBattleAppearPaint | null) => void
  onRevealFlash: (groups: Array<{ keys: string[]; color: HitFlashColor }>) => void
  anchors: Array<{ q: number; r: number; x: number; y: number }>
  setImpacts?: Dispatch<SetStateAction<CombatImpactVisual[]>>
  isCancelled: () => boolean
}): Promise<void> {
  const {
    catalog,
    battle,
    slots,
    originMs,
    beatStartMs,
    beatStackIds,
    hexPx,
    setPaint,
    onRevealFlash,
    isCancelled,
  } = opts
  if (slots.length === 0) {
    return
  }
  const unitIds = [...new Set(slots.map((row) => row.unitId))]
  let sheets = opts.sheets
  const missing = unitIds.filter((id) => !sheets.has(id))
  if (missing.length > 0) {
    const loaded = await preloadBattleUnitSheetsForBattle(
      catalog,
      missing,
      (id) => unitById(catalog, id),
    )
    sheets = new Map(sheets)
    for (const [id, set] of loaded) {
      sheets.set(id, set)
    }
  }
  await preloadUnitRainStills(catalog, unitIds)
  const settings: BattleAnimSettings = battleAnimSettings(catalog)
  const scheduled = scheduleMidBattleAppears(
    catalog,
    settings,
    slots,
    originMs,
    beatStartMs,
    beatStackIds,
    sheets,
    hexPx,
  )
  let sessionEndMs = latestAppearEndMs(scheduled)
  const impactDurByEffect = new Map<string, number>()
  for (const row of scheduled) {
    const name = row.effectName?.trim()
    if (!name) {
      continue
    }
    let impactMs = impactDurByEffect.get(name)
    if (impactMs == null) {
      const art = await loadBattleImpactEffectArt(name)
      impactMs = art ? art.durationMs(settings.moveFps) : 0
      impactDurByEffect.set(name, impactMs)
    }
    sessionEndMs = Math.max(
      sessionEndMs,
      appearEffectTriggerMs(row) + impactMs,
    )
  }

  const startedMs = originMs
  setPaint({ scheduled, startedMs })
  const revealed = new Set<string>()
  const effectsPlayed = new Set<string>()
  const impactWaits: Promise<void>[] = []

  const anchorAt = (q: number, r: number) =>
    opts.anchors.find((hex) => hex.q === q && hex.r === r) ?? null

  const tryPlayAppearEffect = (row: ScheduledMidBattleAppear, now: number) => {
    if (!opts.setImpacts || !row.effectName?.trim()) {
      return
    }
    if (effectsPlayed.has(row.stackId)) {
      return
    }
    if (now < appearEffectTriggerMs(row)) {
      return
    }
    const stack = battle.stacks.find((s) => s.id === row.stackId)
    const anchor = stack ? anchorAt(stack.q, stack.r) : null
    if (!stack || !anchor) {
      effectsPlayed.add(row.stackId)
      return
    }
    effectsPlayed.add(row.stackId)
    const foot = combatUnitDrawFootPosition(
      anchor,
      hexPx,
      settings.footOffsetPct,
      combatStackFootprint(stack, catalog),
      stack.side,
      undefined,
      now,
    )
    const displayHeightPx = Math.max(8, Math.round(hexPx))
    const wait = spawnBattleImpactVisual({
      id: `appear-fx:${row.stackId}:${Math.round(appearEffectTriggerMs(row))}`,
      x: foot.footX,
      y: foot.footY,
      effectName: row.effectName.trim(),
      displayHeightPx,
      animFps: settings.moveFps,
      setImpacts: opts.setImpacts,
      isCancelled: opts.isCancelled,
    })
    impactWaits.push(wait)
  }

  while (!isCancelled()) {
    const now = performance.now()
    for (const row of scheduled) {
      if (revealed.has(row.stackId)) {
        // already revealed
      } else if (now >= row.startMs) {
        revealed.add(row.stackId)
        const flash = appearRevealFlashes(battle, [row], now)
        if (flash.length > 0) {
          onRevealFlash(flash)
        }
      }
      tryPlayAppearEffect(row, now)
    }
    if (now >= sessionEndMs) {
      break
    }
    await sleepMs(16)
  }
  if (!isCancelled()) {
    for (const row of scheduled) {
      if (row.kind !== 'instant' && !revealed.has(row.stackId)) {
        revealed.add(row.stackId)
        onRevealFlash(appearRevealFlashes(battle, [row], row.startMs))
      }
      tryPlayAppearEffect(row, appearEffectTriggerMs(row))
    }
  }
  await Promise.all(impactWaits)
  setPaint(null)
}

export function buildBeatStartTimes(
  originMs: number,
  beatCount: number,
  beatMs: number,
): number[] {
  const out: number[] = []
  for (let i = 0; i < beatCount; i += 1) {
    out.push(originMs + i * beatMs)
  }
  return out
}

export function beatAppearStackIds(
  beats: Array<{ appearStackIds?: string[] }> | undefined,
): string[][] {
  if (!beats || beats.length === 0) {
    return []
  }
  return beats.map((beat) => beat.appearStackIds ?? [])
}