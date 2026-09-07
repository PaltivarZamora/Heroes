import {
  getCachedCatalog,
  unitById,
  type ReferenceCatalog,
} from '../town/catalog'
import {
  applyArmyAllocation,
  applyPooledArmyAllocation,
  findTownAt,
  type ArmyAllocPart,
} from '../session/accessors'
import { getSession, updateSession } from '../session/store'
import {
  ARMY_STACK_SLOTS,
  type GameSession,
  type Hero,
  type Player,
  type Town,
  type UnitStack,
} from '../session/types'
import { appendAiTrace } from './trace'
import { ARMY_ALLOC_DECISION, DEFAULT_AI_ARCH_ID } from './types'
import { archName, blendedArchWeight } from './weights'

const HERO_SHARE_FACTOR = 'hero_share_pct'
const SPLIT_TWO_CHANCE = 0.25

type TypeGroup = {
  unitId: number
  name: string
  qty: number
  value: number
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) {
    return 0
  }
  if (n < 0) {
    return 0
  }
  if (n > 100) {
    return 100
  }
  return n
}

function padSlots(slots: Array<string | null>): Array<string | null> {
  const next = slots.slice(0, ARMY_STACK_SLOTS)
  while (next.length < ARMY_STACK_SLOTS) {
    next.push(null)
  }
  return next
}

function stacksInSlots(
  session: GameSession,
  slots: Array<string | null>,
): UnitStack[] {
  const out: UnitStack[] = []
  for (const id of padSlots(slots)) {
    if (!id) {
      continue
    }
    const stack = session.units.find((row) => row.id === id)
    if (stack && stack.qty > 0) {
      out.push(stack)
    }
  }
  return out
}

/** `qty × avg dmg × health` — shared army-value formula. */
export function unitArmyValue(
  catalog: ReferenceCatalog,
  unitId: number,
  qty: number,
): number {
  const unit = unitById(catalog, unitId)
  if (!unit) {
    return 0
  }
  const avgDmg = (unit.min_dmg + unit.max_dmg) / 2
  return qty * avgDmg * unit.health
}

/** `qty × avg dmg × health` for living stacks in these slots. */
export function slotsArmyValue(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  slots: Array<string | null> | undefined,
): number {
  if (!catalog || !slots) {
    return 0
  }
  let total = 0
  for (const stack of stacksInSlots(session, slots)) {
    total += unitArmyValue(catalog, stack.unit_id, stack.qty)
  }
  return total
}

/** Sum of `qty × avg dmg × health` for stacks currently in the town garrison. */
export function garrisonArmyValue(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  town: Town,
): number {
  if (!catalog) {
    return 0
  }
  let total = 0
  for (const stack of stacksInSlots(session, town.garrison.slots_1_to_6)) {
    total += unitArmyValue(catalog, stack.unit_id, stack.qty)
  }
  return total
}

function consolidate(
  catalog: ReferenceCatalog,
  stacks: UnitStack[],
): TypeGroup[] {
  const byType = new Map<number, number>()
  for (const stack of stacks) {
    byType.set(stack.unit_id, (byType.get(stack.unit_id) ?? 0) + stack.qty)
  }
  const groups: TypeGroup[] = []
  for (const [unitId, qty] of byType) {
    if (qty <= 0) {
      continue
    }
    const unit = unitById(catalog, unitId)
    groups.push({
      unitId,
      name: unit?.name ?? `#${unitId}`,
      qty,
      value: unitArmyValue(catalog, unitId, qty),
    })
  }
  groups.sort((a, b) => b.value - a.value || a.unitId - b.unitId)
  return groups
}

function qtyMap(groups: TypeGroup[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const group of groups) {
    map.set(group.unitId, group.qty)
  }
  return map
}

function qtyMapsEqual(a: Map<number, number>, b: Map<number, number>): boolean {
  if (a.size !== b.size) {
    return false
  }
  for (const [unitId, qty] of a) {
    if ((b.get(unitId) ?? 0) !== qty) {
      return false
    }
  }
  return true
}

function fmtValue(n: number): string {
  if (!Number.isFinite(n)) {
    return '0'
  }
  if (Math.abs(n - Math.round(n)) < 1e-6) {
    return String(Math.round(n))
  }
  return n.toFixed(1)
}

