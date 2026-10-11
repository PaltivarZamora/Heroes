import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { formatAmount } from '../hex/resources';
import { GameWindowModal } from '../layout/GameWindowModal';
import { GameWindowOverlay } from '../layout/GameWindowOverlay';
export function ArmySplitPopup({ open, unitName, stackQty, qty, onQtyChange, onPickUp, onHalf, onEvenly, onCancel, }) {
    const inputRef = useRef(null);
    const maxQty = Math.max(1, stackQty - 1);
    useEffect(() => {
        if (open) {
            inputRef.current?.focus();
        }
    }, [open]);
    if (!open) {
        return null;
    }
    const clamp = (value) => Math.min(maxQty, Math.max(1, Math.floor(value)));
    const onWheel = (event) => {
        event.preventDefault();
        const delta = event.deltaY < 0 ? 1 : -1;
        onQtyChange(clamp(qty + delta));
    };
    const host = document.querySelector('.game-stage');
    if (!host) {
        return null;
    }
    return createPortal(_jsx(GameWindowOverlay, { children: _jsx(GameWindowModal, { "aria-label": "Split stack", onBackdropClick: onCancel, children: _jsxs("div", { className: "army-split-popup-body", children: [_jsxs("p", { className: "army-split-popup-title", children: [unitName, " ", _jsxs("span", { children: ["(", formatAmount(stackQty), ")"] })] }), _jsxs("div", { className: "army-split-popup-qty", children: [_jsx("span", { children: "Qty" }), _jsx("button", { type: "button", className: "army-split-qty-step", "aria-label": "Decrease", onClick: () => onQtyChange(clamp(qty - 1)), children: "\u25BC" }), _jsx("input", { ref: inputRef, type: "number", className: "army-split-qty-input", min: 1, max: maxQty, value: qty, onChange: (event) => {
                                    const parsed = Number.parseInt(event.target.value, 10);
                                    onQtyChange(Number.isFinite(parsed) ? clamp(parsed) : 1);
                                }, onWheel: onWheel }), _jsx("button", { type: "button", className: "army-split-qty-step", "aria-label": "Increase", onClick: () => onQtyChange(clamp(qty + 1)), children: "\u25B2" })] }), _jsxs("div", { className: "army-split-popup-actions", children: [_jsx("button", { type: "button", onClick: onPickUp, children: "Pick Up" }), _jsx("button", { type: "button", onClick: onHalf, children: "Half" }), _jsx("button", { type: "button", onClick: onEvenly, children: "Evenly" }), _jsx("button", { type: "button", onClick: onCancel, children: "Cancel" })] })] }) }) }), host);
}
