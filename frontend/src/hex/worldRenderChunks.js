/**
 * World-map terrain bake + fog + prop incremental paint + viewport cull (BR S9-16).
 *
 * Render chunks are fixed 16×16 blocks in odd-r offset (col,row) space.
 * Each chunk with explored hexes bakes terrain+wedges into one RenderTexture.
 * Wedges live on the painted hex (cell-masked), so cross-chunk neighbors only
 * need terrain lookups — no shared pixels between chunk textures.
 */
import { Container, Graphics, RenderTexture, Sprite, } from 'pixi.js';
import { addChunkMaskedTerrain, addMaskedTerrainWedge, buildTerrainChunkDecors, } from './terrainTextures';
import { assignedTerrainForHex, assignedTerrainName, parseCssHexColor, wedgesForHex, } from './terrainTransition';
import { layoutWorldMapPropSprite } from './propTextures';
import { propRowById } from '../town/catalog';
import { forEachTile, getTile, isExplored } from './world';
/** Fixed bake / cull block size in offset hexes. */
export const RENDER_CHUNK_SIZE = 16;
const UNEXPLORED_COLOR = 0x3a3a3a;
const CULL_MARGIN_PX = 128;
function offsetFromZero(axis) {
    return (axis + -1 * (axis & 1)) >> 1;
}
function axialToOffset(q, r) {
    return { col: q + offsetFromZero(r), row: r };
}
function chunkCoord(col, row) {
    return {
        cx: Math.floor(col / RENDER_CHUNK_SIZE),
        cy: Math.floor(row / RENDER_CHUNK_SIZE),
    };
}
function chunkKey(cx, cy) {
    return `${cx},${cy}`;
}
function hexKey(q, r) {
    return `${q},${r}`;
}
function hexCenter(hex, offsetX, offsetY) {
    const corners = hex.corners;
    let x = 0;
    let y = 0;
    for (const corner of corners) {
        x += corner.x;
        y += corner.y;
    }
    const n = corners.length;
    return { x: x / n + offsetX, y: y / n + offsetY };
}
function countDisplayTree(root) {
    let total = 0;
    let visible = 0;
    const walk = (node, parentVisible) => {
        total += 1;
        const on = parentVisible && node.visible !== false && node.renderable !== false;
        if (on) {
            visible += 1;
        }
        for (const child of node.children) {
            if (child instanceof Container) {
                walk(child, on);
            }
            else {
                total += 1;
                const leaf = child;
                if (on && leaf.visible !== false && leaf.renderable !== false) {
                    visible += 1;
                }
            }
        }
    };
    walk(root, true);
    return { total, visible };
}
export class WorldChunkRenderer {
    chunkSize = RENDER_CHUNK_SIZE;
    app;
    grid;
    terrainLayer;
    fogLayer;
    groundPropLayer;
    blockingPropLayer;
    mapArtLayer;
    propBlockerByHex = new Map();
    offsetX;
    offsetY;
    hexSize;
    seed;
    useTerrainImages;
    showHexOutlines;
    wedgesEnabled;
    hexTerrainTextures;
    getCatalog;
    buckets = new Map();
    chunkDecors = new Map();
    propByHex = new Map();
    propCullByHex = new Map();
    lastRepaintMs = 0;
    frameMs = 16.7;
    avgFrameMs = 16.7;
    fps = 60;
    exploredCount = 0;
    constructor(opts) {
        this.app = opts.app;
        this.grid = opts.grid;
        this.terrainLayer = opts.terrainLayer;
        this.fogLayer = opts.fogLayer;
        this.groundPropLayer = opts.groundPropLayer;
        this.blockingPropLayer = opts.blockingPropLayer;
        this.mapArtLayer = opts.mapArtLayer;
        this.offsetX = opts.offsetX;
        this.offsetY = opts.offsetY;
        this.hexSize = opts.hexSize;
        this.seed = opts.seed;
        this.useTerrainImages = opts.useTerrainImages;
        this.showHexOutlines = opts.showHexOutlines;
        this.wedgesEnabled = opts.wedgesEnabled;
        this.hexTerrainTextures = opts.hexTerrainTextures;
        this.getCatalog = opts.getCatalog;
        this.groundPropLayer.sortableChildren = true;
        this.blockingPropLayer.sortableChildren = true;
        this.buildBuckets();
        this.rebuildDecors();
    }
    buildBuckets() {
        this.buckets.clear();
        this.grid.forEach((hex) => {
            const { col, row } = axialToOffset(hex.q, hex.r);
            const { cx, cy } = chunkCoord(col, row);
            const key = chunkKey(cx, cy);
            let bucket = this.buckets.get(key);
            if (!bucket) {
                bucket = {
                    cx,
                    cy,
                    cells: [],
                    minX: Infinity,
                    minY: Infinity,
                    maxX: -Infinity,
                    maxY: -Infinity,
                    terrainSprite: null,
                    terrainRt: null,
                    fogGfx: new Graphics(),
                    dirty: true,
                };
                this.fogLayer.addChild(bucket.fogGfx);
                this.buckets.set(key, bucket);
            }
            bucket.cells.push({ q: hex.q, r: hex.r, hex, col, row });
            for (const corner of hex.corners) {
                const x = corner.x + this.offsetX;
                const y = corner.y + this.offsetY;
                if (x < bucket.minX)
                    bucket.minX = x;
                if (y < bucket.minY)
                    bucket.minY = y;
                if (x > bucket.maxX)
                    bucket.maxX = x;
                if (y > bucket.maxY)
                    bucket.maxY = y;
            }
        });
        const pad = this.hexSize * 0.75;
        for (const bucket of this.buckets.values()) {
            bucket.minX -= pad;
            bucket.minY -= pad;
            bucket.maxX += pad;
            bucket.maxY += pad;
        }
    }
    /** Generation-chunk UV decors — once per map (or after settings that remount). */
    rebuildDecors() {
        const members = [];
        this.grid.forEach((hex) => {
            members.push({ q: hex.q, r: hex.r, hex });
        });
        this.chunkDecors = this.useTerrainImages
            ? buildTerrainChunkDecors(members, (q, r) => assignedTerrainName(q, r), (q, r) => getTile(q, r)?.chunkId ?? null, (name) => this.hexTerrainTextures.get(name) ??
                this.hexTerrainTextures.get(name.replaceAll(' ', '_')), this.offsetX, this.offsetY, this.seed)
            : new Map();
    }
    setAppearanceFlags(opts) {
        if (opts.useTerrainImages != null) {
            this.useTerrainImages = opts.useTerrainImages;
        }
        if (opts.showHexOutlines != null) {
            this.showHexOutlines = opts.showHexOutlines;
        }
    }
    /**
     * Full terrain+fog rebuild for all chunks that have any explored hex.
     * Used on first paint and when wedge/image/outline settings change.
     */
    rebakeAll() {
        const t0 = performance.now();
        this.rebuildDecors();
        let explored = 0;
        for (const bucket of this.buckets.values()) {
            bucket.dirty = true;
            let any = false;
            for (const cell of bucket.cells) {
                if (isExplored(cell.q, cell.r)) {
                    any = true;
                    explored += 1;
                }
            }
            if (any) {
                this.bakeChunk(bucket);
            }
            else {
                this.clearChunkTerrain(bucket);
            }
            this.paintChunkFog(bucket);
        }
        this.exploredCount = explored;
        this.lastRepaintMs = performance.now() - t0;
        return this.lastRepaintMs;
    }
    /**
     * Reveal newly explored hexes: rebake only affected chunks + their fog.
     * Returns false when `hexes` is empty (caller should skip props too).
     */
    revealHexes(hexes) {
        if (hexes.length === 0) {
            this.lastRepaintMs = 0;
            return false;
        }
        const t0 = performance.now();
        const dirty = new Set();
        for (const { q, r } of hexes) {
            const { col, row } = axialToOffset(q, r);
            const { cx, cy } = chunkCoord(col, row);
            dirty.add(chunkKey(cx, cy));
        }
        for (const key of dirty) {
            const bucket = this.buckets.get(key);
            if (!bucket) {
                continue;
            }
            this.bakeChunk(bucket);
            this.paintChunkFog(bucket);
        }
        this.exploredCount = 0;
        forEachTile((q, r) => {
            if (isExplored(q, r)) {
                this.exploredCount += 1;
            }
        });
        this.lastRepaintMs = performance.now() - t0;
        return true;
    }
    clearChunkTerrain(bucket) {
        if (bucket.terrainSprite) {
            this.terrainLayer.removeChild(bucket.terrainSprite);
            bucket.terrainSprite.destroy();
            bucket.terrainSprite = null;
        }
        if (bucket.terrainRt) {
            bucket.terrainRt.destroy(true);
            bucket.terrainRt = null;
        }
    }
    bakeChunk(bucket) {
        const catalog = this.getCatalog();
        if (!catalog || catalog.terrain.length === 0) {
            return;
        }
        const exploredCells = bucket.cells.filter((c) => isExplored(c.q, c.r));
        if (exploredCells.length === 0) {
            this.clearChunkTerrain(bucket);
            bucket.dirty = false;
            return;
        }
        const w = Math.max(1, Math.ceil(bucket.maxX - bucket.minX));
        const h = Math.max(1, Math.ceil(bucket.maxY - bucket.minY));
        const stage = new Container();
        stage.position.set(-bucket.minX, -bucket.minY);
        for (const cell of exploredCells) {
            this.paintHexInto(stage, cell.hex, catalog);
        }
        const rt = bucket.terrainRt &&
            bucket.terrainRt.width === w &&
            bucket.terrainRt.height === h
            ? bucket.terrainRt
            : RenderTexture.create({
                width: w,
                height: h,
                resolution: 1,
                antialias: true,
            });
        if (rt !== bucket.terrainRt) {
            this.clearChunkTerrain(bucket);
            bucket.terrainRt = rt;
        }
        this.app.renderer.render({
            container: stage,
            target: rt,
            clear: true,
        });
        stage.destroy({ children: true });
        if (!bucket.terrainSprite) {
            bucket.terrainSprite = new Sprite(rt);
            bucket.terrainSprite.position.set(bucket.minX, bucket.minY);
            this.terrainLayer.addChild(bucket.terrainSprite);
        }
        else {
            bucket.terrainSprite.texture = rt;
            bucket.terrainSprite.position.set(bucket.minX, bucket.minY);
        }
        bucket.dirty = false;
    }
    /** Same paint path as the former live per-hex terrain (visual parity). */
    paintHexInto(parent, hex, catalog) {
        const base = assignedTerrainForHex(catalog, hex.q, hex.r);
        if (!base) {
            return;
        }
        const poly = hex.corners.map((corner) => ({
            x: corner.x + this.offsetX,
            y: corner.y + this.offsetY,
        }));
        const cell = new Container();
        const cellMask = new Graphics();
        cellMask.poly(poly);
        cellMask.fill({ color: 0xffffff });
        cell.addChild(cellMask);
        cell.mask = cellMask;
        if (this.useTerrainImages) {
            const decor = this.chunkDecors.get(`${hex.q},${hex.r}`);
            if (decor) {
                let cx = 0;
                let cy = 0;
                for (const p of poly) {
                    cx += p.x;
                    cy += p.y;
                }
                cx /= poly.length;
                cy /= poly.length;
                const expanded = poly.map((corner) => {
                    const dx = corner.x - cx;
                    const dy = corner.y - cy;
                    const len = Math.hypot(dx, dy) || 1;
                    return {
                        x: corner.x + (dx / len) * 2,
                        y: corner.y + (dy / len) * 2,
                    };
                });
                addChunkMaskedTerrain(cell, expanded, decor);
            }
            else {
                const g = new Graphics();
                g.poly(poly);
                g.fill({ color: parseCssHexColor(base.color) });
                cell.addChild(g);
            }
        }
        else {
            const g = new Graphics();
            g.poly(poly);
            g.fill({ color: parseCssHexColor(base.color) });
            cell.addChild(g);
        }
        if (this.wedgesEnabled()) {
            const wedges = wedgesForHex(catalog, hex, this.offsetX, this.offsetY, hex.q, hex.r, (nq, nr) => {
                const nHex = this.grid.getHex({ q: nq, r: nr });
                if (!nHex) {
                    return null;
                }
                return hexCenter(nHex, this.offsetX, this.offsetY);
            });
            for (const wedge of wedges) {
                if (this.useTerrainImages) {
                    if (wedge.fromBuffer) {
                        const bufTex = this.hexTerrainTextures.get(wedge.terrain.name) ??
                            this.hexTerrainTextures.get(wedge.terrain.name.replaceAll(' ', '_'));
                        if (bufTex) {
                            addMaskedTerrainWedge(cell, wedge.points, {
                                kind: 'texture',
                                texture: bufTex,
                                hex,
                                offsetX: this.offsetX,
                                offsetY: this.offsetY,
                            });
                            continue;
                        }
                    }
                    else {
                        const decor = this.chunkDecors.get(`${wedge.nq},${wedge.nr}`);
                        if (decor) {
                            addMaskedTerrainWedge(cell, wedge.points, {
                                kind: 'chunk',
                                decor,
                            });
                            continue;
                        }
                    }
                }
                addMaskedTerrainWedge(cell, wedge.points, {
                    kind: 'color',
                    color: parseCssHexColor(wedge.terrain.color),
                });
            }
        }
        parent.addChild(cell);
        if (this.showHexOutlines) {
            const stroke = new Graphics();
            stroke.poly(poly);
            stroke.stroke({ width: 1.5, color: 0x111111 });
            parent.addChild(stroke);
        }
    }
    paintChunkFog(bucket) {
        const g = bucket.fogGfx;
        g.clear();
        for (const cell of bucket.cells) {
            if (isExplored(cell.q, cell.r)) {
                continue;
            }
            g.poly(cell.hex.corners.map((corner) => ({
                x: corner.x + this.offsetX,
                y: corner.y + this.offsetY,
            })));
            g.fill({ color: UNEXPLORED_COLOR });
            g.stroke({ width: 1.5, color: 0x2a2a2a });
        }
    }
    /** Add prop sprites for newly explored hexes (skip if already present). */
    async addPropsForHexes(hexes, loadProp, _addSprite) {
        void _addSprite;
        const jobs = [];
        for (const { q, r } of hexes) {
            const key = hexKey(q, r);
            if (this.propByHex.has(key)) {
                continue;
            }
            const tile = getTile(q, r);
            if (!tile?.propFile) {
                continue;
            }
            const hex = this.grid.getHex({ q, r });
            if (!hex) {
                continue;
            }
            jobs.push({
                key,
                q,
                r,
                file: tile.propFile,
                variant: tile.propVariant ?? 1,
                flipped: tile.propFlipped === true,
                propId: tile.propId ?? null,
                hex,
            });
        }
        await Promise.all(jobs.map(async (job) => {
            const texture = await loadProp(job.file, job.variant);
            if (!texture || this.propByHex.has(job.key)) {
                return;
            }
            const center = hexCenter(job.hex, this.offsetX, this.offsetY);
            const row = propRowById(this.getCatalog(), job.propId);
            const renderScale = row?.render_scale ?? 1;
            const isBlocker = row?.is_blocker === true;
            const sprite = new Sprite();
            const layer = isBlocker ? this.blockingPropLayer : this.groundPropLayer;
            layer.addChild(sprite);
            const cull = layoutWorldMapPropSprite(sprite, texture, center.x, center.y, job.hex.width, job.hex.height, {
                renderScale,
                wall: row?.wall === true,
                mapSeed: this.seed,
                q: job.q,
                r: job.r,
                flipped: job.flipped,
            });
            this.propByHex.set(job.key, sprite);
            this.propCullByHex.set(job.key, cull);
            this.propBlockerByHex.set(job.key, isBlocker);
        }));
        this.syncPropDrawOrder();
    }
    /** Screen-y sort for non-blocking ground props. */
    syncGroundPropDepth() {
        const layer = this.groundPropLayer;
        if (layer.destroyed) {
            return;
        }
        for (const [key, sprite] of this.propByHex) {
            if (this.propBlockerByHex.get(key) || sprite.destroyed) {
                continue;
            }
            if (sprite.parent !== layer) {
                layer.addChild(sprite);
            }
            sprite.zIndex = Math.round(sprite.y * 1000);
        }
        layer.sortChildren();
    }
    /** Feature views only (always below {@link actorLayer} heroes). */
    syncMapArtDepth(featureViews) {
        const layer = this.mapArtLayer;
        if (layer.destroyed) {
            return;
        }
        for (const { container, sortY } of featureViews) {
            if (container.destroyed ||
                container.parent !== layer ||
                !Number.isFinite(sortY)) {
                continue;
            }
            container.zIndex = Math.round(sortY * 1000);
        }
        layer.sortChildren();
        this.syncGroundPropDepth();
    }
    /** Blocking props for hero/mob/boat occlusion (world y + cull box). */
    blockingPropEntries() {
        const out = [];
        for (const [key, sprite] of this.propByHex) {
            if (!this.propBlockerByHex.get(key) || sprite.destroyed) {
                continue;
            }
            const cull = this.propCullByHex.get(key);
            if (!cull) {
                continue;
            }
            out.push({ key, sprite, cull });
        }
        return out;
    }
    /** Move blocking props onto the actor layer for y-sort vs units. */
    syncBlockingPropsToActorLayer(actorLayer) {
        if (actorLayer.destroyed) {
            return;
        }
        for (const [key, sprite] of this.propByHex) {
            if (!this.propBlockerByHex.get(key) || sprite.destroyed) {
                continue;
            }
            if (sprite.parent !== actorLayer) {
                actorLayer.addChild(sprite);
            }
            sprite.zIndex = Math.round(sprite.y * 1000);
        }
    }
    /** @deprecated internal — use {@link syncMapArtDepth} from the map after feature layout. */
    syncPropDrawOrder() {
        this.syncMapArtDepth([]);
    }
    /** Axis-aligned cull in world space (same margins as props / chunks). */
    cullWorldBox(box, cameraX, cameraY, viewW, viewH) {
        const left = cameraX - CULL_MARGIN_PX;
        const top = cameraY - CULL_MARGIN_PX;
        const right = cameraX + viewW + CULL_MARGIN_PX;
        const bottom = cameraY + viewH + CULL_MARGIN_PX;
        const { cullX: cx, cullY: cy, cullMargin: margin } = box;
        return (cx + margin >= left &&
            cx - margin <= right &&
            cy + margin >= top &&
            cy - margin <= bottom);
    }
    /** Drop only tracked world-prop sprites (never strip the whole prop layer). */
    clearPropSpritesOnly() {
        for (const sprite of this.propByHex.values()) {
            sprite.parent?.removeChild(sprite);
            sprite.destroy();
        }
        this.propByHex.clear();
        this.propCullByHex.clear();
        this.propBlockerByHex.clear();
    }
    /** Re-layout existing props after catalog `render_scale` changes (Reload Reference Data). */
    async refreshPropScalesFromCatalog(loadProp) {
        const hexes = [];
        for (const key of this.propByHex.keys()) {
            const parts = key.split(',');
            if (parts.length !== 2) {
                continue;
            }
            const q = Number(parts[0]);
            const r = Number(parts[1]);
            if (!Number.isFinite(q) || !Number.isFinite(r)) {
                continue;
            }
            hexes.push({ q, r });
            const sprite = this.propByHex.get(key);
            sprite?.parent?.removeChild(sprite);
            sprite?.destroy();
            this.propByHex.delete(key);
            this.propCullByHex.delete(key);
            this.propBlockerByHex.delete(key);
        }
        if (hexes.length === 0) {
            return;
        }
        await this.addPropsForHexes(hexes, loadProp, () => new Sprite());
    }
    /** Full prop resync (hotseat / remount). */
    async rebuildAllProps(loadProp, addSprite) {
        this.clearPropSpritesOnly();
        const hexes = [];
        forEachTile((q, r) => {
            if (isExplored(q, r)) {
                hexes.push({ q, r });
            }
        });
        await this.addPropsForHexes(hexes, loadProp, addSprite);
    }
    /**
     * Viewport cull for baked chunks, fog, and props.
     * Callers should also cull feature/town/hero/mob views via
     * {@link cullWorldPoint}.
     */
    updateCull(cameraX, cameraY, viewW, viewH) {
        const left = cameraX - CULL_MARGIN_PX;
        const top = cameraY - CULL_MARGIN_PX;
        const right = cameraX + viewW + CULL_MARGIN_PX;
        const bottom = cameraY + viewH + CULL_MARGIN_PX;
        let visibleChunks = 0;
        for (const bucket of this.buckets.values()) {
            const on = bucket.maxX >= left &&
                bucket.minX <= right &&
                bucket.maxY >= top &&
                bucket.minY <= bottom;
            if (on) {
                visibleChunks += 1;
            }
            if (bucket.terrainSprite) {
                bucket.terrainSprite.visible = on;
                bucket.terrainSprite.renderable = on;
            }
            bucket.fogGfx.visible = on;
            bucket.fogGfx.renderable = on;
        }
        for (const [key, sprite] of this.propByHex) {
            const cull = this.propCullByHex.get(key);
            const cx = cull?.cullX ?? sprite.x;
            const cy = cull?.cullY ?? sprite.y;
            const margin = cull?.cullMargin ?? this.hexSize * 1.5;
            const on = cx + margin >= left &&
                cx - margin <= right &&
                cy + margin >= top &&
                cy - margin <= bottom;
            sprite.visible = on;
            sprite.renderable = on;
        }
        return visibleChunks;
    }
    /** Point-in-viewport test (margin included) for markers / features. */
    cullWorldPoint(worldX, worldY, cameraX, cameraY, viewW, viewH) {
        const left = cameraX - CULL_MARGIN_PX;
        const top = cameraY - CULL_MARGIN_PX;
        const right = cameraX + viewW + CULL_MARGIN_PX;
        const bottom = cameraY + viewH + CULL_MARGIN_PX;
        return worldX >= left && worldX <= right && worldY >= top && worldY <= bottom;
    }
    noteFrame(deltaMS) {
        this.frameMs = deltaMS;
        this.avgFrameMs = this.avgFrameMs * 0.9 + deltaMS * 0.1;
        this.fps = deltaMS > 0 ? 1000 / this.avgFrameMs : 0;
    }
    propCullCounts() {
        let total = 0;
        let visible = 0;
        for (const sprite of this.propByHex.values()) {
            if (sprite.destroyed) {
                continue;
            }
            total += 1;
            if (sprite.visible && sprite.renderable) {
                visible += 1;
            }
        }
        return { total, visible };
    }
    stats(worldRoot) {
        const counts = countDisplayTree(worldRoot);
        const props = this.propCullCounts();
        let baked = 0;
        let visibleChunks = 0;
        for (const bucket of this.buckets.values()) {
            if (bucket.terrainSprite) {
                baked += 1;
                if (bucket.terrainSprite.visible && bucket.terrainSprite.renderable) {
                    visibleChunks += 1;
                }
            }
        }
        return {
            fps: this.fps,
            frameMs: this.frameMs,
            avgFrameMs: this.avgFrameMs,
            lastRepaintMs: this.lastRepaintMs,
            displayObjectsTotal: counts.total,
            displayObjectsVisible: counts.visible,
            propsTotal: props.total,
            propsVisible: props.visible,
            exploredHexes: this.exploredCount,
            bakedChunks: baked,
            visibleChunks,
            chunkSize: RENDER_CHUNK_SIZE,
        };
    }
    destroy() {
        for (const bucket of this.buckets.values()) {
            this.clearChunkTerrain(bucket);
            bucket.fogGfx.destroy();
        }
        this.buckets.clear();
        this.clearPropSpritesOnly();
        this.chunkDecors.clear();
    }
}
/** Module-level latest stats for the Debug panel (updated by HexMap ticker). */
let latestStats = null;
export function setWorldRenderStats(stats) {
    latestStats = stats;
}
export function getWorldRenderStats() {
    return latestStats;
}
