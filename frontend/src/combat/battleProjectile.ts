import { Assets, Spritesheet, type Texture } from 'pixi.js'
import type { ProjectileRow, ReferenceCatalog } from '../town/catalog'
import { unitById } from '../town/catalog'
import { basicPartnerForAdvanced } from '../town/unitUpgrade'
import { appendBattleAnimCombatLog } from './battleAnimLogBridge'
import type { BattleUnitFrame } from './battleUnitSheet'
import {
  actionOriginFootprintHex,
  closestHexOnTargetFootprint,
} from './actionOrigin'
import type { CombatStack } from './battle'
import { stackArtBoxFoot, stackArtBox } from './combatStackArtBox'
import { combatStackFootprint } from './movement'

export const PROJECTILE_ASSET_DIR = '/assets/projectiles'

export type BattleProjectileArt = {
  row: ProjectileRow
  staticUrl: string
  loop: boolean
  restHeight: number
  frames: BattleUnitFrame[] | null
  atlasUrl: string
}

export type BattleImpactEffectArt = {
  name: string
  restHeight: number
  frames: BattleUnitFrame[]
  atlasUrl: string
  durationMs: (fps: number) => number
}

const projectileArtById = new Map<number, BattleProjectileArt | null>()
const projectileInflight = new Map<number, Promise<BattleProjectileArt | null>>()
const impactArtByName = new Map<string, BattleImpactEffectArt | null>()
const impactInflight = new Map<string, Promise<BattleImpactEffectArt | null>>()
const warnedMotion = new Set<string>()
const warnedMissingProjectileRow = new Set<string>()
const warnedProjectileArt = new Set<string>()

function warnMissingProjectileRow(unit: import('../town/catalog').UnitRow, projectileId: number): void {
  const key = `${unit.id}:${projectileId}`
  if (warnedMissingProjectileRow.has(key)) {
    return
  }
  warnedMissingProjectileRow.add(key)
  appendBattleAnimCombatLog(
    `[Dev] ${unit.name}: projectile_id ${projectileId} has no row in catalog.projectile (reload Reference Data).`,
  )
}

export function warnProjectileArtUnavailable(
  unitName: string,
  projectileName: string,
  url: string,
): void {
  const key = `${unitName}:${projectileName}:${url}`
  if (warnedProjectileArt.has(key)) {
    return
  }
  warnedProjectileArt.add(key)
  appendBattleAnimCombatLog(
    `[Dev] ${unitName}: projectile '${projectileName}' could not load (${url}).`,
  )
}

type RawFrame = {
  frame?: { x?: number; y?: number; w?: number; h?: number }
  anchor?: { x?: number; y?: number }
}

function readAnchor(raw: RawFrame): { x: number; y: number } {
  const ax = Number(raw.anchor?.x)
  const ay = Number(raw.anchor?.y)
  return {
    x: Number.isFinite(ax) ? ax : 0.5,
    y: Number.isFinite(ay) ? ay : 1,
  }
}

function frameFromTexture(
  tex: Texture,
  raw: RawFrame | undefined,
  atlasUrl: string,
  atlasW: number,
  atlasH: number,
): BattleUnitFrame {
  const anchor = raw ? readAnchor(raw) : { x: 0.5, y: 1 }
  const fr = raw?.frame
  return {
    texture: tex,
    w: tex.width,
    h: tex.height,
    anchorX: anchor.x,
    anchorY: anchor.y,
    atlasUrl,
    atlasW,
    atlasH,
    rect: {
      x: Number(fr?.x) || 0,
      y: Number(fr?.y) || 0,
      w: Number(fr?.w) || tex.width,
      h: Number(fr?.h) || tex.height,
    },
  }
}

export function unitProjectileRow(
  catalog: ReferenceCatalog,
  unitId: number,
): ProjectileRow | null {
  const unit = unitById(catalog, unitId)
  if (!unit) {
    return null
  }
  let projectileId = unit.projectile_id
  if (projectileId == null || projectileId <= 0) {
    const partner = basicPartnerForAdvanced(catalog, unit)
    projectileId = partner?.projectile_id ?? null
  }
  if (projectileId == null || projectileId <= 0) {
    return null
  }
  const row = catalog.projectile.find((r) => r.id === projectileId) ?? null
  if (!row) {
    warnMissingProjectileRow(unit, projectileId)
    return null
  }
  return row
}

export function noteProjectileMotion(row: ProjectileRow): void {
  const motion = row.motion?.trim() || 'none'
  if (motion === 'none' || warnedMotion.has(motion)) {
    return
  }
  warnedMotion.add(motion)
  appendBattleAnimCombatLog(
    `Projectile motion '${motion}' is not implemented yet (using slide only).`,
  )
}

