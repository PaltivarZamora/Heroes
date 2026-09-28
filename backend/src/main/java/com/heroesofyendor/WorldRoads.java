package com.heroesofyendor;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.PriorityQueue;
import java.util.Random;
import java.util.Set;

/**
 * Town interstate (BR S9-20), pipeline layer 4.
 *
 * <p>One chain of towns. Each town gets a straight drawbridge spur of
 * {@code road_spur_len} hexes. Links route spur-end to spur-end with A*,
 * preferring existing roads at {@code road_merge_cost}. Water-type terrains
 * in {@code road_no_terrain} cost {@code road_water_cost} while planning, then
 * are washed out along with the land hex beside them. Short road pieces that
 * do not contain a town spur are removed.
 *
 * <p>Removed from the seam-road era: terrain-seam placement, the old spur
 * search, orphan bridging, the double-ribbon resolver, and any path smoothing.
 * Kept: {@code hasRoad}, {@code roads_enabled}, and the movement-cost flag the
 * client already reads.
 */
final class WorldRoads {

    private static final double INF = Double.POSITIVE_INFINITY;

    private WorldRoads() {}

    static void run(MapGenContext ctx) {
        int spurLen = Math.max(1, MapConfig.cfgInt(ctx.data, "road_spur_len", ctx.sizeName(), 4));
        double mergeCost = MapConfig.cfgDouble(ctx.data, "road_merge_cost", ctx.sizeName(), 0.2);
        if (mergeCost <= 0) {
            mergeCost = 0.2;
        }
        double waterCost = MapConfig.cfgDouble(ctx.data, "road_water_cost", ctx.sizeName(), 4);
        if (waterCost <= 0) {
            waterCost = 4;
        }
        int minFragment = Math.max(1, MapConfig.cfgInt(ctx.data, "road_min_fragment", ctx.sizeName(), 6));
        Set<Integer> noTerrain = roadNoTerrain(ctx);
        Random rng = ctx.rngFor("roads");

        List<Town> towns = new ArrayList<>();
        for (TownSite site : ctx.townSites) {
            towns.add(new Town(towns.size(), site));
        }
        if (towns.isEmpty()) {
            MapGenPipeline.logCounts("roads", "towns=0");
            return;
        }

        int n = ctx.width * ctx.height;
        int[] spurTown = new int[n];
        Arrays.fill(spurTown, -1);
        boolean[] nearTown = new boolean[n];
        List<Town> chain = orderChain(towns, rng);
        int flipped = faceTowns(ctx, chain, spurLen, noTerrain);
        int shortSpurs = laySpurs(ctx, towns, spurLen, noTerrain, spurTown, nearTown);

        boolean[][] plain = copyGrid(ctx.hasRoad);
        int failedPlain =
                routeLinks(ctx, chain, plain, spurTown, nearTown, noTerrain, mergeCost, waterCost, false);
        int failed =
                routeLinks(ctx, chain, ctx.hasRoad, spurTown, nearTown, noTerrain, mergeCost, waterCost, true);
        int withMerge = count(ctx.hasRoad);
        int noMerge = count(plain);

        int[] wash = washout(ctx, towns, noTerrain);
        int afterWash = count(ctx.hasRoad);
        int[] orphan = trimOrphans(ctx, spurTown, minFragment);
        int finalRoads = count(ctx.hasRoad);
        StringBuilder names = new StringBuilder();
        for (int i = 0; i < chain.size(); i++) {
            if (i > 0) {
                names.append(" > ");
            }
            names.append(chain.get(i).name);
        }
        MapGenPipeline.logCounts(
                "roads",
                "towns="
                        + towns.size()
                        + " links="
                        + Math.max(0, chain.size() - 1)
                        + " failed="
                        + failed
                        + " failedNoMerge="
                        + failedPlain
                        + " shortSpurs="
                        + shortSpurs
                        + " roadHexes="
                        + withMerge
                        + " noMerge="
                        + noMerge
                        + " washed="
                        + wash[0]
                        + " spurExempt="
                        + wash[1]
                        + " flipped="
                        + flipped
                        + " orphan="
                        + orphan[0]
                        + " stubs="
                        + orphan[1]
                        + " beforeWash="
                        + withMerge
                        + " afterWash="
                        + afterWash
                        + " final="
                        + finalRoads
                        + " chain="
                        + names);
    }

