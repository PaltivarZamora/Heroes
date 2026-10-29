import type { ReferenceCatalog, StatShredTarget } from '../town/catalog'
import { statById } from '../town/statCatalog'

export function targetLabel(
  catalog: ReferenceCatalog,
  target: StatShredTarget,
): string {
  switch (target) {
    case 'phys_dmg':
      return 'Phys Dmg'
    case 'magic_dmg':
      return 'Magic Dmg'
    case 'max_hp':
      return 'Max HP'
    case 'crit':
      return 'Crit'
    case 'speed':
      return statById(catalog, 1)?.name ?? 'Speed'
    case 'defense':
      return statById(catalog, 4)?.name ?? 'Defense'
    case 'resistance':
      return statById(catalog, 5)?.name ?? 'Resistance'
    default:
      return 'Stat'
  }
}
