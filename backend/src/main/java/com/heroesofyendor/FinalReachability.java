package com.heroesofyendor;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.Set;

/**
 * Final global reachability check (BR S9-18 §3). Flood-fill on foot from every
 * starting town; carve blocker props or relocate/skip unreachable non-starts.
 */
final class FinalReachability {

    private static final String LAYER = "final";

    private FinalReachability() {}

    static void run(MapGenContext ctx) {
        if (ctx.townSites.isEmpty()) {
            MapGenPipeline.logCounts(LAYER, "no towns");
            return;
        }
        buildReachIndexes(ctx);
        int carves = 0;
        int relocations = 0;
        int skipped = 0;

        Set<String> reachable = floodFromStarts(ctx);
        List<TownSite> starts = startingTowns(ctx.townSites);
        List<TownSite> toFix = new ArrayList<>();
        for (TownSite site : ctx.townSites) {
            String key = entryKey(site);
            if (!reachable.contains(key)) {
                toFix.add(site);
            }
        }

        for (TownSite site : new ArrayList<>(toFix)) {
            if (site.starting()) {
                // Try carve toward nearest other start / reachable land.
                if (carveTowardReachable(ctx, site, reachable)) {
                    carves++;
                    reachable = floodFromStarts(ctx);
                    MapGenPipeline.logRepair(
                            LAYER,
                            "carved path to starting town @"
                                    + site.col()
                                    + ","
                                    + site.row());
                } else {
                    MapGenPipeline.logRepair(
                            LAYER,
                            "could not carve to starting town @"
                                    + site.col()
                                    + ","
                                    + site.row()
                                    + " (terrain wall)");
                }
                continue;
            }
            if (carveTowardReachable(ctx, site, reachable)) {
                carves++;
                reachable = floodFromStarts(ctx);
                MapGenPipeline.logRepair(
                        LAYER,
                        "carved path to town @" + site.col() + "," + site.row());
                continue;
            }
            // Terrain-only separation — relocate non-start, else skip.
            TownSite moved = relocateTown(ctx, site, reachable);
            if (moved != null) {
                relocations++;
                replaceSite(ctx, site, moved);
                reachable = floodFromStarts(ctx);
                MapGenPipeline.logRepair(
                        LAYER,
                        "relocated town type="
                                + site.townTypeId()
                                + " from "
                                + site.col()
                                + ","
                                + site.row()
                                + " to "
                                + moved.col()
                                + ","
                                + moved.row());
            } else {
                skipped++;
                removeTown(ctx, site);
                MapGenPipeline.logRepair(
                        LAYER,
                        "skipped unreachable town type="
                                + site.townTypeId()
                                + " @"
                                + site.col()
                                + ","
                                + site.row());
            }
        }

        // Ensure starts are mutually connected via carves if needed.
        reachable = floodFromStarts(ctx);
        for (TownSite a : starts) {
            if (!ctx.townSites.contains(a) && !containsSite(ctx.townSites, a)) {
                continue;
            }
            if (!reachable.contains(entryKey(a))) {
                if (carveTowardReachable(ctx, a, reachable)) {
                    carves++;
                    reachable = floodFromStarts(ctx);
                }
            }
        }

        int[] repair = repairWorld(ctx);
        reachable = floodFromStarts(ctx);

        MapGenPipeline.logCounts(
                LAYER,
                "towns="
                        + ctx.townSites.size()
                        + " carves="
                        + carves
                        + " relocations="
                        + relocations
                        + " skipped="
                        + skipped
                        + " reachableHexes="
                        + reachable.size()
                        + " propsRemoved="
                        + repair[0]
                        + " featuresRelocated="
                        + repair[1]
                        + " featuresRemoved="
                        + repair[2]
                        + " wallsRemoved="
                        + repair[3]);
        MapGenTimings.current()
                .layerDetail(
                        "L7",
                        "repairPasses="
                                + repair[4]
                                + " props="
                                + repair[0]
                                + " featMove="
                                + repair[1]
                                + " featDrop="
                                + repair[2]
                                + " walls="
                                + repair[3]);
        ctx.reachKeepBlocked = null;
        ctx.reachFeatureAt = null;
    }

    private static void buildReachIndexes(MapGenContext ctx) {
        ctx.reachKeepBlocked = new boolean[ctx.height][ctx.width];
        for (TownSite site : ctx.townSites) {
            int keepCol = site.keepCol();
            int row = site.row();
            if (keepCol >= 0 && row >= 0 && keepCol < ctx.width && row < ctx.height) {
                ctx.reachKeepBlocked[row][keepCol] = true;
            }
        }
        rebuildFeatureIndex(ctx);
    }

