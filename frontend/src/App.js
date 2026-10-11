import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, } from 'react';
import { HexMap, abortActiveMapMovement, clearCachedGrid, getMapCameraHex, getSelectedMapHeroId, centerMapOnHex, resyncWorldMapAfterMapView, selectHeroOnMap, setMapCameraFollowMoves, setMapInputLocked, syncActivePlayerView, syncSelectedHeroFromSession, requestPlayHeroFlight } from './hex/HexMap';
import { isArmyPopupOpen, runArmyConfirmPopup } from './town/armyKeybindBridge';
import { MapView } from './hex/MapView';
import { formatDebugSections, formatDebugText, } from './hex/debug';
import { MainMenu } from './layout/MainMenu';
import { DevPopup } from './layout/DevPopup';
import { SettingsScreen } from './settings/SettingsScreen';
import { useGameKeybindHandler } from './input/useGameKeybindHandler';
import { tooltipWithKey } from './input/keybindEngine';
import { loadPlayerSettings } from './settings/playerSettings';
import { getWorldRenderStats } from './hex/worldRenderChunks';
import { formatMovementPoints, HERO_MARKER_LABEL } from './hex/hero';
import { DEFAULT_HEX_SCALE, HEX_SCALES, mapSizeLabel, } from './hex/hexScale';
import { parseHexSize } from './options/gameConfig';
import { formatResourceLines, } from './hex/resources';
import { calendarRolloverTitle, calendarDayNumber, formatCalendar } from './hex/calendar';
import { TownManagement } from './town/TownManagement';
import { HeroScreen } from './town/HeroScreen';
import { TradeScreen } from './town/TradeScreen';
import { WorldLibrary } from './town/WorldLibrary';
import { WorldHangerFlight } from './town/WorldHangerFlight';
import { DockBuy } from './town/DockBuy';
import { WorldRecruits } from './town/WorldRecruits';
import { WorldNoticeBoard } from './town/WorldNoticeBoard';
import { QuestLog } from './town/QuestLog';
import { GameWindowModal } from './layout/GameWindowModal';
import { GameWindowOverlay } from './layout/GameWindowOverlay';
import { CombatScreen } from './combat/CombatScreen';
import { getNavalMaskDebugState, subscribeNavalMaskDebug, } from './combat/navalMaskDebugBridge';
import { boatOccupiedByHero } from './hex/boat';
import { difficultyName, getCachedCatalog, heroMovementPoints, refreshCatalogFromDb, setGameDifficultyCatalog, } from './town/catalog';
import { difficultyIdFromSettings, syncGameDifficultyFromSession } from './session/gameDifficulty';
import { OptionsMenu } from './options/OptionsMenu';
import { defaultGameConfig, } from './options/gameConfig';
import { getExploredHexes } from './hex/world';
import { getSession, setSession, subscribe, updateSession } from './session/store';
import {} from './session/xp';
import { claimChest } from './session/chest';
import { createSessionFromConfig } from './session/create';
import { creditVisitFeature, recordNoticeBoardKnowledge } from './session/quests';
import { acceptMobSurrender, declineMobSurrender, fleeOfferPrompt, letMobFlee, resolveMobPreBattle, surrenderOfferPrompt, } from './session/mobEncounter';
import { prepareFixedFight } from './session/fixedFight';
import { assignHeroesFromPool, activePlayer, endTurn, findTownAt, findTownById, grantHeroStartingArmy, hasTownBuiltToday, heroArmyStackCount, humanPlayer, markTownBuiltToday, matchVictoryResult, persistActiveExplored, takeDayIncomeNoticeLines, visitingHeroId, claimTown, townIsUndefended, walletFromSession, } from './session/accessors';
import { appendAiTrace, clearAiTraces, getAiTraceBlocks, subscribeAiTraces } from './ai/trace';
import { decideAndApplyHeroTrade } from './ai/armyAlloc';
import { runAiTurn } from './ai/turn';
import { GameBanner } from './layout/GameBanner';
import { GameLogModal, bannerLogLines, defaultLogTab, maxBannerLogScroll, } from './layout/GameLogModal';
import { GameLeftPanel } from './layout/GameLeftPanel';
import { logMobAmbush, logMobEncounterResolved, recordCombatEnd, } from './session/gameLog';
import { GameStage } from './layout/GameStage';
import { GAME_WINDOW_HEIGHT, GAME_WINDOW_WIDTH, GAME_WINDOW_X, GAME_WINDOW_Y, } from './layout/stageConstants';
import './App.css';
/** Once Start Game runs, catalog bootstrap must not rewrite the chosen config. */
let allowCatalogBootDefaults = true;
function idInDirection(currentId, ids, reverse) {
    if (ids.length === 0) {
        return null;
    }
    const idx = currentId ? ids.indexOf(currentId) : -1;
    if (reverse) {
        if (idx < 0) {
            return ids[ids.length - 1] ?? null;
        }
        return ids[(idx - 1 + ids.length) % ids.length] ?? null;
    }
    return ids[(idx + 1) % ids.length] ?? null;
}
function App() {
    const session = useSyncExternalStore(subscribe, getSession);
    const [hexScale, setHexScale] = useState(DEFAULT_HEX_SCALE);
    const [mapInfo, setMapInfo] = useState(null);
    const [mapViewOpen, setMapViewOpen] = useState(false);
    const [mapViewRevealAll, setMapViewRevealAll] = useState(false);
    const [mapViewFocus, setMapViewFocus] = useState(null);
    const [activeTownId, setActiveTownId] = useState(null);
    const [hero, setHero] = useState(null);
    const wallet = walletFromSession(session);
    const clearMapGenerating = useCallback(() => {
        mapGeneratingRef.current = false;
        setMapGenerating(false);
    }, []);
    const onMapGenerateFailed = useCallback(() => {
        clearMapGenerating();
        setOptionsHudNotice('Map generation failed or timed out. Check the server, then try New Game again.');
    }, [clearMapGenerating]);
    const onMapInfo = useCallback((info) => {
        clearMapGenerating();
        setMapInfo(info);
        updateSession((current) => {
            const currentName = current.game.name.trim();
            const keepName = currentName !== '' && currentName !== 'Test Game';
            return {
                ...current,
                game: {
                    ...current.game,
                    seed: info.seed,
                    name: keepName ? current.game.name : `Random ${info.seed}`,
                },
            };
        });
    }, [clearMapGenerating]);
    const openMapView = useCallback((revealAll = false) => {
        const live = getSession();
        const heroId = getSelectedMapHeroId();
        const hero = heroId
            ? live.heroes.find((row) => row.id === heroId)
            : live.heroes.find((row) => row.player_id === live.players[0]?.id);
        const focus = hero?.position ?? getMapCameraHex() ?? { q: 0, r: 0 };
        setMapViewRevealAll(revealAll);
        setMapViewFocus(focus);
        setMapViewOpen(true);
    }, []);
    const closeMapView = useCallback(() => {
        setMapInputLocked(false);
        setMapViewRevealAll(false);
        setMapViewOpen(false);
        requestAnimationFrame(() => resyncWorldMapAfterMapView());
    }, []);
    const onMapViewFocusHex = useCallback((q, r) => {
        closeMapView();
        centerMapOnHex(q, r);
    }, [closeMapView]);
    const onHeroState = useCallback((state) => {
        setHero(state);
    }, []);
    const onResources = useCallback((_next) => {
        // Player.resources is the source of truth; HexMap writes it directly.
    }, []);
    const [welcomeTown, setWelcomeTown] = useState(null);
    const [heroScreen, setHeroScreen] = useState(false);
    const [trade, setTrade] = useState(null);
    const [combat, setCombat] = useState(null);
    const combatFightIdRef = useRef(0);
    const recordedCombatFightIdsRef = useRef(new Set());
    const pendingCombatLogRef = useRef(null);
    const [dateNotice, setDateNotice] = useState(null);
    const [levelUpNotice, setLevelUpNotice] = useState(null);
    const [archiveLearn, setArchiveLearn] = useState(null);
    const [optionsHudNotice, setOptionsHudNotice] = useState(null);
    const [mainMenuOpen, setMainMenuOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [settingsTab, setSettingsTab] = useState('audio');
    const [devOpen, setDevOpen] = useState(false);
    const [gameFlowPanel, setGameFlowPanel] = useState(null);
    const [endTurnConfirmOpen, setEndTurnConfirmOpen] = useState(false);
    const [gameLogOpen, setGameLogOpen] = useState(false);
    const [gameLogTab, setGameLogTab] = useState('world');
    const [gameLogFocusCombatId, setGameLogFocusCombatId] = useState(null);
    const [logScrollBack, setLogScrollBack] = useState(0);
    const [liveCombatLogLines, setLiveCombatLogLines] = useState([]);
    const [surrenderPrompt, setSurrenderPrompt] = useState(null);
    const [fleePrompt, setFleePrompt] = useState(null);
    const combatWaitRef = useRef(null);
    const matchEndShownRef = useRef(false);
    const pendingLevelUpRef = useRef(null);
    const lastTownRef = useRef(null);
    const [mapEpoch, setMapEpoch] = useState(0);
    const [mapGenerating, setMapGenerating] = useState(false);
    const mapGeneratingRef = useRef(false);
    const [dataStatus, setDataStatus] = useState(null);
    const [aiPhase, setAiPhase] = useState('idle');
    const [terrainWedgesEnabled, setTerrainWedgesEnabled] = useState(true);
    const [zonesDebug, setZonesDebug] = useState(false);
    const [wallGapsDebug, setWallGapsDebug] = useState(false);
    const [roadPlanDebug, setRoadPlanDebug] = useState(false);
    const [townHexNumbers, setTownHexNumbers] = useState(false);
    const [worldPerf, setWorldPerf] = useState(null);
    useEffect(() => {
        const id = window.setInterval(() => {
            setWorldPerf(getWorldRenderStats());
        }, 400);
        return () => window.clearInterval(id);
    }, []);
    const aiRanKeyRef = useRef('');
    const aiTraces = useSyncExternalStore(subscribeAiTraces, getAiTraceBlocks);
    const calendar = session.game.calendar;
    const onTownWelcome = useCallback((townName, townId) => {
        setTrade(null);
        setCombat(null);
        const next = { id: townId, name: townName };
        lastTownRef.current = next;
        setActiveTownId(townId);
        setWelcomeTown(next);
    }, []);
    const onFountainRestore = useCallback((message) => {
        setDateNotice({ title: message, date: '' });
    }, []);
    const onChestMessage = useCallback((payload) => {
        setDateNotice({ title: payload.title, date: '' });
    }, []);
    const onSignRead = useCallback((text) => {
        setDateNotice({ title: '', date: '', lines: [text] });
    }, []);
    const [questLogOpen, setQuestLogOpen] = useState(false);
    const viewBehindQuestRef = useRef(null);
    const toggleQuestLog = useCallback(() => {
        setQuestLogOpen((wasOpen) => {
            if (!wasOpen) {
                viewBehindQuestRef.current = {
                    welcomeTown,
                    heroScreen,
                };
            }
            else {
                viewBehindQuestRef.current = null;
            }
            return !wasOpen;
        });
    }, [welcomeTown, heroScreen]);
    const openQuestLog = useCallback(() => {
        viewBehindQuestRef.current = {
            welcomeTown,
            heroScreen,
        };
        setQuestLogOpen(true);
    }, [welcomeTown, heroScreen]);
    const closeQuestLog = useCallback(() => {
        setQuestLogOpen(false);
        viewBehindQuestRef.current = null;
    }, []);
    useLayoutEffect(() => {
        if (!questLogOpen) {
            return;
        }
        const snap = viewBehindQuestRef.current;
        if (!snap) {
            return;
        }
        if (snap.welcomeTown && !welcomeTown) {
            setWelcomeTown(snap.welcomeTown);
            lastTownRef.current = snap.welcomeTown;
        }
        if (snap.heroScreen && !heroScreen) {
            setHeroScreen(true);
        }
    }, [questLogOpen, welcomeTown, heroScreen]);
    const [worldNoticeBoard, setWorldNoticeBoard] = useState(null);
    const creditFeatureVisit = useCallback((featureId, heroId) => {
        updateSession((current) => {
            const hero = current.heroes.find((row) => row.id === heroId);
            if (!hero) {
                return current;
            }
            return creditVisitFeature(current, featureId, hero.player_id);
        });
    }, []);
    const [dockBuy, setDockBuy] = useState(null);
    const [worldLibrary, setWorldLibrary] = useState(null);
    const onWorldLibrary = useCallback((offer) => {
        setCombat(null);
        setTrade(null);
        setWelcomeTown(null);
        setChestOffer(null);
        setWorldHanger(null);
        setDockBuy(null);
        setWorldRecruits(null);
        setWorldNoticeBoard(null);
        setWorldLibrary(offer);
        creditFeatureVisit(offer.featureId, offer.heroId);
    }, [creditFeatureVisit]);
    const closeWorldLibrary = useCallback(() => {
        setWorldLibrary(null);
        setMapInputLocked(false);
    }, []);
    const [worldHanger, setWorldHanger] = useState(null);
    const onWorldHanger = useCallback((offer) => {
        setCombat(null);
        setTrade(null);
        setWelcomeTown(null);
        setChestOffer(null);
        setWorldLibrary(null);
        setDockBuy(null);
        setWorldRecruits(null);
        setWorldNoticeBoard(null);
        setWorldHanger(offer);
        creditFeatureVisit(offer.featureId, offer.heroId);
    }, [creditFeatureVisit]);
    const closeWorldHanger = useCallback(() => {
        setWorldHanger(null);
        setMapInputLocked(false);
    }, []);
    const onWorldDock = useCallback((offer) => {
        setCombat(null);
        setTrade(null);
        setWelcomeTown(null);
        setChestOffer(null);
        setWorldLibrary(null);
        setWorldHanger(null);
        setWorldRecruits(null);
        setWorldNoticeBoard(null);
        setDockBuy(offer);
        creditFeatureVisit(offer.featureId, offer.heroId);
    }, [creditFeatureVisit]);
    const closeDockBuy = useCallback(() => {
        setDockBuy(null);
        setMapInputLocked(false);
    }, []);
    const [worldRecruits, setWorldRecruits] = useState(null);
    const onWorldRecruits = useCallback((offer) => {
        setCombat(null);
        setTrade(null);
        setWelcomeTown(null);
        setChestOffer(null);
        setWorldLibrary(null);
        setWorldHanger(null);
        setDockBuy(null);
        setWorldNoticeBoard(null);
        setWorldRecruits(offer);
        creditFeatureVisit(offer.featureId, offer.heroId);
    }, [creditFeatureVisit]);
    const closeWorldRecruits = useCallback(() => {
        setWorldRecruits(null);
        setMapInputLocked(false);
    }, []);
    const onWorldNoticeBoard = useCallback((offer) => {
        setCombat(null);
        setTrade(null);
        setWelcomeTown(null);
        setChestOffer(null);
        setWorldLibrary(null);
        setWorldHanger(null);
        setDockBuy(null);
        setWorldRecruits(null);
        setWorldNoticeBoard(offer);
        creditFeatureVisit(offer.featureId, offer.heroId);
        updateSession((current) => {
            const hero = current.heroes.find((row) => row.id === offer.heroId);
            if (!hero) {
                return current;
            }
            return recordNoticeBoardKnowledge(current, offer.featureId, hero.player_id);
        });
    }, [creditFeatureVisit]);
    const closeWorldNoticeBoard = useCallback(() => {
        setWorldNoticeBoard(null);
        setMapInputLocked(false);
    }, []);
    const [chestOffer, setChestOffer] = useState(null);
    const onChestOffer = useCallback((offer) => {
        setCombat(null);
        setTrade(null);
        setWelcomeTown(null);
        setChestOffer(offer);
    }, []);
    const resolveChestChoice = useCallback((choice) => {
        const offer = chestOffer;
        setChestOffer(null);
        setMapInputLocked(false);
        if (!offer) {
            return;
        }
        const catalog = getCachedCatalog();
        if (!catalog) {
            return;
        }
        let claimResult = null;
        updateSession((current) => {
            const result = claimChest(current, catalog, offer.featureId, offer.heroId, choice);
            claimResult = result;
            return result.session;
        });
        const claimed = claimResult;
        const message = claimed?.message ?? null;
        const messageLines = claimed?.messageLines ?? null;
        const levelUp = claimed?.levelUpNotice ?? null;
        if (message || (messageLines && messageLines.length > 0)) {
            setDateNotice({
                title: message ?? '',
                date: '',
                lines: messageLines ?? undefined,
            });
        }
        if (levelUp) {
            pendingLevelUpRef.current = levelUp;
            if (!message && !(messageLines && messageLines.length > 0)) {
                setLevelUpNotice(levelUp);
                pendingLevelUpRef.current = null;
            }
        }
    }, [chestOffer]);
    const showDateThenLevelUp = useCallback((notice, levelUp) => {
        pendingLevelUpRef.current = levelUp ?? null;
        setDateNotice(notice);
    }, []);
    const dismissDateNotice = useCallback(() => {
        setMapInputLocked(false);
        setDateNotice(null);
        const pending = pendingLevelUpRef.current;
        pendingLevelUpRef.current = null;
        if (pending) {
            setLevelUpNotice(pending);
        }
    }, []);
    const onHeroMeet = useCallback((targetHeroId) => {
        const current = getSession();
        const selfId = getSelectedMapHeroId();
        const self = selfId
            ? current.heroes.find((row) => row.id === selfId)
            : undefined;
        const other = current.heroes.find((row) => row.id === targetHeroId);
        if (!self || !other || self.id === other.id) {
            return;
        }
        if (other.flight || self.flight) {
            return;
        }
        setWelcomeTown(null);
        if (self.player_id === other.player_id) {
            const owner = current.players.find((row) => row.id === self.player_id);
            if (owner?.is_ai) {
                setCombat(null);
                setTrade(null);
                decideAndApplyHeroTrade(owner, self, other);
                return;
            }
            setCombat(null);
            setTrade({ leftHeroId: self.id, rightHeroId: other.id });
            return;
        }
        setTrade(null);
        setHeroScreen(false);
        const occupied = findTownAt(current, other.position.q, other.position.r);
        const siegeTownId = occupied?.player_id && occupied.player_id !== self.player_id
            ? occupied.id
            : undefined;
        const selfBoat = boatOccupiedByHero(current, self.id);
        const otherBoat = boatOccupiedByHero(current, other.id);
        const navalLayout = selfBoat && otherBoat && !siegeTownId ? 'boat_vs_boat' : undefined;
        setCombat({
            attackerHeroId: self.id,
            defenderHeroId: other.id,
            siegeTownId,
            navalLayout,
        });
    }, []);
    const onSiegeTown = useCallback((townId) => {
        const current = getSession();
        const selfId = getSelectedMapHeroId();
        const self = selfId
            ? current.heroes.find((row) => row.id === selfId)
            : undefined;
        if (!self) {
            return;
        }
        setWelcomeTown(null);
        setTrade(null);
        setHeroScreen(false);
        const town = current.towns.find((row) => row.id === townId);
        if (!town) {
            return;
        }
        // Empty garrison / no defending army — walk-in capture, no siege.
        if (townIsUndefended(current, town, self.id)) {
            updateSession((session) => claimTown(session, town.position.q, town.position.r, {
                ownerId: self.player_id,
            }));
            const claimed = findTownById(getSession(), townId);
            if (claimed && !activePlayer(getSession())?.is_ai) {
                setWelcomeTown({ name: claimed.name, id: claimed.id });
            }
            combatWaitRef.current?.();
            combatWaitRef.current = null;
            return;
        }
        const occupantId = visitingHeroId(current, town);
        const occupant = occupantId
            ? current.heroes.find((row) => row.id === occupantId)
            : undefined;
        const defenderHeroId = occupant && occupant.player_id !== self.player_id ? occupant.id : null;
        setCombat({
            attackerHeroId: self.id,
            defenderHeroId,
            siegeTownId: townId,
        });
    }, []);
    const beginMobEncounter = useCallback((mobId, forced = false, _trigger = forced ? 'ambush' : 'player') => {
        const current = getSession();
        const selfId = getSelectedMapHeroId();
        const self = selfId
            ? current.heroes.find((row) => row.id === selfId)
            : undefined;
        const mob = current.mobs.find((row) => row.id === mobId);
        if (!self || !mob) {
            return false;
        }
        setWelcomeTown(null);
        setTrade(null);
        setHeroScreen(false);
        const catalog = getCachedCatalog();
        if (catalog && !forced) {
            const owner = current.players.find((row) => row.id === self.player_id);
            const result = resolveMobPreBattle(current, catalog, self, mob, {
                autoAcceptSurrender: owner?.is_ai === true,
                autoResolveFlee: owner?.is_ai === true,
            });
            if (result.kind === 'surrender_offer') {
                setCombat(null);
                setFleePrompt(null);
                setSurrenderPrompt({
                    mobId: mob.id,
                    heroId: self.id,
                    question: surrenderOfferPrompt(catalog, result.offerParts ?? []),
                    parts: result.offerParts ?? [],
                });
                return false;
            }
            if (result.kind === 'flee_offer') {
                setCombat(null);
                setSurrenderPrompt(null);
                setFleePrompt({
                    mobId: mob.id,
                    heroId: self.id,
                });
                return false;
            }
            if (result.kind !== 'fight') {
                updateSession(() => {
                    let next = result.session;
                    const kind = result.kind === 'surrender' ? 'mob_surrendered' : 'mob_fled';
                    next = logMobEncounterResolved(next, self.player_id, self.id, mob.id, kind);
                    return next;
                });
                setCombat(null);
                showDateThenLevelUp({
                    title: result.kind === 'surrender' ? 'Surrender' : 'Fled',
                    date: result.kind === 'surrender'
                        ? 'The creatures join your army.'
                        : 'The creatures flee.',
                    lines: result.kind === 'flee' ? result.xpLines : undefined,
                }, result.levelUpNotice);
                return false;
            }
        }
        updateSession((current) => logMobAmbush(current, self.player_id, self.id, mob.id));
        setCombat({
            attackerHeroId: self.id,
            defenderHeroId: null,
            defenderMobId: mob.id,
        });
        return true;
    }, [showDateThenLevelUp]);
    const onSurrenderYes = useCallback(() => {
        const prompt = surrenderPrompt;
        if (!prompt) {
            return;
        }
        const current = getSession();
        const hero = current.heroes.find((row) => row.id === prompt.heroId);
        const mob = current.mobs.find((row) => row.id === prompt.mobId);
        setSurrenderPrompt(null);
        if (!hero || !mob) {
            return;
        }
        const result = acceptMobSurrender(current, hero, mob, prompt.parts);
        updateSession(() => logMobEncounterResolved(result.session, hero.player_id, hero.id, mob.id, 'mob_surrendered'));
        setDateNotice({
            title: 'Surrender',
            date: 'The creatures join your army.',
        });
    }, [surrenderPrompt]);
    const onSurrenderNo = useCallback(() => {
        const prompt = surrenderPrompt;
        if (!prompt) {
            return;
        }
        const current = getSession();
        const hero = current.heroes.find((row) => row.id === prompt.heroId);
        const mob = current.mobs.find((row) => row.id === prompt.mobId);
        setSurrenderPrompt(null);
        if (!hero || !mob) {
            return;
        }
        const catalog = getCachedCatalog();
        if (!catalog) {
            return;
        }
        const result = declineMobSurrender(current, catalog, hero, mob);
        updateSession(() => logMobEncounterResolved(result.session, hero.player_id, hero.id, mob.id, 'mob_fled'));
        showDateThenLevelUp({
            title: 'Fled',
            date: 'The creatures flee.',
            lines: result.xpLines,
        }, result.levelUpNotice);
    }, [surrenderPrompt, showDateThenLevelUp]);
    const onFleeFightAnyway = useCallback(() => {
        const prompt = fleePrompt;
        if (!prompt) {
            return;
        }
        const current = getSession();
        const hero = current.heroes.find((row) => row.id === prompt.heroId);
        const mob = current.mobs.find((row) => row.id === prompt.mobId);
        setFleePrompt(null);
        if (!hero || !mob) {
            return;
        }
        appendAiTrace(`mob_encounter — ${hero.name} vs ${mob.id} flee → fight_anyway (human)`);
        setCombat({
            attackerHeroId: hero.id,
            defenderHeroId: null,
            defenderMobId: mob.id,
        });
    }, [fleePrompt]);
    const onFleeLetThem = useCallback(() => {
        const prompt = fleePrompt;
        if (!prompt) {
            return;
        }
        const current = getSession();
        const hero = current.heroes.find((row) => row.id === prompt.heroId);
        const mob = current.mobs.find((row) => row.id === prompt.mobId);
        setFleePrompt(null);
        if (!hero || !mob) {
            return;
        }
        const catalog = getCachedCatalog();
        if (!catalog) {
            return;
        }
        const result = letMobFlee(current, catalog, hero, mob);
        updateSession(() => logMobEncounterResolved(result.session, hero.player_id, hero.id, mob.id, 'mob_fled'));
        showDateThenLevelUp({
            title: 'Fled',
            date: 'The creatures flee.',
            lines: result.xpLines,
        }, result.levelUpNotice);
    }, [fleePrompt, showDateThenLevelUp]);
    const onMobMeet = useCallback((mobId) => {
        beginMobEncounter(mobId);
    }, [beginMobEncounter]);
    const onMobAmbush = useCallback((mobId) => {
        const opened = beginMobEncounter(mobId, true);
        if (!opened) {
            return;
        }
        return new Promise((resolve) => {
            combatWaitRef.current = resolve;
        });
    }, [beginMobEncounter]);
    const maybeShowMatchEnd = useCallback(() => {
        const result = matchVictoryResult(getSession());
        if (!result || matchEndShownRef.current) {
            return;
        }
        matchEndShownRef.current = true;
        const winnerNames = result.winners.map((player) => player.id).join(', ');
        const loserNames = result.losers.map((player) => player.id).join(', ');
        setDateNotice({
            title: 'Victory',
            date: formatCalendar(getSession().game.calendar),
            lines: [
                `${winnerNames} — Victory`,
                `${loserNames} — Defeat`,
                'Eliminated players’ Resource Nodes reverted to Neutral.',
            ],
        });
    }, []);
    const closeCombat = useCallback((levelUp) => {
        setLiveCombatLogLines([]);
        syncSelectedHeroFromSession();
        abortActiveMapMovement();
        setCombat(null);
        const done = combatWaitRef.current;
        combatWaitRef.current = null;
        done?.();
        syncActivePlayerView();
        const result = matchVictoryResult(getSession());
        if (result && !matchEndShownRef.current) {
            matchEndShownRef.current = true;
            const winnerNames = result.winners.map((player) => player.id).join(', ');
            const loserNames = result.losers.map((player) => player.id).join(', ');
            showDateThenLevelUp({
                title: 'Victory',
                date: formatCalendar(getSession().game.calendar),
                lines: [
                    `${winnerNames} — Victory`,
                    `${loserNames} — Defeat`,
                    'Eliminated players’ Resource Nodes reverted to Neutral.',
                ],
            }, levelUp);
            return;
        }
        if (levelUp) {
            setLevelUpNotice(levelUp);
        }
    }, [showDateThenLevelUp]);
    const onCombatExit = useCallback((levelUp, archive) => {
        if (archive && combat) {
            pendingCombatLogRef.current = {
                fightId: combatFightIdRef.current,
                fight: combat,
                archive,
            };
        }
        const rewardLines = archive?.summary.rewardLines?.filter(Boolean);
        closeCombat(levelUp ?? null);
        if (rewardLines &&
            rewardLines.length > 0 &&
            !activePlayer(getSession())?.is_ai) {
            setMapInputLocked(true);
            setDateNotice({ title: '', date: '', lines: rewardLines });
        }
    }, [combat, closeCombat]);
    useEffect(() => {
        if (combat) {
            combatFightIdRef.current += 1;
            return;
        }
        const pending = pendingCombatLogRef.current;
        if (!pending) {
            return;
        }
        pendingCombatLogRef.current = null;
        if (recordedCombatFightIdsRef.current.has(pending.fightId)) {
            return;
        }
        recordedCombatFightIdsRef.current.add(pending.fightId);
        const fight = pending.fight;
        updateSession((current) => recordCombatEnd(current, getCachedCatalog(), {
            attackerHeroId: fight.attackerHeroId,
            defenderHeroId: fight.defenderHeroId ?? null,
            defenderMobId: fight.defenderMobId ?? null,
            payload: pending.archive,
        }));
    }, [combat]);
    const flushPendingFlightSieges = useCallback(() => {
        const current = getSession();
        const actor = activePlayer(current);
        if (!actor) {
            return;
        }
        const pending = current.game.pending_flight_sieges ?? [];
        if (pending.length === 0) {
            return;
        }
        const mine = [];
        const rest = [];
        for (const siege of pending) {
            const hero = current.heroes.find((row) => row.id === siege.heroId);
            if (hero && hero.player_id === actor.id) {
                mine.push(siege);
            }
            else {
                rest.push(siege);
            }
        }
        if (mine.length === 0) {
            return;
        }
        updateSession((session) => ({
            ...session,
            game: {
                ...session.game,
                pending_flight_sieges: [...rest, ...mine.slice(1)],
            },
        }));
        const first = mine[0];
        selectHeroOnMap(first.heroId);
        onSiegeTown(first.townId);
    }, [onSiegeTown]);
    const runEndTurn = useCallback(() => {
        setWelcomeTown(null);
        setHeroScreen(false);
        setTrade(null);
        closeCombat();
        const previous = getSession().game.calendar;
        updateSession((current) => endTurn(persistActiveExplored(current, getExploredHexes())));
        syncActivePlayerView();
        const next = getSession().game.calendar;
        const title = calendarRolloverTitle(previous, next);
        const incomeLines = takeDayIncomeNoticeLines();
        if (title && !matchVictoryResult(getSession())) {
            setDateNotice({
                title,
                date: formatCalendar(next),
                lines: incomeLines.length > 0 ? incomeLines : undefined,
            });
        }
        else {
            maybeShowMatchEnd();
            flushPendingFlightSieges();
        }
    }, [closeCombat, maybeShowMatchEnd, flushPendingFlightSieges]);
    const onEndTurn = useCallback(() => {
        if (loadPlayerSettings().confirmEndTurn) {
            setEndTurnConfirmOpen(true);
            return;
        }
        runEndTurn();
    }, [runEndTurn]);
    const onStartGame = useCallback((config) => {
        if (mapGeneratingRef.current) {
            return;
        }
        mapGeneratingRef.current = true;
        setMapGenerating(true);
        allowCatalogBootDefaults = false;
        setWelcomeTown(null);
        setHeroScreen(false);
        setTrade(null);
        setCombat(null);
        const done = combatWaitRef.current;
        combatWaitRef.current = null;
        done?.();
        setDateNotice(null);
        setLevelUpNotice(null);
        setArchiveLearn(null);
        pendingLevelUpRef.current = null;
        setSurrenderPrompt(null);
        matchEndShownRef.current = false;
        lastTownRef.current = null;
        clearAiTraces();
        aiRanKeyRef.current = '';
        setAiPhase('idle');
        setMapInputLocked(false);
        setMapCameraFollowMoves(true);
        clearCachedGrid();
        setHexScale(config.hexSize);
        setGameDifficultyCatalog(config.difficultyId);
        setSession(createSessionFromConfig(config));
        setMapEpoch((n) => n + 1);
        const catalog = getCachedCatalog();
        if (catalog) {
            updateSession((current) => assignHeroesFromPool(current, catalog.hero_pool));
        }
    }, []);
    const adoptHero = useCallback((id) => {
        const row = getSession().heroes.find((hero) => hero.id === id);
        if (!row) {
            return;
        }
        selectHeroOnMap(row.id);
        setHero({
            id: row.id,
            q: row.position.q,
            r: row.position.r,
            remaining: row.movement_remaining,
        });
    }, []);
    const playHeroFlight = useCallback((heroId) => {
        adoptHero(heroId);
        setWorldHanger(null);
        setDockBuy(null);
        setWorldRecruits(null);
        setWorldNoticeBoard(null);
        setWelcomeTown(null);
        setMapInputLocked(true);
        setMapCameraFollowMoves(true);
        void (async () => {
            await Promise.resolve();
            const result = await requestPlayHeroFlight(heroId);
            setMapInputLocked(false);
            adoptHero(heroId);
            if (result.siegeTownId) {
                onSiegeTown(result.siegeTownId);
                return;
            }
            if (result.arrivedTownId) {
                const town = findTownById(getSession(), result.arrivedTownId);
                if (town) {
                    const next = { id: town.id, name: town.name };
                    lastTownRef.current = next;
                    setWelcomeTown(next);
                }
            }
        })();
    }, [adoptHero, onSiegeTown]);
    const cycleTown = useCallback((reverse = false) => {
        const current = getSession();
        const player = humanPlayer(current);
        if (!player) {
            return;
        }
        const townId = idInDirection(welcomeTown?.id ?? lastTownRef.current?.id ?? null, player.town_ids, reverse);
        const town = townId ? findTownById(current, townId) : undefined;
        if (town) {
            const next = { id: town.id, name: town.name };
            lastTownRef.current = next;
            setWelcomeTown(next);
        }
    }, [welcomeTown]);
    const cycleHero = useCallback((reverse = false) => {
        if (aiPhase === 'running') {
            return;
        }
        const current = getSession();
        const player = humanPlayer(current);
        if (!player) {
            return;
        }
        const owned = player.hero_ids.filter((id) => current.heroes.some((row) => row.id === id));
        if (owned.length === 0) {
            return;
        }
        const selectedId = getSelectedMapHeroId();
        const currentId = owned.includes(hero?.id ?? '')
            ? hero?.id ?? null
            : owned.includes(selectedId ?? '')
                ? selectedId
                : null;
        const heroId = idInDirection(currentId, owned, reverse);
        if (!heroId) {
            return;
        }
        adoptHero(heroId);
    }, [adoptHero, hero?.id, aiPhase]);
    const cycleNextActionable = useCallback((reverse = false) => {
        if (aiPhase === 'running') {
            return;
        }
        const current = getSession();
        const player = humanPlayer(current);
        if (!player) {
            return;
        }
        if (welcomeTown && !heroScreen) {
            const buildable = player.town_ids.filter((id) => !hasTownBuiltToday(current, id));
            if (buildable.length === 0) {
                return;
            }
            const currentTownId = welcomeTown.id ?? lastTownRef.current?.id ?? null;
            const townId = idInDirection(currentTownId, buildable, reverse);
            const town = townId ? findTownById(current, townId) : undefined;
            if (town) {
                const next = { id: town.id, name: town.name };
                lastTownRef.current = next;
                setWelcomeTown(next);
            }
            return;
        }
        const movable = player.hero_ids.filter((id) => {
            const row = current.heroes.find((h) => h.id === id);
            return row != null && row.movement_remaining > 0;
        });
        if (movable.length === 0) {
            return;
        }
        const selectedId = getSelectedMapHeroId();
        const currentId = movable.includes(hero?.id ?? '')
            ? hero?.id ?? null
            : movable.includes(selectedId ?? '')
                ? selectedId
                : null;
        const heroId = idInDirection(currentId, movable, reverse);
        if (heroId) {
            adoptHero(heroId);
        }
    }, [adoptHero, aiPhase, hero?.id, heroScreen, welcomeTown]);
    const openHeroScreen = useCallback((heroId) => {
        if (heroId) {
            adoptHero(heroId);
        }
        setTrade(null);
        closeCombat();
        setHeroScreen(true);
    }, [adoptHero, closeCombat]);
    const openTownScreen = useCallback(() => {
        const current = getSession();
        const player = humanPlayer(current);
        if (!player) {
            return;
        }
        const remembered = lastTownRef.current;
        const rememberedOk = remembered != null && player.town_ids.includes(remembered.id);
        const townId = rememberedOk
            ? remembered.id
            : (player.town_ids[0] ?? null);
        const town = townId ? findTownById(current, townId) : undefined;
        if (!town) {
            return;
        }
        const next = { id: town.id, name: town.name };
        lastTownRef.current = next;
        setWelcomeTown(next);
    }, []);
    const onTownActed = useCallback((townId) => {
        updateSession((current) => markTownBuiltToday(current, townId));
    }, []);
    useEffect(() => {
        if (mapViewOpen) {
            setMapInputLocked(true);
        }
        else {
            setMapInputLocked(false);
        }
    }, [mapViewOpen]);
    const keybindPopupOpen = mainMenuOpen ||
        settingsOpen ||
        devOpen ||
        endTurnConfirmOpen ||
        gameLogOpen ||
        gameFlowPanel != null ||
        Boolean(dateNotice) ||
        Boolean(levelUpNotice) ||
        Boolean(archiveLearn) ||
        Boolean(surrenderPrompt) ||
        Boolean(fleePrompt) ||
        Boolean(chestOffer) ||
        Boolean(worldLibrary) ||
        Boolean(worldHanger) ||
        Boolean(dockBuy) ||
        Boolean(worldRecruits) ||
        Boolean(worldNoticeBoard) ||
        questLogOpen ||
        isArmyPopupOpen();
    const onKeybindBack = useCallback(() => {
        if (mainMenuOpen) {
            setMainMenuOpen(false);
            return;
        }
        if (settingsOpen) {
            setSettingsOpen(false);
            return;
        }
        if (devOpen) {
            setDevOpen(false);
            return;
        }
        if (gameFlowPanel) {
            setGameFlowPanel(null);
            return;
        }
        if (endTurnConfirmOpen) {
            setEndTurnConfirmOpen(false);
            return;
        }
        if (gameLogOpen) {
            setGameLogOpen(false);
            return;
        }
        if (mapViewOpen) {
            closeMapView();
            return;
        }
        if (levelUpNotice) {
            setLevelUpNotice(null);
            return;
        }
        if (dateNotice) {
            dismissDateNotice();
            return;
        }
        if (archiveLearn) {
            setArchiveLearn(null);
            return;
        }
        if (surrenderPrompt) {
            onSurrenderNo();
            return;
        }
        if (fleePrompt) {
            onFleeLetThem();
            return;
        }
        if (worldLibrary) {
            closeWorldLibrary();
            return;
        }
        if (worldHanger) {
            closeWorldHanger();
            return;
        }
        if (dockBuy) {
            closeDockBuy();
            return;
        }
        if (worldRecruits) {
            closeWorldRecruits();
            return;
        }
        if (worldNoticeBoard) {
            closeWorldNoticeBoard();
            return;
        }
        if (questLogOpen) {
            closeQuestLog();
            return;
        }
        if (combat) {
            if (document.querySelector('.combat-screen[data-hero-cast]') ||
                document.querySelector('.combat-inspect-popup') ||
                document.querySelector('.combat-modal-stack')) {
                return;
            }
            closeCombat();
            return;
        }
        if (trade) {
            setTrade(null);
            return;
        }
        if (heroScreen) {
            if (document.querySelector('.hero-screen .marketplace-overlay')) {
                return;
            }
            setHeroScreen(false);
            return;
        }
        if (welcomeTown) {
            setWelcomeTown(null);
            return;
        }
        setMainMenuOpen(true);
    }, [
        mainMenuOpen,
        settingsOpen,
        devOpen,
        gameFlowPanel,
        endTurnConfirmOpen,
        gameLogOpen,
        mapViewOpen,
        closeMapView,
        levelUpNotice,
        dateNotice,
        dismissDateNotice,
        archiveLearn,
        surrenderPrompt,
        fleePrompt,
        worldLibrary,
        closeWorldLibrary,
        worldHanger,
        closeWorldHanger,
        dockBuy,
        closeDockBuy,
        worldRecruits,
        closeWorldRecruits,
        worldNoticeBoard,
        closeWorldNoticeBoard,
        questLogOpen,
        closeQuestLog,
        combat,
        closeCombat,
        trade,
        heroScreen,
        welcomeTown,
        onSurrenderNo,
        onFleeLetThem,
    ]);
    const onKeybindConfirm = useCallback(() => {
        if (runArmyConfirmPopup()) {
            return;
        }
        if (endTurnConfirmOpen) {
            setEndTurnConfirmOpen(false);
            runEndTurn();
            return;
        }
        if (levelUpNotice) {
            setLevelUpNotice(null);
            return;
        }
        if (archiveLearn) {
            setArchiveLearn(null);
            return;
        }
        if (surrenderPrompt) {
            onSurrenderYes();
            return;
        }
        if (fleePrompt) {
            onFleeFightAnyway();
            return;
        }
        if (dateNotice) {
            dismissDateNotice();
        }
    }, [
        endTurnConfirmOpen,
        runEndTurn,
        levelUpNotice,
        archiveLearn,
        surrenderPrompt,
        fleePrompt,
        dateNotice,
        dismissDateNotice,
        onSurrenderYes,
        onFleeFightAnyway,
    ]);
    const keybindActions = useMemo(() => ({
        onBack: onKeybindBack,
        onConfirm: onKeybindConfirm,
        onEndTurn,
        onHeroScreen: () => {
            if (heroScreen) {
                cycleHero();
            }
            else {
                openHeroScreen();
            }
        },
        onTownScreen: () => {
            if (welcomeTown && !heroScreen) {
                cycleTown();
            }
            else {
                openTownScreen();
            }
        },
        onNextActionable: (reverse) => cycleNextActionable(reverse),
        onMapView: () => {
            if (mapViewOpen) {
                closeMapView();
            }
            else {
                openMapView();
            }
        },
        onQuestLog: toggleQuestLog,
        onGameLog: () => {
            if (gameLogOpen) {
                setGameLogOpen(false);
                return;
            }
            openGameLog();
        },
        onKeybinds: () => {
            setSettingsTab('keybinds');
            setSettingsOpen(true);
            setMainMenuOpen(false);
        },
        onDevMenu: () => {
            setDevOpen(true);
            setMainMenuOpen(false);
        },
        onMainMenu: () => setMainMenuOpen(true),
    }), [
        onKeybindBack,
        onKeybindConfirm,
        onEndTurn,
        heroScreen,
        cycleHero,
        openHeroScreen,
        welcomeTown,
        cycleTown,
        openTownScreen,
        cycleNextActionable,
        mapViewOpen,
        closeMapView,
        openMapView,
        toggleQuestLog,
    ]);
    useGameKeybindHandler({
        popupOpen: keybindPopupOpen,
        inBattle: Boolean(combat),
        mapViewOpen,
        townOpen: Boolean(welcomeTown),
        heroOpen: heroScreen,
        aiAnimating: aiPhase === 'running',
        blockEndTurn: aiPhase !== 'idle',
    }, keybindActions, true);
    useEffect(() => {
        if (!dateNotice) {
            return;
        }
        const ms = (dateNotice.lines?.length ?? 0) > 0 ? 4500 : 1500;
        const timer = window.setTimeout(() => {
            dismissDateNotice();
        }, ms);
        return () => window.clearTimeout(timer);
    }, [dateNotice, dismissDateNotice]);
    useEffect(() => {
        if (dateNotice || combat) {
            return;
        }
        flushPendingFlightSieges();
    }, [dateNotice, combat, flushPendingFlightSieges, session.game.pending_flight_sieges]);
    const calendarDay = calendarDayNumber(session.game.calendar);
    useEffect(() => {
        syncActivePlayerView();
    }, [session.activePlayerIndex, calendarDay]);
    useEffect(() => {
        const player = activePlayer(getSession());
        const key = `${calendarDay}-${getSession().activePlayerIndex}`;
        if (!player?.is_ai) {
            setMapInputLocked(false);
            setMapCameraFollowMoves(true);
            setAiPhase('idle');
            return;
        }
        if (combat) {
            return;
        }
        if (aiRanKeyRef.current === key) {
            return;
        }
        const mode = player.ai_spectator ? 'ai_spectator' : 'ai';
        setMapInputLocked(true);
        setMapCameraFollowMoves(mode === 'ai_spectator');
        setAiPhase('running');
        let cancelled = false;
        void (async () => {
            await Promise.resolve();
            if (cancelled) {
                return;
            }
            if (aiRanKeyRef.current === key) {
                return;
            }
            aiRanKeyRef.current = key;
            try {
                await runAiTurn(mode, {
                    engageWorldAttack: async (heroId, target) => {
                        selectHeroOnMap(heroId);
                        const wait = new Promise((resolve) => {
                            combatWaitRef.current = resolve;
                        });
                        if (target.type === 'mob') {
                            const opened = beginMobEncounter(target.mobId, false, 'ai');
                            if (!opened) {
                                combatWaitRef.current = null;
                                return;
                            }
                            await wait;
                            return;
                        }
                        if (target.type === 'hero') {
                            onHeroMeet(target.heroId);
                        }
                        else {
                            onSiegeTown(target.townId);
                        }
                        await wait;
                    },
                });
            }
            catch (error) {
                console.log('AI turn failed:', error);
            }
            if (cancelled) {
                return;
            }
            if (mode === 'ai_spectator') {
                setAiPhase('review');
                return;
            }
            setAiPhase('idle');
            runEndTurn();
        })();
        return () => {
            cancelled = true;
        };
    }, [
        session.activePlayerIndex,
        calendarDay,
        mapEpoch,
        runEndTurn,
        beginMobEncounter,
        onHeroMeet,
        onSiegeTown,
    ]);
    useEffect(() => {
        let cancelled = false;
        const loadStatus = async () => {
            try {
                const response = await fetch('/api/system/data-status');
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const payload = (await response.json());
                if (!cancelled) {
                    setDataStatus({
                        ok: payload.ok,
                        tables: Array.isArray(payload.tables) ? payload.tables : [],
                    });
                }
            }
            catch (error) {
                if (!cancelled) {
                    setDataStatus({
                        ok: false,
                        tables: [],
                        fetchError: error instanceof Error ? error.message : 'status request failed',
                    });
                }
            }
        };
        void loadStatus();
        void refreshCatalogFromDb()
            .then((catalog) => {
            if (!cancelled) {
                updateSession((current) => {
                    // F5 / bootstrap: re-apply New Game app_config defaults before spawn.
                    // Skip after Start Game so a slow catalog refresh cannot wipe picks.
                    if (allowCatalogBootDefaults &&
                        current.heroes.length === 0 &&
                        current.towns.length === 0) {
                        const defaults = defaultGameConfig(catalog);
                        setHexScale(defaults.hexSize);
                        const session = createSessionFromConfig(defaults);
                        syncGameDifficultyFromSession(session);
                        return session;
                    }
                    syncGameDifficultyFromSession(current);
                    return assignHeroesFromPool(current, catalog.hero_pool);
                });
            }
        })
            .catch(() => { });
        return () => {
            cancelled = true;
        };
    }, []);
    const hexSize = HEX_SCALES[hexScale];
    const mapLabel = mapInfo ? mapSizeLabel(mapInfo.width, mapInfo.height) : '…';
    const seedLabel = mapInfo ? String(mapInfo.seed) : '…';
    const selectedHero = hero?.id
        ? session.heroes.find((row) => row.id === hero.id)
        : session.heroes[0];
    const heroSpeed = heroMovementPoints(getCachedCatalog(), selectedHero, session.game.settings.move_mode);
    const stepsRemaining = hero?.remaining ?? heroSpeed;
    const stepsLabel = formatMovementPoints(stepsRemaining, Math.max(heroSpeed, stepsRemaining));
    const resourceLines = formatResourceLines(wallet);
    const calendarLabel = formatCalendar(calendar);
    const difficultyLabel = difficultyName(getCachedCatalog(), difficultyIdFromSettings(session.game.settings));
    const actor = activePlayer(session);
    const turnKind = !actor
        ? ''
        : actor.is_ai
            ? actor.ai_spectator
                ? ' — AI spectator (DEV)'
                : ' — AI'
            : '';
    const hasActedToday = welcomeTown
        ? hasTownBuiltToday(session, welcomeTown.id)
        : false;
    const heroName = selectedHero?.name ?? HERO_MARKER_LABEL;
    const debugSnapshot = {
        mapSize: mapLabel,
        hexSize: `${hexScale} (${hexSize})`,
        seed: seedLabel,
        heroName,
        heroQ: hero?.q ?? null,
        heroR: hero?.r ?? null,
        steps: stepsLabel,
        resources: resourceLines,
        dataStatus,
        extraLines: [
            `Players: ${session.players.length}`,
            `Active Player Index: ${session.activePlayerIndex ?? 0}`,
            `Active Player: ${humanPlayer(session)?.id ?? 'none'}`,
            `AI phase: ${aiPhase}`,
            ...session.players.map((player, index) => {
                const typeId = session.game.settings.hero_type_ids?.[index];
                const control = player.is_ai
                    ? player.ai_spectator
                        ? 'ai_spectator'
                        : 'ai'
                    : 'human';
                return `  ${index}: ${player.id} ${control} arch=${player.arch_id} type=${typeId ?? 'random'} heroes=${player.hero_ids.length} towns=${player.town_ids.length} fog=${player.explored.length} elim=${player.eliminated === true}`;
            }),
        ],
        traceLines: aiTraces.length > 0
            ? [
                '--- AI traces (DEV) ---',
                ...aiTraces.flatMap((block) => ['', ...block.split('\n')]),
            ]
            : [],
    };
    const debugText = formatDebugText(debugSnapshot);
    const debugSections = formatDebugSections(debugSnapshot);
    const copyDebug = useCallback(() => {
        void navigator.clipboard.writeText(debugText).catch((error) => {
            console.log('Failed to copy debug text:', error);
        });
    }, [debugText]);
    const panelTownId = welcomeTown?.id ?? activeTownId ?? humanPlayer(session)?.town_ids[0] ?? null;
    const activeHeroId = hero?.id ?? getSelectedMapHeroId();
    const tradePartnerHeroId = trade && activeHeroId
        ? trade.leftHeroId === activeHeroId
            ? trade.rightHeroId
            : trade.leftHeroId
        : null;
    const inCombat = Boolean(combat);
    const navalMaskDebugBridge = useSyncExternalStore(subscribeNavalMaskDebug, getNavalMaskDebugState, () => null);
    const inTown = Boolean(welcomeTown);
    const activeLogTab = defaultLogTab(inCombat, inTown);
    const catalogForLog = getCachedCatalog();
    const bannerLog = useMemo(() => {
        const base = bannerLogLines(session, catalogForLog, activeLogTab, liveCombatLogLines, logScrollBack);
        if (optionsHudNotice) {
            return [{ text: optionsHudNotice }, ...base].slice(-3);
        }
        return base;
    }, [
        session,
        catalogForLog,
        activeLogTab,
        liveCombatLogLines,
        logScrollBack,
        optionsHudNotice,
    ]);
    const bannerLogScrollMax = useMemo(() => maxBannerLogScroll(session, catalogForLog, activeLogTab, liveCombatLogLines), [session, catalogForLog, activeLogTab, liveCombatLogLines]);
    useEffect(() => {
        setLogScrollBack(0);
    }, [activeLogTab, calendarDayNumber(session.game.calendar)]);
    const turnLabel = `Player ${(session.activePlayerIndex ?? 0) + 1}${turnKind}${aiPhase === 'running' ? ' — moving…' : aiPhase === 'review' ? ' — review' : ''}`;
    const openGameLog = useCallback((tab, combatId) => {
        setGameLogTab(tab ?? defaultLogTab(Boolean(combat), Boolean(welcomeTown)));
        setGameLogFocusCombatId(combatId ?? null);
        setGameLogOpen(true);
    }, [combat, welcomeTown]);
    const optionsMenu = (_jsx(OptionsMenu, { hexScale: hexScale, onHexScale: (name) => {
            setHexScale(name);
            updateSession((current) => ({
                ...current,
                game: {
                    ...current.game,
                    settings: {
                        ...current.game.settings,
                        hex_size: name,
                    },
                },
            }));
        }, onLevelUpNotice: setLevelUpNotice, onHudNotice: setOptionsHudNotice, onStartFixedFight: (kind) => {
            const result = prepareFixedFight(getSession(), kind);
            if ('error' in result) {
                setOptionsHudNotice(result.error);
                return;
            }
            setWelcomeTown(null);
            setTrade(null);
            setHeroScreen(false);
            setSurrenderPrompt(null);
            setFleePrompt(null);
            setSession(result.session);
            setCombat({
                attackerHeroId: result.heroId,
                defenderHeroId: result.defenderHeroId,
                defenderMobId: result.mobId ?? undefined,
                navalLayout: result.navalLayout,
            });
            setOptionsHudNotice(result.notice);
        }, onLoaded: () => {
            setWelcomeTown(null);
            setHeroScreen(false);
            setTrade(null);
            closeCombat();
            setDateNotice(null);
            setLevelUpNotice(null);
            setArchiveLearn(null);
            setOptionsHudNotice(null);
            pendingLevelUpRef.current = null;
            lastTownRef.current = null;
            setActiveTownId(null);
            clearAiTraces();
            aiRanKeyRef.current = '';
            setAiPhase('idle');
            setMapInputLocked(false);
            setMapCameraFollowMoves(true);
            setHexScale(parseHexSize(getSession().game.settings.hex_size));
            syncGameDifficultyFromSession(getSession());
            const catalog = getCachedCatalog();
            if (catalog) {
                updateSession((current) => assignHeroesFromPool(current, catalog.hero_pool));
            }
            setMapEpoch((n) => n + 1);
        }, onDataStatus: setDataStatus, onCopyDebug: copyDebug, onStartGame: onStartGame, mapGenerating: mapGenerating, onPrepareNewGame: clearMapGenerating, onSeeWorld: () => openMapView(true), hideToggle: true, flowPanel: gameFlowPanel, onFlowPanelChange: setGameFlowPanel }));
    const onMainMenuFlow = useCallback((flow) => {
        setMainMenuOpen(false);
        if (!flow) {
            return;
        }
        setGameFlowPanel(flow);
    }, []);
    return (_jsxs("main", { className: "app", children: [dataStatus && !dataStatus.ok ? (_jsx("div", { className: "data-load-banner", role: "alert", children: "Data load error \u2014 check debug panel" })) : null, _jsxs(GameStage, { children: [_jsx(GameLeftPanel, { activeTownId: panelTownId, selectedHeroId: activeHeroId, townScreenOpen: inTown, tradePartnerHeroId: tradePartnerHeroId, visitingHeroName: heroName, heroStepsLabel: hero ? stepsLabel : null, hasActedToday: hasActedToday, readOnly: Boolean(actor?.is_ai), dimTowns: inCombat, dimHeroes: inCombat, dimArmy: inCombat, onSelectTown: (townId) => {
                            setActiveTownId(townId);
                            const town = findTownById(getSession(), townId);
                            if (!town) {
                                return;
                            }
                            const next = { id: town.id, name: town.name };
                            lastTownRef.current = next;
                            setWelcomeTown(next);
                        }, onSelectHero: (heroId) => {
                            adoptHero(heroId);
                        }, onOpenHero: () => openHeroScreen() }), _jsx(GameBanner, { wallet: wallet, calendarLabel: calendarLabel, weekLabel: `${difficultyLabel}`, turnLabel: turnLabel, logLines: bannerLog, logScrollBack: logScrollBack, logScrollMax: bannerLogScrollMax, onLogScrollUp: () => setLogScrollBack((value) => Math.min(bannerLogScrollMax, value + 1)), onLogScrollDown: () => setLogScrollBack((value) => Math.max(0, value - 1)), onOpenLog: () => openGameLog(), onLogDetails: (combatId) => openGameLog('combat', combatId), buttons: [
                            {
                                id: 'menu',
                                label: '☰ Menu',
                                title: 'Main Menu',
                                onClick: () => setMainMenuOpen((open) => !open),
                                dimmed: false,
                            },
                            {
                                id: 'end',
                                label: 'End Turn',
                                title: tooltipWithKey('End Turn', 'end_turn'),
                                disabled: aiPhase === 'running',
                                dimmed: inCombat,
                                onClick: onEndTurn,
                            },
                            {
                                id: 'hero',
                                label: 'Hero',
                                title: tooltipWithKey('Hero', 'hero_screen'),
                                dimmed: inCombat || inTown,
                                onClick: () => openHeroScreen(),
                            },
                            {
                                id: 'town',
                                label: 'Town',
                                title: tooltipWithKey('Town', 'town_screen'),
                                dimmed: inCombat,
                                onClick: () => openTownScreen(),
                            },
                            {
                                id: 'map',
                                label: 'Map',
                                title: tooltipWithKey('Map', 'map_view'),
                                disabled: !mapInfo || aiPhase === 'running',
                                dimmed: inCombat || inTown,
                                onClick: () => {
                                    if (mapViewOpen) {
                                        closeMapView();
                                    }
                                    else {
                                        openMapView();
                                    }
                                },
                            },
                            {
                                id: 'quest',
                                label: 'Quest',
                                title: tooltipWithKey('Quest', 'quest_log'),
                                dimmed: inCombat,
                                onClick: openQuestLog,
                            },
                        ] }), _jsxs("div", { className: "game-window", style: {
                            left: GAME_WINDOW_X,
                            top: GAME_WINDOW_Y,
                            width: GAME_WINDOW_WIDTH,
                            height: GAME_WINDOW_HEIGHT,
                        }, children: [_jsx(MainMenu, { open: mainMenuOpen, inBattle: inCombat, onClose: () => setMainMenuOpen(false), onFlow: onMainMenuFlow, onSettings: () => {
                                    setMainMenuOpen(false);
                                    setSettingsTab('audio');
                                    setSettingsOpen(true);
                                }, onDev: () => {
                                    setMainMenuOpen(false);
                                    setDevOpen(true);
                                } }), _jsx(SettingsScreen, { open: settingsOpen, initialTab: settingsTab, hexScale: hexScale, onHexScale: (name) => {
                                    setHexScale(name);
                                    updateSession((current) => ({
                                        ...current,
                                        game: {
                                            ...current.game,
                                            settings: {
                                                ...current.game.settings,
                                                hex_size: name,
                                            },
                                        },
                                    }));
                                }, onClose: () => setSettingsOpen(false) }), _jsx(DevPopup, { open: devOpen, onClose: () => setDevOpen(false), inCombat: inCombat, aiTraces: aiTraces, sections: debugSections, worldPerf: worldPerf, onCopyDebug: copyDebug, onSeeWorld: () => openMapView(true), onStartFixedFight: (kind) => {
                                    const result = prepareFixedFight(getSession(), kind);
                                    if ('error' in result) {
                                        setOptionsHudNotice(result.error);
                                        return;
                                    }
                                    setWelcomeTown(null);
                                    setTrade(null);
                                    setHeroScreen(false);
                                    setSurrenderPrompt(null);
                                    setFleePrompt(null);
                                    setSession(result.session);
                                    setCombat({
                                        attackerHeroId: result.heroId,
                                        defenderHeroId: result.defenderHeroId,
                                        defenderMobId: result.mobId ?? undefined,
                                        navalLayout: result.navalLayout,
                                    });
                                    setOptionsHudNotice(result.notice);
                                    setDevOpen(false);
                                }, onLevelUpNotice: setLevelUpNotice, onDataStatus: setDataStatus, onHudNotice: setOptionsHudNotice, terrainWedgesDebug: {
                                    enabled: terrainWedgesEnabled,
                                    onToggle: () => setTerrainWedgesEnabled((on) => !on),
                                }, zonesDebug: {
                                    enabled: zonesDebug,
                                    onToggle: () => setZonesDebug((on) => !on),
                                }, wallGapsDebug: {
                                    enabled: wallGapsDebug,
                                    onToggle: () => setWallGapsDebug((on) => !on),
                                }, roadPlanDebug: {
                                    enabled: roadPlanDebug,
                                    onToggle: () => setRoadPlanDebug((on) => !on),
                                }, navalMaskDebug: navalMaskDebugBridge?.available
                                    ? {
                                        enabled: navalMaskDebugBridge.enabled,
                                        onToggle: navalMaskDebugBridge.onToggle,
                                    }
                                    : undefined, townHexNumbers: {
                                    enabled: townHexNumbers,
                                    onToggle: () => setTownHexNumbers((on) => !on),
                                }, onAddStartingUnits: () => {
                                    const session = getSession();
                                    const selectedId = getSelectedMapHeroId();
                                    const hero = (selectedId
                                        ? session.heroes.find((row) => row.id === selectedId)
                                        : undefined) ?? session.heroes[0];
                                    if (!hero) {
                                        return;
                                    }
                                    if (hero.class_id == null ||
                                        heroArmyStackCount(session, hero.id) > 0) {
                                        return;
                                    }
                                    updateSession((current) => grantHeroStartingArmy(current, hero.id));
                                } }), _jsx("div", { className: "game-window-tools-anchor", children: optionsMenu }), _jsx(HexMap, { hexSize: hexSize, wallet: wallet, heroName: heroName, terrainWedgesEnabled: terrainWedgesEnabled, zonesDebug: zonesDebug, wallGapsDebug: wallGapsDebug, roadPlanDebug: roadPlanDebug, onMapInfo: onMapInfo, onMapGenerateFailed: onMapGenerateFailed, onHeroState: onHeroState, onResources: onResources, onTownWelcome: onTownWelcome, onFountainRestore: onFountainRestore, onChestOffer: onChestOffer, onChestMessage: onChestMessage, onSignRead: onSignRead, onWorldLibrary: onWorldLibrary, onWorldHanger: onWorldHanger, onWorldDock: onWorldDock, onWorldRecruits: onWorldRecruits, onWorldNoticeBoard: onWorldNoticeBoard, onArchiveLearn: setArchiveLearn, onHeroMeet: onHeroMeet, onSiegeTown: onSiegeTown, onMobMeet: onMobMeet, onMobAmbush: onMobAmbush }, mapEpoch), mapViewOpen && mapInfo && mapViewFocus ? (_jsx(MapView, { open: mapViewOpen, embedded: true, session: session, mapWidth: mapInfo.width, mapHeight: mapInfo.height, mapSeed: mapInfo.seed, selectedHeroId: getSelectedMapHeroId(), focusHex: mapViewFocus, terrainWedgesEnabled: terrainWedgesEnabled, revealAll: mapViewRevealAll, onClose: closeMapView, onFocusWorldHex: onMapViewFocusHex })) : null, combat ? (_jsx(CombatScreen, { attackerHeroId: combat.attackerHeroId, defenderHeroId: combat.defenderHeroId, siegeTownId: combat.siegeTownId, defenderMobId: combat.defenderMobId, navalLayout: combat.navalLayout, debugSections: debugSections, onLiveLogLines: setLiveCombatLogLines, onExit: onCombatExit })) : null, trade && activeHeroId ? (_jsx(TradeScreen, { activeHeroId: activeHeroId, partnerHeroId: trade.leftHeroId === activeHeroId
                                    ? trade.rightHeroId
                                    : trade.leftHeroId, onClose: () => setTrade(null) })) : null, welcomeTown && !trade && !combat ? (_jsx(TownManagement, { townId: welcomeTown.id, townName: welcomeTown.name, wallet: wallet, onExit: () => setWelcomeTown(null), calendarLabel: calendarLabel, hasActedToday: hasActedToday, onActed: () => onTownActed(welcomeTown.id), visitingHeroName: heroName, selectedHeroId: selectedHero?.id ?? null, onOpenHero: openHeroScreen, onCycleTown: cycleTown, onQuests: openQuestLog, onArchiveLearn: setArchiveLearn, readOnly: Boolean(actor?.is_ai), onHeroFlew: playHeroFlight, embedded: true, showHexNumbers: townHexNumbers }, welcomeTown.id)) : null, heroScreen && selectedHero && !combat && !trade ? (_jsx(HeroScreen, { heroId: selectedHero.id, embedded: true, onClose: () => setHeroScreen(false) })) : null, questLogOpen ? (_jsx(QuestLog, { embedded: true, onClose: closeQuestLog })) : null, chestOffer ? (_jsx(GameWindowOverlay, { children: _jsxs(GameWindowModal, { "aria-modal": "true", "aria-labelledby": "chest-offer-title", children: [_jsx("h1", { id: "chest-offer-title", children: chestOffer.title }), _jsx("p", { children: "XP or Loot?" }), _jsxs("p", { className: "surrender-prompt-actions", children: [_jsx("button", { type: "button", onClick: () => resolveChestChoice('xp'), children: "XP" }), _jsx("button", { type: "button", onClick: () => resolveChestChoice('loot'), children: "Loot" }), _jsx("button", { type: "button", onClick: () => resolveChestChoice('leave'), children: "Leave" })] })] }) })) : null, worldLibrary ? (_jsx(WorldLibrary, { featureId: worldLibrary.featureId, heroId: worldLibrary.heroId, onClose: closeWorldLibrary, embedded: true })) : null, worldHanger ? (_jsx(WorldHangerFlight, { featureId: worldHanger.featureId, heroId: worldHanger.heroId, onClose: closeWorldHanger, onFlyLaunched: playHeroFlight, embedded: true })) : null, dockBuy ? (_jsx(DockBuy, { featureId: dockBuy.featureId, heroId: dockBuy.heroId, onClose: closeDockBuy, embedded: true })) : null, worldRecruits ? (_jsx(WorldRecruits, { featureId: worldRecruits.featureId, heroId: worldRecruits.heroId, onClose: closeWorldRecruits, embedded: true })) : null, worldNoticeBoard ? (_jsx(WorldNoticeBoard, { featureId: worldNoticeBoard.featureId, heroId: worldNoticeBoard.heroId, onClose: closeWorldNoticeBoard, embedded: true, onDeclineMessage: (message) => setDateNotice({ title: '', date: '', lines: [message] }), onLevelUpNotice: (notice) => {
                                    pendingLevelUpRef.current = notice;
                                    setLevelUpNotice(notice);
                                    pendingLevelUpRef.current = null;
                                } })) : null, surrenderPrompt ? (_jsx(GameWindowOverlay, { children: _jsxs(GameWindowModal, { "aria-modal": "true", "aria-labelledby": "surrender-prompt-title", children: [_jsx("h1", { id: "surrender-prompt-title", children: "Surrender" }), _jsx("p", { children: surrenderPrompt.question }), _jsxs("p", { className: "surrender-prompt-actions", children: [_jsx("button", { type: "button", onClick: onSurrenderYes, children: "Yes" }), _jsx("button", { type: "button", onClick: onSurrenderNo, children: "No" })] })] }) })) : null, fleePrompt ? (_jsx(GameWindowOverlay, { children: _jsxs(GameWindowModal, { "aria-modal": "true", "aria-labelledby": "flee-prompt-title", children: [_jsx("h1", { id: "flee-prompt-title", children: "Flee" }), _jsx("p", { children: fleeOfferPrompt() }), _jsxs("p", { className: "surrender-prompt-actions", children: [_jsx("button", { type: "button", onClick: onFleeFightAnyway, children: "Fight Anyway" }), _jsx("button", { type: "button", onClick: onFleeLetThem, children: "Let Them Flee" })] })] }) })) : null, dateNotice ? (_jsx(GameWindowOverlay, { children: _jsxs(GameWindowModal, { role: "status", "aria-live": "polite", "aria-labelledby": dateNotice.title ? 'date-notice-title' : undefined, onBackdropClick: dismissDateNotice, children: [dateNotice.title ? (_jsx("h1", { id: "date-notice-title", children: dateNotice.title })) : null, dateNotice.date ? _jsx("p", { children: dateNotice.date }) : null, dateNotice.lines?.map((line, index) => (_jsx("p", { children: line }, `notice-${index}`)))] }) })) : null, levelUpNotice ? (_jsx(GameWindowOverlay, { children: _jsxs(GameWindowModal, { "aria-modal": "true", "aria-labelledby": "level-up-notice-title", onBackdropClick: () => setLevelUpNotice(null), children: [_jsxs("h1", { id: "level-up-notice-title", children: [levelUpNotice.heroName, " is now Level ", levelUpNotice.level] }), levelUpNotice.bumps.map((line) => (_jsx("p", { children: line }, line))), _jsx("button", { type: "button", className: "date-notice-ok", onClick: () => setLevelUpNotice(null), children: "OK" })] }) })) : null, endTurnConfirmOpen ? (_jsx(GameWindowOverlay, { children: _jsxs(GameWindowModal, { "aria-labelledby": "end-turn-confirm-title", onBackdropClick: () => setEndTurnConfirmOpen(false), children: [_jsx("h1", { id: "end-turn-confirm-title", children: "End turn?" }), _jsx("p", { children: "End your turn for this player?" }), _jsxs("p", { className: "surrender-prompt-actions", children: [_jsx("button", { type: "button", onClick: () => {
                                                        setEndTurnConfirmOpen(false);
                                                        runEndTurn();
                                                    }, children: "End Turn" }), _jsx("button", { type: "button", onClick: () => setEndTurnConfirmOpen(false), children: "Cancel" })] })] }) })) : null, _jsx(GameLogModal, { open: gameLogOpen, initialTab: gameLogTab, focusCombatId: gameLogFocusCombatId, liveCombatLines: liveCombatLogLines, onClose: () => setGameLogOpen(false) }), archiveLearn ? (_jsx(GameWindowOverlay, { children: _jsxs(GameWindowModal, { "aria-modal": "true", "aria-labelledby": "archive-learn-title", onBackdropClick: () => setArchiveLearn(null), children: [_jsx("h1", { id: "archive-learn-title", children: "Infernal Archive" }), _jsxs("p", { children: [archiveLearn.heroName, " learned:"] }), archiveLearn.abilityNames.map((name) => (_jsx("p", { children: name }, name))), _jsx("button", { type: "button", className: "date-notice-ok", onClick: () => setArchiveLearn(null), children: "OK" })] }) })) : null] })] })] }));
}
export default App;
