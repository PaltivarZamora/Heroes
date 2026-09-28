package com.heroesofyendor;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.PriorityQueue;
import java.util.Set;

/**
 * Short branches from the town interstate to features that are not already near
 * a road (BR S9-21). Runs after permanent buildings, before signs.
 */
final class BranchRoads {

    private static final double INF = Double.POSITIVE_INFINITY;
    private static final List<String> DEFAULT_TYPES =
            List.of("quest", "dock", "hanger", "library", "recruit_building");

    private BranchRoads() {}

    static void run(MapGenContext ctx) {
        if (ctx.hasRoad == null) {
            MapGenPipeline.logCounts("branch-roads", "skipped (no road grid)");
            return;
        }
        boolean enabled = MapConfig.cfgFlag(ctx.data, "roads_enabled", ctx.sizeName(), false);
        if (!enabled) {
            MapGenPipeline.logCounts("branch-roads", "skipped (roads_enabled=0)");
            return;
        }
        int skipDist = Math.max(0, MapConfig.cfgInt(ctx.data, "road_branch_skip_dist", ctx.sizeName(), 5));
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
        Match match = matchTypes(ctx);

        List<int[]> network = new ArrayList<>();
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (ctx.hasRoad[row][col]) {
                    network.add(new int[] {HexCoords.qOf(col, row), row});
                }
            }
        }
        if (network.isEmpty()) {
            MapGenPipeline.logCounts("branch-roads", "skipped (no interstate)");
            return;
        }

        int n = ctx.width * ctx.height;
        boolean[] nearTown = townApproaches(ctx);
        boolean[] occupied = occupied(ctx);
        int[] geo = distanceToRoads(ctx);

        List<Feature> features = new ArrayList<>();
        int eligible = 0;
        for (MapObjectData obj : ctx.objects) {
            if (!matches(obj, match)) {
                continue;
            }
            eligible++;
            int dist = nearestRoad(obj.q(), obj.r(), network);
            features.add(new Feature(obj, dist, label(obj)));
        }
        features.sort(Comparator.comparingInt((Feature f) -> f.dist).thenComparing(f -> f.name));

        int skipped = 0;
        int built = 0;
        int noRoute = 0;
        int lengthSum = 0;
        boolean[] branch = new boolean[n];
        List<int[]> targets = new ArrayList<>();
        List<Feature> pending = new ArrayList<>(features);

        while (!pending.isEmpty()) {
            Feature feature = null;
            int bestDist = Integer.MAX_VALUE;
            for (Feature candidate : pending) {
                int idx = index(ctx, candidate.obj.q(), candidate.obj.r());
                int dist = idx < 0 || geo[idx] == Integer.MAX_VALUE ? Integer.MAX_VALUE : geo[idx];
                if (feature == null
                        || dist < bestDist
                        || (dist == bestDist && candidate.name.compareTo(feature.name) < 0)) {
                    feature = candidate;
                    bestDist = dist;
                }
            }
            pending.remove(feature);
            if (bestDist <= skipDist) {
                skipped++;
                continue;
            }
            List<int[]> approaches = approaches(ctx, feature.obj, nearTown, occupied);
            approaches.sort(Comparator.comparingInt(hex -> {
                int idx = index(ctx, hex[0], hex[1]);
                return idx < 0 || geo[idx] == Integer.MAX_VALUE ? Integer.MAX_VALUE : geo[idx];
            }));
            List<int[]> path = null;
            for (int[] approach : approaches) {
                int start = index(ctx, approach[0], approach[1]);
                if (start < 0) {
                    continue;
                }
                path = route(ctx, start, nearTown, occupied, noTerrain, mergeCost, waterCost, geo);
                if (path != null) {
                    break;
                }
            }
            if (path == null || path.size() < 2) {
                noRoute++;
                MapGenPipeline.logCounts(
                        "branch-roads",
                        "unreached "
                                + feature.name
                                + " @ "
                                + feature.obj.q()
                                + ","
                                + feature.obj.r());
                continue;
            }
            int added = 0;
            List<Integer> seeded = new ArrayList<>();
            for (int[] hex : path) {
                int col = HexCoords.colOf(hex[0], hex[1]);
                int row = hex[1];
                if (col < 0 || row < 0 || col >= ctx.width || row >= ctx.height) {
                    continue;
                }
                int idx = row * ctx.width + col;
                seeded.add(idx);
                if (!ctx.hasRoad[row][col]) {
                    ctx.hasRoad[row][col] = true;
                    branch[idx] = true;
                    added++;
                }
            }
            RoadLinks.connectPath(ctx, path);
            relaxDistances(ctx, geo, seeded);
            built++;
            lengthSum += added;
            targets.add(new int[] {feature.obj.q(), feature.obj.r()});
            ctx.roadDebugLinks.add(new MapGenContext.RoadDebugLink("", feature.name, path, true));
        }

        int washed = washBranches(ctx, branch, noTerrain);
        int trimmed = trimBranches(ctx, branch, targets, minFragment);
        double avg = built == 0 ? 0 : (double) lengthSum / built;
        MapGenPipeline.logCounts(
                "branch-roads",
                "eligible="
                        + eligible
                        + " skippedNear="
                        + skipped
                        + " built="
                        + built
                        + " noRoute="
                        + noRoute
                        + " avgLen="
                        + String.format(Locale.ROOT, "%.1f", avg)
                        + " washed="
                        + washed
                        + " trimmed="
                        + trimmed);
    }

    /** Feature types from {@code road_branch_features}, matched via the catalog. */
    private static Match matchTypes(MapGenContext ctx) {
        List<String> types = new ArrayList<>();
        Object raw = MapConfig.mapCfg(ctx.data, "road_branch_features", ctx.sizeName());
        if (raw instanceof List<?> list) {
            for (Object item : list) {
                String name = MapConfig.asString(item);
                if (name != null && !name.isBlank()) {
                    types.add(name.trim());
                }
            }
        }
        if (types.isEmpty()) {
            types.addAll(DEFAULT_TYPES);
        }
        Set<String> kinds = new HashSet<>();
        Set<String> names = new HashSet<>();
        for (String typeName : types) {
            kinds.add(typeName.toLowerCase(Locale.ROOT));
            Integer typeId = null;
            for (java.util.Map<String, Object> row : ctx.data.rows("feature_type")) {
                if (typeName.equalsIgnoreCase(MapConfig.asString(row.get("name")))) {
                    typeId = MapConfig.asInt(row.get("id"));
                    break;
                }
            }
            if (typeId == null) {
                continue;
            }
            for (java.util.Map<String, Object> row : ctx.data.rows("feature")) {
                Integer rowType = MapConfig.asInt(row.get("feature_type_id"));
                if (rowType == null || rowType.intValue() != typeId.intValue()) {
                    continue;
                }
                String featureName = MapConfig.asString(row.get("name"));
                if (featureName == null || featureName.isBlank()) {
                    continue;
                }
                names.add(featureName.trim().toLowerCase(Locale.ROOT));
                kinds.add(slug(featureName));
            }
        }
        return new Match(kinds, names);
    }

    private static boolean matches(MapObjectData obj, Match match) {
        String kind = obj.kind() == null ? "" : obj.kind().trim().toLowerCase(Locale.ROOT);
        if (match.kinds.contains(kind)) {
            return true;
        }
        String name = obj.name() == null ? "" : obj.name().trim().toLowerCase(Locale.ROOT);
        return !name.isEmpty() && match.names.contains(name);
    }

    private static String slug(String name) {
        String s = name.trim().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "_");
        return s.replaceAll("^_|_$", "");
    }

    private static String label(MapObjectData obj) {
        if (obj.name() != null && !obj.name().isBlank()) {
            return obj.name().trim();
        }
        return obj.kind() == null ? "feature" : obj.kind();
    }

    private static int nearestRoad(int q, int r, List<int[]> network) {
        int best = Integer.MAX_VALUE;
        for (int[] road : network) {
            int dist = HexCoords.hexDistance(q, r, road[0], road[1]);
            if (dist < best) {
                best = dist;
            }
        }
        return best;
    }

    /** Hexes next to a town footprint. Branches must not touch a town. */
    private static boolean[] townApproaches(MapGenContext ctx) {
        boolean[] near = new boolean[ctx.width * ctx.height];
        for (TownSite site : ctx.townSites) {
            int[] cols = {site.col(), site.keepCol()};
            for (int col : cols) {
                if (col < 0 || col >= ctx.width || site.row() < 0 || site.row() >= ctx.height) {
                    continue;
                }
                int q = HexCoords.qOf(col, site.row());
                for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                    int nrow = site.row() + d[1];
                    int ncol = HexCoords.colOf(q + d[0], nrow);
                    if (ncol < 0 || nrow < 0 || ncol >= ctx.width || nrow >= ctx.height) {
                        continue;
                    }
                    near[nrow * ctx.width + ncol] = true;
                }
            }
        }
        return near;
    }

    private static boolean[] occupied(MapGenContext ctx) {
        boolean[] occ = new boolean[ctx.width * ctx.height];
        for (MapObjectData obj : ctx.objects) {
            int col = HexCoords.colOf(obj.q(), obj.r());
            int row = obj.r();
            if (col < 0 || row < 0 || col >= ctx.width || row >= ctx.height) {
                continue;
            }
            occ[row * ctx.width + col] = true;
        }
        return occ;
    }

    /** Hex distance to the nearest interstate/branch road, ignoring obstacles. */
    private static int[] distanceToRoads(MapGenContext ctx) {
        int n = ctx.width * ctx.height;
        int[] dist = new int[n];
        Arrays.fill(dist, Integer.MAX_VALUE);
        ArrayDeque<Integer> queue = new ArrayDeque<>();
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (!ctx.hasRoad[row][col]) {
                    continue;
                }
                int idx = row * ctx.width + col;
                dist[idx] = 0;
                queue.add(idx);
            }
        }
        while (!queue.isEmpty()) {
            int cur = queue.removeFirst();
            int col = cur % ctx.width;
            int row = cur / ctx.width;
            int q = HexCoords.qOf(col, row);
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nrow = row + d[1];
                int ncol = HexCoords.colOf(q + d[0], nrow);
                if (ncol < 0 || nrow < 0 || ncol >= ctx.width || nrow >= ctx.height) {
                    continue;
                }
                int nidx = nrow * ctx.width + ncol;
                if (dist[nidx] != Integer.MAX_VALUE) {
                    continue;
                }
                dist[nidx] = dist[cur] + 1;
                queue.add(nidx);
            }
        }
        return dist;
    }

    /** Pull the distance field down through newly painted road hexes. */
    private static void relaxDistances(MapGenContext ctx, int[] dist, List<Integer> seeds) {
        ArrayDeque<Integer> queue = new ArrayDeque<>();
        for (int idx : seeds) {
            dist[idx] = 0;
            queue.add(idx);
        }
        while (!queue.isEmpty()) {
            int cur = queue.removeFirst();
            int col = cur % ctx.width;
            int row = cur / ctx.width;
            int q = HexCoords.qOf(col, row);
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nrow = row + d[1];
                int ncol = HexCoords.colOf(q + d[0], nrow);
                if (ncol < 0 || nrow < 0 || ncol >= ctx.width || nrow >= ctx.height) {
                    continue;
                }
                int nidx = nrow * ctx.width + ncol;
                if (dist[nidx] <= dist[cur] + 1) {
                    continue;
                }
                dist[nidx] = dist[cur] + 1;
                queue.add(nidx);
            }
        }
    }

    private static List<int[]> approaches(
            MapGenContext ctx, MapObjectData feature, boolean[] nearTown, boolean[] occupied) {
        List<int[]> out = new ArrayList<>();
        int q = feature.q();
        int r = feature.r();
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nq = q + d[0];
            int nr = r + d[1];
            int col = HexCoords.colOf(nq, nr);
            if (col < 0 || nr < 0 || col >= ctx.width || nr >= ctx.height) {
                continue;
            }
            int idx = nr * ctx.width + col;
            if (occupied[idx] || nearTown[idx] || ctx.hasRoad[nr][col]) {
                continue;
            }
            if (ctx.townReserved != null && ctx.townReserved[nr][col]) {
                continue;
            }
            if (ctx.propBlocked != null && ctx.propBlocked[nr][col]) {
                continue;
            }
            if (Pockets.seals(ctx, col, nr)) {
                continue;
            }
            HexTerrain terrain = ctx.cells[nr][col];
            if (terrain == null || !terrain.isPassable()) {
                continue;
            }
            out.add(new int[] {nq, nr});
        }
        return out;
    }

    /**
     * Cheapest path from {@code start} onto the existing network. The last hex
     * is the road that was already there. Null when nothing can be reached.
     */
    private static List<int[]> route(
            MapGenContext ctx,
            int start,
            boolean[] nearTown,
            boolean[] occupied,
            Set<Integer> noTerrain,
            double mergeCost,
            double waterCost,
            int[] geo) {
        int n = ctx.width * ctx.height;
        double[] gScore = new double[n];
        Arrays.fill(gScore, INF);
        int[] came = new int[n];
        Arrays.fill(came, -1);
        boolean[] closed = new boolean[n];
        gScore[start] = 0;
        PriorityQueue<Node> open =
                new PriorityQueue<>(Comparator.comparingDouble((Node node) -> node.f).thenComparingLong(node -> node.seq));
        long seq = 0;
        open.add(new Node(start, heuristic(geo, start, mergeCost), seq++));
        int goal = -1;
        while (!open.isEmpty()) {
            Node cur = open.poll();
            if (closed[cur.idx]) {
                continue;
            }
            closed[cur.idx] = true;
            if (cur.idx != start && ctx.hasRoad[cur.idx / ctx.width][cur.idx % ctx.width]) {
                goal = cur.idx;
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
                if (blocked(ctx, ncol, nrow, nidx, nearTown, occupied, noTerrain)) {
                    continue;
                }
                double step = stepCost(ctx, ncol, nrow, noTerrain, mergeCost, waterCost);
                double next = gScore[cur.idx] + step;
                if (next + 1e-9 >= gScore[nidx]) {
                    continue;
                }
                gScore[nidx] = next;
                came[nidx] = cur.idx;
                open.add(new Node(nidx, next + heuristic(geo, nidx, mergeCost), seq++));
            }
        }
        if (goal < 0) {
            return null;
        }
        List<int[]> rev = new ArrayList<>();
        int walk = goal;
        int scol = start % ctx.width;
        int srow = start / ctx.width;
        int sq = HexCoords.qOf(scol, srow);
        while (walk >= 0) {
            int col = walk % ctx.width;
            int row = walk / ctx.width;
            rev.add(new int[] {HexCoords.qOf(col, row), row});
            if (walk == start) {
                break;
            }
            walk = came[walk];
        }
        int[] tail = rev.get(rev.size() - 1);
        if (tail[0] != sq || tail[1] != srow) {
            return null;
        }
        List<int[]> path = new ArrayList<>(rev.size());
        for (int i = rev.size() - 1; i >= 0; i--) {
            path.add(rev.get(i));
        }
        return path;
    }

    private static double heuristic(int[] geo, int idx, double mergeCost) {
        if (idx < 0 || idx >= geo.length || geo[idx] == Integer.MAX_VALUE) {
            return 0;
        }
        return geo[idx] * Math.min(mergeCost, 0.5);
    }

    private static boolean blocked(
            MapGenContext ctx,
            int col,
            int row,
            int idx,
            boolean[] nearTown,
            boolean[] occupied,
            Set<Integer> noTerrain) {
        if (ctx.propBlocked != null && ctx.propBlocked[row][col]) {
            return true;
        }
        if (Pockets.seals(ctx, col, row)) {
            return true;
        }
        if (ctx.townReserved != null && ctx.townReserved[row][col]) {
            return true;
        }
        if (nearTown[idx] || occupied[idx]) {
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

    private static double stepCost(
            MapGenContext ctx, int col, int row, Set<Integer> noTerrain, double mergeCost, double waterCost) {
        if (ctx.hasRoad[row][col]) {
            return mergeCost;
        }
        HexTerrain terrain = ctx.cells[row][col];
        if (terrain != null && noTerrain.contains(terrain.id())) {
            return waterCost;
        }
        if (terrain == null || terrain.movementCost() == null || terrain.movementCost() <= 0) {
            return 1.0;
        }
        return terrain.movementCost();
    }

    private static int washBranches(MapGenContext ctx, boolean[] branch, Set<Integer> noTerrain) {
        List<Integer> drop = new ArrayList<>();
        for (int idx = 0; idx < branch.length; idx++) {
            if (!branch[idx]) {
                continue;
            }
            int col = idx % ctx.width;
            int row = idx / ctx.width;
            if (washHex(ctx, col, row, noTerrain)) {
                drop.add(idx);
            }
        }
        for (int idx : drop) {
            int col = idx % ctx.width;
            int row = idx / ctx.width;
            ctx.hasRoad[row][col] = false;
            RoadLinks.clear(ctx, col, row);
            branch[idx] = false;
            ctx.roadDebugWashed.add(new int[] {HexCoords.qOf(col, row), row});
        }
        return drop.size();
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

    /** Drop short branch pieces that neither meet the network nor reach a feature. */
    private static int trimBranches(
            MapGenContext ctx, boolean[] branch, List<int[]> targets, int minFragment) {
        boolean[] seen = new boolean[branch.length];
        int trimmed = 0;
        for (int idx = 0; idx < branch.length; idx++) {
            if (!branch[idx] || seen[idx] || !ctx.hasRoad[idx / ctx.width][idx % ctx.width]) {
                continue;
            }
            List<Integer> comp = new ArrayList<>();
            ArrayDeque<Integer> stack = new ArrayDeque<>();
            stack.add(idx);
            seen[idx] = true;
            boolean touches = false;
            boolean reaches = false;
            while (!stack.isEmpty()) {
                int cur = stack.removeLast();
                comp.add(cur);
                int col = cur % ctx.width;
                int row = cur / ctx.width;
                int q = HexCoords.qOf(col, row);
                if (reachesFeature(q, row, targets)) {
                    reaches = true;
                }
                for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                    int nrow = row + d[1];
                    int ncol = HexCoords.colOf(q + d[0], nrow);
                    if (ncol < 0 || nrow < 0 || ncol >= ctx.width || nrow >= ctx.height) {
                        continue;
                    }
                    int nidx = nrow * ctx.width + ncol;
                    if (ctx.hasRoad[nrow][ncol] && !branch[nidx]) {
                        touches = true;
                    }
                    if (!branch[nidx] || seen[nidx] || !ctx.hasRoad[nrow][ncol]) {
                        continue;
                    }
                    seen[nidx] = true;
                    stack.add(nidx);
                }
            }
            if (touches || reaches || comp.size() >= minFragment) {
                continue;
            }
            for (int hex : comp) {
                int col = hex % ctx.width;
                int row = hex / ctx.width;
                ctx.hasRoad[row][col] = false;
                RoadLinks.clear(ctx, col, row);
                branch[hex] = false;
                ctx.roadDebugOrphans.add(new int[] {HexCoords.qOf(col, row), row});
                trimmed++;
            }
        }
        return trimmed;
    }

    private static boolean reachesFeature(int q, int r, List<int[]> targets) {
        for (int[] feature : targets) {
            if (HexCoords.hexDistance(q, r, feature[0], feature[1]) == 1) {
                return true;
            }
        }
        return false;
    }

    private static int index(MapGenContext ctx, int q, int r) {
        int col = HexCoords.colOf(q, r);
        if (col < 0 || r < 0 || col >= ctx.width || r >= ctx.height) {
            return -1;
        }
        return r * ctx.width + col;
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

    private record Match(Set<String> kinds, Set<String> names) {}

    private record Feature(MapObjectData obj, int dist, String name) {}

    private record Node(int idx, double f, long seq) {}
}
