import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState, } from 'react';
import { createPortal } from 'react-dom';
import { resetAllInventoryDetails, subscribeInventoryDetailReset, } from '../items/inventoryDetailReset';
import { moveHeroItem } from '../items/move';
import { moveTradeItem } from '../items/tradeMove';
import { rolledItemDisplayName, rolledItemRarityColor, rolledItemRarityName, rolledItemArtUrl, rolledItemSlotTypeId, } from '../items/display';
import { equippedSummaryStatLines, inventoryEmptySlotTooltip, inventoryItemDetailLines, inventorySlotSummaryLines, inventorySlotTypeName, } from '../items/inventoryDisplay';
import { BACKPACK_SIZE, EQUIPMENT_SLOT_IDS } from '../items/types';
import { getSession, updateSession } from '../session/store';
import { xpToReachLevel } from './catalog';
import { AbilityTip } from './AbilityTip';
const LEFT_SLOTS = [1, 3, 5];
const RIGHT_SLOTS = [2, 4, 6];
function isEquipped(hero, item) {
    for (const slotId of EQUIPMENT_SLOT_IDS) {
        const row = hero.equipment[slotId];
        if (row?.uid === item.uid) {
            return true;
        }
    }
    return false;
}
function locKey(loc) {
    return loc.kind === 'backpack' ? `bp:${loc.index}` : `eq:${loc.slotId}`;
}
function parseInvLocAttr(raw) {
    if (!raw) {
        return null;
    }
    if (raw === 'middle') {
        return 'middle';
    }
    if (raw.startsWith('eq:')) {
        const slotId = Number(raw.slice(3));
        if (EQUIPMENT_SLOT_IDS.includes(slotId)) {
            return { kind: 'equipment', slotId };
        }
        return null;
    }
    if (raw.startsWith('bp:')) {
        const index = Number(raw.slice(3));
        if (Number.isInteger(index) && index >= 0 && index < BACKPACK_SIZE) {
            return { kind: 'backpack', index };
        }
    }
    return null;
}
function resolveDropTarget(clientX, clientY) {
    const stack = document.elementsFromPoint(clientX, clientY);
    for (const el of stack) {
        if (!(el instanceof Element)) {
            continue;
        }
        const host = el.closest('[data-inv-loc]');
        if (!(host instanceof HTMLElement)) {
            continue;
        }
        const panel = host.closest('[data-inv-hero]');
        if (!(panel instanceof HTMLElement)) {
            continue;
        }
        const heroId = panel.getAttribute('data-inv-hero');
        if (!heroId) {
            continue;
        }
        const loc = parseInvLocAttr(host.getAttribute('data-inv-loc'));
        if (loc) {
            return { heroId, loc };
        }
    }
    return null;
}
function ItemArt({ catalog, item, }) {
    const [missing, setMissing] = useState(false);
    const url = rolledItemArtUrl(catalog, item);
    useEffect(() => {
        setMissing(false);
    }, [url]);
    if (!url || missing) {
        return (_jsx("span", { className: "town-building-slot-filename hero-inventory-missing-art", children: "missing art" }));
    }
    return (_jsx("img", { className: "hero-inventory-item-img", src: url, alt: "", draggable: false, onError: () => setMissing(true) }));
}
function ItemHoverTip({ catalog, item, children, }) {
    const color = rolledItemRarityColor(catalog, item);
    const slotId = rolledItemSlotTypeId(catalog, item);
    const slot = slotId != null ? inventorySlotTypeName(catalog, slotId) : 'Item';
    const rarity = rolledItemRarityName(catalog, item);
    const name = rolledItemDisplayName(catalog, item);
    const statLines = item.stats.map((line) => {
        const stat = catalog.stat.find((row) => row.id === line.statId);
        const label = stat?.name ?? `Stat ${line.statId}`;
        return `+${line.amt} ${label}`;
    });
    const description = [
        name,
        `${rarity} - ${slot}`,
        ...statLines,
    ].join('\n');
    return (_jsx(AbilityTip, { description: description, children: _jsx("span", { className: "hero-inventory-item-tip-anchor", style: { color }, children: children }) }));
}
export function HeroInventory({ catalog, hero, inCombat = false, tradePeerHeroId = null, }) {
    const [focusItem, setFocusItem] = useState(null);
    const [drag, setDrag] = useState(null);
    const [ghost, setGhost] = useState(null);
    const [message, setMessage] = useState(null);
    const dragRef = useRef(null);
    dragRef.current = drag;
    const level = hero.current_level ?? 1;
    const xp = hero.current_xp ?? 0;
    const xpNext = xpToReachLevel(catalog, level);
    const xpFmt = (n) => n.toLocaleString('en-US');
    const header = xpNext != null
        ? `${hero.name} - Lvl ${level} (${xpFmt(xp)} / ${xpFmt(xpNext)})`
        : `${hero.name} - Lvl ${level} (${xpFmt(xp)})`;
    const detailItem = drag?.item ?? focusItem;
    const showCompare = detailItem != null && !isEquipped(hero, detailItem);
    useEffect(() => {
        if (!message) {
            return;
        }
        const t = window.setTimeout(() => setMessage(null), 2800);
        return () => window.clearTimeout(t);
    }, [message]);
    useEffect(() => subscribeInventoryDetailReset(() => setFocusItem(null)), []);
    const clearDetail = () => {
        setFocusItem(null);
    };
    useEffect(() => {
        const onMove = (event) => {
            if (dragRef.current) {
                setGhost({ x: event.clientX, y: event.clientY });
            }
        };
        const onUp = (event) => {
            const current = dragRef.current;
            if (!current) {
                return;
            }
            const target = resolveDropTarget(event.clientX, event.clientY);
            dragRef.current = null;
            setDrag(null);
            setGhost(null);
            if (!target) {
                clearDetail();
                resetAllInventoryDetails();
                return;
            }
            let to = null;
            if (target.loc === 'middle') {
                const slotId = rolledItemSlotTypeId(catalog, current.item);
                if (slotId == null) {
                    setMessage('Wrong slot');
                    clearDetail();
                    resetAllInventoryDetails();
                    return;
                }
                to = { kind: 'equipment', slotId };
            }
            else {
                to = target.loc;
            }
            if (target.heroId === current.heroId &&
                locKey(to) === locKey(current.from)) {
                clearDetail();
                resetAllInventoryDetails();
                return;
            }
            const session = getSession();
            let result;
            if (target.heroId === current.heroId) {
                result = moveHeroItem(session, catalog, current.heroId, current.from, to, inCombat);
            }
            else if (tradePeerHeroId &&
                current.heroId === hero.id &&
                target.heroId === tradePeerHeroId) {
                result = moveTradeItem(session, catalog, hero.id, current.from, tradePeerHeroId, to, inCombat);
            }
            else if (tradePeerHeroId &&
                current.heroId === tradePeerHeroId &&
                target.heroId === hero.id) {
                result = moveTradeItem(session, catalog, tradePeerHeroId, current.from, hero.id, to, inCombat);
            }
            else {
                result = { session, ok: false, message: 'Invalid trade target' };
            }
            if (!result.ok) {
                setMessage(result.message);
                clearDetail();
                resetAllInventoryDetails();
                return;
            }
            updateSession(() => result.session);
            clearDetail();
            resetAllInventoryDetails();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
    }, [catalog, hero.id, inCombat, tradePeerHeroId]);
    const beginDrag = (event, item, from) => {
        if (inCombat) {
            setMessage('Cannot move items during combat');
            return;
        }
        event.preventDefault();
        if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.setPointerCapture(event.pointerId);
        }
        dragRef.current = { item, from, heroId: hero.id };
        setDrag({ item, from, heroId: hero.id });
        setGhost({ x: event.clientX, y: event.clientY });
        setFocusItem(item);
    };
    const renderSlot = (loc, item, emptyTip) => {
        const key = locKey(loc);
        const isDragSource = drag != null && locKey(drag.from) === key;
        const inner = item ? (_jsx(ItemHoverTip, { catalog: catalog, item: item, children: _jsx("button", { type: "button", className: "hero-inventory-slot-btn", style: { backgroundColor: rolledItemRarityColor(catalog, item) }, onPointerDown: (event) => beginDrag(event, item, loc), onMouseEnter: () => setFocusItem(item), onMouseLeave: () => {
                    if (!dragRef.current) {
                        setFocusItem(null);
                    }
                }, children: _jsx(ItemArt, { catalog: catalog, item: item }) }) })) : (_jsx("div", { className: "hero-inventory-slot-empty", children: emptyTip ? (_jsx(AbilityTip, { description: emptyTip, children: _jsx("span", { className: "hero-inventory-empty-hit", "aria-hidden": "true" }) })) : (_jsx("span", { className: "hero-inventory-empty-hit", "aria-hidden": "true" })) }));
        return (_jsx("div", { className: isDragSource
                ? 'hero-inventory-slot hero-inventory-slot-drag-source'
                : 'hero-inventory-slot', "data-inv-loc": key, children: inner }, key));
    };
    const slotLines = inventorySlotSummaryLines(catalog, hero);
    const statLines = equippedSummaryStatLines(catalog, hero);
    const leftEquipRows = [
        { slotId: LEFT_SLOTS[0], row: 1 },
        { slotId: LEFT_SLOTS[1], row: 2 },
        { slotId: LEFT_SLOTS[2], row: 3 },
    ];
    const rightEquipRows = [
        { slotId: RIGHT_SLOTS[0], row: 1 },
        { slotId: RIGHT_SLOTS[1], row: 2 },
        { slotId: RIGHT_SLOTS[2], row: 3 },
    ];
    return (_jsxs("div", { className: "hero-inventory", "aria-label": "Inventory", "data-inv-hero": hero.id, onMouseLeave: () => {
            if (!dragRef.current) {
                clearDetail();
                resetAllInventoryDetails();
            }
        }, children: [_jsx("header", { className: "hero-inventory-header", children: header }), _jsxs("div", { className: "hero-inventory-grid", children: [leftEquipRows.map(({ slotId, row }) => (_jsx("div", { className: "hero-inventory-grid-cell", style: { gridColumn: 1, gridRow: row }, children: renderSlot({ kind: 'equipment', slotId }, hero.equipment[slotId] ?? null, inventoryEmptySlotTooltip(catalog, slotId)) }, `eq-${slotId}`))), _jsx("div", { className: "hero-inventory-middle", "data-inv-loc": "middle", style: { gridColumn: '2 / 5', gridRow: '1 / 4' }, onMouseLeave: () => {
                            if (!dragRef.current) {
                                setFocusItem(null);
                            }
                        }, children: detailItem ? (_jsxs("div", { className: "hero-inventory-detail", children: [_jsx("div", { className: "hero-inventory-detail-name", style: { color: rolledItemRarityColor(catalog, detailItem) }, children: rolledItemDisplayName(catalog, detailItem) }), _jsxs("div", { className: "hero-inventory-detail-meta", children: [rolledItemRarityName(catalog, detailItem), " -", ' ', (() => {
                                            const slotId = rolledItemSlotTypeId(catalog, detailItem);
                                            return slotId != null
                                                ? inventorySlotTypeName(catalog, slotId)
                                                : 'Item';
                                        })()] }), inventoryItemDetailLines(catalog, hero, detailItem, showCompare).map((line, index) => (_jsxs("div", { className: "hero-inventory-detail-stat", children: [_jsx("span", { children: line.left }), line.compare ? (_jsx("span", { className: line.compareTone === 'gain'
                                                ? 'hero-inventory-cmp-gain'
                                                : 'hero-inventory-cmp-loss', children: line.compare })) : null] }, `${index}-${line.left}`)))] })) : (_jsxs("div", { className: "hero-inventory-summary", children: [slotLines.map((line) => (_jsx("div", { className: "hero-inventory-summary-slot", style: line.color ? { color: line.color } : undefined, children: line.text }, line.text))), _jsx("div", { className: "hero-inventory-summary-divider" }), statLines.map((line) => (_jsx("div", { className: "hero-inventory-summary-stat", children: line }, line)))] })) }), rightEquipRows.map(({ slotId, row }) => (_jsx("div", { className: "hero-inventory-grid-cell", style: { gridColumn: 5, gridRow: row }, children: renderSlot({ kind: 'equipment', slotId }, hero.equipment[slotId] ?? null, inventoryEmptySlotTooltip(catalog, slotId)) }, `eq-${slotId}`))), Array.from({ length: BACKPACK_SIZE }, (_, index) => {
                        const col = (index % 5) + 1;
                        const row = Math.floor(index / 5) + 4;
                        return (_jsx("div", { className: "hero-inventory-grid-cell", style: { gridColumn: col, gridRow: row }, children: renderSlot({ kind: 'backpack', index }, hero.backpack[index] ?? null) }, `bp-${index}`));
                    })] }), message ? (_jsx("p", { className: "hero-inventory-message", role: "status", children: message })) : null, drag && ghost
                ? createPortal(_jsx("div", { className: "hero-inventory-ghost", style: {
                        left: ghost.x,
                        top: ghost.y,
                        backgroundColor: rolledItemRarityColor(catalog, drag.item),
                    }, children: _jsx(ItemArt, { catalog: catalog, item: drag.item }) }), document.body)
                : null] }));
}
