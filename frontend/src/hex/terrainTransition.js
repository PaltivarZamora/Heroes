/**
 * Hex terrain transition (wedge) helpers — BR wedge rendering.
 *
 * Fill = this hex's assigned chunk terrain (always visible as the cell base).
 * Move cost = assigned terrain only (permanent rule).
 *
 * Normal borders (no required_buffer): wedges only when ALL of:
 *   - self is a local z_order minimum (keeps high-z cores like Aether solid)
 *   - neighbor.z > self.z (one shared transition row, not two)
 *   - neighbor is a local z_order maximum (blocks camouflaged mid-z sources
 *     e.g. Lava under Aether from projecting orphan orange onto Rocky)
 *   - the chosen hex edge actually faces that neighbor (not an ambiguous vertex)
 *
 * required_buffer pairs: both abutting hexes wedge toward the buffer terrain
 * (2-hex-wide visual: A → A/Buffer → Buffer/B → B) instead of toward each other.
 */
import { hexTerrainByName, requiredBufferBetween, roadMoveCost } from '../town/catalog';
import { getTile } from './world';
/**
 * Axial neighbor deltas — same cube steps for flat and pointy (pixel angles
 * come from hex.corners / neighbor centers).
 */
const AXIAL_NEIGHBORS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 },
];
function neighborCoords(q, r) {
    return AXIAL_NEIGHBORS.map((d) => ({ q: q + d.q, r: r + d.r }));
}
/** Assigned chunk terrain name on a hex (generation output). */
export function assignedTerrainName(q, r, lookup) {
    if (lookup) {
        const name = lookup(q, r)?.trim();
        return name && name.length > 0 ? name : null;
    }
    const tile = getTile(q, r);
    const name = tile?.terrain?.trim();
    return name && name.length > 0 ? name : null;
}
/** This hex's chunk terrain row (what we fill the hex with). */
export function assignedTerrainForHex(catalog, q, r, lookup) {
    const name = assignedTerrainName(q, r, lookup);
    return name ? hexTerrainByName(catalog, name) : null;
}
/**
 * @deprecated Prefer assignedTerrainForHex for fill.
 */
export function baseTerrainForHex(catalog, q, r) {
    return assignedTerrainForHex(catalog, q, r);
}
/**
 * Movement cost for a hex: road overlay first (flat `road_move_cost`), else
 * the assigned (chunk / base) terrain's move_cost only.
 * Mixed-hex wedges do not average or override — permanent rule.
 */
export function hexTransitionMoveCost(catalog, q, r) {
    const tile = getTile(q, r);
    if (tile?.hasRoad) {
        return roadMoveCost(catalog);
    }
    // Bridge: deep water that generation marked walkable (BR S9-32).
    if (tile &&
        !tile.blocked &&
        tile.terrain.trim().toLowerCase() === 'water') {
        return 1;
    }
    if (!catalog) {
        return tile?.movementCostMultiplier ?? null;
    }
    const row = assignedTerrainForHex(catalog, q, r);
    if (!row) {
        return tile?.movementCostMultiplier ?? null;
    }
    if (row.is_blocker || row.move_cost == null) {
        return null;
    }
    return row.move_cost;
}
export function parseCssHexColor(color) {
    if (!color) {
        return 0x607d8b;
    }
    const raw = color.trim();
    const hex = raw.startsWith('#') ? raw.slice(1) : raw;
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
        return Number.parseInt(hex, 16);
    }
    if (/^[0-9a-fA-F]{3}$/.test(hex)) {
        const r = hex[0];
        const g = hex[1];
        const b = hex[2];
        return Number.parseInt(`${r}${r}${g}${g}${b}${b}`, 16);
    }
    return 0x607d8b;
}
/**
 * True when no assigned neighbor has a strictly higher z_order than `z`.
 * Mid-z hexes sitting under a higher-z neighbor must not project wedges.
 */
function isLocalZMaximum(catalog, q, r, z, lookup) {
    for (const n of neighborCoords(q, r)) {
        const row = assignedTerrainForHex(catalog, n.q, n.r, lookup);
        if (row && row.z_order > z) {
            return false;
        }
    }
    return true;
}
/**
 * True when no assigned neighbor has a strictly lower z_order than `z`.
 * Hexes that already sit above something lower stay solid (e.g. Aether next
 * to Rocky does not take Shadow/Snow notches either).
 */
function isLocalZMinimum(catalog, q, r, z, lookup) {
    for (const n of neighborCoords(q, r)) {
        const row = assignedTerrainForHex(catalog, n.q, n.r, lookup);
        if (row && row.z_order < z) {
            return false;
        }
    }
    return true;
}
/**
 * Wedges on borders. Normal pairs: lower-z side only. required_buffer pairs:
 * both sides wedge toward the buffer terrain (2-hex visual border).
 */