function fmtPct(n: number): string {
  return `${Math.round(n)}%`
}

function groupLine(group: TypeGroup): string {
  return `${group.name} x${group.qty} val=${fmtValue(group.value)}`
}

function splitType(
  group: TypeGroup,
  extraRoom: { left: number },
): ArmyAllocPart[] {
  if (
    extraRoom.left > 0 &&
    group.qty >= 2 &&
    Math.random() < SPLIT_TWO_CHANCE
  ) {
    extraRoom.left -= 1
    const first = Math.max(1, Math.floor(group.qty / 2))
    const second = group.qty - first
    if (second >= 1) {
      return [
        { unitId: group.unitId, qty: first },
        { unitId: group.unitId, qty: second },
      ]
    }
  }
  return [{ unitId: group.unitId, qty: group.qty }]
}

function stacksForSide(groups: TypeGroup[]): {
  parts: ArmyAllocPart[]
  splits: string[]
} {
  const extraRoom = { left: Math.max(0, ARMY_STACK_SLOTS - groups.length) }
  const parts: ArmyAllocPart[] = []
  const splits: string[] = []
  for (const group of groups) {
    const next = splitType(group, extraRoom)
    parts.push(...next)
    if (next.length > 1) {
      splits.push(
        `${group.name} x${group.qty} → ${next.map((part) => part.qty).join('+')}`,
      )
    }
  }
  return { parts, splits }
}

function assignTypes(
  ranked: TypeGroup[],
  targetValue: number,
  garrisonSlots = ARMY_STACK_SLOTS,
): {
  heroTypes: TypeGroup[]
  garrisonTypes: TypeGroup[]
  leftover: TypeGroup[]
} {
  const heroTypes: TypeGroup[] = []
  const garrisonTypes: TypeGroup[] = []
  const leftover: TypeGroup[] = []
  let heroValue = 0
  for (const group of ranked) {
    if (heroTypes.length < ARMY_STACK_SLOTS && heroValue < targetValue) {
      heroTypes.push(group)
      heroValue += group.value
      continue
    }
    if (garrisonTypes.length < garrisonSlots) {
      garrisonTypes.push(group)
      continue
    }
    if (heroTypes.length < ARMY_STACK_SLOTS) {
      heroTypes.push(group)
      heroValue += group.value
      continue
    }
    leftover.push(group)
  }
  return { heroTypes, garrisonTypes, leftover }
}

function cheapestGroup(groups: TypeGroup[]): TypeGroup {
  return [...groups].sort((a, b) => {
    const ua = a.qty > 0 ? a.value / a.qty : Number.POSITIVE_INFINITY
    const ub = b.qty > 0 ? b.value / b.qty : Number.POSITIVE_INFINITY
    return ua - ub || a.value - b.value || a.unitId - b.unitId
  })[0]
}

function ensureHeroKeepsArmy(
  heroTypes: TypeGroup[],
  garrisonTypes: TypeGroup[],
  leftover: TypeGroup[],
): {
  heroTypes: TypeGroup[]
  garrisonTypes: TypeGroup[]
  leftover: TypeGroup[]
} {
  if (heroTypes.length > 0) {
    return { heroTypes, garrisonTypes, leftover }
  }
  if (garrisonTypes.length === 0 && leftover.length === 0) {
    return { heroTypes, garrisonTypes, leftover }
  }
  const donor = cheapestGroup([...garrisonTypes, ...leftover])
  if (!donor) {
    return { heroTypes, garrisonTypes, leftover }
  }
  return {
    heroTypes: [donor],
    garrisonTypes: garrisonTypes.filter((group) => group.unitId !== donor.unitId),
    leftover: leftover.filter((group) => group.unitId !== donor.unitId),
  }
}

