import { useState, useSyncExternalStore } from 'react'
import { formatAmount } from '../hex/resources'
import {
  acceptNoticeBoardQuest,
  canCollectQuestReward,
  collectQuestReward,
  declineNoticeBoardMessage,
  findNoticeBoardById,
  playerQuestState,
  turnedInThankYouMessage,
} from '../session/quests'
import type { LevelUpNotice } from '../session/xp'
import { getSession, subscribe, updateSession } from '../session/store'
import { getCachedCatalog, subscribeCatalog } from './catalog'

type WorldNoticeBoardProps = {
  featureId: string
  heroId: string
  onClose: () => void
  /** Shown after Decline (App date-notice). */
  onDeclineMessage?: (message: string) => void
  /** Level-up popup after Collect Reward XP. */
  onLevelUpNotice?: (notice: LevelUpNotice) => void
}

/**
 * Notice Board quest panel (BR S9-10).
 */
export function WorldNoticeBoard({
  featureId,
  heroId,
  onClose,
  onDeclineMessage,
  onLevelUpNotice,
}: WorldNoticeBoardProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const board = findNoticeBoardById(session, featureId)
  const hero = session.heroes.find((row) => row.id === heroId) ?? null
  const [error, setError] = useState<string | null>(null)

  const quest = board?.quest ?? null
  const state =
    board && hero ? playerQuestState(board, hero.player_id) : null
  const canCollect =
    catalog && board && hero && quest
      ? canCollectQuestReward(
          session,
          catalog,
          featureId,
          hero.player_id,
          hero.id,
        )
      : false

  const accept = () => {
    if (!catalog || !hero || !board || !quest) {
      return
    }
    let acceptError: string | null = null
    updateSession((current) => {
      const result = acceptNoticeBoardQuest(
        current,
        catalog,
        featureId,
        hero.player_id,
        hero.id,
      )
      acceptError = result.error
      return result.error ? current : result.session
    })
    if (acceptError) {
      setError(acceptError)
    }
  }

  const decline = () => {
    onDeclineMessage?.(declineNoticeBoardMessage)
    onClose()
  }

  const collect = () => {
    if (!catalog || !hero || !board || !quest || !canCollect) {
      return
    }
    let collectError: string | null = null
    let levelUp: LevelUpNotice | null = null
    updateSession((current) => {
      const result = collectQuestReward(
        current,
        catalog,
        featureId,
        hero.player_id,
        hero.id,
      )
      collectError = result.error
      levelUp = result.levelUpNotice
      return result.error ? current : result.session
    })
    if (collectError) {
      setError(collectError)
      return
    }
    if (levelUp) {
      onLevelUpNotice?.(levelUp)
    }
  }

  const rewardLine = quest
    ? [
        quest.reward_xp > 0 ? `${quest.reward_xp} XP` : null,
        quest.reward_gold > 0
          ? `${formatAmount(quest.reward_gold)} Gold`
          : null,
      ]
        .filter(Boolean)
        .join(' + ') || 'None'
    : ''
  // Hide until goal met / Collect active / turned in (S9-10 addendum).
  const showReward =
    Boolean(state?.turned_in) ||
    Boolean(state?.completed) ||
    canCollect

  return (
    <div
      className="date-notice"
      role="dialog"
      aria-modal="true"
      aria-labelledby="world-notice-board-title"
      onClick={onClose}
    >
      <div
        className="date-notice-card world-panel-card"
        onClick={(event) => event.stopPropagation()}
      >
        <h1 id="world-notice-board-title">
          Notice Board{quest ? ` (T${quest.tier})` : ''}
        </h1>
        {!catalog || !board || !hero ? (
          <p>Loading…</p>
        ) : !quest ? (
          <>
            <p>No quest posted this week.</p>
            <button type="button" className="date-notice-ok" onClick={onClose}>
              Close
            </button>
          </>
        ) : state?.turned_in ? (
          <>
            <p>{turnedInThankYouMessage}</p>
            {showReward ? <p>Reward: {rewardLine}</p> : null}
            <button type="button" className="date-notice-ok" onClick={onClose}>
              Close
            </button>
          </>
        ) : (
          <>
            <p>{quest.flavour_text}</p>
            <p>Goal: {quest.goal_line}</p>
            {showReward ? <p>Reward: {rewardLine}</p> : null}
            {error ? <p className="world-panel-error">{error}</p> : null}
            {!state?.accepted ? (
              <>
                <button
                  type="button"
                  className="date-notice-ok"
                  onClick={accept}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="date-notice-ok"
                  onClick={decline}
                >
                  Decline
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="date-notice-ok"
                  disabled={!canCollect}
                  onClick={collect}
                >
                  Collect Reward
                </button>
                <button
                  type="button"
                  className="date-notice-ok"
                  onClick={onClose}
                >
                  Close
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
