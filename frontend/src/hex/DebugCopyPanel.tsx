import type { DebugSections } from './debug'

type DebugCopyPanelProps = {
  onCopy: () => void
  sections: DebugSections
}

export function DebugCopyPanel({ onCopy, sections }: DebugCopyPanelProps) {
  return (
    <div className="debug-copy">
      <button type="button" onClick={onCopy}>
        Copy Debug
      </button>
      <div className="debug-peek">
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
