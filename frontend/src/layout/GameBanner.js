import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { ResourceBar } from '../hex/ResourceBar';
import { BANNER_HEIGHT, BANNER_WIDTH, BANNER_X, BANNER_Y } from './stageConstants';
export function GameBanner({ wallet, calendarLabel, weekLabel, turnLabel, buttons, logLines, logScrollBack, logScrollMax, onLogScrollUp, onLogScrollDown, onOpenLog, onLogDetails, trailing, }) {
    return (_jsxs("header", { className: "game-banner", style: {
            left: BANNER_X,
            top: BANNER_Y,
            width: BANNER_WIDTH,
            height: BANNER_HEIGHT,
        }, children: [_jsxs("div", { className: "game-banner-resources", children: [_jsx(ResourceBar, { wallet: wallet, className: "game-banner-resource-bar" }), _jsxs("span", { className: "game-banner-calendar", children: [calendarLabel, _jsxs("span", { className: "game-banner-week", children: [" \u00B7 ", weekLabel] }), turnLabel ? (_jsxs("span", { className: "game-banner-turn", children: [" \u00B7 ", turnLabel] })) : null] })] }), _jsx("div", { className: "game-banner-buttons", children: buttons.map((btn) => (_jsx("button", { type: "button", className: btn.dimmed ? 'game-ui-dimmed' : undefined, title: btn.title, disabled: btn.disabled, onClick: btn.onClick, children: btn.label }, btn.id))) }), _jsxs("div", { className: "game-banner-log-wrap", children: [_jsxs("div", { className: "game-banner-log-scroll", children: [_jsx("button", { type: "button", className: "game-banner-log-arrow", "aria-label": "Older log lines", disabled: logScrollBack >= logScrollMax, onClick: onLogScrollUp, children: "\u25B2" }), _jsx("button", { type: "button", className: "game-banner-log-arrow", "aria-label": "Newer log lines", disabled: logScrollBack <= 0, onClick: onLogScrollDown, children: "\u25BC" })] }), _jsx("button", { type: "button", className: "game-banner-log", "aria-label": "Game log", onClick: onOpenLog, children: logLines.length === 0
                            ? _jsx("span", { className: "game-banner-log-empty", children: "\u00A0" })
                            : logLines.map((line, index) => (_jsxs("div", { className: "game-banner-log-line", children: [line.text, line.detailsCombatId && onLogDetails ? (_jsxs(_Fragment, { children: [' ', _jsx("span", { className: "game-banner-log-details", role: "link", tabIndex: 0, onClick: (event) => {
                                                    event.stopPropagation();
                                                    onLogDetails(line.detailsCombatId);
                                                }, onKeyDown: (event) => {
                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        onLogDetails(line.detailsCombatId);
                                                    }
                                                }, children: "[details]" })] })) : null] }, `${index}:${line.text}`))) })] }), trailing ? _jsx("div", { className: "game-banner-trailing", children: trailing }) : null] }));
}
