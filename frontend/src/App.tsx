import { useCallback, useEffect, useState } from 'react'
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
  emptyWallet,
  formatResourceLine,
  formatResourceLines,
  RESOURCES,
  type ResourceWallet,
} from './hex/resources'
import {
  advanceDay,
  formatCalendar,
  sameCalendar,
  startCalendar,
  type Calendar,
} from './hex/calendar'
import { TownManagement } from './town/TownManagement'
import './App.css'

function App() {
  const [hexScale, setHexScale] = useState<HexScaleName>(DEFAULT_HEX_SCALE)
  const [mapInfo, setMapInfo] = useState<{
    width: number
    height: number
    seed: number
  } | null>(null)
  const [hero, setHero] = useState<HeroHudState | null>(null)
  const [wallet, setWallet] = useState<ResourceWallet>(emptyWallet)
  const onMapInfo = useCallback(
    (info: { width: number; height: number; seed: number }) => {
      setMapInfo(info)
    },
    [],
  )
  const onHeroState = useCallback((state: HeroHudState) => {
    setHero(state)
  }, [])
  const onResources = useCallback((next: ResourceWallet) => {
    setWallet(next)
  }, [])
  const [welcomeTown, setWelcomeTown] = useState<string | null>(null)
  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null)
  const [calendar, setCalendar] = useState(startCalendar)
  const [lastTownAction, setLastTownAction] = useState<
    Record<string, Calendar>
  >({})
  const onTownWelcome = useCallback((townName: string) => {
    setWelcomeTown(townName)
  }, [])
  const onEndDay = useCallback(() => {
    setCalendar((current) => advanceDay(current))
  }, [])
  const onTownActed = useCallback((townName: string) => {
    setLastTownAction((current) => ({
      ...current,
      [townName]: { ...calendar },
    }))
  }, [calendar])

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
  const lastAction = welcomeTown ? lastTownAction[welcomeTown] : undefined
  const hasActedToday =
    lastAction != null && sameCalendar(lastAction, calendar)

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
            <span key={resource.name}>
              {formatResourceLine(resource.name, wallet[resource.name])}
            </span>
          ))}
        </p>
      </header>
      <HexMap
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
          townName={welcomeTown}
          wallet={wallet}
          onWalletChange={setWallet}
          onExit={() => setWelcomeTown(null)}
          calendarLabel={calendarLabel}
          hasActedToday={hasActedToday}
          onActed={() => onTownActed(welcomeTown)}
          visitingHeroName={HERO_MARKER_LABEL}
        />
      ) : null}
    </main>
  )
}

export default App
