import { giveItemToHero } from '../items/give';
import { rolledItemDisplayName } from '../items/display';
import { findGroundItemAt, removeGroundItem, } from './accessors';
import { logItemPickedUp, logMobItemLeftOnGround, } from './gameLog';
import { onScreenBackpackFullGround, onScreenPickedUpMessage, } from '../items/itemLogFormat';
function heroPlayerId(session, heroId) {
    return session.heroes.find((row) => row.id === heroId)?.player_id ?? null;
}
export function tryPickupGroundItem(session, catalog, featureId, heroId) {
    const feature = session.features?.find((row) => row.kind === 'ground_item' && row.id === featureId);
    if (!feature) {
        return { session, message: null };
    }
    const itemName = rolledItemDisplayName(catalog, feature.item);
    const playerId = heroPlayerId(session, heroId);
    const given = giveItemToHero(session, catalog, heroId, feature.item);
    if (given.ok) {
        let next = removeGroundItem(given.session, featureId);
        if (playerId) {
            next = logItemPickedUp(next, playerId, heroId, feature.item.uid, itemName);
        }
        return {
            session: next,
            message: onScreenPickedUpMessage(catalog, feature.item),
        };
    }
    let next = session;
    if (playerId) {
        next = logMobItemLeftOnGround(next, playerId, heroId, itemName, feature.position.q, feature.position.r);
    }
    return {
        session: next,
        message: onScreenBackpackFullGround(catalog, feature.item),
    };
}
export function tryPickupGroundItemAtHex(session, catalog, q, r, heroId) {
    const feature = findGroundItemAt(session, q, r);
    if (!feature) {
        return { session, message: null };
    }
    return tryPickupGroundItem(session, catalog, feature.id, heroId);
}
function nextGroundFeatureId(session) {
    let n = (session.features?.length ?? 0) + 1;
    let id = `feature-${n}`;
    while (session.features?.some((row) => row.id === id)) {
        n += 1;
        id = `feature-${n}`;
    }
    return id;
}
/** Runtime unguarded drop (BR S9-43). Persists in session.features for save/load. */
export function spawnUnguardedGroundItem(session, catalog, q, r, item, flipped) {
    if (findGroundItemAt(session, q, r)) {
        return session;
    }
    const name = rolledItemDisplayName(catalog, item);
    const feature = {
        id: nextGroundFeatureId(session),
        kind: 'ground_item',
        position: { q, r },
        name,
        item,
        flipped,
        pocket_id: null,
        pocket_tier: null,
        guard: null,
        guard_tier: null,
        origin: 'mob_drop',
    };
    return {
        ...session,
        features: [...(session.features ?? []), feature],
    };
}
