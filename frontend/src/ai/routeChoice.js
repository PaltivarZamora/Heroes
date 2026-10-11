import { approachHex, findPathAvoidingMobRings, findPathOnBoard, hexDistance, neighborHexes, } from '../hex/pathfinding';
import { boatCostGold, boatEnterCost, boatOccupiedByHero, canSailOnto, findBoatAt, isDisembarkLandHex, } from '../hex/boat';
import { hexTransitionMoveCost } from '../hex/terrainTransition';
import { GOLD_RESOURCE_ID } from '../hex/resources';
import { aiCfgNumber, flightCostPerHex, flightSpeed, getCachedCatalog, } from '../town/catalog';
import { findTownAt, findWorldHangerBeside, flightDestinationsFromOrigin, townHasHanger, } from '../session/accessors';
import { appendAiTrace } from './trace';
const ESTIMATE_BOAT_ID = '__ai_route_estimate__';
function posKey(pos) {
    return `${pos.q},${pos.r}`;
}
function samePos(a, b) {
    return a.q === b.q && a.r === b.r;
}
function mpToDays(mp, maxMp) {
    return mp / Math.max(maxMp, 1e-9);
}
function landPathMoveCost(from, to, blocked) {
    if (samePos(from, to)) {
        return 0;
    }
    const planned = findPathAvoidingMobRings(from, to, blocked);
    const path = planned?.path;
    if (!path || path.length < 2) {
        return null;
    }
    let cost = 0;
    for (let i = 1; i < path.length; i += 1) {
        const step = hexTransitionMoveCost(getCachedCatalog(), path[i].q, path[i].r);
        if (step == null) {
            return null;
        }
        cost += step;
    }
    return cost;
}
function sailPathMoveCost(session, from, to, playerId) {
    if (samePos(from, to)) {
        return 0;
    }
    const path = findPathOnBoard(from, to, boatEnterCost, undefined, (q, r) => (q === from.q && r === from.r) ||
        canSailOnto(session, q, r, ESTIMATE_BOAT_ID, playerId));
    if (!path || path.length < 2) {
        return null;
    }
    let cost = 0;
    for (let i = 1; i < path.length; i += 1) {
        const step = boatEnterCost(path[i].q, path[i].r);
        if (step == null) {
            return null;
        }
        cost += step;
    }
    return cost;
}
function visibleToPlayer(seen, pos) {
    return seen.has(posKey(pos));
}
function bestBoatPlan(input, approachDest) {
    const { session, hero, player, catalog, maxMp, pursuitId, baseIntent, blockedHexes, seen } = input;
    if (!catalog) {
        return null;
    }
    const blocked = blockedHexes(session, hero, approachDest);
    let best = null;
    const consider = (walkToBoardMp, sailStart, goldCost, dockFeatureId, reuseBoatId) => {
        if (walkToBoardMp == null) {
            return;
        }
        for (const land of neighborHexes(approachDest)) {
            if (!isDisembarkLandHex(land.q, land.r)) {
                continue;
            }
            let bestWater = null;
            let bestSail = Infinity;
            for (const water of neighborHexes(land)) {
                const sailMp = sailPathMoveCost(session, sailStart, water, player.id);
                if (sailMp == null) {
                    continue;
                }
                if (sailMp < bestSail) {
                    bestSail = sailMp;
                    bestWater = water;
                }
            }
            if (!bestWater || !Number.isFinite(bestSail)) {
                continue;
            }
            const walkAfterMp = landPathMoveCost(land, approachDest, blocked);
            if (walkAfterMp == null) {
                continue;
            }
            const totalMp = walkToBoardMp + bestSail + walkAfterMp;
            const days = mpToDays(totalMp, maxMp);
            if (!best || days < best.days) {
                best = {
                    days,
                    goldCost,
                    commit: {
                        pursuit_id: pursuitId,
                        mode: 'boat',
                        base_intent: baseIntent,
                        approach: { ...approachDest },
                        dock_feature_id: dockFeatureId,
                        reuse_boat_id: reuseBoatId,
                        sail_water: { ...bestWater },
                        disembark_land: { ...land },
                    },
                };
            }
        }
    };
    const oneDayMp = maxMp;
    for (const boat of session.boats ?? []) {
        if (boat.occupant_hero_id != null) {
            continue;
        }
        if (!visibleToPlayer(seen, boat.position)) {
            continue;
        }
        const walkMp = landPathMoveCost(hero.position, boat.position, blocked);
        if (walkMp == null || walkMp > oneDayMp + 1e-9) {
            continue;
        }
        consider(walkMp, boat.position, 0, undefined, boat.id);
    }
    for (const feature of session.features ?? []) {
        if (feature.kind !== 'dock') {
            continue;
        }
        if (!visibleToPlayer(seen, feature.position)) {
            continue;
        }
        const atLaunch = findBoatAt(session, feature.launch.q, feature.launch.r);
        const goldCost = atLaunch && atLaunch.occupant_hero_id == null ? 0 : boatCostGold(catalog);
        const walkTarget = atLaunch ? atLaunch.position : feature.position;
        const approach = approachHex(hero.position, walkTarget, blockedHexes(session, hero, null));
        if (!approach) {
            continue;
        }
        const walkMp = landPathMoveCost(hero.position, approach, blocked);
        const sailStart = atLaunch
            ? atLaunch.position
            : { q: feature.launch.q, r: feature.launch.r };
        consider(walkMp, sailStart, goldCost, feature.id, atLaunch?.id);
    }
    return best;
}
function bestFlightPlan(input, approachDest) {
    const { session, hero, player, catalog, maxMp, pursuitId, baseIntent, blockedHexes } = input;
    if (!catalog) {
        return null;
    }
    const blocked = blockedHexes(session, hero, approachDest);
    const speed = flightSpeed(catalog);
    const perHex = flightCostPerHex(catalog);
    let best = null;
    const origins = [];
    const standingTown = findTownAt(session, hero.position.q, hero.position.r);
    if (standingTown &&
        standingTown.player_id === player.id &&
        townHasHanger(session, catalog, standingTown.id)) {
        origins.push({
            label: `town ${standingTown.name}`,
            walkMp: 0,
            originPos: standingTown.position,
            originTownId: standingTown.id,
        });
    }
    else {
        for (const town of session.towns) {
            if (town.player_id !== player.id) {
                continue;
            }
            if (!townHasHanger(session, catalog, town.id)) {
                continue;
            }
            const approach = approachHex(hero.position, town.position, blocked);
            const walkMp = landPathMoveCost(hero.position, approach ?? town.position, blocked);
            if (walkMp == null) {
                continue;
            }
            origins.push({
                label: `town ${town.name}`,
                walkMp,
                originPos: town.position,
                originTownId: town.id,
            });
        }
        for (const feature of session.features ?? []) {
            if (feature.kind !== 'hanger') {
                continue;
            }
            if (!input.seen.has(posKey(feature.position))) {
                continue;
            }
            const approach = approachHex(hero.position, feature.position, blockedHexes(session, hero, null));
            if (!approach) {
                continue;
            }
            const walkMp = landPathMoveCost(hero.position, approach, blocked);
            if (walkMp == null) {
                continue;
            }
            origins.push({
                label: 'world hanger',
                walkMp,
                originPos: feature.position,
                hangerFeatureId: feature.id,
            });
        }
    }
    for (const origin of origins) {
        const quotes = flightDestinationsFromOrigin(session, catalog, origin.originPos, player.id, hero.id, origin.originTownId ?? null);
        for (const quote of quotes) {
            if (quote.blocked) {
                continue;
            }
            const flightDays = Math.max(1, Math.ceil(quote.distance / speed));
            const walkAfterMp = landPathMoveCost(quote.town.position, approachDest, blocked);
            if (walkAfterMp == null) {
                continue;
            }
            const days = mpToDays(origin.walkMp, maxMp) + flightDays + mpToDays(walkAfterMp, maxMp);
            const goldCost = quote.distance * perHex;
            if (!best || days < best.days) {
                best = {
                    days,
                    goldCost,
                    commit: {
                        pursuit_id: pursuitId,
                        mode: 'flight',
                        base_intent: baseIntent,
                        approach: { ...approachDest },
                        flight_town_id: quote.town.id,
                        origin_town_id: origin.originTownId,
                        hanger_feature_id: origin.hangerFeatureId,
                    },
                };
            }
        }
    }
    return best;
}
function compareRoutes(input) {
    const { hero, session, player, catalog, maxMp, pursuitId, baseIntent, blockedHexes } = input;
    const approachDest = baseIntent.dest;
    const blocked = blockedHexes(session, hero, approachDest);
    const walkMp = landPathMoveCost(hero.position, approachDest, blocked);
    const walkDays = walkMp == null ? null : mpToDays(walkMp, maxMp);
    const minTrip = aiCfgNumber(catalog, 'ai_route_min_trip_days', 3);
    const minSaved = aiCfgNumber(catalog, 'ai_route_min_days_saved', 2);
    const goldReserve = aiCfgNumber(catalog, 'ai_route_gold_reserve', 2000);
    const gold = player.resources[GOLD_RESOURCE_ID] ?? 0;
    const walk = {
        mode: 'walk',
        days: walkDays ?? Number.POSITIVE_INFINITY,
        goldCost: 0,
        commit: {
            pursuit_id: pursuitId,
            mode: 'walk',
            base_intent: baseIntent,
            approach: { ...approachDest },
        },
    };
    const boatPlan = bestBoatPlan(input, approachDest);
    const flightPlan = bestFlightPlan(input, approachDest);
    const boat = boatPlan
        ? {
            mode: 'boat',
            days: boatPlan.days,
            goldCost: boatPlan.goldCost,
            commit: boatPlan.commit,
        }
        : null;
    const flight = flightPlan
        ? {
            mode: 'flight',
            days: flightPlan.days,
            goldCost: flightPlan.goldCost,
            commit: flightPlan.commit,
        }
        : null;
    const noLand = walkDays == null;
    const longEnough = walkDays != null && walkDays + 1e-9 >= minTrip;
    const paidOk = (est) => {
        if (gold < est.goldCost + goldReserve) {
            return false;
        }
        if (noLand) {
            return true;
        }
        if (!longEnough) {
            return false;
        }
        return walkDays - est.days + 1e-9 >= minSaved;
    };
    const candidates = [walk];
    if (boat && (noLand || longEnough) && paidOk(boat)) {
        candidates.push(boat);
    }
    if (flight && (noLand || longEnough) && paidOk(flight)) {
        candidates.push(flight);
    }
    if (!noLand && !longEnough) {
        return { pick: walk, walkDays, boat, flight };
    }
    let pick = candidates[0];
    for (const row of candidates) {
        if (row.days + 1e-9 < pick.days) {
            pick = row;
        }
    }
    return { pick, walkDays, boat, flight };
}
function shouldCompareRoute(intent) {
    switch (intent.kind) {
        case 'explore':
        case 'fly':
        case 'sail':
        case 'disembark':
        case 'board_boat':
        case 'seek_dock':
        case 'seek_hanger':
            return false;
        default:
            return true;
    }
}
export function logRouteChoice(hero, pursuitId, walkDays, boat, flight, pick) {
    const fmt = (est) => est == null
        ? 'n/a'
        : `${est.mode}=${est.days.toFixed(2)}d gold=${est.goldCost}`;
    appendAiTrace([
        `AI route_choice — ${hero.name} pursuit=${pursuitId}`,
        `  walk=${walkDays == null ? 'no path' : `${walkDays.toFixed(2)}d`}  ${fmt(boat)}  ${fmt(flight)}`,
        `  pick=${pick.mode} (${pick.days.toFixed(2)}d, gold=${pick.goldCost})`,
    ].join('\n'));
}
/** Commit + first step intent after a new world goal is chosen. */
export function applyAiRouteChoice(input) {
    const { pick, walkDays, boat, flight } = compareRoutes(input);
    logRouteChoice(input.hero, input.pursuitId, walkDays, boat, flight, pick);
    const commit = pick.commit ?? {
        pursuit_id: input.pursuitId,
        mode: 'walk',
        base_intent: input.baseIntent,
        approach: { ...input.baseIntent.dest },
    };
    const intent = stepAiRouteCommit(input, commit) ?? input.baseIntent;
    return { intent, commit };
}
function sailTowardWater(session, hero, boatId, target) {
    if (hexDistance(hero.position, target) <= 1) {
        for (const land of neighborHexes(hero.position)) {
            if (isDisembarkLandHex(land.q, land.r)) {
                return { kind: 'disembark', dest: land };
            }
        }
    }
    let best = null;
    for (const n of neighborHexes(hero.position)) {
        if (boatEnterCost(n.q, n.r) == null) {
            continue;
        }
        if (!canSailOnto(session, n.q, n.r, boatId, hero.player_id)) {
            continue;
        }
        const path = findPathOnBoard(hero.position, n, boatEnterCost, undefined, (q, r) => (q === hero.position.q && r === hero.position.r) ||
            canSailOnto(session, q, r, boatId, hero.player_id));
        if (!path || path.length < 2) {
            continue;
        }
        let cost = 0;
        for (let i = 1; i < path.length; i += 1) {
            const step = boatEnterCost(path[i].q, path[i].r);
            if (step == null) {
                cost = Infinity;
                break;
            }
            cost += step;
        }
        const score = cost + hexDistance(n, target) * 0.1;
        if (!best || score < best.travel) {
            best = { dest: n, travel: score };
        }
    }
    if (!best) {
        return null;
    }
    return { kind: 'sail', dest: best.dest };
}
/** Next movement intent while an {@link AiRouteCommit} is active (same pursuit). */
export function stepAiRouteCommit(input, commit) {
    const { session, hero, catalog, blockedHexes } = input;
    if (!catalog) {
        return commit.base_intent;
    }
    if (commit.mode === 'walk') {
        return commit.base_intent;
    }
    const aboard = boatOccupiedByHero(session, hero.id);
    if (commit.mode === 'flight') {
        const destTownId = commit.flight_town_id;
        if (!destTownId) {
            return commit.base_intent;
        }
        const standingTown = findTownAt(session, hero.position.q, hero.position.r);
        if (commit.origin_town_id &&
            standingTown?.id === commit.origin_town_id &&
            townHasHanger(session, catalog, standingTown.id)) {
            const town = session.towns.find((row) => row.id === destTownId);
            if (town) {
                return {
                    kind: 'fly',
                    dest: { ...town.position },
                    townId: destTownId,
                };
            }
        }
        if (commit.hanger_feature_id) {
            const beside = findWorldHangerBeside(session, hero.position);
            if (beside?.id === commit.hanger_feature_id) {
                const town = session.towns.find((row) => row.id === destTownId);
                if (town) {
                    return {
                        kind: 'fly',
                        dest: { ...town.position },
                        townId: destTownId,
                    };
                }
            }
            const feature = (session.features ?? []).find((row) => row.id === commit.hanger_feature_id);
            if (feature?.kind === 'hanger') {
                const approach = approachHex(hero.position, feature.position, blockedHexes(session, hero, null));
                if (approach && !samePos(approach, hero.position)) {
                    return {
                        kind: 'seek_hanger',
                        dest: approach,
                        featureId: feature.id,
                    };
                }
            }
        }
        if (commit.origin_town_id) {
            const town = session.towns.find((row) => row.id === commit.origin_town_id);
            if (town) {
                const approach = approachHex(hero.position, town.position, blockedHexes(session, hero, null));
                if (approach && !samePos(approach, hero.position)) {
                    return {
                        kind: 'return',
                        dest: approach,
                        townId: town.id,
                    };
                }
            }
        }
        return commit.base_intent;
    }
    if (commit.mode === 'boat') {
        if (aboard) {
            if (commit.sail_water) {
                const sail = sailTowardWater(session, hero, aboard.id, commit.sail_water);
                if (sail) {
                    return sail;
                }
            }
            return commit.base_intent;
        }
        if (commit.reuse_boat_id) {
            const boat = session.boats?.find((row) => row.id === commit.reuse_boat_id);
            if (boat && boat.occupant_hero_id == null) {
                if (samePos(hero.position, boat.position)) {
                    return {
                        kind: 'board_boat',
                        dest: boat.position,
                        boatId: boat.id,
                    };
                }
                const blocked = blockedHexes(session, hero, boat.position);
                const travel = landPathMoveCost(hero.position, boat.position, blocked);
                if (travel != null) {
                    return {
                        kind: 'board_boat',
                        dest: boat.position,
                        boatId: boat.id,
                    };
                }
            }
        }
        if (commit.dock_feature_id) {
            const dock = (session.features ?? []).find((row) => row.id === commit.dock_feature_id && row.kind === 'dock');
            if (dock && dock.kind === 'dock') {
                const atLaunch = findBoatAt(session, dock.launch.q, dock.launch.r);
                if (atLaunch && atLaunch.occupant_hero_id == null) {
                    const blocked = blockedHexes(session, hero, atLaunch.position);
                    const travel = landPathMoveCost(hero.position, atLaunch.position, blocked);
                    if (travel != null) {
                        return {
                            kind: 'board_boat',
                            dest: atLaunch.position,
                            boatId: atLaunch.id,
                        };
                    }
                }
                if (atLaunch && samePos(hero.position, atLaunch.position)) {
                    return {
                        kind: 'board_boat',
                        dest: atLaunch.position,
                        boatId: atLaunch.id,
                    };
                }
                const approach = approachHex(hero.position, dock.position, blockedHexes(session, hero, null));
                if (approach) {
                    if (samePos(hero.position, approach) && hexDistance(hero.position, dock.position) <= 1) {
                        return {
                            kind: 'seek_dock',
                            dest: approach,
                            featureId: dock.id,
                        };
                    }
                    if (!samePos(hero.position, approach)) {
                        return {
                            kind: 'seek_dock',
                            dest: approach,
                            featureId: dock.id,
                        };
                    }
                }
            }
        }
        return commit.base_intent;
    }
    return commit.base_intent;
}
export { shouldCompareRoute, compareRoutes };
