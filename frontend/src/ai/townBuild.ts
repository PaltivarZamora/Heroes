import { canAfford, GOLD_RESOURCE_ID, formatAmount } from '../hex/resources'
import {
  armyBuildOptions,
  buildingById,
  buildingGrowth,
  constructionCost,
  genericRoot,
  genericSlotBuildings,
  hasPrerequisite,
  heroTypeName,
  isArmySlot,
  isEmptyPlaceholderSlot,
  isLibraryBuilding,
  isMarketplaceBuilding,
  isTavernBuilding,
  isUndesignedSlot,
  hireHeroGoldCost,
  maxAffordableQty,
  missingArmyPrerequisiteLine,
  nextInChain,
  TOWN_LAYOUT_SLOT_COUNT,
  unitCost,
  unitForBuilding,
  unitById,
  getCachedCatalog,
  type BuildingRow,
  type CostMap,
  type ReferenceCatalog,
} from '../town/catalog'
import {
  ensureLibraryOffers,
  hasTownBuiltToday,
  hireHeroFromPool,
  markTownBuiltToday,
  patchBuildingSlot,
  recruitToGarrison,
  spendResources,
  stackUpgradeOffer,
  unusedTavernPool,
  upgradeArmyStack,
  visitingHeroId,
  walletFromPlayer,
  type ArmySlotRef,
} from '../session/accessors'
import { getSession, updateSession } from '../session/store'
import {
  ARMY_STACK_SLOTS,
  type GameSession,
  type Player,
  type Town,
} from '../session/types'
import { neighborHexes } from '../hex/pathfinding'
import { isPassable } from '../hex/world'
import { appendAiTrace } from './trace'
import {
  TOWN_BUILD_DECISION,
  TOWN_BUILD_FACTORS,
  type ScoredOption,
  type TownBuildFactor,
} from './types'
import {
  archName,
  aiDecisionJitterPct,
  aiHeroBlendBias,
  aiHireChanceExtraPct,
  aiUpgradeBonusMult,
  finalFactorWeight,
  pickWeighted,
  scoreOption,
} from './weights'

const OWN_CLASS_SCORE_MULT = 1.2
const OTHER_CLASS_SCORE_MULT = 0.8
const RECRUIT_MAX_CHANCE = 0.65
const RECRUIT_PARTIAL_MIN = 0.2
const RECRUIT_PARTIAL_MAX = 0.8
const MAX_TOWN_ACTIONS = 16

type BuildIntent = {
  kind: 'build' | 'upgrade'
  townId: string
  townName: string
  slotNum: number
  building: BuildingRow
  nextLevel: number
  cost: CostMap
}

type RecruitIntent = {
  kind: 'recruit'
  townId: string
  townName: string
  slotNum: number
  building: BuildingRow
  unitName: string
  available: number
}

type UpgradeUnitIntent = {
  kind: 'upgrade_unit'
  townId: string
  townName: string
  slot: ArmySlotRef
  unitName: string
  advancedName: string
  qty: number
  cost: CostMap
}

type HireIntent = {
  kind: 'hire_hero'
  townId: string
  townName: string
  poolCount: number
  cost: CostMap
}

type TownAction = BuildIntent | RecruitIntent | UpgradeUnitIntent | HireIntent

type HireGate = {
  allow: boolean
  extraN: number
  chance: number
  roll: number
}

function builtIdsForTown(session: GameSession, townId: string): Set<number> {
  return new Set(
    session.building_states
      .filter(
        (row) =>
          row.town_id === townId && row.level >= 1 && row.building_id != null,
      )
      .map((row) => row.building_id as number),
  )
}

function factorForBuilding(
  slotNum: number,
  building: BuildingRow,
): Record<TownBuildFactor, number> {
  if (isArmySlot(slotNum)) {
    return { economy_value: 0, army_value: 1, defense_value: 0, hero_value: 0 }
  }
  const name = building.name.trim().toLowerCase()
  const economy =
    isMarketplaceBuilding(building) ||
    isTavernBuilding(building) ||
    isLibraryBuilding(building) ||
    building.effect_type === 'resource_yield' ||
    building.effect_type === 'gold_income' ||
    name.includes('market') ||
    name.includes('hall')
  if (economy) {
    return { economy_value: 1, army_value: 0, defense_value: 0, hero_value: 0 }
  }
  return { economy_value: 0, army_value: 0, defense_value: 1, hero_value: 0 }
}

