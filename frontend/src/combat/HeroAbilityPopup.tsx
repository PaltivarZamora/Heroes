import { useEffect, useState } from 'react'
import type { AbilityRow, ReferenceCatalog } from '../town/catalog'
import { formatHeroLevelLine, heroTypeName } from '../town/catalog'
import { classDisciplines } from '../town/libraryRules'
import { HeroAbilitiesPanel } from '../town/HeroAbilitiesPanel'
import type { Hero } from '../session/types'
import {
  canAffordAbility,
  disciplineResourceId,
  poolCurrent,
  poolMax,
  resourceLabel,
} from './heroCast'

type HeroAbilityPopupProps = {
  catalog: ReferenceCatalog
  hero: Hero
  learned: number[]
  onCancel: () => void
  onChoose: (ability: AbilityRow) => void
}

export function HeroAbilityPopup({
  catalog,
  hero,
  learned,
  onCancel,
  onChoose,
}: HeroAbilityPopupProps) {
  const disciplines = classDisciplines(catalog, hero.class_id ?? -1)
  const [disciplineId, setDisciplineId] = useState<number | null>(
    disciplines[0]?.id ?? null,
  )

  useEffect(() => {
    if (disciplines.length === 0) {
      setDisciplineId(null)
      return
    }
    if (disciplineId != null && disciplines.some((row) => row.id === disciplineId)) {
      return
    }
    setDisciplineId(disciplines[0]?.id ?? null)
  }, [disciplineId, disciplines])

  const typeName = heroTypeName(catalog, hero.class_id)
  const title = typeName ? `${typeName} Abilities` : 'Abilities'
  const resourceId =
    disciplineId != null ? disciplineResourceId(catalog, disciplineId) : null
  const resourceName =
    resourceId != null ? resourceLabel(catalog, resourceId) : ''
  const current = resourceId != null ? poolCurrent(hero, resourceId) : 0
  const max = resourceId != null ? poolMax(catalog, hero, resourceId) : 0

  return (
    <div
      className="combat-hero-popup"
      role="dialog"
      aria-modal="true"
      aria-labelledby="combat-hero-popup-title"
    >
      <div className="combat-hero-popup-card" data-tip-contain="">
        <button
          type="button"
          className="combat-hero-popup-close"
          aria-label="Close"
          onClick={onCancel}
        >
          ×
        </button>
        <h2 id="combat-hero-popup-title">{title}</h2>
        <p className="combat-hero-popup-identity">
          {formatHeroLevelLine(catalog, hero.name, hero.current_level, hero.current_xp)}
        </p>
        {resourceId != null ? (
          <div
            className="combat-hero-resource"
            data-resource={resourceId === 1 ? 'energy' : 'mana'}
            aria-label={`${resourceName} pool`}
          >
            <span
              className="combat-hero-resource-fill"
              style={{
                width: `${max > 0 ? Math.min(100, Math.max(0, (current / max) * 100)) : 0}%`,
              }}
            />
            <span className="combat-hero-resource-text">
              {resourceName} {current} / {max}
            </span>
          </div>
        ) : null}
        <HeroAbilitiesPanel
          catalog={catalog}
          learned={learned}
          disciplines={disciplines}
          disciplineId={disciplineId}
          onDisciplineId={setDisciplineId}
          onSelectAbility={onChoose}
          canSelectAbility={(ability) => canAffordAbility(hero, ability)}
        />
      </div>
    </div>
  )
}
