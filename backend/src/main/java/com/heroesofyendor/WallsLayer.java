package com.heroesofyendor;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;

/**
 * Zones + walls (BR S9-19), pipeline layer 3.
 *
 * <p>Each terrain chunk starts as its own zone. A chunk under {@code
 * zone_min_size} joins the zone of its largest land neighbour (following that
 * chain, so a tiny chunk and the zone it joined share one id). {@code zone_size}
 * is unused.
 *
 * <p>Walls are rolled per zone edge. An edge is eligible when at least one zone
 * has {@code wall_min_chunk} hexes. The wall line sits on the larger zone (lower
 * id on a tie). A zone of at least {@code wall_force_min} hexes with no walled
 * edge has its longest eligible edge forced. Every walled edge keeps at least
 * one gap. Terrains in {@code wall_no_terrain} never receive a wall prop, which
 * replaces the old Water/Shallow name check. Impassable entries in that list
 * are not land, so borders do not run along them. The fallback prop is only
 * for other walkable terrains that match no wall row. Town-clear hexes are
 * never walled.
 */
final class WallsLayer {

    private static final String LAYER = "walls";

    private WallsLayer() {}

    static void run(MapGenContext ctx) {
        Random rng = ctx.rngFor(LAYER);
        int borderPct = clampPct(MapConfig.cfgInt(ctx.data, "wall_border_pct", ctx.sizeName(), 50));
        int[] coverage = MapConfig.cfgIntRange(ctx.data, "wall_coverage", ctx.sizeName(), 50, 75);
        int[] gaps = MapConfig.cfgIntRange(ctx.data, "wall_gaps", ctx.sizeName(), 1, 2);
        int[] gapWidth = MapConfig.cfgIntRange(ctx.data, "wall_gap_width", ctx.sizeName(), 1, 5);
        int thickPct = clampPct(MapConfig.cfgInt(ctx.data, "wall_thick_pct", ctx.sizeName(), 15));
        int townClear = Math.max(0, MapConfig.cfgInt(ctx.data, "wall_town_clear", ctx.sizeName(), 3));
        int minChunk = Math.max(1, MapConfig.cfgInt(ctx.data, "wall_min_chunk", ctx.sizeName(), 40));
        int zoneMin = Math.max(1, MapConfig.cfgInt(ctx.data, "zone_min_size", ctx.sizeName(), 20));
        int forceMin = Math.max(1, MapConfig.cfgInt(ctx.data, "wall_force_min", ctx.sizeName(), 80));
        ctx.wallNoTerrain = wallNoTerrain(ctx);

        ctx.zoneIds = new int[ctx.height][ctx.width];
        ctx.wallGap = new boolean[ctx.height][ctx.width];
        ctx.wallBeside = new HashMap<>();
        if (ctx.propSeeds == null) {
            ctx.propSeeds = new WorldProps.Seed[ctx.height][ctx.width];
            ctx.propBlocked = new boolean[ctx.height][ctx.width];
        }

        assignChunksAsZones(ctx);
        int chunks = countZones(ctx.zoneIds);
        int absorbed = absorbTinyChunks(ctx, zoneMin);
        int zoneCount = countZones(ctx.zoneIds);

        List<WorldProps.WallProp> wallProps = WorldProps.walls(ctx.data);
        WorldProps.WallProp fallback = fallbackProp(ctx, wallProps);
        if (wallProps.isEmpty()) {
            MapGenPipeline.logCounts(
                    LAYER,
                    "chunks="
                            + chunks
                            + " zones="
                            + zoneCount
                            + " absorbed="
                            + absorbed
                            + " walls=0 (no wall props)");
            markUncoveredGaps(ctx);
            Pockets.carve(ctx);
            return;
        }

        boolean[][] clear = townClearance(ctx, townClear);
        boolean[][] island = islandMask(ctx);
        List<Border> borders = collectBorders(ctx, clear, island, minChunk);

        int walled = 0;
        int open = 0;
        int wallHexes = 0;
        Set<Long> walledPairs = new HashSet<>();

        for (Border border : borders) {
            if (border.hexes.isEmpty() || rng.nextInt(100) >= borderPct) {
                open++;
                continue;
            }
            wallHexes +=
                    commitWall(
                            ctx, border, rng, coverage, gaps, gapWidth, thickPct, wallProps, fallback, clear, island);
            walled++;
            walledPairs.add(pairKey(border.zoneA(), border.zoneB()));
        }

        int[] forced =
                forceLargeOpenZones(
                        ctx,
                        borders,
                        walledPairs,
                        forceMin,
                        rng,
                        coverage,
                        gaps,
                        gapWidth,
                        thickPct,
                        wallProps,
                        fallback,
                        clear,
                        island);
        walled += forced[0];
        open -= forced[0];
        wallHexes += forced[1];

        int repairs = repairCuts(ctx, clear, island, minChunk);
        markUncoveredGaps(ctx);
        Pockets.carve(ctx);
        MapGenPipeline.logCounts(
                LAYER,
                String.format(
                        "chunks=%d zones=%d absorbed=%d borders=%d walled=%d open=%d forced=%d "
                                + "wallHexes=%d repairs=%d",
                        chunks,
                        zoneCount,
                        absorbed,
                        borders.size(),
                        walled,
                        open,
                        forced[0],
                        wallHexes,
                        repairs));
    }

