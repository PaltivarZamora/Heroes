import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { clearCachedGrid } from '../hex/HexMap'
import type { DataStatus } from '../hex/debug'
import {
  createSave,
  deleteSave,
  fetchSave,
  isGameSession,
  listSaves,
  type SaveSummary,
} from '../session/saves'
import { syncGameDifficultyFromSession } from '../session/gameDifficulty'
import { getSession, setSession } from '../session/store'
import type { GameSession } from '../session/types'
import { normalizeHeroProgress } from '../session/accessors'
import { type LevelUpNotice } from '../session/xp'
import { refreshCatalogFromDb } from '../town/catalog'
import { NewGameScreen } from './NewGameScreen'
import type { GameConfig } from './gameConfig'
import { getExploredHexes } from '../hex/world'
import type { HexScaleName } from '../hex/hexScale'
import type { FixedFightKind } from '../session/fixedFight'
import { GameWindowModal } from '../layout/GameWindowModal'

type Panel = 'new' | 'save' | 'load' | 'quit' | 'restart' | null

type OptionsMenuProps = {
  onLoaded: () => void
  onDataStatus: (status: DataStatus) => void
  onCopyDebug: () => void
  onStartGame: (config: GameConfig) => void
  mapGenerating?: boolean
  /** Clears a stuck "Generating map…" state when reopening New Game. */
  onPrepareNewGame?: () => void
  onLevelUpNotice: (notice: LevelUpNotice | null) => void
  /** Lift green status into the map HUD gap (between End Turn and Debug). */
  onHudNotice?: (notice: string | null) => void
  /** Debug Fixed Fight scenarios (starts combat). */
  onStartFixedFight?: (kind: FixedFightKind) => void
  /** Opens map view with full fog lifted (debug). */
  onSeeWorld?: () => void
  hexScale: HexScaleName
  onHexScale: (name: HexScaleName) => void
  /** Headless: only save/load/new/quit/restart panels (no flyout). */
  hideToggle?: boolean
  /** Parent-driven panel (Main Menu). */
  flowPanel?: Panel
  onFlowPanelChange?: (panel: Panel | null) => void
}

function withCurrentFog(session: GameSession): GameSession {
  const explored = getExploredHexes()
  const index =
    typeof session.activePlayerIndex === 'number' &&
    session.activePlayerIndex >= 0 &&
    session.activePlayerIndex < session.players.length
      ? session.activePlayerIndex
      : 0
  return {
    ...session,
    activePlayerIndex: index,
    players: session.players.map((player, i) =>
      i === index
        ? { ...player, explored, eliminated: player.eliminated === true }
        : {
            ...player,
            explored: Array.isArray(player.explored) ? player.explored : [],
            eliminated: player.eliminated === true,
          },
    ),
  }
}

function normalizeRecruitsKnowledge(
  raw: unknown,
): Record<string, { unit_id: number; stock: number }> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  const out: Record<string, { unit_id: number; stock: number }> = {}
  for (const [playerId, entry] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (entry === true) {
      // Legacy seen_by_player boolean — treat as unknown unit until next visit.
      continue
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue
    }
    const rec = entry as { unit_id?: unknown; stock?: unknown }
    const unitId = Math.floor(Number(rec.unit_id))
    const stock = Math.floor(Number(rec.stock))
    if (!(unitId > 0) || !(stock >= 0)) {
      continue
    }
    out[playerId] = { unit_id: unitId, stock: Math.max(0, stock) }
  }
  return out
}

