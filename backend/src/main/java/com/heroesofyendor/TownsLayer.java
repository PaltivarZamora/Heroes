package com.heroesofyendor;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;

/**
 * Towns layer (BR S9-18): edge inset, terrain bans, entry+front walkable,
 * spacing with relax-to-floor. Starting towns are a random set at least
 * {@code start_min_dist} apart and {@code start_edge_inset} from the edge
 * (not farthest-point). Home regions, 70/30 split, and the rest are unchanged.
 */
final class TownsLayer {

    private static final String LAYER = "towns";

    private TownsLayer() {}

    static void run(MapGenContext ctx) {
        Random rng = ctx.rngFor(LAYER);
        ctx.cfg = TestGrid.mapPlaceConfig(ctx.data, ctx.size, ctx.playersParam, ctx.playerTownTypes);
        ctx.names = TestGrid.TownNameSession.from(ctx.data, rng);
        ctx.townReserved = new boolean[ctx.height][ctx.width];
        ctx.townSites = new ArrayList<>();

        int inset = Math.max(0, MapConfig.cfgInt(ctx.data, "town_edge_inset", ctx.sizeName(), 2));
        int startInset =
                Math.max(
                        inset,
                        MapConfig.cfgInt(ctx.data, "start_edge_inset", ctx.sizeName(), 8));
        Set<Integer> noTerrain = townNoTerrain(ctx.data);
        int distTarget =
                Math.max(1, MapConfig.cfgInt(ctx.data, "town_min_dist", ctx.sizeName(), defaultDist(ctx.sizeName())));
        int distFloor =
                Math.max(
                        1,
                        MapConfig.cfgInt(
                                ctx.data,
                                "town_min_dist_floor",
                                ctx.sizeName(),
                                defaultFloor(ctx.sizeName())));
        if (distFloor > distTarget) {
            distFloor = distTarget;
        }
        int startDist =
                Math.max(
                        1,
                        MapConfig.cfgInt(
                                ctx.data, "start_min_dist", ctx.sizeName(), distTarget));
        int startFloor =
                Math.max(
                        1,
                        MapConfig.cfgInt(
                                ctx.data, "start_min_dist_floor", ctx.sizeName(), distFloor));
        if (startFloor > startDist) {
            startFloor = startDist;
        }
        double homePct =
                Math.min(
                        100,
                        Math.max(
                                0,
                                MapConfig.cfgDouble(ctx.data, "town_home_pct", ctx.sizeName(), 70)));

        TownPlan plan = buildPlan(ctx, rng);
        int requested = plan.requestedTotal();

        List<int[]> candidates = buildValidCandidates(ctx, inset, noTerrain);
        List<int[]> startCandidates = buildValidCandidates(ctx, startInset, noTerrain);
        if (candidates.isEmpty() && startCandidates.isEmpty()) {
            MapGenPipeline.logCounts(
                    LAYER,
                    "requested=" + requested + " placed=0 (no valid candidates)");
            return;
        }

        List<Placed> placed = new ArrayList<>();
        int relaxEvents = 0;
        int skipped = 0;

        // 1. Starting towns — random set with pairwise min distance (not maximin).
        List<int[]> startEntries =
                placeStartingTowns(startCandidates, plan.players, startDist, startFloor, rng);
        // Shuffle which player gets which start so the layout isn't tied to player index.
        List<Integer> playerOrder = new ArrayList<>();
        for (int p = 0; p < plan.players; p++) {
            playerOrder.add(p);
        }
        Collections.shuffle(playerOrder, rng);
        for (int i = 0; i < startEntries.size(); i++) {
            int p = playerOrder.get(i);
            int[] entry = startEntries.get(i);
            int typeId = plan.startType[p];
            String name = takeName(ctx.names, typeId, rng);
            if (name == null) {
                skipped++;
                continue;
            }
            if (!reserve(ctx, entry)) {
                skipped++;
                continue;
            }
            TownSite site = new TownSite(entry[0], entry[1], name, typeId, true, p);
            ctx.townSites.add(site);
            placed.add(new Placed(entry, site));
            removeCandidate(candidates, entry);
            removeCandidate(candidates, new int[] {entry[0] - 1, entry[1]});
            removeCandidate(startCandidates, entry);
        }
        for (int p = 0; p < plan.players; p++) {
            boolean has = false;
            for (TownSite site : ctx.townSites) {
                if (site.starting() && site.playerIndex() == p) {
                    has = true;
                    break;
                }
            }
            if (!has) {
                skipped++;
                MapGenPipeline.logRelax(LAYER, "skip starting town for player " + p);
            }
        }
        logStartDistances(placed, startInset, startDist);

        // 2. Home regions (Voronoi by hexDistance to starting towns).
        int[][] owner = voronoiOwners(ctx, placed);
        int contestedSlack = Math.max(1, (int) Math.round(0.2 * distTarget));

        // 3. Each player's remaining own-type towns (home_pct home / rest contested).
        for (int p = 0; p < plan.players; p++) {
            int extras = plan.ownExtras[p];
            if (extras <= 0) {
                continue;
            }
            int homeWant = (int) Math.round(extras * (homePct / 100.0));
            int contestedWant = extras - homeWant;
            int typeId = plan.startType[p];
            for (int n = 0; n < homeWant; n++) {
                PlaceResult r =
                        placeOne(
                                ctx,
                                candidates,
                                placed,
                                owner,
                                p,
                                true,
                                false,
                                contestedSlack,
                                typeId,
                                distTarget,
                                distFloor,
                                rng);
                relaxEvents += r.relaxSteps;
                if (!r.ok) {
                    skipped++;
                }
            }
            for (int n = 0; n < contestedWant; n++) {
                PlaceResult r =
                        placeOne(
                                ctx,
                                candidates,
                                placed,
                                owner,
                                p,
                                false,
                                true,
                                contestedSlack,
                                typeId,
                                distTarget,
                                distFloor,
                                rng);
                relaxEvents += r.relaxSteps;
                if (!r.ok) {
                    skipped++;
                }
            }
        }

        // 4. Random-type towns. An island may take one of these (never a start).
        List<Integer> randomLeft = placeIslandTowns(ctx, candidates, placed, owner, contestedSlack, plan.randomTypes, distTarget, distFloor, rng);
        for (int typeId : randomLeft) {
            PlaceResult r =
                    placeOne(
                            ctx,
                            candidates,
                            placed,
                            owner,
                            -1,
                            false,
                            true,
                            contestedSlack,
                            typeId,
                            distTarget,
                            distFloor,
                            rng);
            relaxEvents += r.relaxSteps;
            if (!r.ok) {
                skipped++;
            }
        }

        // Stats
        int homeOwn = 0;
        int ownTotal = 0;
        for (TownSite site : ctx.townSites) {
            if (site.starting() || site.playerIndex() < 0) {
                continue;
            }
            ownTotal++;
            int q = HexCoords.qOf(site.col(), site.row());
            int r = site.row();
            if (owner[site.row()][site.col()] == site.playerIndex()) {
                homeOwn++;
            } else {
                // Contested zone counts as non-home for the pct report
                int dOwn = distToStart(placed, site.playerIndex(), q, r);
                int dOther = distToNearestOtherStart(placed, site.playerIndex(), q, r);
                if (dOther < Integer.MAX_VALUE
                        && Math.abs(dOwn - dOther) <= contestedSlack
                        && owner[site.row()][site.col()] == site.playerIndex()) {
                    homeOwn++;
                }
            }
        }
        // Recount home properly: own town whose entry hex owner == player
        homeOwn = 0;
        ownTotal = 0;
        for (TownSite site : ctx.townSites) {
            if (site.starting() || site.playerIndex() < 0) {
                continue;
            }
            ownTotal++;
            if (owner[site.row()][site.col()] == site.playerIndex()) {
                homeOwn++;
            }
        }
        double homePctActual = ownTotal == 0 ? 0 : (100.0 * homeOwn / ownTotal);
        int[] distStats = pairwiseMinAvg(placed);

        MapGenPipeline.logCounts(
                LAYER,
                String.format(
                        "requested=%d placed=%d skipped=%d starts=%d relaxEvents=%d "
                                + "minDist=%d avgDist=%.1f homeOwnPct=%.0f%% "
                                + "target=%d floor=%d inset=%d attempts=%d",
                        requested,
                        ctx.townSites.size(),
                        skipped,
                        countStarts(ctx.townSites),
                        relaxEvents,
                        distStats[0],
                        distStats[1] / 10.0,
                        homePctActual,
                        distTarget,
                        distFloor,
                        inset,
                        MapGenContext.LAYER_ATTEMPTS));
    }

