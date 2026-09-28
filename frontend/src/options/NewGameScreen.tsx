import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  HEX_SCALES,
  mapSizeChoiceLabel,
  mapSizes,
  type HexScaleName,
  type MapSizeName,
} from '../hex/hexScale'
import {
  difficultyDisplay,
  fetchCatalog,
  getCachedCatalog,
  subscribeCatalog,
} from '../town/catalog'
import {
  assembleGameConfig,
  defaultGameConfig,
  defaultPlayerSlots,
  HEX_SIZE_OPTIONS,
  MOVE_MODE_OPTIONS,
  PLAYER_CONTROLLER_OPTIONS,
  playerCountBounds,
  type GameConfig,
  type MoveMode,
  type PlayerConfig,
  type PlayerController,
} from './gameConfig'

type NewGameScreenProps = {
  onClose: () => void
  onStartGame: (config: GameConfig) => void
}

function heroLabel(
  heroTypeId: number | null,
  catalog: ReturnType<typeof getCachedCatalog>,
): string {
  if (heroTypeId == null) {
    return 'Random'
  }
  const type = catalog?.hero_type.find((row) => row.id === heroTypeId)
  if (!type) {
    return `hero_type #${heroTypeId}`
  }
  const town = catalog?.town.find((row) => row.id === type.town_id)
  return town ? `${type.name} (${town.name})` : type.name
}