async function loadSheetFrames(
  name: string,
): Promise<{
  frames: BattleUnitFrame[]
  loop: boolean
  restHeight: number
  atlasUrl: string
} | null> {
  const jsonUrl = `${PROJECTILE_ASSET_DIR}/${name}.json`
  try {
    const response = await fetch(jsonUrl)
    if (!response.ok) {
      return null
    }
    const data = (await response.json()) as {
      frames?: Record<string, RawFrame>
      meta?: Record<string, unknown> & { image?: string }
    }
    const imageName = data.meta?.image?.trim() || `${name}.png`
    const atlasUrl = `${PROJECTILE_ASSET_DIR}/${imageName.replace(/^\/+/, '')}`
    const atlasTexture = await Assets.load<Texture>(atlasUrl)
    if (atlasTexture.width < 1) {
      return null
    }
    const sheet = new Spritesheet(atlasTexture, data as never)
    await sheet.parse()
    const textures = sheet.textures as Record<string, Texture>
    const framesData = data.frames
    const frameNames = Object.keys(textures).sort()
    const frames: BattleUnitFrame[] = []
    for (const key of frameNames) {
      const tex = textures[key]
      if (!tex || tex.width < 1) {
        continue
      }
      frames.push(
        frameFromTexture(
          tex,
          framesData?.[key],
          atlasUrl,
          atlasTexture.width,
          atlasTexture.height,
        ),
      )
    }
    if (frames.length === 0) {
      return null
    }
    const loopRaw = data.meta?.loop
    const loop = typeof loopRaw === 'boolean' ? loopRaw : true
    const restRaw = Number(data.meta?.rest_height)
    const restHeight =
      Number.isFinite(restRaw) && restRaw > 0 ? restRaw : frames[0]!.h
    return { frames, loop, restHeight, atlasUrl }
  } catch {
    return null
  }
}

export async function loadBattleProjectileArt(
  row: ProjectileRow,
): Promise<BattleProjectileArt | null> {
  const cached = projectileArtById.get(row.id)
  if (cached !== undefined) {
    return cached
  }
  const inflight = projectileInflight.get(row.id)
  if (inflight) {
    return inflight
  }
  const promise = (async (): Promise<BattleProjectileArt | null> => {
    noteProjectileMotion(row)
    const pngUrl = `${PROJECTILE_ASSET_DIR}/${row.name}.png`
    const kind = (row.kind ?? 'flight').trim().toLowerCase()
    const sheet = await loadSheetFrames(row.name)
    if (kind === 'shape') {
      if (!sheet || sheet.frames.length === 0) {
        appendBattleAnimCombatLog(
          `Shape projectile '${row.name}' requires ${row.name}.json animation.`,
        )
        projectileArtById.set(row.id, null)
        return null
      }
      const shapeArt: BattleProjectileArt = {
        row,
        staticUrl: pngUrl,
        loop: false,
        restHeight: sheet.restHeight,
        frames: sheet.frames,
        atlasUrl: sheet.atlasUrl,
      }
      projectileArtById.set(row.id, shapeArt)
      return shapeArt
    }
    if (sheet) {
      const art: BattleProjectileArt = {
        row,
        staticUrl: pngUrl,
        loop: sheet.loop,
        restHeight: sheet.restHeight,
        frames: sheet.frames,
        atlasUrl: sheet.atlasUrl,
      }
      projectileArtById.set(row.id, art)
      return art
    }
    try {
      const tex = await Assets.load<Texture>(pngUrl)
      if (tex.width < 1) {
        appendBattleAnimCombatLog(
          `Projectile art missing: ${row.name}.png (unit projectile_id ${row.id})`,
        )
        warnProjectileArtUnavailable(
          `projectile_id ${row.id}`,
          row.name,
          pngUrl,
        )
        projectileArtById.set(row.id, null)
        return null
      }
      const art: BattleProjectileArt = {
        row,
        staticUrl: pngUrl,
        loop: false,
        restHeight: tex.height,
        frames: null,
        atlasUrl: pngUrl,
      }
      projectileArtById.set(row.id, art)
      return art
    } catch {
      appendBattleAnimCombatLog(
        `Projectile art missing: ${row.name}.png (unit projectile_id ${row.id})`,
      )
      projectileArtById.set(row.id, null)
      return null
    }
  })()
  projectileInflight.set(row.id, promise)
  try {
    return await promise
  } finally {
    projectileInflight.delete(row.id)
  }
}

