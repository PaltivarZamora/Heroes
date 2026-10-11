import fs from 'fs'
import { fileURLToPath } from 'url'

const catalogPath = fileURLToPath(
  new URL('../src/town/catalog.ts', import.meta.url),
)
let s = fs.readFileSync(catalogPath, 'utf8')

s = s.replace(
  "import { parseFootprint as parseFootprintCode } from '../combat/footprint'\n",
  `import { parseFootprint as parseFootprintCode } from '../combat/footprint'
import {
  BUILDING_SLOT_HANGER,
  BUILDING_SLOT_LIBRARY,
  BUILDING_SLOT_MARKETPLACE,
  BUILDING_SLOT_TAVERN,
  BUILDING_SLOT_TOWN_UNIQUE,
  buildingInSlot,
} from './buildingSlots'
import { enrichCatalogUnits } from './enrichCatalogUnits'
import {
  TAG_AUTO_TARGET_RANDOM_ENEMY,
  TAG_AUTO_TARGET_RANDOM_WALL,
  unitHasNamedTag,
  unitHasTag,
} from './unitTags'
`,
)

s = s.replace(
  `  /** Per-creature cost to upgrade this base unit into its Advanced form. */
  upgrade_cost: CostMap | null
}`,
  `  /** Per-creature cost to upgrade this base unit into its Advanced form. */
  upgrade_cost: CostMap | null
  /** Advanced unit row id when this stack can be upgraded (null = no upgrade). */
  upgrade_unit_id: number | null
}`,
)

s = s.replace(
  `export function isTavernBuilding(building: BuildingRow): boolean {
  return building.name.trim().toLowerCase() === 'tavern'
}

export function isMarketplaceBuilding(building: BuildingRow): boolean {
  return building.name.trim().toLowerCase() === 'marketplace'
}

/** Town / Village Hall (and similar) — name match or gold_income root. */
export function isHallBuilding(building: BuildingRow): boolean {
  const name = building.name.trim().toLowerCase()
  if (name.includes('hall')) {
    return true
  }
  return building.effect_type === 'gold_income'
}

export function isLibraryBuilding(building: BuildingRow): boolean {
  return building.name.trim().toLowerCase().includes('library')
}

export function isEmptyPlaceholder(building: BuildingRow): boolean {
  return building.name.trim().toLowerCase() === 'empty'
}`,
  `export function isTavernBuilding(building: BuildingRow): boolean {
  return buildingInSlot(building, BUILDING_SLOT_TAVERN)
}

export function isMarketplaceBuilding(building: BuildingRow): boolean {
  return buildingInSlot(building, BUILDING_SLOT_MARKETPLACE)
}

/** Town / Village Hall — \`gold_income\` effect. */
export function isHallBuilding(building: BuildingRow): boolean {
  return building.effect_type.trim().toLowerCase() === 'gold_income'
}

export function isLibraryBuilding(building: BuildingRow): boolean {
  return buildingInSlot(building, BUILDING_SLOT_LIBRARY)
}

/** Catalog row that only pads an otherwise-empty slot (\`effect_type\` = \`empty_slot\`). */
export function isEmptyPlaceholder(building: BuildingRow): boolean {
  return building.effect_type.trim().toLowerCase() === 'empty_slot'
}

export function isHangerBuilding(building: BuildingRow): boolean {
  return buildingInSlot(building, BUILDING_SLOT_HANGER)
}

export function isTownUniqueSlotBuilding(building: BuildingRow): boolean {
  return buildingInSlot(building, BUILDING_SLOT_TOWN_UNIQUE)
}`,
)

s = s.replace(
  `export function isAdvancedUnit(unit: UnitRow | null | undefined): boolean {
  return (unit?.name ?? '').trim().toLowerCase().startsWith('advanced ')
}

/** Advanced counterpart by name: "Worms" → "Advanced Worms". */
export function advancedUnitFor(
  catalog: ReferenceCatalog | null | undefined,
  unit: UnitRow | null | undefined,
): UnitRow | null {
  if (!catalog || !unit || isAdvancedUnit(unit)) {
    return null
  }
  const want = \`Advanced \${unit.name.trim()}\`.toLowerCase()
  return (
    catalog.unit.find((row) => row.name.trim().toLowerCase() === want) ?? null
  )
}`,
  `/** True when another unit's \`upgrade_unit_id\` points at this row. */
export function isAdvancedUnit(
  catalog: ReferenceCatalog | null | undefined,
  unit: UnitRow | { id: number } | null | undefined,
): boolean {
  if (!catalog || !unit) {
    return false
  }
  return catalog.unit.some((row) => row.upgrade_unit_id === unit.id)
}

/** Upgrade target from \`upgrade_unit_id\` on the base unit row. */
export function advancedUnitFor(
  catalog: ReferenceCatalog | null | undefined,
  unit: UnitRow | null | undefined,
): UnitRow | null {
  if (!catalog || !unit?.upgrade_unit_id) {
    return null
  }
  return unitById(catalog, unit.upgrade_unit_id)
}`,
)

