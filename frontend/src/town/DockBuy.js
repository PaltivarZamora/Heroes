import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useSyncExternalStore } from 'react';
import { formatAmount, GOLD_RESOURCE_ID } from '../hex/resources';
import { boatCostGold, findBoatAt } from '../hex/boat';
import { buyBoatAtDock, findWorldDockById, } from '../session/boat';
import { walletFromSession } from '../session/accessors';
import { getSession, subscribe, updateSession } from '../session/store';
import { getCachedCatalog, subscribeCatalog } from './catalog';
/**
 * Dock buy-boat popup (BR S9-8).
 */
export function DockBuy({ featureId, heroId, onClose, embedded = false, }) {
    const session = useSyncExternalStore(subscribe, getSession);
    const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog);
    const dock = findWorldDockById(session, featureId);
    const hero = session.heroes.find((row) => row.id === heroId) ?? null;
    const [error, setError] = useState(null);
    const wallet = walletFromSession(session);
    const goldOnHand = wallet[GOLD_RESOURCE_ID]?.stockpile ?? 0;
    const cost = boatCostGold(catalog);
    const launchBoat = dock
        ? findBoatAt(session, dock.launch.q, dock.launch.r)
        : undefined;
    const boatWaiting = launchBoat != null;
    const afford = goldOnHand >= cost;
    const canBuy = !boatWaiting && afford && hero != null;
    const buy = () => {
        if (!hero || !canBuy) {
            return;
        }
        let buyError = null;
        updateSession((current) => {
            const result = buyBoatAtDock(current, featureId, hero.player_id);
            buyError = result.error;
            return result.session;
        });
        if (buyError) {
            setError(buyError);
            return;
        }
        onClose();
    };
    const disabledReason = boatWaiting
        ? 'A boat is already waiting.'
        : !afford
            ? `Not enough Gold (need ${formatAmount(cost)}, have ${formatAmount(goldOnHand)})`
            : null;
    const panel = (_jsx("div", { className: embedded ? 'game-window-modal' : 'date-notice', role: "dialog", "aria-modal": "true", "aria-labelledby": "dock-buy-title", onClick: onClose, children: _jsxs("div", { className: "date-notice-card world-panel-card", onClick: (event) => event.stopPropagation(), children: [_jsx("h1", { id: "dock-buy-title", children: "Dock" }), !dock || !hero ? (_jsx("p", { children: "Loading\u2026" })) : (_jsxs(_Fragment, { children: [_jsxs("p", { className: "world-panel-cost", children: ["Cost ", formatAmount(cost), " Gold"] }), error ? _jsx("p", { className: "world-panel-error", children: error }) : null, disabledReason && !error ? (_jsx("p", { className: "world-panel-error", children: disabledReason })) : null, _jsx("button", { type: "button", className: "date-notice-ok", disabled: !canBuy, onClick: buy, children: "Confirm" }), _jsx("button", { type: "button", className: "date-notice-ok", onClick: onClose, children: "Cancel" })] }))] }) }));
    return embedded ? _jsx("div", { className: "game-window-embed", children: panel }) : panel;
}
