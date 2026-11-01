import {
  unitById,
  type ReferenceCatalog,
  type UnitCombatAbilities,
  type UnitRetaliation,
  type UnitRow,
} from './catalog'
import { logConfigOnce } from '../session/configLog'
import {
  TAG_FIRE_TOTEM,
  TAG_LIGHTNING_TOTEM,
  TAG_NATURE_TOTEM,
  unitHasNamedTag,
} from './unitTags'

function enrichRetaliation(
  _catalog: ReferenceCatalog,
  _unit: UnitRow,
  base: UnitRetaliation,
): UnitRetaliation {
  return base
}

function enrichAbilities(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  base: UnitCombatAbilities,
): UnitCombatAbilities {
  let next = base

  if (next.groundEffectId === 6 && next.fizzleTerrainIds.length === 0) {
    next = { ...next, fizzleTerrainIds: [3, 20, 21] }
  }

  if (unitHasNamedTag(catalog, unit, TAG_FIRE_TOTEM)) {
    next = {
      ...next,
      shape: 'single',
      autoTarget: next.autoTarget ?? 'random_enemy',
    }
  }
  if (unitHasNamedTag(catalog, unit, TAG_LIGHTNING_TOTEM)) {
    next = {
      ...next,
      shape: 'beam',
      autoTarget: next.autoTarget ?? 'random_enemy',
    }
  }
  if (unitHasNamedTag(catalog, unit, TAG_NATURE_TOTEM)) {
    next = {
      ...next,
      shape: next.shape ?? 'single',
      autoTarget: next.autoTarget ?? 'most_injured_ally',
    }
  }

  return next
}

function enrichMaxRange(
  _catalog: ReferenceCatalog,
  _unit: UnitRow,
  parsed: number,
): number {
  return parsed
}

function enrichBlocksLos(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  fromDb: boolean,
): boolean {
  if (fromDb) {
    return true
  }
  return unitHasNamedTag(catalog, unit, 'terrain_los_blocker')
}

export function enrichCatalogUnits(catalog: ReferenceCatalog): void {
  catalog.unit = catalog.unit.map((unit) => {
    const retaliation = enrichRetaliation(catalog, unit, unit.retaliation)
    const abilities = enrichAbilities(catalog, unit, unit.abilities)
    const max_range = enrichMaxRange(catalog, unit, unit.max_range)
    const blocks_los = enrichBlocksLos(
      catalog,
      unit,
      unit.blocks_los === true,
    )
    let image_path = unit.image_path
    let image_path_alt = unit.image_path_alt
    if (unitHasNamedTag(catalog, unit, 'unstable_rift')) {
      image_path = image_path ?? 'Unstable_Rift_1.png'
      image_path_alt = image_path_alt ?? 'Silent_Rift_1.png'
    }
    return {
      ...unit,
      retaliation,
      abilities,
      max_range,
      blocks_los,
      image_path,
      image_path_alt,
    }
  })
  for (const unit of catalog.unit) {
    const summonId = unit.abilities.summonOnKillUnitId
    if (summonId != null && summonId > 0 && !unitById(catalog, summonId)) {
      logConfigOnce(
        `summon_on_kill:${unit.id}:${summonId}`,
        `[summon_on_kill] unit.id=${unit.id} references missing summon_on_kill_unit_id=${summonId}`,
      )
    }
  }
}
