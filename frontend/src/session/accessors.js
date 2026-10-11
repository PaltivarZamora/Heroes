import { calendarDayNumber, advanceDay, isWeekRollover } from '../hex/calendar';
import { advanceAlongHexLine, nextTownCircleHex, townCircleLapSteps } from '../hex/flight';
import { transportSpriteForDeparture } from '../hex/flightTransport';
import { facingFromMove } from '../hex/heroTravelSprite';
import { hexDistance } from '../hex/pathfinding';
import { canAfford, deductCost, emptyWallet, formatAmount, GOLD_RESOURCE_ID, resourceById, RESOURCES, snapshotWallet, } from '../hex/resources';
import { logCapturedMine, logDayIncomeEvent, logPickup, logTownBuilding, logTownCapture, pruneGameLogs, } from './gameLog';
import { emptyHeroInventory, normalizeHeroInventory } from '../items/state';
import { applyRecycledHeroToNewHire, clearRecycledPoolId, } from './recycle';
import { heroPoolId, migratePoolKeyedSession, poolIdByName, poolProgressKey, progressForPoolId, } from './heroPoolKeys';
import { applyDailyHeroPoolRegen } from '../items/heroRegen';
import { armyOptions, buildingById, buildingGrowth, buildingProduces, genericRoot, genericSlotBuildings, heroMovementPoints, heroResourcePools, isArmySlot, isBuildRoot, isLibraryBuilding, nextInChain, unitCost, unitForBuilding, unitUpgradeCost, advancedUnitFor, unitById, classBranchBaseUnit, getCachedCatalog, hireHeroGoldCost, tavernHirePool, resourceDailyMineRate, resourceWeeklyNode, scaleCost, flightSpeed, flightCostPerHex, } from '../town/catalog';
import { applyRecruitmentBeaconsBeforeGrowth, applyWeeklyTownUniquesWithReport, maybeApplyInfernalArchiveAfterBuild, townRecruitCost, townUnitUpgradeCost, } from '../town/townUniques';
export { applyHeroTownVisitUniques, takeArchiveLearnNotice, } from '../town/townUniques';
import { applyWeeklyMobGrowth } from './mobs';
import { applyWeeklyNeutralTownGrowth } from './neutralTowns';
import { rollAllWorldRecruits } from './recruits';
import { creditVisitFeature, recordAbilityLearned, rollAllNoticeBoardQuests, } from './quests';
import { abilityById, classAbilityIdsAtTier, findOffer, goldCostForLevel, heroHasDiscipline, mergeLibraryOffers, } from '../town/libraryRules';
import { marketConversionRate, ownedMarketplaceCount as countOwnedMarketplaces, quoteMarketTrade, quoteMultiSell, } from '../town/market';
import { ARMY_STACK_SLOTS, BUILDING_SLOT_COUNT, HUMAN_PLAYER_ID, NECROPOLIS_TOWN_TYPE_ID, } from './types';
export function visitingHeroId(session, town, preferredId) {
    const onTown = (hero) => !hero.flight &&
        hero.position.q === town.position.q &&
        hero.position.r === town.position.r;
    if (preferredId) {
        const preferred = session.heroes.find((hero) => hero.id === preferredId && onTown(hero));
        if (preferred) {
            return preferred.id;
        }
    }
    const hero = session.heroes.find(onTown);
    return hero ? hero.id : null;
}
/** True when any army slot id maps to a living (qty > 0) unit stack. */
export function slotsHaveLivingUnits(session, slots) {
    if (!slots) {
        return false;
    }
    return slots.some((id) => {
        if (!id) {
            return false;
        }
        const row = session.units.find((unit) => unit.id === id);
        return row != null && row.qty > 0;
    });
}
/**
 * Enemy town with no garrison and no defending hero army — walk-in capture,
 * no siege battle.
 */
export function townIsUndefended(session, town, attackerHeroId) {
    if (slotsHaveLivingUnits(session, town.garrison.slots_1_to_6)) {
        return false;
    }
    const visitorId = visitingHeroId(session, town);
    if (!visitorId || visitorId === attackerHeroId) {
        return true;
    }
    const visitor = session.heroes.find((hero) => hero.id === visitorId);
    if (!visitor) {
        return true;
    }
    if (town.player_id && visitor.player_id !== town.player_id) {
        return true;
    }
    return !slotsHaveLivingUnits(session, visitor.army.slots_1_to_6);
}
export function activePlayerIndex(session) {
    const index = session.activePlayerIndex;
    if (typeof index === 'number' && index >= 0 && index < session.players.length) {
        return index;
    }
    return 0;
}
export function activePlayer(session) {
    return session.players[activePlayerIndex(session)] ?? session.players[0] ?? null;
}
/** The player whose turn it is. Kept as an alias for existing call sites. */
export function humanPlayer(session) {
    return activePlayer(session);
}
function actingPlayerId(session, ownerId) {
    if (ownerId) {
        return ownerId;
    }
    return activePlayer(session)?.id ?? null;
}
export function persistActiveExplored(session, hexes) {
    const index = activePlayerIndex(session);
    return {
        ...session,
        players: session.players.map((player, i) => i === index ? { ...player, explored: hexes } : player),
    };
}
export function isPlayerEliminated(session, player) {
    if (player.eliminated) {
        return true;
    }
    const hasTown = session.towns.some((town) => town.player_id === player.id);
    const hasHero = session.heroes.some((hero) => hero.player_id === player.id);
    if (hasTown || hasHero) {
        return false;
    }
    return session.towns.length > 0 || session.heroes.length > 0;
}
/** Mines owned by eliminated players revert to Neutral (unclaimed). */
export function releaseEliminatedPlayerMines(session, eliminatedIds) {
    if (eliminatedIds.size === 0) {
        return session;
    }
    let changed = false;
    const nodes = session.nodes.map((node) => {
        if (node.kind !== 'mine' ||
            node.player_id == null ||
            !eliminatedIds.has(node.player_id)) {
            return node;
        }
        changed = true;
        return { ...node, player_id: null };
    });
    return changed ? { ...session, nodes } : session;
}
export function withEliminations(session) {
    let changed = false;
    const newlyEliminated = new Set();
    const players = session.players.map((player) => {
        const eliminated = isPlayerEliminated(session, player);
        if (eliminated === player.eliminated) {
            return player;
        }
        changed = true;
        if (eliminated && !player.eliminated) {
            newlyEliminated.add(player.id);
        }
        return { ...player, eliminated };
    });
    let next = changed ? { ...session, players } : session;
    if (newlyEliminated.size > 0) {
        next = releaseEliminatedPlayerMines(next, newlyEliminated);
    }
    return next;
}
/** Surviving players when the match has a sole remaining side. */
export function matchVictors(session) {
    const alive = session.players.filter((player) => !isPlayerEliminated(session, player));
    if (alive.length === 1 && session.players.length > 1) {
        return alive;
    }
    return [];
}
export function matchVictoryResult(session) {
    const winners = matchVictors(session);
    if (winners.length === 0) {
        return null;
    }
    const winnerIds = new Set(winners.map((player) => player.id));
    return {
        winners,
        losers: session.players.filter((player) => !winnerIds.has(player.id)),
    };
}
export function nextActivePlayerIndex(session) {
    const start = activePlayerIndex(session);
    const n = session.players.length;
    if (n === 0) {
        return { index: 0, dayAdvance: false };
    }
    for (let step = 1; step <= n; step += 1) {
        const index = (start + step) % n;
        const player = session.players[index];
        if (!player || isPlayerEliminated(session, player)) {
            continue;
        }
        return { index, dayAdvance: index <= start };
    }
    return { index: start, dayAdvance: true };
}
export function endTurn(session) {
    let current = withEliminations(session);
    const { index, dayAdvance } = nextActivePlayerIndex(current);
    current = { ...current, activePlayerIndex: index };
    const incomeEvents = [];
    if (dayAdvance) {
        const catalog = getCachedCatalog();
        const previous = current.game.calendar;
        const next = advanceDay(previous);
        current = {
            ...current,
            game: { ...current.game, calendar: next },
        };
        if (catalog) {
            current = applyDailyHeroPoolRegen(current, catalog);
        }
        current = advanceAllFlights(current);
        const mineResult = applyMineIncomeWithReport(current);
        current = mineResult.session;
        incomeEvents.push(...mineResult.events);
        current = {
            ...current,
            heroes: current.heroes.map((hero) => ({
                ...hero,
                used_abilities_today: [],
            })),
        };
        current = restoreHeroPoolsEndingDayInTown(current);
        current = {
            ...current,
            game: {
                ...current.game,
                town_pool_restore_ids: heroIdsInOwnedTown(current),
            },
        };
        if (isWeekRollover(previous, next)) {
            if (catalog) {
                const weekResult = applyWeeklyGrowthWithReport(current, catalog);
                current = weekResult.session;
                incomeEvents.push(...weekResult.events);
                current = applyWeeklyMobGrowth(current, catalog);
                current = applyWeeklyNeutralTownGrowth(current, catalog, next);
            }
        }
        current = pruneGameLogs(current, catalog, calendarDayNumber(current.game.calendar));
        for (const event of incomeEvents) {
            current = logDayIncomeEvent(current, event);
        }
    }
    const incoming = activePlayer(current);
    if (incoming) {
        current = restorePlayerHeroMovement(current, incoming.id);
    }
    lastDayIncomeNoticeLines = dayAdvance
        ? formatDayIncomeNoticeLines(incomeEvents, localHumanPlayerId(current))
        : [];
    return current;
}
/** Human (non-AI) player id for HUD notices; falls back to player-1. */
function localHumanPlayerId(session) {
    return (session.players.find((player) => !player.is_ai)?.id ?? HUMAN_PLAYER_ID);
}
/** Day/week income lines from the last `endTurn` day advance (cleared on read). */
let lastDayIncomeNoticeLines = [];
export function takeDayIncomeNoticeLines() {
    const lines = lastDayIncomeNoticeLines;
    lastDayIncomeNoticeLines = [];
    return lines;
}
function resourceLabel(resourceId) {
    return resourceById(resourceId)?.name ?? `Resource ${resourceId}`;
}
function formatDayIncomeNoticeLines(events, playerId) {
    const townLines = [];
    const mineLines = [];
    for (const event of events) {
        if (event.playerId !== playerId) {
            continue;
        }
        if (event.kind === 'construct') {
            townLines.push(`${event.uniqueName} - ${event.verb} ${event.buildingName}`);
            continue;
        }
        if (event.kind === 'growth') {
            if (event.amount <= 0) {
                continue;
            }
            townLines.push(`${event.uniqueName} - +${formatAmount(event.amount)} ${event.buildingName}`);
            continue;
        }
        if (event.amount <= 0) {
            continue;
        }
        const res = resourceLabel(event.resourceId);
        if (event.kind === 'building') {
            townLines.push(`${event.townName}: ${event.buildingName} - ${formatAmount(event.amount)} ${res}`);
        }
        else if (event.kind === 'unique') {
            townLines.push(`${event.townName}: ${event.uniqueName} — ${formatAmount(event.amount)} ${res}`);
        }
        else {
            mineLines.push(`${res} Mines (${event.mineCount}) - ${formatAmount(event.amount)} ${res}`);
        }
    }
    // Towns (weekly) first, then daily mine payouts.
    return [...townLines, ...mineLines];
}
const PLACEHOLDER_HERO_NAME = 'X1';
export const STARTING_HERO_LEVEL = 1;
export const STARTING_HERO_XP = 0;
export function emptyHeroProgress() {
    return {};
}
function asHeroLevel(value, fallback) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 1) {
        return fallback;
    }
    return Math.floor(n);
}
function asHeroXp(value, fallback) {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) {
        return fallback;
    }
    return Math.floor(n);
}
function asHeroPoolAmount(value, fallback) {
    if (value == null || value === '') {
        return fallback;
    }
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) {
        return fallback;
    }
    return Math.floor(n);
}
function asAbilityIdList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((id) => typeof id === 'number' && Number.isInteger(id) && id > 0);
}
export function progressForHeroName(session, name) {
    const poolId = poolIdByName(getCachedCatalog(), name);
    const saved = poolId != null ? progressForPoolId(session, poolId) : undefined;
    return {
        current_level: asHeroLevel(saved?.current_level, STARTING_HERO_LEVEL),
        current_xp: asHeroXp(saved?.current_xp, STARTING_HERO_XP),
    };
}
export function setPoolProgress(session, poolId, live) {
    const key = poolProgressKey(poolId);
    return {
        ...session,
        hero_progress: {
            ...(session.hero_progress ?? {}),
            [key]: {
                current_level: asHeroLevel(live.current_level, STARTING_HERO_LEVEL),
                current_xp: asHeroXp(live.current_xp, STARTING_HERO_XP),
            },
        },
    };
}
export function withNamedProgress(session, name, live) {
    if (!name || name === PLACEHOLDER_HERO_NAME) {
        return session;
    }
    const poolId = poolIdByName(getCachedCatalog(), name);
    if (poolId == null) {
        return session;
    }
    const key = poolProgressKey(poolId);
    const existing = session.hero_progress?.[key];
    if (existing) {
        return session;
    }
    return setPoolProgress(session, poolId, live);
}
export function setNamedProgress(session, name, live) {
    if (!name || name === PLACEHOLDER_HERO_NAME) {
        return session;
    }
    const poolId = poolIdByName(getCachedCatalog(), name);
    if (poolId == null) {
        return session;
    }
    return setPoolProgress(session, poolId, live);
}
export function normalizeHeroProgress(session) {
    const catalog = getCachedCatalog();
    let base = migratePoolKeyedSession(session, catalog);
    const progress = {};
    const raw = base.hero_progress;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [key, row] of Object.entries(raw)) {
            if (!key || !/^\d+$/.test(key)) {
                continue;
            }
            progress[key] = {
                current_level: asHeroLevel(row?.current_level, STARTING_HERO_LEVEL),
                current_xp: asHeroXp(row?.current_xp, STARTING_HERO_XP),
            };
        }
    }
    const heroes = base.heroes.map((hero) => {
        const withItems = normalizeHeroInventory(hero);
        const poolId = heroPoolId(catalog, hero);
        const saved = poolId != null ? progress[poolProgressKey(poolId)] : undefined;
        const fromHero = {
            current_level: asHeroLevel(hero.current_level, saved?.current_level ?? STARTING_HERO_LEVEL),
            current_xp: asHeroXp(hero.current_xp, saved?.current_xp ?? STARTING_HERO_XP),
        };
        const pools = heroResourcePools(catalog, {
            ...withItems,
            ...fromHero,
        });
        if (poolId != null) {
            const key = poolProgressKey(poolId);
            progress[key] = progress[key] ?? fromHero;
        }
        return {
            ...withItems,
            ...fromHero,
            pool_id: poolId ?? hero.pool_id ?? null,
            current_mana: asHeroPoolAmount(hero.current_mana, pools.current_mana),
            current_energy: asHeroPoolAmount(hero.current_energy, pools.current_energy),
            used_abilities_this_battle: asAbilityIdList(hero.used_abilities_this_battle),
            used_abilities_today: asAbilityIdList(hero.used_abilities_today),
            arch_id: typeof hero.arch_id === 'number' && hero.arch_id > 0 ? hero.arch_id : null,
        };
    });
    return { ...base, heroes, hero_progress: progress };
}
export function hireHeroCostMap() {
    return hireHeroGoldCost(getCachedCatalog());
}
function heroNeedsPool(hero) {
    return hero.class_id == null || hero.name === PLACEHOLDER_HERO_NAME;
}
export function unusedHeroPool(session, pool) {
    const used = new Set(session.heroes
        .filter((hero) => !heroNeedsPool(hero))
        .map((hero) => hero.name));
    return pool.filter((row) => !used.has(row.name));
}
export function unusedTavernPool(session, catalog, townTypeId) {
    return unusedHeroPool(session, tavernHirePool(catalog, townTypeId));
}
export function assignHeroesFromPool(session, pool) {
    const available = unusedHeroPool(session, pool);
    if (available.length === 0) {
        return session;
    }
    let nextAvailable = available;
    let changed = false;
    let progress = { ...(session.hero_progress ?? {}) };
    const heroes = session.heroes.map((hero) => {
        if (!heroNeedsPool(hero) || nextAvailable.length === 0) {
            return hero;
        }
        const pick = nextAvailable[Math.floor(Math.random() * nextAvailable.length)];
        nextAvailable = nextAvailable.filter((row) => row.id !== pick.id);
        changed = true;
        const key = poolProgressKey(pick.id);
        const live = progress[key] ?? {
            current_level: STARTING_HERO_LEVEL,
            current_xp: STARTING_HERO_XP,
        };
        progress[key] = live;
        return {
            ...hero,
            name: pick.name,
            pool_id: pick.id,
            class_id: pick.class_id,
            image_path: pick.image_path,
            army: { ...hero.army, slot_0: pick.name },
            learned_abilities: hero.learned_abilities ?? [],
            current_level: live.current_level,
            current_xp: live.current_xp,
            arch_id: pick.arch_id ?? null,
            movement_remaining: heroMovementPoints(getCachedCatalog(), {
                class_id: pick.class_id,
                current_level: live.current_level,
            }, session.game.settings.move_mode),
            ...heroResourcePools(getCachedCatalog(), {
                class_id: pick.class_id,
                current_level: live.current_level,
            }),
        };
    });
    const withNames = changed ? { ...session, heroes, hero_progress: progress } : session;
    if (!changed) {
        return withNames;
    }
    let next = withNames;
    for (const hero of next.heroes) {
        next = grantHeroStartingArmy(next, hero.id);
    }
    return next;
}
function nextHeroId(session) {
    let n = session.heroes.length + 1;
    let id = `hero-${n}`;
    while (session.heroes.some((hero) => hero.id === id)) {
        n += 1;
        id = `hero-${n}`;
    }
    return id;
}
export function hireHeroFromPool(session, townId, pick, spawnAt) {
    const town = findTownById(session, townId);
    if (!town) {
        return { session, error: 'This town is not in the game session.' };
    }
    const onTown = spawnAt == null ||
        (spawnAt.q === town.position.q && spawnAt.r === town.position.r);
    if (onTown && visitingHeroId(session, town)) {
        return { session, error: 'A hero is visiting — cannot hire' };
    }
    if (unusedHeroPool(session, [pick]).length === 0) {
        return { session, error: 'That hero is already in this game.' };
    }
    const catalog = getCachedCatalog();
    if (catalog && tavernHirePool(catalog, town.town_type_id).every((row) => row.id !== pick.id)) {
        return { session, error: 'That hero cannot be hired in this town.' };
    }
    const spent = spendResources(session, hireHeroCostMap());
    if (spent.error) {
        return spent;
    }
    const live = progressForHeroName(spent.session, pick.name);
    const catalogLive = getCachedCatalog();
    let hero = {
        id: nextHeroId(spent.session),
        player_id: actingPlayerId(spent.session) ?? HUMAN_PLAYER_ID,
        name: pick.name,
        class_id: pick.class_id,
        image_path: pick.image_path,
        position: spawnAt ? { ...spawnAt } : { ...town.position },
        army: {
            slot_0: pick.name,
            slots_1_to_6: Array.from({ length: ARMY_STACK_SLOTS }, () => null),
        },
        learned_abilities: [],
        ability_learn_log: [],
        current_level: live.current_level,
        current_xp: live.current_xp,
        used_abilities_this_battle: [],
        used_abilities_today: [],
        arch_id: pick.arch_id ?? null,
        movement_remaining: heroMovementPoints(catalogLive, {
            class_id: pick.class_id,
            current_level: live.current_level,
        }, session.game.settings.move_mode),
        flight: null,
        travel_facing: 'right',
        ...heroResourcePools(catalogLive, {
            class_id: pick.class_id,
            current_level: live.current_level,
            ...emptyHeroInventory(),
        }),
        ...emptyHeroInventory(),
    };
    hero = { ...hero, pool_id: pick.id };
    if (catalogLive) {
        hero = applyRecycledHeroToNewHire(spent.session, catalogLive, pick.id, pick.name, hero);
    }
    let hiredSession = clearRecycledPoolId(spent.session, pick.id);
    return {
        session: grantHeroStartingArmy(withNamedProgress({
            ...hiredSession,
            heroes: [...hiredSession.heroes, hero],
            players: hiredSession.players.map((player) => player.id === hero.player_id
                ? { ...player, hero_ids: [...player.hero_ids, hero.id] }
                : player),
        }, pick.name, live), hero.id),
        error: null,
    };
}
export function walletFromPlayer(session, playerId) {
    const wallet = emptyWallet();
    const player = session.players.find((row) => row.id === playerId);
    if (!player) {
        return wallet;
    }
    const weekly = playerWeeklyIncome(session, getCachedCatalog(), player.id);
    for (const resource of RESOURCES) {
        wallet[resource.id].stockpile = player.resources[resource.id] ?? 0;
        wallet[resource.id].weeklyIncome = weekly[resource.id] ?? 0;
    }
    return wallet;
}
export function walletFromSession(session) {
    const player = activePlayer(session);
    if (!player) {
        return emptyWallet();
    }
    return walletFromPlayer(session, player.id);
}
export function applyWalletStockpiles(session, wallet) {
    return {
        ...session,
        players: session.players.map((player) => player.id === (activePlayer(session)?.id ?? HUMAN_PLAYER_ID)
            ? {
                ...player,
                resources: Object.fromEntries(RESOURCES.map((resource) => [
                    resource.id,
                    wallet[resource.id].stockpile,
                ])),
            }
            : player),
    };
}
const CHEST_GOLD = 10000;
const CHEST_EACH = 20;
/**
 * Debug: every hero learns all abilities at one Library tier (exclusive —
 * that tier only, both class disciplines). Does not grant other tiers.
 */
