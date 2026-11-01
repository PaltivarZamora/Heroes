import { GameWindowModal } from './GameWindowModal'
import { GameWindowOverlay } from './GameWindowOverlay'
import { devToolsEnabled } from '../settings/playerSettings'

export type MainMenuFlow = 'new' | 'load' | 'save' | 'restart' | 'quit' | null

type MainMenuProps = {
  open: boolean
  inBattle: boolean
  /** False at title screen before New Game / Load. */
  gameRunning: boolean
  onClose: () => void
  onFlow: (flow: MainMenuFlow) => void
  onSettings: () => void
  onDev: () => void
}

export function MainMenu({
  open,
  inBattle,
  gameRunning,
  onClose,
  onFlow,
  onSettings,
  onDev,
}: MainMenuProps) {
  if (!open) {
    return null
  }
  const dev = devToolsEnabled()
  const menuLocked = !gameRunning
  const tryClose = () => {
    if (!menuLocked) {
      onClose()
    }
  }
  return (
    <GameWindowOverlay>
      <GameWindowModal aria-labelledby="main-menu-title" onBackdropClick={tryClose}>
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
            disabled={inBattle || !gameRunning}
            title={
              inBattle
                ? 'Not available during battle'
                : !gameRunning
                  ? 'Start or load a game first'
                  : undefined
            }
            onClick={() => onFlow('save')}
          >
            Save Game
          </button>
          <button
            type="button"
            disabled={!gameRunning}
            title={!gameRunning ? 'Start or load a game first' : undefined}
            onClick={() => onFlow('restart')}
          >
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
        {menuLocked ? null : (
          <button type="button" className="date-notice-ok" onClick={tryClose}>
            Close
          </button>
        )}
      </GameWindowModal>
    </GameWindowOverlay>
  )
}
