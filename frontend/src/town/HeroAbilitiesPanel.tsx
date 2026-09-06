import type { AbilityRow, DisciplineRow, ReferenceCatalog } from './catalog'
import { abilityTooltip } from './catalog'
import {
  LIBRARY_TIERS,
  learnedAbilitiesAtTier,
  tierLabel,
} from './libraryRules'
import { AbilityTip } from './AbilityTip'

type HeroAbilitiesPanelProps = {
  catalog: ReferenceCatalog
  learned: number[]
  disciplines: DisciplineRow[]
  disciplineId: number | null
  onDisciplineId: (id: number) => void
  /** When set, learned names are click-to-cast buttons. */
  onSelectAbility?: (ability: AbilityRow) => void
  /** Unaffordable / cooldown-locked abilities are listed but cannot be selected. */
  canSelectAbility?: (ability: AbilityRow) => boolean
  /** Shown on a disabled cast button; cooldown text must not reuse afford messaging. */
  unavailableMessage?: (ability: AbilityRow) => string | null
}

export function HeroAbilitiesPanel({
  catalog,
  learned,
  disciplines,
  disciplineId,
  onDisciplineId,
  onSelectAbility,
  canSelectAbility,
  unavailableMessage,
}: HeroAbilitiesPanelProps) {
  return (
    <>
      {disciplines.length > 0 ? (
        <div
          className={
            disciplines.length === 1
              ? 'hero-discipline-tabs hero-discipline-tabs-solo'
              : 'hero-discipline-tabs'
          }
        >
          {disciplines.map((discipline) => (
            <button
              key={discipline.id}
              type="button"
              className={discipline.id === disciplineId ? 'active' : undefined}
              onClick={() => onDisciplineId(discipline.id)}
            >
              {discipline.name}
            </button>
          ))}
        </div>
      ) : null}
      {disciplineId != null
        ? LIBRARY_TIERS.map((level) => {
            const rows = learnedAbilitiesAtTier(
              catalog,
              learned,
              disciplineId,
              level,
            )
            return (
              <div key={level} className="hero-ability-tier">
                <h3>{tierLabel(catalog, level)}</h3>
                {rows.length === 0 ? (
                  <p className="hero-ability-empty">None learned</p>
                ) : (
                  <ul
                    className={
                      onSelectAbility
                        ? `hero-ability-list hero-ability-list-cast hero-ability-list-tier-${level}`
                        : 'hero-ability-list'
                    }
                  >
                    {rows.map((ability) => {
                      const allowed =
                        canSelectAbility == null || canSelectAbility(ability)
                      const lock = !allowed
                        ? (unavailableMessage?.(ability) ?? null)
                        : null
                      const label = onSelectAbility
                        ? `${ability.name} (${ability.cost})`
                        : ability.name
                      return (
                        <li key={ability.id}>
                          <AbilityTip description={abilityTooltip(catalog, ability)}>
                            {onSelectAbility ? (
                              <button
                                type="button"
                                className="hero-ability-name"
                                disabled={!allowed}
                                onClick={() => {
                                  if (allowed) {
                                    onSelectAbility(ability)
                                  }
                                }}
                              >
                                {label}
                                {lock ? (
                                  <span className="hero-ability-lock">{lock}</span>
                                ) : null}
                              </button>
                            ) : (
                              <span className="hero-ability-name">{label}</span>
                            )}
                          </AbilityTip>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })
        : null}
    </>
  )
}
