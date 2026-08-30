import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  MAP_SIZES,
  mapSizeChoiceLabel,
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
  PLAYER_COUNT_MAX,
  PLAYER_COUNT_MIN,
  type GameConfig,
  type PlayerConfig,
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
  const defaults = defaultGameConfig()
  const [mapSize, setMapSize] = useState<MapSizeName>(defaults.mapSize)
  const [playerCount, setPlayerCount] = useState(defaults.playerCount)
  const [difficultyId, setDifficultyId] = useState(defaults.difficultyId)
  const [slots, setSlots] = useState<PlayerConfig[]>(defaultPlayerSlots)
  const [assembled, setAssembled] = useState<GameConfig | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  const difficulties = catalog?.difficulty ?? []
  const selectedDifficulty =
    difficulties.find((row) => row.id === difficultyId) ?? null

  useEffect(() => {
    if (difficulties.length > 0) {
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
  }, [difficulties.length])

  useEffect(() => {
    if (difficulties.length === 0) {
      return
    }
    if (difficulties.some((row) => row.id === difficultyId)) {
      return
    }
    const normal = difficulties.find(
      (row) => row.name.trim().toLowerCase() === 'normal',
    )
    setDifficultyId(normal?.id ?? difficulties[0]?.id ?? 0)
  }, [difficulties, difficultyId])

  const setSlotHero = (index: number, heroTypeId: number | null) => {
    setSlots((current) =>
      current.map((slot, i) => (i === index ? { ...slot, heroTypeId } : slot)),
    )
  }

  const onStart = () => {
    const config = assembleGameConfig({
      mapSize,
      playerCount,
      slots,
      difficultyId,
    })
    console.log('GameConfig', config)
    setAssembled(config)
  }

  const heroTypes = catalog?.hero_type ?? []
  const assembledDifficulty = assembled
    ? (catalog?.difficulty.find((row) => row.id === assembled.difficultyId) ?? null)
    : null

  if (assembled) {
    return (
      <div
        className="options-modal"
        role="dialog"
        aria-labelledby="new-game-confirm-title"
      >
        <div className="options-dialog new-game-dialog">
          <h2 id="new-game-confirm-title">Game Config</h2>
          <p className="new-game-confirm-note">
            Config assembled. Launch to start the session.
          </p>
          <ul className="new-game-summary">
            <li>Map Size: {mapSizeChoiceLabel(assembled.mapSize)}</li>
            <li>Players: {assembled.playerCount}</li>
            <li>
              Difficulty:{' '}
              {assembledDifficulty?.name ?? `#${assembled.difficultyId}`}
              {difficultyDisplay(assembledDifficulty)
                ? ` — ${difficultyDisplay(assembledDifficulty)}`
                : ''}
            </li>
            {assembled.players.map((player) => (
              <li key={player.slot}>
                Player {player.slot} — Human —{' '}
                {heroLabel(player.heroTypeId, catalog)}
              </li>
            ))}
          </ul>
          <pre className="new-game-json">{JSON.stringify(assembled, null, 2)}</pre>
          <div className="options-actions">
            <button type="button" onClick={() => onStartGame(assembled)}>
              Launch Game
            </button>
            <button type="button" onClick={() => setAssembled(null)}>
              Back
            </button>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="options-modal" role="dialog" aria-labelledby="new-game-title">
      <div className="options-dialog new-game-dialog">
        <h2 id="new-game-title">New Game</h2>
        <label className="options-field">
          Map Size
          <select
            value={mapSize}
            onChange={(event) => setMapSize(event.target.value as MapSizeName)}
          >
            {MAP_SIZES.map((name) => (
              <option key={name} value={name}>
                {mapSizeChoiceLabel(name)}
              </option>
            ))}
          </select>
        </label>
        <label className="options-field">
          Players
          <select
            value={playerCount}
            onChange={(event) => setPlayerCount(Number(event.target.value))}
          >
            {Array.from(
              { length: PLAYER_COUNT_MAX - PLAYER_COUNT_MIN + 1 },
              (_, i) => PLAYER_COUNT_MIN + i,
            ).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="options-field">
          Difficulty
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
        {selectedDifficulty && difficultyDisplay(selectedDifficulty) ? (
          <p className="new-game-difficulty-note">
            {difficultyDisplay(selectedDifficulty)}
          </p>
        ) : null}
        <div className="new-game-players">
          {slots.slice(0, playerCount).map((slot, index) => (
            <div key={slot.slot} className="new-game-player-row">
              <span className="new-game-player-label">Player {slot.slot}</span>
              <label className="options-field">
                Controller
                <input value="Human" readOnly tabIndex={-1} />
              </label>
              <label className="options-field new-game-hero-field">
                Hero
                <select
                  value={slot.heroTypeId ?? ''}
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
              </label>
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
