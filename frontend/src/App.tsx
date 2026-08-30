import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { HexMap, clearCachedGrid, getSelectedMapHeroId, selectHeroOnMap, syncActivePlayerView } from './hex/HexMap'
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
import { calendarRolloverTitle, formatCalendar } from './hex/calendar'
import { TownManagement } from './town/TownManagement'
import { HeroScreen } from './town/HeroScreen'
import { FriendlyTrade } from './town/FriendlyTrade'
import { fetchCatalog, getCachedCatalog } from './town/catalog'
import { OptionsMenu } from './options/OptionsMenu'
import type { GameConfig } from './options/gameConfig'
import { getExploredHexes } from './hex/world'
import { getSession, setSession, subscribe, updateSession } from './session/store'
import { createSessionFromConfig } from './session/create'
import {
  assignHeroesFromPool,
  endTurn,
  findTownById,
  hasTownBuiltToday,
  humanPlayer,
  markTownBuiltToday,
  persistActiveExplored,
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

function isInsideOptionsModal(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.options-modal') != null
}

function idInDirection(
  currentId: string | null,
  ids: string[],
  reverse: boolean,
): string | null {
  if (ids.length === 0) {
    return null
  }
  const idx = currentId ? ids.indexOf(currentId) : -1
  if (reverse) {
    if (idx < 0) {
      return ids[ids.length - 1] ?? null
    }
    return ids[(idx - 1 + ids.length) % ids.length] ?? null
  }
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
  const [heroScreen, setHeroScreen] = useState(false)
  const [trade, setTrade] = useState<{
    leftHeroId: string
    rightHeroId: string
  } | null>(null)
  const [combatNotice, setCombatNotice] = useState(false)
  const [dateNotice, setDateNotice] = useState<{
    title: string
    date: string
  } | null>(null)
  const lastTownRef = useRef<{ id: string; name: string } | null>(null)
  const [mapEpoch, setMapEpoch] = useState(0)
  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null)
  const calendar = session.game.calendar
  const onTownWelcome = useCallback((townName: string, townId: string) => {
    setTrade(null)
    setCombatNotice(false)
    const next = { id: townId, name: townName }
    lastTownRef.current = next
    setWelcomeTown(next)
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
  const onEndTurn = useCallback(() => {
    setWelcomeTown(null)
    setHeroScreen(false)
    setTrade(null)
    setCombatNotice(false)
    const previous = getSession().game.calendar
    updateSession((current) =>
      endTurn(persistActiveExplored(current, getExploredHexes())),
    )
    syncActivePlayerView()
    const next = getSession().game.calendar
    const title = calendarRolloverTitle(previous, next)
    if (title) {
      setDateNotice({ title, date: formatCalendar(next) })
    }
  }, [])
  const onStartGame = useCallback((config: GameConfig) => {
    setWelcomeTown(null)
    setHeroScreen(false)
    setTrade(null)
    setCombatNotice(false)
    setDateNotice(null)
    lastTownRef.current = null
    clearCachedGrid()
    setSession(createSessionFromConfig(config))
    const catalog = getCachedCatalog()
    if (catalog) {
      updateSession((current) =>
        assignHeroesFromPool(current, catalog.hero_pool),
      )
    }
    setMapEpoch((n) => n + 1)
  }, [])
  const cycleTown = useCallback((reverse = false) => {
    const current = getSession()
    const player = humanPlayer(current)
    if (!player) {
      return
    }
    const townId = idInDirection(
      welcomeTown?.id ?? lastTownRef.current?.id ?? null,
      player.town_ids,
      reverse,
    )
    const town = townId ? findTownById(current, townId) : undefined
    if (town) {
      const next = { id: town.id, name: town.name }
      lastTownRef.current = next
      setHeroScreen(false)
      setWelcomeTown(next)
    }
  }, [welcomeTown])

  const cycleHero = useCallback((reverse = false) => {
    const current = getSession()
    const player = humanPlayer(current)
    if (!player) {
      return
    }
    const heroId = idInDirection(getSelectedMapHeroId(), player.hero_ids, reverse)
    const nextHero = heroId
      ? current.heroes.find((row) => row.id === heroId)
      : undefined
    if (!nextHero) {
      return
    }
    selectHeroOnMap(nextHero.id)
  }, [])

  const openHeroScreen = useCallback((heroId?: string | null) => {
    if (heroId) {
      selectHeroOnMap(heroId)
    }
    setWelcomeTown(null)
    setTrade(null)
    setCombatNotice(false)
    setHeroScreen(true)
  }, [])

  const openTownScreen = useCallback(() => {
    const current = getSession()
    const player = humanPlayer(current)
    if (!player) {
      return
    }
    const remembered = lastTownRef.current
    const rememberedOk =
      remembered != null && player.town_ids.includes(remembered.id)
    const townId = rememberedOk
      ? remembered.id
      : (player.town_ids[0] ?? null)
    const town = townId ? findTownById(current, townId) : undefined
    if (!town) {
      return
    }
    const next = { id: town.id, name: town.name }
    lastTownRef.current = next
    setHeroScreen(false)
    setWelcomeTown(next)
  }, [])

  const onTownActed = useCallback((townId: string) => {
    updateSession((current) => markTownBuiltToday(current, townId))
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return
      }
      const inOptions = isInsideOptionsModal(event.target)
      const editable = isEditableKeyTarget(event.target)

      if (event.key === 'Escape') {
        if (inOptions || editable) {
          return
        }
        if (dateNotice) {
          event.preventDefault()
          setDateNotice(null)
          return
        }
        if (combatNotice) {
          event.preventDefault()
          setCombatNotice(false)
          return
        }
        if (trade) {
          event.preventDefault()
          setTrade(null)
          return
        }
        if (heroScreen) {
          if (document.querySelector('.hero-screen .marketplace-overlay')) {
            return
          }
          event.preventDefault()
          setHeroScreen(false)
        }
        return
      }

      if (event.repeat) {
        return
      }

      if (event.key === 'Tab') {
        if (inOptions || editable) {
          return
        }
        event.preventDefault()
        if (welcomeTown && !heroScreen) {
          cycleTown(event.shiftKey)
          return
        }
        cycleHero(event.shiftKey)
        return
      }

      if (event.key === 'Enter') {
        if (inOptions || editable) {
          return
        }
        event.preventDefault()
        if (heroScreen || welcomeTown || trade || combatNotice || dateNotice) {
          return
        }
        onEndTurn()
        return
      }

      if (inOptions || editable) {
        return
      }
      const key = event.key.toLowerCase()
      if (key === 't') {
        event.preventDefault()
        if (heroScreen) {
          openTownScreen()
          return
        }
        cycleTown()
        return
      }
      if (key === 'h') {
        event.preventDefault()
        openHeroScreen()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [
    combatNotice,
    cycleHero,
    cycleTown,
    dateNotice,
    heroScreen,
    onEndTurn,
    openHeroScreen,
    openTownScreen,
    trade,
    welcomeTown,
  ])

  useEffect(() => {
    if (!dateNotice) {
      return
    }
    const timer = window.setTimeout(() => {
      setDateNotice(null)
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [dateNotice])

  useEffect(() => {
    syncActivePlayerView()
  }, [session.activePlayerIndex])

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
    extraLines: [
      `Players: ${session.players.length}`,
      `Active Player Index: ${session.activePlayerIndex ?? 0}`,
      `Active Player: ${humanPlayer(session)?.id ?? 'none'}`,
      ...session.players.map((player, index) => {
        const typeId = session.game.settings.hero_type_ids?.[index]
        return `  ${index}: ${player.id} type=${typeId ?? 'random'} heroes=${player.hero_ids.length} towns=${player.town_ids.length} fog=${player.explored.length} elim=${player.eliminated === true}`
      }),
    ],
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
          setHeroScreen(false)
          setTrade(null)
          setCombatNotice(false)
          setDateNotice(null)
          lastTownRef.current = null
          const catalog = getCachedCatalog()
          if (catalog) {
            updateSession((current) =>
              assignHeroesFromPool(current, catalog.hero_pool),
            )
          }
          setMapEpoch((n) => n + 1)
        }}
        onDataStatus={setDataStatus}
        onCopyDebug={copyDebug}
        onStartGame={onStartGame}
      />
      {dataStatus && !dataStatus.ok ? (
        <div className="data-load-banner" role="alert">
          Data load error — check debug panel
        </div>
      ) : null}
      <header className="map-hud">
        <p>Steps: {heroName} {stepsLabel}</p>
        <p className="calendar-readout">{calendarLabel}</p>
        <p className="turn-readout">
          Player {(session.activePlayerIndex ?? 0) + 1}
        </p>
        <button type="button" onClick={onEndTurn}>
          End Turn
        </button>
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
        onHeroMeet={onHeroMeet}
      />
      {dateNotice ? (
        <div
          className="date-notice"
          role="status"
          aria-live="polite"
          aria-labelledby="date-notice-title"
          onClick={() => setDateNotice(null)}
        >
          <div className="date-notice-card">
            <h1 id="date-notice-title">{dateNotice.title}</h1>
            <p>{dateNotice.date}</p>
          </div>
        </div>
      ) : null}
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
          onOpenHero={openHeroScreen}
          onCycleTown={cycleTown}
        />
      ) : null}
      {heroScreen && selectedHero ? (
        <HeroScreen
          heroId={selectedHero.id}
          onClose={() => setHeroScreen(false)}
          onSelectHero={(id) => selectHeroOnMap(id)}
          onOpenHero={openHeroScreen}
          onCycleTown={cycleTown}
        />
      ) : null}
    </main>
  )
}

export default App