function parseHeroValue(value: string): number | null {
  if (value === '') {
    return null
  }
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

export function NewGameScreen({ onClose, onStartGame }: NewGameScreenProps) {
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const bootDefaults = defaultGameConfig(catalog)
  const [mapSize, setMapSize] = useState<MapSizeName>(bootDefaults.mapSize)
  const [playerCount, setPlayerCount] = useState(bootDefaults.playerCount)
  const [difficultyId, setDifficultyId] = useState(bootDefaults.difficultyId)
  const [hexSize, setHexSize] = useState<HexScaleName>(bootDefaults.hexSize)
  const [moveMode, setMoveMode] = useState<MoveMode>(bootDefaults.moveMode)
  const [slots, setSlots] = useState<PlayerConfig[]>(() =>
    defaultPlayerSlots(catalog),
  )
  // false until catalog is applied once this mount — never skip when catalog was
  // already cached (F5) or we would keep stale pre-map_config form state.
  const [defaultsApplied, setDefaultsApplied] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  const difficulties = catalog?.difficulty ?? []
  const selectedDifficulty =
    difficulties.find((row) => row.id === difficultyId) ?? null
  const sizeOptions = mapSizes(catalog)
  const { min: playersMinBound, max: playersMaxBound } = playerCountBounds(
    catalog,
    mapSize,
  )

  useEffect(() => {
    if (catalog) {
      return
    }
    let cancelled = false
    void fetchCatalog().catch((err: unknown) => {
      if (!cancelled) {
        setCatalogError(
          err instanceof Error ? err.message : 'Could not load reference data',
        )
      }
    })
    return () => {
      cancelled = true
    }
  }, [catalog])

  // Pre-fill once from map_config when catalog is ready; do not overwrite edits after.
  useEffect(() => {
    if (!catalog || defaultsApplied) {
      return
    }
    const defaults = defaultGameConfig(catalog)
    setMapSize(defaults.mapSize)
    setPlayerCount(defaults.playerCount)
    setDifficultyId(defaults.difficultyId)
    setHexSize(defaults.hexSize)
    setMoveMode(defaults.moveMode)
    setSlots(defaultPlayerSlots(catalog, defaults.playerCount))
    setDefaultsApplied(true)
  }, [catalog, defaultsApplied])

  useEffect(() => {
    if (!defaultsApplied || difficulties.length === 0) {
      return
    }
    if (difficulties.some((row) => row.id === difficultyId)) {
      return
    }
    const normal = difficulties.find(
      (row) => row.name.trim().toLowerCase() === 'normal',
    )
    setDifficultyId(normal?.id ?? difficulties[0]?.id ?? 0)
  }, [difficulties, difficultyId, defaultsApplied])

  // Clamp players when map size (and thus players_min/max) changes.
  useEffect(() => {
    if (!defaultsApplied) {
      return
    }
    setPlayerCount((current) =>
      Math.min(playersMaxBound, Math.max(playersMinBound, current)),
    )
  }, [defaultsApplied, playersMinBound, playersMaxBound])

  const setSlotHero = (index: number, heroTypeId: number | null) => {
    setSlots((current) =>
      current.map((slot, i) => (i === index ? { ...slot, heroTypeId } : slot)),
    )
  }

  const setSlotController = (index: number, controller: PlayerController) => {
    if (index === 0) {
      return
    }
    setSlots((current) =>
      current.map((slot, i) => (i === index ? { ...slot, controller } : slot)),
    )
  }

  const onStart = () => {
    const config = assembleGameConfig(
      {
        mapSize,
        playerCount,
        slots,
        difficultyId,
        hexSize,
        moveMode,
      },
      catalog,
    )
    onStartGame(config)
  }

  // Intentionally sorted by hero_type.id (alphabetical renumber order).
  // Library tabs use hero_type.sort_order instead — do not unify these.
  const heroTypes = [...(catalog?.hero_type ?? [])].sort((a, b) => a.id - b.id)

  return (
    <div className="options-modal" role="dialog" aria-labelledby="new-game-title">
      <div className="options-dialog new-game-dialog">
        <h2 id="new-game-title">New Game</h2>
        <div className="new-game-fields">
          <label className="options-field options-field-row">
            <span className="options-field-label">Map Size</span>
            <select
              value={mapSize}
              onChange={(event) => setMapSize(event.target.value as MapSizeName)}
            >
              {sizeOptions.map((name) => (
                <option key={name} value={name}>
                  {mapSizeChoiceLabel(name, catalog)}
                </option>
              ))}
            </select>
          </label>
          <label className="options-field options-field-row">
            <span className="options-field-label">Difficulty</span>
            <select
              value={difficultyId || ''}
              onChange={(event) => setDifficultyId(Number(event.target.value))}
              disabled={difficulties.length === 0}
            >
              {difficulties.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="options-field options-field-row">
            <span className="options-field-label">Players</span>
            <select
              value={playerCount}
              onChange={(event) => setPlayerCount(Number(event.target.value))}
            >
              {Array.from(
                { length: playersMaxBound - playersMinBound + 1 },
                (_, i) => playersMinBound + i,
              ).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="options-field options-field-row">
            <span className="options-field-label">Hex Size</span>
            <select
              value={hexSize}
              onChange={(event) =>
                setHexSize(event.target.value as HexScaleName)
              }
            >
              {HEX_SIZE_OPTIONS.map((name) => (
                <option key={name} value={name}>
                  {name} ({HEX_SCALES[name]})
                </option>
              ))}
            </select>
          </label>
          <label className="options-field options-field-row">
            <span className="options-field-label">Speed</span>
            <select
              value={moveMode}
              onChange={(event) =>
                setMoveMode(event.target.value as MoveMode)
              }
            >
              {MOVE_MODE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {selectedDifficulty && difficultyDisplay(selectedDifficulty) ? (
          <p className="new-game-difficulty-note">
            {difficultyDisplay(selectedDifficulty)}
          </p>
        ) : null}
        <div className="new-game-players">
          <span className="new-game-col-head">Player</span>
          <span className="new-game-col-head">Controller</span>
          <span className="new-game-col-head">Hero</span>
          {slots.slice(0, playerCount).map((slot, index) => (
            <div key={slot.slot} className="new-game-player-row">
              <span className="new-game-player-label">Player {slot.slot}</span>
              {index === 0 ? (
                <input value="Human" readOnly tabIndex={-1} />
              ) : (
                <select
                  value={
                    slot.controller === 'ai_spectator' ? 'ai' : slot.controller
                  }
                  aria-label={`Player ${slot.slot} controller`}
                  onChange={(event) =>
                    setSlotController(
                      index,
                      event.target.value as PlayerController,
                    )
                  }
                >
                  {PLAYER_CONTROLLER_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
              <select
                value={slot.heroTypeId ?? ''}
                aria-label={`Player ${slot.slot} hero`}
                onChange={(event) =>
                  setSlotHero(index, parseHeroValue(event.target.value))
                }
              >
                <option value="">Random</option>
                {heroTypes.map((row) => (
                  <option key={row.id} value={row.id}>
                    {heroLabel(row.id, catalog)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
        {catalogError ? (
          <p className="options-error" role="alert">
            {catalogError}
          </p>
        ) : null}
        {!catalog && !catalogError ? (
          <p className="options-empty">Loading hero types…</p>
        ) : null}
        <div className="options-actions">
          <button type="button" onClick={onStart}>
            Start Game
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
