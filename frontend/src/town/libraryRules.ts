import { GOLD_RESOURCE_ID } from '../hex/resources'
import type { OfferedAbilityRoll } from '../session/types'
import type {
  AbilityRow,
  DisciplineRow,
  HeroTypeRow,
  ReferenceCatalog,
} from './catalog'

export const LIBRARY_TIERS = [1, 2, 3] as const

export const LIBRARY_GOLD_COST: Record<number, number> = {
  1: 500,
  2: 1000,
  3: 2000,
}

export type LibrarySlotKind = 'unopened' | 'locked' | 'buyable' | 'bought'

function shufflePick(ids: number[], keep: number): number[] {
  const copy = ids.slice()
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = copy[i]
    const b = copy[j]
    if (a === undefined || b === undefined) {
      continue
    }
    copy[i] = b
    copy[j] = a
  }
  return copy.slice(0, Math.min(keep, copy.length))
}

export function townHeroClasses(
  catalog: ReferenceCatalog,
  townTypeId: number,
): HeroTypeRow[] {
  return catalog.hero_type
    .filter((row) => row.town_id === townTypeId)
    .slice()
    .sort((a, b) => a.id - b.id)
}

export function classDisciplines(
  catalog: ReferenceCatalog,
  classId: number,
): DisciplineRow[] {
  const ids = catalog.hero_discipline
    .filter((row) => row.hero_id === classId)
    .map((row) => row.discipline_id)
  return ids
    .map((id) => catalog.discipline.find((row) => row.id === id))
    .filter((row): row is DisciplineRow => row != null)
}

export function townDisciplineIds(
  catalog: ReferenceCatalog,
  townTypeId: number,
): number[] {
  const classIds = new Set(townHeroClasses(catalog, townTypeId).map((row) => row.id))
  const ids = new Set<number>()
  for (const row of catalog.hero_discipline) {
    if (classIds.has(row.hero_id)) {
      ids.add(row.discipline_id)
    }
  }
  return [...ids].sort((a, b) => a - b)
}

export function heroHasDiscipline(
  catalog: ReferenceCatalog,
  classId: number | null,
  disciplineId: number,
): boolean {
  if (classId == null) {
    return false
  }
  return catalog.hero_discipline.some(
    (row) => row.hero_id === classId && row.discipline_id === disciplineId,
  )
}

export function abilitiesFor(
  catalog: ReferenceCatalog,
  disciplineId: number,
  levelId: number,
): AbilityRow[] {
  return catalog.ability.filter(
    (row) => row.discipline_id === disciplineId && row.level_id === levelId,
  )
}

export function findOffer(
  offers: OfferedAbilityRoll[] | undefined,
  disciplineId: number,
  level: number,
): OfferedAbilityRoll | undefined {
  return (offers ?? []).find(
    (row) => row.discipline_id === disciplineId && row.level === level,
  )
}

export function rollLibraryOffers(
  catalog: ReferenceCatalog,
  buildingId: number,
  disciplineId: number,
  level: number,
): OfferedAbilityRoll {
  const pool = abilitiesFor(catalog, disciplineId, level).map((row) => row.id)
  const keep = level >= 3 ? pool.length : 2
  return {
    building_id: buildingId,
    discipline_id: disciplineId,
    level,
    ability_ids: shufflePick(pool, keep),
  }
}

export function mergeLibraryOffers(
  existing: OfferedAbilityRoll[] | undefined,
  catalog: ReferenceCatalog,
  buildingId: number,
  townTypeId: number,
  buildingLevel: number,
): OfferedAbilityRoll[] {
  const current = existing ?? []
  if (buildingLevel < 1 || buildingId <= 0) {
    return current
  }
  const additions: OfferedAbilityRoll[] = []
  for (const disciplineId of townDisciplineIds(catalog, townTypeId)) {
    for (const level of LIBRARY_TIERS) {
      if (level > buildingLevel) {
        continue
      }
      if (findOffer(current, disciplineId, level) || findOffer(additions, disciplineId, level)) {
        continue
      }
      additions.push(rollLibraryOffers(catalog, buildingId, disciplineId, level))
    }
  }
  return additions.length === 0 ? current : [...current, ...additions]
}

export function librarySlotKind(
  buildingLevel: number,
  level: number,
  abilityId: number | null,
  visiting: { classId: number | null; learned: number[] } | null,
  catalog: ReferenceCatalog,
  disciplineId: number,
): LibrarySlotKind {
  if (buildingLevel < level || abilityId == null) {
    return 'unopened'
  }
  if (visiting && visiting.learned.includes(abilityId)) {
    return 'bought'
  }
  if (
    visiting &&
    heroHasDiscipline(catalog, visiting.classId, disciplineId) &&
    !visiting.learned.includes(abilityId)
  ) {
    return 'buyable'
  }
  return 'locked'
}

export function goldCostForLevel(levelId: number): Record<number, number> {
  return { [GOLD_RESOURCE_ID]: LIBRARY_GOLD_COST[levelId] ?? 0 }
}

export function abilityById(
  catalog: ReferenceCatalog,
  id: number,
): AbilityRow | undefined {
  return catalog.ability.find((row) => row.id === id)
}

export function learnedAbilitiesAtTier(
  catalog: ReferenceCatalog,
  learnedIds: number[],
  disciplineId: number,
  levelId: number,
): AbilityRow[] {
  const have = new Set(learnedIds)
  return abilitiesFor(catalog, disciplineId, levelId).filter((row) => have.has(row.id))
}

export function tierLabel(
  catalog: ReferenceCatalog,
  levelId: number,
): string {
  return catalog.ability_level.find((row) => row.id === levelId)?.value ?? `Tier ${levelId}`
}
