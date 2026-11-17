import type { ReferenceCatalog } from '../town/catalog'
import { isHeroStack, type CombatStack, type CombatSide } from './battle'
import { battleAnimSettings } from './battleAnimConfig'
import {
  combatUnitDrawFootPosition,
  type StackBattleVisual,
} from './combatUnitAnimVisual'
import { heroBattleMountFoot } from './combatHeroMountArt'
import { battleHeroMountFootprint } from './battleAnimConfig'
import { combatStackFootprint } from './movement'

type HexAnchor = { q: number; r: number; x: number; y: number }

export function stackBattleFootPaintY(
  stack: CombatStack,
  hexAnchor: HexAnchor,
  hexPx: number,
  footOffsetPct: number,
  catalog: ReferenceCatalog,
  visual: StackBattleVisual | undefined,
  paintNowMs: number,
): number {
  if (isHeroStack(stack)) {
    const footprint = battleHeroMountFootprint(catalog)
    return heroBattleMountFoot(
      hexAnchor,
      hexPx,
      footOffsetPct,
      stack.side,
      footprint,
    ).footY
  }
  const footprint = combatStackFootprint(stack, catalog)
  return combatUnitDrawFootPosition(
    hexAnchor,
    hexPx,
    footOffsetPct,
    footprint,
    stack.side,
    visual,
    paintNowMs,
  ).footY
}

function anchorAt(
  anchors: HexAnchor[],
  q: number,
  r: number,
): HexAnchor | null {
  return anchors.find((row) => row.q === q && row.r === r) ?? null
}

function comparePaintOrder(
  ya: number,
  yb: number,
  idA: string,
  idB: string,
): number {
  if (yb !== ya) {
    return yb - ya
  }
  return idA.localeCompare(idB)
}

/** Living stacks: lower foot Y paints later (on top). Heroes included. */
export function stacksSortedForBattlePaint(
  stacks: CombatStack[],
  anchors: HexAnchor[],
  catalog: ReferenceCatalog,
  stackVisuals: Record<string, StackBattleVisual>,
  hexPx: number,
  footOffsetPct: number,
  paintNowMs: number,
): CombatStack[] {
  const withY = stacks
    .filter((stack) => stack.qty > 0)
    .map((stack) => {
      const anchor = anchorAt(anchors, stack.q, stack.r)
      const footY =
        anchor != null
          ? stackBattleFootPaintY(
              stack,
              anchor,
              hexPx,
              footOffsetPct,
              catalog,
              stackVisuals[stack.id],
              paintNowMs,
            )
          : 0
      return { stack, footY }
    })
  withY.sort((a, b) =>
    comparePaintOrder(a.footY, b.footY, a.stack.id, b.stack.id),
  )
  return withY.map((row) => row.stack)
}

/** Changes when grid position or slide foot moves — skip re-sort when unchanged. */
export function battleStackPaintOrderKey(
  stacks: CombatStack[],
  anchors: HexAnchor[],
  catalog: ReferenceCatalog,
  stackVisuals: Record<string, StackBattleVisual>,
  hexPx: number,
  footOffsetPct: number,
  paintNowMs: number,
): string {
  const parts: string[] = []
  for (const stack of stacks) {
    if (stack.qty <= 0) {
      continue
    }
    const anchor = anchorAt(anchors, stack.q, stack.r)
    const visual = stackVisuals[stack.id]
    if (!anchor) {
      parts.push(`${stack.id}:?`)
      continue
    }
    if (visual?.slide) {
      const footY = stackBattleFootPaintY(
        stack,
        anchor,
        hexPx,
        footOffsetPct,
        catalog,
        visual,
        paintNowMs,
      )
      parts.push(`${stack.id}:s:${footY.toFixed(2)}`)
    } else {
      parts.push(`${stack.id}:${stack.q},${stack.r}`)
    }
  }
  return parts.join(';')
}

const livingPaintCache: {
  key: string
  stackIds: string[]
} = { key: '', stackIds: [] }

export function resolveLivingStacksPaintOrder(
  stacks: CombatStack[],
  anchors: HexAnchor[],
  catalog: ReferenceCatalog,
  stackVisuals: Record<string, StackBattleVisual>,
  hexPx: number,
  footOffsetPct: number,
  paintNowMs: number,
): CombatStack[] {
  const key = battleStackPaintOrderKey(
    stacks,
    anchors,
    catalog,
    stackVisuals,
    hexPx,
    footOffsetPct,
    paintNowMs,
  )
  if (key !== livingPaintCache.key) {
    livingPaintCache.key = key
    livingPaintCache.stackIds = stacksSortedForBattlePaint(
      stacks,
      anchors,
      catalog,
      stackVisuals,
      hexPx,
      footOffsetPct,
      paintNowMs,
    ).map((row) => row.id)
  }
  const byId = new Map(stacks.map((row) => [row.id, row]))
  return livingPaintCache.stackIds
    .map((id) => byId.get(id))
    .filter(
      (row): row is CombatStack => row != null && row.qty > 0,
    )
}

export function resetBattleStackPaintOrderCache(): void {
  livingPaintCache.key = ''
  livingPaintCache.stackIds = []
  corpsePaintCache.key = ''
  corpsePaintCache.entries = []
}

const corpsePaintCache: {
  key: string
  entries: CorpsePaintEntry[]
} = { key: '', entries: [] }

export function resolveCorpsePaintOrder(
  entries: CorpsePaintEntry[],
): CorpsePaintEntry[] {
  const key = battleCorpsePaintOrderKey(entries)
  if (key !== corpsePaintCache.key) {
    corpsePaintCache.key = key
    corpsePaintCache.entries = corpsesSortedForBattlePaint(entries)
  }
  return corpsePaintCache.entries
}

export type CorpsePaintEntry = {
  id: string
  unitId: number
  q: number
  r: number
  side: CombatSide
  footprint: import('./footprint').FootprintCode
  visual: StackBattleVisual | undefined
  footY: number
}

export function corpsesSortedForBattlePaint(
  entries: CorpsePaintEntry[],
): CorpsePaintEntry[] {
  return [...entries].sort((a, b) =>
    comparePaintOrder(a.footY, b.footY, a.id, b.id),
  )
}

export function battleCorpsePaintOrderKey(entries: CorpsePaintEntry[]): string {
  return entries
    .map((row) => `${row.id}:${row.q},${row.r}:${row.footY.toFixed(2)}`)
    .join(';')
}

export function defaultBattleFootOffsetPct(
  catalog: ReferenceCatalog | null | undefined,
): number {
  return battleAnimSettings(catalog).footOffsetPct
}