    private static int defaultDist(String size) {
        return switch (size == null ? "" : size.toLowerCase()) {
            case "large" -> 24;
            case "giant" -> 30;
            default -> 18;
        };
    }

    private static int defaultFloor(String size) {
        return switch (size == null ? "" : size.toLowerCase()) {
            case "large" -> 18;
            case "giant" -> 22;
            default -> 14;
        };
    }

    private static Set<Integer> townNoTerrain(ReferenceData data) {
        Set<Integer> out = new LinkedHashSet<>();
        Object raw = MapConfig.raw(data, "town_no_terrain");
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

    private record TownPlan(int players, int[] startType, int[] ownExtras, List<Integer> randomTypes) {
        int requestedTotal() {
            int n = 0;
            for (int e : ownExtras) {
                n += 1 + e; // start + extras
            }
            return n + randomTypes.size();
        }
    }

    private static TownPlan buildPlan(MapGenContext ctx, Random rng) {
        TestGrid.MapPlaceConfig cfg = ctx.cfg;
        int players = Math.max(1, cfg.players());
        int per = Math.max(0, cfg.townsPerPlayer());
        int[] startType = new int[players];
        int[] ownExtras = new int[players];
        LinkedHashSet<Integer> playerTypes = new LinkedHashSet<>();
        for (int p = 0; p < players; p++) {
            int type =
                    TestGrid.resolvePlayerTownType(
                            cfg.playerTownTypes(), p, ctx.data, rng, playerTypes);
            playerTypes.add(type);
            startType[p] = type;
            ownExtras[p] = Math.max(0, per - 1);
        }
        List<Integer> nonPlayer = TestGrid.townTypesExcluding(ctx.data, playerTypes);
        if (nonPlayer.isEmpty()) {
            nonPlayer = TestGrid.allTownTypeIds(ctx.data);
        }
        List<Integer> randomTypes = new ArrayList<>();
        int lo = cfg.townsRandomMin();
        int hi = cfg.townsRandomMax();
        for (int p = 0; p < players; p++) {
            int extra = lo + (hi > lo ? rng.nextInt(hi - lo + 1) : 0);
            for (int n = 0; n < extra; n++) {
                if (nonPlayer.isEmpty()) {
                    break;
                }
                randomTypes.add(nonPlayer.get(rng.nextInt(nonPlayer.size())));
            }
        }
        return new TownPlan(players, startType, ownExtras, randomTypes);
    }

    private static List<int[]> buildValidCandidates(
            MapGenContext ctx, int inset, Set<Integer> noTerrain) {
        List<int[]> out = new ArrayList<>();
        HashMap<String, int[]> byKey = indexPlaceable(ctx.placeable);
        for (int[] entry : ctx.placeable) {
            if (WaterTerrain.onIsland(ctx, entry[0], entry[1])) {
                continue;
            }
            if (!isValidTownEntry(ctx, entry, inset, noTerrain, byKey, null)) {
                continue;
            }
            out.add(entry);
        }
        return out;
    }

    /**
     * Entry + keep within inset; neither on banned/blocker terrain; entry and
     * the hex in front (col+1, same row) walkable. Occupied reserved hexes
     * rejected via {@code reserved}.
     */
    private static boolean isValidTownEntry(
            MapGenContext ctx,
            int[] entry,
            int inset,
            Set<Integer> noTerrain,
            HashMap<String, int[]> byKey,
            boolean[][] reserved) {
        int col = entry[0];
        int row = entry[1];
        int leftCol = col - 1;
        if (leftCol < inset
                || col < inset
                || col >= ctx.width - inset
                || leftCol >= ctx.width - inset
                || row < inset
                || row >= ctx.height - inset) {
            return false;
        }
        if (!byKey.containsKey(HexCoords.colRowKey(leftCol, row))) {
            return false;
        }
        if (reserved != null
                && (reserved[row][col] || reserved[row][leftCol])) {
            return false;
        }
        if (!terrainOk(ctx, col, row, noTerrain) || !terrainOk(ctx, leftCol, row, noTerrain)) {
            return false;
        }
        // At least one drawbridge side needs a straight clear run for the spur
        // plus the join hex beyond it (road_spur_len + 1).
        int spurRoom = Math.max(1, MapConfig.cfgInt(ctx.data, "road_spur_len", ctx.sizeName(), 4)) + 1;
        Set<Integer> water = roadNoTerrain(ctx);
        boolean right = spurCorridor(ctx, col, row, 1, spurRoom, water);
        boolean left = spurCorridor(ctx, leftCol, row, -1, spurRoom, water);
        return right || left;
    }

    /** Straight same-row hexes out from {@code startCol}, not counting the start. */
    private static boolean spurCorridor(
            MapGenContext ctx, int startCol, int row, int dir, int len, Set<Integer> water) {
        if (startCol < 0 || startCol >= ctx.width) {
            return false;
        }
        for (int step = 1; step <= len; step++) {
            int col = startCol + dir * step;
            if (col < 0 || col >= ctx.width) {
                return false;
            }
            HexTerrain terrain = ctx.cells[row][col];
            if (terrain == null || water.contains(terrain.id()) || terrain.blocked()) {
                return false;
            }
        }
        return true;
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

    private static boolean terrainOk(MapGenContext ctx, int col, int row, Set<Integer> noTerrain) {
        HexTerrain t = ctx.cells[row][col];
        if (!t.isPassable() || t.movementCost() == null) {
            return false;
        }
        if (t.blocked()) {
            return false;
        }
        return !noTerrain.contains(t.id());
    }

    /**
     * Draw a random set of {@code players} start sites (shuffled candidates,
     * footprints not overlapping). Accept it when every pair is at least
     * {@code spacing} apart. {@link MapGenContext#LAYER_ATTEMPTS} draws per
     * spacing; then lower spacing by 1 down to {@code floor} and log it.
     */
    private static List<int[]> placeStartingTowns(
            List<int[]> candidates, int players, int spacingTarget, int floor, Random rng) {
        if (candidates.isEmpty() || players <= 0) {
            return List.of();
        }
        if (players == 1) {
            List<int[]> one = new ArrayList<>(candidates);
            Collections.shuffle(one, rng);
            return List.of(one.get(0));
        }
        List<int[]> pool = new ArrayList<>(candidates);
        for (int spacing = spacingTarget; spacing >= floor; spacing--) {
            for (int attempt = 0; attempt < MapGenContext.LAYER_ATTEMPTS; attempt++) {
                Collections.shuffle(pool, rng);
                List<int[]> picked = new ArrayList<>();
                for (int[] cand : pool) {
                    if (overlapsFootprint(picked, cand)) {
                        continue;
                    }
                    picked.add(cand);
                    if (picked.size() == players) {
                        break;
                    }
                }
                if (picked.size() < players || !allPairsAtLeast(picked, spacing)) {
                    continue;
                }
                if (spacing < spacingTarget) {
                    MapGenPipeline.logRelax(
                            LAYER,
                            "start_min_dist "
                                    + spacingTarget
                                    + " → "
                                    + spacing
                                    + " (floor="
                                    + floor
                                    + ")");
                }
                return picked;
            }
            if (spacing > floor) {
                MapGenPipeline.logRelax(
                        LAYER,
                        "no start set at dist="
                                + spacing
                                + " after "
                                + MapGenContext.LAYER_ATTEMPTS
                                + " attempts");
            }
        }
        MapGenPipeline.logRelax(
                LAYER, "no full start set at floor=" + floor + "; placing a partial random set");
        Collections.shuffle(pool, rng);
        List<int[]> picked = new ArrayList<>();
        for (int[] cand : pool) {
            if (overlapsFootprint(picked, cand) || !meetsStartSpacing(picked, cand, floor)) {
                continue;
            }
            picked.add(cand);
            if (picked.size() == players) {
                break;
            }
        }
        return picked;
    }

    private static boolean allPairsAtLeast(List<int[]> picked, int spacing) {
        for (int i = 0; i < picked.size(); i++) {
            for (int j = i + 1; j < picked.size(); j++) {
                if (townPairDistance(picked.get(i), picked.get(j)) < spacing) {
                    return false;
                }
            }
        }
        return true;
    }

    private static boolean meetsStartSpacing(List<int[]> picked, int[] cand, int spacing) {
        for (int[] other : picked) {
            if (townPairDistance(cand, other) < spacing) {
                return false;
            }
        }
        return true;
    }

    private static boolean overlapsFootprint(List<int[]> picked, int[] cand) {
        for (int[] other : picked) {
            if (Math.abs(cand[1] - other[1]) <= 1 && Math.abs(cand[0] - other[0]) <= 2) {
                return true;
            }
        }
        return false;
    }

    private static void logStartDistances(List<Placed> placed, int startInset, int startDist) {
        List<int[]> starts = new ArrayList<>();
        for (Placed p : placed) {
            if (p.site.starting()) {
                starts.add(p.entry);
            }
        }
        if (starts.size() < 2) {
            MapGenPipeline.logCounts(
                    LAYER, "starts=" + starts.size() + " startInset=" + startInset);
            return;
        }
        List<Integer> dists = new ArrayList<>();
        int min = Integer.MAX_VALUE;
        for (int i = 0; i < starts.size(); i++) {
            for (int j = i + 1; j < starts.size(); j++) {
                int d = townPairDistance(starts.get(i), starts.get(j));
                dists.add(d);
                min = Math.min(min, d);
            }
        }
        Collections.sort(dists);
        MapGenPipeline.logCounts(
                LAYER,
                "startPairs min="
                        + min
                        + " dists="
                        + dists
                        + " startMinDist="
                        + startDist
                        + " startInset="
                        + startInset);
    }

    /** Min hexDistance between any hex of town A and any hex of town B. */
    private static int townPairDistance(int[] entryA, int[] entryB) {
        int[][] a = townHexes(entryA);
        int[][] b = townHexes(entryB);
        int min = Integer.MAX_VALUE;
        for (int[] ha : a) {
            int aq = HexCoords.qOf(ha[0], ha[1]);
            int ar = ha[1];
            for (int[] hb : b) {
                int bq = HexCoords.qOf(hb[0], hb[1]);
                int br = hb[1];
                min = Math.min(min, HexCoords.hexDistance(aq, ar, bq, br));
            }
        }
        return min;
    }

    private static int[][] townHexes(int[] entry) {
        return new int[][] {
            {entry[0], entry[1]},
            {entry[0] - 1, entry[1]},
        };
    }

    private static int[][] voronoiOwners(MapGenContext ctx, List<Placed> starts) {
        int[][] owner = new int[ctx.height][ctx.width];
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                owner[row][col] = -1;
                if (starts.isEmpty()) {
                    continue;
                }
                int q = HexCoords.qOf(col, row);
                int r = row;
                int best = Integer.MAX_VALUE;
                int bestP = 0;
                for (int i = 0; i < starts.size(); i++) {
                    Placed s = starts.get(i);
                    if (!s.site.starting()) {
                        continue;
                    }
                    int sq = HexCoords.qOf(s.entry[0], s.entry[1]);
                    int sr = s.entry[1];
                    int d = HexCoords.hexDistance(q, r, sq, sr);
                    if (d < best || (d == best && s.site.playerIndex() < bestP)) {
                        best = d;
                        bestP = s.site.playerIndex();
                        owner[row][col] = bestP;
                    }
                }
            }
        }
        return owner;
    }

