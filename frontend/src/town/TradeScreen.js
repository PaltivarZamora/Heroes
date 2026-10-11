import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useSyncExternalStore } from 'react';
import { getSelectedMapHeroId } from '../hex/HexMap';
import { GameWindowModal } from '../layout/GameWindowModal';
import { GameWindowOverlay } from '../layout/GameWindowOverlay';
import { getSession, subscribe } from '../session/store';
import { getCachedCatalog, subscribeCatalog } from './catalog';
import { HeroInventory } from './HeroInventory';
export function TradeScreen({ activeHeroId, partnerHeroId, onClose, }) {
    const session = useSyncExternalStore(subscribe, getSession);
    const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog);
    const active = session.heroes.find((row) => row.id === activeHeroId) ??
        session.heroes.find((row) => row.id === getSelectedMapHeroId()) ??
        null;
    const partner = session.heroes.find((row) => row.id === partnerHeroId) ?? null;
    if (!catalog || !active || !partner) {
        return null;
    }
    return (_jsx(GameWindowOverlay, { className: "trade-screen-embedded game-window-overlay-host", children: _jsxs(GameWindowModal, { className: "trade-screen-modal", "aria-modal": "true", "aria-labelledby": "trade-screen-title", onBackdropClick: onClose, children: [_jsxs("h1", { id: "trade-screen-title", className: "trade-screen-title", children: ["Trade \u2014 ", active.name, " & ", partner.name] }), _jsxs("div", { className: "trade-screen-body", "data-tip-contain": true, children: [_jsx("section", { className: "trade-screen-half", "aria-label": `${partner.name} inventory`, children: _jsx(HeroInventory, { catalog: catalog, hero: partner, inCombat: false, tradePeerHeroId: active.id }) }), _jsx("section", { className: "trade-screen-half", "aria-label": `${active.name} inventory`, children: _jsx(HeroInventory, { catalog: catalog, hero: active, inCombat: false, tradePeerHeroId: partner.id }) })] })] }) }));
}
