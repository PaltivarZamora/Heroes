import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { HexMap } from './hex/HexMap'
import {
  formatDebugText,
  type DataStatus,
  type HeroHudState,
} from './hex/debug'
import { formatMovementPoints, MAX_MOVEMENT_POINTS, HERO_MARKER_LABEL } from './hex/hero'
import {
  DEFAULT_HEX_SCALE,
  HEX_SCALES,
  mapSizeLabel,
  type HexScaleName,
} from './hex/hexScale'
import {
  formatResourceLine,
  formatResourceLines,
  RESOURCES,
  type ResourceWallet,
} from './hex/resources'
import { advanceDay, formatCalendar } from './hex/calendar'
import { TownManagement } from './town/TownManagement'
import { fetchCatalog } from './town/catalog'
import { OptionsMenu } from './options/OptionsMenu'
import { getSession, subscribe, updateSession } from './session/store'
import {
  hasTownBuiltToday,
  markTownBuiltToday,
  walletFromSession,
} from './session/accessors'
import './App.css'

function App() {
  const session = useSyncExternalStore(subscribe, getSession)
  const [hexScale, setHexScale] = useState<HexScaleName>(DEFAULT_HEX_SCALE)
  const [mapInfo, setMapInfo] = useState<{
    width: number
    height: number
    seed: number
  } | null>(null)
  const [hero, setHero] = useState<HeroHudState | null>(null)
  const wallet = walletFromSession(session)
  const onMapInfo = useCallback(
    (info: { width: number; height: number; seed: number }) => {
      setMapInfo(info)
      updateSession((current) => {
        const currentName = current.game.name.trim()
        const keepName = currentName !== '' && currentName !== 'Test Game'
        return {
          ...current,
          game: {
            ...current.game,
            seed: info.seed,
            name: keepName ? current.game.name : `Random ${info.seed}`,
          },
        }
      })
    },
    [],
  )
  const onHeroState = useCallback((state: HeroHudState) => {
    setHero(state)
  }, [])
  const onResources = useCallback((_next: ResourceWallet) => {
    // Player.resources is the source of truth; HexMap writes it directly.
  }, [])
  const [welcomeTown, setWelcomeTown] = useState<{
    id: string
    name: string
  } | null>(null)
  const [mapEpoch, setMapEpoch] = useState(0)
  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null)
  const calendar = session.game.calendar
  const onTownWelcome = useCallback((townName: string, townId: string) => {
    setWelcomeTown({ id: townId, name: townName })
  }, [])
  const onEndDay = useCallback(() => {
    updateSession((current) => ({
      ...current,
      game: { ...current.game, calendar: advanceDay(current.game.calendar) },
    }))
  }, [])
  const onTownActed = useCallback((townId: string) => {
    updateSession((current) => markTownBuiltToday(current, townId))
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadStatus = async () => {
      try {
        const response = await fetch('/api/system/data-status')
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const payload = (await response.json()) as DataStatus
        if (!cancelled) {
          setDataStatus({
            ok: payload.ok,
            tables: Array.isArray(payload.tables) ? payload.tables : [],
          })
        }
      } catch (error) {
        if (!cancelled) {
          setDataStatus({
            ok: false,
            tables: [],
            fetchError:
              error instanceof Error ? error.message : 'status request failed',
          })
        }
      }
    }
    void loadStatus()
    void fetchCatalog().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const hexSize = HEX_SCALES[hexScale]
  const mapLabel = mapInfo ? mapSizeLabel(mapInfo.width, mapInfo.height) : '…'
  const seedLabel = mapInfo ? String(mapInfo.seed) : '…'
  const stepsLabel = formatMovementPoints(
    hero?.remaining ?? MAX_MOVEMENT_POINTS,
  )
  const resourceLines = formatResourceLines(wallet)
  const calendarLabel = formatCalendar(calendar)
  const hasActedToday = welcomeTown
    ? hasTownBuiltToday(session, welcomeTown.id)
    : false

  const debugText = formatDebugText({
    mapSize: mapLabel,
    hexSize: `${hexScale} (${hexSize})`,
    seed: seedLabel,
    heroQ: hero?.q ?? null,
    heroR: hero?.r ?? null,
    steps: stepsLabel,
    resources: resourceLines,
    dataStatus,
  })

  const copyDebug = useCallback(() => {
    void navigator.clipboard.writeText(debugText).catch((error) => {
      console.log('Failed to copy debug text:', error)
    })
  }, [debugText])

  return (
    <main className="app">
      <OptionsMenu
        onLoaded={() => {
          setWelcomeTown(null)
          setMapEpoch((n) => n + 1)
        }}
      />
      {dataStatus && !dataStatus.ok ? (
        <div className="data-load-banner" role="alert">
          Data load error — check debug panel
        </div>
      ) : null}
      <header className="map-hud">
        <p>Steps: {stepsLabel}</p>
        <p className="calendar-readout">{calendarLabel}</p>
        <div className="hex-scale-switch" role="group" aria-label="Hex scale">
          {(Object.keys(HEX_SCALES) as HexScaleName[]).map((name) => (
            <button
              key={name}
              type="button"
              className={name === hexScale ? 'active' : undefined}
              onClick={() => setHexScale(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="debug-copy">
          <button type="button" onClick={copyDebug}>
            Copy Debug
          </button>
          <pre className="debug-peek">{debugText}</pre>
        </div>
        <p className="resource-debug">
          {RESOURCES.map((resource) => (
            <span key={resource.id}>
              {formatResourceLine(resource, wallet[resource.id])}
            </span>
          ))}
        </p>
      </header>
      <HexMap
        key={mapEpoch}
        hexSize={hexSize}
        wallet={wallet}
        onMapInfo={onMapInfo}
        onHeroState={onHeroState}
        onResources={onResources}
        onTownWelcome={onTownWelcome}
        onEndDay={onEndDay}
      />
      {welcomeTown ? (
        <TownManagement
          key={welcomeTown.id}
          townId={welcomeTown.id}
          townName={welcomeTown.name}
          wallet={wallet}
          onExit={() => setWelcomeTown(null)}
          calendarLabel={calendarLabel}
          hasActedToday={hasActedToday}
          onActed={() => onTownActed(welcomeTown.id)}
          visitingHeroName={HERO_MARKER_LABEL}
        />
      ) : null}
    </main>
  )
}

export default App