function factorForAction(action: TownAction): Record<TownBuildFactor, number> {
  if (action.kind === 'hire_hero') {
    return { economy_value: 0, army_value: 0, defense_value: 0, hero_value: 1 }
  }
  if (action.kind === 'recruit' || action.kind === 'upgrade_unit') {
    return { economy_value: 0, army_value: 1, defense_value: 0, hero_value: 0 }
  }
  return factorForBuilding(action.slotNum, action.building)
}

function actionScoreMult(
  action: TownAction,
  heroClassId: number | null,
  catalog: ReferenceCatalog,
): { mult: number; tag: string } {
  if (action.kind === 'upgrade_unit') {
    const mult = aiUpgradeBonusMult(catalog)
    return { mult, tag: ` invest×${mult.toFixed(2)}` }
  }
  const building =
    action.kind === 'recruit' || action.kind === 'build' || action.kind === 'upgrade'
      ? action.building
      : null
  const bias = building ? classBranchBias(building, heroClassId) : 1
  return {
    mult: bias,
    tag: bias === 1 ? '' : ` class×${bias.toFixed(2)}`,
  }
}

/** 60/40 class split as a score multiplier — own class 1.2, other class 0.8. */
function classBranchBias(
  building: BuildingRow,
  heroClassId: number | null,
): number {
  if (building.class_id == null || heroClassId == null) {
    return 1
  }
  return building.class_id === heroClassId
    ? OWN_CLASS_SCORE_MULT
    : OTHER_CLASS_SCORE_MULT
}

function armySlotNotes(
  session: GameSession,
  catalog: ReferenceCatalog,
  towns: Town[],
  wallet: ReturnType<typeof walletFromPlayer>,
): string {
  const parts: string[] = []
  for (const town of towns) {
    const builtIds = builtIdsForTown(session, town.id)
    for (let slotNum = 4; slotNum <= 9; slotNum += 1) {
      if (isUndesignedSlot(catalog, slotNum, town.town_type_id)) {
        continue
      }
      if (isEmptyPlaceholderSlot(catalog, slotNum, town.town_type_id)) {
        continue
      }
      const state = session.building_states.find(
        (row) => row.town_id === town.id && row.slot_num === slotNum,
      )
      const level = state?.level ?? 0
      if (level >= 1) {
        const building = buildingById(catalog, state?.building_id ?? null)
        parts.push(
          `${town.name} s${slotNum}=${building?.name ?? 'built'} L${level}`,
        )
        continue
      }
      const options = armyBuildOptions(
        catalog,
        slotNum,
        town.town_type_id,
        builtIds,
      )
      if (options.length === 0) {
        const why = missingArmyPrerequisiteLine(
          catalog,
          slotNum,
          town.town_type_id,
          builtIds,
        )
        parts.push(`${town.name} s${slotNum}=locked (${why})`)
        continue
      }
      const affordable = options.filter(
        (building) => !canAfford(wallet, constructionCost(catalog, building)),
      )
      if (affordable.length === 0) {
        const names = options.map((row) => row.name).join('/')
        parts.push(`${town.name} s${slotNum}=unaffordable ${names}`)
        continue
      }
      parts.push(
        `${town.name} s${slotNum}=scored ${affordable.map((row) => row.name).join('/')}`,
      )
    }
  }
  return parts.length > 0 ? `  army_slots: ${parts.join('; ')}` : '  army_slots: none'
}

function letter(index: number): string {
  return String.fromCharCode(65 + (index % 26))
}

function formatFactors(
  factors: Record<string, number>,
  weights: Record<string, number>,
): string {
  return TOWN_BUILD_FACTORS.map((key) => {
    const f = factors[key] ?? 0
    const w = weights[key] ?? 0
    return `${key}=${f.toFixed(2)}×${w.toFixed(2)}`
  }).join('  ')
}

