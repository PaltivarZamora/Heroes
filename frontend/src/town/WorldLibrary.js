import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useSyncExternalStore } from 'react';
import { formatAmount } from '../hex/resources';
import { findWorldLibraryById, learnWorldLibraryAbility, recordWorldLibraryVisit, } from '../session/accessors';
import { getSession, subscribe, updateSession } from '../session/store';
import { getCachedCatalog, libraryGoldCost, subscribeCatalog } from './catalog';
import { abilityTooltip } from './abilityTooltip';
import { AbilityTip } from './AbilityTip';
import { abilityById, worldLibrarySlotKind, } from './libraryRules';
/**
 * World-map Library shop (BR S9-5). Compact panel with rolled ability slots.
 */
export function WorldLibrary({ featureId, heroId, onClose, embedded = false, }) {
    const session = useSyncExternalStore(subscribe, getSession);
    const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog);
    const feature = findWorldLibraryById(session, featureId);
    const hero = session.heroes.find((row) => row.id === heroId) ?? null;
    const [message, setMessage] = useState(null);
    const visitor = hero != null
        ? {
            classId: hero.class_id,
            learned: hero.learned_abilities ?? [],
        }
        : null;
    const abilities = catalog && feature
        ? feature.ability_ids
            .map((id) => abilityById(catalog, id))
            .filter((row) => row != null)
            .slice()
            .sort((a, b) => a.level_id - b.level_id ||
            a.discipline_id - b.discipline_id ||
            a.id - b.id)
        : [];
    const buy = (abilityId) => {
        if (!catalog || !hero) {
            return;
        }
        let error = null;
        updateSession((current) => {
            const result = learnWorldLibraryAbility(current, catalog, featureId, hero.id, abilityId);
            error = result.error;
            return result.error ? current : result.session;
        });
        setMessage(error);
    };
    const panel = (_jsx("div", { className: embedded ? 'game-window-modal' : 'date-notice', role: "dialog", "aria-modal": "true", "aria-labelledby": "world-library-title", onClick: onClose, children: _jsxs("div", { className: "date-notice-card world-panel-card", "data-tip-contain": "", onClick: (event) => event.stopPropagation(), children: [_jsx("h1", { id: "world-library-title", children: "Library" }), !catalog || !feature ? (_jsx("p", { children: "Loading\u2026" })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "library-grid library-grid-world world-panel-library", children: abilities.map((ability) => {
                                const discipline = catalog.discipline.find((row) => row.id === ability.discipline_id)?.name ?? 'Discipline';
                                const kind = worldLibrarySlotKind(ability.id, visitor, catalog, ability.discipline_id);
                                const cost = libraryGoldCost(catalog, ability.level_id);
                                const label = `${discipline}: ${ability.name}`;
                                const clickable = kind === 'buyable';
                                return (_jsx("button", { type: "button", className: `library-slot library-slot-${kind}`, disabled: !clickable, onClick: () => {
                                        if (clickable) {
                                            buy(ability.id);
                                        }
                                    }, children: _jsxs(AbilityTip, { description: abilityTooltip(catalog, ability, hero), children: [label, kind === 'buyable' ? (_jsxs("span", { className: "library-slot-cost", children: [formatAmount(cost), " Gold"] })) : null] }) }, ability.id));
                            }) }), message ? _jsx("p", { className: "world-panel-error", children: message }) : null, _jsx("button", { type: "button", className: "date-notice-ok", onClick: onClose, children: "Cancel" })] }))] }) }));
    return embedded ? _jsx("div", { className: "game-window-embed", children: panel }) : panel;
}
/** Mark visit when the panel opens (for map tooltip). */
export function openWorldLibraryVisit(featureId, playerId) {
    updateSession((current) => recordWorldLibraryVisit(current, featureId, playerId));
}
/** Map hover: unread → "Library"; else one `Discipline: Ability` line each. */
export function worldLibraryTooltipText(feature, catalog, playerId) {
    if (!playerId || !feature.visited_by_player[playerId]) {
        return 'Library';
    }
    const lines = [];
    const abilities = feature.ability_ids
        .map((id) => abilityById(catalog, id))
        .filter((row) => row != null)
        .slice()
        .sort((a, b) => a.level_id - b.level_id ||
        a.discipline_id - b.discipline_id ||
        a.id - b.id);
    for (const ability of abilities) {
        const discipline = catalog.discipline.find((row) => row.id === ability.discipline_id)
            ?.name ?? 'Discipline';
        lines.push(`${discipline}: ${ability.name}`);
    }
    return lines.length > 0 ? lines.join('\n') : 'Library';
}
