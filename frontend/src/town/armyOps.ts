import { canAfford } from '../hex/resources'
import {
  findTownById,
  heroStandsInTown,
  humanPlayer,
  recruitToGarrison,
  stackUpgradeOffer,
  upgradeArmyStack,
  type ArmyRowId,
  type ArmySlotRef,
} from '../session/accessors'
import type { GameSession, Town } from '../session/types'
import {
  maxAffordableQty,
  unitById,
  unitCost,
  unitEffectiveTier,
  unitForBuilding,
  type CostMap,
  type ReferenceCatalog,
  type UnitRow,
} from './catalog'
import { walletFromPlayer } from '../session/accessors'
import { townRecruitUnitCost } from './townUniques'

export const HERO_NOT_IN_TOWN = 'Hero is not in this town'

export function stackAtRef(
  session: GameSession,
  townId: string,
  ref: ArmySlotRef,
) {
  const town = findTownById(session, townId)
  if (!town) {
    return null
  }
  let slots: Array<string | null>
  if (ref.row === 'garrison') {
    slots = town.garrison.slots_1_to_6
  } else {
    const heroId = ref.heroId ?? null
    const hero = heroId
      ? session.heroes.find((row) => row.id === heroId)
      : null
    slots = hero?.army.slots_1_to_6 ?? []
  }
  const id = slots[ref.slot - 1]
  return id ? session.units.find((row) => row.id === id) ?? null : null
}

export function canAffordFullStackUpgrade(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
  ref: ArmySlotRef,
  primaryHeroId: string | null,
): boolean {
  const town = findTownById(session, townId)
  if (!town) {
    return false
  }
  if (ref.row === 'hero') {
    const heroId = ref.heroId ?? primaryHeroId
    if (!heroId || !heroStandsInTown(session, townId, heroId)) {
      return false
    }
  }
  const stack = stackAtRef(session, townId, ref)
  if (!stack) {
    return false
  }
  const offer = stackUpgradeOffer(session, catalog, townId, stack)
  if (!offer) {
    return false
  }
  const player = humanPlayer(session)
  if (!player) {
    return false
  }
  const wallet = walletFromPlayer(session, player.id)
  return canAfford(wallet, offer.total) == null
}

export function canSplitStack(
  session: GameSession,
  townId: string,
  ref: ArmySlotRef,
  readOnly: boolean,
): boolean {
  if (readOnly) {
    return false
  }
  const stack = stackAtRef(session, townId, ref)
  return stack != null && stack.qty >= 2
}

export function listUpgradeAllCandidates(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
  row: ArmyRowId,
  heroId: string | null,
  primaryHeroId: string | null,
): Array<{
  ref: ArmySlotRef
  fromName: string
  toName: string
  qty: number
  total: CostMap
  totalValue: number
}> {
  const town = findTownById(session, townId)
  if (!town) {
    return []
  }
  const player = humanPlayer(session)
  if (!player) {
    return []
  }
  const wallet = walletFromPlayer(session, player.id)
  const out: Array<{
    ref: ArmySlotRef
    fromName: string
    toName: string
    qty: number
    total: CostMap
    totalValue: number
  }> = []
  let slots: Array<string | null>
  if (row === 'garrison') {
    slots = town.garrison.slots_1_to_6
  } else {
    const hid = heroId ?? primaryHeroId
    if (!hid || !heroStandsInTown(session, townId, hid)) {
      return []
    }
    const hero = session.heroes.find((row) => row.id === hid)
    slots = hero?.army.slots_1_to_6 ?? []
  }
  for (let i = 0; i < 6; i += 1) {
    const stackId = slots[i]
    if (!stackId) {
      continue
    }
    const stack = session.units.find((row) => row.id === stackId)
    if (!stack) {
      continue
    }
    const offer = stackUpgradeOffer(session, catalog, townId, stack)
    if (!offer || canAfford(wallet, offer.total) != null) {
      continue
    }
    const unit = unitById(catalog, stack.unit_id)
    const totalValue = Object.values(offer.total).reduce((a, b) => a + b, 0)
    out.push({
      ref: { row, slot: i + 1, heroId: row === 'hero' ? heroId ?? primaryHeroId : undefined },
      fromName: unit?.name ?? 'Unit',
      toName: offer.advanced.name,
      qty: stack.qty,
      total: offer.total,
      totalValue,
    })
  }
  out.sort((a, b) => b.totalValue - a.totalValue)
  return out
}

