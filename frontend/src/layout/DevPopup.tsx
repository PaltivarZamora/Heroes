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

export function DevPopup(props: DevPopupProps) {
  if (!props.open) {
    return null
  }
  return (
    <GameWindowOverlay>
      <GameWindowModal
        aria-labelledby="dev-popup-title"
        onBackdropClick={props.onClose}
        className="dev-popup-modal"
      >
        <h1 id="dev-popup-title">Dev</h1>
        <DevToolsPanel
          sections={props.sections}
          worldPerf={props.worldPerf}
          onCopyDebug={props.onCopyDebug}
          onSeeWorld={props.onSeeWorld}
          onClose={props.onClose}
          onStartFixedFight={props.onStartFixedFight}
          onLevelUpNotice={props.onLevelUpNotice}
          onDataStatus={props.onDataStatus}
          onHudNotice={props.onHudNotice}
          onAddStartingUnits={props.onAddStartingUnits}
          onAddWorldMobs={props.onAddWorldMobs}
          terrainWedgesDebug={props.terrainWedgesDebug}
          zonesDebug={props.zonesDebug}
          wallGapsDebug={props.wallGapsDebug}
          roadPlanDebug={props.roadPlanDebug}
          navalMaskDebug={props.navalMaskDebug}
          townHexNumbers={props.townHexNumbers}
          aiTraces={props.aiTraces}
          inCombat={props.inCombat}
        />
      </GameWindowModal>
    </GameWindowOverlay>
  )
}
