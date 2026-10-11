import type { DebugSections } from '../hex/debug'
import type { WorldRenderStats } from '../hex/worldRenderChunks'
import { GameWindowModal } from './GameWindowModal'
import { GameWindowOverlay } from './GameWindowOverlay'
import type { LevelUpNotice } from '../session/xp'
import type { FixedFightKind } from '../session/fixedFight'
import type { DataStatus } from '../hex/debug'
import { DevToolsPanel } from '../options/DevToolsPanel'

type DevPopupProps = {
  open: boolean
  onClose: () => void
  sections: DebugSections
  worldPerf?: WorldRenderStats | null
  onCopyDebug: () => void
  onSeeWorld?: () => void
  onStartFixedFight?: (kind: FixedFightKind) => void
  onLevelUpNotice?: (notice: LevelUpNotice | null) => void
  onDataStatus?: (status: DataStatus) => void
  onHudNotice?: (notice: string | null) => void
  onAddStartingUnits?: () => void
  onAddWorldMobs?: () => void
  terrainWedgesDebug?: { enabled: boolean; onToggle: () => void }
  zonesDebug?: { enabled: boolean; onToggle: () => void }
  wallGapsDebug?: { enabled: boolean; onToggle: () => void }
  roadPlanDebug?: { enabled: boolean; onToggle: () => void }
  navalMaskDebug?: { enabled: boolean; onToggle: () => void }
  townHexNumbers?: { enabled: boolean; onToggle: () => void }
  aiTraces?: string[]
  inCombat?: boolean
}

export function DevPopup({
  open,
  onClose,
  sections,
  worldPerf,
  onCopyDebug,
  onSeeWorld,
  onStartFixedFight,
  onLevelUpNotice,
  onDataStatus,
  onHudNotice,
  onAddStartingUnits,
  onAddWorldMobs,
  terrainWedgesDebug,
  zonesDebug,
  wallGapsDebug,
  roadPlanDebug,
  navalMaskDebug,
  townHexNumbers,
  aiTraces = [],
  inCombat = false,
}: DevPopupProps) {
  if (!open) {
    return null
  }
  return (
    <GameWindowOverlay>
      <GameWindowModal
        aria-labelledby="dev-popup-title"
        onBackdropClick={onClose}
        className="dev-popup-modal"
      >
        <h1 id="dev-popup-title">Dev</h1>
        {aiTraces.length > 0 ? (
          <div className="dev-ai-traces">
            <h2>AI traces</h2>
            <pre className="dev-ai-traces-pre">
              {aiTraces.flatMap((block) => block.split('\n')).join('\n')}
            </pre>
          </div>
        ) : null}
        <DevToolsPanel
          onCopyDebug={onCopyDebug}
          onSeeWorld={onSeeWorld}
          onClose={onClose}
          onStartFixedFight={onStartFixedFight}
          onLevelUpNotice={onLevelUpNotice}
          onDataStatus={onDataStatus}
          onHudNotice={onHudNotice}
          inCombat={inCombat}
        />
        <div className="debug-tools dev-popup-tools">
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
          {townHexNumbers ? (
            <button type="button" onClick={townHexNumbers.onToggle}>
              Town hex numbers: {townHexNumbers.enabled ? 'On' : 'Off'}
            </button>
          ) : null}
        </div>
        {worldPerf ? (
          <pre className="debug-perf">
            {`FPS: ${worldPerf.fps.toFixed(0)}  frame: ${worldPerf.frameMs.toFixed(1)}ms  avg: ${worldPerf.avgFrameMs.toFixed(1)}ms
display objects: ${worldPerf.displayObjectsVisible} visible / ${worldPerf.displayObjectsTotal} total`}
          </pre>
        ) : null}
        <details className="debug-setup">
          <summary>Game Setup</summary>
          <pre>{sections.gameSetup}</pre>
        </details>
        {sections.rest.trim() ? (
          <pre className="debug-peek-body">{sections.rest}</pre>
        ) : null}
        <button type="button" className="date-notice-ok" onClick={onClose}>
          Close
        </button>
      </GameWindowModal>
    </GameWindowOverlay>
  )
}