export function grantClassAbilitiesAtTier(session, levelId) {
    const catalog = getCachedCatalog();
    if (!catalog) {
        return session;
    }
    return {
        ...session,
        heroes: session.heroes.map((hero) => {
            const fromTier = classAbilityIdsAtTier(catalog, hero.class_id, levelId);
            if (fromTier.length === 0) {
                return hero;
            }
            const have = new Set(hero.learned_abilities ?? []);
            for (const id of fromTier) {
                have.add(id);
            }
            return { ...hero, learned_abilities: [...have] };
        }),
    };
}
/** Debug/options: 10,000 gold plus 20 of every other resource. */
export function grantOpenChest(session) {
    const player = activePlayer(session);
    if (!player) {
        return session;
    }
    const catalog = getCachedCatalog();
    const ids = catalog && catalog.resource.length > 0
        ? catalog.resource.map((row) => row.id)
        : RESOURCES.map((row) => row.id);
    const resources = { ...player.resources };
    for (const id of ids) {
        const add = id === GOLD_RESOURCE_ID ? CHEST_GOLD : CHEST_EACH;
        resources[id] = (resources[id] ?? 0) + add;
    }
    return {
        ...session,
        players: session.players.map((row) => row.id === player.id ? { ...row, resources } : row),
    };
}
/**
 * Debug/options: place basic (level-1) army dwellings for slots 11–16 on the
 * player's first controlled town. `armyChoice` 1 = first root per slot (by id),
 * 2 = second. Includes one week of initial growth in recruit_qty.
 */
