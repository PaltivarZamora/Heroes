import { useEffect, useRef, useState, type MouseEvent } from 'react'
import {
  clearCachedGrid,
  getSelectedMapHeroId,
  setHeroMovementRemaining,
  setMapCameraFollowMoves,
} from '../hex/HexMap'
import type { DataStatus } from '../hex/debug'
import {
  createSave,
  deleteSave,
  fetchSave,
  isGameSession,
  listSaves,
  type SaveSummary,
} from '../session/saves'
import { getSession, setSession, updateSession } from '../session/store'
import type { GameSession } from '../session/types'
import {
  activePlayer,
  grantBuildArmy,
  grantBuildBasicBuildings,
  grantClassAbilitiesAtTier,
  grantOpenChest,
  grantUpgradeBuildings,
  normalizeHeroProgress,
  restoreAllHeroMovement,
} from '../session/accessors'
import {
  awardHeroXp,
  levelUpNoticeForAward,
  type LevelUpNotice,
} from '../session/xp'
import {
  DEFAULT_HERO_MOVEMENT_STEPS,
  fetchCatalog,
  getCachedCatalog,
  heroResourcePools,
  refreshCatalogFromDb,
  reloadReferenceData,
} from '../town/catalog'
import { LIBRARY_TIERS } from '../town/libraryRules'
import { NewGameScreen } from './NewGameScreen'
import type { GameConfig } from './gameConfig'
import { archName } from '../ai/weights'
import { getExploredHexes } from '../hex/world'
import { HEX_SCALES, type HexScaleName } from '../hex/hexScale'
import type { FixedFightKind } from '../session/fixedFight'

const STEPS_UNLIMITED = DEFAULT_HERO_MOVEMENT_STEPS

type Panel = 'new' | 'save' | 'load' | 'quit' | null

