import { useSyncExternalStore } from 'react'
import { activePlayer } from '../session/accessors'
import { questLogEntries, questRewardLabelForPlayer } from '../session/quests'
import { getSession, subscribe } from '../session/store'
import { getCachedCatalog, subscribeCatalog } from './catalog'
import { GameWindowModal } from '../layout/GameWindowModal'
import { GameWindowOverlay } from '../layout/GameWindowOverlay'

type QuestLogProps = {
  onClose: () => void
  embedded?: boolean
}

function statusLabel(state: {
  completed: boolean
  turned_in: boolean
}): string {
  if (state.turned_in) {
    return 'Turned In'
  }
  if (state.completed) {
    return 'Completed'
  }
  return ''
}

/**
 * Active player's accepted Notice Board quests (BR S9-10).
 */
export function QuestLog({ onClose, embedded = false }: QuestLogProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const actor = activePlayer(session)
  const entries = actor ? questLogEntries(session, actor.id) : []

  const rewardText = (featureId: string) =>
    actor && catalog
      ? questRewardLabelForPlayer(session, catalog, featureId, actor.id)
      : null

  if (embedded) {
    return (
      <GameWindowOverlay className="quest-log-embedded">
        <GameWindowModal
          aria-modal="true"
          aria-labelledby="quest-log-title"
          onBackdropClick={onClose}
        >
          <h1 id="quest-log-title">Quest Log</h1>
          {entries.length === 0 ? (
            <p>No accepted quests this week.</p>
          ) : (
            <ul className="world-panel-list">
              {entries.map((entry) => {
                const reward = rewardText(entry.featureId)
                return (
                  <li key={entry.featureId}>
                    <p>
                      <strong>
                        Notice Board (T{entry.quest.tier}) — near {entry.townName}
                      </strong>
                      {statusLabel(entry.state)
                        ? ` — ${statusLabel(entry.state)}`
                        : ''}
                    </p>
                    <p>{entry.quest.flavour_text}</p>
                    <p>Goal: {entry.quest.goal_line}</p>
                    {reward ? <p>Reward: {reward}</p> : null}
                  </li>
                )
              })}
            </ul>
          )}
          <button type="button" className="date-notice-ok" onClick={onClose}>
            Close
          </button>
        </GameWindowModal>
      </GameWindowOverlay>
    )
  }

  return (
    <div
      className="date-notice"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quest-log-title"
      onClick={onClose}
    >
      <div
        className="date-notice-card world-panel-card"
        onClick={(event) => event.stopPropagation()}
      >
        <h1 id="quest-log-title">Quest Log</h1>
        {entries.length === 0 ? (
          <p>No accepted quests this week.</p>
        ) : (
          <ul className="world-panel-list">
            {entries.map((entry) => {
              const reward = rewardText(entry.featureId)
              return (
                <li key={entry.featureId}>
                  <p>
                    <strong>
                      Notice Board (T{entry.quest.tier}) — near {entry.townName}
                    </strong>
                    {statusLabel(entry.state)
                      ? ` — ${statusLabel(entry.state)}`
                      : ''}
                  </p>
                  <p>{entry.quest.flavour_text}</p>
                  <p>Goal: {entry.quest.goal_line}</p>
                  {reward ? <p>Reward: {reward}</p> : null}
                </li>
              )
            })}
          </ul>
        )}
        <button type="button" className="date-notice-ok" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
