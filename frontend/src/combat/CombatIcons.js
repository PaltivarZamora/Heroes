import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
function KindSvg({ kind }) {
    if (kind === 'move') {
        return (_jsxs("svg", { className: "combat-target-svg", viewBox: "0 0 32 32", "aria-hidden": "true", children: [_jsx("path", { d: "M8 14 L16 6 L24 14", fill: "none", stroke: "#fff59d", strokeWidth: "2.6", strokeLinecap: "round", strokeLinejoin: "round" }), _jsx("path", { d: "M8 22 L16 14 L24 22", fill: "none", stroke: "#ffe082", strokeWidth: "2.6", strokeLinecap: "round", strokeLinejoin: "round" })] }));
    }
    if (kind === 'hero') {
        return (_jsx("svg", { className: "combat-target-svg", viewBox: "0 0 32 32", "aria-hidden": "true", children: _jsx("path", { d: "M16 4 L19 12 L28 12 L21 17 L24 26 L16 21 L8 26 L11 17 L4 12 L13 12 Z", fill: "#81c784", stroke: "#c8e6c9", strokeWidth: "1.4", strokeLinejoin: "round" }) }));
    }
    if (kind === 'invalid') {
        return (_jsxs("svg", { className: "combat-target-svg", viewBox: "0 0 32 32", "aria-hidden": "true", children: [_jsx("circle", { cx: "16", cy: "16", r: "11", fill: "none", stroke: "#ef9a9a", strokeWidth: "2.4" }), _jsx("path", { d: "M10 10 L22 22 M22 10 L10 22", stroke: "#ef9a9a", strokeWidth: "2.4", strokeLinecap: "round" })] }));
    }
    if (kind === 'aoe') {
        return (_jsxs("svg", { className: "combat-target-svg", viewBox: "0 0 32 32", "aria-hidden": "true", children: [_jsx("circle", { cx: "16", cy: "16", r: "11", fill: "none", stroke: "#80deea", strokeWidth: "2" }), _jsx("circle", { cx: "16", cy: "16", r: "6", fill: "none", stroke: "#e0f7fa", strokeWidth: "1.8" }), _jsx("path", { d: "M16 3 V9 M16 23 V29 M3 16 H9 M23 16 H29", stroke: "#80deea", strokeWidth: "2", strokeLinecap: "round" })] }));
    }
    if (kind === 'magic') {
        return (_jsxs("svg", { className: "combat-target-svg", viewBox: "0 0 32 32", "aria-hidden": "true", children: [_jsx("circle", { cx: "16", cy: "16", r: "5", fill: "#ffe082" }), _jsx("path", { d: "M16 2 L18 12 L16 10 L14 12 Z M30 16 L20 18 L22 16 L20 14 Z M16 30 L14 20 L16 22 L18 20 Z M2 16 L12 14 L10 16 L12 18 Z M26 6 L19 13 L21 12 L22 10 Z M26 26 L19 19 L21 20 L22 22 Z M6 26 L13 19 L11 20 L10 22 Z M6 6 L13 13 L11 12 L10 10 Z", fill: "#ffeb3b" })] }));
    }
    if (kind === 'ranged') {
        return (_jsxs("svg", { className: "combat-target-svg", viewBox: "0 0 32 32", "aria-hidden": "true", children: [_jsx("path", { d: "M6 6 Q22 16 6 26", fill: "none", stroke: "#eceff1", strokeWidth: "2.4", strokeLinecap: "round" }), _jsx("path", { d: "M4 16 H26", stroke: "#ffcc80", strokeWidth: "2" }), _jsx("path", { d: "M24 12 L30 16 L24 20 Z", fill: "#ffcc80" })] }));
    }
    return (_jsxs("svg", { className: "combat-target-svg", viewBox: "0 0 32 32", "aria-hidden": "true", children: [_jsx("path", { d: "M8 26 L12 6 L15 7 L11 27 Z", fill: "#b0bec5", transform: "rotate(-32 16 16)" }), _jsx("path", { d: "M8 26 L12 6 L15 7 L11 27 Z", fill: "#cfd8dc", transform: "rotate(32 16 16)" }), _jsx("circle", { cx: "16", cy: "16", r: "2.2", fill: "#ffe082" })] }));
}
export function CombatTargetIcon({ kind, arrowDeg }) {
    return (_jsxs(_Fragment, { children: [_jsx(KindSvg, { kind: kind }), arrowDeg != null ? (_jsxs("svg", { className: "combat-wedge-arrow", viewBox: "0 0 32 32", "aria-hidden": "true", style: {
                    transform: `translate(-50%, -50%) rotate(${arrowDeg}deg) translateX(110%)`,
                }, children: [_jsx("path", { d: "M6 16 H22", fill: "none", stroke: "#fff59d", strokeWidth: "3.2", strokeLinecap: "round" }), _jsx("path", { d: "M18 9 L28 16 L18 23 Z", fill: "#fff59d" })] })) : null] }));
}
