import { hexDistance } from './pathfinding';
/** Visit hex is the feature anchor; hero must stand on it. */
export function heroOnVisitHex(hero, visit) {
    return hero.q === visit.q && hero.r === visit.r;
}
/** Hero may interact from the visit hex or any adjacent hex. */
export function heroBesideVisitHex(hero, visit) {
    return hexDistance(hero, visit) <= 1;
}
/** End-of-move gate for walk-to-hex intents (town, node, fountain). */
export function heroReachedWalkOnto(hero, walkOnto, dest) {
    const want = walkOnto ?? dest;
    return hero.q === want.q && hero.r === want.r;
}
