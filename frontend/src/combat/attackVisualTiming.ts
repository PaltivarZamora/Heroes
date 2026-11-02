import type { Axial } from '../hex/hero'
import { hexDistance } from '../hex/pathfinding'
import type {
  AttackShapeKind,
  ProjectileRow,
  ReferenceCatalog,
  UnitRow,
} from '../town/catalog'
import { unitAttackShape, unitById } from '../town/catalog'
import { basicPartnerForAdvanced } from '../town/unitUpgrade'
import { parseFootprint, footprintExtent } from './footprint'
import { unitFootprint } from '../town/catalog'
import {
  actionOriginFootprintHex,
  closestHexOnTargetFootprint,
} from './actionOrigin'
import type { CombatStack } from './battle'
import { appendBattleAnimCombatLog } from './battleAnimLogBridge'
import { unitProjectileRow } from './battleProjectile'
import { stackArtBox, stackArtBoxFoot } from './combatStackArtBox'
import { hexLine } from './shapes'

const SHAPE_VISUAL_SHAPES: ReadonlySet<AttackShapeKind> = new Set([
  'breath',
  'pulse',
  'aoe',
  'cleave',
])

const warnedMismatch = new Set<string>()

export function normalizeProjectileKind(row: ProjectileRow): 'flight' | 'shape' {
  const k = (row.kind ?? 'flight').trim().toLowerCase()
  return k === 'shape' ? 'shape' : 'flight'
}

export function projectileRowFitsAttack(
  row: ProjectileRow,
  attackShape: AttackShapeKind,
  maxRange: number,
): boolean {
  const kind = normalizeProjectileKind(row)
  if (kind === 'shape') {
    if (!SHAPE_VISUAL_SHAPES.has(attackShape)) {
      return false
    }
    if (attackShape === 'aoe' && maxRange > 1) {
      return false
    }
    return true
  }
  if (attackShape === 'chain') {
    return true
  }
  if (attackShape === 'beam' || attackShape === 'line') {
    return true
  }
  if (attackShape === 'aoe' && maxRange > 1) {
    return true
  }
  if (maxRange > 1) {
    return !SHAPE_VISUAL_SHAPES.has(attackShape)
  }
  return false
}

export function warnProjectileRowMismatch(
  unit: UnitRow,
  row: ProjectileRow,
  attackShape: AttackShapeKind,
): void {
  const key = `${unit.id}:${row.id}:${row.kind}:${attackShape}`
  if (warnedMismatch.has(key)) {
    return
  }
  warnedMismatch.add(key)
  appendBattleAnimCombatLog(
    `Projectile '${row.name}' kind '${row.kind}' does not match ${unit.name} attack shape '${attackShape}' — no extra visual.`,
  )
}

/** Row after kind/shape validation; null when mismatch or missing. */
export function effectiveProjectileRow(
  catalog: ReferenceCatalog,
  unitId: number,
  attackShape: AttackShapeKind,
  maxRange: number,
): ProjectileRow | null {
  const row = unitProjectileRow(catalog, unitId)
  if (!row) {
    return null
  }
  if (!projectileRowFitsAttack(row, attackShape, maxRange)) {
    const unit = unitById(catalog, unitId)
    if (unit) {
      warnProjectileRowMismatch(unit, row, attackShape)
    }
    return null
  }
  return row
}

export function attackShapeAreaMaxSpan(
  unit: UnitRow,
  attackShape: AttackShapeKind,
): number {
  const spec = unitAttackShape(unit)
  const fp = footprintExtent(parseFootprint(unit.footprint))
  const body = Math.max(fp.cols, fp.rows)
  switch (attackShape) {
    case 'pulse':
      return body + Math.max(1, spec.radius ?? 1) * 2
    case 'aoe':
      return Math.max(1, spec.radius ?? 1) * 2 + 1
    case 'breath':
      return body + Math.max(1, spec.rows ?? 1) + 2
    case 'cleave':
      return body + 2
    default:
      return body
  }
}

/** Uniform scale: this unit's area ÷ Basic partner's (1 when no partner). */
export function shapeVisualPartnerScale(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  attackShape: AttackShapeKind,
): number {
  const selfSpan = attackShapeAreaMaxSpan(unit, attackShape)
  const partner = basicPartnerForAdvanced(catalog, unit)
  if (!partner) {
    return 1
  }
  const partnerSpan = attackShapeAreaMaxSpan(partner, attackShape)
  return selfSpan / Math.max(1, partnerSpan)
}

export function shapeVisualBoxPx(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  attackShape: AttackShapeKind,
  hexPx: number,
): { width: number; height: number } {
  const partner = basicPartnerForAdvanced(catalog, unit)
  const selfSpan = attackShapeAreaMaxSpan(unit, attackShape)
  const partnerSpan = partner
    ? attackShapeAreaMaxSpan(partner, attackShape)
    : selfSpan
  const scale = partner ? selfSpan / Math.max(1, partnerSpan) : 1
  const side = Math.max(partnerSpan, 1) * hexPx * scale
  return { width: side, height: side }
}

type HexAnchor = { q: number; r: number; x: number; y: number }

function hexCenter(
  anchors: HexAnchor[],
  q: number,
  r: number,
): { x: number; y: number } | null {
  return anchors.find((row) => row.q === q && row.r === r) ?? null
}