function withExploredDefaults(session: GameSession): GameSession {
  return normalizeHeroProgress({
    ...session,
    features: Array.isArray(session.features)
      ? session.features.map((row) =>
          row.kind === 'recruits'
            ? {
                ...row,
                unit_id:
                  typeof row.unit_id === 'number' && row.unit_id > 0
                    ? row.unit_id
                    : 0,
                stock:
                  typeof row.stock === 'number' && row.stock > 0
                    ? Math.floor(row.stock)
                    : 0,
                known_by_player: normalizeRecruitsKnowledge(
                  (row as { known_by_player?: unknown; seen_by_player?: unknown })
                    .known_by_player ??
                    (row as { seen_by_player?: unknown }).seen_by_player,
                ),
              }
            : row,
        )
      : [],
    boats: Array.isArray(session.boats) ? session.boats : [],
    activePlayerIndex:
      typeof session.activePlayerIndex === 'number' &&
      session.activePlayerIndex >= 0 &&
      session.activePlayerIndex < session.players.length
        ? session.activePlayerIndex
        : 0,
    players: session.players.map((player) => ({
      ...player,
      is_ai: player.is_ai === true,
      ai_spectator: player.ai_spectator === true,
      arch_id:
        typeof player.arch_id === 'number' && player.arch_id > 0
          ? player.arch_id
          : 1,
      eliminated: player.eliminated === true,
      explored: Array.isArray(player.explored) ? player.explored : [],
    })),
    heroes: session.heroes.map((hero) => ({
      ...hero,
      learned_abilities: Array.isArray(hero.learned_abilities)
        ? hero.learned_abilities
        : [],
      used_abilities_this_battle: Array.isArray(hero.used_abilities_this_battle)
        ? hero.used_abilities_this_battle
        : [],
      used_abilities_today: Array.isArray(hero.used_abilities_today)
        ? hero.used_abilities_today
        : [],
      arch_id:
        typeof hero.arch_id === 'number' && hero.arch_id > 0 ? hero.arch_id : null,
      travel_facing:
        hero.travel_facing === 'left' || hero.travel_facing === 'right'
          ? hero.travel_facing
          : 'right',
    })),
    building_states: session.building_states.map((row) => ({
      ...row,
      offered_abilities: Array.isArray(row.offered_abilities)
        ? row.offered_abilities
        : [],
    })),
  })
}

function defaultSaveName(): string {
  const session = getSession()
  const name = session.game.name?.trim()
  if (name) {
    return name
  }
  return session.game.seed > 0 ? `Random ${session.game.seed}` : 'Test Game'
}