function collectTownActions(
  session: GameSession,
  catalog: ReferenceCatalog,
  town: Town,
): Omit<BuildIntent, 'cost'>[] {
  if (hasTownBuiltToday(session, town.id)) {
    return []
  }
  const builtIds = builtIdsForTown(session, town.id)
  const actions: Omit<BuildIntent, 'cost'>[] = []
  for (let slotNum = 1; slotNum <= TOWN_LAYOUT_SLOT_COUNT; slotNum += 1) {
    if (isUndesignedSlot(catalog, slotNum, town.town_type_id)) {
      continue
    }
    if (isEmptyPlaceholderSlot(catalog, slotNum, town.town_type_id)) {
      continue
    }
    const state = session.building_states.find(
      (row) => row.town_id === town.id && row.slot_num === slotNum,
    )
    const level = state?.level ?? 0
    if (level < 1) {
      const candidates = isArmySlot(slotNum)
        ? armyBuildOptions(catalog, slotNum, town.town_type_id, builtIds)
        : (() => {
            const root = genericRoot(
              genericSlotBuildings(catalog, slotNum, town.town_type_id),
            )
            return root && hasPrerequisite(root, builtIds) ? [root] : []
          })()
      for (const building of candidates) {
        actions.push({
          kind: 'build',
          townId: town.id,
          townName: town.name,
          slotNum,
          building,
          nextLevel: 1,
        })
      }
      continue
    }
    const current = buildingById(catalog, state?.building_id ?? null)
    if (!current) {
      continue
    }
    const next = nextInChain(current, catalog, slotNum, town.town_type_id)
    if (!next || !hasPrerequisite(next, builtIds)) {
      continue
    }
    actions.push({
      kind: 'upgrade',
      townId: town.id,
      townName: town.name,
      slotNum,
      building: next,
      nextLevel: (state?.level ?? 1) + 1,
    })
  }
  return actions
}

