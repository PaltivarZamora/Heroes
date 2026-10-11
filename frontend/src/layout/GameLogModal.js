import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { GameWindowModal } from './GameWindowModal';
import { GameWindowOverlay } from './GameWindowOverlay';
import { getSession, subscribe } from '../session/store';
import { getCachedCatalog, subscribeCatalog } from '../town/catalog';
import { formatCombatArchiveLines, formattedTabLines, logViewPlayerId, playerGameLog, } from '../session/gameLog';
const TABS = [
    { id: 'world', label: 'World' },
    { id: 'town', label: 'Town' },
    { id: 'enemy', label: 'Enemy' },
    { id: 'combat', label: 'Combat' },
];
export function GameLogModal({ open, initialTab, focusCombatId, liveCombatLines = [], onClose, }) {
    const session = useSyncExternalStore(subscribe, getSession);
    const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog);
    const [tab, setTab] = useState(initialTab);
    const scrollRef = useRef(null);
    useEffect(() => {
        if (open) {
            setTab(initialTab);
        }
    }, [open, initialTab]);
    const playerId = logViewPlayerId(session);
    const liveCombat = useMemo(() => liveCombatLines.filter((line) => line.trim().length > 0), [liveCombatLines]);
    const lines = useMemo(() => {
        if (tab !== 'combat') {
            return formattedTabLines(session, catalog, playerId, tab);
        }
        const archived = formattedTabLines(session, catalog, playerId, tab);
        const live = liveCombat.map((text) => ({ text }));
        return [...archived, ...live];
    }, [session, catalog, playerId, tab, liveCombat]);
    useEffect(() => {
        if (!open || !focusCombatId || tab !== 'combat') {
            return;
        }
        const el = scrollRef.current?.querySelector(`[data-combat-id="${focusCombatId}"]`);
        el?.scrollIntoView({ block: 'start' });
    }, [open, focusCombatId, tab, lines.length]);
    if (!open) {
        return null;
    }
    return (_jsx(GameWindowOverlay, { className: "game-log-embedded", children: _jsxs(GameWindowModal, { "aria-labelledby": "game-log-title", onBackdropClick: onClose, className: "game-log-modal", children: [_jsx("h1", { id: "game-log-title", children: "Game log" }), _jsx("div", { className: "game-log-tabs", role: "tablist", children: TABS.map((item) => (_jsx("button", { type: "button", role: "tab", "aria-selected": tab === item.id, className: tab === item.id ? 'game-log-tab-active' : undefined, onClick: () => setTab(item.id), children: item.label }, item.id))) }), _jsx("div", { className: "game-log-scroll", ref: scrollRef, children: lines.length === 0 ? (_jsx("p", { className: "settings-hint", children: "No entries yet." })) : tab === 'combat' ? (_jsxs(_Fragment, { children: [playerGameLog(session, playerId).combat.map((archive) => (_jsx("section", { className: "game-log-combat-block", "data-combat-id": archive.id, children: formatCombatArchiveLines(archive).map((line, index) => (_jsx("p", { className: "game-log-line", children: line }, `${archive.id}-${index}`))) }, archive.id))), liveCombat.length > 0 ? (_jsx("section", { className: "game-log-combat-block game-log-combat-live", "data-combat-id": "live", children: liveCombat.map((line, index) => (_jsx("p", { className: "game-log-line", children: line }, `live-${index}`))) })) : null] })) : (lines.map((line, index) => (_jsx(LogLineRow, { line: line, onOpenCombat: () => {
                            if (line.detailsCombatId) {
                                setTab('combat');
                            }
                        } }, `${tab}-${index}`)))) }), _jsx("button", { type: "button", className: "date-notice-ok", onClick: onClose, children: "Close" })] }) }));
}
function LogLineRow({ line, onOpenCombat, }) {
    if (!line.detailsCombatId) {
        if (line.segments && line.segments.length > 0) {
            return (_jsx("p", { className: "game-log-line", children: line.segments.map((segment, index) => segment.color ? (_jsx("span", { style: { color: segment.color }, children: segment.text }, index)) : (_jsx("span", { children: segment.text }, index))) }));
        }
        return _jsx("p", { className: "game-log-line", children: line.text });
    }
    return (_jsxs("p", { className: "game-log-line", children: [line.text, ' ', _jsx("button", { type: "button", className: "game-log-details-link", onClick: onOpenCombat, children: "[details]" })] }));
}
export function bannerLogLines(session, catalog, tab, liveCombatLines, scrollBack) {
    if (tab === 'combat' && liveCombatLines.length > 0) {
        const start = Math.max(0, liveCombatLines.length - 3 - scrollBack);
        return liveCombatLines.slice(start, start + 3).map((text) => ({ text }));
    }
    const formatted = formattedTabLines(session, catalog, logViewPlayerId(session), tab);
    const start = Math.max(0, formatted.length - 3 - scrollBack);
    return formatted.slice(start, start + 3);
}
export function maxBannerLogScroll(session, catalog, tab, liveCombatLines) {
    const total = tab === 'combat' && liveCombatLines.length > 0
        ? liveCombatLines.length
        : formattedTabLines(session, catalog, logViewPlayerId(session), tab).length;
    return Math.max(0, total - 3);
}
export function defaultLogTab(inCombat, inTown) {
    if (inCombat) {
        return 'combat';
    }
    if (inTown) {
        return 'town';
    }
    return 'world';
}
