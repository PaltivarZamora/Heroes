import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { xpToReachLevel } from '../town/catalog';
import { classDisciplines } from '../town/libraryRules';
import { HeroAbilitiesPanel } from '../town/HeroAbilitiesPanel';
import { heroAbilitiesHeader } from '../town/heroPassiveDisplay';
import { abilityCooldownMessage, abilityCooldownReady, canAffordAbility, disciplineResourceId, poolCurrent, poolMax, resourceLabel, } from './heroCast';
import { abilityMeetsCastGate } from './summon';
export function HeroAbilityPopup({ catalog, hero, learned, canCast, battle, casterSide, onCancel, onChoose, footer, }) {
    const disciplines = classDisciplines(catalog, hero.class_id ?? -1);
    const [disciplineId, setDisciplineId] = useState(disciplines[0]?.id ?? null);
    useEffect(() => {
        if (disciplines.length === 0) {
            setDisciplineId(null);
            return;
        }
        if (disciplineId != null && disciplines.some((row) => row.id === disciplineId)) {
            return;
        }
        setDisciplineId(disciplines[0]?.id ?? null);
    }, [disciplineId, disciplines]);
    const title = heroAbilitiesHeader(catalog, hero);
    const selectedDiscipline = disciplines.find((row) => row.id === disciplineId) ?? null;
    const resourceId = disciplineId != null ? disciplineResourceId(catalog, disciplineId) : null;
    const resourceName = selectedDiscipline?.name ??
        (resourceId != null ? resourceLabel(catalog, resourceId) : '');
    const current = resourceId != null ? poolCurrent(hero, resourceId) : 0;
    const max = resourceId != null ? poolMax(catalog, hero, resourceId) : 0;
    const level = hero.current_level ?? 1;
    const xp = hero.current_xp ?? 0;
    const xpNext = xpToReachLevel(catalog, level);
    const xpPct = xpNext != null && xpNext > 0
        ? Math.min(100, Math.max(0, (xp / xpNext) * 100))
        : 100;
    const xpLabel = xpNext != null ? `XP (${xp} / ${xpNext})` : `XP (${xp})`;
    return (_jsx("div", { className: "combat-hero-popup", role: "dialog", "aria-modal": "true", "aria-labelledby": "combat-hero-popup-title", children: _jsxs("div", { className: "combat-hero-popup-card", "data-tip-contain": "", children: [_jsx("button", { type: "button", className: "combat-hero-popup-close", "aria-label": "Close", onClick: onCancel, children: "\u00D7" }), _jsx("h2", { id: "combat-hero-popup-title", className: "hero-abilities-header", children: title }), _jsxs("p", { className: "combat-hero-popup-identity", children: [hero.name, " \u2014 Lvl ", level] }), _jsxs("div", { className: "combat-hero-resource", "data-resource": "xp", "aria-label": "Experience", children: [_jsx("span", { className: "combat-hero-resource-fill", style: { width: `${xpPct}%` } }), _jsx("span", { className: "combat-hero-resource-text", children: xpLabel })] }), resourceId != null ? (_jsxs("div", { className: "combat-hero-resource", "data-resource": resourceId === 1 ? 'energy' : 'mana', "aria-label": `${resourceName} pool`, children: [_jsx("span", { className: "combat-hero-resource-fill", style: {
                                width: `${max > 0 ? Math.min(100, Math.max(0, (current / max) * 100)) : 0}%`,
                            } }), _jsxs("span", { className: "combat-hero-resource-text", children: [resourceName, " (", current, " / ", max, ")"] })] })) : null, _jsx(HeroAbilitiesPanel, { catalog: catalog, learned: learned, disciplines: disciplines, disciplineId: disciplineId, onDisciplineId: setDisciplineId, hero: hero, onSelectAbility: onChoose, canSelectAbility: (ability) => canCast &&
                        canAffordAbility(hero, ability) &&
                        abilityCooldownReady(hero, ability) &&
                        abilityMeetsCastGate(catalog, ability, battle, casterSide), unavailableMessage: (ability) => abilityCooldownMessage(hero, ability) }), footer ? (_jsx("div", { className: "combat-hero-popup-footer", children: footer })) : null] }) }));
}
