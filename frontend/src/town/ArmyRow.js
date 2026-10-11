import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { heroPortraitUrl } from './slotArt';
import { UnitStackFace } from './unitStack';
import { AbilityTip } from './AbilityTip';
export function PortraitFace({ label, filename, }) {
    const [missing, setMissing] = useState(false);
    useEffect(() => {
        setMissing(false);
    }, [filename]);
    if (!filename) {
        return label;
    }
    if (missing) {
        return _jsx("span", { className: "town-building-slot-filename", children: filename });
    }
    return (_jsx("img", { src: heroPortraitUrl(filename), alt: label, onError: () => setMissing(true) }));
}
function maybeTip(description, child, placement) {
    if (!description) {
        return child;
    }
    return (_jsx(AbilityTip, { description: description, placement: placement ?? 'default', children: child }));
}
export function ArmyRow({ row, heroId, portraitLabel, portraitFilename, armyStacks, portraitTip, slotTip, slotActions, onSlotPointerDown, onEmptySlotPointerDown, onPortraitClick, portraitUpgrade, trailingSlot, orientation = 'horizontal', showPortrait = true, padSlotsTo, portraitOverlay, evenlyPickHighlight, }) {
    const portrait = _jsx(PortraitFace, { label: portraitLabel, filename: portraitFilename });
    const portraitInner = (_jsxs(_Fragment, { children: [portrait, portraitOverlay ? (_jsx("span", { className: "game-hero-steps-overlay", children: portraitOverlay })) : null, portraitUpgrade?.show ? (_jsx("button", { type: "button", className: "army-slot-btn army-slot-btn-upgrade army-portrait-upgrade", "aria-label": "Upgrade all", title: portraitUpgrade.tip ?? 'Upgrade all', onClick: (event) => {
                    event.stopPropagation();
                    portraitUpgrade.onClick();
                }, children: "\u2191" })) : null] }));
    const portraitBox = onPortraitClick ? (_jsx("button", { type: "button", className: "town-army-box town-army-portrait", "data-portrait": row, "data-hero-id": heroId ?? undefined, "aria-label": portraitLabel, onClick: onPortraitClick, children: portraitInner })) : (_jsx("div", { className: "town-army-box town-army-portrait", "data-portrait": row, "data-hero-id": heroId ?? undefined, "aria-label": portraitLabel, children: portraitInner }));
    const padCount = padSlotsTo != null
        ? Math.max(0, padSlotsTo -
            armyStacks.length -
            (showPortrait ? 1 : 0) -
            (trailingSlot ? 1 : 0))
        : 0;
    return (_jsxs("div", { className: orientation === 'vertical'
            ? 'town-army-row town-army-row-vertical'
            : 'town-army-row', children: [showPortrait ? maybeTip(portraitTip, portraitBox) : null, armyStacks.map((stack, index) => {
                const slot = index + 1;
                const tip = slotTip?.(slot, stack) ?? null;
                const actions = slotActions?.(slot, stack);
                const face = _jsx(UnitStackFace, { ...stack });
                const box = (_jsxs("button", { type: "button", className: `town-army-box town-army-slot${evenlyPickHighlight && stack.empty ? ' army-evenly-pick' : ''}`, "data-row": row, "data-slot": slot, "data-hero-id": heroId ?? undefined, onPointerDown: (event) => {
                        if (stack.empty) {
                            onEmptySlotPointerDown?.(slot, event);
                            return;
                        }
                        onSlotPointerDown?.(slot, event);
                    }, onContextMenu: (event) => event.preventDefault(), children: [face, !stack.empty && actions?.canUpgrade ? (_jsx("button", { type: "button", className: "army-slot-btn army-slot-btn-upgrade", "aria-label": "Upgrade stack", title: actions.upgradeTip ?? 'Upgrade', onPointerDown: (event) => event.stopPropagation(), onClick: (event) => {
                                event.stopPropagation();
                                actions.onUpgrade?.();
                            }, children: "\u2191" })) : null, !stack.empty && actions?.canSplit ? (_jsx("button", { type: "button", className: "army-slot-btn army-slot-btn-split", "aria-label": "Split stack", title: actions.splitTip ?? 'Split', onPointerDown: (event) => event.stopPropagation(), onClick: (event) => {
                                event.stopPropagation();
                                actions.onSplit?.();
                            }, children: "\u21C6" })) : null] }));
                return (_jsx("span", { className: "town-army-slot-tip-wrap", children: maybeTip(tip, box, 'beside-right') }, index));
            }), Array.from({ length: padCount }, (_, index) => (_jsx("div", { className: "town-army-box town-army-slot town-army-slot-static town-army-slot-pad", "aria-hidden": true }, `pad-${index}`))), trailingSlot] }));
}
