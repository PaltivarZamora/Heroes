import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useSyncExternalStore } from 'react';
import { formatAmount } from '../hex/resources';
import { acceptNoticeBoardQuest, canCollectQuestReward, collectQuestReward, declineNoticeBoardMessage, findNoticeBoardById, playerQuestState, turnedInThankYouMessage, questRewardLabelForPlayer, } from '../session/quests';
import { rollSessionItemReward } from '../items/rewardRoll';
import { getSession, subscribe, updateSession } from '../session/store';
import { getCachedCatalog, subscribeCatalog } from './catalog';
/**
 * Notice Board quest panel (BR S9-10).
 */
export function WorldNoticeBoard({ featureId, heroId, onClose, embedded = false, onDeclineMessage, onLevelUpNotice, }) {
    const session = useSyncExternalStore(subscribe, getSession);
    const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog);
    const board = findNoticeBoardById(session, featureId);
    const hero = session.heroes.find((row) => row.id === heroId) ?? null;
    const [error, setError] = useState(null);
    const quest = board?.quest ?? null;
    const state = board && hero ? playerQuestState(board, hero.player_id) : null;
    const canCollect = catalog && board && hero && quest
        ? canCollectQuestReward(session, catalog, featureId, hero.player_id, hero.id)
        : false;
    const accept = async () => {
        if (!catalog || !hero || !board || !quest) {
            return;
        }
        let acceptError = null;
        try {
            const rolled = await rollSessionItemReward(getSession(), catalog, 'quest_item_rarity', quest.tier);
            updateSession((current) => {
                const result = acceptNoticeBoardQuest(rolled.session, catalog, featureId, hero.player_id, hero.id, rolled.item);
                acceptError = result.error;
                return result.error ? current : result.session;
            });
        }
        catch (err) {
            acceptError = err instanceof Error ? err.message : 'Could not roll quest reward';
        }
        if (acceptError) {
            setError(acceptError);
        }
    };
    const decline = () => {
        onDeclineMessage?.(declineNoticeBoardMessage);
        onClose();
    };
    const collect = () => {
        if (!catalog || !hero || !board || !quest || !canCollect) {
            return;
        }
        let collectError = null;
        let levelUp = null;
        updateSession((current) => {
            const result = collectQuestReward(current, catalog, featureId, hero.player_id, hero.id);
            collectError = result.error;
            levelUp = result.levelUpNotice;
            return result.error ? current : result.session;
        });
        if (collectError) {
            setError(collectError);
            return;
        }
        if (levelUp) {
            onLevelUpNotice?.(levelUp);
        }
    };
    const acceptedReward = hero && board
        ? questRewardLabelForPlayer(session, catalog, featureId, hero.player_id)
        : null;
    const rewardLine = state?.accepted && acceptedReward != null
        ? acceptedReward
        : quest
            ? [
                quest.reward_xp > 0 ? `${quest.reward_xp} XP` : null,
                quest.reward_gold > 0
                    ? `${formatAmount(quest.reward_gold)} Gold`
                    : null,
            ]
                .filter(Boolean)
                .join(' + ') || 'None'
            : '';
    const showReward = Boolean(state?.accepted) ||
        Boolean(state?.turned_in) ||
        Boolean(state?.completed) ||
        canCollect;
    const panel = (_jsx("div", { className: embedded ? 'game-window-modal' : 'date-notice', role: "dialog", "aria-modal": "true", "aria-labelledby": "world-notice-board-title", onClick: onClose, children: _jsxs("div", { className: "date-notice-card world-panel-card", onClick: (event) => event.stopPropagation(), children: [_jsxs("h1", { id: "world-notice-board-title", children: ["Notice Board", quest ? ` (T${quest.tier})` : ''] }), !catalog || !board || !hero ? (_jsx("p", { children: "Loading\u2026" })) : !quest ? (_jsxs(_Fragment, { children: [_jsx("p", { children: "No quest posted this week." }), _jsx("button", { type: "button", className: "date-notice-ok", onClick: onClose, children: "Close" })] })) : state?.turned_in ? (_jsxs(_Fragment, { children: [_jsx("p", { children: turnedInThankYouMessage }), showReward ? _jsxs("p", { children: ["Reward: ", rewardLine] }) : null, _jsx("button", { type: "button", className: "date-notice-ok", onClick: onClose, children: "Close" })] })) : (_jsxs(_Fragment, { children: [_jsx("p", { children: quest.flavour_text }), _jsxs("p", { children: ["Goal: ", quest.goal_line] }), showReward ? _jsxs("p", { children: ["Reward: ", rewardLine] }) : null, error ? _jsx("p", { className: "world-panel-error", children: error }) : null, !state?.accepted ? (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "date-notice-ok", onClick: accept, children: "Accept" }), _jsx("button", { type: "button", className: "date-notice-ok", onClick: decline, children: "Decline" })] })) : (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: "date-notice-ok", disabled: !canCollect, onClick: collect, children: "Collect Reward" }), _jsx("button", { type: "button", className: "date-notice-ok", onClick: onClose, children: "Close" })] }))] }))] }) }));
    return embedded ? _jsx("div", { className: "game-window-embed", children: panel }) : panel;
}
