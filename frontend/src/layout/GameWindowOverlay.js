import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Fills the game window above world / town / battle / map views (z-index 50).
 * Children (e.g. GameWindowModal) receive pointer events.
 */
export function GameWindowOverlay({ children, className, }) {
    return (_jsx("div", { className: `game-window-embed game-window-overlay-host${className ? ` ${className}` : ''}`, children: children }));
}
