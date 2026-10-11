import { useEffect, useState } from 'react'
import { GameWindowModal } from '../layout/GameWindowModal'
import { GameWindowOverlay } from '../layout/GameWindowOverlay'
import { HEX_SCALES, type HexScaleName } from '../hex/hexScale'
import {
  clearKeybindOverrides,
  loadKeybindOverrides,
  loadPlayerSettings,
  saveKeybindOverrides,
  savePlayerSettings,
  type PlayerSettings,
} from './playerSettings'
import {
  formatKeyLabel,
  keybindDbRows,
  resolvedKeybinds,
} from '../input/keybindEngine'
import { appConfigNumber, getCachedCatalog } from '../town/catalog'

type SettingsTab = 'audio' | 'popups' | 'keybinds' | 'video'

type SettingsScreenProps = {
  open: boolean
  initialTab?: SettingsTab
  hexScale: HexScaleName
  onHexScale: (name: HexScaleName) => void
  onClose: () => void
}

function normalizeBindingKey(event: KeyboardEvent): string | null {
  if (event.key === 'Escape') {
    return null
  }
  if (event.key === ' ') {
    return ' '
  }
  if (event.key === 'Enter') {
    return 'enter'
  }
  if (event.key === 'Tab') {
    return 'tab'
  }
  if (event.key.length === 1) {
    return event.key.toLowerCase()
  }
  return null
}

