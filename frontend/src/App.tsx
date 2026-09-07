import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { HexMap, clearCachedGrid, getSelectedMapHeroId, selectHeroOnMap, setMapCameraFollowMoves, setMapInputLocked, syncActivePlayerView } from './hex/HexMap'
import {
  formatDebugSections,
  formatDebugText,
  type DataStatus,
  type HeroHudState,
} from './hex/debug'
import { DebugCopyPanel } from './hex/DebugCopyPanel'
import { formatMovementPoints, HERO_MARKER_LABEL } from './hex/hero'
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
import { calendarRolloverTitle, calendarDayNumber, formatCalendar } from './hex/calendar'
import { TownManagement } from './town/TownManagement'
import { HeroScreen } from './town/HeroScreen'
import { FriendlyTrade } from './town/FriendlyTrade'
import { CombatScreen } from './combat/CombatScreen'
import { getCachedCatalog, heroMovementPoints, refreshCatalogFromDb } from './town/catalog'
import { OptionsMenu } from './options/OptionsMenu'
import type { GameConfig } from './options/gameConfig'
import { getExploredHexes } from './hex/world'
import { getSession, setSession, subscribe, updateSession } from './session/store'
import { createSessionFromConfig } from './session/create'
import { resolveMobPreBattle } from './session/mobEncounter'
import {
  assignHeroesFromPool,
  activePlayer,
  endTurn,
  findTownAt,
  findTownById,
  hasTownBuiltToday,
  humanPlayer,
  markTownBuiltToday,
  persistActiveExplored,
  visitingHeroId,
  walletFromSession,
} from './session/accessors'
import { clearAiTraces, getAiTraceBlocks, subscribeAiTraces } from './ai/trace'
import { decideAndApplyHeroTrade } from './ai/armyAlloc'
import { runAiTurn } from './ai/turn'
import type { WorldAttackTarget } from './ai/worldMove'
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
  const [combat, setCombat] = useState<{
    attackerHeroId: string
    defenderHeroId: string | null
    siegeTownId?: string
    defenderMobId?: string
  } | null>(null)
  const [dateNotice, setDateNotice] = useState<{
    title: string
    date: string
    lines?: string[]
  } | null>(null)
  const combatWaitRef = useRef<(() => void) | null>(null)
  const lastTownRef = useRef<{ id: string; name: string } | null>(null)
  const [mapEpoch, setMapEpoch] = useState(0)
  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null)
  const [aiPhase, setAiPhase] = useState<'idle' | 'running' | 'review'>('idle')
  const aiRanKeyRef = useRef('')
  const aiTraces = useSyncExternalStore(subscribeAiTraces, getAiTraceBlocks)
  const calendar = session.game.calendar
  const onTownWelcome = useCallback((townName: string, townId: string) => {
    setTrade(null)
    setCombat(null)
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
      const owner = current.players.find((row) => row.id === self.player_id)
      if (owner?.is_ai) {
        setCombat(null)
        setTrade(null)
        decideAndApplyHeroTrade(owner, self, other)
        return
      }
      setCombat(null)
      setTrade({ leftHeroId: self.id, rightHeroId: other.id })
      return
    }
    setTrade(null)
    setHeroScreen(false)
    const occupied = findTownAt(current, other.position.q, other.position.r)
    const siegeTownId =
      occupied?.player_id && occupied.player_id !== self.player_id
        ? occupied.id
        : undefined
    setCombat({
      attackerHeroId: self.id,
      defenderHeroId: other.id,
      siegeTownId,
    })
  }, [])
  const onSiegeTown = useCallback((townId: string) => {
    const current = getSession()
    const selfId = getSelectedMapHeroId()
    const self = selfId
      ? current.heroes.find((row) => row.id === selfId)
      : undefined
    if (!self) {
      return
    }
    setWelcomeTown(null)
    setTrade(null)
    setHeroScreen(false)
    const town = current.towns.find((row) => row.id === townId)
    const occupantId = town ? visitingHeroId(current, town) : null
    const occupant = occupantId
      ? current.heroes.find((row) => row.id === occupantId)
      : undefined
    const defenderHeroId =
      occupant && occupant.player_id !== self.player_id ? occupant.id : null
    setCombat({
      attackerHeroId: self.id,
      defenderHeroId,
      siegeTownId: townId,
    })
  }, [])
  const beginMobEncounter = useCallback((mobId: string): boolean => {
    const current = getSession()
    const selfId = getSelectedMapHeroId()
    const self = selfId
      ? current.heroes.find((row) => row.id === selfId)
      : undefined
    const mob = current.mobs.find((row) => row.id === mobId)
    if (!self || !mob) {
      return false
    }
    setWelcomeTown(null)
    setTrade(null)
    setHeroScreen(false)
    const catalog = getCachedCatalog()
    if (catalog) {
      const result = resolveMobPreBattle(current, catalog, self, mob)
      if (result.kind !== 'fight') {
        updateSession(() => result.session)
        setCombat(null)
        setDateNotice({
          title: result.kind === 'surrender' ? 'Surrender' : 'Fled',
          date:
            result.kind === 'surrender'
              ? 'The creatures join your army.'
              : 'The creatures flee.',
          lines: result.kind === 'flee' ? result.xpLines : undefined,
        })
        return false
      }
    }
    setCombat({
      attackerHeroId: self.id,
      defenderHeroId: null,
      defenderMobId: mob.id,
    })
    return true
  }, [])
  const onMobMeet = useCallback((mobId: string) => {
    beginMobEncounter(mobId)
  }, [beginMobEncounter])
  const closeCombat = useCallback(() => {
    setCombat(null)
    const done = combatWaitRef.current
    combatWaitRef.current = null
    done?.()
  }, [])
  const onEndTurn = useCallback(() => {
    setWelcomeTown(null)
    setHeroScreen(false)
    setTrade(null)
    closeCombat()
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
  }, [closeCombat])
  const onStartGame = useCallback((config: GameConfig) => {
    void (async () => {
      try {
        await refreshCatalogFromDb()
      } catch {
        // Launch with whatever catalog is already cached.
      }
      setWelcomeTown(null)
      setHeroScreen(false)
      setTrade(null)
      closeCombat()
      setDateNotice(null)
      lastTownRef.current = null
      clearAiTraces()
      aiRanKeyRef.current = ''
      setAiPhase('idle')
      setMapInputLocked(false)
      setMapCameraFollowMoves(true)
      clearCachedGrid()
      setSession(createSessionFromConfig(config))
      const catalog = getCachedCatalog()
      if (catalog) {
        updateSession((current) =>
          assignHeroesFromPool(current, catalog.hero_pool),
        )
      }
      setMapEpoch((n) => n + 1)
    })()
  }, [closeCombat])
  const adoptHero = useCallback((id: string) => {
    const row = getSession().heroes.find((hero) => hero.id === id)
    if (!row) {
      return
    }
    selectHeroOnMap(row.id)
    setHero({
      id: row.id,
      q: row.position.q,
      r: row.position.r,
      remaining: row.movement_remaining,
    })
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
    if (aiPhase === 'running') {
      return
    }
    const current = getSession()
    const player = humanPlayer(current)
    if (!player) {
      return
    }
    const owned = player.hero_ids.filter((id) =>
      current.heroes.some((row) => row.id === id),
    )
    if (owned.length === 0) {
      return
    }
    const selectedId = getSelectedMapHeroId()
    const currentId = owned.includes(hero?.id ?? '')
      ? hero?.id ?? null
      : owned.includes(selectedId ?? '')
        ? selectedId
        : null
    const heroId = idInDirection(currentId, owned, reverse)
    if (!heroId) {
      return
    }
    adoptHero(heroId)
  }, [adoptHero, hero?.id, aiPhase])

  const openHeroScreen = useCallback((heroId?: string | null) => {
    if (heroId) {
      adoptHero(heroId)
    }
    setWelcomeTown(null)
    setTrade(null)
    closeCombat()
    setHeroScreen(true)
  }, [adoptHero, closeCombat])

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
        if (combat) {
          if (
            document.querySelector('.combat-screen[data-hero-cast]') ||
            document.querySelector('.combat-inspect-popup')
          ) {
            return
          }
          event.preventDefault()
          closeCombat()
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
        if (inOptions || editable || combat) {
          if (combat) {
            event.preventDefault()
          }
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
        if (inOptions || editable || aiPhase !== 'idle') {
          return
        }
        event.preventDefault()
        if (heroScreen || welcomeTown || trade || combat || dateNotice) {
          return
        }
        onEndTurn()
        return
      }

      if (event.key.toLowerCase() === 'e') {
        if (inOptions || editable || combat || aiPhase === 'running') {
          return
        }
        event.preventDefault()
        onEndTurn()
        return
      }

      if (inOptions || editable || combat) {
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
    combat,
    cycleHero,
    cycleTown,
    dateNotice,
    heroScreen,
    onEndTurn,
    openHeroScreen,
    openTownScreen,
    trade,
    welcomeTown,
    aiPhase,
    closeCombat,
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

  const calendarDay = calendarDayNumber(session.game.calendar)
  useEffect(() => {
    const player = activePlayer(getSession())
    const key = `${calendarDay}-${getSession().activePlayerIndex}`
    if (!player?.is_ai) {
      setMapInputLocked(false)
      setMapCameraFollowMoves(true)
      setAiPhase('idle')
      return
    }
    if (combat) {
      return
    }
    if (aiRanKeyRef.current === key) {
      return
    }
    const mode = player.ai_spectator ? 'ai_spectator' : 'ai'
    setMapInputLocked(true)
    setMapCameraFollowMoves(mode === 'ai_spectator')
    setAiPhase('running')
    let cancelled = false
    void (async () => {
      await Promise.resolve()
      if (cancelled) {
        return
      }
      if (aiRanKeyRef.current === key) {
        return
      }
      aiRanKeyRef.current = key
      try {
        await runAiTurn(mode, {
          engageWorldAttack: async (heroId, target: WorldAttackTarget) => {
            selectHeroOnMap(heroId)
            const wait = new Promise<void>((resolve) => {
              combatWaitRef.current = resolve
            })
            if (target.type === 'mob') {
              const opened = beginMobEncounter(target.mobId)
              if (!opened) {
                combatWaitRef.current = null
                return
              }
              await wait
              return
            }
            if (target.type === 'hero') {
              onHeroMeet(target.heroId)
            } else {
              onSiegeTown(target.townId)
            }
            await wait
          },
        })
      } catch (error) {
        console.log('AI turn failed:', error)
      }
      if (cancelled) {
        return
      }
      if (mode === 'ai_spectator') {
        setAiPhase('review')
        return
      }
      setAiPhase('idle')
      onEndTurn()
    })()
    return () => {
      cancelled = true
    }
  }, [
    session.activePlayerIndex,
    calendarDay,
    mapEpoch,
    onEndTurn,
    beginMobEncounter,
    onHeroMeet,
    onSiegeTown,
  ])

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
    void refreshCatalogFromDb()
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
  const selectedHero = hero?.id
    ? session.heroes.find((row) => row.id === hero.id)
    : session.heroes[0]
  const heroSpeed = heroMovementPoints(getCachedCatalog(), selectedHero)
  const stepsRemaining = hero?.remaining ?? heroSpeed
  const stepsLabel = formatMovementPoints(
    stepsRemaining,
    Math.max(heroSpeed, stepsRemaining),
  )
  const resourceLines = formatResourceLines(wallet)
  const calendarLabel = formatCalendar(calendar)
  const actor = activePlayer(session)
  const turnKind = !actor
    ? ''
    : actor.is_ai
      ? actor.ai_spectator
        ? ' — AI spectator (DEV)'
        : ' — AI'
      : ''
  const hasActedToday = welcomeTown
    ? hasTownBuiltToday(session, welcomeTown.id)
    : false
  const heroName = selectedHero?.name ?? HERO_MARKER_LABEL

  const debugSnapshot = {
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
      `AI phase: ${aiPhase}`,
      ...session.players.map((player, index) => {
        const typeId = session.game.settings.hero_type_ids?.[index]
        const control = player.is_ai
          ? player.ai_spectator
            ? 'ai_spectator'
            : 'ai'
          : 'human'
        return `  ${index}: ${player.id} ${control} arch=${player.arch_id} type=${typeId ?? 'random'} heroes=${player.hero_ids.length} towns=${player.town_ids.length} fog=${player.explored.length} elim=${player.eliminated === true}`
      }),
    ],
    traceLines:
      aiTraces.length > 0
        ? [
            '--- AI traces (DEV) ---',
            ...aiTraces.flatMap((block) => ['', ...block.split('\n')]),
          ]
        : [],
  }
  const debugText = formatDebugText(debugSnapshot)
  const debugSections = formatDebugSections(debugSnapshot)

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
        <p>Steps: {heroName} {stepsLabel}</p>
        <p className="calendar-readout">{calendarLabel}</p>
        <p className="turn-readout">
          Player {(session.activePlayerIndex ?? 0) + 1}
          {turnKind}
          {aiPhase === 'running' ? ' — moving…' : ''}
          {aiPhase === 'review' ? ' — review, then End Turn' : ''}
        </p>
        <button
          type="button"
          onClick={onEndTurn}
          disabled={aiPhase === 'running'}
        >
          End Turn
        </button>
        <div className="hud-end">
          <DebugCopyPanel onCopy={copyDebug} sections={debugSections} />
          <OptionsMenu
            hexScale={hexScale}
            onHexScale={setHexScale}
            onLoaded={() => {
              setWelcomeTown(null)
              setHeroScreen(false)
              setTrade(null)
              closeCombat()
              setDateNotice(null)
              lastTownRef.current = null
              clearAiTraces()
              aiRanKeyRef.current = ''
              setAiPhase('idle')
              setMapInputLocked(false)
              setMapCameraFollowMoves(true)
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
        onSiegeTown={onSiegeTown}
        onMobMeet={onMobMeet}
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
            {dateNotice.lines?.map((line, index) => (
              <p key={`notice-${index}`}>{line}</p>
            ))}
          </div>
        </div>
      ) : null}
      {combat ? (
        <CombatScreen
          attackerHeroId={combat.attackerHeroId}
          defenderHeroId={combat.defenderHeroId}
          siegeTownId={combat.siegeTownId}
          defenderMobId={combat.defenderMobId}
          debugSections={debugSections}
          onCopyDebug={copyDebug}
          onExit={closeCombat}
        />
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
          readOnly={Boolean(actor?.is_ai)}
        />
      ) : null}
      {heroScreen && selectedHero ? (
        <HeroScreen
          heroId={selectedHero.id}
          onClose={() => setHeroScreen(false)}
          onSelectHero={adoptHero}
          onOpenHero={openHeroScreen}
          onCycleTown={cycleTown}
        />
      ) : null}
    </main>
  )
}

export default App