export function applyUpgradeAll(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
  row: ArmyRowId,
  heroId: string | null,
  primaryHeroId: string | null,
): {
  session: GameSession
  upgraded: number
  totalCost: CostMap
  skipped: string[]
} {
  const skipped: string[] = []
  let next = session
  const totalCost: Record<number, number> = {}
  let upgraded = 0
  for (;;) {
    const candidates = listUpgradeAllCandidates(
      next,
      catalog,
      townId,
      row,
      heroId,
      primaryHeroId,
    )
    const line = candidates[0]
    if (!line) {
      break
    }
    const offer = stackUpgradeOffer(next, catalog, townId, stackAtRef(next, townId, line.ref)!)
    const result = upgradeArmyStack(next, townId, line.ref, catalog)
    if (result.error || !offer) {
      skipped.push(`${line.fromName} (${result.error ?? 'failed'})`)
      break
    }
    next = result.session
    upgraded += 1
    for (const [resourceId, amount] of Object.entries(offer.total)) {
      const id = Number(resourceId)
      totalCost[id] = (totalCost[id] ?? 0) + amount
    }
  }
  return { session: next, upgraded, totalCost, skipped }
}

/** Confirm dialog: same greedy order as {@link applyUpgradeAll}. */
export function previewUpgradeAllConfirm(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
  row: ArmyRowId,
  heroId: string | null,
  primaryHeroId: string | null,
  formatCost: (cost: CostMap) => string,
): { lines: string[]; total: string; willUpgrade: number } {
  const player = humanPlayer(session)
  if (!player) {
    return { lines: [], total: formatCost({}), willUpgrade: 0 }
  }
  let next = session
  const willLines: string[] = []
  const totalCost: CostMap = {}
  let willUpgrade = 0

  for (;;) {
    const candidates = listUpgradeAllCandidates(
      next,
      catalog,
      townId,
      row,
      heroId,
      primaryHeroId,
    )
    const line = candidates[0]
    if (!line) {
      break
    }
    const stack = stackAtRef(next, townId, line.ref)
    const offer = stack && stackUpgradeOffer(next, catalog, townId, stack)
    const result = upgradeArmyStack(next, townId, line.ref, catalog)
    if (result.error || !offer) {
      break
    }
    next = result.session
    willUpgrade += 1
    willLines.push(
      `${line.qty} ${line.fromName} → ${line.toName}: ${formatCost(offer.total)}`,
    )
    for (const [resourceId, amount] of Object.entries(offer.total)) {
      const id = Number(resourceId)
      totalCost[id] = (totalCost[id] ?? 0) + amount
    }
  }

  const wallet = walletFromPlayer(next, player.id)
  const skipped = listUpgradeAllCandidates(
    next,
    catalog,
    townId,
    row,
    heroId,
    primaryHeroId,
  )
  for (const line of skipped) {
    const reason =
      canAfford(wallet, line.total) ??
      `not enough resources (need ${formatCost(line.total)})`
    willLines.push(
      `${line.qty} ${line.fromName} → ${line.toName}: skipped (${reason})`,
    )
  }

  return {
    lines: willLines,
    total: formatCost(totalCost),
    willUpgrade,
  }
}

function garrisonCanTakeUnit(
  session: GameSession,
  town: Town,
  unitId: number,
): boolean {
  const slots = [...town.garrison.slots_1_to_6]
  while (slots.length < 6) {
    slots.push(null)
  }
  const canStack = slots.some((stackId) => {
    if (!stackId) {
      return false
    }
    const stack = session.units.find((row) => row.id === stackId)
    return stack != null && stack.unit_id === unitId && stack.town_id === town.id
  })
  return canStack || slots.some((stackId) => stackId == null)
}

export type BuyAllPreviewLine = {
  unitName: string
  qty: number
  cost: CostMap
  tier: number
}

function compareBuyAllRecruit(
  catalog: ReferenceCatalog,
  a: UnitRow,
  b: UnitRow,
): number {
  const tierA = unitEffectiveTier(catalog, a)
  const tierB = unitEffectiveTier(catalog, b)
  if (tierB !== tierA) {
    return tierB - tierA
  }
  const levelA = a.level ?? 1
  const levelB = b.level ?? 1
  return levelB - levelA
}