    private static boolean isContested(
            int[][] owner,
            List<Placed> starts,
            int col,
            int row,
            int player,
            int contestedSlack) {
        int q = HexCoords.qOf(col, row);
        int r = row;
        int dOwn = distToStart(starts, player, q, r);
        int dOther = distToNearestOtherStart(starts, player, q, r);
        if (dOther == Integer.MAX_VALUE) {
            return false;
        }
        return Math.abs(dOwn - dOther) <= contestedSlack;
    }

    private static int distToStart(List<Placed> starts, int player, int q, int r) {
        for (Placed s : starts) {
            if (s.site.starting() && s.site.playerIndex() == player) {
                int sq = HexCoords.qOf(s.entry[0], s.entry[1]);
                return HexCoords.hexDistance(q, r, sq, s.entry[1]);
            }
        }
        return Integer.MAX_VALUE;
    }

    private static int distToNearestOtherStart(List<Placed> starts, int player, int q, int r) {
        int best = Integer.MAX_VALUE;
        for (Placed s : starts) {
            if (!s.site.starting() || s.site.playerIndex() == player) {
                continue;
            }
            int sq = HexCoords.qOf(s.entry[0], s.entry[1]);
            best = Math.min(best, HexCoords.hexDistance(q, r, sq, s.entry[1]));
        }
        return best;
    }