export function grantBuildArmy(session, armyChoice) {
    const player = activePlayer(session);
    if (!player) {
        return { session, notice: 'No active player.' };
    }
    const catalog = getCachedCatalog();
    if (!catalog) {
        return { session, notice: 'Catalog not loaded.' };
    }
    const town = session.towns.find((row) => row.player_id === player.id);
    if (!town) {
        return { session, notice: 'You do not control a town.' };
    }
    const rootIndex = armyChoice - 1;
    let next = session;
    let built = 0;
    for (let slotNum = 11; slotNum <= 16; slotNum += 1) {
        if (!isArmySlot(slotNum)) {
            continue;
        }
        const roots = armyOptions(catalog, slotNum, town.town_type_id)
            .filter(isBuildRoot)
            .sort((a, b) => a.id - b.id);
        const building = roots[rootIndex];
        if (!building) {
            continue;
        }
        next = patchBuildingSlot(next, town.id, slotNum - 1, {
            level: 1,
            buildingId: building.id,
            recruitQty: buildingGrowth(building),
        });
        built += 1;
    }
    if (built === 0) {
        return {
            session,
            notice: `No Army ${armyChoice} buildings defined for this town.`,
        };
    }
    const townLabel = town.name?.trim() || 'your first town';
    return {
        session: next,
        notice: `Built Army ${armyChoice} (slots 11–16) in ${townLabel} with initial growth`,
    };
}
/** Basic (slots 1–5, 11–16) + non-upgradeable (6–9) roots for every town. */
const BASIC_BUILD_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16];
/** Upgradeable slots that can gain +1 level (skip when capped). */
const UPGRADE_BUILD_SLOTS = [1, 2, 3, 4, 5, 11, 12, 13, 14, 15, 16];
function slotAlreadyBuilt(session, townId, slotNum) {
    return session.building_states.some((row) => row.town_id === townId &&
        row.slot_num === slotNum &&
        row.building_id != null &&
        row.level >= 1);
}
export function grantBuildBasicBuildings(session) {
    const catalog = getCachedCatalog();
    if (!catalog) {
        return { session, notice: 'Catalog not loaded.' };
    }
    if (session.towns.length === 0) {
        return { session, notice: 'No towns in this game.' };
    }
    let next = session;
    let built = 0;
    for (const town of next.towns) {
        for (const slotNum of BASIC_BUILD_SLOTS) {
            if (slotAlreadyBuilt(next, town.id, slotNum)) {
                continue;
            }
            const building = isArmySlot(slotNum)
                ? armyOptions(catalog, slotNum, town.town_type_id)
                    .filter(isBuildRoot)
                    .sort((a, b) => a.id - b.id)[0]
                : genericRoot(genericSlotBuildings(catalog, slotNum, town.town_type_id));
            if (!building) {
                continue;
            }
            next = patchBuildingSlot(next, town.id, slotNum - 1, {
                level: 1,
                buildingId: building.id,
                recruitQty: isArmySlot(slotNum) ? buildingGrowth(building) : 0,
            });
            if (isLibraryBuilding(building)) {
                next = ensureLibraryOffers(next, catalog, town.id, town.town_type_id, slotNum);
            }
            built += 1;
        }
    }
    return {
        session: next,
        notice: built > 0
            ? `Built ${built} basic building(s) across ${session.towns.length} town(s).`
            : 'All basic building slots already filled.',
    };
}
export function grantUpgradeBuildings(session) {
    const catalog = getCachedCatalog();
    if (!catalog) {
        return { session, notice: 'Catalog not loaded.' };
    }
    if (session.towns.length === 0) {
        return { session, notice: 'No towns in this game.' };
    }
    let next = session;
    let upgraded = 0;
    let skipped = 0;
    for (const town of next.towns) {
        for (const slotNum of UPGRADE_BUILD_SLOTS) {
            const state = next.building_states.find((row) => row.town_id === town.id && row.slot_num === slotNum);
            if (!state || state.building_id == null || state.level < 1) {
                continue;
            }
            const current = buildingById(catalog, state.building_id);
            if (!current) {
                continue;
            }
            const advanced = nextInChain(current, catalog, slotNum, town.town_type_id);
            if (!advanced) {
                skipped += 1;
                continue;
            }
            next = patchBuildingSlot(next, town.id, slotNum - 1, {
                level: Math.max(1, advanced.level),
                buildingId: advanced.id,
                recruitQty: state.recruit_qty,
            });
            if (isLibraryBuilding(advanced)) {
                next = ensureLibraryOffers(next, catalog, town.id, town.town_type_id, slotNum);
            }
            upgraded += 1;
        }
    }
    return {
        session: next,
        notice: upgraded > 0
            ? `Upgraded ${upgraded} building(s) (+1 level); skipped ${skipped} empty/capped.`
            : 'No upgradeable buildings (empty or already capped).',
    };
}
export function spendResources(session, cost) {
    const wallet = walletFromSession(session);
    const error = canAfford(wallet, cost);
    if (error) {
        return { session, error };
    }
    return {
        session: applyWalletStockpiles(session, deductCost(wallet, cost)),
        error: null,
    };
}
export function playerMarketplaceCount(session, catalog) {
    const player = humanPlayer(session);
    if (!player) {
        return 0;
    }
    const ownedTownIds = new Set(session.towns
        .filter((town) => town.player_id === player.id)
        .map((town) => town.id));
    return countOwnedMarketplaces(catalog, ownedTownIds, session.building_states);
}
export function executeMarketTrade(session, catalog, sellId, buyId, edited, qty) {
    if (sellId === buyId) {
        return { session, error: 'Choose two different resources.' };
    }
    const player = humanPlayer(session);
    if (!player) {
        return { session, error: 'No player.' };
    }
    const rate = marketConversionRate(catalog.market, playerMarketplaceCount(session, catalog));
    if (rate == null) {
        return { session, error: 'Market rates are not loaded.' };
    }
    const ownedSell = player.resources[sellId] ?? 0;
    const quote = quoteMarketTrade(catalog, sellId, buyId, rate, edited, qty, ownedSell);
    if (!quote || quote.sellQty <= 0 || quote.buyQty <= 0) {
        return { session, error: 'Trade is not valid.' };
    }
    if (quote.sellQty > ownedSell) {
        return { session, error: 'Not enough to sell.' };
    }
    const wallet = walletFromSession(session);
    const sellEntry = wallet[sellId];
    const buyEntry = wallet[buyId];
    if (!sellEntry || !buyEntry) {
        return { session, error: 'Unknown resource.' };
    }
    const next = snapshotWallet(wallet);
    next[sellId].stockpile -= quote.sellQty;
    next[buyId].stockpile += quote.buyQty;
    return { session: applyWalletStockpiles(session, next), error: null };
}
export function executeMarketMultiSell(session, catalog, sellIds, buyId) {
    const player = humanPlayer(session);
    if (!player) {
        return { session, error: 'No player.' };
    }
    const rate = marketConversionRate(catalog.market, playerMarketplaceCount(session, catalog));
    if (rate == null) {
        return { session, error: 'Market rates are not loaded.' };
    }
    const quote = quoteMultiSell(catalog, sellIds, buyId, rate, player.resources);
    if (quote.buyTotal <= 0 || quote.included.length === 0) {
        return { session, error: 'Trade is not valid.' };
    }
    const wallet = walletFromSession(session);
    const buyEntry = wallet[buyId];
    if (!buyEntry) {
        return { session, error: 'Unknown resource.' };
    }
    const next = snapshotWallet(wallet);
    for (const line of quote.included) {
        const sellEntry = next[line.sellId];
        if (!sellEntry || line.sellQty > (player.resources[line.sellId] ?? 0)) {
            return { session, error: 'Not enough to sell.' };
        }
        sellEntry.stockpile -= line.sellQty;
    }
    next[buyId].stockpile += quote.buyTotal;
    return { session: applyWalletStockpiles(session, next), error: null };
}
export function applyMineIncome(session) {
    return applyMineIncomeWithReport(session).session;
}
function applyMineIncomeWithReport(session) {
    const catalog = getCachedCatalog();
    const payoutByPlayer = new Map();
    const nodes = session.nodes.map((node) => {
        if (node.kind !== 'mine' || node.player_id == null) {
            return node;
        }
        const rate = resourceDailyMineRate(catalog, node.resource_id);
        if (rate <= 0) {
            return node;
        }
        let accrued = (node.accrued_fraction ?? 0) + rate;
        const whole = Math.floor(accrued);
        accrued -= whole;
        const byRes = payoutByPlayer.get(node.player_id) ??
            new Map();
        const bag = byRes.get(node.resource_id) ?? { amount: 0, mineCount: 0 };
        bag.mineCount += 1;
        if (whole > 0) {
            bag.amount += whole;
        }
        byRes.set(node.resource_id, bag);
        payoutByPlayer.set(node.player_id, byRes);
        return { ...node, accrued_fraction: accrued };
    });
    const events = [];
    for (const [playerId, byRes] of payoutByPlayer) {
        for (const [resourceId, bag] of byRes) {
            if (bag.amount > 0) {
                events.push({
                    kind: 'mine',
                    playerId,
                    resourceId,
                    amount: bag.amount,
                    mineCount: bag.mineCount,
                });
            }
        }
    }
    if (events.length === 0) {
        const changed = nodes.some((node, i) => node.accrued_fraction !== session.nodes[i]?.accrued_fraction);
        return {
            session: changed ? { ...session, nodes } : session,
            events,
        };
    }
    return {
        session: {
            ...session,
            nodes,
            players: session.players.map((player) => {
                if (isPlayerEliminated(session, player)) {
                    return player;
                }
                const byRes = payoutByPlayer.get(player.id);
                if (!byRes) {
                    return player;
                }
                const resources = { ...player.resources };
                for (const [resourceId, bag] of byRes) {
                    if (bag.amount > 0) {
                        resources[resourceId] = (resources[resourceId] ?? 0) + bag.amount;
                    }
                }
                return { ...player, resources };
            }),
        },
        events,
    };
}
export function slotStatesForTown(session, townId) {
    const slots = Array.from({ length: BUILDING_SLOT_COUNT }, () => ({
        level: 0,
        buildingId: null,
        recruitQty: 0,
    }));
    for (const row of session.building_states) {
        if (row.town_id !== townId) {
            continue;
        }
        const index = row.slot_num - 1;
        if (index >= 0 && index < slots.length) {
            slots[index] = {
                level: row.level,
                buildingId: row.building_id,
                recruitQty: row.recruit_qty,
            };
        }
    }
    return slots;
}
function emptyBuildingStates(townId) {
    return Array.from({ length: BUILDING_SLOT_COUNT }, (_, index) => ({
        id: `${townId}-slot-${index + 1}`,
        town_id: townId,
        building_id: null,
        slot_num: index + 1,
        level: 0,
        recruit_qty: 0,
        offered_abilities: [],
    }));
}
function withBuildingSlots(session, townId) {
    const existing = session.building_states.filter((row) => row.town_id === townId);
    if (existing.length === 0) {
        return {
            ...session,
            building_states: [...session.building_states, ...emptyBuildingStates(townId)],
        };
    }
    const have = new Set(existing.map((row) => row.slot_num));
    const missing = [];
    for (let slotNum = 1; slotNum <= BUILDING_SLOT_COUNT; slotNum += 1) {
        if (!have.has(slotNum)) {
            missing.push({
                id: `${townId}-slot-${slotNum}`,
                town_id: townId,
                building_id: null,
                slot_num: slotNum,
                level: 0,
                recruit_qty: 0,
                offered_abilities: [],
            });
        }
    }
    if (missing.length === 0) {
        return session;
    }
    return {
        ...session,
        building_states: [...session.building_states, ...missing],
    };
}
export function patchBuildingSlot(session, townId, slotIndex, next) {
    const current = withBuildingSlots(session, townId);
    const slotNum = slotIndex + 1;
    const prev = current.building_states.find((row) => row.town_id === townId && row.slot_num === slotNum);
    const exists = prev != null;
    let updated;
    if (!exists) {
        updated = {
            ...current,
            building_states: [
                ...current.building_states,
                {
                    id: `${townId}-slot-${slotNum}`,
                    town_id: townId,
                    building_id: next.buildingId,
                    slot_num: slotNum,
                    level: next.level,
                    recruit_qty: next.recruitQty,
                    offered_abilities: [],
                },
            ],
        };
    }
    else {
        updated = {
            ...current,
            building_states: current.building_states.map((row) => row.town_id === townId && row.slot_num === slotNum
                ? {
                    ...row,
                    building_id: next.buildingId,
                    level: next.level,
                    recruit_qty: next.recruitQty,
                    growth_bonus: row.growth_bonus ?? 0,
                    offered_abilities: next.level === 0 ? [] : (row.offered_abilities ?? []),
                }
                : row),
        };
    }
    const town = updated.towns.find((row) => row.id === townId);
    if (town?.player_id &&
        next.buildingId != null &&
        next.level > 0 &&
        (prev?.building_id !== next.buildingId || (prev?.level ?? 0) < next.level)) {
        const built = prev?.building_id !== next.buildingId || (prev?.level ?? 0) === 0;
        updated = logTownBuilding(updated, town.player_id, townId, next.buildingId, next.level, built);
    }
    return updated;
}
/**
 * After a building is placed/upgraded in a town: Infernal Archive grants its
 * visit learn effect immediately if a hero is already standing in town.
 */
export function afterTownBuildingPlaced(session, catalog, townId, building) {
    const town = session.towns.find((row) => row.id === townId);
    if (!town) {
        return session;
    }
    return maybeApplyInfernalArchiveAfterBuild(session, catalog, town, building, visitingHeroId(session, town));
}
export function ensureLibraryOffers(session, catalog, townId, townTypeId, slotNum) {
    let changed = false;
    const building_states = session.building_states.map((row) => {
        if (row.town_id !== townId || row.slot_num !== slotNum) {
            return row;
        }
        if (row.level < 1 || row.building_id == null) {
            return row;
        }
        const offered = mergeLibraryOffers(row.offered_abilities, catalog, row.building_id, townTypeId, row.level);
        if (offered === row.offered_abilities) {
            return row;
        }
        changed = true;
        return { ...row, offered_abilities: offered };
    });
    return changed ? { ...session, building_states } : session;
}
export function learnLibraryAbility(session, catalog, townId, heroId, abilityId) {
    const town = findTownById(session, townId);
    const hero = session.heroes.find((row) => row.id === heroId);
    if (!town || !hero) {
        return { session, error: 'This town is not in the game session.' };
    }
    if (visitingHeroId(session, town) !== heroId) {
        return { session, error: 'A hero must be visiting this town.' };
    }
    const ability = abilityById(catalog, abilityId);
    if (!ability) {
        return { session, error: 'Unknown ability.' };
    }
    if ((hero.learned_abilities ?? []).includes(abilityId)) {
        return { session, error: 'Already learned.' };
    }
    if (!heroHasDiscipline(catalog, hero.class_id, ability.discipline_id)) {
        return { session, error: 'This hero cannot learn that ability.' };
    }
    const library = session.building_states.find((row) => {
        if (row.town_id !== townId || row.level < ability.level_id || row.building_id == null) {
            return false;
        }
        const building = buildingById(catalog, row.building_id);
        return building != null && isLibraryBuilding(building);
    });
    if (!library) {
        return { session, error: 'That tier is not open yet.' };
    }
    const offer = findOffer(library.offered_abilities, ability.discipline_id, ability.level_id);
    if (!offer || !offer.ability_ids.includes(abilityId)) {
        return { session, error: 'That ability is not on offer.' };
    }
    return applyLearnedAbility(session, heroId, abilityId, ability.level_id);
}
/**
 * Learn an ability from a world-map Library feature (BR S9-5).
 * Same discipline / known / gold gates as {@link learnLibraryAbility}; offer
 * list is the feature's fixed {@code ability_ids} (no building tier).
 */