export function SettingsScreen({
  open,
  initialTab = 'audio',
  hexScale,
  onHexScale,
  onClose,
}: SettingsScreenProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [settings, setSettings] = useState<PlayerSettings>(() =>
    loadPlayerSettings(),
  )
  const [rebinding, setRebinding] = useState<string | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setTab(initialTab)
      setSettings(loadPlayerSettings())
    }
  }, [open, initialTab])

  useEffect(() => {
    if (!rebinding) {
      return
    }
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const key = normalizeBindingKey(event)
      if (!key) {
        setRebinding(null)
        return
      }
      const overrides = loadKeybindOverrides()
      const taken = resolvedKeybinds().find(
        (row) =>
          row.action !== rebinding &&
          (row.key === key || row.alt_key === key),
      )
      if (taken) {
        setConflict(`${taken.label} already uses that key — swapped.`)
        overrides[taken.action] = {
          key: overrides[rebinding]?.key ?? taken.key,
          altKey: overrides[rebinding]?.altKey ?? taken.alt_key,
        }
      } else {
        setConflict(null)
      }
      overrides[rebinding] = { key, altKey: null }
      saveKeybindOverrides(overrides)
      setRebinding(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [rebinding])

  const persist = (patch: Partial<PlayerSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    savePlayerSettings(next)
  }

  if (!open) {
    return null
  }

  return (
    <GameWindowOverlay>
      <GameWindowModal
        aria-labelledby="settings-title"
        onBackdropClick={onClose}
        className="settings-modal"
      >
        <h1 id="settings-title">Settings</h1>
        <div className="settings-tabs">
          {(['audio', 'popups', 'keybinds', 'video'] as SettingsTab[]).map(
            (id) => (
              <button
                key={id}
                type="button"
                className={tab === id ? 'is-active' : undefined}
                onClick={() => setTab(id)}
              >
                {id === 'audio'
                  ? 'Audio'
                  : id === 'popups'
                    ? 'Popups'
                    : id === 'keybinds'
                      ? 'Keybinds'
                      : 'Video'}
              </button>
            ),
          )}
        </div>
        {tab === 'audio' ? (
          <div className="settings-panel">
            <label>
              Music
              <input
                type="range"
                min={0}
                max={100}
                value={settings.volumeMusic}
                onChange={(e) =>
                  persist({ volumeMusic: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Effects
              <input
                type="range"
                min={0}
                max={100}
                value={settings.volumeEffects}
                onChange={(e) =>
                  persist({ volumeEffects: Number(e.target.value) })
                }
              />
            </label>
            <label>
              UI
              <input
                type="range"
                min={0}
                max={100}
                value={settings.volumeUi}
                onChange={(e) =>
                  persist({ volumeUi: Number(e.target.value) })
                }
              />
            </label>
          </div>
        ) : null}
        {tab === 'popups' ? (
          <div className="settings-panel">
            <label>
              <input
                type="checkbox"
                checked={settings.confirmEndTurn}
                onChange={(e) =>
                  persist({ confirmEndTurn: e.target.checked })
                }
              />
              Warn before End Turn
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.confirmUpgrade}
                onChange={(e) =>
                  persist({ confirmUpgrade: e.target.checked })
                }
              />
              Confirm individual upgrades
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.confirmUpgradeAll}
                onChange={(e) =>
                  persist({ confirmUpgradeAll: e.target.checked })
                }
              />
              Confirm mass upgrades
            </label>
            <label>
              Battle results popup (sec, 0=off, 99=until closed)
              <input
                type="number"
                min={0}
                max={99}
                value={
                  settings.combatEndTimerSec ??
                  effectiveCatalogTimer('end')
                }
                onChange={(e) =>
                  persist({
                    combatEndTimerSec: Number(e.target.value),
                  })
                }
              />
            </label>
            <label>
              Battle log popup (sec, 0=off, 99=until closed)
              <input
                type="number"
                min={0}
                max={99}
                value={
                  settings.combatLogTimerSec ??
                  effectiveCatalogTimer('log')
                }
                onChange={(e) =>
                  persist({
                    combatLogTimerSec: Number(e.target.value),
                  })
                }
              />
            </label>
          </div>
        ) : null}
        {tab === 'keybinds' ? (
          <div className="settings-panel settings-keybinds">
            {conflict ? <p className="settings-hint">{conflict}</p> : null}
            <ul>
              {keybindDbRows().length === 0 ? (
                <li className="settings-hint">No keybind rows loaded from catalog.</li>
              ) : null}
              {keybindDbRows().map((row) => {
                const live = resolvedKeybinds().find(
                  (r) => r.action === row.action,
                )
                const displayKey = live?.key ?? row.key
                return (
                  <li key={row.action}>
                    <span>{row.label}</span>
                    <button
                      type="button"
                      disabled={!row.rebindable}
                      onClick={() =>
                        row.rebindable && setRebinding(row.action)
                      }
                    >
                      {rebinding === row.action
                        ? 'Press a key…'
                        : formatKeyLabel(displayKey)}
                    </button>
                  </li>
                )
              })}
            </ul>
            <button
              type="button"
              onClick={() => {
                clearKeybindOverrides()
                setConflict(null)
              }}
            >
              Reset to defaults
            </button>
          </div>
        ) : null}
        {tab === 'video' ? (
          <div className="settings-panel">
            <button
              type="button"
              onClick={() => {
                void document.documentElement.requestFullscreen?.()
              }}
            >
              Enter Fullscreen
            </button>
            <p className="settings-hint">Hex size</p>
            {(Object.keys(HEX_SCALES) as HexScaleName[]).map((name) => (
              <button
                key={name}
                type="button"
                className={hexScale === name ? 'is-active' : undefined}
                onClick={() => onHexScale(name)}
              >
                {name}
              </button>
            ))}
          </div>
        ) : null}
        <button type="button" className="date-notice-ok" onClick={onClose}>
          Close
        </button>
      </GameWindowModal>
    </GameWindowOverlay>
  )
}

function effectiveCatalogTimer(kind: 'end' | 'log'): number {
  const catalog = getCachedCatalog()
  return kind === 'end'
    ? Math.max(0, Math.floor(appConfigNumber(catalog, 'combat_end_timer', 99)))
    : Math.max(0, Math.floor(appConfigNumber(catalog, 'combat_log_timer', 2)))
}
