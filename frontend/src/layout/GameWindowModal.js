import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Centred overlay inside the 1273×840 game window (not the browser viewport).
 * Parent must be `.game-window` or another positioned game-window embed.
 */
export function GameWindowModal({ children, onBackdropClick, role = 'dialog', className, ...aria }) {
    return (_jsx("div", { className: `game-window-modal${className ? ` ${className}` : ''}`, role: role, onClick: onBackdropClick, ...aria, children: _jsx("div", { className: "game-window-modal-card date-notice-card", onClick: (event) => event.stopPropagation(), children: children }) }));
}