function peelMinArmy(ranked: TypeGroup[]): {
  min: TypeGroup | null
  rest: TypeGroup[]
} {
  const totalQty = ranked.reduce((sum, group) => sum + group.qty, 0)
  if (ranked.length === 0 || totalQty < 2) {
    return { min: null, rest: ranked }
  }
  const cheapest = cheapestGroup(ranked)
  const unitVal =
    cheapest.qty > 0 ? cheapest.value / cheapest.qty : cheapest.value
  const min: TypeGroup = { ...cheapest, qty: 1, value: unitVal }
  const rest = ranked
    .map((group) => {
      if (group.unitId !== cheapest.unitId) {
        return group
      }
      const qty = group.qty - 1
      if (qty <= 0) {
        return null
      }
      return { ...group, qty, value: unitVal * qty }
    })
    .filter((group): group is TypeGroup => group != null)
  return { min, rest }
}

function parkLeftover(
  leftover: TypeGroup[],
  heroParts: ArmyAllocPart[],
  garrisonParts: ArmyAllocPart[],
): TypeGroup[] {
  const still: TypeGroup[] = []
  for (const group of leftover) {
    if (heroParts.length < ARMY_STACK_SLOTS) {
      heroParts.push({ unitId: group.unitId, qty: group.qty })
    } else if (garrisonParts.length < ARMY_STACK_SLOTS) {
      garrisonParts.push({ unitId: group.unitId, qty: group.qty })
    } else {
      still.push(group)
    }
  }
  return still
}

/**
 * If this AI hero starts the turn already in an owned town, rewrite army vs
 * garrison to the archetype's target value share. No-op when already matched.
 */
export function decideAndApplyArmyAlloc(player: Player, hero: Hero): void {
  const catalog = getCachedCatalog()
  const session = getSession()
  const live =
    session.heroes.find((row) => row.id === hero.id) ?? hero
  const town = findTownAt(session, live.position.q, live.position.r)
  if (!town || town.player_id !== player.id) {
    return
  }
  if (!catalog) {
    appendAiTrace(
      `AI army_alloc — ${live.name} in ${town.name}  no catalog`,
    )
    return
  }

  const pool = [
    ...stacksInSlots(session, live.army.slots_1_to_6),
    ...stacksInSlots(session, town.garrison.slots_1_to_6),
  ]
  const ranked = consolidate(catalog, pool)
  if (ranked.length === 0) {
    appendAiTrace(
      `AI army_alloc — ${live.name} in ${town.name}  no-op (empty pool)`,
    )
    return
  }

  const playerArch = player.arch_id > 0 ? player.arch_id : DEFAULT_AI_ARCH_ID
  const sharePct = clampPct(
    blendedArchWeight(
      player,
      live,
      ARMY_ALLOC_DECISION,
      HERO_SHARE_FACTOR,
      catalog,
    ),
  )
  const totalValue = ranked.reduce((sum, group) => sum + group.value, 0)
  const targetValue = totalValue * (sharePct / 100)
  const overflow = ranked.length > ARMY_STACK_SLOTS * 2
  const rawAssign = assignTypes(ranked, targetValue)
  const { heroTypes, garrisonTypes, leftover } = ensureHeroKeepsArmy(
    rawAssign.heroTypes,
    rawAssign.garrisonTypes,
    rawAssign.leftover,
  )

  const currentHero = qtyMap(
    consolidate(catalog, stacksInSlots(session, live.army.slots_1_to_6)),
  )
  const currentGarrison = qtyMap(
    consolidate(catalog, stacksInSlots(session, town.garrison.slots_1_to_6)),
  )
  const matches =
    leftover.length === 0 &&
    qtyMapsEqual(currentHero, qtyMap(heroTypes)) &&
    qtyMapsEqual(currentGarrison, qtyMap(garrisonTypes))

  const heroValue = heroTypes.reduce((sum, group) => sum + group.value, 0)
  const garrisonValue = garrisonTypes.reduce(
    (sum, group) => sum + group.value,
    0,
  )
  const heroShareOfPool =
    totalValue > 0 ? (heroValue / totalValue) * 100 : 0
  const header = [
    `AI army_alloc — ${live.name} in ${town.name}`,
    `  player_arch=${archName(catalog, playerArch)} hero_arch=${archName(catalog, live.arch_id)} target=${fmtPct(sharePct)} pool_val=${fmtValue(totalValue)} types=${ranked.length}`,
  ]

  if (overflow) {
    header.push(
      `  FLAG TO ROD: ${ranked.length} distinct unit types exceeds ${ARMY_STACK_SLOTS * 2} slots (hero ${ARMY_STACK_SLOTS} + garrison ${ARMY_STACK_SLOTS}). Placing highest-value types first.`,
    )
  }

  if (matches) {
    appendAiTrace(
      [
        ...header,
        `  no-op (already matches) hero=${fmtPct(heroShareOfPool)} (${heroTypes.length} types) garrison=${fmtPct(100 - heroShareOfPool)} (${garrisonTypes.length} types)`,
        `  hero: ${heroTypes.map(groupLine).join(', ') || '(empty)'}`,
        `  garrison: ${garrisonTypes.map(groupLine).join(', ') || '(empty)'}`,
      ].join('\n'),
    )
    return
  }

  const heroSplit = stacksForSide(heroTypes)
  const garrisonSplit = stacksForSide(garrisonTypes)
  const unplaced = parkLeftover(
    leftover,
    heroSplit.parts,
    garrisonSplit.parts,
  )
  const unplacedIds = pool
    .filter((stack) =>
      unplaced.some((group) => group.unitId === stack.unit_id),
    )
    .map((stack) => stack.id)

  if (unplaced.length > 0) {
    header.push(
      `  FLAG TO ROD: could not place ${unplaced.map((group) => `${group.name} x${group.qty}`).join(', ')} — no free slot after 12-cap`,
    )
  }

  updateSession((current) =>
    applyArmyAllocation(
      current,
      town.id,
      live.id,
      heroSplit.parts,
      garrisonSplit.parts,
      unplacedIds,
    ),
  )

  const splitLines = [
    ...heroSplit.splits.map((line) => `  split hero ${line}`),
    ...garrisonSplit.splits.map((line) => `  split garrison ${line}`),
  ]
  appendAiTrace(
    [
      ...header,
      `  applied hero=${fmtPct(heroShareOfPool)} (${heroTypes.length} types, ${heroSplit.parts.length} stacks) garrison=${fmtPct(totalValue > 0 ? (garrisonValue / totalValue) * 100 : 0)} (${garrisonTypes.length} types, ${garrisonSplit.parts.length} stacks)`,
      `  hero: ${heroTypes.map(groupLine).join(', ') || '(empty)'}`,
      `  garrison: ${garrisonTypes.map(groupLine).join(', ') || '(empty)'}`,
      ...splitLines,
    ].join('\n'),
  )
}

