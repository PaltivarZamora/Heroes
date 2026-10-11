import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState, useSyncExternalStore } from 'react';
import { findWorldRecruitsById, recordWorldRecruitsKnowledge, recruitFromWorldRecruits, worldRecruitsMaxQty, } from '../session/recruits';
import { walletFromSession } from '../session/accessors';
import { getSession, subscribe, updateSession } from '../session/store';
import { formatCost, getCachedCatalog, maxAffordableQty, scaleCost, subscribeCatalog, unitById, unitCost, } from './catalog';
import { AbilityTip } from './AbilityTip';
import { formatToolkitRows, sessionUnitToolkitRows, } from './UnitToolkitTip';
import { UnitStackFace } from './unitStack';
/**
 * Compact Recruits for Hire popup (BR S9-9).
 * Graphic (stock on portrait) + qty/cost row + Confirm / Cancel.
 */
export function WorldRecruits({ featureId, heroId, onClose, embedded = false, }) {
    const session = useSyncExternalStore(subscribe, getSession);
    const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog);
    const feature = findWorldRecruitsById(session, featureId);
    const hero = session.heroes.find((row) => row.id === heroId) ?? null;
    const wallet = walletFromSession(session);
    const [error, setError] = useState(null);
    const [qtyText, setQtyText] = useState('1');
    useEffect(() => {
        if (!hero || !feature) {
            return;
        }
        updateSession((current) => recordWorldRecruitsKnowledge(current, featureId, hero.player_id));
    }, [featureId, hero?.id, hero?.player_id, feature?.id]);
    const unit = catalog && feature && feature.unit_id > 0
        ? unitById(catalog, feature.unit_id)
        : null;
    const perUnitCost = unitCost(unit);
    const stock = feature?.stock ?? 0;
    const maxQty = catalog && feature && hero
        ? worldRecruitsMaxQty(session, catalog, feature, hero.id, wallet)
        : 0;
    useEffect(() => {
        setQtyText(String(Math.max(1, maxQty > 0 ? maxQty : 1)));
        setError(null);
    }, [feature?.unit_id, feature?.stock, maxQty]);
    const parsedQty = Math.max(1, Number.parseInt(qtyText, 10) || 1);
    const buyQty = Math.min(parsedQty, Math.max(1, maxAffordableQty(wallet, perUnitCost, stock)));
    const canRecruit = stock >= 1 && unit != null && maxQty >= 1;
    const tipRows = catalog && unit
        ? sessionUnitToolkitRows(catalog, unit.id, Math.max(1, stock))
        : [];
    const recruit = () => {
        if (!catalog || !hero || !feature || !canRecruit) {
            return;
        }
        let buyError = null;
        let remaining = stock;
        updateSession((current) => {
            const result = recruitFromWorldRecruits(current, catalog, featureId, hero.id, buyQty);
            buyError = result.error;
            if (!result.error) {
                const live = findWorldRecruitsById(result.session, featureId);
                remaining = live?.stock ?? 0;
            }
            return result.error ? current : result.session;
        });
        if (buyError) {
            setError(buyError);
            return;
        }
        if (remaining < 1) {
            onClose();
        }
    };
    const panel = (_jsx("div", { className: embedded ? 'game-window-modal' : 'date-notice', role: "dialog", "aria-modal": "true", "aria-labelledby": "world-recruits-title", onClick: onClose, children: _jsxs("div", { className: "date-notice-card world-panel-card world-recruits-card", "data-tip-contain": "", onClick: (event) => event.stopPropagation(), children: [_jsx("h1", { id: "world-recruits-title", children: "Recruits for Hire" }), !catalog || !feature || !hero ? (_jsx("p", { children: "Loading\u2026" })) : !unit ? (_jsxs(_Fragment, { children: [_jsx("p", { children: "No units available this week." }), _jsx("button", { type: "button", className: "date-notice-ok", onClick: onClose, children: "Cancel" })] })) : (_jsxs(_Fragment, { children: [_jsx(AbilityTip, { description: formatToolkitRows(tipRows), children: _jsxs("div", { className: "world-recruits-art", children: [_jsx(UnitStackFace, { empty: false, filename: unit.image_path?.trim() || null, qty: stock }), _jsx("p", { className: "world-recruits-name", children: unit.name.trim() })] }) }), stock < 1 ? (_jsx("p", { children: "Sold out this week." })) : (_jsxs("div", { className: "world-recruits-row", children: [_jsxs("label", { className: "world-recruits-qty", children: ["Qty", _jsx("input", { type: "number", min: 1, max: stock, value: qtyText, onChange: (event) => setQtyText(event.target.value) })] }), _jsxs("span", { className: "world-recruits-cost", children: ["Cost ", formatCost(scaleCost(perUnitCost, buyQty))] })] })), error ? _jsx("p", { className: "world-recruits-error", children: error }) : null, _jsx("button", { type: "button", className: "date-notice-ok", disabled: !canRecruit, onClick: recruit, children: "Confirm" }), _jsx("button", { type: "button", className: "date-notice-ok", onClick: onClose, children: "Cancel" })] }))] }) }));
    return embedded ? _jsx("div", { className: "game-window-embed", children: panel }) : panel;
}