export function shapeVisualPlacement(opts: {
  mode: 'breath' | 'cleave' | 'pulse' | 'aoe'
  striker: CombatStack
  primaryTarget: CombatStack | null
  aimHex: Axial
  catalog: ReferenceCatalog
  anchors: HexAnchor[]
  hexPx: number
  footOffsetPct: number
}): {
  x: number
  y: number
  angleDeg: number
  flipY: boolean
  rotate: boolean
} {
  const footprint = unitFootprint(unitById(opts.catalog, opts.striker.unitId))
  const strikerAnchor = opts.anchors.find(
    (row) => row.q === opts.striker.q && row.r === opts.striker.r,
  )
  if (opts.mode === 'pulse' && strikerAnchor) {
    const box = stackArtBox(
      strikerAnchor,
      opts.hexPx,
      footprint,
      opts.striker.side,
    )
    const foot = stackArtBoxFoot(box, opts.hexPx, opts.footOffsetPct)
    return {
      x: foot.footX,
      y: foot.footY - box.height * 0.35,
      angleDeg: 0,
      flipY: false,
      rotate: false,
    }
  }
  if (opts.mode === 'aoe') {
    const c = hexCenter(opts.anchors, opts.aimHex.q, opts.aimHex.r)
    return {
      x: c?.x ?? 0,
      y: c?.y ?? 0,
      angleDeg: 0,
      flipY: false,
      rotate: false,
    }
  }
  const target = opts.primaryTarget
  const aim = target
    ? closestHexOnTargetFootprint(opts.striker, target, opts.catalog)
    : opts.aimHex
  const origin = actionOriginFootprintHex(
    { q: opts.striker.q, r: opts.striker.r },
    opts.striker,
    opts.catalog,
    aim,
  )
  const from = hexCenter(opts.anchors, origin.q, origin.r)
  const to = hexCenter(opts.anchors, aim.q, aim.r)
  if (!from || !to) {
    return { x: 0, y: 0, angleDeg: 0, flipY: false, rotate: true }
  }
  const dx = to.x - from.x
  const dy = to.y - from.y
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI
  return {
    x: from.x,
    y: from.y,
    angleDeg,
    flipY: dx < 0,
    rotate: true,
  }
}

/** Fraction along beam/line (0–1) when projectile reaches target footprint. */
export function beamPassProgress(
  striker: CombatStack,
  target: CombatStack,
  catalog: ReferenceCatalog,
  aimHex: Axial,
  maxRange: number,
): number {
  const origin = actionOriginFootprintHex(
    { q: striker.q, r: striker.r },
    striker,
    catalog,
    aimHex,
  )
  const line = hexLine(origin, aimHex)
  const capped =
    line.length > maxRange + 1 ? line.slice(0, maxRange + 1) : line
  if (capped.length < 2) {
    return 1
  }
  const targetHex = closestHexOnTargetFootprint(striker, target, catalog)
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < capped.length; i += 1) {
    const d = hexDistance(capped[i]!, targetHex)
    if (d < bestDist) {
      bestDist = d
      bestIdx = i
    }
  }
  return bestIdx / Math.max(1, capped.length - 1)
}

export function usesShapeVisual(
  row: ProjectileRow | null,
  attackShape: AttackShapeKind,
): boolean {
  return (
    row != null &&
    normalizeProjectileKind(row) === 'shape' &&
    SHAPE_VISUAL_SHAPES.has(attackShape)
  )
}

export function usesChainFlight(
  row: ProjectileRow | null,
  attackShape: AttackShapeKind,
): boolean {
  return (
    row != null &&
    normalizeProjectileKind(row) === 'flight' &&
    attackShape === 'chain'
  )
}

export function usesBeamLineFlight(
  row: ProjectileRow | null,
  attackShape: AttackShapeKind,
): boolean {
  return (
    row != null &&
    normalizeProjectileKind(row) === 'flight' &&
    (attackShape === 'beam' || attackShape === 'line')
  )
}

export function usesRangedAoeFlight(
  row: ProjectileRow | null,
  attackShape: AttackShapeKind,
  maxRange: number,
): boolean {
  return (
    row != null &&
    normalizeProjectileKind(row) === 'flight' &&
    attackShape === 'aoe' &&
    maxRange > 1
  )
}

/** Flight row on a normal per-target ranged strike (Falcon, arrows, …). */
export function usesCatalogPerTargetFlight(
  row: ProjectileRow | null,
  attackShape: AttackShapeKind,
  maxRange: number,
): boolean {
  if (row == null || normalizeProjectileKind(row) !== 'flight') {
    return false
  }
  if (usesShapeVisual(row, attackShape)) {
    return false
  }
  if (usesChainFlight(row, attackShape)) {
    return false
  }
  if (usesBeamLineFlight(row, attackShape)) {
    return false
  }
  if (usesRangedAoeFlight(row, attackShape, maxRange)) {
    return false
  }
  return true
}

export function warnProjectileVisualModeMissing(
  unit: UnitRow,
  row: ProjectileRow,
  attackShape: AttackShapeKind,
): void {
  const key = `${unit.id}:${row.id}:${attackShape}:no-mode`
  if (warnedMismatch.has(key)) {
    return
  }
  warnedMismatch.add(key)
  appendBattleAnimCombatLog(
    `[Dev] ${unit.name}: projectile '${row.name}' matched no attack visual for shape '${attackShape}'.`,
  )
}

export { SHAPE_VISUAL_SHAPES }