export function learnWorldLibraryAbility(session, catalog, featureId, heroId, abilityId) {
    const feature = findWorldLibraryById(session, featureId);
    const hero = session.heroes.find((row) => row.id === heroId);
    if (!feature || !hero) {
        return { session, error: 'This library is not in the game session.' };
    }
    const ability = abilityById(catalog, abilityId);
    if (!ability) {
        return { session, error: 'Unknown ability.' };
    }
    if ((hero.learned_abilities ?? []).includes(abilityId)) {
        return { session, error: 'Already learned.' };
    }
    if (!heroHasDiscipline(catalog, hero.class_id, ability.discipline_id)) {
        return { session, error: 'This hero cannot learn that ability.' };
    }
    if (!feature.ability_ids.includes(abilityId)) {
        return { session, error: 'That ability is not on offer.' };
    }
    return applyLearnedAbility(session, heroId, abilityId, ability.level_id);
}
function applyLearnedAbility(session, heroId, abilityId, levelId) {
    const spent = spendResources(session, goldCostForLevel(levelId));
    if (spent.error) {
        return spent;
    }
    const withAbility = {
        ...spent.session,
        heroes: spent.session.heroes.map((row) => row.id === heroId
            ? {
                ...row,
                learned_abilities: [...(row.learned_abilities ?? []), abilityId],
            }
            : row),
    };
    return {
        session: recordAbilityLearned(withAbility, heroId, abilityId),
        error: null,
    };
}
export function applyWeeklyGrowth(session, catalog) {
    return applyWeeklyGrowthWithReport(session, catalog).session;
}
function applyWeeklyGrowthWithReport(session, catalog) {
    // Beacon must roll against pre-growth Curr Recruits, then growth stacks on top.
    const beacon = applyRecruitmentBeaconsBeforeGrowth(session, catalog);
    const grown = {
        ...beacon.session,
        building_states: beacon.session.building_states.map((row) => {
            if (row.level < 1 || row.building_id == null || !isArmySlot(row.slot_num)) {
                return row;
            }
            const growth = buildingGrowth(buildingById(catalog, row.building_id)) +
                (row.growth_bonus ?? 0);
            if (growth <= 0) {
                return row;
            }
            return { ...row, recruit_qty: row.recruit_qty + growth };
        }),
    };
    const income = applyWeeklyBuildingIncomeWithReport(grown, catalog);
    const uniques = applyWeeklyTownUniquesWithReport(income.session, catalog);
    const withRecruits = rollAllWorldRecruits(uniques.session, catalog);
    const withQuests = rollAllNoticeBoardQuests(withRecruits, catalog);
    const uniqueEvents = [];
    for (const event of [...beacon.events, ...uniques.events]) {
        if (event.kind === 'construct') {
            uniqueEvents.push({
                kind: 'construct',
                playerId: event.playerId,
                uniqueName: event.uniqueName,
                verb: event.verb,
                buildingName: event.buildingName,
            });
        }
        else if (event.kind === 'growth') {
            uniqueEvents.push({
                kind: 'growth',
                playerId: event.playerId,
                uniqueName: event.uniqueName,
                buildingName: event.buildingName,
                amount: event.amount,
            });
        }
        else {
            uniqueEvents.push({
                kind: 'unique',
                playerId: event.playerId,
                townName: event.townName,
                uniqueName: event.uniqueName,
                resourceId: event.resourceId,
                amount: event.amount,
            });
        }
    }
    return {
        session: withQuests,
        events: [...income.events, ...uniqueEvents],
    };
}
function addGrant(grants, playerId, resourceId, amount) {
    if (amount <= 0) {
        return;
    }
    const current = grants.get(playerId) ?? {};
    current[resourceId] = (current[resourceId] ?? 0) + amount;
    grants.set(playerId, current);
}
/**
 * Fixed weekly `payload.produces` from a player's owned towns (Halls, Resource
 * Generators, etc.). Excludes Town Unique random effects — those are applied
 * separately and must not appear in the ResourceBar weekly total.
 */
export function weeklyBuildingProducesForPlayer(session, catalog, playerId) {
    const totals = {};
    if (!catalog) {
        return totals;
    }
    for (const town of session.towns) {
        if (town.player_id !== playerId) {
            continue;
        }
        for (const row of session.building_states) {
            if (row.town_id !== town.id || row.level < 1 || row.building_id == null) {
                continue;
            }
            const building = buildingById(catalog, row.building_id);
            for (const grant of buildingProduces(building)) {
                totals[grant.resourceId] = (totals[grant.resourceId] ?? 0) + grant.qty;
            }
        }
    }
    return totals;
}
/** Building produces + owned mine `weekly_node` — display/tick shared total. */
export function playerWeeklyIncome(session, catalog, playerId) {
    const totals = weeklyBuildingProducesForPlayer(session, catalog, playerId);
    for (const node of session.nodes) {
        if (node.kind !== 'mine' || node.player_id !== playerId) {
            continue;
        }
        const weekly = resourceWeeklyNode(catalog, node.resource_id);
        if (weekly <= 0) {
            continue;
        }
        totals[node.resource_id] = (totals[node.resource_id] ?? 0) + weekly;
    }
    return totals;
}
function applyWeeklyBuildingIncomeWithReport(session, catalog) {
    const grants = new Map();
    const events = [];
    for (const town of session.towns) {
        if (!town.player_id) {
            continue;
        }
        for (const row of session.building_states) {
            if (row.town_id !== town.id || row.level < 1 || row.building_id == null) {
                continue;
            }
            const building = buildingById(catalog, row.building_id);
            if (!building) {
                continue;
            }
            for (const grant of buildingProduces(building)) {
                addGrant(grants, town.player_id, grant.resourceId, grant.qty);
                events.push({
                    kind: 'building',
                    playerId: town.player_id,
                    townName: town.name,
                    buildingName: building.name,
                    resourceId: grant.resourceId,
                    amount: grant.qty,
                });
            }
        }
    }
    if (grants.size === 0) {
        return { session, events };
    }
    return {
        session: {
            ...session,
            players: session.players.map((player) => {
                const add = grants.get(player.id);
                if (!add) {
                    return player;
                }
                const resources = { ...player.resources };
                for (const [key, amount] of Object.entries(add)) {
                    const id = Number(key);
                    resources[id] = (resources[id] ?? 0) + amount;
                }
                return { ...player, resources };
            }),
        },
        events,
    };
}
function nextStackId(session) {
    let n = session.units.length + 1;
    while (session.units.some((unit) => unit.id === `unit-${n}`)) {
        n += 1;
    }
    return `unit-${n}`;
}
export function nextUnitStackId(session) {
    return nextStackId(session);
}
export function addHeroStackQty(session, stackId, qty) {
    if (qty <= 0) {
        return session;
    }
    return {
        ...session,
        units: session.units.map((row) => row.id === stackId ? { ...row, qty: row.qty + qty } : row),
    };
}
export function insertHeroArmyStack(session, heroId, slot, stack) {
    const hero = session.heroes.find((row) => row.id === heroId);
    if (!hero || stack.qty <= 0 || slot < 0 || slot >= ARMY_STACK_SLOTS) {
        return session;
    }
    const slots = [...hero.army.slots_1_to_6];
    while (slots.length < ARMY_STACK_SLOTS) {
        slots.push(null);
    }
    const existingId = slots[slot];
    const existing = existingId
        ? session.units.find((row) => row.id === existingId)
        : null;
    if (existing && existing.unit_id === stack.unitId) {
        return addHeroStackQty(session, existing.id, stack.qty);
    }
    if (existingId) {
        return session;
    }
    slots[slot] = stack.id;
    const row = {
        id: stack.id,
        unit_id: stack.unitId,
        qty: stack.qty,
        town_id: null,
        hero_id: heroId,
        mob_id: null,
    };
    return {
        ...session,
        units: [...session.units, row],
        heroes: session.heroes.map((entry) => entry.id === heroId
            ? { ...entry, army: { ...entry.army, slots_1_to_6: slots } }
            : entry),
    };
}
function matchingSlotId(session, slots, unitId) {
    for (const id of slots) {
        if (!id) {
            continue;
        }
        const row = session.units.find((unit) => unit.id === id);
        if (row && row.unit_id === unitId && row.qty > 0) {
            return row.id;
        }
    }
    return null;
}
function firstEmptySlot(slots) {
    const padded = padStackSlots(slots);
    const index = padded.findIndex((id) => id == null);
    return index >= 0 ? index : null;
}
function insertGarrisonStack(session, townId, slot, stack) {
    const town = session.towns.find((row) => row.id === townId);
    if (!town || stack.qty <= 0 || slot < 0 || slot >= ARMY_STACK_SLOTS) {
        return session;
    }
    const slots = padStackSlots(town.garrison.slots_1_to_6);
    const existingId = slots[slot];
    const existing = existingId
        ? session.units.find((row) => row.id === existingId)
        : null;
    if (existing && existing.unit_id === stack.unitId) {
        return addHeroStackQty(session, existing.id, stack.qty);
    }
    if (existingId) {
        return session;
    }
    slots[slot] = stack.id;
    const row = {
        id: stack.id,
        unit_id: stack.unitId,
        qty: stack.qty,
        town_id: townId,
        hero_id: null,
        mob_id: null,
    };
    return {
        ...session,
        units: [...session.units, row],
        towns: session.towns.map((entry) => entry.id === townId
            ? { ...entry, garrison: { ...entry.garrison, slots_1_to_6: slots } }
            : entry),
    };
}
/** Same-type merge, then open hero slots, then owned-town garrison if present. */
export function canFullyAbsorbParts(session, heroId, parts, townId) {
    const hero = session.heroes.find((row) => row.id === heroId);
    if (!hero) {
        return false;
    }
    const heroTypes = new Set();
    let openHero = 0;
    for (const id of padStackSlots(hero.army.slots_1_to_6)) {
        if (!id) {
            openHero += 1;
            continue;
        }
        const row = session.units.find((unit) => unit.id === id);
        if (row && row.qty > 0) {
            heroTypes.add(row.unit_id);
        }
        else {
            openHero += 1;
        }
    }
    const town = townId
        ? session.towns.find((row) => row.id === townId)
        : undefined;
    const garrisonTypes = new Set();
    let openGarrison = 0;
    if (town) {
        for (const id of padStackSlots(town.garrison.slots_1_to_6)) {
            if (!id) {
                openGarrison += 1;
                continue;
            }
            const row = session.units.find((unit) => unit.id === id);
            if (row && row.qty > 0) {
                garrisonTypes.add(row.unit_id);
            }
            else {
                openGarrison += 1;
            }
        }
    }
    for (const part of parts) {
        if (part.qty <= 0) {
            continue;
        }
        if (heroTypes.has(part.unitId)) {
            continue;
        }
        if (openHero > 0) {
            openHero -= 1;
            heroTypes.add(part.unitId);
            continue;
        }
        if (garrisonTypes.has(part.unitId)) {
            continue;
        }
        if (openGarrison > 0) {
            openGarrison -= 1;
            garrisonTypes.add(part.unitId);
            continue;
        }
        return false;
    }
    return true;
}
export function absorbPartsIntoHeroOrGarrison(session, heroId, parts, townId) {
    let next = session;
    for (const part of parts) {
        if (part.qty <= 0) {
            continue;
        }
        const hero = next.heroes.find((row) => row.id === heroId);
        if (!hero) {
            return next;
        }
        const heroMatch = matchingSlotId(next, hero.army.slots_1_to_6, part.unitId);
        if (heroMatch) {
            next = addHeroStackQty(next, heroMatch, part.qty);
            continue;
        }
        const heroSlot = firstEmptySlot(hero.army.slots_1_to_6);
        if (heroSlot != null) {
            next = insertHeroArmyStack(next, heroId, heroSlot, {
                id: nextUnitStackId(next),
                unitId: part.unitId,
                qty: part.qty,
            });
            continue;
        }
        const town = townId
            ? next.towns.find((row) => row.id === townId)
            : undefined;
        if (!town) {
            return next;
        }
        const garrisonMatch = matchingSlotId(next, town.garrison.slots_1_to_6, part.unitId);
        if (garrisonMatch) {
            next = addHeroStackQty(next, garrisonMatch, part.qty);
            continue;
        }
        const garrisonSlot = firstEmptySlot(town.garrison.slots_1_to_6);
        if (garrisonSlot != null) {
            next = insertGarrisonStack(next, town.id, garrisonSlot, {
                id: nextUnitStackId(next),
                unitId: part.unitId,
                qty: part.qty,
            });
        }
    }
    return next;
}
const STARTING_T1_MIN = 6;
const STARTING_T1_MAX = 10;
const STARTING_T2_MIN = 2;
const STARTING_T2_MAX = 5;
const STARTING_T2_CHANCE = 0.8;
function randomInclusive(min, max) {
    return min + Math.floor(Math.random() * (max - min + 1));
}
export function heroArmyStackCount(session, heroId) {
    const hero = session.heroes.find((row) => row.id === heroId);
    if (!hero) {
        return 0;
    }
    let count = 0;
    for (const id of padStackSlots(hero.army.slots_1_to_6)) {
        if (!id) {
            continue;
        }
        const stack = session.units.find((row) => row.id === id);
        if (stack && stack.qty > 0) {
            count += 1;
        }
    }
    return count;
}
/** Hire / spawn: class-branch Tier 1 (6–10) and 80% Tier 2 (2–5). No-op if army exists. */
export function grantHeroStartingArmy(session, heroId) {
    const hero = session.heroes.find((row) => row.id === heroId);
    const catalog = getCachedCatalog();
    if (!hero || !catalog || hero.class_id == null) {
        return session;
    }
    if (heroArmyStackCount(session, heroId) > 0) {
        return session;
    }
    const tier1 = classBranchBaseUnit(catalog, hero.class_id, 1);
    const tier2 = classBranchBaseUnit(catalog, hero.class_id, 2);
    let next = session;
    if (tier1) {
        next = insertHeroArmyStack(next, heroId, 0, {
            id: nextStackId(next),
            unitId: tier1.id,
            qty: randomInclusive(STARTING_T1_MIN, STARTING_T1_MAX),
        });
    }
    if (tier2 && Math.random() < STARTING_T2_CHANCE) {
        next = insertHeroArmyStack(next, heroId, 1, {
            id: nextStackId(next),
            unitId: tier2.id,
            qty: randomInclusive(STARTING_T2_MIN, STARTING_T2_MAX),
        });
    }
    return next;
}
function sameArmyRow(from, to) {
    return from.row === to.row && (from.heroId ?? null) === (to.heroId ?? null);
}
export function heroStandsInTown(session, townId, heroId) {
    if (!heroId) {
        return false;
    }
    const town = session.towns.find((row) => row.id === townId);
    const hero = session.heroes.find((row) => row.id === heroId);
    if (!town || !hero || hero.flight) {
        return false;
    }
    return (hero.position.q === town.position.q && hero.position.r === town.position.r);
}
export function armyCrossTransferError(session, townId, from, to, primaryHeroId) {
    if (sameArmyRow(from, to)) {
        return null;
    }
    const involvesGarrison = from.row === 'garrison' || to.row === 'garrison';
    if (!involvesGarrison) {
        // Hero ↔ hero (e.g. friendly trade): no town presence required.
        return null;
    }
    if (!primaryHeroId || !heroStandsInTown(session, townId, primaryHeroId)) {
        return 'Hero is not in this town';
    }
    const heroIds = new Set();
    if (from.heroId) {
        heroIds.add(from.heroId);
    }
    if (to.heroId) {
        heroIds.add(to.heroId);
    }
    for (const id of heroIds) {
        if (!heroStandsInTown(session, townId, id)) {
            return 'Hero is not in this town';
        }
    }
    return null;
}
function isStackSlot(slot) {
    return Number.isInteger(slot) && slot >= 1 && slot <= ARMY_STACK_SLOTS;
}
function padStackSlots(slots) {
    const next = slots.slice(0, ARMY_STACK_SLOTS);
    while (next.length < ARMY_STACK_SLOTS) {
        next.push(null);
    }
    return next;
}
function rowStackSlots(session, townId, row, heroId) {
    if (row === 'garrison') {
        const town = session.towns.find((item) => item.id === townId);
        if (!town) {
            return { slots: [], heroId: null, error: 'This town is not in the game session.' };
        }
        return {
            slots: padStackSlots(town.garrison.slots_1_to_6),
            heroId: null,
            error: null,
        };
    }
    const town = session.towns.find((item) => item.id === townId);
    const resolved = heroId ?? (town ? visitingHeroId(session, town) : null);
    const hero = resolved
        ? session.heroes.find((item) => item.id === resolved)
        : null;
    if (!hero) {
        return { slots: [], heroId: null, error: 'No hero is in this town.' };
    }
    return {
        slots: padStackSlots(hero.army.slots_1_to_6),
        heroId: hero.id,
        error: null,
    };
}
function writeRowSlots(session, townId, row, slots, units, heroId) {
    if (row === 'garrison') {
        return {
            ...session,
            units,
            towns: session.towns.map((town) => town.id === townId
                ? { ...town, garrison: { ...town.garrison, slots_1_to_6: slots } }
                : town),
        };
    }
    const town = session.towns.find((item) => item.id === townId);
    const resolved = heroId ?? (town ? visitingHeroId(session, town) : null);
    return {
        ...session,
        units,
        heroes: session.heroes.map((hero) => hero.id === resolved
            ? { ...hero, army: { ...hero.army, slots_1_to_6: slots } }
            : hero),
    };
}
function ownStack(stack, townId, row, heroId) {
    return row === 'garrison'
        ? { ...stack, town_id: townId, hero_id: null }
        : { ...stack, town_id: null, hero_id: heroId };
}
function ownSlots(units, slots, townId, row, heroId) {
    const ids = new Set(slots.filter((id) => id != null));
    return units.map((stack) => ids.has(stack.id) ? ownStack(stack, townId, row, heroId) : stack);
}
/**
 * Rewrite hero armies (and optional garrison) from a shared pool to a computed
 * end-state. Does not simulate pickup/swap/split clicks.
 */
