import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import { unitById } from '../town/catalog'
import type { BattleUnitSheetSet } from './battleUnitSheet'
import {
  appearRainHexPerSec,
  appearRiseSec,
  appearStaggerSec,
} from './battleAppearConfig'
import { battleUnitSheetFps, type BattleAnimSettings } from './battleAnimConfig'

export type UnitAppearStyleKind = 'sheet' | 'rise' | 'rain' | 'instant'

export type MidBattleAppearSlot = {
  stackId: string
  unitId: number
}

/** One registration point for every stack placed mid-battle. */
export function registerMidBattleAppear(
  bucket: MidBattleAppearSlot[],
  stackId: string,
  unitId: number,
): void {
  bucket.push({ stackId, unitId })
}

export function mergeMidBattleAppears(
  ...groups: Array<MidBattleAppearSlot[] | undefined>
): MidBattleAppearSlot[] {
  const out: MidBattleAppearSlot[] = []
  for (const group of groups) {
    if (!group || group.length === 0) {
      continue
    }
    out.push(...group)
  }
  return out
}

export function resolveUnitAppearStyleKind(
  unit: UnitRow | null | undefined,
  set: BattleUnitSheetSet | null | undefined,
): UnitAppearStyleKind {
  if (set?.appearSheet) {
    return 'sheet'
  }
  const style = unit?.appear_style
  if (style === 'rise') {
    return 'rise'
  }
  if (style === 'rain') {
    return 'rain'
  }
  return 'instant'
}

export function appearStyleUsesMotion(kind: UnitAppearStyleKind): boolean {
  return kind !== 'instant'
}

export type ScheduledMidBattleAppear = {
  stackId: string
  unitId: number
  startMs: number
  kind: UnitAppearStyleKind
  durationMs: number
  effectName: string | null
}

export function appearDurationMs(
  catalog: ReferenceCatalog,
  settings: BattleAnimSettings,
  _unit: UnitRow | null | undefined,
  set: BattleUnitSheetSet | null | undefined,
  kind: UnitAppearStyleKind,
  hexPx: number,
): number {
  if (kind === 'instant') {
    return 0
  }
  if (kind === 'sheet') {
    const sheet = set?.appearSheet
    const frames = sheet?.frames.length ?? 0
    if (frames <= 0) {
      return 0
    }
    const fps = battleUnitSheetFps(settings, 'Appear')
    return (frames / Math.max(1, fps)) * 1000
  }
  if (kind === 'rise') {
    const sec = appearRiseSec(catalog)
    return sec != null ? sec * 1000 : 0
  }
  if (kind === 'rain') {
    const speed = appearRainHexPerSec(catalog)
    if (speed == null || hexPx <= 0) {
      return 0
    }
    const fallHexes = 4
    return (fallHexes / speed) * 1000
  }
  return 0
}

/**
 * Schedule appear start times: beat-linked stacks use beat start ms;
 * others stagger by placement order from originMs.
 */
export function scheduleMidBattleAppears(
  catalog: ReferenceCatalog,
  settings: BattleAnimSettings,
  slots: MidBattleAppearSlot[],
  originMs: number,
  beatStartMs: number[],
  beatStackIds: string[][],
  sheets: Map<number, BattleUnitSheetSet | null>,
  hexPx: number,
): ScheduledMidBattleAppear[] {
  if (slots.length === 0) {
    return []
  }
  const beatForStack = new Map<string, number>()
  for (let i = 0; i < beatStackIds.length; i += 1) {
    for (const id of beatStackIds[i] ?? []) {
      if (!beatForStack.has(id)) {
        beatForStack.set(id, i)
      }
    }
  }
  const staggerSec = appearStaggerSec(catalog)
  const staggerMs = staggerSec != null ? staggerSec * 1000 : 0
  let looseOrder = 0
  const out: ScheduledMidBattleAppear[] = []
  for (const slot of slots) {
    const unit = unitById(catalog, slot.unitId)
    const set = sheets.get(slot.unitId) ?? null
    const kind = resolveUnitAppearStyleKind(unit, set)
    const beatIdx = beatForStack.get(slot.stackId)
    let startMs = originMs
    if (beatIdx != null && beatIdx >= 0 && beatIdx < beatStartMs.length) {
      startMs = beatStartMs[beatIdx]!
    } else {
      startMs = originMs + looseOrder * staggerMs
      looseOrder += 1
    }
    const durationMs = appearDurationMs(
      catalog,
      settings,
      unit,
      set,
      kind,
      hexPx,
    )
    const effectiveKind =
      kind !== 'instant' && durationMs <= 0 ? 'instant' : kind
    out.push({
      stackId: slot.stackId,
      unitId: slot.unitId,
      startMs,
      kind: effectiveKind,
      durationMs: effectiveKind === 'instant' ? 0 : durationMs,
      effectName: unit?.appear_effect?.trim() || null,
    })
  }
  return out
}

export function latestAppearEndMs(
  scheduled: ScheduledMidBattleAppear[],
): number {
  let end = 0
  for (const row of scheduled) {
    end = Math.max(end, row.startMs + row.durationMs)
  }
  return end
}

/** When `appear_effect` should play: rain = landing; rise/sheet (and instant) = appear start. */
export function appearEffectTriggerMs(row: ScheduledMidBattleAppear): number {
  if (row.kind === 'rain') {
    return row.startMs + row.durationMs
  }
  return row.startMs
}

/** True while the stack must not paint on the normal layer (before appear start). */
export function stackHiddenBeforeAppear(
  stackId: string,
  paintNowMs: number,
  scheduled: ScheduledMidBattleAppear[],
): boolean {
  const row = scheduled.find((entry) => entry.stackId === stackId)
  if (!row) {
    return false
  }
  if (!appearStyleUsesMotion(row.kind)) {
    return false
  }
  return paintNowMs < row.startMs
}

/** True while a non-instant appear clip/sheet is driving the stack paint. */
export function stackInAppearMotion(
  stackId: string,
  paintNowMs: number,
  scheduled: ScheduledMidBattleAppear[],
): boolean {
  const row = scheduled.find((entry) => entry.stackId === stackId)
  if (!row || !appearStyleUsesMotion(row.kind)) {
    return false
  }
  return (
    paintNowMs >= row.startMs &&
    paintNowMs < row.startMs + row.durationMs
  )
}

export function appearMotionProgress(
  stackId: string,
  paintNowMs: number,
  scheduled: ScheduledMidBattleAppear[],
): number {
  const row = scheduled.find((entry) => entry.stackId === stackId)
  if (!row || row.durationMs <= 0) {
    return 1
  }
  const t = (paintNowMs - row.startMs) / row.durationMs
  return Math.min(1, Math.max(0, t))
}