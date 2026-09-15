import type { DebugSections } from './debug'

type DebugCopyPanelProps = {
  sections: DebugSections
  /** Map HUD only — mid-game debug tools relocated from Options. */
  onAddStartingUnits?: () => void
  onAddWorldMobs?: () => void
}

export function DebugCopyPanel({
  sections,
  onAddStartingUnits,
  onAddWorldMobs,
}: DebugCopyPanelProps) {
  const hasTools = onAddStartingUnits != null || onAddWorldMobs != null
  return (
    <div className="debug-copy">
      <button type="button" className="debug-panel-toggle">
        Debug
      </button>
      <div className="debug-peek">
        {hasTools ? (
          <div className="debug-tools">
            {onAddStartingUnits ? (
              <button type="button" onClick={onAddStartingUnits}>
                Add Starting Units
              </button>
            ) : null}
            {onAddWorldMobs ? (
              <button type="button" onClick={onAddWorldMobs}>
                Add World Mobs to Current Map
              </button>
            ) : null}
          </div>
        ) : null}
        <details className="debug-setup">
          <summary>
            <span className="debug-setup-closed">
              Game Setup (currently hidden)
            </span>
            <span className="debug-setup-open">Game Setup</span>
          </summary>
          <pre>{sections.gameSetup}</pre>
        </details>
        {sections.rest.trim() ? (
          <pre className="debug-peek-body">{sections.rest}</pre>
        ) : null}
      </div>
    </div>
  )
}