export function applyPooledArmyAllocation(session, poolHeroIds, poolTownId, heroTargets, garrisonParts = [], preserveStackIds = []) {
    const town = poolTownId
        ? session.towns.find((row) => row.id === poolTownId)
        : undefined;
    const poolSlotIds = [];
    for (const id of poolHeroIds) {
        const hero = session.heroes.find((row) => row.id === id);
        if (hero) {
            poolSlotIds.push(...padStackSlots(hero.army.slots_1_to_6));
        }
    }
    if (town) {
        poolSlotIds.push(...padStackSlots(town.garrison.slots_1_to_6));
    }
    const poolIds = new Set(poolSlotIds.filter((id) => id != null));
    const preserve = new Set(preserveStackIds.filter((id) => poolIds.has(id)));
    const used = new Set();
    let units = [...session.units];
    const dummyTownId = poolTownId ?? '';
    const allocOne = (unitId, qty, row, ownerHeroId) => {
        if (qty <= 0) {
            return null;
        }
        const reusable = units.find((stack) => poolIds.has(stack.id) &&
            !used.has(stack.id) &&
            !preserve.has(stack.id) &&
            stack.unit_id === unitId);
        if (reusable) {
            used.add(reusable.id);
            units = units.map((stack) => stack.id === reusable.id
                ? ownStack({ ...stack, qty }, dummyTownId, row, ownerHeroId)
                : stack);
            return reusable.id;
        }
        const id = nextStackId({ ...session, units });
        used.add(id);
        units = [
            ...units,
            ownStack({
                id,
                unit_id: unitId,
                qty,
                town_id: null,
                hero_id: null,
                mob_id: null,
            }, dummyTownId, row, ownerHeroId),
        ];
        return id;
    };
    const heroSlotMap = new Map();
    for (const target of heroTargets) {
        heroSlotMap.set(target.heroId, padStackSlots(target.parts.slice(0, ARMY_STACK_SLOTS).map((part) => allocOne(part.unitId, part.qty, 'hero', target.heroId))));
    }
    const garrisonSlots = town
        ? padStackSlots(garrisonParts.slice(0, ARMY_STACK_SLOTS).map((part) => allocOne(part.unitId, part.qty, 'garrison', null)))
        : [];
    const placed = new Set([...heroSlotMap.values(), garrisonSlots]
        .flat()
        .filter((id) => id != null));
    units = units
        .filter((stack) => !poolIds.has(stack.id) || placed.has(stack.id) || preserve.has(stack.id))
        .map((stack) => preserve.has(stack.id) && !placed.has(stack.id)
        ? town
            ? { ...stack, town_id: town.id, hero_id: null }
            : stack
        : stack);
    let next = { ...session, units };
    for (const [heroId, slots] of heroSlotMap) {
        next = writeRowSlots(next, dummyTownId, 'hero', slots, next.units, heroId);
    }
    if (town) {
        next = writeRowSlots(next, town.id, 'garrison', garrisonSlots, next.units);
    }
    return next;
}
export function applyArmyAllocation(session, townId, heroId, heroParts, garrisonParts, preserveStackIds = []) {
    return applyPooledArmyAllocation(session, [heroId], townId, [{ heroId, parts: heroParts }], garrisonParts, preserveStackIds);
}
function commitRows(session, townId, from, fromSlots, fromHeroId, to, toSlots, toHeroId, units) {
    const sameRow = sameArmyRow(from, to);
    let nextUnits = ownSlots(units, fromSlots, townId, from.row, fromHeroId);
    if (!sameRow) {
        nextUnits = ownSlots(nextUnits, toSlots, townId, to.row, toHeroId);
    }
    let next = writeRowSlots(session, townId, from.row, fromSlots, nextUnits, from.heroId ?? fromHeroId);
    if (!sameRow) {
        next = writeRowSlots(next, townId, to.row, toSlots, next.units, to.heroId ?? toHeroId);
    }
    return next;
}
const HERO_MIN_ARMY_ERROR = 'A hero must keep at least one unit stack.';
function stripsLastHeroStack(before, after) {
    for (const hero of before.heroes) {
        if (heroArmyStackCount(before, hero.id) > 0 &&
            heroArmyStackCount(after, hero.id) === 0) {
            return true;
        }
    }
    return false;
}
function commitArmyMove(session, townId, from, fromSlots, fromHeroId, to, toSlots, toHeroId, units) {
    const next = commitRows(session, townId, from, fromSlots, fromHeroId, to, toSlots, toHeroId, units);
    if (stripsLastHeroStack(session, next)) {
        return { session, error: HERO_MIN_ARMY_ERROR };
    }
    return { session: next, error: null };
}
function guardHeroMin(before, after) {
    if (stripsLastHeroStack(before, after)) {
        return { session: before, error: HERO_MIN_ARMY_ERROR };
    }
    return { session: after, error: null };
}
export function placeArmyStack(session, townId, from, to, primaryHeroId) {
    if (!isStackSlot(from.slot) || !isStackSlot(to.slot)) {
        return { session, error: "Can't drop on that slot." };
    }
    const crossError = armyCrossTransferError(session, townId, from, to, primaryHeroId ?? null);
    if (crossError) {
        return { session, error: crossError };
    }
    const sameRow = sameArmyRow(from, to);
    if (sameRow && from.slot === to.slot) {
        return { session, error: null };
    }
    const sourceRow = rowStackSlots(session, townId, from.row, from.heroId);
    if (sourceRow.error) {
        return { session, error: sourceRow.error };
    }
    const destRow = sameRow
        ? sourceRow
        : rowStackSlots(session, townId, to.row, to.heroId);
    if (destRow.error) {
        return { session, error: destRow.error };
    }
    const fromSlots = sourceRow.slots;
    const toSlots = sameRow ? fromSlots : destRow.slots;
    const fromIndex = from.slot - 1;
    const toIndex = to.slot - 1;
    const sourceId = fromSlots[fromIndex];
    if (!sourceId) {
        return { session, error: 'That slot is empty.' };
    }
    const source = session.units.find((row) => row.id === sourceId);
    if (!source) {
        return { session, error: 'That slot is empty.' };
    }
    const destId = toSlots[toIndex];
    if (!destId) {
        fromSlots[fromIndex] = null;
        toSlots[toIndex] = sourceId;
        return commitArmyMove(session, townId, from, fromSlots, sourceRow.heroId, to, toSlots, destRow.heroId, session.units);
    }
    const dest = session.units.find((row) => row.id === destId);
    if (!dest) {
        fromSlots[fromIndex] = null;
        toSlots[toIndex] = sourceId;
        return commitArmyMove(session, townId, from, fromSlots, sourceRow.heroId, to, toSlots, destRow.heroId, session.units);
    }
    if (dest.unit_id === source.unit_id) {
        const units = session.units
            .map((row) => row.id === destId ? { ...row, qty: row.qty + source.qty } : row)
            .filter((row) => row.id !== sourceId);
        fromSlots[fromIndex] = null;
        return commitArmyMove(session, townId, from, fromSlots, sourceRow.heroId, to, toSlots, destRow.heroId, units);
    }
    fromSlots[fromIndex] = destId;
    toSlots[toIndex] = sourceId;
    return commitArmyMove(session, townId, from, fromSlots, sourceRow.heroId, to, toSlots, destRow.heroId, session.units);
}
export function splitArmyStack(session, townId, from, qty) {
    if (!isStackSlot(from.slot)) {
        return { session, heldStackId: null, error: "Can't split that slot." };
    }
    if (!Number.isInteger(qty) || qty < 1) {
        return {
            session,
            heldStackId: null,
            error: 'Enter a whole number less than the stack.',
        };
    }
    const sourceRow = rowStackSlots(session, townId, from.row, from.heroId);
    if (sourceRow.error) {
        return { session, heldStackId: null, error: sourceRow.error };
    }
    const stackId = sourceRow.slots[from.slot - 1];
    const stack = stackId
        ? session.units.find((row) => row.id === stackId)
        : null;
    if (!stack) {
        return { session, heldStackId: null, error: 'That slot is empty.' };
    }
    if (qty >= stack.qty) {
        return {
            session,
            heldStackId: null,
            error: 'Split a smaller amount than the stack. Drag the whole stack to move it all.',
        };
    }
    const held = {
        id: nextStackId(session),
        unit_id: stack.unit_id,
        qty,
        town_id: stack.town_id,
        hero_id: stack.hero_id,
        mob_id: null,
    };
    return {
        session: {
            ...session,
            units: session.units
                .map((row) => row.id === stack.id ? { ...row, qty: row.qty - qty } : row)
                .concat(held),
        },
        heldStackId: held.id,
        error: null,
    };
}
/** Split `from` stack evenly across empty slots in the target army row. */
export function splitArmyStackEvenly(session, townId, from, target, primaryHeroId) {
    const crossError = armyCrossTransferError(session, townId, from, target, primaryHeroId ?? null);
    if (crossError) {
        return { session, error: crossError };
    }
    const sourceRow = rowStackSlots(session, townId, from.row, from.heroId);
    if (sourceRow.error) {
        return { session, error: sourceRow.error };
    }
    const stackId = sourceRow.slots[from.slot - 1];
    const stack = stackId
        ? session.units.find((row) => row.id === stackId)
        : null;
    if (!stack) {
        return { session, error: 'That slot is empty.' };
    }
    const destRow = rowStackSlots(session, townId, target.row, target.heroId);
    if (destRow.error) {
        return { session, error: destRow.error };
    }
    const emptySlots = [];
    for (let i = 0; i < destRow.slots.length; i += 1) {
        if (!destRow.slots[i]) {
            emptySlots.push(i + 1);
        }
    }
    if (emptySlots.length === 0) {
        return { session, error: 'No open slots in that army.' };
    }
    const base = Math.floor(stack.qty / emptySlots.length);
    const remainder = stack.qty % emptySlots.length;
    if (base <= 0 && remainder < emptySlots.length) {
        return {
            session,
            error: 'Not enough units to split across open slots.',
        };
    }
    let next = session;
    let units = next.units.filter((row) => row.id !== stack.id);
    const fromSlots = [...sourceRow.slots];
    fromSlots[from.slot - 1] = null;
    next = writeRowSlots(next, townId, from.row, fromSlots, units, from.heroId ?? sourceRow.heroId);
    const toSlots = [...destRow.slots];
    for (let i = 0; i < emptySlots.length; i += 1) {
        const slot = emptySlots[i];
        const qty = base + (i < remainder ? 1 : 0);
        if (qty <= 0) {
            continue;
        }
        const piece = {
            id: nextStackId({ ...next, units }),
            unit_id: stack.unit_id,
            qty,
            town_id: stack.town_id,
            hero_id: stack.hero_id,
            mob_id: null,
        };
        units = [...units, piece];
        toSlots[slot - 1] = piece.id;
        next = { ...next, units };
    }
    next = writeRowSlots(next, townId, target.row, toSlots, units, target.heroId ?? destRow.heroId);
    return guardHeroMin(session, next);
}
function townProducesUnit(session, catalog, townId, unitId) {
    return session.building_states.some((row) => {
        if (row.town_id !== townId || row.level < 1) {
            return false;
        }
        return unitForBuilding(catalog, row.building_id)?.id === unitId;
    });
}
export function stackUpgradeOffer(session, catalog, townId, stack) {
    const unit = unitById(catalog, stack.unit_id);
    const advanced = advancedUnitFor(catalog, unit);
    if (!unit || !advanced) {
        return null;
    }
    const perUnit = townUnitUpgradeCost(session, catalog, townId, unitUpgradeCost(unit));
    if (Object.keys(perUnit).length === 0) {
        return null;
    }
    if (!townProducesUnit(session, catalog, townId, advanced.id)) {
        return null;
    }
    return {
        advanced,
        perUnit,
        total: scaleCost(perUnit, stack.qty),
    };
}
export function upgradeArmyStack(session, townId, from, catalog) {
    const sourceRow = rowStackSlots(session, townId, from.row, from.heroId);
    if (sourceRow.error) {
        return { session, error: sourceRow.error };
    }
    const stackId = sourceRow.slots[from.slot - 1];
    const stack = stackId
        ? session.units.find((row) => row.id === stackId)
        : null;
    if (!stack) {
        return { session, error: 'That slot is empty.' };
    }
    const offer = stackUpgradeOffer(session, catalog, townId, stack);
    if (!offer) {
        return {
            session,
            error: 'This stack cannot be upgraded in this town.',
        };
    }
    const spent = spendResources(session, offer.total);
    if (spent.error) {
        return { session, error: spent.error };
    }
    return {
        session: {
            ...spent.session,
            units: spent.session.units.map((row) => row.id === stack.id ? { ...row, unit_id: offer.advanced.id } : row),
        },
        error: null,
    };
}
export function dropHeldArmyStack(session, townId, heldStackId, origin, to, primaryHeroId) {
    if (!isStackSlot(to.slot)) {
        return { session, error: "Can't drop on that slot." };
    }
    const crossError = armyCrossTransferError(session, townId, origin, to, primaryHeroId ?? null);
    if (crossError) {
        return { session, error: crossError };
    }
    const held = session.units.find((row) => row.id === heldStackId);
    if (!held) {
        return { session, error: 'There is nothing to drop.' };
    }
    const destRow = rowStackSlots(session, townId, to.row, to.heroId);
    if (destRow.error) {
        return { session, error: destRow.error };
    }
    const toSlots = destRow.slots;
    const destId = toSlots[to.slot - 1];
    if (!destId) {
        toSlots[to.slot - 1] = heldStackId;
        const units = ownSlots(session.units, toSlots, townId, to.row, destRow.heroId);
        return guardHeroMin(session, writeRowSlots(session, townId, to.row, toSlots, units, to.heroId ?? destRow.heroId));
    }
    const dest = session.units.find((row) => row.id === destId);
    if (!dest) {
        toSlots[to.slot - 1] = heldStackId;
        const units = ownSlots(session.units, toSlots, townId, to.row, destRow.heroId);
        return guardHeroMin(session, writeRowSlots(session, townId, to.row, toSlots, units, to.heroId ?? destRow.heroId));
    }
    if (dest.unit_id !== held.unit_id) {
        return { session, error: "Can't drop a split stack on a different unit." };
    }
    const units = session.units
        .map((row) => row.id === destId ? { ...row, qty: row.qty + held.qty } : row)
        .filter((row) => row.id !== heldStackId);
    void origin;
    return guardHeroMin(session, writeRowSlots(session, townId, to.row, toSlots, units, to.heroId ?? destRow.heroId));
}
export function returnHeldArmyStack(session, townId, heldStackId, origin) {
    const held = session.units.find((row) => row.id === heldStackId);
    if (!held) {
        return session;
    }
    const sourceRow = rowStackSlots(session, townId, origin.row, origin.heroId);
    if (sourceRow.error) {
        return session;
    }
    const originId = sourceRow.slots[origin.slot - 1];
    const originStack = originId
        ? session.units.find((row) => row.id === originId)
        : null;
    if (originStack && originStack.unit_id === held.unit_id) {
        return {
            ...session,
            units: session.units
                .map((row) => row.id === originStack.id ? { ...row, qty: row.qty + held.qty } : row)
                .filter((row) => row.id !== heldStackId),
        };
    }
    if (!originId) {
        const slots = sourceRow.slots;
        slots[origin.slot - 1] = heldStackId;
        const units = ownSlots(session.units, slots, townId, origin.row, sourceRow.heroId);
        return writeRowSlots(session, townId, origin.row, slots, units, origin.heroId ?? sourceRow.heroId);
    }
    return session;
}
export function recruitToGarrison(session, townId, slotNum, qty, catalog) {
    if (!Number.isInteger(qty) || qty < 1) {
        return { session, error: 'Enter a whole number of units to recruit.' };
    }
    const town = session.towns.find((row) => row.id === townId);
    if (!town) {
        return { session, error: 'This town is not in the game session.' };
    }
    const buildingState = session.building_states.find((row) => row.town_id === townId && row.slot_num === slotNum);
    if (!buildingState || buildingState.level < 1 || buildingState.building_id == null) {
        return { session, error: 'There is no army building in this slot.' };
    }
    if (qty > buildingState.recruit_qty) {
        return { session, error: `Only ${buildingState.recruit_qty} available to recruit.` };
    }
    const unit = unitForBuilding(catalog, buildingState.building_id);
    if (!unit) {
        return { session, error: 'This building has no recruitable unit.' };
    }
    const cost = townRecruitCost(session, catalog, townId, unitCost(unit), qty);
    const slots = [...town.garrison.slots_1_to_6];
    while (slots.length < ARMY_STACK_SLOTS) {
        slots.push(null);
    }
    const matchIndex = slots.findIndex((stackId) => {
        if (!stackId) {
            return false;
        }
        const stack = session.units.find((row) => row.id === stackId);
        return stack != null && stack.unit_id === unit.id && stack.town_id === townId;
    });
    const emptyIndex = slots.findIndex((stackId) => stackId == null);
    if (matchIndex < 0 && emptyIndex < 0) {
        return { session, error: "Can't recruit, Garrison is full." };
    }
    const spent = spendResources(session, cost);
    if (spent.error) {
        return { session, error: spent.error };
    }
    let units = spent.session.units;
    if (matchIndex >= 0) {
        const stackId = slots[matchIndex];
        units = units.map((row) => row.id === stackId ? { ...row, qty: row.qty + qty } : row);
    }
    else {
        const stack = {
            id: nextStackId(spent.session),
            unit_id: unit.id,
            qty,
            town_id: townId,
            hero_id: null,
            mob_id: null,
        };
        units = [...units, stack];
        slots[emptyIndex] = stack.id;
    }
    return {
        session: {
            ...spent.session,
            units,
            building_states: spent.session.building_states.map((row) => row.town_id === townId && row.slot_num === slotNum
                ? { ...row, recruit_qty: row.recruit_qty - qty }
                : row),
            towns: spent.session.towns.map((row) => row.id === townId
                ? {
                    ...row,
                    garrison: { ...row.garrison, slots_1_to_6: slots },
                }
                : row),
        },
        error: null,
    };
}
function emptyGarrison() {
    return {
        slots_1_to_6: Array.from({ length: 6 }, () => null),
    };
}
export function claimTown(session, q, r, details) {
    let current = session;
    let town = current.towns.find((t) => t.position.q === q && t.position.r === r);
    if (!town) {
        const id = `town-${current.towns.length + 1}`;
        town = {
            id,
            name: details?.name?.trim() || 'Town',
            town_type_id: details?.townTypeId ?? NECROPOLIS_TOWN_TYPE_ID,
            position: { q, r },
            player_id: null,
            last_build_day: null,
            garrison: emptyGarrison(),
        };
        current = {
            ...current,
            towns: [...current.towns, town],
            building_states: [...current.building_states, ...emptyBuildingStates(id)],
        };
    }
    current = withBuildingSlots(current, town.id);
    const ownerId = actingPlayerId(current, details?.ownerId);
    if (!ownerId || town.player_id === ownerId) {
        return current;
    }
    const previousId = town.player_id;
    const captured = {
        ...current,
        towns: current.towns.map((t) => t.id === town.id ? { ...t, player_id: ownerId } : t),
        players: current.players.map((player) => {
            if (player.id === ownerId && !player.town_ids.includes(town.id)) {
                return { ...player, town_ids: [...player.town_ids, town.id] };
            }
            if (previousId && player.id === previousId) {
                return {
                    ...player,
                    town_ids: player.town_ids.filter((id) => id !== town.id),
                };
            }
            return player;
        }),
    };
    return logTownCapture(captured, town.id, ownerId, previousId);
}
export function claimMine(session, q, r, resourceId, ownerId) {
    const actorId = actingPlayerId(session, ownerId);
    if (!actorId) {
        return session;
    }
    const existing = session.nodes.find((node) => node.kind === 'mine' && node.position.q === q && node.position.r === r);
    const heroId = session.heroes.find((row) => row.player_id === actorId && row.position.q === q && row.position.r === r)?.id ??
        session.heroes.find((row) => row.player_id === actorId)?.id ??
        '';
    if (existing) {
        if (existing.player_id === actorId) {
            return session;
        }
        const recapture = existing.player_id != null;
        const next = {
            ...session,
            nodes: session.nodes.map((node) => node.id === existing.id
                ? { ...node, player_id: actorId, accrued_fraction: 0 }
                : node),
        };
        if (resourceId != null && heroId) {
            return logCapturedMine(next, actorId, heroId, resourceId, q, r, recapture);
        }
        return next;
    }
    if (resourceId == null) {
        return session;
    }
    const node = {
        id: `node-${session.nodes.length + 1}`,
        position: { q, r },
        resource_id: resourceId,
        kind: 'mine',
        player_id: actorId,
        collected: false,
        qty: 0,
        accrued_fraction: 0,
    };
    let next = { ...session, nodes: [...session.nodes, node] };
    if (heroId) {
        next = logCapturedMine(next, actorId, heroId, resourceId, q, r, false);
    }
    return next;
}
export function collectPickup(session, q, r, resourceId, amount, ownerId) {
    const playerId = actingPlayerId(session, ownerId);
    if (!playerId) {
        return session;
    }
    const existing = session.nodes.find((node) => node.kind === 'pickup' && node.position.q === q && node.position.r === r);
    const payout = existing != null && existing.qty > 0
        ? existing.qty
        : Math.max(0, Math.floor(amount));
    const nodes = existing
        ? session.nodes.map((node) => node.id === existing.id ? { ...node, collected: true } : node)
        : [
            ...session.nodes,
            {
                id: `node-${session.nodes.length + 1}`,
                position: { q, r },
                resource_id: resourceId,
                kind: 'pickup',
                player_id: null,
                collected: true,
                qty: payout,
                accrued_fraction: 0,
            },
        ];
    const heroId = session.heroes.find((row) => row.player_id === playerId && row.position.q === q && row.position.r === r)?.id ??
        session.heroes.find((row) => row.player_id === playerId)?.id ??
        '';
    let next = {
        ...session,
        nodes,
        players: session.players.map((p) => p.id === playerId
            ? {
                ...p,
                resources: {
                    ...p.resources,
                    [resourceId]: (p.resources[resourceId] ?? 0) + payout,
                },
            }
            : p),
    };
    if (heroId && payout > 0) {
        next = logPickup(next, playerId, heroId, resourceId, payout);
    }
    return next;
}
export function syncHero(session, position, movementRemaining, heroId) {
    return {
        ...session,
        heroes: session.heroes.map((hero) => {
            if (hero.id !== heroId) {
                return hero;
            }
            // Airborne position is owned by flight advance — don't let stale map
            // ground coords clobber it (e.g. heroRef still at the origin town).
            if (hero.flight) {
                return { ...hero, movement_remaining: 0 };
            }
            const facing = facingFromMove(hero.position, position);
            return {
                ...hero,
                position: { ...position },
                movement_remaining: movementRemaining,
                ...(facing ? { travel_facing: facing } : {}),
            };
        }),
    };
}
export function restorePlayerHeroMovement(session, playerId) {
    return {
        ...session,
        heroes: session.heroes.map((hero) => {
            if (hero.player_id !== playerId) {
                return hero;
            }
            // In-flight heroes get no ground movement that day (advance happens on day tick).
            if (hero.flight) {
                return { ...hero, movement_remaining: 0 };
            }
            return {
                ...hero,
                movement_remaining: heroMovementPoints(getCachedCatalog(), hero, session.game.settings.move_mode),
                ai_route_commit: null,
            };
        }),
    };
}
const HANGER_SLOT = 8;
export function isHeroInFlight(hero) {
    return hero?.flight != null;
}
/** Town has a built Hanger (slot 8). */
export function townHasHanger(session, catalog, townId) {
    if (!catalog) {
        return false;
    }
    return session.building_states.some((row) => {
        if (row.town_id !== townId || row.level < 1 || row.building_id == null) {
            return false;
        }
        if (row.slot_num === HANGER_SLOT) {
            return true;
        }
        const building = buildingById(catalog, row.building_id);
        return building?.slot_num === HANGER_SLOT;
    });
}
/** Another of this player's heroes already flying to this town. */
function flightEnRouteToTown(session, townId, playerId, exceptHeroId) {
    return session.heroes.some((hero) => hero.player_id === playerId &&
        hero.id !== exceptHeroId &&
        hero.flight?.destination_town_id === townId);
}
/** Friendly town hero slot held by a grounded own hero. */
function townOwnHeroSlotOccupied(session, town, playerId) {
    if (town.player_id !== playerId) {
        return false;
    }
    const occupantId = visitingHeroId(session, town);
    if (!occupantId) {
        return false;
    }
    const occupant = session.heroes.find((row) => row.id === occupantId);
    return occupant != null && occupant.player_id === playerId;
}
/** Friendly Hanger towns reachable from an origin hex (world Hanger or town). */
export function flightDestinationsFromOrigin(session, catalog, origin, playerId, flyingHeroId, excludeTownId) {
    if (!catalog) {
        return [];
    }
    const perHex = flightCostPerHex(catalog);
    const out = [];
    for (const town of session.towns) {
        if (excludeTownId && town.id === excludeTownId) {
            continue;
        }
        if (town.player_id !== playerId) {
            continue;
        }
        if (!townHasHanger(session, catalog, town.id)) {
            continue;
        }
        const distance = hexDistance(origin, town.position);
        if (distance <= 0) {
            continue;
        }
        const blocked = townOwnHeroSlotOccupied(session, town, playerId) ||
            flightEnRouteToTown(session, town.id, playerId, flyingHeroId);
        out.push({
            town,
            distance,
            goldCost: distance * perHex,
            blocked,
        });
    }
    return out.sort((a, b) => Number(a.blocked) - Number(b.blocked) ||
        a.distance - b.distance ||
        a.town.name.localeCompare(b.town.name));
}
/** Friendly Hanger towns the visiting hero can fly to (excludes current town). */
export function flightDestinationsFromTown(session, catalog, fromTownId, playerId, flyingHeroId) {
    if (!catalog) {
        return [];
    }
    const from = session.towns.find((town) => town.id === fromTownId);
    if (!from || !townHasHanger(session, catalog, from.id)) {
        return [];
    }
    return flightDestinationsFromOrigin(session, catalog, from.position, playerId, flyingHeroId, from.id);
}
export function findWorldHangerAt(session, q, r) {
    return (session.features ?? []).find((row) => row.kind === 'hanger' &&
        row.position.q === q &&
        row.position.r === r);
}
export function findWorldHangerById(session, featureId) {
    return (session.features ?? []).find((row) => row.kind === 'hanger' && row.id === featureId);
}
/** World Hanger within 1 hex of the hero (departure stance). */
export function findWorldHangerBeside(session, at) {
    return (session.features ?? []).find((row) => row.kind === 'hanger' && hexDistance(at, row.position) <= 1);
}
/**
 * Launch Hanger flight: charge gold and enter in-flight state.
 * Origin is either a friendly town with a Hanger (hero standing on it) or a
 * world Hanger (hero adjacent). Does not advance position — caller animates
 * via {@link requestPlayHeroFlight} (or day tick uses {@link advanceAllFlights}).
 */
