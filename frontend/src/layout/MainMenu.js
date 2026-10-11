import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { GameWindowModal } from './GameWindowModal';
import { GameWindowOverlay } from './GameWindowOverlay';
import { devToolsEnabled } from '../settings/playerSettings';
export function MainMenu({ open, inBattle, onClose, onFlow, onSettings, onDev, }) {
    if (!open) {
        return null;
    }
    const dev = devToolsEnabled();
    return (_jsx(GameWindowOverlay, { children: _jsxs(GameWindowModal, { "aria-labelledby": "main-menu-title", onBackdropClick: onClose, children: [_jsx("h1", { id: "main-menu-title", children: "Main Menu" }), _jsxs("div", { className: "main-menu-section", children: [_jsx("p", { className: "main-menu-heading", children: "Game" }), _jsx("button", { type: "button", onClick: () => onFlow('new'), children: "New Game" }), _jsx("button", { type: "button", disabled: inBattle, title: inBattle ? 'Not available during battle' : undefined, onClick: () => onFlow('load'), children: "Load Game" }), _jsx("button", { type: "button", disabled: inBattle, title: inBattle ? 'Not available during battle' : undefined, onClick: () => onFlow('save'), children: "Save Game" }), _jsx("button", { type: "button", onClick: () => onFlow('restart'), children: "Restart" })] }), _jsxs("div", { className: "main-menu-section", children: [_jsx("button", { type: "button", onClick: onSettings, children: "Settings" }), dev ? (_jsx("button", { type: "button", onClick: onDev, children: "Dev" })) : null, _jsx("button", { type: "button", onClick: () => onFlow('quit'), children: "Quit" })] }), _jsx("button", { type: "button", className: "date-notice-ok", onClick: onClose, children: "Close" })] }) }));
}