function formatCreated(iso: string | null): string {
  if (!iso) {
    return 'unknown date'
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  return date.toLocaleString()
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback
}

export function OptionsMenu({
  onLoaded,
  onDataStatus: _onDataStatus,
  onCopyDebug: _onCopyDebug,
  onStartGame,
  mapGenerating = false,
  onPrepareNewGame,
  onLevelUpNotice: _onLevelUpNotice,
  onHudNotice,
  onStartFixedFight: _onStartFixedFight,
  onSeeWorld: _onSeeWorld,
  hexScale: _hexScale,
  onHexScale: _onHexScale,
  hideToggle = false,
  flowPanel,
  onFlowPanelChange,
}: OptionsMenuProps) {
  const [expanded, setExpanded] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [saveName, setSaveName] = useState('')
  const [saves, setSaves] = useState<SaveSummary[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const saveNameRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!notice) {
      return
    }
    const timer = window.setTimeout(() => setNotice(null), 2500)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    onHudNotice?.(notice)
  }, [notice, onHudNotice])

  useEffect(() => {
    if (!expanded) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const root = menuRef.current
      if (!root || !(event.target instanceof Node)) {
        return
      }
      if (!root.contains(event.target)) {
        setExpanded(false)
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [expanded])

  /** Close after a real pick; leave flyout parents open so their submenu can be used. */
  const closeAfterMenuPick = (event: MouseEvent) => {
    const btn = (event.target as HTMLElement).closest('button[role="menuitem"]')
    if (!(btn instanceof HTMLButtonElement) || btn.disabled) {
      return
    }
    const isFlyoutParent =
      btn.getAttribute('aria-haspopup') === 'true' &&
      !btn.closest('.options-submenu')
    if (isFlyoutParent) {
      return
    }
    setExpanded(false)
  }

  // Focus the save-name field when Save Game opens (autoFocus fails while busy).
  useEffect(() => {
    if (panel !== 'save') {
      return
    }
    const timer = window.setTimeout(() => {
      const input = saveNameRef.current
      if (!input || input.disabled) {
        return
      }
      input.focus()
      input.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [panel, busy])

  const closePanel = () => {
    if (busy) {
      return
    }
    setPanel(null)
    setError(null)
    onFlowPanelChange?.(null)
  }

  const openPanel = (next: Panel) => {
    setExpanded(false)
    setError(null)
    setBusy(false)
    setPanel(next)
    if (next === 'new') {
      onPrepareNewGame?.()
    }
    if (next === 'save') {
      setSaveName(defaultSaveName())
      setSelectedId(null)
      setSaves([])
      setBusy(true)
    }
    if (next === 'load') {
      setSelectedId(null)
      setSaves([])
      setBusy(true)
    }
  }

  useEffect(() => {
    if (!flowPanel) {
      return
    }
    openPanel(flowPanel)
    onFlowPanelChange?.(null)
  }, [flowPanel, onFlowPanelChange])

  useEffect(() => {
    if (panel !== 'load' && panel !== 'save') {
      return
    }
    let cancelled = false
    setBusy(true)
    void listSaves()
      .then((rows) => {
        if (!cancelled) {
          setSaves(rows)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(errorMessage(err, 'Could not load saved games'))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [panel])

  useEffect(() => {
    if (panel == null) {
      return
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        closePanel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel, busy])

  const onSave = async () => {
    const name = saveName.trim()
    if (!name) {
      setError('A game name is required.')
      return
    }
    setBusy(true)
    setError(null)
    const current = getSession()
    const snapshot = withCurrentFog({
      ...current,
      game: { ...current.game, name },
    })
    try {
      await createSave(name, snapshot.game.seed, snapshot)
      setSession(snapshot)
      setPanel(null)
    } catch (err: unknown) {
      setError(errorMessage(err, 'Could not save the game'))
    } finally {
      setBusy(false)
    }
  }

  const onLoad = async () => {
    if (selectedId == null) {
      setError('Select a saved game.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const detail = await fetchSave(selectedId)
      if (!isGameSession(detail.gameState)) {
        throw new Error('That save is corrupt and was not loaded.')
      }
      try {
        await refreshCatalogFromDb()
      } catch {
        // Load the save even if the catalog refresh fails.
      }
      const loaded = withExploredDefaults(detail.gameState)
      setSession(loaded)
      syncGameDifficultyFromSession(loaded)
      clearCachedGrid()
      setPanel(null)
      onLoaded()
    } catch (err: unknown) {
      setError(errorMessage(err, 'Could not load that save'))
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async () => {
    if (selectedId == null) {
      setError('Select a saved game.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await deleteSave(selectedId)
      setSaves((rows) => rows.filter((row) => row.id !== selectedId))
      setSelectedId(null)
    } catch (err: unknown) {
      setError(errorMessage(err, 'Could not delete that save'))
    } finally {
      setBusy(false)
    }
  }

  const onQuitYes = () => {
    window.location.reload()
  }

  const onRestartYes = () => {
    window.location.reload()
  }

  void _onDataStatus
  void _onCopyDebug
  void _onLevelUpNotice
  void _onStartFixedFight
  void _onSeeWorld

  return (
    <div
      className={`options-menu${hideToggle ? ' options-menu-headless' : ''}`}
      ref={menuRef}
    >
      {hideToggle ? null : (
        <button
          type="button"
          className="options-toggle"
          aria-expanded={expanded}
          aria-haspopup="true"
          onClick={() => setExpanded(!expanded)}
        >
          Options
        </button>
      )}
      {!hideToggle && expanded ? (
        <div
          className="options-choices"
          role="menu"
          onClick={closeAfterMenuPick}
        >
          <button type="button" role="menuitem" onClick={() => openPanel('new')}>
            New Game
          </button>
          <button type="button" role="menuitem" onClick={() => openPanel('load')}>
            Load Game
          </button>
          <button type="button" role="menuitem" onClick={() => openPanel('save')}>
            Save Game
          </button>
          <button type="button" role="menuitem" onClick={() => openPanel('quit')}>
            Quit
          </button>
        </div>
      ) : null}

      {panel === 'new' ? (
        <div className="game-window-embed">
          <GameWindowModal
            aria-labelledby="new-game-title"
            onBackdropClick={closePanel}
            className="new-game-modal"
          >
            <NewGameScreen
              embedded
              generating={mapGenerating}
              onClose={closePanel}
              onStartGame={(config) => {
                onStartGame(config)
                closePanel()
              }}
            />
          </GameWindowModal>
        </div>
      ) : null}

      {panel === 'save' ? (
        <div className="game-window-embed">
        <GameWindowModal aria-labelledby="save-title" onBackdropClick={closePanel}>
          <div className="options-dialog">
            <h2 id="save-title">Save Game</h2>
            <label className="options-field">
              Game Name
              <input
                ref={saveNameRef}
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') {
                    return
                  }
                  event.preventDefault()
                  if (!busy) {
                    void onSave()
                  }
                }}
                autoFocus
              />
            </label>
            {saves.some((row) => row.name === saveName.trim()) ? (
              <p className="options-empty">Saving will overwrite the existing game with this name.</p>
            ) : null}
            {saves.length > 0 ? (
              <ul className="options-save-list">
                {saves.map((row) => (
                  <li key={row.id}>
                    <label>
                      <input
                        type="radio"
                        name="saved-game-save"
                        checked={selectedId === row.id}
                        onChange={() => {
                          setSelectedId(row.id)
                          setSaveName(row.name)
                        }}
                        disabled={busy}
                      />
                      <span>
                        <strong>{row.name}</strong>
                        <em>{formatCreated(row.updatedAt ?? row.createdAt)}</em>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
            {error ? (
              <p className="options-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="options-actions">
              <button type="button" disabled={busy} onClick={() => void onSave()}>
                {busy ? 'Saving…' : 'OK'}
              </button>
              <button
                type="button"
                disabled={busy || selectedId == null}
                onClick={() => void onDelete()}
              >
                Delete
              </button>
              <button type="button" disabled={busy} onClick={closePanel}>
                Cancel
              </button>
            </div>
          </div>
        </GameWindowModal>
        </div>
      ) : null}

      {panel === 'load' ? (
        <div className="game-window-embed">
        <GameWindowModal aria-labelledby="load-title" onBackdropClick={closePanel}>
          <div className="options-dialog">
            <h2 id="load-title">Load Game</h2>
            {saves.length === 0 && !busy && !error ? (
              <p className="options-empty">No saved games yet.</p>
            ) : (
              <ul className="options-save-list">
                {saves.map((row) => (
                  <li key={row.id}>
                    <label>
                      <input
                        type="radio"
                        name="saved-game"
                        checked={selectedId === row.id}
                        onChange={() => setSelectedId(row.id)}
                        disabled={busy}
                      />
                      <span>
                        <strong>{row.name}</strong>
                        <em>{formatCreated(row.updatedAt ?? row.createdAt)}</em>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {error ? (
              <p className="options-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="options-actions">
              <button type="button" disabled={busy} onClick={() => void onLoad()}>
                {busy ? 'Loading…' : 'OK'}
              </button>
              <button
                type="button"
                disabled={busy || selectedId == null}
                onClick={() => void onDelete()}
              >
                Delete
              </button>
              <button type="button" disabled={busy} onClick={closePanel}>
                Cancel
              </button>
            </div>
          </div>
        </GameWindowModal>
        </div>
      ) : null}

      {panel === 'quit' ? (
        <div className="game-window-embed">
        <GameWindowModal aria-labelledby="quit-title" onBackdropClick={closePanel}>
          <div className="options-dialog">
            <h2 id="quit-title">Are you sure?</h2>
            <div className="options-actions">
              <button type="button" onClick={onQuitYes}>
                Yes
              </button>
              <button type="button" onClick={closePanel}>
                No
              </button>
            </div>
          </div>
        </GameWindowModal>
        </div>
      ) : null}

      {panel === 'restart' ? (
        <div className="game-window-embed">
        <GameWindowModal aria-labelledby="restart-title" onBackdropClick={closePanel}>
          <div className="options-dialog">
            <h2 id="restart-title">Restart the game?</h2>
            <div className="options-actions">
              <button type="button" onClick={onRestartYes}>
                Yes
              </button>
              <button type="button" onClick={closePanel}>
                No
              </button>
            </div>
          </div>
        </GameWindowModal>
        </div>
      ) : null}
    </div>
  )
}