    private record PlaceResult(boolean ok, int relaxSteps) {}

    /**
     * Each island that rolled a town consumes one random-type slot and places
     * it on the island. Failures go back to the mainland list.
     */
    private static List<Integer> placeIslandTowns(
            MapGenContext ctx,
            List<int[]> candidates,
            List<Placed> placed,
            int[][] owner,
            int contestedSlack,
            List<Integer> randomTypes,
            int distTarget,
            int distFloor,
            Random rng) {
        List<Integer> left = new ArrayList<>(randomTypes);
        if (ctx.islands == null || ctx.islands.isEmpty()) {
            return left;
        }
        int inset = Math.max(0, MapConfig.cfgInt(ctx.data, "town_edge_inset", ctx.sizeName(), 2));
        Set<Integer> noTerrain = townNoTerrain(ctx.data);
        HashMap<String, int[]> byKey = indexPlaceable(ctx.placeable);
        for (WaterTerrain.Island island : ctx.islands) {
            if (!island.wantsTown || left.isEmpty()) {
                continue;
            }
            int typeId = left.get(0);
            List<int[]> islandCandidates = new ArrayList<>();
            for (int[] entry : ctx.placeable) {
                if (ctx.islandIds == null || ctx.islandIds[entry[1]][entry[0]] != island.id) {
                    continue;
                }
                if (!isValidTownEntry(ctx, entry, inset, noTerrain, byKey, ctx.townReserved)) {
                    continue;
                }
                islandCandidates.add(entry);
            }
            PlaceResult result =
                    placeOne(
                            ctx,
                            islandCandidates,
                            placed,
                            owner,
                            -1,
                            false,
                            false,
                            contestedSlack,
                            typeId,
                            distTarget,
                            distFloor,
                            rng);
            if (result.ok) {
                left.remove(0);
                island.hasTown = true;
                removeCandidate(candidates, placed.get(placed.size() - 1).entry());
            }
        }
        return left;
    }