export function launchHeroFlight(session, heroId, destinationTownId, originTownId) {
    const catalog = getCachedCatalog();
    if (!catalog) {
        return { session, error: 'Catalog not loaded.' };
    }
    const hero = session.heroes.find((row) => row.id === heroId);
    if (!hero) {
        return { session, error: 'Hero not found.' };
    }
    if (hero.flight) {
        return { session, error: 'Already in flight.' };
    }
    const explicitTown = originTownId
        ? session.towns.find((town) => town.id === originTownId)
        : undefined;
    const standingTown = findTownAt(session, hero.position.q, hero.position.r);
    const worldHanger = findWorldHangerBeside(session, hero.position);
    let originPos = null;
    let excludeOriginTownId = null;
    if (explicitTown) {
        if (explicitTown.player_id !== hero.player_id) {
            return { session, error: 'Hero must be in a friendly town.' };
        }
        if (!standingTown || standingTown.id !== explicitTown.id) {
            return {
                session,
                error: 'Hero must be standing in this town to fly.',
            };
        }
        if (!townHasHanger(session, catalog, explicitTown.id)) {
            return { session, error: 'This town has no Hanger.' };
        }
        originPos = explicitTown.position;
        excludeOriginTownId = explicitTown.id;
    }
    else if (standingTown &&
        standingTown.player_id === hero.player_id &&
        townHasHanger(session, catalog, standingTown.id)) {
        originPos = standingTown.position;
        excludeOriginTownId = standingTown.id;
    }
    else if (worldHanger) {
        originPos = worldHanger.position;
    }
    else {
        return {
            session,
            error: 'Hero must be in a friendly Hanger town or beside a world Hanger.',
        };
    }
    const dest = session.towns.find((town) => town.id === destinationTownId);
    if (!dest) {
        return { session, error: 'Destination town not found.' };
    }
    if (dest.player_id !== hero.player_id) {
        return { session, error: 'Destination must be a friendly town.' };
    }
    if (!townHasHanger(session, catalog, dest.id)) {
        return { session, error: 'Destination has no Hanger.' };
    }
    if (excludeOriginTownId && dest.id === excludeOriginTownId) {
        return { session, error: 'Pick a different town.' };
    }
    if (townOwnHeroSlotOccupied(session, dest, hero.player_id)) {
        return { session, error: 'Destination town hero slot is occupied.' };
    }
    if (flightEnRouteToTown(session, dest.id, hero.player_id, heroId)) {
        return { session, error: 'Another hero is already flying there.' };
    }
    const distance = hexDistance(originPos, dest.position);
    if (!Number.isFinite(distance) || distance <= 0) {
        return { session, error: 'Invalid flight distance.' };
    }
    const goldCost = distance * flightCostPerHex(catalog);
    const spent = spendResources(session, { [GOLD_RESOURCE_ID]: goldCost });
    if (spent.error) {
        return { session, error: spent.error };
    }
    const originTown = excludeOriginTownId != null
        ? spent.session.towns.find((town) => town.id === excludeOriginTownId)
        : undefined;
    const transportSprite = transportSpriteForDeparture(catalog, spent.session, originTown, worldHanger != null && originTown == null);
    return {
        session: {
            ...spent.session,
            heroes: spent.session.heroes.map((row) => row.id === heroId
                ? {
                    ...row,
                    flight: {
                        destination_town_id: dest.id,
                        transport_sprite: transportSprite,
                    },
                    movement_remaining: 0,
                }
                : row),
        },
        error: null,
    };
}
/** Update an airborne hero's map hex during flight animation. */
export function syncHeroFlightPosition(session, position, heroId) {
    return {
        ...session,
        heroes: session.heroes.map((hero) => {
            if (hero.id !== heroId || !hero.flight) {
                return hero;
            }
            const facing = facingFromMove(hero.position, position);
            return {
                ...hero,
                position: { ...position },
                movement_remaining: 0,
                ...(facing ? { travel_facing: facing } : {}),
            };
        }),
    };
}
/**
 * After a flight segment animation (or instant day tick move), land if the
 * hero is on the destination hex and the town hero slot is free; otherwise
 * stay airborne (or enter circling around a friendly occupied town).
 */
