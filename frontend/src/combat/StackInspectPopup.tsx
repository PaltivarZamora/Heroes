import type { CombatBattle, CombatSide, CombatStack } from './battle'
import type { ReferenceCatalog } from '../town/catalog'
import type { CombatHeroes } from './attack'
import { inspectActiveEffects, inspectRows } from './inspect'

type StackInspectPopupProps = {
  catalog: ReferenceCatalog
  stack: CombatStack
  viewerSide?: CombatSide | null
  battle?: CombatBattle
  heroes?: CombatHeroes
  onClose: () => void
}

export function StackInspectPopup({
  catalog,
  stack,
  viewerSide,
  battle,
  heroes,
  onClose,
}: StackInspectPopupProps) {
  const rows = inspectRows(stack, catalog, viewerSide, battle, heroes)
  const effects = inspectActiveEffects(
    stack,
    catalog,
    viewerSide,
    battle,
    heroes,
  )
  const title = rows.find((row) => row.label === 'name')?.value ?? 'Stack'
  return (
    <div
      className="combat-hero-popup combat-inspect-popup"
      role="dialog"
      aria-modal="true"
      aria-labelledby="combat-inspect-title"
      onClick={onClose}
    >
      <div
        className="combat-hero-popup-card combat-inspect-card"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="combat-hero-popup-close"
          aria-label="Close"
          onClick={onClose}
        >
          ×
        </button>
        <h2 id="combat-inspect-title">{title}</h2>
        {effects.length > 0 ? (
          <section className="combat-inspect-conditions" aria-label="Active effects">
            <h3>Active effects</h3>
            <ul>
              {effects.map((row) => (
                <li key={`${row.label}:${row.value}`}>
                  <span>{row.label}</span>
                  <span>{row.value}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <dl className="combat-inspect-stats">
          {rows.map((row) => (
            <div key={row.label} className="combat-inspect-row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
