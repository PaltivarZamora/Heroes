import { useSyncExternalStore } from 'react'
import { formatAmount } from '../hex/resources'
import { activePlayer } from '../session/accessors'
import { questLogEntries } from '../session/quests'
import { getSession, subscribe } from '../session/store'

type QuestLogProps = {
  onClose: () => void
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
export function QuestLog({ onClose }: QuestLogProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const actor = activePlayer(session)
  const entries = actor ? questLogEntries(session, actor.id) : []

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
              const showReward =
                entry.state.completed || entry.state.turned_in
              const reward = showReward
                ? [
                    entry.quest.reward_xp > 0
                      ? `${entry.quest.reward_xp} XP`
                      : null,
                    entry.quest.reward_gold > 0
                      ? `${formatAmount(entry.quest.reward_gold)} Gold`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' + ')
                : ''
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
