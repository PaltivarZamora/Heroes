import { useEffect, useState } from 'react'
import { clearCachedGrid, setHeroMovementRemaining } from '../hex/HexMap'
import { MAX_MOVEMENT_POINTS } from '../hex/hero'
import type { DataStatus } from '../hex/debug'
import {
  createSave,
  fetchSave,
  isGameSession,
  listSaves,
  type SaveSummary,
} from '../session/saves'
import { getSession, setSession } from '../session/store'
import { HUMAN_PLAYER_ID, type GameSession } from '../session/types'
import { fetchCatalog, reloadReferenceData } from '../town/catalog'
import { getExploredHexes } from '../hex/world'

type Panel = 'save' | 'load' | 'quit' | null

type OptionsMenuProps = {
  onLoaded: () => void
  onDataStatus: (status: DataStatus) => void
}

function withCurrentFog(session: GameSession): GameSession {
  const explored = getExploredHexes()
  return {
    ...session,
    players: session.players.map((player) =>
      player.id === HUMAN_PLAYER_ID
        ? { ...player, explored }
        : { ...player, explored: player.explored ?? [] },
    ),
  }
}

function withExploredDefaults(session: GameSession): GameSession {
  return {
    ...session,
    players: session.players.map((player) => ({
      ...player,
      explored: Array.isArray(player.explored) ? player.explored : [],
    })),
  }
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

export function OptionsMenu({ onLoaded, onDataStatus }: OptionsMenuProps) {
  const [expanded, setExpanded] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [saveName, setSaveName] = useState('')
  const [saves, setSaves] = useState<SaveSummary[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!notice) {
      return
    }
    const timer = window.setTimeout(() => setNotice(null), 2500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const closePanel = () => {
    if (busy) {
      return
    }
    setPanel(null)
    setError(null)
  }

  const openPanel = (next: Panel) => {
    if (reloading) {
      return
    }
    setExpanded(false)
    setError(null)
    setBusy(false)
    setPanel(next)
    if (next === 'save') {
      setSaveName(defaultSaveName())
    }
    if (next === 'load') {
      setSelectedId(null)
      setSaves([])
      setBusy(true)
    }
  }

  useEffect(() => {
    if (panel !== 'load') {
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
      setSession(withExploredDefaults(detail.gameState))
      clearCachedGrid()
      setPanel(null)
      onLoaded()
    } catch (err: unknown) {
      setError(errorMessage(err, 'Could not load that save'))
    } finally {
      setBusy(false)
    }
  }

  const onQuitYes = () => {
    window.location.reload()
  }

  const onReloadReference = async () => {
    if (reloading) {
      return
    }
    setExpanded(false)
    setReloading(true)
    setNotice(null)
    try {
      const status = await reloadReferenceData()
      onDataStatus(status)
      await fetchCatalog()
      if (status.ok) {
        setNotice('Reference data reloaded')
      }
    } catch (err: unknown) {
      onDataStatus({
        ok: false,
        tables: [],
        fetchError: errorMessage(err, 'Reference data reload failed'),
      })
    } finally {
      setReloading(false)
    }
  }

  const setSteps = (remaining: number) => {
    setHeroMovementRemaining(remaining)
    setExpanded(false)
  }

  return (
    <div className="options-menu">
      <button
        type="button"
        className="options-toggle"
        aria-expanded={expanded}
        aria-haspopup="true"
        onClick={() => setExpanded((open) => !open)}
      >
        Options
      </button>
      {expanded ? (
        <div className="options-choices" role="menu">
          <button type="button" role="menuitem" onClick={() => openPanel('save')}>
            Save
          </button>
          <button type="button" role="menuitem" onClick={() => openPanel('load')}>
            Load
          </button>
          <button type="button" role="menuitem" onClick={() => openPanel('quit')}>
            Quit
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={reloading}
            onClick={() => void onReloadReference()}
          >
            Reload Reference Data
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => setSteps(1000)}
          >
            Increase Steps to 1000
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => setSteps(MAX_MOVEMENT_POINTS)}
          >
            Reset Steps to 10
          </button>
        </div>
      ) : null}
      {notice ? (
        <p className="options-notice" role="status">
          {notice}
        </p>
      ) : null}

      {panel === 'save' ? (
        <div className="options-modal" role="dialog" aria-labelledby="save-title">
          <div className="options-dialog">
            <h2 id="save-title">Save Game</h2>
            <label className="options-field">
              Game Name
              <input
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                autoFocus
                disabled={busy}
              />
            </label>
            {error ? (
              <p className="options-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="options-actions">
              <button type="button" disabled={busy} onClick={() => void onSave()}>
                {busy ? 'Saving…' : 'OK'}
              </button>
              <button type="button" disabled={busy} onClick={closePanel}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {panel === 'load' ? (
        <div className="options-modal" role="dialog" aria-labelledby="load-title">
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
                        <em>{formatCreated(row.createdAt)}</em>
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
              <button type="button" disabled={busy} onClick={closePanel}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {panel === 'quit' ? (
        <div className="options-modal" role="dialog" aria-labelledby="quit-title">
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
        </div>
      ) : null}
    </div>
  )
}
