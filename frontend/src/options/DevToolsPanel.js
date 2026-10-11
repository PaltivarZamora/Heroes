import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { getSelectedMapHeroId, setHeroMovementRemaining, setMapCameraFollowMoves, } from '../hex/HexMap';
import { getSession, setSession, updateSession } from '../session/store';
import { activePlayer, grantBuildArmy, grantBuildBasicBuildings, grantClassAbilitiesAtTier, grantOpenChest, grantUpgradeBuildings, restoreAllHeroMovement, } from '../session/accessors';
import { awardHeroXp, levelUpNoticeForAward, } from '../session/xp';
import { FLAT_HERO_MOVEMENT_STEPS, fetchCatalog, getCachedCatalog, heroResourcePools, reloadReferenceData, } from '../town/catalog';
import { LIBRARY_TIERS } from '../town/libraryRules';
import { archName } from '../ai/weights';
import { DevItemsPanel } from './DevItemsPanel';
const STEPS_FLAT = FLAT_HERO_MOVEMENT_STEPS;
const FALLBACK_AI_ARCHES = [
    { id: 1, name: 'Build' },
    { id: 2, name: 'Explore' },
    { id: 3, name: 'Aggressive' },
    { id: 4, name: 'Defend' },
];
function aiArchRows() {
    const rows = getCachedCatalog()?.ai_arch ?? [];
    if (rows.length > 0) {
        return [...rows].sort((a, b) => a.id - b.id);
    }
    return FALLBACK_AI_ARCHES.map((row) => ({ id: row.id, name: row.name }));
}
function aiPlayerLabel(player) {
    const slot = player.id.replace(/^player-/, '');
    return `P${slot} (${archName(getCachedCatalog(), player.arch_id)})`;
}
function errorMessage(error, fallback) {
    return error instanceof Error && error.message.trim()
        ? error.message
        : fallback;
}
export function DevToolsPanel({ onCopyDebug, onSeeWorld, onClose, onStartFixedFight, onLevelUpNotice, onDataStatus, onHudNotice, inCombat = false, }) {
    const [reloading, setReloading] = useState(false);
    const [stepsUnlimited, setStepsUnlimited] = useState(false);
    const [notice, setNotice] = useState(null);
    const flash = (text) => {
        setNotice(text);
        onHudNotice?.(text);
        window.setTimeout(() => setNotice(null), 2500);
    };
    const onReloadReference = async () => {
        if (reloading) {
            return;
        }
        setReloading(true);
        try {
            const status = await reloadReferenceData();
            onDataStatus?.(status);
            await fetchCatalog();
            setSession(restoreAllHeroMovement(getSession()));
            const session = getSession();
            const selectedId = getSelectedMapHeroId();
            const liveHero = (selectedId
                ? session.heroes.find((row) => row.id === selectedId)
                : undefined) ?? session.heroes[0];
            if (liveHero) {
                setHeroMovementRemaining(liveHero.movement_remaining);
            }
            flash(status.ok ? 'Reference data reloaded' : 'Reload finished with errors');
        }
        catch (err) {
            onDataStatus?.({
                ok: false,
                tables: [],
                fetchError: errorMessage(err, 'Reference data reload failed'),
            });
        }
        finally {
            setReloading(false);
        }
    };
    const toggleSteps = () => {
        const unlimited = !stepsUnlimited;
        setStepsUnlimited(unlimited);
        if (unlimited) {
            updateSession((current) => ({
                ...current,
                game: {
                    ...current.game,
                    settings: { ...current.game.settings, move_mode: 'flat_100' },
                },
                heroes: current.heroes.map((hero) => ({
                    ...hero,
                    movement_remaining: STEPS_FLAT,
                })),
            }));
            setHeroMovementRemaining(STEPS_FLAT);
        }
        else {
            updateSession((current) => ({
                ...current,
                game: {
                    ...current.game,
                    settings: { ...current.game.settings, move_mode: 'hero_speed' },
                },
            }));
            setSession(restoreAllHeroMovement(getSession()));
        }
        flash(unlimited ? `Steps: ${STEPS_FLAT}` : 'Steps: Hero Speed');
    };
    const aiPlayers = getSession().players.filter((player) => player.is_ai);
    const arches = aiArchRows();
    const seeAiOn = aiPlayers.length > 0 && aiPlayers.every((player) => player.ai_spectator);
    const setAiPlayerArch = (playerId, archId, name) => {
        updateSession((current) => ({
            ...current,
            players: current.players.map((player) => player.id === playerId && player.is_ai
                ? { ...player, arch_id: archId }
                : player),
        }));
        const slot = playerId.replace(/^player-/, '');
        flash(`P${slot} archetype set to ${name}`);
    };
    const toggleSeeAi = () => {
        if (aiPlayers.length === 0) {
            flash('No AI players in this game');
            return;
        }
        const next = !seeAiOn;
        updateSession((current) => ({
            ...current,
            players: current.players.map((player) => player.is_ai ? { ...player, ai_spectator: next } : player),
        }));
        const actor = activePlayer(getSession());
        if (actor?.is_ai) {
            setMapCameraFollowMoves(next);
        }
        flash(next ? 'See AI: On' : 'See AI: Off');
    };
    const fixedKinds = [
        { kind: 'pit_fiends', label: 'Pit Fiends' },
        { kind: 'raise_demons', label: 'Raise Demons' },
        { kind: 'holy_wrath', label: 'Holy Wrath' },
        { kind: 'for_the_hoard', label: 'For the Hoard' },
        { kind: 'fight_yourself', label: 'Fight Yourself' },
        { kind: 'boat_vs_boat', label: 'Boat vs Boat' },
        { kind: 'boat_vs_land', label: 'Boat vs Land' },
        { kind: 'land_vs_boat', label: 'Land vs Boat' },
    ];
    return (_jsxs("div", { className: "dev-tools-panel", children: [notice ? _jsx("p", { className: "settings-hint", children: notice }) : null, _jsxs("div", { className: "dev-tools-panel-actions", children: [onSeeWorld ? (_jsx("button", { type: "button", onClick: () => { onSeeWorld(); onClose?.(); }, children: "See World" })) : null, _jsx("button", { type: "button", onClick: () => {
                            updateSession(grantOpenChest);
                            flash('Opened a chest: 10,000 Gold and 20 of each other resource');
                        }, children: "Open Chest" }), _jsx("button", { type: "button", onClick: () => {
                            const result = grantBuildArmy(getSession(), 1);
                            setSession(result.session);
                            flash(result.notice);
                        }, children: "Build Army 1" }), _jsx("button", { type: "button", onClick: () => {
                            const result = grantBuildArmy(getSession(), 2);
                            setSession(result.session);
                            flash(result.notice);
                        }, children: "Build Army 2" }), _jsx("button", { type: "button", onClick: () => {
                            const result = grantBuildBasicBuildings(getSession());
                            setSession(result.session);
                            flash(result.notice);
                        }, children: "Build Basic Buildings" }), _jsx("button", { type: "button", onClick: () => {
                            const result = grantUpgradeBuildings(getSession());
                            setSession(result.session);
                            flash(result.notice);
                        }, children: "Upgrade Buildings" }), _jsx("button", { type: "button", onClick: () => {
                            updateSession((current) => {
                                let next = current;
                                for (const tier of LIBRARY_TIERS) {
                                    next = grantClassAbilitiesAtTier(next, tier);
                                }
                                return next;
                            });
                            flash('Every hero learned all abilities from their two disciplines');
                        }, children: "Learn" }), _jsx("button", { type: "button", onClick: () => {
                            const catalog = getCachedCatalog();
                            if (!catalog) {
                                flash('Catalog not loaded');
                                return;
                            }
                            const session = getSession();
                            const selectedId = getSelectedMapHeroId();
                            const hero = (selectedId
                                ? session.heroes.find((row) => row.id === selectedId)
                                : undefined) ?? session.heroes[0];
                            if (!hero) {
                                flash('No hero to level up');
                                return;
                            }
                            let levelNotice = null;
                            updateSession((current) => {
                                const awarded = awardHeroXp(current, catalog, hero.id, 1000);
                                levelNotice = levelUpNoticeForAward(catalog, awarded);
                                return awarded.session;
                            });
                            if (levelNotice) {
                                onLevelUpNotice?.(levelNotice);
                            }
                            flash(`${hero.name} +1000 XP`);
                        }, children: "Level Up" }), _jsxs("button", { type: "button", onClick: toggleSteps, children: ["Steps: ", stepsUnlimited ? String(STEPS_FLAT) : 'Hero Speed'] }), _jsx("button", { type: "button", onClick: () => {
                            const catalog = getCachedCatalog();
                            if (!catalog) {
                                flash('Catalog not loaded');
                                return;
                            }
                            const session = getSession();
                            const selectedId = getSelectedMapHeroId();
                            const hero = (selectedId
                                ? session.heroes.find((row) => row.id === selectedId)
                                : undefined) ?? session.heroes[0];
                            if (!hero) {
                                flash('No hero to restore');
                                return;
                            }
                            const pools = heroResourcePools(catalog, hero);
                            updateSession((current) => ({
                                ...current,
                                heroes: current.heroes.map((row) => row.id === hero.id
                                    ? {
                                        ...row,
                                        current_mana: pools.current_mana,
                                        current_energy: pools.current_energy,
                                    }
                                    : row),
                            }));
                            flash(`${hero.name}: Energy ${pools.current_energy}, Mana ${pools.current_mana}`);
                        }, children: "Restore" }), onStartFixedFight ? (_jsxs("details", { className: "dev-fixed-fight", children: [_jsx("summary", { children: "Fixed Fight" }), fixedKinds.map((row) => (_jsx("button", { type: "button", onClick: () => {
                                    onStartFixedFight(row.kind);
                                    onClose?.();
                                }, children: row.label }, row.kind)))] })) : null, _jsxs("button", { type: "button", onClick: toggleSeeAi, children: ["See AI: ", seeAiOn ? 'On' : 'Off'] }), _jsxs("details", { className: "dev-ai-arch", children: [_jsx("summary", { children: "Set AI Archetype" }), aiPlayers.length === 0 ? (_jsx("p", { className: "settings-hint", children: "No AI players" })) : (aiPlayers.map((player) => (_jsxs("div", { children: [_jsx("p", { children: aiPlayerLabel(player) }), arches.map((arch) => (_jsx("button", { type: "button", className: arch.id === player.arch_id ? 'is-active' : undefined, onClick: () => setAiPlayerArch(player.id, arch.id, arch.name), children: arch.name }, arch.id)))] }, player.id))))] }), _jsx("button", { type: "button", disabled: reloading, onClick: () => void onReloadReference(), children: "Reload Reference Data" }), _jsx("button", { type: "button", onClick: () => {
                            onCopyDebug();
                            flash('Debug copied');
                        }, children: "Copy Debug" })] }), _jsx(DevItemsPanel, { inCombat: inCombat, onNotice: flash })] }));
}
