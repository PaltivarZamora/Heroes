import type { GameSession } from '../session/types'
import { slotStatesForTown } from '../session/accessors'
import type { ReferenceCatalog } from './catalog'
import { buildingById } from './catalog'

const HALL_SLOT = 1
const RAMPARTS_SLOT = 2
const GATEHOUSE_SLOT = 3

function slotLevel(session: GameSession, townId: string, slotNum: number): number {
  return slotStatesForTown(session, townId)[slotNum - 1]?.level ?? 0
}

function slotBuildingLabel(
  catalog: ReferenceCatalog,
  session: GameSession,
  townId: string,
  slotNum: number,
  fallback: string,
): string {
  const state = slotStatesForTown(session, townId)[slotNum - 1]
  if (!state?.buildingId) {
    return fallback
  }
  return buildingById(catalog, state.buildingId)?.name ?? fallback
}

/** Town Garrison portrait mouseover (Part E). */
export function garrisonTooltipText(
  catalog: ReferenceCatalog,
  session: GameSession,
  townId: string,
  hasBuiltToday: boolean,
): string {
  const hallLvl = slotLevel(session, townId, HALL_SLOT)
  const rampartsLvl = slotLevel(session, townId, RAMPARTS_SLOT)
  const gatehouseLvl = slotLevel(session, townId, GATEHOUSE_SLOT)
  const hallLabel = slotBuildingLabel(
    catalog,
    session,
    townId,
    HALL_SLOT,
    'Hall',
  )
  return [
    'Garrison',
    hasBuiltToday ? 'Already built today' : 'Can build today',
    `${hallLabel} Level: ${hallLvl}`,
    `Ramparts Level: ${rampartsLvl}`,
    `Gatehouse Level: ${gatehouseLvl}`,
  ].join('\n')
}
