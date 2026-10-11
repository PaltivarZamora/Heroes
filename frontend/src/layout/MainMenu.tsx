import { GameWindowModal } from './GameWindowModal'
import { GameWindowOverlay } from './GameWindowOverlay'
import { devToolsEnabled } from '../settings/playerSettings'

export type MainMenuFlow = 'new' | 'load' | 'save' | 'restart' | 'quit' | null

type MainMenuProps = {
  open: boolean
  inBattle: boolean
  onClose: () => void
  onFlow: (flow: MainMenuFlow) => void
  onSettings: () => void
  onDev: () => void
}

export function MainMenu({
  open,
  inBattle,
  onClose,
  onFlow,
  onSettings,
  onDev,
}: MainMenuProps) {
  if (!open) {
    return null
  }
  const dev = devToolsEnabled()
  return (
    <GameWindowOverlay>
      <GameWindowModal aria-labelledby="main-menu-title" onBackdropClick={onClose}>
        <h1 id="main-menu-title">Main Menu</h1>
        <div className="main-menu-section">
          <p className="main-menu-heading">Game</p>
          <button type="button" onClick={() => onFlow('new')}>New Game</button>
          <button
            type="button"
            disabled={inBattle}
            title={inBattle ? 'Not available during battle' : undefined}
            onClick={() => onFlow('load')}
          >
            Load Game
          </button>
          <button
            type="button"
            disabled={inBattle}
            title={inBattle ? 'Not available during battle' : undefined}
            onClick={() => onFlow('save')}
          >
            Save Game
          </button>
          <button type="button" onClick={() => onFlow('restart')}>
            Restart
          </button>
        </div>
        <div className="main-menu-section">
          <button type="button" onClick={onSettings}>Settings</button>
          {dev ? (
            <button type="button" onClick={onDev}>Dev</button>
          ) : null}
          <button type="button" onClick={() => onFlow('quit')}>Quit</button>
        </div>
        <button type="button" className="date-notice-ok" onClick={onClose}>
          Close
        </button>
      </GameWindowModal>
    </GameWindowOverlay>
  )
}
