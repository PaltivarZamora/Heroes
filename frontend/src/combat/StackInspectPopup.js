import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { inspectActiveEffects, inspectRows } from './inspect';
export function StackInspectPopup({ catalog, stack, viewerSide, battle, heroes, onClose, }) {
    const rows = inspectRows(stack, catalog, viewerSide, battle, heroes);
    const effects = inspectActiveEffects(stack, catalog, viewerSide, battle, heroes);
    const title = rows.find((row) => row.label === 'name')?.value ?? 'Stack';
    return (_jsx("div", { className: "combat-hero-popup combat-inspect-popup", role: "dialog", "aria-modal": "true", "aria-labelledby": "combat-inspect-title", onClick: onClose, children: _jsxs("div", { className: "combat-hero-popup-card combat-inspect-card", onClick: (event) => event.stopPropagation(), children: [_jsx("button", { type: "button", className: "combat-hero-popup-close", "aria-label": "Close", onClick: onClose, children: "\u00D7" }), _jsx("h2", { id: "combat-inspect-title", children: title }), effects.length > 0 ? (_jsxs("section", { className: "combat-inspect-conditions", "aria-label": "Active effects", children: [_jsx("h3", { children: "Active effects" }), _jsx("ul", { children: effects.map((row) => (_jsxs("li", { children: [_jsx("span", { children: row.label }), _jsx("span", { children: row.value })] }, `${row.label}:${row.value}`))) })] })) : null, _jsx("dl", { className: "combat-inspect-stats", children: rows.map((row) => (_jsxs("div", { className: "combat-inspect-row", children: [_jsx("dt", { children: row.label }), _jsx("dd", { children: row.value })] }, row.label))) })] }) }));
}
