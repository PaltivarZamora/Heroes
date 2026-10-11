import type { ReactNode } from 'react'
import { ResourceBar } from '../hex/ResourceBar'
import type { ResourceWallet } from '../hex/resources'
import type { FormattedLogLine } from '../session/gameLog'
import { BANNER_HEIGHT, BANNER_WIDTH, BANNER_X, BANNER_Y } from './stageConstants'

export type BannerButton = {
  id: string
  label: string
  title: string
  onClick: () => void
  disabled?: boolean
  dimmed?: boolean
}

type GameBannerProps = {
  wallet: ResourceWallet
  calendarLabel: string
  weekLabel: string
  turnLabel?: string
  buttons: BannerButton[]
  logLines: FormattedLogLine[]
  logScrollBack: number
  logScrollMax: number
  onLogScrollUp: () => void
  onLogScrollDown: () => void
  onOpenLog: () => void
  onLogDetails?: (combatId: string) => void
  trailing?: ReactNode
}

export function GameBanner({
  wallet,
  calendarLabel,
  weekLabel,
  turnLabel,
  buttons,
  logLines,
  logScrollBack,
  logScrollMax,
  onLogScrollUp,
  onLogScrollDown,
  onOpenLog,
  onLogDetails,
  trailing,
}: GameBannerProps) {
  return (
    <header
      className="game-banner"
      style={{
        left: BANNER_X,
        top: BANNER_Y,
        width: BANNER_WIDTH,
        height: BANNER_HEIGHT,
      }}
    >
      <div className="game-banner-resources">
        <ResourceBar wallet={wallet} className="game-banner-resource-bar" />
        <span className="game-banner-calendar">
          {calendarLabel}
          <span className="game-banner-week"> · {weekLabel}</span>
          {turnLabel ? (
            <span className="game-banner-turn"> · {turnLabel}</span>
          ) : null}
        </span>
      </div>
      <div className="game-banner-buttons">
        {buttons.map((btn) => (
          <button
            key={btn.id}
            type="button"
            className={btn.dimmed ? 'game-ui-dimmed' : undefined}
            title={btn.title}
            disabled={btn.disabled}
            onClick={btn.onClick}
          >
            {btn.label}
          </button>
        ))}
      </div>
      <div className="game-banner-log-wrap">
        <div className="game-banner-log-scroll">
          <button
            type="button"
            className="game-banner-log-arrow"
            aria-label="Older log lines"
            disabled={logScrollBack >= logScrollMax}
            onClick={onLogScrollUp}
          >
            ▲
          </button>
          <button
            type="button"
            className="game-banner-log-arrow"
            aria-label="Newer log lines"
            disabled={logScrollBack <= 0}
            onClick={onLogScrollDown}
          >
            ▼
          </button>
        </div>
        <button
          type="button"
          className="game-banner-log"
          aria-label="Game log"
          onClick={onOpenLog}
        >
          {logLines.length === 0
            ? <span className="game-banner-log-empty">&nbsp;</span>
            : logLines.map((line, index) => (
                <div key={`${index}:${line.text}`} className="game-banner-log-line">
                  {line.text}
                  {line.detailsCombatId && onLogDetails ? (
                    <>
                      {' '}
                      <span
                        className="game-banner-log-details"
                        role="link"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation()
                          onLogDetails(line.detailsCombatId!)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            event.stopPropagation()
                            onLogDetails(line.detailsCombatId!)
                          }
                        }}
                      >
                        [details]
                      </span>
                    </>
                  ) : null}
                </div>
              ))}
        </button>
      </div>
      {trailing ? <div className="game-banner-trailing">{trailing}</div> : null}
    </header>
  )
}
