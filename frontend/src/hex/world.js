import { defineHex, Grid, Orientation, rectangle } from 'honeycomb-grid';
const GRID_PADDING = 28;
/** Pixi fill when a type has no PNG. Presentation only — costs come from the catalog. */
const TERRAIN_FILL = {
    'Stone Path': 0xcfd8dc,
    'Dirt Path': 0xc4a574,
    Grass: 0x4caf50,
    Ash: 0x5c5666,
    Rocky: 0x8d6e63,
    Lava: 0xe64a19,
    Desert: 0xf5e6a8,
    Snow: 0xe8f4f8,
    Mud: 0x5d4037,
    Swamp: 0x6b8e23,
    Shallows: 0x81d4fa,
    Moat: 0x1565c0,
    Forest: 0x1b5e20,
    Mountain: 0x4e342e,
    Water: 0x2196f3,
    Barrier: 0xe91e63,
    Void: 0x000000,
};
export function terrainFillColor(name) {
    return (TERRAIN_FILL[name] ??
        TERRAIN_FILL[name.replaceAll('_', ' ')] ??
        TERRAIN_FILL[name.replaceAll(' ', '_')] ??
        0x607d8b);
}
let tilesByCoord = new Map();
let explored = new Set();
function coordKey(q, r) {
    return `${q},${r}`;
}
function asZoneIdList(value) {
    if (!Array.isArray(value)) {
        return null;
    }
    const ids = value
        .map((item) => Number(item))
        .filter((n) => Number.isFinite(n) && n > 0);
    return ids.length > 0 ? ids : null;
}
function asWorldTile(raw) {
    const extra = raw;
    const costRaw = extra.movementCostMultiplier ?? extra.movement_cost_multiplier;
    const cost = costRaw == null || costRaw === ''
        ? null
        : Number(costRaw);
    const flag = extra.blocked ?? extra.isBlocked ?? extra.is_blocked;
    const blocked = flag === undefined
        ? cost == null || !Number.isFinite(cost)
        : flag === true ||
            flag === 1 ||
            String(flag).trim().toLowerCase() === 'true';
    const propIdRaw = raw.propId ?? extra.prop_id;
    const propVariantRaw = raw.propVariant ?? extra.prop_variant;
    const propFileRaw = raw.propFile ?? extra.prop_file;
    const propIdN = propIdRaw == null || propIdRaw === '' ? NaN : Number(propIdRaw);
    const propVariantN = propVariantRaw == null || propVariantRaw === ''
        ? NaN
        : Number(propVariantRaw);
    const propFile = typeof propFileRaw === 'string' && propFileRaw.trim() !== ''
        ? propFileRaw.trim().replace(/\.png$/i, '')
        : null;
    const propFlipRaw = raw.propFlipped ?? extra.propFlipped ?? extra.prop_flipped;
    const propFlipped = propFlipRaw === true ||
        propFlipRaw === 1 ||
        String(propFlipRaw ?? '')
            .trim()
            .toLowerCase() === 'true'
        ? true
        : undefined;
    const propScaleRaw = raw.propRenderScale ?? extra.propRenderScale ?? extra.prop_render_scale;
    const propScaleN = propScaleRaw == null || propScaleRaw === '' ? NaN : Number(propScaleRaw);
    const propRenderScale = Number.isFinite(propScaleN) && propScaleN > 0 ? propScaleN : undefined;
    const roadFlag = raw.hasRoad ?? extra.has_road;
    const hasRoad = roadFlag === true ||
        roadFlag === 1 ||
        String(roadFlag ?? '')
            .trim()
            .toLowerCase() === 'true';
    const maskRaw = raw.roadMask ?? extra.road_mask;
    const maskN = maskRaw == null || maskRaw === '' ? NaN : Number(maskRaw);
    return {
        q: raw.q,
        r: raw.r,
        terrain: String(raw.terrain ?? ''),
        movementCostMultiplier: cost != null && Number.isFinite(cost) ? cost : null,
        blocked,
        chunkId: (() => {
            const id = raw.chunkId ?? extra.chunk_id;
            const n = id == null || id === '' ? NaN : Number(id);
            return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        propId: Number.isFinite(propIdN) && propIdN > 0 ? propIdN : null,
        propVariant: Number.isFinite(propVariantN) && propVariantN > 0
            ? Math.floor(propVariantN)
            : null,
        propFile,
        propFlipped,
        propRenderScale,
        hasRoad: hasRoad || undefined,
        roadMask: Number.isFinite(maskN) ? Math.floor(maskN) : undefined,
        zoneId: (() => {
            const id = raw.zoneId ?? extra.zone_id;
            const n = id == null || id === '' ? NaN : Number(id);
            return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        wallGap: raw.wallGap === true ||
            extra.wall_gap === true ||
            extra.wall_gap === 1 ||
            String(extra.wall_gap ?? '')
                .trim()
                .toLowerCase() === 'true' ||
            undefined,
        wallBorders: asZoneIdList(raw.wallBorders ?? extra.wall_borders),
        pocketId: (() => {
            const id = raw.pocketId ?? extra.pocket_id;
            const n = id == null || id === '' ? NaN : Number(id);
            return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        })(),
        pocketTier: (() => {
            const id = raw.pocketTier ?? extra.pocket_tier;
            const n = id == null || id === '' ? NaN : Number(id);
            return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        })(),
        pocketEntrance: raw.pocketEntrance === true ||
            extra.pocket_entrance === true ||
            extra.pocket_entrance === 1 ||
            String(extra.pocket_entrance ?? '')
                .trim()
                .toLowerCase() === 'true' ||
            undefined,
        islandGuardTier: (() => {
            const id = raw.islandGuardTier ?? extra.island_guard_tier;
            const n = id == null || id === '' ? NaN : Number(id);
            return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        })(),
    };
}
export function setTiles(tiles) {
    tilesByCoord = new Map(tiles.map((tile) => {
        const next = asWorldTile(tile);
        return [coordKey(next.q, next.r), next];
    }));
}
export function getTile(q, r) {
    return tilesByCoord.get(coordKey(q, r));
}
export function isPassable(q, r) {
    const tile = getTile(q, r);
    return tile != null && !tile.blocked;
}
/** Walkable river crossing: Water terrain with blocked=false (BR S9-32). */
export function isBridgeHex(q, r) {
    const tile = getTile(q, r);
    if (!tile || tile.blocked) {
        return false;
    }
    return tile.terrain.trim().toLowerCase() === 'water';
}
export function forEachPassableHex(fn) {
    for (const tile of tilesByCoord.values()) {
        if (!tile.blocked) {
            fn(tile.q, tile.r);
        }
    }
}
export function forEachTile(fn) {
    for (const tile of tilesByCoord.values()) {
        fn(tile.q, tile.r);
    }
}
export function isExplored(q, r) {
    return explored.has(coordKey(q, r));
}
export function markExplored(q, r) {
    explored.add(coordKey(q, r));
}
export function getExploredHexes() {
    const hexes = [];
    for (const key of explored) {
        const comma = key.indexOf(',');
        if (comma < 0) {
            continue;
        }
        const q = Number(key.slice(0, comma));
        const r = Number(key.slice(comma + 1));
        if (Number.isFinite(q) && Number.isFinite(r)) {
            hexes.push({ q, r });
        }
    }
    return hexes;
}
export function restoreExplored(hexes) {
    explored = new Set();
    if (!hexes) {
        return;
    }
    for (const hex of hexes) {
        if (hex &&
            Number.isFinite(hex.q) &&
            Number.isFinite(hex.r)) {
            explored.add(coordKey(hex.q, hex.r));
        }
    }
}
/** Explored and passable — A* will not enter fog or impassable terrain. */
export function isWalkable(q, r) {
    return isExplored(q, r) && isPassable(q, r);
}
export function resetExplored() {
    explored = new Set();
}
let activeGridFetch = null;
export async function fetchTestGrid(seed, players, mapSize, townTypes, signal, difficultyId) {
    try {
        const params = new URLSearchParams();
        if (seed != null && seed > 0) {
            params.set('seed', String(seed));
        }
        if (players != null && players > 0) {
            params.set('players', String(players));
        }
        if (typeof mapSize === 'number' && mapSize > 0) {
            params.set('size', String(mapSize));
        }
        else if (typeof mapSize === 'string' && mapSize.trim()) {
            params.set('mapSize', mapSize.trim());
        }
        if (townTypes != null && townTypes.trim()) {
            params.set('townTypes', townTypes.trim());
        }
        if (difficultyId != null && difficultyId > 0) {
            params.set('difficulty', String(difficultyId));
        }
        const query = params.toString() ? `?${params.toString()}` : '';
        const response = await fetch(`/api/map/test-grid${query}`, { signal });
        if (signal?.aborted) {
            return { seed: 0, tiles: [], objects: [] };
        }
        if (!response.ok) {
            console.log('Failed to fetch test grid:', response.status);
            return { seed: 0, tiles: [], objects: [] };
        }
        const payload = (await response.json());
        if (!Array.isArray(payload.tiles)) {
            console.log('Failed to fetch test grid: unexpected payload');
            return { seed: 0, tiles: [], objects: [] };
        }
        payload.tiles = payload.tiles.map(asWorldTile);
        if (!Array.isArray(payload.objects)) {
            payload.objects = [];
        }
        if (!Array.isArray(payload.roads)) {
            payload.roads = [];
        }
        if (!Array.isArray(payload.mobs)) {
            payload.mobs = [];
        }
        console.log('Fetched test grid:', payload.tiles.length, 'tiles, seed', payload.seed, payload.objects.length, 'objects', payload.roads.length, 'road paths');
        resetExplored();
        return payload;
    }
    catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
            return { seed: 0, tiles: [], objects: [] };
        }
        console.log('Failed to fetch test grid:', error);
        return { seed: 0, tiles: [], objects: [] };
    }
}
/** One in-flight grid request; cancels any previous call (e.g. Strict Mode remount). */
export async function fetchTestGridOnce(seed, players, mapSize, townTypes, signal, difficultyId) {
    activeGridFetch?.abort();
    const own = new AbortController();
    activeGridFetch = own;
    const linked = signal;
    if (linked) {
        if (linked.aborted) {
            own.abort();
        }
        else {
            linked.addEventListener('abort', () => own.abort(), { once: true });
        }
    }
    try {
        return await fetchTestGrid(seed, players, mapSize, townTypes, own.signal, difficultyId);
    }
    finally {
        if (activeGridFetch === own) {
            activeGridFetch = null;
        }
    }
}
/** honeycomb-grid default offset (-1): (axis + -1 * (axis & 1)) >> 1 */
function offsetFromZero(axis) {
    return (axis + -1 * (axis & 1)) >> 1;
}
/**
 * EXPERIMENT: pointy-top world map — odd-r offset (row = r, col = q + offset(r)).
 * Revert with odd-q: col = q, row = r + offset(q).
 */
function dimensionsFromTiles(tiles) {
    let maxCol = 0;
    let maxRow = 0;
    for (const tile of tiles) {
        const row = tile.r;
        const col = tile.q + offsetFromZero(tile.r);
        if (col > maxCol) {
            maxCol = col;
        }
        if (row > maxRow) {
            maxRow = row;
        }
    }
    return { width: maxCol + 1, height: maxRow + 1 };
}
function measureGrid(grid) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    grid.forEach((hex) => {
        for (const corner of hex.corners) {
            minX = Math.min(minX, corner.x);
            minY = Math.min(minY, corner.y);
            maxX = Math.max(maxX, corner.x);
            maxY = Math.max(maxY, corner.y);
        }
    });
    // EXPERIMENT: pointy-top — uniform pad like combat (no flat verticalStagger).
    const pad = GRID_PADDING;
    return {
        offsetX: pad - minX,
        offsetY: pad - minY,
        canvasWidth: Math.ceil(maxX - minX + pad * 2),
        canvasHeight: Math.ceil(maxY - minY + pad * 2),
    };
}
/** Hex grid only — does not replace the World map tile cache. */
export function createHexGrid(width, height, hexSize) {
    const Hex = defineHex({
        dimensions: hexSize,
        // EXPERIMENT: pointy-top world map — revert to Orientation.FLAT with odd-q.
        orientation: Orientation.POINTY,
        origin: 'topLeft',
    });
    const grid = new Grid(Hex, rectangle({ width, height }));
    return { grid, layout: measureGrid(grid), width, height };
}
export function buildWorld(tiles, hexSize) {
    setTiles(tiles);
    const { width, height } = dimensionsFromTiles(tiles);
    return createHexGrid(width, height, hexSize);
}