    private static PlaceResult placeOne(
            MapGenContext ctx,
            List<int[]> candidates,
            List<Placed> placed,
            int[][] owner,
            int playerIndex,
            boolean preferHome,
            boolean preferContested,
            int contestedSlack,
            int typeId,
            int distTarget,
            int distFloor,
            Random rng) {
        String name = takeName(ctx.names, typeId, rng);
        if (name == null) {
            MapGenPipeline.logRelax(LAYER, "skip town type=" + typeId + " (no name)");
            return new PlaceResult(false, 0);
        }
        int relaxSteps = 0;
        for (int spacing = distTarget; spacing >= distFloor; spacing--) {
            for (int attempt = 0; attempt < MapGenContext.LAYER_ATTEMPTS; attempt++) {
                int[] entry =
                        pickCandidate(
                                ctx,
                                candidates,
                                placed,
                                owner,
                                playerIndex,
                                preferHome,
                                preferContested,
                                contestedSlack,
                                spacing,
                                rng);
                if (entry == null) {
                    break;
                }
                if (!reserve(ctx, entry)) {
                    removeCandidate(candidates, entry);
                    continue;
                }
                TownSite site =
                        new TownSite(
                                entry[0],
                                entry[1],
                                name,
                                typeId,
                                false,
                                playerIndex);
                ctx.townSites.add(site);
                placed.add(new Placed(entry, site));
                removeCandidate(candidates, entry);
                // Also drop keep from candidates
                removeCandidate(candidates, new int[] {entry[0] - 1, entry[1]});
                if (spacing < distTarget) {
                    MapGenPipeline.logRelax(
                            LAYER,
                            "town type="
                                    + typeId
                                    + " player="
                                    + playerIndex
                                    + " spacing="
                                    + spacing
                                    + " (target="
                                    + distTarget
                                    + ")");
                }
                return new PlaceResult(true, relaxSteps);
            }
            if (spacing > distFloor) {
                relaxSteps++;
            }
        }
        MapGenPipeline.logRelax(
                LAYER,
                "skip town type="
                        + typeId
                        + " player="
                        + playerIndex
                        + " at floor="
                        + distFloor);
        return new PlaceResult(false, relaxSteps);
    }

