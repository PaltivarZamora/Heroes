import { Assets, type Texture } from 'pixi.js'
import { optionalImageUrlReachable } from '../assets/devAssetResponse'
import type { ReferenceCatalog, UnitRow } from '../town/catalog'
import { unitById } from '../town/catalog'
import { basicPartnerForAdvanced } from '../town/unitUpgrade'
import {
  battleUnitTownDir,
  type BattleUnitFrame,
  unitBattleSpriteStem,
  unitBattleTownFolder,
} from './battleUnitSheet'

const rainStillByUnitId = new Map<number, BattleUnitFrame | null>()
const rainInflight = new Map<number, Promise<BattleUnitFrame | null>>()

async function loadRainStillFrame(
  dir: string,
  stem: string,
): Promise<BattleUnitFrame | null> {
  const url = `${dir}/${stem}_Rain.png`
  try {
    if (!(await optionalImageUrlReachable(url))) {
      return null
    }
    const tex = await Assets.load<Texture>(url)
    if (tex.width < 1 || tex.height < 1) {
      return null
    }
    return {
      texture: tex,
      w: tex.width,
      h: tex.height,
      anchorX: 0.5,
      anchorY: 1,
      atlasUrl: url,
      atlasW: tex.width,
      atlasH: tex.height,
      rect: { x: 0, y: 0, w: tex.width, h: tex.height },
    }
  } catch {
    return null
  }
}

export function unitRainStaticFilename(stem: string | null | undefined): string | null {
  if (!stem) {
    return null
  }
  return `${stem}_Rain.png`
}

export function rainStillFrameForUnit(
  unitId: number,
): BattleUnitFrame | null | undefined {
  return rainStillByUnitId.get(unitId)
}

export function unitRainStillForBattle(unitId: number): BattleUnitFrame | null {
  const cached = rainStillByUnitId.get(unitId)
  return cached ?? null
}

export function unitHasRainStill(unitId: number): boolean {
  return rainStillByUnitId.get(unitId) != null
}

export async function loadUnitRainStillFrame(
  catalog: ReferenceCatalog,
  unit: UnitRow,
): Promise<BattleUnitFrame | null> {
  const cached = rainStillByUnitId.get(unit.id)
  if (cached !== undefined) {
    return cached
  }
  const inflight = rainInflight.get(unit.id)
  if (inflight) {
    return inflight
  }
  const stem = unitBattleSpriteStem(unit)
  const townFolder = unitBattleTownFolder(catalog, unit)
  if (!stem || !townFolder) {
    rainStillByUnitId.set(unit.id, null)
    return null
  }
  const promise = (async (): Promise<BattleUnitFrame | null> => {
    const dir = battleUnitTownDir(townFolder)
    let frame = await loadRainStillFrame(dir, stem)
    if (!frame) {
      const partner = basicPartnerForAdvanced(catalog, unit)
      const partnerStem = partner ? unitBattleSpriteStem(partner) : null
      if (partnerStem) {
        frame = await loadRainStillFrame(dir, partnerStem)
      }
    }
    rainStillByUnitId.set(unit.id, frame)
    rainInflight.delete(unit.id)
    return frame
  })()
  rainInflight.set(unit.id, promise)
  return promise
}

export async function preloadUnitRainStills(
  catalog: ReferenceCatalog,
  unitIds: number[],
): Promise<Map<number, BattleUnitFrame | null>> {
  const out = new Map<number, BattleUnitFrame | null>()
  await Promise.all(
    unitIds.map(async (id) => {
      const cached = rainStillByUnitId.get(id)
      if (cached !== undefined) {
        out.set(id, cached)
        return
      }
      let inflight = rainInflight.get(id)
      if (!inflight) {
        const unit = unitById(catalog, id)
        inflight = unit
          ? loadUnitRainStillFrame(catalog, unit)
          : Promise.resolve(null)
        rainInflight.set(id, inflight)
      }
      const frame = await inflight
      rainStillByUnitId.set(id, frame)
      rainInflight.delete(id)
      out.set(id, frame)
    }),
  )
  return out
}

export function resetUnitRainStillSessionCache(): void {
  rainStillByUnitId.clear()
  rainInflight.clear()
}