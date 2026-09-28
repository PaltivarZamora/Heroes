import type { DebugSections } from './debug'
import type { WorldRenderStats } from './worldRenderChunks'

type DebugCopyPanelProps = {
  sections: DebugSections
  /** Map HUD only — mid-game debug tools relocated from Options. */
  onAddStartingUnits?: () => void
  onAddWorldMobs?: () => void
  /** Combat naval (BR S9-12): tint hexes by mask kind. */
  navalMaskDebug?: {
    enabled: boolean
    onToggle: () => void
  }
  /** World map: toggle terrain transition wedge drawing. */
  terrainWedgesDebug?: {
    enabled: boolean
    onToggle: () => void
  }
  zonesDebug?: {
    enabled: boolean
    onToggle: () => void
  }
  wallGapsDebug?: {
    enabled: boolean
    onToggle: () => void
  }
  roadPlanDebug?: {
    enabled: boolean
    onToggle: () => void
  }
  /** World map render perf (BR S9-16). */
  worldPerf?: WorldRenderStats | null
}

export function DebugCopyPanel({
  sections,
  onAddStartingUnits,
  onAddWorldMobs,
  navalMaskDebug,
  terrainWedgesDebug,
  zonesDebug,
  wallGapsDebug,
  roadPlanDebug,
  worldPerf,
}: DebugCopyPanelProps) {
  const hasTools =
    onAddStartingUnits != null ||
    onAddWorldMobs != null ||
    navalMaskDebug != null ||
    terrainWedgesDebug != null ||
    zonesDebug != null ||
    wallGapsDebug != null ||
    roadPlanDebug != null
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
            {terrainWedgesDebug ? (
              <button type="button" onClick={terrainWedgesDebug.onToggle}>
                Terrain Wedges: {terrainWedgesDebug.enabled ? 'On' : 'Off'}
              </button>
            ) : null}
            {zonesDebug ? (
              <button type="button" onClick={zonesDebug.onToggle}>
                Zones: {zonesDebug.enabled ? 'On' : 'Off'}
              </button>
            ) : null}
            {wallGapsDebug ? (
              <button type="button" onClick={wallGapsDebug.onToggle}>
                Wall gaps: {wallGapsDebug.enabled ? 'On' : 'Off'}
              </button>
            ) : null}
            {roadPlanDebug ? (
              <button type="button" onClick={roadPlanDebug.onToggle}>
                Road plan: {roadPlanDebug.enabled ? 'On' : 'Off'}
              </button>
            ) : null}
            {navalMaskDebug ? (
              <button type="button" onClick={navalMaskDebug.onToggle}>
                Naval Mask: {navalMaskDebug.enabled ? 'On' : 'Off'}
              </button>
            ) : null}
          </div>
        ) : null}
        {worldPerf ? (
          <pre className="debug-perf">
            {`FPS: ${worldPerf.fps.toFixed(0)}  frame: ${worldPerf.frameMs.toFixed(1)}ms  avg: ${worldPerf.avgFrameMs.toFixed(1)}ms
last move-step repaint: ${worldPerf.lastRepaintMs.toFixed(1)}ms
display objects: ${worldPerf.displayObjectsVisible} visible / ${worldPerf.displayObjectsTotal} total
explored: ${worldPerf.exploredHexes}  chunks: ${worldPerf.visibleChunks} vis / ${worldPerf.bakedChunks} baked (${worldPerf.chunkSize}×${worldPerf.chunkSize})`}
          </pre>
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