    private static int[] pickCandidate(
            MapGenContext ctx,
            List<int[]> candidates,
            List<Placed> placed,
            int[][] owner,
            int playerIndex,
            boolean preferHome,
            boolean preferContested,
            int contestedSlack,
            int spacing,
            Random rng) {
        List<int[]> primary = new ArrayList<>();
        List<int[]> fallback = new ArrayList<>();
        for (int[] cand : candidates) {
            if (ctx.townReserved[cand[1]][cand[0]]
                    || (cand[0] > 0 && ctx.townReserved[cand[1]][cand[0] - 1])) {
                continue;
            }
            if (!meetsSpacing(cand, placed, spacing)) {
                continue;
            }
            boolean home =
                    playerIndex >= 0 && owner[cand[1]][cand[0]] == playerIndex;
            boolean contested =
                    playerIndex >= 0
                            && isContested(
                                    owner, placed, cand[0], cand[1], playerIndex, contestedSlack);
            // Random towns (playerIndex < 0): contested = near any two starts.
            if (playerIndex < 0) {
                contested = anyContested(owner, placed, cand[0], cand[1], contestedSlack);
            }
            if (preferHome && home) {
                primary.add(cand);
            } else if (preferContested && contested) {
                primary.add(cand);
            } else if (!preferHome && !preferContested) {
                primary.add(cand);
            } else {
                fallback.add(cand);
            }
        }
        List<int[]> pool = !primary.isEmpty() ? primary : fallback;
        if (pool.isEmpty()) {
            return null;
        }
        return pool.get(rng.nextInt(pool.size()));
    }