    /** Straight spur along the drawbridge, {@code town.dir} +1 east or -1 west. */
    private static int laySpurs(
            MapGenContext ctx,
            List<Town> towns,
            int spurLen,
            Set<Integer> noTerrain,
            int[] spurTown,
            boolean[] nearTown) {
        int shortSpurs = 0;
        for (Town town : towns) {
            int q = town.entryQ;
            int r = town.entryR;
            for (int step = 0; step < spurLen; step++) {
                q += town.dir;
                int col = HexCoords.colOf(q, r);
                if (!spurHexOk(ctx, col, r, noTerrain, spurTown)) {
                    break;
                }
                int idx = r * ctx.width + col;
                spurTown[idx] = town.index;
                ctx.hasRoad[r][col] = true;
                town.spur.add(new int[] {q, r});
                town.endIdx = idx;
            }
            if (town.spur.size() < spurLen) {
                shortSpurs++;
            }
            town.anchorIdx = pickAnchor(ctx, town, noTerrain, spurTown);
            while (town.anchorIdx < 0 && !town.spur.isEmpty()) {
                int[] dropped = town.spur.remove(town.spur.size() - 1);
                int dropCol = HexCoords.colOf(dropped[0], dropped[1]);
                int dropRow = dropped[1];
                spurTown[dropRow * ctx.width + dropCol] = -1;
                ctx.hasRoad[dropRow][dropCol] = false;
                RoadLinks.clear(ctx, dropCol, dropRow);
                town.endIdx = town.spur.isEmpty()
                        ? -1
                        : indexOf(ctx, town.spur.get(town.spur.size() - 1));
                town.anchorIdx = pickAnchor(ctx, town, noTerrain, spurTown);
            }
            if (town.anchorIdx >= 0) {
                int col = town.anchorIdx % ctx.width;
                int row = town.anchorIdx / ctx.width;
                ctx.hasRoad[row][col] = true;
            }
        }
        stampSpurLinks(ctx, towns);
        if (ctx.townReserved != null) {
            for (int row = 0; row < ctx.height; row++) {
                for (int col = 0; col < ctx.width; col++) {
                    if (!ctx.townReserved[row][col]) {
                        continue;
                    }
                    int q = HexCoords.qOf(col, row);
                    for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                        int nr = row + d[1];
                        int ncol = HexCoords.colOf(q + d[0], nr);
                        if (ncol < 0 || nr < 0 || ncol >= ctx.width || nr >= ctx.height) {
                            continue;
                        }
                        int nidx = nr * ctx.width + ncol;
                        if (spurTown[nidx] >= 0 || ctx.townReserved[nr][ncol]) {
                            continue;
                        }
                        nearTown[nidx] = true;
                    }
                }
            }
        }
        return shortSpurs;
    }

    /** Spur steps and the spur-end anchor. Interstate links are stamped in {@link #route}. */
    private static void stampSpurLinks(MapGenContext ctx, List<Town> towns) {
        for (Town town : towns) {
            List<int[]> path = new ArrayList<>(town.spur.size() + 1);
            path.addAll(town.spur);
            if (town.anchorIdx >= 0) {
                int col = town.anchorIdx % ctx.width;
                int row = town.anchorIdx / ctx.width;
                int q = HexCoords.qOf(col, row);
                if (path.isEmpty()
                        || path.get(path.size() - 1)[0] != q
                        || path.get(path.size() - 1)[1] != row) {
                    path.add(new int[] {q, row});
                }
            }
            RoadLinks.connectPath(ctx, path);
        }
    }

    private static int indexOf(MapGenContext ctx, int[] axial) {
        int col = HexCoords.colOf(axial[0], axial[1]);
        return axial[1] * ctx.width + col;
    }

    private static boolean spurHexOk(
            MapGenContext ctx, int col, int row, Set<Integer> noTerrain, int[] spurTown) {
        if (col < 0 || row < 0 || col >= ctx.width || row >= ctx.height) {
            return false;
        }
        if (ctx.propBlocked != null && ctx.propBlocked[row][col]) {
            return false;
        }
        if (Pockets.seals(ctx, col, row)) {
            return false;
        }
        if (ctx.townReserved != null && ctx.townReserved[row][col]) {
            return false;
        }
        int idx = row * ctx.width + col;
        if (spurTown[idx] >= 0) {
            return false;
        }
        HexTerrain terrain = ctx.cells[row][col];
        if (terrain == null) {
            return false;
        }
        if (noTerrain.contains(terrain.id())) {
            return true;
        }
        return !terrain.blocked();
    }

    /**
     * Hex just past the spur end, where links are allowed to meet. Straight
     * ahead first; if that hex is blocked, any other exit off the end.
     */
    private static int pickAnchor(
            MapGenContext ctx, Town town, Set<Integer> noTerrain, int[] spurTown) {
        if (town.spur.isEmpty() || town.endIdx < 0) {
            return -1;
        }
        int[] end = town.spur.get(town.spur.size() - 1);
        int straight = HexCoords.colOf(end[0] + town.dir, end[1]);
        int straightRow = end[1];
        if (anchorOk(ctx, straight, straightRow, noTerrain, spurTown, town.endIdx, false)) {
            return straightRow * ctx.width + straight;
        }
        int endCol = town.endIdx % ctx.width;
        int endRow = town.endIdx / ctx.width;
        int eq = HexCoords.qOf(endCol, endRow);
        int relaxed = -1;
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nrow = endRow + d[1];
            int ncol = HexCoords.colOf(eq + d[0], nrow);
            if (anchorOk(ctx, ncol, nrow, noTerrain, spurTown, town.endIdx, false)) {
                return nrow * ctx.width + ncol;
            }
            if (relaxed < 0 && anchorOk(ctx, ncol, nrow, noTerrain, spurTown, town.endIdx, true)) {
                relaxed = nrow * ctx.width + ncol;
            }
        }
        return relaxed;
    }

    private static boolean anchorOk(
            MapGenContext ctx,
            int col,
            int row,
            Set<Integer> noTerrain,
            int[] spurTown,
            int endIdx,
            boolean allowBodyTouch) {
        if (!spurHexOk(ctx, col, row, noTerrain, spurTown)) {
            return false;
        }
        if (allowBodyTouch) {
            return true;
        }
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nrow = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nrow);
            if (ncol < 0 || nrow < 0 || ncol >= ctx.width || nrow >= ctx.height) {
                continue;
            }
            int nidx = nrow * ctx.width + ncol;
            if (nidx == endIdx) {
                continue;
            }
            if (spurTown[nidx] >= 0) {
                return false;
            }
        }
        return true;
    }

    /** Random starting town, then nearest unused town until every town is in. */
    private static List<Town> orderChain(List<Town> towns, Random rng) {
        List<Town> pool = new ArrayList<>(towns);
        List<Town> starts = new ArrayList<>();
        for (Town town : pool) {
            if (town.starting) {
                starts.add(town);
            }
        }
        List<Town> pickFrom = starts.isEmpty() ? pool : starts;
        Town cur = pickFrom.get(rng.nextInt(pickFrom.size()));
        List<Town> chain = new ArrayList<>();
        chain.add(cur);
        pool.remove(cur);
        while (!pool.isEmpty()) {
            Town next = null;
            int best = Integer.MAX_VALUE;
            for (Town town : pool) {
                int dist = HexCoords.hexDistance(cur.entryQ, cur.entryR, town.entryQ, town.entryR);
                if (next == null
                        || dist < best
                        || (dist == best && (town.entryQ < next.entryQ
                                || (town.entryQ == next.entryQ && town.entryR < next.entryR)))) {
                    best = dist;
                    next = town;
                }
            }
            chain.add(next);
            pool.remove(next);
            cur = next;
        }
        return chain;
    }

    /**
     * Turn each drawbridge toward the chain neighbour. Middle towns use the
     * average of both neighbours. A side without a clear spur run is not used.
     */
    private static int faceTowns(
            MapGenContext ctx, List<Town> chain, int spurLen, Set<Integer> noTerrain) {
        int room = spurLen + 1;
        int[] baseQ = new int[chain.size()];
        for (int i = 0; i < chain.size(); i++) {
            baseQ[i] = chain.get(i).entryQ;
        }
        int flipped = 0;
        for (int i = 0; i < chain.size(); i++) {
            Town town = chain.get(i);
            double dq = 0;
            if (i > 0) {
                dq += baseQ[i - 1] - baseQ[i];
            }
            if (i + 1 < chain.size()) {
                dq += baseQ[i + 1] - baseQ[i];
            }
            int want = dq < 0 ? -1 : 1;
            boolean right = corridor(ctx, town.entryCol, town.entryR, 1, room, noTerrain);
            boolean left = corridor(ctx, town.entryCol - 1, town.entryR, -1, room, noTerrain);
            int dir = want;
            if (dir > 0 && !right && left) {
                dir = -1;
            } else if (dir < 0 && !left && right) {
                dir = 1;
            }
            town.dir = dir;
            if (dir > 0) {
                continue;
            }
            int newCol = town.entryCol - 1;
            if (newCol < 0) {
                town.dir = 1;
                continue;
            }
            TownSite old = ctx.townSites.get(town.siteIndex);
            ctx.townSites.set(
                    town.siteIndex,
                    new TownSite(
                            newCol,
                            old.row(),
                            old.name(),
                            old.townTypeId(),
                            old.starting(),
                            old.playerIndex(),
                            true));
            town.entryCol = newCol;
            town.entryQ = HexCoords.qOf(newCol, town.entryR);
            flipped++;
        }
        return flipped;
    }

    private static boolean corridor(
            MapGenContext ctx, int startCol, int row, int dir, int len, Set<Integer> noTerrain) {
        if (startCol < 0 || startCol >= ctx.width || row < 0 || row >= ctx.height) {
            return false;
        }
        for (int step = 1; step <= len; step++) {
            int col = startCol + dir * step;
            if (col < 0 || col >= ctx.width) {
                return false;
            }
            HexTerrain terrain = ctx.cells[row][col];
            if (terrain == null || noTerrain.contains(terrain.id()) || terrain.blocked()) {
                return false;
            }
        }
        return true;
    }

    /** Drop connected road pieces shorter than {@code minFragment} with no town spur. */
    private static int[] trimOrphans(MapGenContext ctx, int[] spurTown, int minFragment) {
        boolean[][] seen = new boolean[ctx.height][ctx.width];
        int removed = 0;
        int[] compSize = new int[ctx.width * ctx.height];
        int[] compId = new int[ctx.width * ctx.height];
        Arrays.fill(compId, -1);
        int nextId = 0;
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (!ctx.hasRoad[row][col] || seen[row][col]) {
                    continue;
                }
                List<int[]> comp = new ArrayList<>();
                List<int[]> stack = new ArrayList<>();
                stack.add(new int[] {col, row});
                seen[row][col] = true;
                boolean hasSpur = false;
                while (!stack.isEmpty()) {
                    int[] cur = stack.remove(stack.size() - 1);
                    comp.add(cur);
                    int idx = cur[1] * ctx.width + cur[0];
                    if (spurTown[idx] >= 0) {
                        hasSpur = true;
                    }
                    int q = HexCoords.qOf(cur[0], cur[1]);
                    for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                        int nrow = cur[1] + d[1];
                        int ncol = HexCoords.colOf(q + d[0], nrow);
                        if (ncol < 0 || nrow < 0 || ncol >= ctx.width || nrow >= ctx.height) {
                            continue;
                        }
                        if (seen[nrow][ncol] || !ctx.hasRoad[nrow][ncol]) {
                            continue;
                        }
                        seen[nrow][ncol] = true;
                        stack.add(new int[] {ncol, nrow});
                    }
                }
                int id = nextId++;
                for (int[] hex : comp) {
                    int idx = hex[1] * ctx.width + hex[0];
                    compId[idx] = id;
                    compSize[idx] = comp.size();
                }
                if (!hasSpur && comp.size() < minFragment) {
                    for (int[] hex : comp) {
                        ctx.hasRoad[hex[1]][hex[0]] = false;
                        RoadLinks.clear(ctx, hex[0], hex[1]);
                        ctx.roadDebugOrphans.add(new int[] {HexCoords.qOf(hex[0], hex[1]), hex[1]});
                    }
                    removed += comp.size();
                }
            }
        }
        Set<Integer> stubTowns = new HashSet<>();
        for (int idx = 0; idx < spurTown.length; idx++) {
            if (spurTown[idx] < 0) {
                continue;
            }
            int col = idx % ctx.width;
            int row = idx / ctx.width;
            if (!ctx.hasRoad[row][col]) {
                continue;
            }
            if (compSize[idx] >= minFragment) {
                continue;
            }
            stubTowns.add(spurTown[idx]);
        }
        return new int[] {removed, stubTowns.size()};
    }

    private static int routeLinks(
            MapGenContext ctx,
            List<Town> chain,
            boolean[][] roads,
            int[] spurTown,
            boolean[] nearTown,
            Set<Integer> noTerrain,
            double mergeCost,
            double waterCost,
            boolean useMerge) {
        int failed = 0;
        for (int i = 0; i < chain.size() - 1; i++) {
            Town a = chain.get(i);
            Town b = chain.get(i + 1);
            if (a.anchorIdx < 0 || b.anchorIdx < 0) {
                failed++;
                if (useMerge) {
                    ctx.roadDebugLinks.add(
                            new MapGenContext.RoadDebugLink(a.name, b.name, linkPolyline(ctx, a, b, List.of())));
                }
                continue;
            }
            List<int[]> routed = useMerge ? new ArrayList<>() : null;
            if (!route(
                            ctx,
                            roads,
                            spurTown,
                            nearTown,
                            noTerrain,
                            mergeCost,
                            waterCost,
                            useMerge,
                            a.anchorIdx,
                            b.anchorIdx,
                            false,
                            routed)
                    && !route(
                            ctx,
                            roads,
                            spurTown,
                            nearTown,
                            noTerrain,
                            mergeCost,
                            waterCost,
                            useMerge,
                            a.anchorIdx,
                            b.anchorIdx,
                            true,
                            routed)) {
                failed++;
                if (routed != null) {
                    routed.clear();
                }
                if (useMerge) {
                    MapGenPipeline.logCounts("roads", "unreached " + a.name + " > " + b.name);
                }
            }
            if (useMerge) {
                ctx.roadDebugLinks.add(
                        new MapGenContext.RoadDebugLink(
                                a.name, b.name, linkPolyline(ctx, a, b, routed == null ? List.of() : routed)));
            }
        }
        return failed;
    }

    private static boolean route(
            MapGenContext ctx,
            boolean[][] roads,
            int[] spurTown,
            boolean[] nearTown,
            Set<Integer> noTerrain,
            double mergeCost,
            double waterCost,
            boolean useMerge,
            int start,
            int goal,
            boolean relax,
            List<int[]> pathOut) {
        if (start == goal) {
            return true;
        }
        int n = ctx.width * ctx.height;
        double[] gScore = new double[n];
        Arrays.fill(gScore, INF);
        int[] came = new int[n];
        Arrays.fill(came, -1);
        boolean[] closed = new boolean[n];
        gScore[start] = 0;
        double hScale = useMerge ? Math.min(mergeCost, 0.5) : 0.5;
        PriorityQueue<Node> open =
                new PriorityQueue<>(Comparator.comparingDouble((Node node) -> node.f).thenComparingLong(node -> node.seq));
        long seq = 0;
        open.add(new Node(start, hScale * hexDistIdx(ctx, start, goal), seq++));
        boolean found = false;
        while (!open.isEmpty()) {
            Node cur = open.poll();
            if (closed[cur.idx]) {
                continue;
            }
            closed[cur.idx] = true;
            if (cur.idx == goal) {
                found = true;
                break;
            }
            int col = cur.idx % ctx.width;
            int row = cur.idx / ctx.width;
            int q = HexCoords.qOf(col, row);
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nrow = row + d[1];
                int ncol = HexCoords.colOf(q + d[0], nrow);
                if (ncol < 0 || nrow < 0 || ncol >= ctx.width || nrow >= ctx.height) {
                    continue;
                }
                int nidx = nrow * ctx.width + ncol;
                if (nidx != goal
                        && blocked(ctx, ncol, nrow, nidx, spurTown, nearTown, noTerrain, start, goal, relax)) {
                    continue;
                }
                double step = stepCost(ctx, roads, ncol, nrow, noTerrain, mergeCost, waterCost, useMerge);
                double next = gScore[cur.idx] + step;
                if (next + 1e-9 >= gScore[nidx]) {
                    continue;
                }
                gScore[nidx] = next;
                came[nidx] = cur.idx;
                double f = next + hScale * hexDistIdx(ctx, nidx, goal);
                open.add(new Node(nidx, f, seq++));
            }
        }
        if (!found) {
            return false;
        }
        int walk = goal;
        List<int[]> rev = pathOut == null ? null : new ArrayList<>();
        while (walk >= 0) {
            int col = walk % ctx.width;
            int row = walk / ctx.width;
            roads[row][col] = true;
            if (rev != null) {
                rev.add(new int[] {HexCoords.qOf(col, row), row});
            }
            if (walk == start) {
                break;
            }
            walk = came[walk];
        }
        if (rev != null) {
            for (int i = rev.size() - 1; i >= 0; i--) {
                pathOut.add(rev.get(i));
            }
            if (roads == ctx.hasRoad) {
                RoadLinks.connectPath(ctx, pathOut);
            }
        }
        return true;
    }

    /** Town entry, its spur, the routed join, the other spur, and the other entry. */
    private static List<int[]> linkPolyline(MapGenContext ctx, Town a, Town b, List<int[]> routed) {
        List<int[]> path = new ArrayList<>();
        appendHex(path, a.entryQ, a.entryR);
        for (int[] hex : a.spur) {
            appendHex(path, hex[0], hex[1]);
        }
        appendIdx(ctx, path, a.anchorIdx);
        for (int[] hex : routed) {
            appendHex(path, hex[0], hex[1]);
        }
        appendIdx(ctx, path, b.anchorIdx);
        for (int i = b.spur.size() - 1; i >= 0; i--) {
            int[] hex = b.spur.get(i);
            appendHex(path, hex[0], hex[1]);
        }
        appendHex(path, b.entryQ, b.entryR);
        return path;
    }

    private static void appendIdx(MapGenContext ctx, List<int[]> path, int idx) {
        if (idx < 0) {
            return;
        }
        int col = idx % ctx.width;
        int row = idx / ctx.width;
        appendHex(path, HexCoords.qOf(col, row), row);
    }

    private static void appendHex(List<int[]> path, int q, int r) {
        if (!path.isEmpty()) {
            int[] last = path.get(path.size() - 1);
            if (last[0] == q && last[1] == r) {
                return;
            }
        }
        path.add(new int[] {q, r});
    }

    private static boolean blocked(
            MapGenContext ctx,
            int col,
            int row,
            int idx,
            int[] spurTown,
            boolean[] nearTown,
            Set<Integer> noTerrain,
            int start,
            int goal,
            boolean relax) {
        if (ctx.propBlocked != null && ctx.propBlocked[row][col]) {
            return true;
        }
        if (Pockets.seals(ctx, col, row)) {
            return true;
        }
        if (ctx.townReserved != null && ctx.townReserved[row][col]) {
            return true;
        }
        if (spurTown[idx] >= 0) {
            return true;
        }
        if (nearTown[idx]) {
            return true;
        }
        if (!relax && touchesSpurBody(ctx, col, row, spurTown, start, goal)) {
            return true;
        }
        HexTerrain terrain = ctx.cells[row][col];
        if (terrain == null) {
            return true;
        }
        if (noTerrain.contains(terrain.id())) {
            return false;
        }
        return terrain.blocked();
    }

    /** A hex beside a spur, other than the two link ends, would fork the spur early. */
    private static boolean touchesSpurBody(
            MapGenContext ctx, int col, int row, int[] spurTown, int start, int goal) {
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nrow = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nrow);
            if (ncol < 0 || nrow < 0 || ncol >= ctx.width || nrow >= ctx.height) {
                continue;
            }
            int nidx = nrow * ctx.width + ncol;
            if (nidx == start || nidx == goal) {
                continue;
            }
            if (spurTown[nidx] >= 0) {
                return true;
            }
        }
        return false;
    }

    private static double stepCost(
            MapGenContext ctx,
            boolean[][] roads,
            int col,
            int row,
            Set<Integer> noTerrain,
            double mergeCost,
            double waterCost,
            boolean useMerge) {
        if (useMerge && roads[row][col]) {
            return mergeCost;
        }
        HexTerrain terrain = ctx.cells[row][col];
        if (terrain != null && noTerrain.contains(terrain.id())) {
            return waterCost;
        }
        if (terrain == null) {
            return 1.0;
        }
        Double cost = terrain.movementCost();
        if (cost == null || cost <= 0) {
            return 1.0;
        }
        return cost;
    }

    /**
     * Drop roads on {@code road_no_terrain} and on the land hex beside them.
     * If that would disconnect a town, keep its entry-side spur hex.
     *
     * @return {@code [removed, exemptions]}
     */
    private static int[] washout(MapGenContext ctx, List<Town> towns, Set<Integer> noTerrain) {
        boolean[][] drop = new boolean[ctx.height][ctx.width];
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (!ctx.hasRoad[row][col]) {
                    continue;
                }
                if (washHex(ctx, col, row, noTerrain)) {
                    drop[row][col] = true;
                }
            }
        }
        int exempt = 0;
        for (Town town : towns) {
            if (town.spur.isEmpty()) {
                continue;
            }
            int[] first = town.spur.get(0);
            int col = HexCoords.colOf(first[0], first[1]);
            int row = first[1];
            if (col < 0 || row < 0 || col >= ctx.width || row >= ctx.height) {
                continue;
            }
            if (!drop[row][col]) {
                continue;
            }
            drop[row][col] = false;
            exempt++;
        }
        int removed = 0;
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (drop[row][col]) {
                    ctx.hasRoad[row][col] = false;
                    RoadLinks.clear(ctx, col, row);
                    ctx.roadDebugWashed.add(new int[] {HexCoords.qOf(col, row), row});
                    removed++;
                }
                if (ctx.townReserved != null && ctx.townReserved[row][col]) {
                    ctx.hasRoad[row][col] = false;
                    RoadLinks.clear(ctx, col, row);
                }
            }
        }
        return new int[] {removed, exempt};
    }

    private static boolean washHex(MapGenContext ctx, int col, int row, Set<Integer> noTerrain) {
        HexTerrain terrain = ctx.cells[row][col];
        if (terrain != null && noTerrain.contains(terrain.id())) {
            return true;
        }
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nrow = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nrow);
            if (ncol < 0 || nrow < 0 || ncol >= ctx.width || nrow >= ctx.height) {
                continue;
            }
            HexTerrain neighbor = ctx.cells[nrow][ncol];
            if (neighbor != null && noTerrain.contains(neighbor.id())) {
                return true;
            }
        }
        return false;
    }

    private static Set<Integer> roadNoTerrain(MapGenContext ctx) {
        Set<Integer> out = new HashSet<>();
        Object raw = MapConfig.mapCfg(ctx.data, "road_no_terrain", ctx.sizeName());
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

    private static int count(boolean[][] roads) {
        int n = 0;
        for (boolean[] row : roads) {
            for (boolean hex : row) {
                if (hex) {
                    n++;
                }
            }
        }
        return n;
    }

    private static boolean[][] copyGrid(boolean[][] src) {
        boolean[][] out = new boolean[src.length][];
        for (int i = 0; i < src.length; i++) {
            out[i] = Arrays.copyOf(src[i], src[i].length);
        }
        return out;
    }

    private static int hexDistIdx(MapGenContext ctx, int a, int b) {
        int ac = a % ctx.width;
        int ar = a / ctx.width;
        int bc = b % ctx.width;
        int br = b / ctx.width;
        return HexCoords.hexDistance(HexCoords.qOf(ac, ar), ar, HexCoords.qOf(bc, br), br);
    }

    private record Node(int idx, double f, long seq) {}

    private static final class Town {
        final int siteIndex;
        final int index;
        final String name;
        final boolean starting;
        int entryCol;
        int entryQ;
        final int entryR;
        /** +1 east, -1 west. */
        int dir = 1;
        final List<int[]> spur = new ArrayList<>();
        int endIdx = -1;
        /** First hex past the spur. Links meet here, not on the spur itself. */
        int anchorIdx = -1;

        Town(int index, TownSite site) {
            this.siteIndex = index;
            this.index = index;
            String label = site.name();
            this.name = label == null || label.isBlank() ? ("town" + index) : label.trim();
            this.starting = site.starting();
            this.entryCol = site.col();
            this.entryQ = HexCoords.qOf(site.col(), site.row());
            this.entryR = site.row();
        }
    }
}
