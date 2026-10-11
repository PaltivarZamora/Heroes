import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useSyncExternalStore } from 'react';
import { formatAmount, GOLD_RESOURCE_ID } from '../hex/resources';
import { findWorldHangerById, flightDestinationsFromOrigin, launchHeroFlight, walletFromSession, } from '../session/accessors';
import { getSession, subscribe, updateSession } from '../session/store';
import { flightSpeed, getCachedCatalog, subscribeCatalog, } from './catalog';
/**
 * Flight destination picker for a world-map Hanger (BR S9-6).
 */
export function WorldHangerFlight({ featureId, heroId, onClose, onFlyLaunched, embedded = false, }) {
    const session = useSyncExternalStore(subscribe, getSession);
    const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog);
    const feature = findWorldHangerById(session, featureId);
    const hero = session.heroes.find((row) => row.id === heroId) ?? null;
    const [error, setError] = useState(null);
    const wallet = walletFromSession(session);
    const goldOnHand = wallet[GOLD_RESOURCE_ID]?.stockpile ?? 0;
    const dests = catalog && feature && hero
        ? flightDestinationsFromOrigin(session, catalog, feature.position, hero.player_id, hero.id)
        : [];
    const launch = (townId, blocked, goldCost) => {
        if (!hero || blocked) {
            if (blocked) {
                setError('That destination is blocked.');
            }
            return;
        }
        if (goldOnHand < goldCost) {
            setError('Not enough gold.');
            return;
        }
        let launchError = null;
        updateSession((current) => {
            const result = launchHeroFlight(current, hero.id, townId);
            launchError = result.error;
            return result.session;
        });
        if (launchError) {
            setError(launchError);
            return;
        }
        onFlyLaunched(hero.id);
    };
    const panel = (_jsx("div", { className: embedded ? 'game-window-modal' : 'date-notice', role: "dialog", "aria-modal": "true", "aria-labelledby": "world-hanger-title", onClick: onClose, children: _jsxs("div", { className: "date-notice-card world-panel-card", onClick: (event) => event.stopPropagation(), children: [_jsx("h1", { id: "world-hanger-title", children: "Hanger" }), !catalog || !feature || !hero ? (_jsx("p", { children: "Loading\u2026" })) : dests.length === 0 ? (_jsxs(_Fragment, { children: [_jsx("p", { children: "You have no towns with a Hanger." }), _jsx("button", { type: "button", className: "date-notice-ok", onClick: onClose, children: "Cancel" })] })) : (_jsxs(_Fragment, { children: [_jsx("p", { children: "Fly to:" }), _jsx("div", { className: "world-panel-list", children: dests.map((dest) => {
                                const afford = goldOnHand >= dest.goldCost;
                                const selectable = afford && !dest.blocked;
                                const typeName = catalog.town.find((row) => row.id === dest.town.town_type_id)
                                    ?.name?.trim() || 'Town';
                                const days = Math.max(1, Math.ceil(dest.distance / flightSpeed(catalog)));
                                return (_jsxs("button", { type: "button", className: "world-panel-choice", disabled: !selectable, onClick: () => launch(dest.town.id, dest.blocked, dest.goldCost), children: [typeName, ": ", dest.town.name, _jsxs("span", { children: [formatAmount(dest.goldCost), " Gold \u00B7 ", days, ' ', days === 1 ? 'Day' : 'Days', dest.blocked
                                                    ? ' · Blocked'
                                                    : afford
                                                        ? ''
                                                        : ' · Need gold'] })] }, dest.town.id));
                            }) }), error ? _jsx("p", { className: "world-panel-error", children: error }) : null, _jsx("button", { type: "button", className: "date-notice-ok", onClick: onClose, children: "Cancel" })] }))] }) }));
    return embedded ? _jsx("div", { className: "game-window-embed", children: panel }) : panel;
}