function armyValueOf(
  catalog: ReferenceCatalog,
  session: GameSession,
  hero: Hero,
): number {
  return consolidate(
    catalog,
    stacksInSlots(session, hero.army.slots_1_to_6),
  ).reduce((sum, group) => sum + group.value, 0)
}

function pickMainHero(catalog: ReferenceCatalog, session: GameSession, a: Hero, b: Hero): {
  main: Hero
  other: Hero
} {
  const va = armyValueOf(catalog, session, a)
  const vb = armyValueOf(catalog, session, b)
  if (vb > va) {
    return { main: b, other: a }
  }
  return { main: a, other: b }
}

/**
 * AI shuttle: two owned heroes meet. The weaker keeps a 1-stack minimum;
 * the stronger takes the rest (and garrison if the meet is at a town).
 */
export function decideAndApplyHeroTrade(
  player: Player,
  heroA: Hero,
  heroB: Hero,
): void {
  const catalog = getCachedCatalog()
  const session = getSession()
  const a = session.heroes.find((row) => row.id === heroA.id) ?? heroA
  const b = session.heroes.find((row) => row.id === heroB.id) ?? heroB
  if (a.id === b.id || a.player_id !== player.id || b.player_id !== player.id) {
    return
  }
  if (!catalog) {
    appendAiTrace(`AI army_alloc — ${a.name} meets ${b.name}  no catalog`)
    return
  }

  const { main, other } = pickMainHero(catalog, session, a, b)
  const townA = findTownAt(session, a.position.q, a.position.r)
  const townB = findTownAt(session, b.position.q, b.position.r)
  const town =
    townA && townA.player_id === player.id
      ? townA
      : townB && townB.player_id === player.id
        ? townB
        : null

  const pool = [
    ...stacksInSlots(session, main.army.slots_1_to_6),
    ...stacksInSlots(session, other.army.slots_1_to_6),
    ...(town ? stacksInSlots(session, town.garrison.slots_1_to_6) : []),
  ]
  const ranked = consolidate(catalog, pool)
  if (ranked.length === 0) {
    appendAiTrace(
      `AI army_alloc — ${main.name} meets ${other.name}  no-op (empty pool)`,
    )
    return
  }

  const { min, rest } = peelMinArmy(ranked)
  if (!min) {
    appendAiTrace(
      `AI army_alloc — ${main.name} meets ${other.name}  no-op (not enough units to shuttle)`,
    )
    return
  }

  const playerArch = player.arch_id > 0 ? player.arch_id : DEFAULT_AI_ARCH_ID
  const sharePct = clampPct(
    blendedArchWeight(
      player,
      main,
      ARMY_ALLOC_DECISION,
      HERO_SHARE_FACTOR,
      catalog,
    ),
  )
  const totalValue = ranked.reduce((sum, group) => sum + group.value, 0)
  const targetValue = totalValue * (sharePct / 100)
  const garrisonSlots = town ? ARMY_STACK_SLOTS : 0
  const rawAssign = assignTypes(rest, targetValue, garrisonSlots)
  const kept = ensureHeroKeepsArmy(
    rawAssign.heroTypes,
    rawAssign.garrisonTypes,
    rawAssign.leftover,
  )
  const mainTypes = kept.heroTypes
  const garrisonTypes = kept.garrisonTypes
  const leftover = kept.leftover

  const currentMain = qtyMap(
    consolidate(catalog, stacksInSlots(session, main.army.slots_1_to_6)),
  )
  const currentOther = qtyMap(
    consolidate(catalog, stacksInSlots(session, other.army.slots_1_to_6)),
  )
  const currentGarrison = town
    ? qtyMap(
        consolidate(catalog, stacksInSlots(session, town.garrison.slots_1_to_6)),
      )
    : new Map<number, number>()
  const plannedOther = qtyMap([min])
  const matches =
    leftover.length === 0 &&
    qtyMapsEqual(currentMain, qtyMap(mainTypes)) &&
    qtyMapsEqual(currentOther, plannedOther) &&
    qtyMapsEqual(currentGarrison, qtyMap(garrisonTypes))

  const header = [
    `AI army_alloc — shuttle ${other.name} → ${main.name}${town ? ` at ${town.name}` : ''}`,
    `  player_arch=${archName(catalog, playerArch)} main_arch=${archName(catalog, main.arch_id)} target=${fmtPct(sharePct)} pool_val=${fmtValue(totalValue)} types=${ranked.length}`,
    `  min ${other.name}: ${groupLine(min)}`,
  ]

  if (matches) {
    appendAiTrace([...header, '  no-op (already matches)'].join('\n'))
    return
  }

  const mainSplit = stacksForSide(mainTypes)
  const otherSplit = stacksForSide([min])
  const garrisonSplit = stacksForSide(garrisonTypes)
  const unplaced = parkLeftover(
    leftover,
    mainSplit.parts,
    garrisonSplit.parts,
  )
  const unplacedIds = pool
    .filter((stack) =>
      unplaced.some((group) => group.unitId === stack.unit_id),
    )
    .map((stack) => stack.id)

  if (unplaced.length > 0) {
    header.push(
      `  FLAG TO ROD: could not place ${unplaced.map((group) => `${group.name} x${group.qty}`).join(', ')} after shuttle cap`,
    )
  }

  updateSession((current) =>
    applyPooledArmyAllocation(
      current,
      [main.id, other.id],
      town?.id ?? null,
      [
        { heroId: main.id, parts: mainSplit.parts },
        { heroId: other.id, parts: otherSplit.parts },
      ],
      garrisonSplit.parts,
      unplacedIds,
    ),
  )

  appendAiTrace(
    [
      ...header,
      `  applied main ${main.name}: ${mainTypes.map(groupLine).join(', ') || '(empty)'}`,
      `  shuttle ${other.name}: ${groupLine(min)}`,
      `  garrison: ${garrisonTypes.map(groupLine).join(', ') || '(empty)'}`,
    ].join('\n'),
  )
}
