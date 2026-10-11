import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useSyncExternalStore } from 'react';
import { centerMapOnHex, getSelectedMapHeroId } from '../hex/HexMap';
import { equippedItemBonuses } from '../items/bonuses';
import { heroDailyRegenBase, heroDailyRegenFromItems, heroDailyRegenEffective, } from '../items/heroRegen';
import { rolledItemDisplayName, rolledItemPicturePath, rolledItemRarityColor, rolledItemRarityName, rolledItemStatLines, } from '../items/display';
import { grantRolledItemToHero } from '../items/grant';
import { moveHeroItem, parseItemLocation } from '../items/move';
import { apiItemToRolled, rollDebugItemsFromServer, } from '../items/api';
import { EQUIPMENT_SLOT_IDS } from '../items/types';
import { activePlayer } from '../session/accessors';
import { getSession, subscribe, updateSession } from '../session/store';
import { getCachedCatalog, heroEffectiveStats, heroEffectiveStatsForHero, subscribeCatalog, } from '../town/catalog';
import { heroDisplayStats, statNameForHeroColumn } from '../town/statCatalog';
import { devToolsEnabled } from '../settings/playerSettings';
function defaultHeroId(session) {
    const id = getSelectedMapHeroId();
    if (id && session.heroes.some((row) => row.id === id)) {
        return id;
    }
    return session.heroes[0]?.id ?? null;
}
function renderItemBlock(catalog, item, label) {
    const color = rolledItemRarityColor(catalog, item);
    const name = rolledItemDisplayName(catalog, item);
    const stats = rolledItemStatLines(catalog, item);
    return (_jsxs("div", { className: "dev-items-slot", children: [_jsx("div", { className: "dev-items-slot-label", children: label }), _jsx("div", { style: { color }, children: name }), _jsx("div", { className: "dev-items-meta", children: rolledItemRarityName(catalog, item) }), _jsx("div", { className: "dev-items-meta", children: rolledItemPicturePath(catalog, item) }), stats.map((line) => (_jsx("div", { className: "dev-items-stat-line", children: line }, line)))] }, `${label}-${item.uid}`));
}
export function DevItemsPanel({ inCombat, onNotice }) {
    const session = useSyncExternalStore(subscribe, getSession);
    const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog);
    const [rollCount, setRollCount] = useState(20);
    const [rollSeed, setRollSeed] = useState(1);
    const [grantSeed, setGrantSeed] = useState(1);
    const [moveFrom, setMoveFrom] = useState('bp:0');
    const [moveTo, setMoveTo] = useState('eq:1');
    const [rollPreview, setRollPreview] = useState([]);
    const [heroId, setHeroId] = useState(() => defaultHeroId(getSession()));
    if (!devToolsEnabled() || !catalog) {
        return null;
    }
    const resolvedHeroId = heroId && session.heroes.some((row) => row.id === heroId)
        ? heroId
        : defaultHeroId(session);
    const hero = resolvedHeroId
        ? session.heroes.find((row) => row.id === resolvedHeroId) ?? null
        : null;
    const human = activePlayer(session);
    const heroReadOnly = !hero || !human || hero.player_id !== human.id || human.is_ai;
    const onRoll = async () => {
        try {
            const result = await rollDebugItemsFromServer(rollCount, rollSeed);
            setRollPreview(result.items);
            onNotice(`Rolled ${result.items.length} item(s)`);
        }
        catch (err) {
            onNotice(err instanceof Error ? err.message : 'Roll failed');
        }
    };
    const onGrant = async () => {
        if (!hero) {
            onNotice('No active hero');
            return;
        }
        if (heroReadOnly) {
            onNotice('Grant is only for your own heroes');
            return;
        }
        try {
            const result = await grantRolledItemToHero(getSession(), catalog, hero.id, grantSeed);
            if (!result.ok) {
                onNotice(result.message);
                return;
            }
            updateSession(() => result.session);
            onNotice('Item granted (equip or backpack)');
        }
        catch (err) {
            onNotice(err instanceof Error ? err.message : 'Grant failed');
        }
    };
    const onMove = () => {
        if (!hero) {
            onNotice('No active hero');
            return;
        }
        if (heroReadOnly) {
            onNotice('Move is only for your own heroes');
            return;
        }
        const from = parseItemLocation(moveFrom);
        const to = parseItemLocation(moveTo);
        if (!from || !to) {
            onNotice('From/To must be bp:0–14 or eq:1–6');
            return;
        }
        const result = moveHeroItem(getSession(), catalog, hero.id, from, to, inCombat);
        if (!result.ok) {
            onNotice(result.message);
            return;
        }
        updateSession(() => result.session);
        onNotice('Item moved');
    };
    const level = hero?.current_level ?? 1;
    const base = hero
        ? heroEffectiveStats(catalog, hero.class_id, level)
        : null;
    const effective = hero ? heroEffectiveStatsForHero(catalog, hero) : null;
    const itemBonus = hero ? equippedItemBonuses(catalog, hero).hero : {};
    const regenBase = hero ? heroDailyRegenBase(catalog, hero) : null;
    const regenItems = hero ? heroDailyRegenFromItems(catalog, hero) : null;
    const regenEffective = hero ? heroDailyRegenEffective(catalog, hero) : null;
    return (_jsxs("section", { className: "dev-items-section", "aria-labelledby": "dev-items-title", children: [_jsx("h2", { id: "dev-items-title", children: "Items" }), _jsxs("div", { className: "dev-items-controls", children: [_jsxs("label", { children: ["Count", _jsx("input", { type: "number", min: 1, max: 500, value: rollCount, onChange: (e) => setRollCount(Number(e.target.value) || 1) })] }), _jsxs("label", { children: ["Seed", _jsx("input", { type: "number", value: rollSeed, onChange: (e) => setRollSeed(Number(e.target.value) || 0) })] }), _jsx("button", { type: "button", onClick: () => void onRoll(), children: "Roll" })] }), rollPreview.length > 0 ? (_jsx("div", { className: "dev-items-roll-list", children: rollPreview.map((row, index) => {
                    const preview = apiItemToRolled(row, `preview-${index}`);
                    return renderItemBlock(catalog, preview, `#${index + 1}`);
                }) })) : null, _jsxs("label", { className: "dev-items-controls", children: ["Hero", _jsx("select", { value: resolvedHeroId ?? '', onChange: (e) => setHeroId(e.target.value), children: session.heroes.map((row) => {
                            const owner = session.players.find((p) => p.id === row.player_id);
                            const tag = owner?.is_ai ? ' (AI)' : '';
                            return (_jsxs("option", { value: row.id, children: [row.name, tag] }, row.id));
                        }) })] }), heroReadOnly && hero ? (_jsx("p", { className: "dev-items-meta", children: "View only (AI or other player)" })) : null, _jsxs("div", { className: "dev-items-controls", children: [_jsxs("label", { children: ["Grant seed", _jsx("input", { type: "number", value: grantSeed, onChange: (e) => setGrantSeed(Number(e.target.value) || 0) })] }), _jsx("button", { type: "button", onClick: () => void onGrant(), disabled: heroReadOnly, children: "Grant item" })] }), _jsxs("div", { className: "dev-items-controls", children: [_jsxs("label", { children: ["From", _jsx("input", { value: moveFrom, onChange: (e) => setMoveFrom(e.target.value) })] }), _jsxs("label", { children: ["To", _jsx("input", { value: moveTo, onChange: (e) => setMoveTo(e.target.value) })] }), _jsx("button", { type: "button", onClick: onMove, disabled: heroReadOnly, children: "Move" })] }), _jsx("h3", { children: "World items (chests + ground)" }), _jsxs("div", { className: "dev-items-world-list", children: [(session.features ?? [])
                        .filter((row) => row.kind === 'chest' && row.item != null)
                        .map((chest) => {
                        const item = chest.item;
                        const name = rolledItemDisplayName(catalog, item);
                        const stats = rolledItemStatLines(catalog, item);
                        return (_jsxs("button", { type: "button", className: "dev-items-world-row", onClick: () => {
                                centerMapOnHex(chest.position.q, chest.position.r);
                                onNotice(`Centered on chest @ ${chest.position.q},${chest.position.r}`);
                            }, children: [_jsxs("div", { children: ["(", chest.position.q, ",", chest.position.r, ") L", chest.level, chest.open ? ' · Open' : ''] }), _jsx("div", { style: { color: rolledItemRarityColor(catalog, item) }, children: name }), _jsx("div", { className: "dev-items-meta", children: rolledItemRarityName(catalog, item) }), stats.map((line) => (_jsx("div", { className: "dev-items-stat-line", children: line }, line)))] }, chest.id));
                    }), (session.features ?? [])
                        .filter((row) => row.kind === 'ground_item')
                        .map((ground) => {
                        const item = ground.item;
                        const name = rolledItemDisplayName(catalog, item);
                        const stats = rolledItemStatLines(catalog, item);
                        const placement = ground.pocket_id != null
                            ? `pocket #${ground.pocket_id} T${ground.pocket_tier ?? '?'}`
                            : ground.guard
                                ? `standalone · guard (${ground.guard.q},${ground.guard.r}) T${ground.guard_tier ?? '?'}`
                                : 'standalone';
                        return (_jsxs("button", { type: "button", className: "dev-items-world-row", onClick: () => {
                                centerMapOnHex(ground.position.q, ground.position.r);
                                onNotice(`Centered on ground item @ ${ground.position.q},${ground.position.r}`);
                            }, children: [_jsxs("div", { children: ["(", ground.position.q, ",", ground.position.r, ") \u00B7 ", placement] }), _jsx("div", { style: { color: rolledItemRarityColor(catalog, item) }, children: name }), _jsx("div", { className: "dev-items-meta", children: rolledItemRarityName(catalog, item) }), stats.map((line) => (_jsx("div", { className: "dev-items-stat-line", children: line }, line)))] }, ground.id));
                    })] }), hero ? (_jsxs(_Fragment, { children: [_jsxs("h3", { children: ["Hero items \u2014 ", hero.name] }), _jsxs("div", { className: "dev-items-inventory", children: [EQUIPMENT_SLOT_IDS.map((slotId) => {
                                const item = hero.equipment[slotId];
                                return item
                                    ? renderItemBlock(catalog, item, `eq:${slotId}`)
                                    : (_jsxs("div", { className: "dev-items-slot dev-items-empty", children: ["eq:", slotId, " (empty)"] }, `eq-${slotId}`));
                            }), hero.backpack.map((item, index) => item
                                ? renderItemBlock(catalog, item, `bp:${index}`)
                                : (_jsxs("div", { className: "dev-items-slot dev-items-empty", children: ["bp:", index, " (empty)"] }, `bp-${index}`)))] }), _jsxs("table", { className: "dev-items-stat-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Stat" }), _jsx("th", { children: "Base" }), _jsx("th", { children: "Items" }), _jsx("th", { children: "Effective" })] }) }), _jsx("tbody", { children: heroDisplayStats(catalog).map(({ column }) => (_jsxs("tr", { children: [_jsx("td", { children: statNameForHeroColumn(catalog, column) }), _jsx("td", { children: base ? base[column] : '—' }), _jsx("td", { children: itemBonus[column] ?? 0 }), _jsx("td", { children: effective ? effective[column] : '—' })] }, column))) })] }), _jsxs("table", { className: "dev-items-stat-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Daily regen" }), _jsx("th", { children: "Base" }), _jsx("th", { children: "Items" }), _jsx("th", { children: "Effective" })] }) }), _jsxs("tbody", { children: [_jsxs("tr", { children: [_jsx("td", { children: "Mana Regen" }), _jsx("td", { children: regenBase?.mana ?? '—' }), _jsx("td", { children: regenItems?.mana ?? '—' }), _jsx("td", { children: regenEffective?.mana ?? '—' })] }), _jsxs("tr", { children: [_jsx("td", { children: "Energy Regen" }), _jsx("td", { children: regenBase?.energy ?? '—' }), _jsx("td", { children: regenItems?.energy ?? '—' }), _jsx("td", { children: regenEffective?.energy ?? '—' })] })] })] })] })) : (_jsx("p", { children: "No hero on the map." }))] }));
}