s = s.replace(
  `export function unitAutoTarget(
  unit: UnitRow | null | undefined,
): AutoTargetKind | null {
  const fromAbilities = unitAttackShape(unit).autoTarget
  if (fromAbilities) {
    return fromAbilities
  }
  const name = (unit?.name ?? '').trim().toLowerCase()
  if (name === 'siege' || name === 'catapult') {
    return 'random_wall_segment'
  }
  if (name === 'shooter') {
    return 'random_enemy'
  }
  return null
}`,
  `export function unitAutoTarget(
  unit: UnitRow | null | undefined,
  catalog?: ReferenceCatalog | null,
): AutoTargetKind | null {
  const fromAbilities = unitAttackShape(unit).autoTarget
  if (fromAbilities) {
    return fromAbilities
  }
  const cat = catalog ?? getCachedCatalog()
  if (cat && unit) {
    if (unitHasNamedTag(cat, unit, TAG_AUTO_TARGET_RANDOM_WALL)) {
      return 'random_wall_segment'
    }
    if (unitHasNamedTag(cat, unit, TAG_AUTO_TARGET_RANDOM_ENEMY)) {
      return 'random_enemy'
    }
  }
  return null
}`,
)

s = s.replace(
  `export function unitHasTag(
  unit: UnitRow | null | undefined,
  tagId: number,
): boolean {
  return Boolean(unit?.tags?.includes(tagId))
}`,
  `export { unitHasTag } from './unitTags'`,
)

s = s.replace(
  `    if (isAdvancedUnit(unit) || unitClassId(catalog, unit) !== classId) {`,
  `    if (isAdvancedUnit(catalog, unit) || unitClassId(catalog, unit) !== classId) {`,
)

const start = s.indexOf('      // Halberdier base: DB may have max_range 1')
const end = s.indexOf('      tags: asIntIds(extra.tags),')
if (start < 0 || end < 0) {
  throw new Error('unit parse markers missing')
}
const unitMid = `      max_range:
        maxRangeRaw == null || maxRangeRaw === '' ? 1 : asInt(maxRangeRaw),
      retaliation: asUnitRetaliation(extra.retaliation),
      abilities: asUnitCombatAbilities(extra.abilities),
      tags: asIntIds(extra.tags),`
s = s.slice(0, start) + unitMid + s.slice(end + '      tags: asIntIds(extra.tags),'.length)

s = s.replace(
  /const rift = unitName\.toLowerCase\(\) === 'unstable rift'\n/,
  '',
)
s = s.replace(
  /image_path: image \|\| \(rift \? 'Unstable_Rift_1\.png' : null\),\n      image_path_alt: imageAlt \|\| \(rift \? 'Silent_Rift_1\.png' : null\),/,
  `image_path: image || null,
      image_path_alt: imageAlt || null,`,
)

s = s.replace(
  /blocks_los: \(\(\) => \{[\s\S]*?\}\)\(\),/m,
  'blocks_los: asBoolFlag(extra.blocks_los),',
)

s = s.replace(
  `      upgrade_cost: asCost(
        (row as { upgrade_cost?: CostMap | Record<string, number> | null })
          .upgrade_cost,
      ),
    }
  })`,
  `      upgrade_cost: asCost(
        (row as { upgrade_cost?: CostMap | Record<string, number> | null })
          .upgrade_cost,
      ),
      upgrade_unit_id: (() => {
        const raw = (row as { upgrade_unit_id?: unknown }).upgrade_unit_id
        if (raw == null || raw === '') return null
        const id = asInt(raw)
        return id > 0 ? id : null
      })(),
    }
  })`,
)

s = s.replace(
  /\n  \{\n    const haveIds[\s\S]*?unit = \[\.\.\.unit, \.\.\.extras\]\n    \}\n  \}/m,
  '',
)

s = s.replace(
  `  }
  catalog.ability = fillDesignedAbilities(`,
  `  }
  enrichCatalogUnits(catalog)
  catalog.ability = fillDesignedAbilities(`,
)

fs.writeFileSync(catalogPath, s)
console.log('applied S9-46 catalog patches')
