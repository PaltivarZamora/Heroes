import type { ReferenceCatalog } from '../town/catalog'
import { unitById } from '../town/catalog'
import {
  flushBattleSheetLoadFailuresToLog,
  loadBattleUnitSheetSet,
  reportBattleUnitTypeStatic,
  type BattleUnitSheetSet,
  unitBattleSpriteStem,
} from './battleUnitSheet'
import {
  preloadProjectileArtForUnits,
  type BattleProjectileArt,
} from './battleProjectile'
import type { GameSession } from '../session/types'

export type EnsureBattleUnitArtResult = {
  sheets: Map<number, BattleUnitSheetSet | null>
  projectilesByRowId: Map<number, BattleProjectileArt | null>
  sessionPatches: (session: GameSession) => GameSession
}

/**
 * Same battle art path as opening preload: sprite sheets (+ Advanced→Basic borrow),
 * projectiles, and session log lines for missing static/sheets.
 */
export async function ensureBattleUnitArtLoaded(
  catalog: ReferenceCatalog,
  unitIds: number[],
): Promise<EnsureBattleUnitArtResult> {
  const sheets = new Map<number, BattleUnitSheetSet | null>()
  const seen = new Set<number>()
  const tasks: Promise<void>[] = []
  for (const id of unitIds) {
    if (seen.has(id)) {
      continue
    }
    seen.add(id)
    const unit = unitById(catalog, id)
    if (!unit) {
      continue
    }
    tasks.push(
      loadBattleUnitSheetSet(catalog, unit).then((set) => {
        sheets.set(id, set)
      }),
    )
  }
  await Promise.all(tasks)
  const projectilesByRowId = await preloadProjectileArtForUnits(catalog, [
    ...seen,
  ])
  const sessionPatches = (session: GameSession) => {
    let next = flushBattleSheetLoadFailuresToLog(session)
    for (const id of seen) {
      const unit = unitById(catalog, id)
      const stem = unit ? unitBattleSpriteStem(unit) : null
      if (unit && !sheets.get(id) && stem) {
        next = reportBattleUnitTypeStatic(next, id, stem)
      }
    }
    return next
  }
  return { sheets, projectilesByRowId, sessionPatches }
}