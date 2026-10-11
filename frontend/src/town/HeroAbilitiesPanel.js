import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { abilityTooltip } from './abilityTooltip';
import { LIBRARY_TIERS, learnedAbilitiesAtTier, tierLabel, } from './libraryRules';
import { AbilityTip } from './AbilityTip';
export function HeroAbilitiesPanel({ catalog, learned, disciplines, disciplineId, onDisciplineId, hero = null, onSelectAbility, canSelectAbility, unavailableMessage, }) {
    return (_jsxs(_Fragment, { children: [disciplines.length > 0 ? (_jsx("div", { className: disciplines.length === 1
                    ? 'hero-discipline-tabs hero-discipline-tabs-solo'
                    : 'hero-discipline-tabs', children: disciplines.map((discipline) => (_jsx("button", { type: "button", className: discipline.id === disciplineId ? 'active' : undefined, onClick: () => onDisciplineId(discipline.id), children: discipline.name }, discipline.id))) })) : null, disciplineId != null
                ? LIBRARY_TIERS.map((level) => {
                    const rows = learnedAbilitiesAtTier(catalog, learned, disciplineId, level);
                    return (_jsxs("div", { className: "hero-ability-tier", children: [_jsx("h3", { children: tierLabel(catalog, level) }), rows.length === 0 ? (_jsx("p", { className: "hero-ability-empty", children: "None learned" })) : (_jsx("ul", { className: onSelectAbility
                                    ? `hero-ability-list hero-ability-list-cast hero-ability-list-tier-${level}`
                                    : `hero-ability-list hero-ability-list-tier-${level}`, children: rows.map((ability) => {
                                    const allowed = canSelectAbility == null || canSelectAbility(ability);
                                    const lock = !allowed
                                        ? (unavailableMessage?.(ability) ?? null)
                                        : null;
                                    const label = onSelectAbility
                                        ? `${ability.name} (${ability.cost})`
                                        : ability.name;
                                    return (_jsx("li", { children: _jsx(AbilityTip, { description: abilityTooltip(catalog, ability, hero), children: onSelectAbility ? (_jsxs("button", { type: "button", className: "hero-ability-name", disabled: !allowed, onClick: () => {
                                                    if (allowed) {
                                                        onSelectAbility(ability);
                                                    }
                                                }, children: [label, lock ? (_jsx("span", { className: "hero-ability-lock", children: lock })) : null] })) : (_jsx("span", { className: "hero-ability-name", children: label })) }) }, ability.id));
                                }) }))] }, level));
                })
                : null] }));
}