export function wedgesForHex(catalog, hex, offsetX, offsetY, q, r, neighborCenter, lookup) {
    const self = assignedTerrainForHex(catalog, q, r, lookup);
    if (!self) {
        return [];
    }
    const corners = hex.corners.map((corner) => ({
        x: corner.x + offsetX,
        y: corner.y + offsetY,
    }));
    if (corners.length < 6) {
        return [];
    }
    let cx = 0;
    let cy = 0;
    for (const c of corners) {
        cx += c.x;
        cy += c.y;
    }
    cx /= corners.length;
    cy /= corners.length;
    // Resolve all neighbor centers once — used for terrain + face validation.
    const neighbors = [];
    for (const n of neighborCoords(q, r)) {
        const name = assignedTerrainName(n.q, n.r, lookup);
        if (!name) {
            continue;
        }
        const terrain = hexTerrainByName(catalog, name);
        if (!terrain) {
            continue;
        }
        const c = neighborCenter(n.q, n.r);
        if (!c) {
            continue;
        }
        neighbors.push({ q: n.q, r: n.r, terrain, x: c.x, y: c.y });
    }
    const out = [];
    const isMin = isLocalZMinimum(catalog, q, r, self.z_order, lookup);
    for (const n of neighbors) {
        if (n.terrain.name === self.name) {
            continue;
        }
        const buffer = requiredBufferBetween(catalog, self, n.terrain);
        if (buffer) {
            // Both abutting hexes wedge toward buffer (not toward each other).
            // Requires buffer.z > self.z so assigned fill stays visible (Beach > Water/Dirt).
            if (buffer.z_order <= self.z_order) {
                continue;
            }
            const face = faceCornersTowardValidated(corners, cx, cy, n.x, n.y, neighbors);
            if (!face) {
                continue;
            }
            out.push({
                nq: n.q,
                nr: n.r,
                terrain: buffer,
                fromBuffer: true,
                points: [
                    { x: cx, y: cy },
                    face.a,
                    face.b,
                ],
            });
            continue;
        }
        // Normal 1-hex border — receiver must be a local z-minimum.
        if (!isMin) {
            continue;
        }
        if (n.terrain.z_order <= self.z_order) {
            continue;
        }
        if (!isLocalZMaximum(catalog, n.q, n.r, n.terrain.z_order, lookup)) {
            continue;
        }
        const face = faceCornersTowardValidated(corners, cx, cy, n.x, n.y, neighbors);
        if (!face) {
            continue;
        }
        out.push({
            nq: n.q,
            nr: n.r,
            terrain: n.terrain,
            fromBuffer: false,
            points: [
                { x: cx, y: cy },
                face.a,
                face.b,
            ],
        });
    }
    out.sort((a, b) => a.terrain.z_order - b.terrain.z_order);
    return out;
}
/**
 * Pick the edge facing (tx,ty), but only if that neighbor is also the closest
 * neighbor center to the edge midpoint — prevents painting terrain A on the
 * side that actually faces neighbor B at ambiguous vertices.
 */
function faceCornersTowardValidated(corners, cx, cy, tx, ty, allNeighbors) {
    const target = Math.atan2(ty - cy, tx - cx);
    let bestI = 0;
    let bestDiff = Number.POSITIVE_INFINITY;
    let secondDiff = Number.POSITIVE_INFINITY;
    for (let i = 0; i < corners.length; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % corners.length];
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const edgeAngle = Math.atan2(my - cy, mx - cx);
        let diff = Math.abs(edgeAngle - target);
        if (diff > Math.PI) {
            diff = 2 * Math.PI - diff;
        }
        if (diff < bestDiff) {
            secondDiff = bestDiff;
            bestDiff = diff;
            bestI = i;
        }
        else if (diff < secondDiff) {
            secondDiff = diff;
        }
    }
    // Ambiguous vertex aim — skip rather than paint the wrong side.
    if (secondDiff - bestDiff < 0.15) {
        return null;
    }
    const a = corners[bestI];
    const b = corners[(bestI + 1) % corners.length];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    let closestDist = Number.POSITIVE_INFINITY;
    let closestX = tx;
    let closestY = ty;
    for (const n of allNeighbors) {
        const d = (n.x - mx) * (n.x - mx) + (n.y - my) * (n.y - my);
        if (d < closestDist) {
            closestDist = d;
            closestX = n.x;
            closestY = n.y;
        }
    }
    // Intended neighbor must own this edge.
    if (Math.hypot(closestX - tx, closestY - ty) > 1e-3) {
        return null;
    }
    return { a, b };
}