export async function loadBattleImpactEffectArt(
  effectName: string,
): Promise<BattleImpactEffectArt | null> {
  const key = effectName.trim()
  if (!key) {
    return null
  }
  const cached = impactArtByName.get(key)
  if (cached !== undefined) {
    return cached
  }
  const inflight = impactInflight.get(key)
  if (inflight) {
    return inflight
  }
  const promise = (async (): Promise<BattleImpactEffectArt | null> => {
    const sheet = await loadSheetFrames(key)
    if (!sheet || sheet.frames.length === 0) {
      appendBattleAnimCombatLog(`Impact effect missing: ${key}.png + .json`)
      impactArtByName.set(key, null)
      return null
    }
    const art: BattleImpactEffectArt = {
      name: key,
      restHeight: sheet.restHeight,
      frames: sheet.frames,
      atlasUrl: sheet.atlasUrl,
      durationMs: (fps) =>
        (sheet.frames.length / Math.max(1, fps)) * 1000,
    }
    impactArtByName.set(key, art)
    return art
  })()
  impactInflight.set(key, promise)
  try {
    return await promise
  } finally {
    impactInflight.delete(key)
  }
}

export async function preloadProjectileArtForUnits(
  catalog: ReferenceCatalog,
  unitIds: number[],
): Promise<Map<number, BattleProjectileArt | null>> {
  const out = new Map<number, BattleProjectileArt | null>()
  const rowIds = new Set<number>()
  for (const id of unitIds) {
    const row = unitProjectileRow(catalog, id)
    if (row) {
      rowIds.add(row.id)
    }
  }
  await Promise.all(
    [...rowIds].map(async (pid) => {
      const row = catalog.projectile.find((r) => r.id === pid)
      if (!row) {
        return
      }
      const art = await loadBattleProjectileArt(row)
      out.set(pid, art)
    }),
  )
  return out
}

type HexAnchor = { q: number; r: number; x: number; y: number }

function hexCenter(
  anchors: HexAnchor[],
  q: number,
  r: number,
): { x: number; y: number } | null {
  return anchors.find((row) => row.q === q && row.r === r) ?? null
}

export function computeProjectileFlightEndpoints(opts: {
  striker: CombatStack
  target: CombatStack
  catalog: ReferenceCatalog
  anchors: HexAnchor[]
  hexPx: number
  footOffsetPct: number
  row: ProjectileRow
  wedgeZone?: number | null
}): {
  fromX: number
  fromY: number
  toX: number
  toY: number
} | null {
  const stand = { q: opts.striker.q, r: opts.striker.r }
  const aimHex = closestHexOnTargetFootprint(
    opts.striker,
    opts.target,
    opts.catalog,
  )
  const originHex = actionOriginFootprintHex(
    stand,
    opts.striker,
    opts.catalog,
    aimHex,
    opts.wedgeZone,
  )
  const originCenter = hexCenter(opts.anchors, originHex.q, originHex.r)
  const targetCenter = hexCenter(opts.anchors, aimHex.q, aimHex.r)
  if (!originCenter || !targetCenter) {
    return null
  }
  const strikerAnchor = opts.anchors.find(
    (row) => row.q === opts.striker.q && row.r === opts.striker.r,
  )
  const targetAnchor = opts.anchors.find(
    (row) => row.q === opts.target.q && row.r === opts.target.r,
  )
  const strikerFoot = strikerAnchor
    ? stackArtBoxFoot(
        stackArtBox(
          strikerAnchor,
          opts.hexPx,
          combatStackFootprint(opts.striker, opts.catalog),
          opts.striker.side,
        ),
        opts.hexPx,
        opts.footOffsetPct,
      )
    : null
  const targetFoot = targetAnchor
    ? stackArtBoxFoot(
        stackArtBox(
          targetAnchor,
          opts.hexPx,
          combatStackFootprint(opts.target, opts.catalog),
          opts.target.side,
        ),
        opts.hexPx,
        opts.footOffsetPct,
      )
    : null
  const dx = targetCenter.x - originCenter.x
  const dy = targetCenter.y - originCenter.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const half = opts.hexPx / 2
  const startAlong = half + (opts.row.start_offset_pct / 100) * opts.hexPx
  const endAlong = half - (opts.row.end_offset_pct / 100) * opts.hexPx
  const lift = (opts.row.height_pct / 100) * opts.hexPx
  const fromX = originCenter.x + ux * startAlong
  const toX = targetCenter.x - ux * endAlong
  const fromFootY = strikerFoot?.footY ?? originCenter.y
  const toFootY = targetFoot?.footY ?? targetCenter.y
  const fromY = fromFootY + uy * startAlong - lift
  const toY = toFootY - uy * endAlong - lift
  return { fromX, fromY, toX, toY }
}

export function projectileDisplayHeightPx(
  hexPx: number,
  scalePct: number,
  _frameHeight: number,
): number {
  const targetH = (scalePct / 100) * hexPx
  return Math.max(4, targetH)
}

export function projectileDisplayWidthPx(
  displayHeightPx: number,
  frameWidth: number,
  frameHeight: number,
): number {
  if (frameHeight <= 0) {
    return displayHeightPx
  }
  return displayHeightPx * (frameWidth / frameHeight)
}
