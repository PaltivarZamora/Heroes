import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useSyncExternalStore } from 'react';
import { activePlayer } from '../session/accessors';
import { questLogEntries, questRewardLabelForPlayer } from '../session/quests';
import { getSession, subscribe } from '../session/store';
import { getCachedCatalog, subscribeCatalog } from './catalog';
import { GameWindowModal } from '../layout/GameWindowModal';
import { GameWindowOverlay } from '../layout/GameWindowOverlay';
function statusLabel(state) {
    if (state.turned_in) {
        return 'Turned In';
    }
    if (state.completed) {
        return 'Completed';
    }
    return '';
}
/**
 * Active player's accepted Notice Board quests (BR S9-10).
 */
export function QuestLog({ onClose, embedded = false }) {
    const session = useSyncExternalStore(subscribe, getSession);
    const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog);
    const actor = activePlayer(session);
    const entries = actor ? questLogEntries(session, actor.id) : [];
    const rewardText = (featureId) => actor && catalog
        ? questRewardLabelForPlayer(session, catalog, featureId, actor.id)
        : null;
    if (embedded) {
        return (_jsx(GameWindowOverlay, { className: "quest-log-embedded", children: _jsxs(GameWindowModal, { "aria-modal": "true", "aria-labelledby": "quest-log-title", onBackdropClick: onClose, children: [_jsx("h1", { id: "quest-log-title", children: "Quest Log" }), entries.length === 0 ? (_jsx("p", { children: "No accepted quests this week." })) : (_jsx("ul", { className: "world-panel-list", children: entries.map((entry) => {
                            const reward = rewardText(entry.featureId);
                            return (_jsxs("li", { children: [_jsxs("p", { children: [_jsxs("strong", { children: ["Notice Board (T", entry.quest.tier, ") \u2014 near ", entry.townName] }), statusLabel(entry.state)
                                                ? ` — ${statusLabel(entry.state)}`
                                                : ''] }), _jsx("p", { children: entry.quest.flavour_text }), _jsxs("p", { children: ["Goal: ", entry.quest.goal_line] }), reward ? _jsxs("p", { children: ["Reward: ", reward] }) : null] }, entry.featureId));
                        }) })), _jsx("button", { type: "button", className: "date-notice-ok", onClick: onClose, children: "Close" })] }) }));
    }
    return (_jsx("div", { className: "date-notice", role: "dialog", "aria-modal": "true", "aria-labelledby": "quest-log-title", onClick: onClose, children: _jsxs("div", { className: "date-notice-card world-panel-card", onClick: (event) => event.stopPropagation(), children: [_jsx("h1", { id: "quest-log-title", children: "Quest Log" }), entries.length === 0 ? (_jsx("p", { children: "No accepted quests this week." })) : (_jsx("ul", { className: "world-panel-list", children: entries.map((entry) => {
                        const reward = rewardText(entry.featureId);
                        return (_jsxs("li", { children: [_jsxs("p", { children: [_jsxs("strong", { children: ["Notice Board (T", entry.quest.tier, ") \u2014 near ", entry.townName] }), statusLabel(entry.state)
                                            ? ` — ${statusLabel(entry.state)}`
                                            : ''] }), _jsx("p", { children: entry.quest.flavour_text }), _jsxs("p", { children: ["Goal: ", entry.quest.goal_line] }), reward ? _jsxs("p", { children: ["Reward: ", reward] }) : null] }, entry.featureId));
                    }) })), _jsx("button", { type: "button", className: "date-notice-ok", onClick: onClose, children: "Close" })] }) }));
}