export function finalizeHeroFlightSegment(session, heroId) {
    const hero = session.heroes.find((row) => row.id === heroId);
    if (!hero?.flight) {
        return { session, siegeTownId: null, arrivedTownId: null };
    }
    const dest = session.towns.find((town) => town.id === hero.flight.destination_town_id);
    if (!dest) {
        return {
            session: {
                ...session,
                heroes: session.heroes.map((row) => row.id === heroId ? { ...row, flight: null, movement_remaining: 0 } : row),
            },
            siegeTownId: null,
            arrivedTownId: null,
        };
    }
    const tryLandFriendly = () => {
        if (dest.player_id !== hero.player_id) {
            return null;
        }
        const occupantId = visitingHeroId(session, dest);
        if (occupantId && occupantId !== heroId) {
            // Slot occupied — orbit the 2×1 footprint; no progress toward landing.
            const alreadyCircling = hero.flight?.circling === true;
            const onRing = alreadyCircling
                ? { ...hero.position }
                : nextTownCircleHex(dest.position, hero.position, dest.flipped);
            return {
                session: {
                    ...session,
                    heroes: session.heroes.map((row) => row.id === heroId
                        ? {
                            ...row,
                            position: onRing,
                            movement_remaining: 0,
                            flight: {
                                destination_town_id: dest.id,
                                transport_sprite: hero.flight.transport_sprite,
                                circling: true,
                            },
                        }
                        : row),
                },
                siegeTownId: null,
                arrivedTownId: null,
            };
        }
        const landed = {
            ...hero,
            position: { ...dest.position },
            flight: null,
            movement_remaining: 0,
        };
        return {
            session: {
                ...session,
                heroes: session.heroes.map((row) => (row.id === heroId ? landed : row)),
            },
            siegeTownId: null,
            arrivedTownId: dest.id,
        };
    };
    // Already circling: try land every segment; stay on ring if still blocked.
    if (hero.flight.circling) {
        const friendly = tryLandFriendly();
        if (friendly) {
            return friendly;
        }
        // Town flipped hostile while waiting — force siege landing.
        const landed = {
            ...hero,
            position: { ...dest.position },
            flight: null,
            movement_remaining: 0,
        };
        return {
            session: {
                ...session,
                heroes: session.heroes.map((row) => (row.id === heroId ? landed : row)),
            },
            siegeTownId: dest.id,
            arrivedTownId: null,
        };
    }
    const arrived = hexDistance(hero.position, dest.position) <= 0;
    if (!arrived) {
        return {
            session: {
                ...session,
                heroes: session.heroes.map((row) => row.id === heroId ? { ...row, movement_remaining: 0 } : row),
            },
            siegeTownId: null,
            arrivedTownId: null,
        };
    }
    const friendly = tryLandFriendly();
    if (friendly) {
        return friendly;
    }
    // Enemy / captured mid-flight — land into siege.
    const landed = {
        ...hero,
        position: { ...dest.position },
        flight: null,
        movement_remaining: 0,
    };
    return {
        session: {
            ...session,
            heroes: session.heroes.map((row) => (row.id === heroId ? landed : row)),
        },
        siegeTownId: dest.id,
        arrivedTownId: null,
    };
}
function advanceHeroFlightOnce(session, heroId) {
    const catalog = getCachedCatalog();
    const hero = session.heroes.find((row) => row.id === heroId);
    if (!hero?.flight || !catalog) {
        return { session, error: null, siegeTownId: null };
    }
    const dest = session.towns.find((town) => town.id === hero.flight.destination_town_id);
    if (!dest) {
        return {
            session: {
                ...session,
                heroes: session.heroes.map((row) => row.id === heroId ? { ...row, flight: null, movement_remaining: 0 } : row),
            },
            error: null,
            siegeTownId: null,
        };
    }
    // Circling: one full orbit around the town (no flight_speed toward dest).
    if (hero.flight.circling) {
        const lap = townCircleLapSteps(dest.position, hero.position, dest.flipped);
        const end = lap[lap.length - 1] ?? nextTownCircleHex(dest.position, hero.position, dest.flipped);
        const moved = {
            ...session,
            heroes: session.heroes.map((row) => row.id === heroId
                ? {
                    ...row,
                    position: end,
                    movement_remaining: 0,
                    flight: {
                        destination_town_id: dest.id,
                        transport_sprite: hero.flight.transport_sprite,
                        circling: true,
                    },
                }
                : row),
        };
        const landed = finalizeHeroFlightSegment(moved, heroId);
        return {
            session: landed.session,
            error: null,
            siegeTownId: landed.siegeTownId,
        };
    }
    const speed = flightSpeed(catalog);
    const nextPos = advanceAlongHexLine(hero.position, dest.position, speed);
    const moved = {
        ...session,
        heroes: session.heroes.map((row) => row.id === heroId
            ? {
                ...row,
                position: nextPos,
                movement_remaining: 0,
            }
            : row),
    };
    const landed = finalizeHeroFlightSegment(moved, heroId);
    return {
        session: landed.session,
        error: null,
        siegeTownId: landed.siegeTownId,
    };
}
/** Day tick: advance every airborne hero one flight_speed segment. */
export function advanceAllFlights(session) {
    let next = session;
    const sieges = [
        ...(session.game.pending_flight_sieges ?? []),
    ];
    for (const hero of session.heroes) {
        if (!hero.flight) {
            continue;
        }
        const result = advanceHeroFlightOnce(next, hero.id);
        next = result.session;
        if (result.siegeTownId) {
            sieges.push({ heroId: hero.id, townId: result.siegeTownId });
        }
    }
    if (sieges.length === 0) {
        return next;
    }
    return {
        ...next,
        game: {
            ...next.game,
            pending_flight_sieges: sieges,
        },
    };
}
export function takePendingFlightSieges(session) {
    const sieges = session.game.pending_flight_sieges ?? [];
    if (sieges.length === 0) {
        return { session, sieges: [] };
    }
    return {
        session: {
            ...session,
            game: { ...session.game, pending_flight_sieges: [] },
        },
        sieges,
    };
}
/** Heroes currently standing on a town hex they own. */
export function heroIdsInOwnedTown(session) {
    const ids = [];
    for (const hero of session.heroes) {
        const town = findTownAt(session, hero.position.q, hero.position.r);
        if (town && town.player_id === hero.player_id) {
            ids.push(hero.id);
        }
    }
    return ids;
}
/**
 * Full Energy + Mana at calendar day end for heroes standing in an owned town.
 * Entering town mid-day does not restore immediately — only the day boundary
 * does — so ending the day parked in town counts as spending the night.
 */
