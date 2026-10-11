import { findMobAt } from '../session/mobs';
import { findGroundItemAt } from '../session/accessors';
export function guardMobForGroundItem(session, feature) {
    if (!feature.guard) {
        return undefined;
    }
    return findMobAt(session, feature.guard.q, feature.guard.r);
}
export function groundItemGuardBlocksEntry(session, q, r) {
    const item = findGroundItemAt(session, q, r);
    if (!item) {
        return null;
    }
    const mob = guardMobForGroundItem(session, item);
    return mob ?? null;
}
/** Path preview: item hex is a fight while its standalone guard lives. */
export function pathStepShowsGroundItemFight(session, hex) {
    return groundItemGuardBlocksEntry(session, hex.q, hex.r) != null;
}