export function previewBuyAllGarrison(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
): { lines: BuyAllPreviewLine[]; total: CostMap; canBuy: boolean } {
  const town = findTownById(session, townId)
  const player = humanPlayer(session)
  if (!town || !player) {
    return { lines: [], total: {}, canBuy: false }
  }
  let wallet = walletFromPlayer(session, player.id)
  const recruits: Array<{
    slotNum: number
    unit: UnitRow
    available: number
    perUnit: CostMap
  }> = []
  for (const state of session.building_states) {
    if (state.town_id !== townId || state.level < 1 || state.building_id == null) {
      continue
    }
    if (state.recruit_qty < 1) {
      continue
    }
    const unit = unitForBuilding(catalog, state.building_id)
    if (!unit) {
      continue
    }
    if (!garrisonCanTakeUnit(session, town, unit.id)) {
      continue
    }
    recruits.push({
      slotNum: state.slot_num,
      unit,
      available: state.recruit_qty,
      perUnit: townRecruitUnitCost(session, catalog, townId, unitCost(unit)),
    })
  }
  recruits.sort((a, b) => compareBuyAllRecruit(catalog, a.unit, b.unit))
  const lines: BuyAllPreviewLine[] = []
  const total: CostMap = {}
  let simSession = session
  for (const row of recruits) {
    const per = row.perUnit
    const maxQty = maxAffordableQty(wallet, per, row.available)
    if (maxQty < 1) {
      continue
    }
    let qty = 0
    for (let tryQty = maxQty; tryQty >= 1; tryQty -= 1) {
      const trial = recruitToGarrison(simSession, townId, row.slotNum, tryQty, catalog)
      if (!trial.error) {
        qty = tryQty
        simSession = trial.session
        wallet = walletFromPlayer(simSession, player.id)
        break
      }
    }
    if (qty < 1) {
      continue
    }
    const lineCost: CostMap = {}
    for (const [resourceId, amount] of Object.entries(per)) {
      const id = Number(resourceId)
      const sum = amount * qty
      lineCost[id] = sum
      total[id] = (total[id] ?? 0) + sum
    }
    lines.push({
      unitName: row.unit.name,
      qty,
      cost: lineCost,
      tier: unitEffectiveTier(catalog, row.unit),
    })
  }
  return { lines, total, canBuy: lines.length > 0 }
}

export function applyBuyAllGarrison(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
): { session: GameSession; lines: BuyAllPreviewLine[]; error: string | null } {
  const preview = previewBuyAllGarrison(session, catalog, townId)
  if (!preview.canBuy) {
    return { session, lines: [], error: 'Nothing to buy for the garrison.' }
  }
  let next = session
  const bought: BuyAllPreviewLine[] = []
  const player = humanPlayer(session)
  if (!player) {
    return { session, lines: [], error: null }
  }
  let wallet = walletFromPlayer(next, player.id)
  const town = findTownById(next, townId)
  if (!town) {
    return { session, lines: [], error: 'Town not found.' }
  }
  const recruits: Array<{
    slotNum: number
    unit: UnitRow
    available: number
    perUnit: CostMap
  }> = []
  for (const state of next.building_states) {
    if (state.town_id !== townId || state.level < 1 || state.building_id == null) {
      continue
    }
    if (state.recruit_qty < 1) {
      continue
    }
    const unit = unitForBuilding(catalog, state.building_id)
    if (!unit || !garrisonCanTakeUnit(next, town, unit.id)) {
      continue
    }
    recruits.push({
      slotNum: state.slot_num,
      unit,
      available: state.recruit_qty,
      perUnit: townRecruitUnitCost(next, catalog, townId, unitCost(unit)),
    })
  }
  recruits.sort((a, b) => compareBuyAllRecruit(catalog, a.unit, b.unit))
  for (const row of recruits) {
    const maxQty = maxAffordableQty(wallet, row.perUnit, row.available)
    if (maxQty < 1) {
      continue
    }
    let qty = 0
    for (let tryQty = maxQty; tryQty >= 1; tryQty -= 1) {
      const trial = recruitToGarrison(next, townId, row.slotNum, tryQty, catalog)
      if (!trial.error) {
        qty = tryQty
        next = trial.session
        wallet = walletFromPlayer(next, player.id)
        break
      }
    }
    if (qty > 0) {
      const lineCost: CostMap = {}
      for (const [resourceId, amount] of Object.entries(row.perUnit)) {
        lineCost[Number(resourceId)] = amount * qty
      }
      bought.push({
        unitName: row.unit.name,
        qty,
        cost: lineCost,
        tier: unitEffectiveTier(catalog, row.unit),
      })
    }
  }
  if (bought.length === 0) {
    return { session, lines: [], error: 'Could not buy any recruits.' }
  }
  return { session: next, lines: bought, error: null }
}

export function portraitUpgradeAllAvailable(
  session: GameSession,
  catalog: ReferenceCatalog,
  townId: string,
  row: ArmyRowId,
  heroId: string | null,
  primaryHeroId: string | null,
): boolean {
  return (
    listUpgradeAllCandidates(
      session,
      catalog,
      townId,
      row,
      heroId,
      primaryHeroId,
    ).length > 0
  )
}