    private static boolean anyContested(
            int[][] owner, List<Placed> starts, int col, int row, int slack) {
        List<Integer> players = new ArrayList<>();
        for (Placed s : starts) {
            if (s.site.starting() && !players.contains(s.site.playerIndex())) {
                players.add(s.site.playerIndex());
            }
        }
        for (int p : players) {
            if (isContested(owner, starts, col, row, p, slack)) {
                return true;
            }
        }
        // Gap: not clearly deep inside one region — owner border-ish if
        // distance to 2nd nearest start is within slack of nearest.
        int q = HexCoords.qOf(col, row);
        int r = row;
        int best = Integer.MAX_VALUE;
        int second = Integer.MAX_VALUE;
        for (Placed s : starts) {
            if (!s.site.starting()) {
                continue;
            }
            int d =
                    HexCoords.hexDistance(
                            q, r, HexCoords.qOf(s.entry[0], s.entry[1]), s.entry[1]);
            if (d < best) {
                second = best;
                best = d;
            } else if (d < second) {
                second = d;
            }
        }
        return second < Integer.MAX_VALUE && (second - best) <= slack;
    }

    private static boolean meetsSpacing(int[] entry, List<Placed> placed, int spacing) {
        for (Placed p : placed) {
            if (townPairDistance(entry, p.entry) < spacing) {
                return false;
            }
        }
        return true;
    }