    /** zone_id starts as the terrain chunk id. */
    private static void assignChunksAsZones(MapGenContext ctx) {
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                int chunk = ctx.chunkIds[row][col];
                ctx.zoneIds[row][col] = Math.max(0, chunk);
            }
        }
    }

    /**
     * Chunks under {@code zoneMin} take the zone of their largest land neighbour.
     * Chains are followed, and a cycle keeps the larger chunk's id, so a tiny
     * chunk and the zone it joined share one id.
     */
    private static int absorbTinyChunks(MapGenContext ctx, int zoneMin) {
        Map<Integer, Integer> size = new HashMap<>();
        Map<Integer, Set<Integer>> adj = new HashMap<>();
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                int id = ctx.chunkIds[row][col];
                if (id <= 0) {
                    continue;
                }
                size.merge(id, 1, Integer::sum);
                adj.computeIfAbsent(id, k -> new HashSet<>());
                if (!land(ctx, col, row)) {
                    continue;
                }
                int q = HexCoords.qOf(col, row);
                for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                    int nrow = row + d[1];
                    int ncol = HexCoords.colOf(q + d[0], nrow);
                    if (!land(ctx, ncol, nrow)) {
                        continue;
                    }
                    int other = ctx.chunkIds[nrow][ncol];
                    if (other > 0 && other != id) {
                        adj.get(id).add(other);
                    }
                }
            }
        }
        Map<Integer, Integer> parent = new HashMap<>();
        for (int id : size.keySet()) {
            parent.put(id, id);
        }
        for (int id : size.keySet()) {
            if (size.get(id) >= zoneMin) {
                continue;
            }
            int best = -1;
            int bestSize = -1;
            for (int neighbour : adj.getOrDefault(id, Set.of())) {
                int neighbourSize = size.getOrDefault(neighbour, 0);
                if (neighbourSize > bestSize || (neighbourSize == bestSize && (best < 0 || neighbour < best))) {
                    best = neighbour;
                    bestSize = neighbourSize;
                }
            }
            if (best > 0) {
                parent.put(id, best);
            }
        }
        Map<Integer, Integer> root = new HashMap<>();
        for (int id : size.keySet()) {
            root.put(id, absorbRoot(id, parent, size));
        }
        int absorbed = 0;
        for (int id : size.keySet()) {
            if (root.get(id) != id) {
                absorbed++;
            }
        }
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                int chunk = ctx.chunkIds[row][col];
                if (chunk > 0) {
                    ctx.zoneIds[row][col] = root.getOrDefault(chunk, chunk);
                }
            }
        }
        return absorbed;
    }

    private static int absorbRoot(int id, Map<Integer, Integer> parent, Map<Integer, Integer> size) {
        List<Integer> path = new ArrayList<>();
        Set<Integer> seen = new HashSet<>();
        int cur = id;
        while (true) {
            if (!seen.add(cur)) {
                int cycleAt = path.indexOf(cur);
                int best = cur;
                for (int i = Math.max(0, cycleAt); i < path.size(); i++) {
                    int candidate = path.get(i);
                    int candidateSize = size.getOrDefault(candidate, 0);
                    int bestSize = size.getOrDefault(best, 0);
                    if (candidateSize > bestSize || (candidateSize == bestSize && candidate < best)) {
                        best = candidate;
                    }
                }
                return best;
            }
            path.add(cur);
            int next = parent.getOrDefault(cur, cur);
            if (next == cur) {
                return cur;
            }
            cur = next;
        }
    }

    private static long pairKey(int a, int b) {
        int lo = Math.min(a, b);
        int hi = Math.max(a, b);
        return (((long) lo) << 32) ^ (hi & 0xffffffffL);
    }

    /** Coverage, gaps, and props for one walled edge. Returns wall hexes placed. */
    private static int commitWall(
            MapGenContext ctx,
            Border border,
            Random rng,
            int[] coverage,
            int[] gaps,
            int[] gapWidth,
            int thickPct,
            List<WorldProps.WallProp> wallProps,
            WorldProps.WallProp fallback,
            boolean[][] clear,
            boolean[][] island) {
        int cov = coverage[0] + (coverage[1] > coverage[0] ? rng.nextInt(coverage[1] - coverage[0] + 1) : 0);
        int nGaps = gaps[0] + (gaps[1] > gaps[0] ? rng.nextInt(gaps[1] - gaps[0] + 1) : 0);
        int width = gapWidth[0] + (gapWidth[1] > gapWidth[0] ? rng.nextInt(gapWidth[1] - gapWidth[0] + 1) : 0);
        List<int[]> chain = orderChain(border.hexes);
        boolean[] keep = coverageMask(chain.size(), cov, rng);
        punchGaps(chain, keep, Math.max(1, nGaps), width, rng, ctx);
        ensureOpening(chain, keep, ctx);
        markWalledEdge(ctx, border);
        int wallHexes = 0;
        for (int i = 0; i < chain.size(); i++) {
            if (!keep[i]) {
                continue;
            }
            int[] hex = chain.get(i);
            if (placeWall(ctx, hex[0], hex[1], wallProps, fallback, rng)) {
                wallHexes++;
            }
            if (rng.nextInt(100) < thickPct) {
                int[] extra = thickNeighbor(ctx, hex[0], hex[1], clear, island, rng);
                if (extra != null && placeWall(ctx, extra[0], extra[1], wallProps, fallback, rng)) {
                    wallHexes++;
                }
            }
        }
        return wallHexes;
    }

    /**
     * Zones of at least {@code forceMin} hexes with no walled edge get their
     * longest eligible edge forced. Returns {@code {edges, wallHexes}}.
     */
    private static int[] forceLargeOpenZones(
            MapGenContext ctx,
            List<Border> borders,
            Set<Long> walledPairs,
            int forceMin,
            Random rng,
            int[] coverage,
            int[] gaps,
            int[] gapWidth,
            int thickPct,
            List<WorldProps.WallProp> wallProps,
            WorldProps.WallProp fallback,
            boolean[][] clear,
            boolean[][] island) {
        Map<Integer, Integer> size = new HashMap<>();
        for (int[] row : ctx.zoneIds) {
            for (int id : row) {
                if (id > 0) {
                    size.merge(id, 1, Integer::sum);
                }
            }
        }
        Set<Integer> hasWall = new HashSet<>();
        for (long key : walledPairs) {
            hasWall.add((int) (key >> 32));
            hasWall.add((int) key);
        }
        List<Integer> zones = new ArrayList<>();
        for (Map.Entry<Integer, Integer> entry : size.entrySet()) {
            if (entry.getValue() >= forceMin) {
                zones.add(entry.getKey());
            }
        }
        zones.sort(Integer::compareTo);
        int forced = 0;
        int wallHexes = 0;
        for (int zone : zones) {
            if (hasWall.contains(zone)) {
                continue;
            }
            Border best = null;
            for (Border border : borders) {
                if (border.zoneA() != zone && border.zoneB() != zone) {
                    continue;
                }
                if (walledPairs.contains(pairKey(border.zoneA(), border.zoneB()))) {
                    continue;
                }
                if (best == null
                        || border.hexes.size() > best.hexes.size()
                        || (border.hexes.size() == best.hexes.size()
                                && pairKey(border.zoneA(), border.zoneB())
                                        < pairKey(best.zoneA(), best.zoneB()))) {
                    best = border;
                }
            }
            if (best == null) {
                continue;
            }
            wallHexes +=
                    commitWall(
                            ctx, best, rng, coverage, gaps, gapWidth, thickPct, wallProps, fallback, clear, island);
            walledPairs.add(pairKey(best.zoneA(), best.zoneB()));
            hasWall.add(best.zoneA());
            hasWall.add(best.zoneB());
            forced++;
        }
        return new int[] {forced, wallHexes};
    }

    private static int countZones(int[][] zoneIds) {
        Set<Integer> ids = new HashSet<>();
        for (int[] row : zoneIds) {
            for (int id : row) {
                if (id > 0) {
                    ids.add(id);
                }
            }
        }
        return ids.size();
    }

    private static WorldProps.WallProp fallbackProp(
            MapGenContext ctx, List<WorldProps.WallProp> walls) {
        if (walls.isEmpty()) {
            return null;
        }
        String named = MapConfig.asString(MapConfig.mapCfg(ctx.data, "wall_fallback", ctx.sizeName()));
        if (named != null && !named.isBlank()) {
            String want = named.trim().toLowerCase();
            for (WorldProps.WallProp prop : walls) {
                if (prop.name() != null && prop.name().trim().toLowerCase().equals(want)) {
                    return prop;
                }
            }
        }
        return walls.get(0);
    }

    /** Terrain ids that never receive a wall prop. Defaults to Water, Shallow, Swamp. */
    private static Set<Integer> wallNoTerrain(MapGenContext ctx) {
        Set<Integer> out = new HashSet<>();
        Object raw = MapConfig.mapCfg(ctx.data, "wall_no_terrain", ctx.sizeName());
        if (raw instanceof List<?> list) {
            for (Object item : list) {
                Integer id = MapConfig.asInt(item);
                if (id != null) {
                    out.add(id);
                }
            }
        }
        if (out.isEmpty()) {
            out.add(3);
            out.add(20);
            out.add(21);
        }
        return out;
    }

    /** Matching wall row, or null when this terrain has none. */
    private static WorldProps.WallProp matchWallProp(List<WorldProps.WallProp> walls, int terrainId) {
        for (WorldProps.WallProp prop : walls) {
            if (prop.terrains().contains(terrainId)) {
                return prop;
            }
        }
        return null;
    }

    private static boolean land(MapGenContext ctx, int col, int row) {
        if (col < 0 || row < 0 || col >= ctx.width || row >= ctx.height) {
            return false;
        }
        HexTerrain t = ctx.cells[row][col];
        if (t == null) {
            return false;
        }
        // Impassable no-wall terrains are not land. Walkable entries in the
        // list (Shallow, Swamp) stay land and are rejected only as wall sites.
        return !(ctx.wallNoTerrain.contains(t.id()) && !t.isPassable());
    }

    /** Land components smaller than the largest are islands — never walled. */
    private static boolean[][] islandMask(MapGenContext ctx) {
        boolean[][] island = new boolean[ctx.height][ctx.width];
        boolean[][] seen = new boolean[ctx.height][ctx.width];
        List<List<int[]>> components = new ArrayList<>();
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (seen[row][col] || !land(ctx, col, row)) {
                    continue;
                }
                List<int[]> comp = new ArrayList<>();
                List<int[]> stack = new ArrayList<>();
                stack.add(new int[] {col, row});
                seen[row][col] = true;
                while (!stack.isEmpty()) {
                    int[] cur = stack.remove(stack.size() - 1);
                    comp.add(cur);
                    int q = HexCoords.qOf(cur[0], cur[1]);
                    for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                        int ncol = HexCoords.colOf(q + d[0], cur[1] + d[1]);
                        int nrow = cur[1] + d[1];
                        if (!land(ctx, ncol, nrow) || seen[nrow][ncol]) {
                            continue;
                        }
                        seen[nrow][ncol] = true;
                        stack.add(new int[] {ncol, nrow});
                    }
                }
                components.add(comp);
            }
        }
        int best = -1;
        int bestSize = -1;
        for (int i = 0; i < components.size(); i++) {
            if (components.get(i).size() > bestSize) {
                bestSize = components.get(i).size();
                best = i;
            }
        }
        for (int i = 0; i < components.size(); i++) {
            if (i == best) {
                continue;
            }
            for (int[] hex : components.get(i)) {
                island[hex[1]][hex[0]] = true;
            }
        }
        return island;
    }

    private static boolean[][] townClearance(MapGenContext ctx, int radius) {
        boolean[][] clear = new boolean[ctx.height][ctx.width];
        for (TownSite site : ctx.townSites) {
            int[][] anchors = {
                {site.col(), site.row()},
                {site.col() - 1, site.row()},
                {site.col() + 1, site.row()},
            };
            for (int[] anchor : anchors) {
                if (anchor[0] < 0 || anchor[0] >= ctx.width || anchor[1] < 0 || anchor[1] >= ctx.height) {
                    continue;
                }
                int aq = HexCoords.qOf(anchor[0], anchor[1]);
                int ar = anchor[1];
                for (int row = 0; row < ctx.height; row++) {
                    for (int col = 0; col < ctx.width; col++) {
                        int q = HexCoords.qOf(col, row);
                        if (HexCoords.hexDistance(q, row, aq, ar) <= radius) {
                            clear[row][col] = true;
                        }
                    }
                }
            }
        }
        return clear;
    }

    private record Border(int zoneA, int zoneB, List<int[]> hexes) {}

    private static List<Border> collectBorders(
            MapGenContext ctx, boolean[][] clear, boolean[][] island, int minChunk) {
        Map<Integer, Integer> size = new HashMap<>();
        for (int[] row : ctx.zoneIds) {
            for (int id : row) {
                if (id > 0) {
                    size.merge(id, 1, Integer::sum);
                }
            }
        }
        Map<Long, List<int[]>> byPair = new HashMap<>();
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (!wallable(ctx, col, row, clear, island)) {
                    continue;
                }
                int zone = ctx.zoneIds[row][col];
                if (zone <= 0) {
                    continue;
                }
                int q = HexCoords.qOf(col, row);
                for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                    int nrow = row + d[1];
                    int ncol = HexCoords.colOf(q + d[0], nrow);
                    if (!land(ctx, ncol, nrow) || island[nrow][ncol]) {
                        continue;
                    }
                    int other = ctx.zoneIds[nrow][ncol];
                    if (other <= 0 || other == zone) {
                        continue;
                    }
                    int sizeA = size.getOrDefault(zone, 0);
                    int sizeB = size.getOrDefault(other, 0);
                    if (sizeA < minChunk && sizeB < minChunk) {
                        continue;
                    }
                    int owner = sizeA > sizeB ? zone : sizeB > sizeA ? other : Math.min(zone, other);
                    if (zone != owner) {
                        continue;
                    }
                    int lo = Math.min(zone, other);
                    int hi = Math.max(zone, other);
                    long key = (((long) lo) << 32) ^ (hi & 0xffffffffL);
                    byPair.computeIfAbsent(key, k -> new ArrayList<>()).add(new int[] {col, row});
                }
            }
        }
        List<Border> out = new ArrayList<>();
        for (Map.Entry<Long, List<int[]>> entry : byPair.entrySet()) {
            int lo = (int) (entry.getKey() >> 32);
            int hi = (int) entry.getKey().longValue();
            int sizeLo = size.getOrDefault(lo, 0);
            int sizeHi = size.getOrDefault(hi, 0);
            int owner = sizeLo > sizeHi ? lo : sizeHi > sizeLo ? hi : lo;
            int other = owner == lo ? hi : lo;
            List<int[]> hexes = dedupe(entry.getValue());
            if (!hexes.isEmpty()) {
                out.add(new Border(owner, other, hexes));
            }
        }
        return out;
    }

    private static boolean wallable(
            MapGenContext ctx, int col, int row, boolean[][] clear, boolean[][] island) {
        if (!land(ctx, col, row) || island[row][col] || clear[row][col]) {
            return false;
        }
        HexTerrain t = ctx.cells[row][col];
        if (t == null || ctx.wallNoTerrain.contains(t.id()) || t.blocked() || !t.isPassable()) {
            return false;
        }
        if (ctx.townReserved != null && ctx.townReserved[row][col]) {
            return false;
        }
        return true;
    }

    private static List<int[]> dedupe(List<int[]> hexes) {
        Set<String> seen = new HashSet<>();
        List<int[]> out = new ArrayList<>();
        for (int[] hex : hexes) {
            String key = hex[0] + "," + hex[1];
            if (seen.add(key)) {
                out.add(hex);
            }
        }
        return out;
    }

    private static List<int[]> orderChain(List<int[]> hexes) {
        if (hexes.size() <= 2) {
            return hexes;
        }
        Set<String> keys = new HashSet<>();
        Map<String, int[]> byKey = new HashMap<>();
        for (int[] hex : hexes) {
            String key = hex[0] + "," + hex[1];
            keys.add(key);
            byKey.put(key, hex);
        }
        int[] start = hexes.get(0);
        int bestDeg = 99;
        for (int[] hex : hexes) {
            int deg = chainDegree(hex, keys);
            if (deg < bestDeg) {
                bestDeg = deg;
                start = hex;
            }
        }
        List<int[]> chain = new ArrayList<>();
        Set<String> used = new HashSet<>();
        int[] cur = start;
        while (cur != null) {
            chain.add(cur);
            used.add(cur[0] + "," + cur[1]);
            int[] next = null;
            int q = HexCoords.qOf(cur[0], cur[1]);
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int ncol = HexCoords.colOf(q + d[0], cur[1] + d[1]);
                int nrow = cur[1] + d[1];
                String nk = ncol + "," + nrow;
                if (keys.contains(nk) && !used.contains(nk)) {
                    next = byKey.get(nk);
                    break;
                }
            }
            cur = next;
        }
        for (int[] hex : hexes) {
            if (!used.contains(hex[0] + "," + hex[1])) {
                chain.add(hex);
            }
        }
        return chain;
    }

    private static int chainDegree(int[] hex, Set<String> keys) {
        int deg = 0;
        int q = HexCoords.qOf(hex[0], hex[1]);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int ncol = HexCoords.colOf(q + d[0], hex[1] + d[1]);
            if (keys.contains(ncol + "," + (hex[1] + d[1]))) {
                deg++;
            }
        }
        return deg;
    }

    /** True = wall. A contiguous coverage window along the chain. */
    private static boolean[] coverageMask(int n, int coveragePct, Random rng) {
        boolean[] keep = new boolean[n];
        if (n == 0) {
            return keep;
        }
        int len = Math.max(1, (int) Math.round(n * (coveragePct / 100.0)));
        len = Math.min(n, len);
        int start = n == len ? 0 : rng.nextInt(n - len + 1);
        for (int i = start; i < start + len; i++) {
            keep[i] = true;
        }
        return keep;
    }

    private static void punchGaps(
            List<int[]> chain, boolean[] keep, int gapCount, int width, Random rng, MapGenContext ctx) {
        List<Integer> walled = new ArrayList<>();
        for (int i = 0; i < keep.length; i++) {
            if (keep[i]) {
                walled.add(i);
            }
        }
        if (walled.size() < 2 || gapCount <= 0 || width <= 0) {
            return;
        }
        int placed = 0;
        int guard = 0;
        while (placed < gapCount && guard < gapCount * 8) {
            guard++;
            int origin = walled.get(rng.nextInt(walled.size()));
            int w = Math.min(width, Math.max(1, walled.size() / (gapCount + 1)));
            int opened = 0;
            for (int i = origin; i < keep.length && opened < w; i++) {
                if (!keep[i]) {
                    break;
                }
                keep[i] = false;
                ctx.wallGap[chain.get(i)[1]][chain.get(i)[0]] = true;
                opened++;
            }
            if (opened > 0) {
                placed++;
            }
        }
    }

    /** Every walled edge keeps at least one gap hex, even a one-hex edge. */
    private static void ensureOpening(List<int[]> chain, boolean[] keep, MapGenContext ctx) {
        for (int[] hex : chain) {
            if (ctx.wallGap[hex[1]][hex[0]]) {
                return;
            }
        }
        int chosen = -1;
        int walled = 0;
        for (int i = 0; i < keep.length; i++) {
            if (keep[i]) {
                walled++;
            }
        }
        int mid = Math.max(1, walled) / 2;
        int seen = 0;
        for (int i = 0; i < keep.length; i++) {
            if (!keep[i]) {
                continue;
            }
            seen++;
            if (seen >= mid) {
                chosen = i;
                break;
            }
        }
        if (chosen < 0 && chain.size() > 0) {
            chosen = chain.size() / 2;
            if (chosen < keep.length) {
                keep[chosen] = true;
            }
        }
        if (chosen >= 0 && chosen < chain.size()) {
            keep[chosen] = false;
            int[] hex = chain.get(chosen);
            ctx.wallGap[hex[1]][hex[0]] = true;
        }
    }

    /** Owner-side hexes record the neighbour zone so the overlay can colour the edge. */
    private static void markWalledEdge(MapGenContext ctx, Border border) {
        for (int[] hex : border.hexes) {
            int key = hex[1] * ctx.width + hex[0];
            List<Integer> beside = ctx.wallBeside.computeIfAbsent(key, k -> new ArrayList<>());
            if (!beside.contains(border.zoneB())) {
                beside.add(border.zoneB());
            }
        }
    }

    private static boolean placeWall(
            MapGenContext ctx,
            int col,
            int row,
            List<WorldProps.WallProp> walls,
            WorldProps.WallProp fallback,
            Random rng) {
        if (col < 0 || row < 0 || col >= ctx.width || row >= ctx.height) {
            return false;
        }
        if (ctx.propSeeds[row][col] != null || ctx.wallGap[row][col]) {
            return false;
        }
        HexTerrain terrain = ctx.cells[row][col];
        if (terrain == null || ctx.wallNoTerrain.contains(terrain.id()) || !terrain.isPassable()) {
            return false;
        }
        WorldProps.WallProp prop = matchWallProp(walls, terrain.id());
        if (prop == null) {
            prop = fallback;
        }
        if (prop == null) {
            return false;
        }
        int variant = 1 + rng.nextInt(Math.max(1, prop.variantCount()));
        ctx.propSeeds[row][col] = new WorldProps.Seed(prop.id(), variant, prop.fileName(), prop.blocker());
        ctx.propBlocked[row][col] = prop.blocker();
        return true;
    }

    private static int[] thickNeighbor(
            MapGenContext ctx, int col, int row, boolean[][] clear, boolean[][] island, Random rng) {
        List<int[]> options = new ArrayList<>();
        int q = HexCoords.qOf(col, row);
        int zone = ctx.zoneIds[row][col];
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nrow = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nrow);
            if (!wallable(ctx, ncol, nrow, clear, island)) {
                continue;
            }
            if (ctx.zoneIds[nrow][ncol] != zone) {
                continue;
            }
            if (ctx.propSeeds[nrow][ncol] != null) {
                continue;
            }
            options.add(new int[] {ncol, nrow});
        }
        if (options.isEmpty()) {
            return null;
        }
        return options.get(rng.nextInt(options.size()));
    }

    /**
     * On a walled edge, every hex that did not receive a wall prop is an opening
     * (punched gaps and uncovered stretches). Neighbours are included by
     * {@link FeatureRules#inGap}.
     */
    private static void markUncoveredGaps(MapGenContext ctx) {
        if (ctx.wallBeside == null || ctx.wallGap == null) {
            return;
        }
        for (int key : ctx.wallBeside.keySet()) {
            int col = key % ctx.width;
            int row = key / ctx.width;
            if (row < 0 || col < 0 || row >= ctx.height || col >= ctx.width) {
                continue;
            }
            WorldProps.Seed prop = ctx.propSeeds == null ? null : ctx.propSeeds[row][col];
            if (prop != null && prop.blocker()) {
                continue;
            }
            ctx.wallGap[row][col] = true;
        }
    }

    /**
     * Zones that share a land border must stay in one on-foot component.
     * If a wall splits them, open a gap on that border and log it.
     */
    private static int repairCuts(
            MapGenContext ctx, boolean[][] clear, boolean[][] island, int minChunk) {
        int repairs = 0;
        for (int attempt = 0; attempt < MapGenContext.LAYER_ATTEMPTS; attempt++) {
            int[] comp = components(ctx);
            Border cut = firstCut(ctx, comp, clear, island, minChunk);
            if (cut == null) {
                break;
            }
            int opened = 0;
            for (int[] hex : cut.hexes) {
                if (ctx.propBlocked != null && ctx.propBlocked[hex[1]][hex[0]]) {
                    ctx.propBlocked[hex[1]][hex[0]] = false;
                    ctx.propSeeds[hex[1]][hex[0]] = null;
                    ctx.wallGap[hex[1]][hex[0]] = true;
                    opened++;
                    if (opened >= 2) {
                        break;
                    }
                }
            }
            if (opened == 0) {
                break;
            }
            repairs++;
            MapGenPipeline.logRepair(
                    LAYER,
                    "opened gap x"
                            + opened
                            + " between zones "
                            + cut.zoneA
                            + " and "
                            + cut.zoneB);
        }
        return repairs;
    }

    /** Component id per hex; -1 if not on-foot walkable. */
    private static int[] components(MapGenContext ctx) {
        int[] comp = new int[ctx.height * ctx.width];
        java.util.Arrays.fill(comp, -1);
        int id = 0;
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                int idx = row * ctx.width + col;
                if (comp[idx] >= 0 || !onFoot(ctx, col, row)) {
                    continue;
                }
                List<int[]> stack = new ArrayList<>();
                stack.add(new int[] {col, row});
                comp[idx] = id;
                while (!stack.isEmpty()) {
                    int[] cur = stack.remove(stack.size() - 1);
                    int q = HexCoords.qOf(cur[0], cur[1]);
                    for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                        int nrow = cur[1] + d[1];
                        int ncol = HexCoords.colOf(q + d[0], nrow);
                        if (ncol < 0 || nrow < 0 || ncol >= ctx.width || nrow >= ctx.height) {
                            continue;
                        }
                        int nidx = nrow * ctx.width + ncol;
                        if (comp[nidx] >= 0 || !onFoot(ctx, ncol, nrow)) {
                            continue;
                        }
                        comp[nidx] = id;
                        stack.add(new int[] {ncol, nrow});
                    }
                }
                id++;
            }
        }
        return comp;
    }

    private static boolean onFoot(MapGenContext ctx, int col, int row) {
        if (!land(ctx, col, row)) {
            return false;
        }
        HexTerrain t = ctx.cells[row][col];
        if (!t.isPassable() || t.movementCost() == null) {
            return false;
        }
        if (ctx.propBlocked != null && ctx.propBlocked[row][col]) {
            return false;
        }
        for (TownSite site : ctx.townSites) {
            if (site.row() == row && site.keepCol() == col) {
                return false;
            }
        }
        return true;
    }

    private static Border firstCut(
            MapGenContext ctx, int[] comp, boolean[][] clear, boolean[][] island, int minChunk) {
        Map<Integer, Set<Integer>> compsByZone = new HashMap<>();
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                int c = comp[row * ctx.width + col];
                if (c < 0) {
                    continue;
                }
                int zone = ctx.zoneIds[row][col];
                if (zone > 0) {
                    compsByZone.computeIfAbsent(zone, k -> new HashSet<>()).add(c);
                }
            }
        }
        List<Border> borders = collectBorders(ctx, clear, island, minChunk);
        for (Border border : borders) {
            Set<Integer> a = compsByZone.getOrDefault(border.zoneA, Set.of());
            Set<Integer> b = compsByZone.getOrDefault(border.zoneB, Set.of());
            if (a.isEmpty() || b.isEmpty()) {
                continue;
            }
            boolean share = false;
            for (int id : a) {
                if (b.contains(id)) {
                    share = true;
                    break;
                }
            }
            if (!share) {
                return border;
            }
        }
        return null;
    }

    private static int clampPct(int value) {
        return Math.max(0, Math.min(100, value));
    }
}