function restoreHeroPoolsEndingDayInTown(session) {
    const catalog = getCachedCatalog();
    if (!catalog) {
        return session;
    }
    let changed = false;
    const heroes = session.heroes.map((hero) => {
        const town = findTownAt(session, hero.position.q, hero.position.r);
        if (!town || town.player_id !== hero.player_id) {
            return hero;
        }
        const pools = heroResourcePools(catalog, hero);
        if (hero.current_mana === pools.current_mana &&
            hero.current_energy === pools.current_energy) {
            return hero;
        }
        changed = true;
        return {
            ...hero,
            current_mana: pools.current_mana,
            current_energy: pools.current_energy,
        };
    });
    return changed ? { ...session, heroes } : session;
}
export function restoreAllHeroMovement(session) {
    const catalog = getCachedCatalog();
    const moveMode = session.game.settings.move_mode;
    return {
        ...session,
        heroes: session.heroes.map((hero) => ({
            ...hero,
            movement_remaining: heroMovementPoints(catalog, hero, moveMode),
        })),
    };
}
export function findTownByName(session, name) {
    return session.towns.find((town) => town.name === name);
}
export function findTownById(session, townId) {
    return session.towns.find((town) => town.id === townId);
}
export function findTownAt(session, q, r) {
    return session.towns.find((town) => {
        if (town.position.q === q && town.position.r === r) {
            return true;
        }
        const keepQ = town.position.q + (town.flipped ? 1 : -1);
        return keepQ === q && town.position.r === r;
    });
}
export function findNodeAt(session, q, r) {
    return session.nodes.find((node) => node.position.q === q && node.position.r === r);
}
export function findFountainAt(session, q, r) {
    return (session.features ?? []).find((row) => row.kind === 'fountain' &&
        row.position.q === q &&
        row.position.r === r);
}
export function findChestAt(session, q, r) {
    return (session.features ?? []).find((row) => row.kind === 'chest' &&
        row.position.q === q &&
        row.position.r === r);
}
export function findChestById(session, featureId) {
    return (session.features ?? []).find((row) => row.kind === 'chest' && row.id === featureId);
}
export function findSignAt(session, q, r) {
    return (session.features ?? []).find((row) => row.kind === 'sign' &&
        row.position.q === q &&
        row.position.r === r);
}
export function findSignById(session, featureId) {
    return (session.features ?? []).find((row) => row.kind === 'sign' && row.id === featureId);
}
export function findWorldLibraryAt(session, q, r) {
    return (session.features ?? []).find((row) => row.kind === 'library' &&
        row.position.q === q &&
        row.position.r === r);
}
export function findWorldLibraryById(session, featureId) {
    return (session.features ?? []).find((row) => row.kind === 'library' && row.id === featureId);
}
/** Mark a world Library visited by a player (map tooltip). */
export function recordWorldLibraryVisit(session, featureId, playerId) {
    return {
        ...session,
        features: (session.features ?? []).map((row) => {
            if (row.kind !== 'library' || row.id !== featureId) {
                return row;
            }
            if (row.visited_by_player[playerId]) {
                return row;
            }
            return {
                ...row,
                visited_by_player: {
                    ...row.visited_by_player,
                    [playerId]: true,
                },
            };
        }),
    };
}
/** Persist the resolved text for one player's read of a sign. */
export function recordSignRead(session, featureId, playerId, text) {
    const withRead = {
        ...session,
        features: (session.features ?? []).map((row) => {
            if (row.kind !== 'sign' || row.id !== featureId) {
                return row;
            }
            return {
                ...row,
                last_text_by_player: {
                    ...row.last_text_by_player,
                    [playerId]: text,
                },
            };
        }),
    };
    return creditVisitFeature(withRead, featureId, playerId);
}
/** Mark a chest open (Leave or before XP/Loot choice). Contents unchanged. */
export function openChest(session, featureId) {
    return {
        ...session,
        features: (session.features ?? []).map((row) => row.kind === 'chest' && row.id === featureId ? { ...row, open: true } : row),
    };
}
export function updateChest(session, featureId, updater) {
    return {
        ...session,
        features: (session.features ?? []).map((row) => row.kind === 'chest' && row.id === featureId ? updater(row) : row),
    };
}
/** Remove a chest after XP or Loot is taken. */
export function removeChest(session, featureId) {
    return {
        ...session,
        features: (session.features ?? []).filter((row) => row.id !== featureId),
    };
}
export function findGroundItemById(session, featureId) {
    return (session.features ?? []).find((row) => row.kind === 'ground_item' && row.id === featureId);
}
export function findGroundItemAt(session, q, r) {
    return (session.features ?? []).find((row) => row.kind === 'ground_item' &&
        row.position.q === q &&
        row.position.r === r);
}
export function removeGroundItem(session, featureId) {
    return {
        ...session,
        features: (session.features ?? []).filter((row) => row.id !== featureId),
    };
}
/**
 * Full Mana + Energy restore when a hero moves onto a fountain (BR S9-2).
 * Silent no-op when both pools are already full (or max is 0).
 */
export function applyFountainVisit(session, catalog, heroId, q, r) {
    if (!findFountainAt(session, q, r)) {
        return { session, message: null };
    }
    const hero = session.heroes.find((row) => row.id === heroId);
    if (!hero) {
        return { session, message: null };
    }
    const pools = heroResourcePools(catalog, hero);
    const manaMax = pools.current_mana;
    const energyMax = pools.current_energy;
    const restoredMana = manaMax > 0 && hero.current_mana < manaMax;
    const restoredEnergy = energyMax > 0 && hero.current_energy < energyMax;
    const fountain = findFountainAt(session, q, r);
    let nextSession = session;
    if (fountain) {
        // Visit Feature quests complete on stepping onto the Fountain (BR S9-10).
        nextSession = creditVisitFeature(nextSession, fountain.id, hero.player_id);
    }
    if (!restoredMana && !restoredEnergy) {
        return { session: nextSession, message: null };
    }
    const nextHero = {
        ...hero,
        current_mana: restoredMana ? manaMax : hero.current_mana,
        current_energy: restoredEnergy ? energyMax : hero.current_energy,
    };
    const poolLabel = restoredMana && restoredEnergy
        ? 'Mana and Energy'
        : restoredMana
            ? 'Mana'
            : 'Energy';
    nextSession = {
        ...nextSession,
        heroes: nextSession.heroes.map((row) => (row.id === heroId ? nextHero : row)),
    };
    return {
        session: nextSession,
        message: `${hero.name} regains all ${poolLabel}`,
    };
}
function townByIdOrName(session, townIdOrName) {
    return findTownById(session, townIdOrName) ?? findTownByName(session, townIdOrName);
}
export function markTownBuiltToday(session, townIdOrName) {
    const match = townByIdOrName(session, townIdOrName);
    if (!match) {
        return session;
    }
    const day = calendarDayNumber(session.game.calendar);
    return {
        ...session,
        towns: session.towns.map((town) => town.id === match.id ? { ...town, last_build_day: day } : town),
    };
}
export function hasTownBuiltToday(session, townIdOrName) {
    const town = townByIdOrName(session, townIdOrName);
    if (!town || town.last_build_day == null) {
        return false;
    }
    return town.last_build_day === calendarDayNumber(session.game.calendar);
}