function garrisonCanTakeUnit(
  session: GameSession,
  town: Town,
  unitId: number,
): boolean {
  const slots = [...town.garrison.slots_1_to_6]
  while (slots.length < ARMY_STACK_SLOTS) {
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

function collectRecruitActions(
  session: GameSession,
  catalog: ReferenceCatalog,
  town: Town,
): RecruitIntent[] {
  const actions: RecruitIntent[] = []
  for (const state of session.building_states) {
    if (state.town_id !== town.id || state.level < 1 || state.building_id == null) {
      continue
    }
    if (!isArmySlot(state.slot_num) || state.recruit_qty < 1) {
      continue
    }
    const building = buildingById(catalog, state.building_id)
    const unit = unitForBuilding(catalog, state.building_id)
    if (!building || !unit) {
      continue
    }
    actions.push({
      kind: 'recruit',
      townId: town.id,
      townName: town.name,
      slotNum: state.slot_num,
      building,
      unitName: unit.name,
      available: state.recruit_qty,
    })
  }
  return actions
}

function collectUpgradeActions(
  session: GameSession,
  catalog: ReferenceCatalog,
  town: Town,
  playerId: string,
): UpgradeUnitIntent[] {
  const actions: UpgradeUnitIntent[] = []
  const add = (slot: ArmySlotRef, stackId: string | null | undefined) => {
    if (!stackId) {
      return
    }
    const stack = session.units.find((row) => row.id === stackId)
    if (!stack) {
      return
    }
    const offer = stackUpgradeOffer(session, catalog, town.id, stack)
    if (!offer) {
      return
    }
    const unit = unitById(catalog, stack.unit_id)
    actions.push({
      kind: 'upgrade_unit',
      townId: town.id,
      townName: town.name,
      slot,
      unitName: unit?.name ?? `#${stack.unit_id}`,
      advancedName: offer.advanced.name,
      qty: stack.qty,
      cost: offer.total,
    })
  }
  const garrison = [...town.garrison.slots_1_to_6]
  while (garrison.length < ARMY_STACK_SLOTS) {
    garrison.push(null)
  }
  for (let i = 0; i < ARMY_STACK_SLOTS; i += 1) {
    add({ row: 'garrison', slot: i + 1 }, garrison[i])
  }
  for (const hero of session.heroes) {
    if (hero.player_id !== playerId) {
      continue
    }
    if (
      hero.position.q !== town.position.q ||
      hero.position.r !== town.position.r
    ) {
      continue
    }
    const slots = [...hero.army.slots_1_to_6]
    while (slots.length < ARMY_STACK_SLOTS) {
      slots.push(null)
    }
    for (let i = 0; i < ARMY_STACK_SLOTS; i += 1) {
      add({ row: 'hero', slot: i + 1, heroId: hero.id }, slots[i])
    }
  }
  return actions
}

function townHasBuiltTavern(
  session: GameSession,
  catalog: ReferenceCatalog,
  town: Town,
): boolean {
  return session.building_states.some((state) => {
    if (
      state.town_id !== town.id ||
      state.level < 1 ||
      state.building_id == null
    ) {
      return false
    }
    const building = buildingById(catalog, state.building_id)
    return building != null && isTavernBuilding(building)
  })
}

function collectHireIntent(
  session: GameSession,
  catalog: ReferenceCatalog,
  town: Town,
  playerId: string,
): HireIntent | { skip: string } | null {
  if (!townHasBuiltTavern(session, catalog, town)) {
    return null
  }
  const visiting = visitingHeroId(session, town)
  if (visiting) {
    const occupant = session.heroes.find((hero) => hero.id === visiting)
    if (!occupant || occupant.player_id !== playerId) {
      return { skip: `skip (hero visiting) hire_hero in ${town.name}` }
    }
    if (!adjacentHireSpawn(session, town)) {
      return {
        skip: `skip (no adjacent spawn) hire_hero in ${town.name}`,
      }
    }
  }
  const poolCount = unusedTavernPool(session, catalog, town.town_type_id).length
  if (poolCount < 1) {
    return { skip: `skip (no unused town-class heroes) hire_hero in ${town.name}` }
  }
  return {
    kind: 'hire_hero',
    townId: town.id,
    townName: town.name,
    poolCount,
    cost: hireHeroGoldCost(catalog),
  }
}

function adjacentHireSpawn(
  session: GameSession,
  town: Town,
): { q: number; r: number } | null {
  const blocked = new Set<string>()
  for (const hero of session.heroes) {
    blocked.add(`${hero.position.q},${hero.position.r}`)
  }
  for (const other of session.towns) {
    blocked.add(`${other.position.q},${other.position.r}`)
  }
  for (const node of session.nodes) {
    if (node.kind === 'pickup' && node.collected) {
      continue
    }
    blocked.add(`${node.position.q},${node.position.r}`)
  }
  for (const next of neighborHexes(town.position)) {
    if (!isPassable(next.q, next.r)) {
      continue
    }
    if (blocked.has(`${next.q},${next.r}`)) {
      continue
    }
    return { q: next.q, r: next.r }
  }
  return null
}

function actionLabel(action: TownAction): string {
  if (action.kind === 'recruit') {
    return `recruit ${action.unitName} in ${action.townName} slot ${action.slotNum} (avail ${action.available})`
  }
  if (action.kind === 'hire_hero') {
    return `hire_hero in ${action.townName} (pool ${action.poolCount})`
  }
  if (action.kind === 'upgrade_unit') {
    const where = action.slot.row === 'garrison' ? 'garrison' : 'hero army'
    return `upgrade_unit ${action.unitName}→${action.advancedName} x${action.qty} in ${action.townName} ${where} slot ${action.slot.slot}`
  }
  return `${action.kind} ${action.building.name} in ${action.townName} slot ${action.slotNum}`
}

function pickRecruitQty(maxQty: number): { qty: number; mode: 'max' | 'partial' } {
  if (maxQty <= 1) {
    return { qty: maxQty, mode: 'max' }
  }
  if (Math.random() < RECRUIT_MAX_CHANCE) {
    return { qty: maxQty, mode: 'max' }
  }
  const lo = Math.max(1, Math.ceil(maxQty * RECRUIT_PARTIAL_MIN))
  const hi = Math.max(lo, Math.floor(maxQty * RECRUIT_PARTIAL_MAX))
  const qty = lo + Math.floor(Math.random() * (hi - lo + 1))
  return { qty, mode: 'partial' }
}

function executeBuild(intent: BuildIntent, catalog: ReferenceCatalog): string | null {
  let error: string | null = null
  updateSession((current) => {
    const spent = spendResources(current, intent.cost)
    if (spent.error) {
      error = spent.error
      return current
    }
    const currentSlot = spent.session.building_states.find(
      (row) => row.town_id === intent.townId && row.slot_num === intent.slotNum,
    )
    let next = spent.session
    next = patchBuildingSlot(next, intent.townId, intent.slotNum - 1, {
      level: intent.nextLevel,
      buildingId: intent.building.id,
      recruitQty:
        intent.kind === 'build'
          ? buildingGrowth(intent.building)
          : (currentSlot?.recruit_qty ?? 0),
    })
    next = markTownBuiltToday(next, intent.townId)
    if (isLibraryBuilding(intent.building)) {
      const town = next.towns.find((row) => row.id === intent.townId)
      if (town) {
        next = ensureLibraryOffers(
          next,
          catalog,
          town.id,
          town.town_type_id,
          intent.slotNum,
        )
      }
    }
    return next
  })
  return error
}

function executeRecruit(
  intent: RecruitIntent,
  catalog: ReferenceCatalog,
  playerId: string,
): { error: string | null; detail: string } {
  const session = getSession()
  const wallet = walletFromPlayer(session, playerId)
  const state = session.building_states.find(
    (row) => row.town_id === intent.townId && row.slot_num === intent.slotNum,
  )
  const unit = unitForBuilding(catalog, intent.building.id)
  if (!state || !unit) {
    return { error: 'This building has no recruitable unit.', detail: '' }
  }
  const maxQty = maxAffordableQty(
    wallet,
    unitCost(unit),
    state.recruit_qty,
  )
  const pick = pickRecruitQty(maxQty)
  if (pick.qty < 1) {
    return { error: 'Cannot afford any recruits.', detail: '' }
  }
  let error: string | null = null
  updateSession((current) => {
    const result = recruitToGarrison(
      current,
      intent.townId,
      intent.slotNum,
      pick.qty,
      catalog,
    )
    error = result.error
    return result.error ? current : result.session
  })
  return {
    error,
    detail: error
      ? ''
      : `qty=${pick.qty}/${maxQty} (${pick.mode}) → garrison`,
  }
}

function executeUpgradeUnit(
  intent: UpgradeUnitIntent,
  catalog: ReferenceCatalog,
): { error: string | null; detail: string } {
  let error: string | null = null
  updateSession((current) => {
    const result = upgradeArmyStack(current, intent.townId, intent.slot, catalog)
    error = result.error
    return result.error ? current : result.session
  })
  return {
    error,
    detail: error
      ? ''
      : `${intent.unitName}→${intent.advancedName} x${intent.qty}`,
  }
}

function executeHire(
  intent: HireIntent,
  catalog: ReferenceCatalog,
  playerId: string,
): { error: string | null; detail: string } {
  let error: string | null = null
  let hired = ''
  updateSession((current) => {
    const town = current.towns.find((row) => row.id === intent.townId)
    if (!town) {
      error = 'This town is not in the game session.'
      return current
    }
    const visiting = visitingHeroId(current, town)
    let spawnAt: { q: number; r: number } | null = null
    if (visiting) {
      const occupant = current.heroes.find((hero) => hero.id === visiting)
      if (!occupant || occupant.player_id !== playerId) {
        error = 'A hero is visiting — cannot hire'
        return current
      }
      spawnAt = adjacentHireSpawn(current, town)
      if (!spawnAt) {
        error = 'No adjacent hex to place the hired hero.'
        return current
      }
    }
    const available = unusedTavernPool(current, catalog, town.town_type_id)
    if (available.length === 0) {
      error = 'No unused town-class heroes remain in the pool.'
      return current
    }
    const pick = available[Math.floor(Math.random() * available.length)]
    const result = hireHeroFromPool(current, intent.townId, pick, spawnAt)
    error = result.error
    const className = heroTypeName(catalog, pick.class_id)
    hired = className ? `${pick.name} (${className})` : pick.name
    if (!error && spawnAt) {
      hired += ` at ${spawnAt.q},${spawnAt.r}`
    }
    return result.error ? current : result.session
  })
  return {
    error,
    detail: error ? '' : `hired ${hired} in ${intent.townName}`,
  }
}

function rollHireGate(
  session: GameSession,
  catalog: ReferenceCatalog,
  player: Player,
): HireGate {
  const heroCount = session.heroes.filter(
    (hero) => hero.player_id === player.id,
  ).length
  const extraN = heroCount
  const chance = aiHireChanceExtraPct(catalog, extraN)
  const roll = Math.random() * 100
  return {
    allow: roll < chance,
    extraN,
    chance,
    roll,
  }
}

export function decideAndApplyTownBuild(player: Player): void {
  const catalog = getCachedCatalog()
  const header = [
    `AI town_build — ${player.id}`,
    `  player_arch=${archName(catalog, player.arch_id)} blend=${aiHeroBlendBias(catalog).toFixed(2)} jitter=±${aiDecisionJitterPct(catalog)}%`,
  ]
  if (!catalog) {
    appendAiTrace([...header, '  no catalog'].join('\n'))
    return
  }

  const hireGate = rollHireGate(getSession(), catalog, player)
  header.push(
    `  hire_desire extra_${hireGate.extraN} chance=${hireGate.chance}% roll=${hireGate.roll.toFixed(1)} → ${hireGate.allow ? 'yes' : 'no'}`,
  )

  for (let n = 0; n < MAX_TOWN_ACTIONS; n += 1) {
    if (!applyOneTownAction(player, catalog, header, n > 0, hireGate)) {
      return
    }
  }
}

function applyOneTownAction(
  player: Player,
  catalog: ReferenceCatalog,
  header: string[],
  laterPass: boolean,
  hireGate: HireGate,
): boolean {
  const session = getSession()
  const hero =
    session.heroes.find((row) => row.player_id === player.id) ?? null
  const heroClassId = hero?.class_id ?? null
  const className = heroTypeName(catalog, heroClassId) || 'none'
  const towns = session.towns.filter((town) => town.player_id === player.id)
  const wallet = walletFromPlayer(session, player.id)
  const gold = formatAmount(wallet[GOLD_RESOURCE_ID]?.stockpile ?? 0)
  const headerWithGold = [
    ...header,
    `  gold=${gold} hero_class=${className} class_bias=${OWN_CLASS_SCORE_MULT}/${OTHER_CLASS_SCORE_MULT} upgrade_bonus=${aiUpgradeBonusMult(catalog).toFixed(2)}`,
    ...(!laterPass ? [armySlotNotes(session, catalog, towns, wallet)] : []),
  ]
  const weights: Record<string, number> = {}
  for (const factor of TOWN_BUILD_FACTORS) {
    weights[factor] = finalFactorWeight(player, null, TOWN_BUILD_DECISION, factor, catalog)
  }

  const scored: ScoredOption<TownAction>[] = []
  const skipped: string[] = []
  for (const town of towns) {
    for (const action of collectTownActions(session, catalog, town)) {
      const cost = constructionCost(catalog, action.building)
      const intent: BuildIntent = { ...action, cost }
      const label = actionLabel(intent)
      const affordError = canAfford(wallet, cost)
      if (!affordError) {
        const factors = factorForAction(intent)
        const { mult } = actionScoreMult(intent, heroClassId, catalog)
        scored.push({
          id: `${intent.kind}:${intent.townId}:${intent.slotNum}:${intent.building.id}`,
          label,
          factors,
          weights,
          score: Math.round(scoreOption(factors, weights) * mult * 100) / 100,
          data: intent,
        })
      } else {
        skipped.push(`  skip (${affordError}) ${label}`)
      }
    }
    for (const intent of collectRecruitActions(session, catalog, town)) {
      const label = actionLabel(intent)
      const unit = unitForBuilding(catalog, intent.building.id)
      if (!unit) {
        skipped.push(`  skip (no unit) ${label}`)
        continue
      }
      if (!garrisonCanTakeUnit(session, town, unit.id)) {
        skipped.push(`  skip (garrison full) ${label}`)
        continue
      }
      const maxQty = maxAffordableQty(wallet, unitCost(unit), intent.available)
      if (maxQty < 1) {
        skipped.push(`  skip (cannot afford 1) ${label}`)
        continue
      }
      const factors = factorForAction(intent)
      const { mult } = actionScoreMult(intent, heroClassId, catalog)
      scored.push({
        id: `${intent.kind}:${intent.townId}:${intent.slotNum}:${intent.building.id}`,
        label,
        factors,
        weights,
        score: Math.round(scoreOption(factors, weights) * mult * 100) / 100,
        data: intent,
      })
    }
    for (const intent of collectUpgradeActions(session, catalog, town, player.id)) {
      const label = actionLabel(intent)
      const affordError = canAfford(wallet, intent.cost)
      if (affordError) {
        skipped.push(`  skip (${affordError}) ${label}`)
        continue
      }
      const factors = factorForAction(intent)
      const { mult } = actionScoreMult(intent, heroClassId, catalog)
      scored.push({
        id: `${intent.kind}:${intent.townId}:${intent.slot.row}:${intent.slot.heroId ?? ''}:${intent.slot.slot}`,
        label,
        factors,
        weights,
        score: Math.round(scoreOption(factors, weights) * mult * 100) / 100,
        data: intent,
      })
    }
    if (hireGate.allow) {
      const hire = collectHireIntent(session, catalog, town, player.id)
      if (hire && 'skip' in hire) {
        skipped.push(`  ${hire.skip}`)
      } else if (hire) {
        const label = actionLabel(hire)
        const affordError = canAfford(wallet, hire.cost)
        if (affordError) {
          skipped.push(`  skip (${affordError}) ${label}`)
        } else {
          const factors = factorForAction(hire)
          const { mult } = actionScoreMult(hire, heroClassId, catalog)
          scored.push({
            id: `${hire.kind}:${hire.townId}`,
            label,
            factors,
            weights,
            score: Math.round(scoreOption(factors, weights) * mult * 100) / 100,
            data: hire,
          })
        }
      }
    }
  }

  if (!hireGate.allow && !laterPass) {
    skipped.push(
      `  skip (hire roll ${hireGate.roll.toFixed(1)} >= ${hireGate.chance}%) hire_hero extra_${hireGate.extraN}`,
    )
  }

  if (scored.length === 0) {
    if (!laterPass) {
      appendAiTrace(
        [...headerWithGold, '  no affordable build, recruit, upgrade, or hire this turn', ...skipped].join('\n'),
      )
    }
    return false
  }

  const pick = pickWeighted(scored)
  if (!pick) {
    appendAiTrace([...headerWithGold, '  pick failed'].join('\n'))
    return false
  }

  const body = scored.map((option, index) => {
    const mark = option.id === pick.picked.id ? ' ← chosen' : ''
    const sm = pick.optionWeights[index]?.toFixed(3) ?? '?'
    const { tag } = actionScoreMult(option.data, heroClassId, catalog)
    return `  ${letter(index)} ${option.label}\n      ${formatFactors(option.factors, option.weights)}  SCORE=${option.score.toFixed(2)}${tag} softmax=${sm}${mark}`
  })
  const chosen = pick.picked.data
  const applied =
    chosen.kind === 'recruit'
      ? executeRecruit(chosen, catalog, player.id)
      : chosen.kind === 'upgrade_unit'
        ? executeUpgradeUnit(chosen, catalog)
        : chosen.kind === 'hire_hero'
          ? executeHire(chosen, catalog, player.id)
          : { error: executeBuild(chosen, catalog), detail: '' }
  if (chosen.kind === 'hire_hero' && applied.error == null) {
    hireGate.allow = false
  }
  appendAiTrace(
    [
      ...headerWithGold,
      ...body,
      ...skipped,
      `  T=${pick.temperature.toFixed(2)} roll=${pick.roll.toFixed(3)} / ${pick.weightSum.toFixed(3)} → ${pick.picked.label}`,
      applied.error
        ? `  FAILED ${applied.error}`
        : applied.detail
          ? `  applied ${applied.detail}`
          : '  applied',
    ].join('\n'),
  )
  return applied.error == null
}