    private static boolean reserve(MapGenContext ctx, int[] entry) {
        int col = entry[0];
        int row = entry[1];
        int left = col - 1;
        if (left < 0 || row < 0 || row >= ctx.height || col >= ctx.width) {
            return false;
        }
        if (ctx.townReserved[row][col] || ctx.townReserved[row][left]) {
            return false;
        }
        ctx.townReserved[row][col] = true;
        ctx.townReserved[row][left] = true;
        // Remove from placeable list (identity or equal coords).
        ctx.placeable.removeIf(
                cr ->
                        (cr[0] == col && cr[1] == row)
                                || (cr[0] == left && cr[1] == row));
        return true;
    }

    private static void removeCandidate(List<int[]> candidates, int[] entry) {
        candidates.removeIf(c -> c[0] == entry[0] && c[1] == entry[1]);
    }

    private static HashMap<String, int[]> indexPlaceable(List<int[]> placeable) {
        HashMap<String, int[]> byKey = new HashMap<>();
        for (int[] cr : placeable) {
            byKey.put(HexCoords.colRowKey(cr[0], cr[1]), cr);
        }
        return byKey;
    }

    private static String takeName(TestGrid.TownNameSession names, int typeId, Random rng) {
        String name = names.take(typeId);
        if (name == null) {
            name = names.takeAny(rng);
        }
        return name;
    }

    private static int countStarts(List<TownSite> sites) {
        int n = 0;
        for (TownSite s : sites) {
            if (s.starting()) {
                n++;
            }
        }
        return n;
    }

    /** Returns {minDist*1, avgDist*10} for logging; minDist=0 if &lt;2 towns. */
    private static int[] pairwiseMinAvg(List<Placed> placed) {
        if (placed.size() < 2) {
            return new int[] {0, 0};
        }
        int min = Integer.MAX_VALUE;
        long sum = 0;
        int pairs = 0;
        for (int i = 0; i < placed.size(); i++) {
            for (int j = i + 1; j < placed.size(); j++) {
                int d = townPairDistance(placed.get(i).entry, placed.get(j).entry);
                min = Math.min(min, d);
                sum += d;
                pairs++;
            }
        }
        int avg10 = pairs == 0 ? 0 : (int) Math.round((sum * 10.0) / pairs);
        return new int[] {min == Integer.MAX_VALUE ? 0 : min, avg10};
    }

    private record Placed(int[] entry, TownSite site) {}
}