    private static void rebuildFeatureIndex(MapGenContext ctx) {
        ctx.reachFeatureAt = new MapObjectData[ctx.height][ctx.width];
        if (ctx.objects == null) {
            return;
        }
        for (MapObjectData obj : ctx.objects) {
            if ("town".equals(obj.kind())) {
                continue;
            }
            int col = HexCoords.colOf(obj.q(), obj.r());
            int row = obj.r();
            if (col >= 0 && row >= 0 && col < ctx.width && row < ctx.height) {
                ctx.reachFeatureAt[row][col] = obj;
            }
        }
    }

    /** Grow {@code reached} across newly opened hexes without a full-map flood. */
    private static void expandReachable(
            MapGenContext ctx, Set<String> reached, List<int[]> seeds) {
        if (seeds == null || seeds.isEmpty()) {
            return;
        }
        Queue<int[]> q = new ArrayDeque<>();
        for (int[] hex : seeds) {
            int col = hex[0];
            int row = hex[1];
            if (!walkable(ctx, col, row)) {
                continue;
            }
            String key = HexCoords.key(HexCoords.qOf(col, row), row);
            if (reached.add(key)) {
                q.add(new int[] {col, row});
            }
        }
        while (!q.isEmpty()) {
            int[] cur = q.poll();
            int cq = HexCoords.qOf(cur[0], cur[1]);
            int cr = cur[1];
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nq = cq + d[0];
                int nr = cr + d[1];
                int ncol = HexCoords.colOf(nq, nr);
                if (!walkable(ctx, ncol, nr)) {
                    continue;
                }
                String nk = HexCoords.key(nq, nr);
                if (reached.add(nk)) {
                    q.add(new int[] {ncol, nr});
                }
            }
        }
    }

    private static boolean containsSite(List<TownSite> sites, TownSite want) {
        for (TownSite s : sites) {
            if (s.col() == want.col() && s.row() == want.row()) {
                return true;
            }
        }
        return false;
    }

    private static List<TownSite> startingTowns(List<TownSite> sites) {
        List<TownSite> out = new ArrayList<>();
        for (TownSite s : sites) {
            if (s.starting()) {
                out.add(s);
            }
        }
        return out;
    }

    private static String entryKey(TownSite site) {
        int q = HexCoords.qOf(site.col(), site.row());
        return HexCoords.key(q, site.row());
    }

    /** On-foot walkable: passable terrain, no blocker prop, not town keep. */
    private static boolean walkable(MapGenContext ctx, int col, int row) {
        if (col < 0 || row < 0 || col >= ctx.width || row >= ctx.height) {
            return false;
        }
        HexTerrain t = ctx.cells[row][col];
        if (!t.isPassable() || t.movementCost() == null) {
            return false;
        }
        if (ctx.propBlocked != null && ctx.propBlocked[row][col]) {
            return false;
        }
        if (featureAt(ctx, col, row) != null) {
            return false;
        }
        return ctx.reachKeepBlocked == null || !ctx.reachKeepBlocked[row][col];
    }

    /** Walkable ignoring props (for carve planning). */
    private static boolean walkableIgnoreProps(MapGenContext ctx, int col, int row) {
        if (col < 0 || row < 0 || col >= ctx.width || row >= ctx.height) {
            return false;
        }
        HexTerrain t = ctx.cells[row][col];
        if (!t.isPassable() || t.movementCost() == null) {
            return false;
        }
        if (ctx.pocketRing != null && ctx.pocketRing[row][col]) {
            return false;
        }
        return ctx.reachKeepBlocked == null || !ctx.reachKeepBlocked[row][col];
    }

    private static Set<String> floodFromStarts(MapGenContext ctx) {
        Set<String> seen = new HashSet<>();
        Queue<int[]> q = new ArrayDeque<>();
        for (TownSite site : ctx.townSites) {
            if (!site.starting()) {
                continue;
            }
            // Entry hex is always a seed (even if keep blocks left).
            int col = site.col();
            int row = site.row();
            String key = HexCoords.key(HexCoords.qOf(col, row), row);
            if (seen.add(key)) {
                q.add(new int[] {col, row});
            }
            // Front hex if walkable
            if (walkable(ctx, col + 1, row)) {
                String fk = HexCoords.key(HexCoords.qOf(col + 1, row), row);
                if (seen.add(fk)) {
                    q.add(new int[] {col + 1, row});
                }
            }
        }
        while (!q.isEmpty()) {
            int[] cur = q.poll();
            int cq = HexCoords.qOf(cur[0], cur[1]);
            int cr = cur[1];
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nq = cq + d[0];
                int nr = cr + d[1];
                int ncol = HexCoords.colOf(nq, nr);
                if (!walkable(ctx, ncol, nr)) {
                    continue;
                }
                String nk = HexCoords.key(nq, nr);
                if (seen.add(nk)) {
                    q.add(new int[] {ncol, nr});
                }
            }
        }
        return seen;
    }

    /**
     * Shortest route ignoring props from town entry to any currently reachable
     * hex; clear blocker props along the path.
     */
    private static boolean carveTowardReachable(
            MapGenContext ctx, TownSite site, Set<String> reachable) {
        int startCol = site.col();
        int startRow = site.row();
        // BFS ignoring props
        Queue<int[]> q = new ArrayDeque<>();
        Map<String, String> parent = new HashMap<>();
        String startKey = HexCoords.colRowKey(startCol, startRow);
        q.add(new int[] {startCol, startRow});
        parent.put(startKey, null);
        String goalKey = null;
        while (!q.isEmpty()) {
            int[] cur = q.poll();
            int cq = HexCoords.qOf(cur[0], cur[1]);
            int cr = cur[1];
            String axial = HexCoords.key(cq, cr);
            if (reachable.contains(axial) && !(cur[0] == startCol && cur[1] == startRow)) {
                goalKey = HexCoords.colRowKey(cur[0], cur[1]);
                break;
            }
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nq = cq + d[0];
                int nr = cr + d[1];
                int ncol = HexCoords.colOf(nq, nr);
                if (!walkableIgnoreProps(ctx, ncol, nr)) {
                    continue;
                }
                String ck = HexCoords.colRowKey(ncol, nr);
                if (parent.containsKey(ck)) {
                    continue;
                }
                parent.put(ck, HexCoords.colRowKey(cur[0], cur[1]));
                q.add(new int[] {ncol, nr});
            }
        }
        if (goalKey == null) {
            return false;
        }
        // Walk path back; clear props.
        boolean cleared = false;
        String cur = goalKey;
        while (cur != null) {
            String[] parts = cur.split(",");
            int col = Integer.parseInt(parts[0]);
            int row = Integer.parseInt(parts[1]);
            if (ctx.propBlocked != null && ctx.propBlocked[row][col]) {
                if (ctx.pocketRing != null && ctx.pocketRing[row][col]) {
                    cur = parent.get(cur);
                    continue;
                }
                ctx.propBlocked[row][col] = false;
                if (ctx.propSeeds != null) {
                    ctx.propSeeds[row][col] = null;
                }
                cleared = true;
            }
            cur = parent.get(cur);
        }
        return cleared || reachable.contains(entryKey(site));
    }

    private static TownSite relocateTown(
            MapGenContext ctx, TownSite old, Set<String> reachable) {
        int inset = Math.max(0, MapConfig.cfgInt(ctx.data, "town_edge_inset", ctx.sizeName(), 2));
        Set<Integer> noTerrain = new HashSet<>();
        Object raw = MapConfig.raw(ctx.data, "town_no_terrain");
        if (raw instanceof List<?> list) {
            for (Object item : list) {
                Integer id = MapConfig.asInt(item);
                if (id != null) {
                    noTerrain.add(id);
                }
            }
        }
        if (noTerrain.isEmpty()) {
            noTerrain.add(3);
            noTerrain.add(20);
            noTerrain.add(21);
        }
        int floor =
                Math.max(
                        1,
                        MapConfig.cfgInt(
                                ctx.data, "town_min_dist_floor", ctx.sizeName(), 14));

        // Unreserve old footprint temporarily while searching.
        unreserve(ctx, old);
        List<int[]> options = new ArrayList<>();
        for (int row = inset; row < ctx.height - inset; row++) {
            for (int col = inset + 1; col < ctx.width - inset; col++) {
                int[] entry = new int[] {col, row};
                if (!validRelocate(ctx, entry, inset, noTerrain)) {
                    continue;
                }
                String key = HexCoords.key(HexCoords.qOf(col, row), row);
                if (!reachable.contains(key)) {
                    continue;
                }
                boolean spaced = true;
                for (TownSite s : ctx.townSites) {
                    if (s.col() == old.col() && s.row() == old.row()) {
                        continue;
                    }
                    if (pairDist(entry, new int[] {s.col(), s.row()}) < floor) {
                        spaced = false;
                        break;
                    }
                }
                if (spaced) {
                    options.add(entry);
                }
            }
        }
        if (options.isEmpty()) {
            // Re-reserve old — caller will skip/remove.
            reserve(ctx, old.col(), old.row());
            return null;
        }
        // Prefer contested-ish: farthest from nearest other town.
        int[] best = options.get(0);
        int bestScore = -1;
        for (int[] e : options) {
            int min = Integer.MAX_VALUE;
            for (TownSite s : ctx.townSites) {
                if (s.col() == old.col() && s.row() == old.row()) {
                    continue;
                }
                min = Math.min(min, pairDist(e, new int[] {s.col(), s.row()}));
            }
            if (min > bestScore) {
                bestScore = min;
                best = e;
            }
        }
        reserve(ctx, best[0], best[1]);
        return new TownSite(
                best[0],
                best[1],
                old.name(),
                old.townTypeId(),
                false,
                old.playerIndex());
    }

    private static boolean validRelocate(
            MapGenContext ctx, int[] entry, int inset, Set<Integer> noTerrain) {
        int col = entry[0];
        int row = entry[1];
        int left = col - 1;
        if (left < inset || col >= ctx.width - inset || row < inset || row >= ctx.height - inset) {
            return false;
        }
        if (ctx.townReserved[row][col] || ctx.townReserved[row][left]) {
            return false;
        }
        HexTerrain e = ctx.cells[row][col];
        HexTerrain k = ctx.cells[row][left];
        if (!e.isPassable() || !k.isPassable()) {
            return false;
        }
        if (noTerrain.contains(e.id()) || noTerrain.contains(k.id())) {
            return false;
        }
        if (e.blocked() || k.blocked()) {
            return false;
        }
        int front = col + 1;
        if (front >= ctx.width) {
            return false;
        }
        HexTerrain f = ctx.cells[row][front];
        return f.isPassable() && f.movementCost() != null;
    }

    private static int pairDist(int[] entryA, int[] entryB) {
        int min = Integer.MAX_VALUE;
        int[][] a = {{entryA[0], entryA[1]}, {entryA[0] - 1, entryA[1]}};
        int[][] b = {{entryB[0], entryB[1]}, {entryB[0] - 1, entryB[1]}};
        for (int[] ha : a) {
            for (int[] hb : b) {
                min =
                        Math.min(
                                min,
                                HexCoords.hexDistance(
                                        HexCoords.qOf(ha[0], ha[1]),
                                        ha[1],
                                        HexCoords.qOf(hb[0], hb[1]),
                                        hb[1]));
            }
        }
        return min;
    }

    private static void unreserve(MapGenContext ctx, TownSite site) {
        int col = site.col();
        int row = site.row();
        if (row >= 0 && row < ctx.height) {
            if (col >= 0 && col < ctx.width) {
                ctx.townReserved[row][col] = false;
            }
            if (col - 1 >= 0 && col - 1 < ctx.width) {
                ctx.townReserved[row][col - 1] = false;
            }
        }
    }

    private static void reserve(MapGenContext ctx, int col, int row) {
        ctx.townReserved[row][col] = true;
        ctx.townReserved[row][col - 1] = true;
    }

    private static void replaceSite(MapGenContext ctx, TownSite old, TownSite moved) {
        for (int i = 0; i < ctx.townSites.size(); i++) {
            TownSite s = ctx.townSites.get(i);
            if (s.col() == old.col() && s.row() == old.row()) {
                ctx.townSites.set(i, moved);
                break;
            }
        }
        // Update town object in features list if already emitted.
        if (ctx.objects != null) {
            int oldQ = HexCoords.qOf(old.col(), old.row());
            int newQ = HexCoords.qOf(moved.col(), moved.row());
            for (int i = 0; i < ctx.objects.size(); i++) {
                MapObjectData o = ctx.objects.get(i);
                if ("town".equals(o.kind()) && o.q() == oldQ && o.r() == old.row()) {
                    ctx.objects.set(
                            i,
                            MapObjectData.basic(
                                    newQ,
                                    moved.row(),
                                    "town",
                                    null,
                                    "T",
                                    moved.name(),
                                    moved.townTypeId(),
                                    null,
                                    null));
                }
            }
        }
        buildReachIndexes(ctx);
    }

    /** Feature or land hex the final flood still has to reach. */
    private static final class Goal {
        final String id;
        final Set<String> targets;

        Goal(String id, Set<String> targets) {
            this.id = id;
            this.targets = targets;
        }
    }

    private enum Open {
        SCATTER,
        FEATURE,
        WALL
    }

    /**
     * Features and land areas, after towns. Scatter props first, then move or
     * drop the blocking feature, then a wall prop. Pocket rings stay shut.
     */
    private static int[] repairWorld(MapGenContext ctx) {
        int props = 0;
        int moved = 0;
        int removed = 0;
        int walls = 0;
        if (ctx.featureRules == null) {
            ctx.featureRules = FeatureRules.load(ctx);
        }
        Set<Integer> wallIds = new HashSet<>();
        for (WorldProps.WallProp wall : WorldProps.walls(ctx.data)) {
            wallIds.add(wall.id());
        }
        int minArea = Math.max(1, MapConfig.cfgInt(ctx.data, "reach_min_area", ctx.sizeName(), 6));
        Set<String> gaveUp = new HashSet<>();
        Set<String> reached = floodFromStarts(ctx);
        int passes = 0;
        for (int pass = 0; pass < 80; pass++) {
            passes = pass + 1;
            Goal goal = nextGoal(ctx, reached, minArea, gaveUp);
            if (goal == null) {
                break;
            }
            List<int[]> scatter = search(ctx, reached, goal, Open.SCATTER, wallIds);
            if (scatter != null) {
                int cleared = clearProps(ctx, scatter, wallIds, false);
                if (cleared > 0) {
                    props += cleared;
                    expandReachable(ctx, reached, scatter);
                    gaveUp.clear();
                    continue;
                }
                gaveUp.add(goal.id);
                continue;
            }
            List<int[]> across = search(ctx, reached, goal, Open.FEATURE, wallIds);
            if (across != null && !crossesPocketLoot(ctx, across)) {
                int[] counts = clearFeatures(ctx, across, goal);
                if (counts[0] + counts[1] > 0) {
                    moved += counts[0];
                    removed += counts[1];
                    rebuildFeatureIndex(ctx);
                    expandReachable(ctx, reached, across);
                    gaveUp.clear();
                    continue;
                }
            }
            List<int[]> walled = search(ctx, reached, goal, Open.WALL, wallIds);
            if (walled != null && !crossesPocketLoot(ctx, walled)) {
                int opened = clearProps(ctx, walled, wallIds, true);
                if (opened > 0) {
                    walls += opened;
                    expandReachable(ctx, reached, walled);
                    gaveUp.clear();
                    continue;
                }
            }
            gaveUp.add(goal.id);
        }
        return new int[] {props, moved, removed, walls, passes};
    }

    private static Goal nextGoal(
            MapGenContext ctx, Set<String> reached, int minArea, Set<String> gaveUp) {
        if (ctx.objects != null) {
            for (MapObjectData obj : ctx.objects) {
                if ("town".equals(obj.kind())) {
                    continue;
                }
                String id = "f:" + obj.q() + "," + obj.r();
                if (gaveUp.contains(id)) {
                    continue;
                }
                int col = HexCoords.colOf(obj.q(), obj.r());
                int row = obj.r();
                if (WaterTerrain.onIsland(ctx, col, row)) {
                    continue;
                }
                if (hasReachedNeighbor(ctx, reached, col, row)) {
                    continue;
                }
                Set<String> targets = approachTargets(ctx, col, row);
                if (!targets.isEmpty()) {
                    return new Goal(id, targets);
                }
            }
        }
        boolean[][] seen = new boolean[ctx.height][ctx.width];
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (seen[row][col] || !walkable(ctx, col, row)) {
                    continue;
                }
                List<int[]> area = new ArrayList<>();
                List<int[]> stack = new ArrayList<>();
                stack.add(new int[] {col, row});
                seen[row][col] = true;
                boolean touches = reachedAt(ctx, reached, col, row);
                while (!stack.isEmpty()) {
                    int[] cur = stack.remove(stack.size() - 1);
                    area.add(cur);
                    int q = HexCoords.qOf(cur[0], cur[1]);
                    for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                        int nr = cur[1] + d[1];
                        int ncol = HexCoords.colOf(q + d[0], nr);
                        if (ncol < 0 || nr < 0 || ncol >= ctx.width || nr >= ctx.height) {
                            continue;
                        }
                        if (seen[nr][ncol] || !walkable(ctx, ncol, nr)) {
                            continue;
                        }
                        seen[nr][ncol] = true;
                        if (reachedAt(ctx, reached, ncol, nr)) {
                            touches = true;
                        }
                        stack.add(new int[] {ncol, nr});
                    }
                }
                if (WaterTerrain.onIsland(ctx, col, row) || touches || area.size() < minArea) {
                    continue;
                }
                String id = "a:" + area.get(0)[0] + "," + area.get(0)[1];
                if (gaveUp.contains(id)) {
                    continue;
                }
                Set<String> targets = new HashSet<>();
                for (int[] hex : area) {
                    targets.add(hex[0] + "," + hex[1]);
                }
                return new Goal(id, targets);
            }
        }
        return null;
    }

    private static boolean hasReachedNeighbor(
            MapGenContext ctx, Set<String> reached, int col, int row) {
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nr = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nr);
            if (ncol < 0 || nr < 0 || ncol >= ctx.width || nr >= ctx.height) {
                continue;
            }
            if (reachedAt(ctx, reached, ncol, nr) && walkable(ctx, ncol, nr)) {
                return true;
            }
        }
        return false;
    }

    private static Set<String> approachTargets(MapGenContext ctx, int col, int row) {
        Set<String> targets = new HashSet<>();
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nr = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nr);
            if (!passable(ctx, ncol, nr) || townKeep(ctx, ncol, nr)) {
                continue;
            }
            if (ctx.pocketRing != null && ctx.pocketRing[nr][ncol]) {
                continue;
            }
            targets.add(ncol + "," + nr);
        }
        return targets;
    }

    private static List<int[]> search(
            MapGenContext ctx, Set<String> reached, Goal goal, Open mode, Set<Integer> wallIds) {
        Queue<int[]> q = new ArrayDeque<>();
        Map<String, String> parent = new HashMap<>();
        for (String axial : reached) {
            int comma = axial.indexOf(',');
            if (comma <= 0) {
                continue;
            }
            int qv = Integer.parseInt(axial.substring(0, comma));
            int r = Integer.parseInt(axial.substring(comma + 1));
            int col = HexCoords.colOf(qv, r);
            if (col < 0 || r < 0 || col >= ctx.width || r >= ctx.height) {
                continue;
            }
            if (!walkable(ctx, col, r)) {
                continue;
            }
            String key = col + "," + r;
            if (parent.containsKey(key)) {
                continue;
            }
            parent.put(key, "");
            q.add(new int[] {col, r});
        }
        String goalKey = null;
        while (!q.isEmpty()) {
            int[] cur = q.poll();
            String key = cur[0] + "," + cur[1];
            if (goal.targets.contains(key) && parent.get(key) != null && !parent.get(key).isEmpty()) {
                goalKey = key;
                break;
            }
            if (goal.targets.contains(key) && "".equals(parent.get(key))) {
                continue;
            }
            int cq = HexCoords.qOf(cur[0], cur[1]);
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nr = cur[1] + d[1];
                int ncol = HexCoords.colOf(cq + d[0], nr);
                if (!canStep(ctx, ncol, nr, mode, wallIds)) {
                    continue;
                }
                String nk = ncol + "," + nr;
                if (parent.containsKey(nk)) {
                    continue;
                }
                parent.put(nk, key);
                if (goal.targets.contains(nk)) {
                    goalKey = nk;
                    q.clear();
                    break;
                }
                q.add(new int[] {ncol, nr});
            }
        }
        if (goalKey == null) {
            return null;
        }
        List<int[]> path = new ArrayList<>();
        String cur = goalKey;
        while (cur != null && !cur.isEmpty()) {
            String[] parts = cur.split(",");
            path.add(new int[] {Integer.parseInt(parts[0]), Integer.parseInt(parts[1])});
            cur = parent.get(cur);
        }
        return path;
    }

    private static boolean canStep(
            MapGenContext ctx, int col, int row, Open mode, Set<Integer> wallIds) {
        if (!passable(ctx, col, row) || townKeep(ctx, col, row)) {
            return false;
        }
        if (ctx.pocketRing != null && ctx.pocketRing[row][col]) {
            return false;
        }
        boolean blocked = ctx.propBlocked != null && ctx.propBlocked[row][col];
        if (blocked) {
            WorldProps.Seed prop = ctx.propSeeds == null ? null : ctx.propSeeds[row][col];
            boolean wall = prop != null && wallIds.contains(prop.propId());
            if (wall) {
                return mode == Open.WALL;
            }
            return true;
        }
        MapObjectData feature = featureAt(ctx, col, row);
        if (feature != null) {
            if (ctx.pocketInterior != null && ctx.pocketInterior[row][col]) {
                return false;
            }
            return mode == Open.FEATURE || mode == Open.WALL;
        }
        return true;
    }

    private static int clearProps(
            MapGenContext ctx, List<int[]> path, Set<Integer> wallIds, boolean wallsOnly) {
        int cleared = 0;
        for (int[] hex : path) {
            int col = hex[0];
            int row = hex[1];
            if (ctx.propBlocked == null || !ctx.propBlocked[row][col]) {
                continue;
            }
            if (ctx.pocketRing != null && ctx.pocketRing[row][col]) {
                continue;
            }
            WorldProps.Seed prop = ctx.propSeeds == null ? null : ctx.propSeeds[row][col];
            boolean wall = prop != null && wallIds.contains(prop.propId());
            if (wallsOnly != wall) {
                continue;
            }
            ctx.propBlocked[row][col] = false;
            if (ctx.propSeeds != null) {
                ctx.propSeeds[row][col] = null;
            }
            cleared++;
        }
        return cleared;
    }

    private static boolean crossesPocketLoot(MapGenContext ctx, List<int[]> path) {
        for (int[] hex : path) {
            if (ctx.pocketInterior == null || !ctx.pocketInterior[hex[1]][hex[0]]) {
                continue;
            }
            if (featureAt(ctx, hex[0], hex[1]) != null) {
                return true;
            }
        }
        return false;
    }

    /** Relocate or remove features standing on the path. Pocket loot stays. */
    private static int[] clearFeatures(MapGenContext ctx, List<int[]> path, Goal goal) {
        int moved = 0;
        int removed = 0;
        List<MapObjectData> blocking = new ArrayList<>();
        for (int[] hex : path) {
            MapObjectData feature = featureAt(ctx, hex[0], hex[1]);
            if (feature == null || "town".equals(feature.kind())) {
                continue;
            }
            if (ctx.pocketInterior != null && ctx.pocketInterior[hex[1]][hex[0]]) {
                return new int[] {0, 0};
            }
            String id = "f:" + feature.q() + "," + feature.r();
            if (id.equals(goal.id)) {
                continue;
            }
            blocking.add(feature);
        }
        for (MapObjectData feature : blocking) {
            if (relocateFeature(ctx, feature)) {
                moved++;
            } else if (ctx.objects.remove(feature)) {
                removed++;
            }
        }
        return new int[] {moved, removed};
    }

    private static boolean relocateFeature(MapGenContext ctx, MapObjectData obj) {
        if (ctx.objects == null || ctx.featureRules == null) {
            return false;
        }
        int oldCol = HexCoords.colOf(obj.q(), obj.r());
        if (ctx.pocketInterior != null
                && oldCol >= 0
                && obj.r() >= 0
                && obj.r() < ctx.height
                && oldCol < ctx.width
                && ctx.pocketInterior[obj.r()][oldCol]) {
            return false;
        }
        List<MapObjectData> others = new ArrayList<>(ctx.objects);
        others.remove(obj);
        boolean perm = ctx.featureRules.isPermanent(obj);
        String group = ctx.featureRules.groupKey(obj);
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (Pockets.seals(ctx, col, row)) {
                    continue;
                }
                String reason =
                        perm
                                ? ctx.featureRules.rejectPermanent(others, col, row)
                                : ctx.featureRules.rejectTemporary(others, col, row, group);
                if (reason != null) {
                    continue;
                }
                Integer guardQ = null;
                Integer guardR = null;
                if ("chest".equals(obj.kind()) && obj.guardQ() != null) {
                    int[] guard = guardHex(ctx, others, col, row);
                    if (guard == null) {
                        continue;
                    }
                    guardQ = guard[0];
                    guardR = guard[1];
                }
                int q = HexCoords.qOf(col, row);
                ctx.objects.remove(obj);
                ctx.objects.add(
                        new MapObjectData(
                                q,
                                row,
                                obj.kind(),
                                obj.resourceId(),
                                obj.marker(),
                                obj.name(),
                                obj.townTypeId(),
                                obj.flipped(),
                                obj.qty(),
                                obj.level(),
                                obj.loot(),
                                guardQ,
                                guardR,
                                obj.signTextId(),
                                obj.abilityIds(),
                                obj.launchQ(),
                                obj.launchR(),
                                obj.linkedTownQ(),
                                obj.linkedTownR()));
                rebuildFeatureIndex(ctx);
                return true;
            }
        }
        return false;
    }

    private static int[] guardHex(MapGenContext ctx, List<MapObjectData> objects, int col, int row) {
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nr = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nr);
            if (!walkable(ctx, ncol, nr)) {
                continue;
            }
            if (Pockets.seals(ctx, ncol, nr)) {
                continue;
            }
            if (ctx.featureRules != null && ctx.featureRules.stealsLastApproach(objects, ncol, nr, null)) {
                continue;
            }
            return new int[] {HexCoords.qOf(ncol, nr), nr};
        }
        return null;
    }

    private static MapObjectData featureAt(MapGenContext ctx, int col, int row) {
        if (col < 0 || row < 0 || col >= ctx.width || row >= ctx.height) {
            return null;
        }
        if (ctx.reachFeatureAt != null) {
            return ctx.reachFeatureAt[row][col];
        }
        if (ctx.objects == null) {
            return null;
        }
        int q = HexCoords.qOf(col, row);
        for (MapObjectData obj : ctx.objects) {
            if ("town".equals(obj.kind())) {
                continue;
            }
            if (obj.q() == q && obj.r() == row) {
                return obj;
            }
        }
        return null;
    }

    private static boolean reachedAt(MapGenContext ctx, Set<String> reached, int col, int row) {
        if (col < 0 || row < 0 || col >= ctx.width || row >= ctx.height) {
            return false;
        }
        return reached.contains(HexCoords.key(HexCoords.qOf(col, row), row));
    }

    private static boolean passable(MapGenContext ctx, int col, int row) {
        if (col < 0 || row < 0 || col >= ctx.width || row >= ctx.height) {
            return false;
        }
        HexTerrain terrain = ctx.cells[row][col];
        return terrain != null && terrain.isPassable() && terrain.movementCost() != null && !terrain.blocked();
    }

    private static boolean townKeep(MapGenContext ctx, int col, int row) {
        for (TownSite site : ctx.townSites) {
            if (site.row() == row && site.keepCol() == col) {
                return true;
            }
        }
        return false;
    }

    private static void removeTown(MapGenContext ctx, TownSite site) {
        unreserve(ctx, site);
        ctx.townSites.removeIf(s -> s.col() == site.col() && s.row() == site.row());
        if (ctx.objects != null) {
            int q = HexCoords.qOf(site.col(), site.row());
            ctx.objects.removeIf(
                    o -> "town".equals(o.kind()) && o.q() == q && o.r() == site.row());
        }
        buildReachIndexes(ctx);
    }

    /**
     * Passable mainland components with area ≥ reach_min_area that touch the
     * on-foot flood from starting towns. Used before permanent building placement.
     */
    static boolean[][] buildingLandMask(MapGenContext ctx) {
        int minArea =
                Math.max(1, MapConfig.cfgInt(ctx.data, "reach_min_area", ctx.sizeName(), 6));
        Set<String> reached = floodFromStartsTerrain(ctx);
        boolean[][] ok = new boolean[ctx.height][ctx.width];
        boolean[][] seen = new boolean[ctx.height][ctx.width];
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (seen[row][col] || !passable(ctx, col, row)) {
                    continue;
                }
                if (WaterTerrain.onIsland(ctx, col, row)) {
                    continue;
                }
                List<int[]> area = new ArrayList<>();
                List<int[]> stack = new ArrayList<>();
                stack.add(new int[] {col, row});
                seen[row][col] = true;
                boolean touches = reached.contains(HexCoords.key(HexCoords.qOf(col, row), row));
                while (!stack.isEmpty()) {
                    int[] cur = stack.remove(stack.size() - 1);
                    area.add(cur);
                    int q = HexCoords.qOf(cur[0], cur[1]);
                    for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                        int nr = cur[1] + d[1];
                        int ncol = HexCoords.colOf(q + d[0], nr);
                        if (ncol < 0 || nr < 0 || ncol >= ctx.width || nr >= ctx.height) {
                            continue;
                        }
                        if (seen[nr][ncol] || !passable(ctx, ncol, nr)) {
                            continue;
                        }
                        if (WaterTerrain.onIsland(ctx, ncol, nr)) {
                            continue;
                        }
                        seen[nr][ncol] = true;
                        if (reached.contains(HexCoords.key(HexCoords.qOf(ncol, nr), nr))) {
                            touches = true;
                        }
                        stack.add(new int[] {ncol, nr});
                    }
                }
                if (touches && area.size() >= minArea) {
                    for (int[] hex : area) {
                        ok[hex[1]][hex[0]] = true;
                    }
                }
            }
        }
        return ok;
    }

    /** Foot flood from starting town entries (terrain only, before L5 features). */
    private static Set<String> floodFromStartsTerrain(MapGenContext ctx) {
        Set<String> seen = new HashSet<>();
        Queue<int[]> q = new ArrayDeque<>();
        for (TownSite site : ctx.townSites) {
            if (!site.starting()) {
                continue;
            }
            int col = site.col();
            int row = site.row();
            String key = HexCoords.key(HexCoords.qOf(col, row), row);
            if (passable(ctx, col, row) && seen.add(key)) {
                q.add(new int[] {col, row});
            }
            if (passable(ctx, col + 1, row)) {
                String fk = HexCoords.key(HexCoords.qOf(col + 1, row), row);
                if (seen.add(fk)) {
                    q.add(new int[] {col + 1, row});
                }
            }
        }
        while (!q.isEmpty()) {
            int[] cur = q.poll();
            int cq = HexCoords.qOf(cur[0], cur[1]);
            int cr = cur[1];
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nq = cq + d[0];
                int nr = cr + d[1];
                int ncol = HexCoords.colOf(nq, nr);
                if (!passable(ctx, ncol, nr) || townKeep(ctx, ncol, nr)) {
                    continue;
                }
                String nk = HexCoords.key(nq, nr);
                if (seen.add(nk)) {
                    q.add(new int[] {ncol, nr});
                }
            }
        }
        return seen;
    }
}