type OptionsMenuProps = {
  onLoaded: () => void
  onDataStatus: (status: DataStatus) => void
  onCopyDebug: () => void
  onStartGame: (config: GameConfig) => void
  onLevelUpNotice: (notice: LevelUpNotice | null) => void
  /** Lift green status into the map HUD gap (between End Turn and Debug). */
  onHudNotice?: (notice: string | null) => void
  /** Debug Fixed Fight scenarios (starts combat). */
  onStartFixedFight?: (kind: FixedFightKind) => void
  hexScale: HexScaleName
  onHexScale: (name: HexScaleName) => void
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

function withExploredDefaults(session: GameSession): GameSession {
  return normalizeHeroProgress({
    ...session,
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

const FALLBACK_AI_ARCHES = [
  { id: 1, name: 'Build' },
  { id: 2, name: 'Explore' },
  { id: 3, name: 'Aggressive' },
  { id: 4, name: 'Defend' },
] as const

function aiArchRows() {
  const rows = getCachedCatalog()?.ai_arch ?? []
  if (rows.length > 0) {
    return [...rows].sort((a, b) => a.id - b.id)
  }
  return FALLBACK_AI_ARCHES.map((row) => ({ id: row.id, name: row.name }))
}

function aiPlayerLabel(player: { id: string; arch_id: number }): string {
  const slot = player.id.replace(/^player-/, '')
  return `P${slot} (${archName(getCachedCatalog(), player.arch_id)})`
}

export function OptionsMenu({
  onLoaded,
  onDataStatus,
  onCopyDebug,
  onStartGame,
  onLevelUpNotice,
  onHudNotice,
  onStartFixedFight,
  hexScale,
  onHexScale,
}: OptionsMenuProps) {
  const [expanded, setExpanded] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [saveName, setSaveName] = useState('')
  const [saves, setSaves] = useState<SaveSummary[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [stepsUnlimited, setStepsUnlimited] = useState(false)
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
      setSession(restoreAllHeroMovement(getSession()))
      const session = getSession()
      const selectedId = getSelectedMapHeroId()
      const liveHero =
        (selectedId
          ? session.heroes.find((row) => row.id === selectedId)
          : undefined) ?? session.heroes[0]
      if (liveHero) {
        setHeroMovementRemaining(liveHero.movement_remaining)
      }
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

  const applyStepsMode = (unlimited: boolean) => {
    setStepsUnlimited(unlimited)
    if (unlimited) {
      updateSession((current) => ({
        ...current,
        heroes: current.heroes.map((hero) => ({
          ...hero,
          movement_remaining: STEPS_UNLIMITED,
        })),
      }))
      setHeroMovementRemaining(STEPS_UNLIMITED)
    } else {
      setSession(restoreAllHeroMovement(getSession()))
      const session = getSession()
      const selected = getSelectedMapHeroId()
      const liveHero =
        (selected
          ? session.heroes.find((row) => row.id === selected)
          : undefined) ?? session.heroes[0]
      if (liveHero) {
        setHeroMovementRemaining(liveHero.movement_remaining)
      }
    }
    setExpanded(false)
  }

  const toggleSteps = () => {
    applyStepsMode(!stepsUnlimited)
  }

  const restoreSelectedHeroPools = () => {
    const catalog = getCachedCatalog()
    if (!catalog) {
      setExpanded(false)
      setNotice('Catalog not loaded')
      return
    }
    const session = getSession()
    const selectedId = getSelectedMapHeroId()
    const selected = selectedId
      ? session.heroes.find((row) => row.id === selectedId)
      : undefined
    const human = session.players.find((player) => !player.is_ai)
    const hero =
      selected ??
      (human
        ? session.heroes.find((row) => row.player_id === human.id)
        : undefined) ??
      session.heroes[0]
    if (!hero) {
      setExpanded(false)
      setNotice('No hero to restore')
      return
    }
    const pools = heroResourcePools(catalog, hero)
    updateSession((current) => ({
      ...current,
      heroes: current.heroes.map((row) =>
        row.id === hero.id
          ? {
              ...row,
              current_mana: pools.current_mana,
              current_energy: pools.current_energy,
            }
          : row,
      ),
    }))
    setExpanded(false)
    setNotice(
      `${hero.name}: Energy ${pools.current_energy}, Mana ${pools.current_mana}`,
    )
  }

  const learnAllAbilities = () => {
    const catalog = getCachedCatalog()
    if (!catalog) {
      setExpanded(false)
      setNotice('Catalog not loaded')
      return
    }
    updateSession((current) => {
      let next = current
      for (const tier of LIBRARY_TIERS) {
        next = grantClassAbilitiesAtTier(next, tier)
      }
      return next
    })
    setExpanded(false)
    setNotice('Every hero learned all abilities from their two disciplines')
  }

  const grantDebugLevelUp = () => {
    const catalog = getCachedCatalog()
    if (!catalog) {
      setExpanded(false)
      setNotice('Catalog not loaded')
      return
    }
    const session = getSession()
    const selectedId = getSelectedMapHeroId()
    const selected = selectedId
      ? session.heroes.find((row) => row.id === selectedId)
      : undefined
    const human = session.players.find((player) => !player.is_ai)
    const hero =
      selected ??
      (human
        ? session.heroes.find((row) => row.player_id === human.id)
        : undefined) ??
      session.heroes[0]
    if (!hero) {
      setExpanded(false)
      setNotice('No hero to level up')
      return
    }
    let notice: LevelUpNotice | null = null
    updateSession((current) => {
      const awarded = awardHeroXp(current, catalog, hero.id, 1000)
      notice = levelUpNoticeForAward(catalog, awarded)
      return awarded.session
    })
    setExpanded(false)
    if (notice) {
      onLevelUpNotice(notice)
    }
    setNotice(`${hero.name} +1000 XP`)
  }

  const setAiPlayerArch = (playerId: string, archId: number, name: string) => {
    updateSession((current) => ({
      ...current,
      players: current.players.map((player) =>
        player.id === playerId && player.is_ai
          ? { ...player, arch_id: archId }
          : player,
      ),
    }))
    setExpanded(false)
    const slot = playerId.replace(/^player-/, '')
    setNotice(`P${slot} archetype set to ${name}`)
  }

  const aiPlayers = getSession().players.filter((player) => player.is_ai)
  const arches = aiArchRows()
  const seeAiOn =
    aiPlayers.length > 0 && aiPlayers.every((player) => player.ai_spectator)

  const toggleSeeAi = () => {
    if (aiPlayers.length === 0) {
      setExpanded(false)
      setNotice('No AI players in this game')
      return
    }
    const next = !seeAiOn
    updateSession((current) => ({
      ...current,
      players: current.players.map((player) =>
        player.is_ai ? { ...player, ai_spectator: next } : player,
      ),
    }))
    const actor = activePlayer(getSession())
    if (actor?.is_ai) {
      setMapCameraFollowMoves(next)
    }
    setExpanded(false)
    setNotice(next ? 'See AI: On' : 'See AI: Off')
  }

  return (
    <div className="options-menu" ref={menuRef}>
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
          <div className="options-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              updateSession(grantOpenChest)
              setExpanded(false)
              setNotice('Opened a chest: 10,000 Gold and 20 of each other resource')
            }}
          >
            Open Chest
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const result = grantBuildArmy(getSession(), 1)
              setSession(result.session)
              setExpanded(false)
              setNotice(result.notice)
            }}
          >
            Build Army 1
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const result = grantBuildArmy(getSession(), 2)
              setSession(result.session)
              setExpanded(false)
              setNotice(result.notice)
            }}
          >
            Build Army 2
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const result = grantBuildBasicBuildings(getSession())
              setSession(result.session)
              setExpanded(false)
              setNotice(result.notice)
            }}
          >
            Build Basic Buildings
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const result = grantUpgradeBuildings(getSession())
              setSession(result.session)
              setExpanded(false)
              setNotice(result.notice)
            }}
          >
            Upgrade Buildings
          </button>
          <button type="button" role="menuitem" onClick={learnAllAbilities}>
            Learn
          </button>
          <button type="button" role="menuitem" onClick={grantDebugLevelUp}>
            Level Up
          </button>
          <button type="button" role="menuitem" onClick={toggleSteps}>
            Steps: {stepsUnlimited ? String(STEPS_UNLIMITED) : 'Speed'}
          </button>
          <button type="button" role="menuitem" onClick={restoreSelectedHeroPools}>
            Restore
          </button>
          {onStartFixedFight ? (
            <div className="options-flyout">
              <button type="button" role="menuitem" aria-haspopup="true">
                Fixed Fight
              </button>
              <div className="options-submenu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onStartFixedFight('pit_fiends')
                    setExpanded(false)
                  }}
                >
                  Pit Fiends
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onStartFixedFight('raise_demons')
                    setExpanded(false)
                  }}
                >
                  Raise Demons
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onStartFixedFight('holy_wrath')
                    setExpanded(false)
                  }}
                >
                  Holy Wrath
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onStartFixedFight('for_the_hoard')
                    setExpanded(false)
                  }}
                >
                  For the Hoard
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onStartFixedFight('fight_yourself')
                    setExpanded(false)
                  }}
                >
                  Fight Yourself
                </button>
              </div>
            </div>
          ) : null}
          <div className="options-separator" role="separator" />
          <div className="options-flyout">
            <button type="button" role="menuitem" aria-haspopup="true">
              Grid Size: {hexScale}
            </button>
            <div className="options-submenu" role="menu">
              {(Object.keys(HEX_SCALES) as HexScaleName[]).map((name) => (
                <button
                  key={name}
                  type="button"
                  role="menuitem"
                  className={name === hexScale ? 'active' : undefined}
                  onClick={() => {
                    onHexScale(name)
                    setExpanded(false)
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
          <div className="options-separator" role="separator" />
          <button type="button" role="menuitem" onClick={toggleSeeAi}>
            See AI: {seeAiOn ? 'On' : 'Off'}
          </button>
          <div className="options-flyout">
            <button type="button" role="menuitem" aria-haspopup="true">
              Set AI Archetype
            </button>
            <div className="options-submenu" role="menu">
              {aiPlayers.length === 0 ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setExpanded(false)
                    setNotice('No AI players in this game')
                  }}
                >
                  No AI players
                </button>
              ) : aiPlayers.length === 1 ? (
                arches.map((arch) => (
                  <button
                    key={arch.id}
                    type="button"
                    role="menuitem"
                    className={arch.id === aiPlayers[0].arch_id ? 'active' : undefined}
                    onClick={() =>
                      setAiPlayerArch(aiPlayers[0].id, arch.id, arch.name)
                    }
                  >
                    {arch.name}
                  </button>
                ))
              ) : (
                aiPlayers.map((player) => (
                  <div key={player.id} className="options-flyout">
                    <button type="button" role="menuitem" aria-haspopup="true">
                      {aiPlayerLabel(player)}
                    </button>
                    <div className="options-submenu" role="menu">
                      {arches.map((arch) => (
                        <button
                          key={arch.id}
                          type="button"
                          role="menuitem"
                          className={
                            arch.id === player.arch_id ? 'active' : undefined
                          }
                          onClick={() =>
                            setAiPlayerArch(player.id, arch.id, arch.name)
                          }
                        >
                          {arch.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
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
            onClick={() => {
              onCopyDebug()
              setExpanded(false)
              setNotice('Debug copied')
            }}
          >
            Copy Debug
          </button>
        </div>
      ) : null}

      {panel === 'new' ? (
        <NewGameScreen
          onClose={closePanel}
          onStartGame={(config) => {
            onStartGame(config)
            closePanel()
          }}
        />
      ) : null}

      {panel === 'save' ? (
        <div className="options-modal" role="dialog" aria-labelledby="save-title">
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
