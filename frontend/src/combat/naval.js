import { getTile } from '../hex/world';
import { hexTerrainById, hexTerrainByName } from '../town/catalog';
import { loadPropTexture, pickPropVariant } from '../hex/propTextures';
import { ATTACKER_COL, ATTACKER_HERO_COL, COMBAT_COLUMNS, COMBAT_ROWS, DEFENDER_COL, DEFENDER_HERO_COL, } from './battlefield';
import { occupancyKey } from './occupancy';
const DECK_TERRAIN_NAME = 'Boat';
const WATER_TERRAIN_NAME = 'Water';
const GRASS_TERRAIN_ID = 9;
const GANGPLANK_PROP_NAME = 'Gangplank';
const DECK_PROP_NAMES = ['Rope', 'Barrel', 'Crate'];
/** Fallback fills until Boat / prop art lands (mask colours). */
export const NAVAL_FALLBACK_FILL = {
    deck: 0x8b5a2b,
    water: 0x2a6fad,
    gangplank: 0xc4a35a,
    land: 0x5a7a3a,
};
function u32(n) {
    return n >>> 0;
}
function mulberry32(seed) {
    let t = u32(seed);
    return () => {
        t = u32(t + 0x6d2b79f5);
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}
/**
 * Centre water strip using honeycomb-grid **offset** `col` values from the
 * same combat `Grid` instance (pointy-top odd-r). Do not derive columns from
 * axial `q` — on odd rows `q` diverges from visual column index.
 */
export function navalWaterColumns(columns = COMBAT_COLUMNS) {
    if (columns < 3) {
        return [Math.floor(columns / 2)];
    }
    if (columns % 2 === 1) {
        return [Math.floor(columns / 2)];
    }
    const left = columns / 2 - 1;
    return [left, left + 1];
}
/**
 * Two fixed gangplank rows, evenly spaced (same count above / between / below).
 * For 11 rows → 0-based 3 and 7 (1-indexed 4 and 8).
 */
export function navalGangplankRows(rows = COMBAT_ROWS) {
    if (rows < 2) {
        return [0];
    }
    const free = rows - 2;
    const gap = Math.floor(free / 3);
    const top = gap;
    const mid = top + 1 + gap;
    return mid < rows ? [top, mid] : [top];
}
export function navalWaterColSet(columns = COMBAT_COLUMNS) {
    return new Set(navalWaterColumns(columns));
}
export function navalGangplankRowSet(rows = COMBAT_ROWS) {
    return new Set(navalGangplankRows(rows));
}
function leftSideKind(layout) {
    return layout === 'land_vs_boat' ? 'land' : 'deck';
}
function rightSideKind(layout) {
    return layout === 'boat_vs_land' ? 'land' : 'deck';
}
function hexKindAt(col, row, layout, waterCols, gangRows) {
    if (waterCols.has(col)) {
        return gangRows.has(row) ? 'gangplank' : 'water';
    }
    const waterMin = Math.min(...waterCols);
    if (col < waterMin) {
        return leftSideKind(layout);
    }
    return rightSideKind(layout);
}
function grassFallback(catalog) {
    return (hexTerrainById(catalog, GRASS_TERRAIN_ID)?.name ??
        hexTerrainByName(catalog, 'Grass')?.name ??
        'Grass');
}
function isUnusableLandTerrain(row) {
    if (!row) {
        return true;
    }
    const name = row.name.trim().toLowerCase();
    if (name === 'water' ||
        name === 'shallow' ||
        name === 'shallows' ||
        name === 'boat') {
        return true;
    }
    if (row.is_blocker || row.move_cost == null) {
        return true;
    }
    return false;
}
/**
 * Land-half paint terrain (BR S9-12): player's world hex, else Grass (9).
 * Rejects water / Boat / blockers / non-walkable.
 */
export function resolveNavalLandTerrain(catalog, heroWorldPos) {
    const fallback = grassFallback(catalog);
    if (!heroWorldPos) {
        return fallback;
    }
    const tile = getTile(heroWorldPos.q, heroWorldPos.r);
    const name = tile?.terrain?.trim();
    if (!name) {
        return fallback;
    }
    const row = hexTerrainByName(catalog, name);
    if (isUnusableLandTerrain(row)) {
        return fallback;
    }
    return row.name;
}
function terrainNameForKind(kind, landTerrain) {
    if (kind === 'water' || kind === 'gangplank') {
        // Gangplank hexes are Water underneath; the prop is drawn on top.
        return WATER_TERRAIN_NAME;
    }
    if (kind === 'land') {
        return landTerrain;
    }
    return DECK_TERRAIN_NAME;
}
function tileFromKind(hex, kind, catalog, landTerrain) {
    const terrain = terrainNameForKind(kind, landTerrain);
    const hexRow = hexTerrainByName(catalog, terrain);
    // Naval water / gangplank: walkable overlay rules, never catalog water blockers.
    if (kind === 'water' || kind === 'gangplank') {
        return {
            q: hex.q,
            r: hex.r,
            col: hex.col,
            row: hex.row,
            terrain: hexRow?.name ?? WATER_TERRAIN_NAME,
            movementCostMultiplier: 1,
            blocked: false,
            blocksLos: false,
            chunkId: kind === 'gangplank' ? 2 : 0,
            navalKind: kind,
        };
    }
    if (kind === 'deck') {
        return {
            q: hex.q,
            r: hex.r,
            col: hex.col,
            row: hex.row,
            terrain: hexRow?.name ?? DECK_TERRAIN_NAME,
            movementCostMultiplier: hexRow?.move_cost ?? 1,
            blocked: false,
            blocksLos: false,
            chunkId: 1,
            navalKind: 'deck',
        };
    }
    // Land mask: always walkable ground (prop rolls never touch this half).
    const landRow = hexTerrainByName(catalog, landTerrain);
    return {
        q: hex.q,
        r: hex.r,
        col: hex.col,
        row: hex.row,
        terrain: landRow?.name ?? landTerrain,
        movementCostMultiplier: landRow?.move_cost ?? 1,
        blocked: false,
        blocksLos: false,
        chunkId: 3,
        navalKind: 'land',
    };
}
function propByName(catalog, name) {
    const want = name.trim().toLowerCase();
    return catalog.prop.find((row) => row.name.trim().toLowerCase() === want);
}
/** Hexes reserved: deployment cols, hero cols, and the 3-hex gangplank footprint. */
function reservedNavalKeys(tiles, waterCols, gangRows) {
    const reserved = new Set();
    const waterMin = Math.min(...waterCols);
    const waterMax = Math.max(...waterCols);
    for (const tile of tiles) {
        if (tile.col == null || tile.row == null) {
            continue;
        }
        const col = tile.col;
        const row = tile.row;
        if (col === ATTACKER_COL ||
            col === DEFENDER_COL ||
            col === ATTACKER_HERO_COL ||
            col === DEFENDER_HERO_COL) {
            reserved.add(occupancyKey(tile.q, tile.r));
        }
        // Full 3-hex gangplank footprint: centre water + both abutting deck ends.
        if (gangRows.has(row) && col >= waterMin - 1 && col <= waterMax + 1) {
            reserved.add(occupancyKey(tile.q, tile.r));
        }
    }
    return reserved;
}
function placeGangplankProps(tiles, catalog) {
    const prop = propByName(catalog, GANGPLANK_PROP_NAME);
    if (!prop) {
        return tiles;
    }
    // BR S9-12 addendum: always draw as 3x1 centred on the water hex.
    // Gameplay: only this centre hex is navalKind gangplank; deck ends stay deck.
    return tiles.map((tile) => {
        if (tile.navalKind !== 'gangplank') {
            return tile;
        }
        return {
            ...tile,
            propId: prop.id,
            propFile: prop.file_name,
            propVariant: 1,
            propFootprint: '3x1',
            blocked: false,
            blocksLos: false,
        };
    });
}
function deckCandidateKeys(tiles, side, waterCols, reserved) {
    const waterMin = Math.min(...waterCols);
    const out = [];
    for (const tile of tiles) {
        if (tile.navalKind !== 'deck' || tile.col == null) {
            continue;
        }
        const key = occupancyKey(tile.q, tile.r);
        if (reserved.has(key)) {
            continue;
        }
        if (side === 'left' && tile.col < waterMin) {
            out.push(key);
        }
        if (side === 'right' && tile.col > Math.max(...waterCols)) {
            out.push(key);
        }
    }
    return out;
}
/**
 * Deck obstacle pool: Rope / Barrel / Crate that exist in catalog AND have
 * loadable art. Missing files (SPA HTML fallback) are skipped so decks never
 * roll an invisible prop.
 */
async function loadableDeckPropPool(catalog) {
    const out = [];
    for (const name of DECK_PROP_NAMES) {
        const prop = propByName(catalog, name);
        if (!prop?.file_name) {
            continue;
        }
        const texture = await loadPropTexture(prop.file_name, 1);
        if (texture) {
            out.push(prop);
        }
    }
    return out;
}
/**
 * Place 1–2 deck obstacle props on each boat deck half independently.
 * Driven by `navalKind === 'deck'` (not fight type) — any layout with a deck
 * half gets props; land halves never do. Never on reserved hexes (deployment
 * cols, hero cols, or the 3-hex gangplank footprint).
 */
async function placeDeckObstacleProps(tiles, catalog, seed, waterCols, gangRows) {
    const pool = await loadableDeckPropPool(catalog);
    if (pool.length === 0) {
        return tiles;
    }
    const reserved = reservedNavalKeys(tiles, waterCols, gangRows);
    const random = mulberry32(seed ^ 0x4e11a1);
    const byKey = new Map(tiles.map((tile) => [occupancyKey(tile.q, tile.r), { ...tile }]));
    const waterMin = Math.min(...waterCols);
    const waterMax = Math.max(...waterCols);
    // Discover deck halves from the mask itself (future layouts included).
    const sides = [];
    let hasLeftDeck = false;
    let hasRightDeck = false;
    for (const tile of tiles) {
        if (tile.navalKind !== 'deck' || tile.col == null) {
            continue;
        }
        if (tile.col < waterMin) {
            hasLeftDeck = true;
        }
        else if (tile.col > waterMax) {
            hasRightDeck = true;
        }
    }
    if (hasLeftDeck) {
        sides.push('left');
    }
    if (hasRightDeck) {
        sides.push('right');
    }
    for (const side of sides) {
        const open = deckCandidateKeys(tiles, side, waterCols, reserved).filter((key) => {
            const tile = byKey.get(key);
            return tile != null && tile.propId == null;
        });
        const count = 1 + (random() < 0.5 ? 1 : 0);
        for (let i = 0; i < count && open.length > 0; i += 1) {
            const idx = Math.min(open.length - 1, Math.floor(random() * open.length));
            const key = open.splice(idx, 1)[0];
            const prop = pool[Math.floor(random() * pool.length)];
            const variant = pickPropVariant(prop.variant_count, random);
            const tile = byKey.get(key);
            if (!tile) {
                continue;
            }
            byKey.set(key, {
                ...tile,
                propId: prop.id,
                propFile: prop.file_name,
                propVariant: variant,
                propFootprint: prop.footprint,
                blocked: prop.is_blocker,
                blocksLos: prop.is_los_blocker,
            });
            reserved.add(key);
        }
    }
    return tiles.map((tile) => byKey.get(occupancyKey(tile.q, tile.r)) ?? tile);
}
/**
 * Build the naval hex mask from honeycomb-grid offset col/row on the combat
 * grid cells (same instance used for pixel layout). Axial q/r are stored for
 * pathing only — mask membership is always `hex.col` / `hex.row`.
 *
 * `heroWorldPos` = player's hero world hex (land-half terrain source).
 */
export async function generateNavalCombatTiles(cells, catalog, layout, seed, heroWorldPos) {
    const waterCols = navalWaterColSet(COMBAT_COLUMNS);
    const gangRows = navalGangplankRowSet(COMBAT_ROWS);
    const landTerrain = resolveNavalLandTerrain(catalog, heroWorldPos);
    let tiles = cells.map((cell) => {
        const kind = hexKindAt(cell.col, cell.row, layout, waterCols, gangRows);
        return tileFromKind(cell, kind, catalog, landTerrain);
    });
    tiles = placeGangplankProps(tiles, catalog);
    tiles = await placeDeckObstacleProps(tiles, catalog, seed, waterCols, gangRows);
    return tiles;
}
/** Cells from a honeycomb combat grid (offset col/row). */
export function navalCellsFromGrid(grid) {
    const cells = [];
    grid.forEach((hex) => {
        cells.push({ q: hex.q, r: hex.r, col: hex.col, row: hex.row });
    });
    return cells;
}
/**
 * Deployment columns: keep the usual army cols when they sit on deck/land;
 * otherwise shift to the nearest valid column on that side.
 */
export function navalDeploymentColumns(layout) {
    const water = navalWaterColumns(COMBAT_COLUMNS);
    const waterMin = Math.min(...water);
    const waterMax = Math.max(...water);
    const leftOk = (col) => col >= 0 && col < waterMin;
    const rightOk = (col) => col > waterMax && col < COMBAT_COLUMNS;
    let attackerCol = ATTACKER_COL;
    let defenderCol = DEFENDER_COL;
    if (!leftOk(attackerCol)) {
        attackerCol = Math.max(0, waterMin - 1);
    }
    if (!rightOk(defenderCol)) {
        defenderCol = Math.min(COMBAT_COLUMNS - 1, waterMax + 1);
    }
    // Ensure sides match layout (deck or land — both walkable for deploy).
    void layout;
    return { attackerCol, defenderCol };
}
export function navalFallbackFill(kind) {
    if (!kind) {
        return null;
    }
    return NAVAL_FALLBACK_FILL[kind];
}
/** Which sides get Boat.png half-scenes for this layout. */
export function navalShipSides(layout) {
    return {
        left: layout === 'boat_vs_boat' || layout === 'boat_vs_land',
        right: layout === 'boat_vs_boat' || layout === 'land_vs_boat',
    };
}
/** Which sides are land (not deck) for Boat vs Land / Land vs Boat. */
export function navalLandSides(layout) {
    return {
        left: layout === 'land_vs_boat',
        right: layout === 'boat_vs_land',
    };
}
/** True when a wedge would paint Boat↔Water (those stay suppressed on naval). */
export function isNavalBoatWaterWedge(selfTerrain, wedgeTerrain) {
    const a = selfTerrain.trim().toLowerCase();
    const b = wedgeTerrain.trim().toLowerCase();
    const isBoat = (n) => n === 'boat';
    const isWater = (n) => n === 'water' || n === 'shallow' || n === 'shallows';
    return (isBoat(a) && isWater(b)) || (isWater(a) && isBoat(b));
}
