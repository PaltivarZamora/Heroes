import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ENERGY_RESOURCE_ID, MANA_RESOURCE_ID, } from '../combat/abilityStatMath';
import { poolCurrent, poolMax, resourceLabel } from '../combat/heroCast';
import { GameWindowModal } from '../layout/GameWindowModal';
import { GameWindowOverlay } from '../layout/GameWindowOverlay';
import { heroDailyRegenEffective, heroPoolRegenProfile, } from '../items/heroRegen';
import { getSession, subscribe } from '../session/store';
import { getCachedCatalog, heroEffectiveStatsForHero, subscribeCatalog, } from './catalog';
import { classDisciplines } from './libraryRules';
import { HeroAbilitiesPanel } from './HeroAbilitiesPanel';
import { HeroInventory } from './HeroInventory';
import { heroAbilitiesHeader, heroPassiveDisplay } from './heroPassiveDisplay';
import { heroDisplayStats } from './statCatalog';
import { AbilityTip } from './AbilityTip';
function PoolBar({ catalog, hero, resourceId, regenPerDay, }) {
    if (!catalog) {
        return null;
    }
    const current = poolCurrent(hero, resourceId);
    const max = poolMax(catalog, hero, resourceId);
    const label = resourceLabel(catalog, resourceId);
    const kind = resourceId === ENERGY_RESOURCE_ID ? 'energy' : 'mana';
    return (_jsxs("div", { className: "hero-screen-pool-row", children: [_jsxs("div", { className: "combat-hero-resource hero-screen-pool-bar", "data-resource": kind, "aria-label": `${label} pool`, children: [_jsx("span", { className: "combat-hero-resource-fill", style: {
                            width: `${max > 0
                                ? Math.min(100, Math.max(0, (current / max) * 100))
                                : 0}%`,
                        } }), _jsxs("span", { className: "combat-hero-resource-text", children: [label, " (", current, " / ", max, ")"] })] }), _jsxs("span", { className: "hero-screen-pool-regen", children: ["+", regenPerDay, "/day"] })] }));
}
export function HeroScreen({ heroId, onClose, embedded = true, }) {
    const session = useSyncExternalStore(subscribe, getSession);
    const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog);
    const hero = session.heroes.find((row) => row.id === heroId) ?? null;
    const disciplines = catalog && hero?.class_id != null ? classDisciplines(catalog, hero.class_id) : [];
    const [disciplineId, setDisciplineId] = useState(null);
    const learned = hero?.learned_abilities ?? [];
    useEffect(() => {
        if (disciplines.length === 0) {
            setDisciplineId(null);
            return;
        }
        if (disciplineId != null && disciplines.some((row) => row.id === disciplineId)) {
            return;
        }
        setDisciplineId(disciplines[0]?.id ?? null);
    }, [disciplineId, disciplines, heroId]);
    const passive = catalog && hero ? heroPassiveDisplay(catalog, hero) : '';
    const stats = catalog && hero ? heroEffectiveStatsForHero(catalog, hero) : null;
    const statCells = catalog ? heroDisplayStats(catalog) : [];
    const poolProfile = catalog && hero ? heroPoolRegenProfile(catalog, hero) : null;
    const regen = catalog && hero ? heroDailyRegenEffective(catalog, hero) : null;
    const body = (_jsxs("div", { className: "hero-screen-body", "data-tip-contain": true, children: [_jsxs("section", { className: "hero-screen-left", "aria-label": "Hero stats and abilities", children: [_jsxs("div", { className: "hero-screen-left-top", children: [_jsx("h2", { className: "hero-screen-section-title", children: "Stats" }), _jsx("div", { className: "hero-stats-grid", children: statCells.map(({ column, stat }) => {
                                    const tip = stat.description?.trim() ?? '';
                                    const label = (_jsx("span", { className: "hero-stats-label", children: stat.name }));
                                    return (_jsxs("div", { className: "hero-stats-cell", children: [tip ? (_jsx(AbilityTip, { description: tip, children: label })) : (label), _jsx("span", { className: "hero-stats-value", children: stats ? stats[column] : '—' })] }, column));
                                }) }), passive ? (_jsx("p", { className: "hero-screen-passive", children: passive })) : null, poolProfile && regen ? (_jsxs("div", { className: "hero-screen-pools", children: [poolProfile.energy ? (_jsx(PoolBar, { catalog: catalog, hero: hero, resourceId: ENERGY_RESOURCE_ID, regenPerDay: regen.energy })) : null, poolProfile.mana ? (_jsx(PoolBar, { catalog: catalog, hero: hero, resourceId: MANA_RESOURCE_ID, regenPerDay: regen.mana })) : null] })) : null] }), _jsxs("div", { className: "hero-screen-left-bottom", children: [_jsx("h2", { className: "hero-screen-section-title", children: catalog ? heroAbilitiesHeader(catalog, hero) : 'Abilities' }), catalog ? (_jsx(HeroAbilitiesPanel, { catalog: catalog, learned: learned, disciplines: disciplines, disciplineId: disciplineId, onDisciplineId: setDisciplineId, hero: hero })) : null] })] }), _jsx("section", { className: "hero-screen-right", "aria-label": "Inventory", children: catalog && hero ? (_jsx(HeroInventory, { catalog: catalog, hero: hero, inCombat: false })) : null })] }));
    if (!embedded) {
        return (_jsxs("div", { className: "town-management hero-screen", role: "dialog", "aria-modal": "true", "aria-labelledby": "hero-screen-title", "data-tip-contain": true, children: [_jsxs("header", { className: "town-management-bar", children: [_jsx("h1", { id: "hero-screen-title", children: hero?.name ?? 'Hero' }), _jsx("button", { type: "button", onClick: onClose, children: "Close" })] }), body] }));
    }
    return (_jsx(GameWindowOverlay, { className: "hero-screen-embedded game-window-overlay-host", children: _jsxs(GameWindowModal, { className: "hero-screen-modal", "aria-modal": "true", "aria-labelledby": "hero-screen-title", onBackdropClick: onClose, "data-tip-contain": true, children: [_jsx("h1", { id: "hero-screen-title", className: "hero-screen-title", children: hero?.name ?? 'Hero' }), body] }) }));
}
