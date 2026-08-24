import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { HexMap, getSelectedMapHeroId, selectHeroOnMap } from './hex/HexMap'
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
import { advanceDay, formatCalendar, isWeekRollover } from './hex/calendar'
import { TownManagement } from './town/TownManagement'
import { FriendlyTrade } from './town/FriendlyTrade'
import { fetchCatalog, getCachedCatalog } from './town/catalog'
import { OptionsMenu } from './options/OptionsMenu'
import { getSession, subscribe, updateSession } from './session/store'
import {
  applyWeeklyGrowth,
  assignHeroesFromPool,
  findTownById,
  hasTownBuiltToday,
  humanPlayer,
  markTownBuiltToday,
  walletFromSession,
} from './session/accessors'
import './App.css'

function isEditableKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

function nextCycledId(
  indexRef: { current: number },
  ids: string[],
): string | null {
  if (ids.length === 0) {
    return null
  }
  indexRef.current = (indexRef.current + 1) % ids.length
  return ids[indexRef.current] ?? null
}

function nextIdAfter(currentId: string | null, ids: string[]): string | null {
  if (ids.length === 0) {
    return null
  }
  const idx = currentId ? ids.indexOf(currentId) : -1
  return ids[(idx + 1) % ids.length] ?? null
}

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
  const [trade, setTrade] = useState<{
    leftHeroId: string
    rightHeroId: string
  } | null>(null)
  const [combatNotice, setCombatNotice] = useState(false)
  const townCycleIndex = useRef(-1)
  const [mapEpoch, setMapEpoch] = useState(0)
  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null)
  const calendar = session.game.calendar
  const onTownWelcome = useCallback((townName: string, townId: string) => {
    setTrade(null)
    setCombatNotice(false)
    setWelcomeTown({ id: townId, name: townName })
  }, [])
  const onHeroMeet = useCallback((targetHeroId: string) => {
    const current = getSession()
    const selfId = getSelectedMapHeroId()
    const self = selfId
      ? current.heroes.find((row) => row.id === selfId)
      : undefined
    const other = current.heroes.find((row) => row.id === targetHeroId)
    if (!self || !other || self.id === other.id) {
      return
    }
    setWelcomeTown(null)
    if (self.player_id === other.player_id) {
      setCombatNotice(false)
      setTrade({ leftHeroId: self.id, rightHeroId: other.id })
      return
    }
    setTrade(null)
    setCombatNotice(true)
  }, [])
  const onEndDay = useCallback(() => {
    updateSession((current) => {
      const previous = current.game.calendar
      const next = advanceDay(previous)
      let session = {
        ...current,
        game: { ...current.game, calendar: next },
      }
      if (isWeekRollover(previous, next)) {
        const catalog = getCachedCatalog()
        if (catalog) {
          session = applyWeeklyGrowth(session, catalog)
        }
      }
      return session
    })
  }, [])
  const onTownActed = useCallback((townId: string) => {
    updateSession((current) => markTownBuiltToday(current, townId))
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return
      }
      if (isEditableKeyTarget(event.target)) {
        return
      }
      const key = event.key.toLowerCase()
      if (key !== 't' && key !== 'h') {
        return
      }
      event.preventDefault()
      const current = getSession()
      const player = humanPlayer(current)
      if (!player) {
        return
      }
      if (key === 't') {
        const townId = nextCycledId(townCycleIndex, player.town_ids)
        const town = townId ? findTownById(current, townId) : undefined
        if (town) {
          setWelcomeTown({ id: town.id, name: town.name })
        }
        return
      }
      const heroId = nextIdAfter(getSelectedMapHeroId(), player.hero_ids)
      const nextHero = heroId
        ? current.heroes.find((row) => row.id === heroId)
        : undefined
      if (!nextHero) {
        return
      }
      selectHeroOnMap(nextHero.id)
      setWelcomeTown(null)
      setTrade(null)
      setCombatNotice(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
    void fetchCatalog()
      .then((catalog) => {
        if (!cancelled) {
          updateSession((current) =>
            assignHeroesFromPool(current, catalog.hero_pool),
          )
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const hexSize = HEX_SCALES[hexScale]
  const mapLabel = mapInfo ? mapSizeLabel(mapInfo.width, mapInfo.height) : '…'
  const seedLabel = mapInfo ? String(mapInfo.seed) : '…'
  const stepsRemaining = hero?.remaining ?? MAX_MOVEMENT_POINTS
  const stepsLabel = formatMovementPoints(
    stepsRemaining,
    Math.max(MAX_MOVEMENT_POINTS, stepsRemaining),
  )
  const resourceLines = formatResourceLines(wallet)
  const calendarLabel = formatCalendar(calendar)
  const hasActedToday = welcomeTown
    ? hasTownBuiltToday(session, welcomeTown.id)
    : false
  const selectedHero = hero?.id
    ? session.heroes.find((row) => row.id === hero.id)
    : session.heroes[0]
  const heroName = selectedHero?.name ?? HERO_MARKER_LABEL

  const debugText = formatDebugText({
    mapSize: mapLabel,
    hexSize: `${hexScale} (${hexSize})`,
    seed: seedLabel,
    heroName,
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
          townCycleIndex.current = -1
          const catalog = getCachedCatalog()
          if (catalog) {
            updateSession((current) =>
              assignHeroesFromPool(current, catalog.hero_pool),
            )
          }
          setMapEpoch((n) => n + 1)
        }}
      />
      {dataStatus && !dataStatus.ok ? (
        <div className="data-load-banner" role="alert">
          Data load error — check debug panel
        </div>
      ) : null}
      <header className="map-hud">
        <p>Steps: {heroName} {stepsLabel}</p>
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
        heroName={heroName}
        onMapInfo={onMapInfo}
        onHeroState={onHeroState}
        onResources={onResources}
        onTownWelcome={onTownWelcome}
        onEndDay={onEndDay}
        onHeroMeet={onHeroMeet}
      />
      {combatNotice ? (
        <div
          className="combat-stub"
          role="dialog"
          aria-modal="true"
          aria-labelledby="combat-stub-title"
        >
          <div className="combat-stub-card">
            <h1 id="combat-stub-title">Combat not yet implemented.</h1>
            <button type="button" onClick={() => setCombatNotice(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
      {trade ? (
        <FriendlyTrade
          leftHeroId={trade.leftHeroId}
          rightHeroId={trade.rightHeroId}
          wallet={wallet}
          onExit={() => setTrade(null)}
        />
      ) : null}
      {welcomeTown && !trade ? (
        <TownManagement
          key={welcomeTown.id}
          townId={welcomeTown.id}
          townName={welcomeTown.name}
          wallet={wallet}
          onExit={() => setWelcomeTown(null)}
          calendarLabel={calendarLabel}
          hasActedToday={hasActedToday}
          onActed={() => onTownActed(welcomeTown.id)}
          visitingHeroName={heroName}
          selectedHeroId={selectedHero?.id ?? null}
        />
      ) : null}
    </main>
  )
}

export default App
