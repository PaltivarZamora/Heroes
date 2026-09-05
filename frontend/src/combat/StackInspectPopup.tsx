import type { CombatStack } from './battle'
import type { ReferenceCatalog } from '../town/catalog'
import { inspectRows } from './inspect'

type StackInspectPopupProps = {
  catalog: ReferenceCatalog
  stack: CombatStack
  onClose: () => void
}

export function StackInspectPopup({
  catalog,
  stack,
  onClose,
}: StackInspectPopupProps) {
  const rows = inspectRows(stack, catalog)
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
