import { useEffect, useMemo, useRef, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { GameWindowModal } from './GameWindowModal'
import { GameWindowOverlay } from './GameWindowOverlay'
import { getSession, subscribe } from '../session/store'
import { getCachedCatalog, subscribeCatalog } from '../town/catalog'
import {
  formatCombatArchiveLines,
  formattedTabLines,
  logViewPlayerId,
  playerGameLog,
  type FormattedLogLine,
  type GameLogTab,
} from '../session/gameLog'

const TABS: Array<{ id: GameLogTab; label: string }> = [
  { id: 'world', label: 'World' },
  { id: 'town', label: 'Town' },
  { id: 'enemy', label: 'Enemy' },
  { id: 'combat', label: 'Combat' },
]

type GameLogModalProps = {
  open: boolean
  initialTab: GameLogTab
  focusCombatId?: string | null
  /** In-progress battle transcript (not yet in save archives). */
  liveCombatLines?: string[]
  onClose: () => void
}

export function GameLogModal({
  open,
  initialTab,
  focusCombatId,
  liveCombatLines = [],
  onClose,
}: GameLogModalProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const [tab, setTab] = useState<GameLogTab>(initialTab)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (open) {
      setTab(initialTab)
    }
  }, [open, initialTab])

  const playerId = logViewPlayerId(session)
  const liveCombat = useMemo(
    () => liveCombatLines.filter((line) => line.trim().length > 0),
    [liveCombatLines],
  )
  const lines = useMemo((): FormattedLogLine[] => {
    if (tab !== 'combat') {
      return formattedTabLines(session, catalog, playerId, tab)
    }
    const archived = formattedTabLines(session, catalog, playerId, tab)
    const live: FormattedLogLine[] = liveCombat.map((text) => ({ text }))
    return [...archived, ...live]
  }, [session, catalog, playerId, tab, liveCombat])

  useEffect(() => {
    if (!open || !focusCombatId || tab !== 'combat') {
      return
    }
    const el = scrollRef.current?.querySelector(
      `[data-combat-id="${focusCombatId}"]`,
    )
    el?.scrollIntoView({ block: 'start' })
  }, [open, focusCombatId, tab, lines.length])

  if (!open) {
    return null
  }

  return (
    <GameWindowOverlay className="game-log-embedded">
      <GameWindowModal
        aria-labelledby="game-log-title"
        onBackdropClick={onClose}
        className="game-log-modal"
      >
        <h1 id="game-log-title">Game log</h1>
        <div className="game-log-tabs" role="tablist">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? 'game-log-tab-active' : undefined}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="game-log-scroll" ref={scrollRef}>
          {lines.length === 0 ? (
            <p className="settings-hint">No entries yet.</p>
          ) : tab === 'combat' ? (
            <>
              {playerGameLog(session, playerId).combat.map((archive) => (
                <section
                  key={archive.id}
                  className="game-log-combat-block"
                  data-combat-id={archive.id}
                >
                  {formatCombatArchiveLines(archive).map((line, index) => (
                    <p key={`${archive.id}-${index}`} className="game-log-line">
                      {line}
                    </p>
                  ))}
                </section>
              ))}
              {liveCombat.length > 0 ? (
                <section
                  className="game-log-combat-block game-log-combat-live"
                  data-combat-id="live"
                >
                  {liveCombat.map((line, index) => (
                    <p key={`live-${index}`} className="game-log-line">
                      {line}
                    </p>
                  ))}
                </section>
              ) : null}
            </>
          ) : (
            lines.map((line, index) => (
              <LogLineRow key={`${tab}-${index}`} line={line} onOpenCombat={() => {
                if (line.detailsCombatId) {
                  setTab('combat')
                }
              }} />
            ))
          )}
        </div>
        <button type="button" className="date-notice-ok" onClick={onClose}>
          Close
        </button>
      </GameWindowModal>
    </GameWindowOverlay>
  )
}

function LogLineRow({
  line,
  onOpenCombat,
}: {
  line: FormattedLogLine
  onOpenCombat: () => void
}) {
  if (!line.detailsCombatId) {
    if (line.segments && line.segments.length > 0) {
      return (
        <p className="game-log-line">
          {line.segments.map((segment, index) =>
            segment.color ? (
              <span key={index} style={{ color: segment.color }}>
                {segment.text}
              </span>
            ) : (
              <span key={index}>{segment.text}</span>
            ),
          )}
        </p>
      )
    }
    return <p className="game-log-line">{line.text}</p>
  }
  return (
    <p className="game-log-line">
      {line.text}{' '}
      <button
        type="button"
        className="game-log-details-link"
        onClick={onOpenCombat}
      >
        [details]
      </button>
    </p>
  )
}

export function bannerLogLines(
  session: ReturnType<typeof getSession>,
  catalog: ReturnType<typeof getCachedCatalog>,
  tab: GameLogTab,
  liveCombatLines: string[],
  scrollBack: number,
): FormattedLogLine[] {
  if (tab === 'combat' && liveCombatLines.length > 0) {
    const start = Math.max(0, liveCombatLines.length - 3 - scrollBack)
    return liveCombatLines.slice(start, start + 3).map((text) => ({ text }))
  }
  const formatted = formattedTabLines(
    session,
    catalog,
    logViewPlayerId(session),
    tab,
  )
  const start = Math.max(0, formatted.length - 3 - scrollBack)
  return formatted.slice(start, start + 3)
}

export function maxBannerLogScroll(
  session: ReturnType<typeof getSession>,
  catalog: ReturnType<typeof getCachedCatalog>,
  tab: GameLogTab,
  liveCombatLines: string[],
): number {
  const total =
    tab === 'combat' && liveCombatLines.length > 0
      ? liveCombatLines.length
      : formattedTabLines(
          session,
          catalog,
          logViewPlayerId(session),
          tab,
        ).length
  return Math.max(0, total - 3)
}

export function defaultLogTab(
  inCombat: boolean,
  inTown: boolean,
): GameLogTab {
  if (inCombat) {
    return 'combat'
  }
  if (inTown) {
    return 'town'
  }
  return 'world'
}
