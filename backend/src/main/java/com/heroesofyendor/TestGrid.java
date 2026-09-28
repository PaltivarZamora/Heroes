package com.heroesofyendor;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Seeded test grid via ordered {@linkplain MapGenPipeline generation layers}
 * (BR S9-18). Town placement uses spacing / home regions; a final reachability
 * pass carves blocker props or relocates walled-in towns.
 *
 * <p>World mobs are seeded on the frontend from the same passable set.
 *
 * <p>Map dimensions come from {@link MapSize} (New Game), not a hardcoded size.
 */
final class TestGrid {

    private static final Logger log = LoggerFactory.getLogger(TestGrid.class);

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final TypeReference<Map<String, Object>> MAP_TYPE =
            new TypeReference<>() {};

    static final int START_TOWN_TYPE_ID = 1;

    /** Min hex distance from any town hex (entry or keep) for fountains. */
    private static final int FOUNTAIN_MIN_TOWN_DIST = 10;

    /** Min hex distance between two signs. */
    private static final int SIGN_MIN_SEPARATION = 5;

    /** Warn when a single generation step exceeds this (ms). */
    private static final long STEP_WARN_MS = 15_000L;

    private static final int[][] AXIAL_NEIGHBORS = {
        {1, 0}, {1, -1}, {0, -1}, {-1, 0}, {-1, 1}, {0, 1},
    };

    private TestGrid() {
    }

    static TestGridResponse generate(ReferenceData data) {
        return generate(data, null, MapSize.fromName(data, MapConfig.defaultSizeName(data)), new int[0]);
    }

    static TestGridResponse generate(ReferenceData data, Integer players) {
        return generate(
                data, players, MapSize.fromName(data, MapConfig.defaultSizeName(data)), new int[0]);
    }

    static TestGridResponse generate(ReferenceData data, Integer players, MapSize mapSize) {
        return generate(data, players, mapSize, new int[0]);
    }

    static TestGridResponse generate(
            ReferenceData data, Integer players, MapSize mapSize, int[] playerTownTypes) {
        int seed = ThreadLocalRandom.current().nextInt(1, Integer.MAX_VALUE);
        return generate(seed, data, players, mapSize, playerTownTypes);
    }

    static TestGridResponse generate(int seed, ReferenceData data) {
        return generate(
                seed, data, null, MapSize.fromName(data, MapConfig.defaultSizeName(data)), new int[0]);
    }

    static TestGridResponse generate(int seed, ReferenceData data, Integer players) {
        return generate(
                seed,
                data,
                players,
                MapSize.fromName(data, MapConfig.defaultSizeName(data)),
                new int[0]);
    }

    static TestGridResponse generate(
            int seed, ReferenceData data, Integer players, MapSize mapSize) {
        return generate(seed, data, players, mapSize, new int[0]);
    }

    static TestGridResponse generate(
            int seed,
            ReferenceData data,
            Integer players,
            MapSize mapSize,
            int[] playerTownTypes) {
        MapSize size =
                mapSize != null
                        ? mapSize
                        : MapSize.fromName(data, MapConfig.defaultSizeName(data));
        long totalStart = System.nanoTime();
        log.info(
                "Map gen start: size={} ({}×{}) seed={}",
                size.name(),
                size.width(),
                size.height(),
                seed);
        try {
            TestGridResponse response =
                    generateTimed(seed, data, players, size, playerTownTypes);
            log.info(
                    "Map gen total: {} ms ({}×{} seed={})",
                    (System.nanoTime() - totalStart) / 1_000_000L,
                    size.width(),
                    size.height(),
                    seed);
            return response;
        } catch (RuntimeException e) {
            log.error(
                    "Map gen failed after {} ms ({}×{} seed={}): {}",
                    (System.nanoTime() - totalStart) / 1_000_000L,
                    size.width(),
                    size.height(),
                    seed,
                    e.toString());
            throw e;
        }
    }

    private static long msSince(long startNanos) {
        return (System.nanoTime() - startNanos) / 1_000_000L;
    }

    private static void logStep(String step, long startNanos) {
        long ms = msSince(startNanos);
        if (ms >= STEP_WARN_MS) {
            log.warn("Map gen step '{}' took {} ms (slow)", step, ms);
        } else {
            log.info("Map gen step '{}': {} ms", step, ms);
        }
    }

    private static TestGridResponse generateTimed(
            int seed,
            ReferenceData data,
            Integer players,
            MapSize size,
            int[] playerTownTypes) {
        MapGenContext ctx = new MapGenContext(seed, data, size, players, playerTownTypes);

        // 1. Terrain
        MapGenPipeline.runLayer(
                ctx,
                "terrain",
                WaterTerrain::paint);

        // 2. Towns (new rules)
        MapGenPipeline.runLayer(ctx, "towns", TownsLayer::run);

        // 3. Zones + walls
        MapGenPipeline.runLayer(ctx, "walls", WallsLayer::run);

        // 4. Roads (skipped while map_config.roads_enabled is 0)
        MapGenPipeline.runLayer(
                ctx,
                "roads",
                c -> {
                    c.hasRoad = new boolean[c.height][c.width];
                    c.roadMask = new int[c.height][c.width];
                    c.roadPaths = new ArrayList<>();
                    boolean enabled = MapConfig.cfgFlag(c.data, "roads_enabled", c.sizeName(), false);
                    if (!enabled) {
                        MapGenPipeline.logCounts("roads", "skipped (roads_enabled=0)");
                        return;
                    }
                    WorldRoads.run(c);
                });

        // 5a. Permanent buildings (existing placement rules, plus gap / terrain / adjacency).
        MapGenPipeline.runLayer(
                ctx,
                "features",
                c -> {
                    if (c.propSeeds == null) {
                        c.propSeeds = new WorldProps.Seed[c.height][c.width];
                        c.propBlocked = new boolean[c.height][c.width];
                    }
                    if (c.hasRoad == null) {
                        c.hasRoad = new boolean[c.height][c.width];
                        c.roadMask = new int[c.height][c.width];
                    }
                    c.featureRules = FeatureRules.load(c);
                    Random rng = c.rngFor("features");
                    List<int[]> featurePlaceable = openForFeatures(c);
                    c.objects =
                            placeBuildings(
                                    featurePlaceable,
                                    c.townSites,
                                    c.cells,
                                    c.hasRoad,
                                    c.width,
                                    c.height,
                                    rng,
                                    c.data,
                                    c.cfg,
                                    c);
                    WaterTerrain.ensureDocks(c);
                    c.placeable = featurePlaceable;
                    MapGenPipeline.logCounts(
                            "features",
                            "buildings="
                                    + c.objects.size()
                                    + " towns="
                                    + c.townSites.size());
                });

        // 5b. Branch roads to permanent buildings that are far from the interstate.
        MapGenPipeline.runLayer(ctx, "branch-roads", BranchRoads::run);

        // 5c–5e. Signs (need branches), mines, loose piles, chests.
        MapGenPipeline.runLayer(
                ctx,
                "features-spread",
                c -> {
                    if (c.featureRules == null) {
                        c.featureRules = FeatureRules.load(c);
                    }
                    Random rng = c.rngFor("features-spread");
                    placeSpread(c, rng);
                    MapGenPipeline.logCounts("features-spread", "objects=" + c.objects.size());
                });

        // 5g. Pocket loot, extra to the normal totals. Filler props live here.
        MapGenPipeline.runLayer(ctx, "pockets-loot", Pockets::fill);

        // Island loot is extra, after pockets. Also emits the S9-24 report.
        MapGenPipeline.runLayer(ctx, "island-loot", WaterTerrain::fillIslands);

        // 5f. Prop scatter, after features so blockers cannot seal a passage or an approach.
        MapGenPipeline.runLayer(
                ctx,
                "props",
                c -> {
                    if (c.featureRules == null) {
                        c.featureRules = FeatureRules.load(c);
                    }
                    c.propDefs = WorldProps.all(c.data);
                    double mult = MapConfig.cfgDouble(c.data, "prop_density_mult", c.sizeName(), 2.5);
                    int before = FeatureSpread.scatter(c, c.rngFor("props"), 1.0, false);
                    int after = FeatureSpread.scatter(c, c.rngFor("props"), mult, true);
                    c.featureRules.report(before, after, mult);
                    MapGenPipeline.logCounts(
                            "props", "before=" + before + " after=" + after + " mult=" + mult);
                });

        // 6. Random mobs — frontend (see report). Empty backend slot.
        MapGenPipeline.runLayer(
                ctx,
                "mobs",
                c -> MapGenPipeline.logCounts("mobs", "frontend (unchanged)"));

        // 7. Final reachability
        MapGenPipeline.runLayer(ctx, "final", FinalReachability::run);

        // Assemble tiles after final repairs (props may have been cleared).
        long t = System.nanoTime();
        java.util.HashSet<String> townLeftBlocked = new java.util.HashSet<>();
        for (MapObjectData obj : ctx.objects) {
            if (!"town".equals(obj.kind())) {
                continue;
            }
            townLeftBlocked.add((obj.q() - 1) + "," + obj.r());
        }
        List<TileData> tiles = new ArrayList<>(ctx.width * ctx.height);
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                HexTerrain terrain = ctx.cells[row][col];
                int q = col - offsetFromZero(row);
                int r = row;
                int chunkId = ctx.chunkIds[row][col];
                WorldProps.Seed prop = ctx.propSeeds[row][col];
                boolean blocked =
                        terrain.blocked()
                                || (prop != null && prop.blocker())
                                || townLeftBlocked.contains(q + "," + r);
                java.util.List<Integer> borders = null;
                if (ctx.wallBeside != null) {
                    java.util.List<Integer> beside = ctx.wallBeside.get(row * ctx.width + col);
                    if (beside != null && !beside.isEmpty()) {
                        borders = java.util.List.copyOf(beside);
                    }
                }
                tiles.add(
                        new TileData(
                                q,
                                r,
                                terrain.label(),
                                terrain.movementCost(),
                                blocked,
                                chunkId > 0 ? chunkId : null,
                                prop != null ? prop.propId() : null,
                                prop != null ? prop.variant() : null,
                                prop != null ? prop.fileName() : null,
                                ctx.hasRoad[row][col] ? Boolean.TRUE : null,
                                ctx.hasRoad[row][col]
                                        ? (ctx.roadMask == null ? 0 : ctx.roadMask[row][col])
                                        : null,
                                ctx.zoneIds != null && ctx.zoneIds[row][col] > 0
                                        ? ctx.zoneIds[row][col]
                                        : null,
                                ctx.wallGap != null && ctx.wallGap[row][col] ? Boolean.TRUE : null,
                                borders,
                                ctx.pocketIds != null && ctx.pocketIds[row][col] > 0
                                        ? ctx.pocketIds[row][col]
                                        : null,
                                ctx.pocketTiers != null && ctx.pocketIds != null && ctx.pocketIds[row][col] > 0
                                        ? ctx.pocketTiers[row][col]
                                        : null,
                                ctx.pocketEntrance != null && ctx.pocketEntrance[row][col]
                                        ? Boolean.TRUE
                                        : null,
                                ctx.islandGuardTier != null && ctx.islandGuardTier[row][col] > 0
                                        ? ctx.islandGuardTier[row][col]
                                        : null));
            }
        }
        List<List<TestGridResponse.RoadPoint>> roads = new ArrayList<>(ctx.roadPaths.size());
        for (List<int[]> path : ctx.roadPaths) {
            List<TestGridResponse.RoadPoint> pts = new ArrayList<>(path.size());
            for (int[] hex : path) {
                pts.add(new TestGridResponse.RoadPoint(hex[0], hex[1]));
            }
            roads.add(List.copyOf(pts));
        }
        TestGridResponse.RoadPlan roadPlan = roadPlan(ctx);
        logStep("assemble", t);
        return new TestGridResponse(
                seed, List.copyOf(tiles), List.copyOf(ctx.objects), List.copyOf(roads), roadPlan);
    }

    private static TestGridResponse.RoadPlan roadPlan(MapGenContext ctx) {
        if (ctx.roadDebugLinks.isEmpty()
                && ctx.roadDebugWashed.isEmpty()
                && ctx.roadDebugOrphans.isEmpty()) {
            return null;
        }
        List<TestGridResponse.RoadLink> links = new ArrayList<>(ctx.roadDebugLinks.size());
        for (MapGenContext.RoadDebugLink link : ctx.roadDebugLinks) {
            List<TestGridResponse.RoadPoint> hexes = new ArrayList<>(link.hexes.size());
            for (int[] hex : link.hexes) {
                hexes.add(new TestGridResponse.RoadPoint(hex[0], hex[1]));
            }
            links.add(new TestGridResponse.RoadLink(link.from, link.to, List.copyOf(hexes), link.branch));
        }
        return new TestGridResponse.RoadPlan(
                List.copyOf(links),
                copyPoints(ctx.roadDebugWashed),
                copyPoints(ctx.roadDebugOrphans));
    }

    private static List<TestGridResponse.RoadPoint> copyPoints(List<int[]> hexes) {
        List<TestGridResponse.RoadPoint> pts = new ArrayList<>(hexes.size());
        for (int[] hex : hexes) {
            pts.add(new TestGridResponse.RoadPoint(hex[0], hex[1]));
        }
        return List.copyOf(pts);
    }

    // Town placement lives in TownsLayer (BR S9-18).

    /**
     * Own-type / random-type queue builder (kept for reference / tests).
     */
    static List<Integer> buildTownTypeQueue(
            MapPlaceConfig cfg, ReferenceData data, Random rng, TownNameSession names) {
        List<Integer> queue = new ArrayList<>();
        java.util.LinkedHashSet<Integer> playerTypes = new java.util.LinkedHashSet<>();
        int players = Math.max(1, cfg.players());
        int per = Math.max(0, cfg.townsPerPlayer());
        for (int p = 0; p < players; p++) {
            int townType = resolvePlayerTownType(cfg.playerTownTypes(), p, data, rng, playerTypes);
            playerTypes.add(townType);
            for (int n = 0; n < per; n++) {
                queue.add(townType);
            }
        }
        List<Integer> nonPlayer = townTypesExcluding(data, playerTypes);
        if (nonPlayer.isEmpty()) {
            nonPlayer = allTownTypeIds(data);
        }
        int lo = cfg.townsRandomMin();
        int hi = cfg.townsRandomMax();
        for (int p = 0; p < players; p++) {
            int randomExtra =
                    lo + (hi > lo ? rng.nextInt(hi - lo + 1) : 0);
            for (int n = 0; n < randomExtra; n++) {
                if (nonPlayer.isEmpty()) {
                    break;
                }
                queue.add(nonPlayer.get(rng.nextInt(nonPlayer.size())));
            }
        }
        return queue;
    }

    static int resolvePlayerTownType(
            int[] playerTownTypes,
            int playerIndex,
            ReferenceData data,
            Random rng,
            java.util.Set<Integer> already) {
        if (playerTownTypes != null
                && playerIndex < playerTownTypes.length
                && playerTownTypes[playerIndex] > 0) {
            return playerTownTypes[playerIndex];
        }
        List<Integer> all = allTownTypeIds(data);
        if (all.isEmpty()) {
            return START_TOWN_TYPE_ID;
        }
        List<Integer> unused = new ArrayList<>();
        for (Integer id : all) {
            if (!already.contains(id)) {
                unused.add(id);
            }
        }
        List<Integer> pool = unused.isEmpty() ? all : unused;
        return pool.get(rng.nextInt(pool.size()));
    }

    static List<Integer> allTownTypeIds(ReferenceData data) {
        List<Integer> ids = new ArrayList<>();
        for (Map<String, Object> row : data.rows("town")) {
            Integer id = intId(row, "id");
            if (id != null && id > 0) {
                ids.add(id);
            }
        }
        return ids;
    }

    static List<Integer> townTypesExcluding(
            ReferenceData data, java.util.Set<Integer> exclude) {
        List<Integer> out = new ArrayList<>();
        for (Integer id : allTownTypeIds(data)) {
            if (!exclude.contains(id)) {
                out.add(id);
            }
        }
        return out;
    }

    /** Mark left+entry reserved and remove both from placeable. */
    private static boolean reserveTown2x1(
            List<int[]> placeable, boolean[][] townReserved, int[] entry) {
        java.util.HashMap<String, int[]> byKey = placeableIndex(placeable);
        if (!hasTownLeft(byKey, entry)) {
            return false;
        }
        int[] left = byKey.get((entry[0] - 1) + "," + entry[1]);
        placeable.remove(entry);
        placeable.remove(left);
        townReserved[entry[1]][entry[0]] = true;
        townReserved[left[1]][left[0]] = true;
        return true;
    }

    /** Passable hexes that are not a town footprint, a road, or an existing blocker (walls). */
    private static List<int[]> openForFeatures(MapGenContext ctx) {
        List<int[]> out = new ArrayList<>();
        for (int[] colRow : ctx.placeable) {
            int col = colRow[0];
            int row = colRow[1];
            if (ctx.propBlocked != null && ctx.propBlocked[row][col]) {
                continue;
            }
            if (ctx.townReserved != null && ctx.townReserved[row][col]) {
                continue;
            }
            if (ctx.hasRoad != null && ctx.hasRoad[row][col]) {
                continue;
            }
            if (Pockets.seals(ctx, col, row)) {
                continue;
            }
            if (WaterTerrain.onIsland(ctx, col, row)) {
                continue;
            }
            out.add(colRow);
        }
        return out;
    }

    /** 5a. Towns, then permanent buildings. Mines, piles, signs, and chests come later. */
    private static List<MapObjectData> placeBuildings(
            List<int[]> placeable,
            List<TownSite> townSites,
            HexTerrain[][] cells,
            boolean[][] hasRoad,
            int width,
            int height,
            Random rng,
            ReferenceData data,
            MapPlaceConfig cfg,
            MapGenContext gen) {
        List<MapObjectData> objects = new ArrayList<>();
        for (TownSite site : townSites) {
            int q = site.col() - offsetFromZero(site.row());
            int r = site.row();
            objects.add(
                    MapObjectData.basic(
                            q, r, "town", null, "T", site.name(), site.townTypeId(), site.flipped(), null));
        }
        placeLibraries(objects, placeable, townSites, cells, hasRoad, width, height, rng, data, cfg, gen);
        placeHangers(objects, placeable, townSites, cells, hasRoad, width, height, rng, data, cfg, gen);
        placeDocks(objects, placeable, cells, hasRoad, width, height, rng, data, cfg, gen);
        placeNoticeBoards(
                objects, placeable, townSites, cells, hasRoad, width, height, rng, data, cfg, gen);
        placeRecruitBuildings(
                objects, placeable, townSites, cells, hasRoad, width, height, rng, data, cfg, gen);
        placeFountains(objects, placeable, townSites, cells, width, height, rng, data, cfg, gen);
        return objects;
    }

    /** 5c–5e. Signs after branch roads, then mines, piles, chests. */
    private static void placeSpread(MapGenContext ctx, Random rng) {
        List<int[]> placeable = ctx.placeable;
        placeSigns(
                ctx.objects,
                placeable,
                ctx.cells,
                ctx.hasRoad,
                ctx.width,
                ctx.height,
                rng,
                ctx.data,
                ctx.cfg,
                ctx);
        FeatureSpread.placeMines(ctx, ctx.objects, placeable, rng);
        FeatureSpread.placePiles(ctx, ctx.objects, placeable, rng);
        placeChests(
                ctx.objects,
                placeable,
                ctx.townSites,
                ctx.cells,
                ctx.width,
                ctx.height,
                rng,
                ctx.data,
                ctx.cfg,
                ctx);
        noteFeatureCounts(ctx);
    }

    private static void noteFeatureCounts(MapGenContext ctx) {
        if (ctx.featureRules == null || ctx.cfg == null) {
            return;
        }
        FeatureRules rules = ctx.featureRules;
        MapPlaceConfig cfg = ctx.cfg;
        int starts = 0;
        for (TownSite site : ctx.townSites) {
            if (site.starting()) {
                starts++;
            }
        }
        rules.notes.add("library " + countKind(ctx, "library") + "/" + cfg.libraries());
        rules.notes.add("hanger " + countKind(ctx, "hanger") + "/" + cfg.hangers());
        rules.notes.add("dock " + countKind(ctx, "dock"));
        rules.notes.add("notice " + countKind(ctx, "notice_board") + "/" + starts);
        rules.notes.add("recruits " + countKind(ctx, "recruits") + "/" + cfg.recruits());
        rules.notes.add("fountain " + countKind(ctx, "fountain") + "/" + cfg.fountains());
        rules.notes.add("sign " + countKind(ctx, "sign") + "/" + cfg.signs());
        rules.notes.add("chest " + countKind(ctx, "chest") + "/" + cfg.chests());
    }

    private static int countKind(MapGenContext ctx, String kind) {
        int n = 0;
        for (MapObjectData obj : ctx.objects) {
            if (kind.equals(obj.kind())) {
                n++;
            }
        }
        return n;
    }

    private static boolean allowPermanent(
            MapGenContext ctx, List<MapObjectData> objects, int col, int row) {
        if (ctx == null || ctx.featureRules == null) {
            return true;
        }
        return ctx.featureRules.rejectPermanent(objects, col, row) == null;
    }

    private static boolean allowTemporary(
            MapGenContext ctx, List<MapObjectData> objects, int col, int row, String group) {
        if (ctx == null || ctx.featureRules == null) {
            return true;
        }
        return ctx.featureRules.rejectTemporary(objects, col, row, group) == null;
    }

    static int resourceScaledCount(
            Map<String, Object> resourceRow,
            String payloadKey,
            ReferenceData data,
            String sizeName,
            int fallbackNormal) {
        Object payloadRaw = MapConfig.decodeJsonb(resourceRow.get("payload"));
        Map<String, Object> payload = asMap(payloadRaw);
        Double normal = MapConfig.asDouble(payload.get(payloadKey));
        double n = normal != null ? normal : fallbackNormal;
        return MapConfig.scaledCount(data, sizeName, n);
    }

    /**
     * Notice Boards (BR S9-10). One per starting player, 6–8 hexes from that
     * player's starting town (linked permanently by town axial). Reachable land,
     * not on road/water, not adjacent to other features.
     */
    private static void placeNoticeBoards(
            List<MapObjectData> objects,
            List<int[]> placeable,
            List<TownSite> townSites,
            HexTerrain[][] cells,
            boolean[][] hasRoad,
            int width,
            int height,
            Random rng,
            ReferenceData data,
            MapPlaceConfig cfg,
            MapGenContext gen) {
        Integer typeId = featureTypeId(data, "quest");
        if (typeId == null) {
            log.warn("Notice Board placement: no feature_type named 'quest' — skipped");
            return;
        }
        Map<String, Object> featureRow = featureRowForType(data, typeId);
        if (featureRow == null) {
            log.warn("Notice Board placement: no feature rows for type 'quest' — skipped");
            return;
        }
        Map<String, Object> stats = asMap(featureRow.get("stats"));
        Map<String, Object> placement =
                stats != null ? asMap(stats.get("placement")) : null;
        int minHexes = Math.max(1, asIntOr(placement != null ? placement.get("min_hexes") : null, 6));
        int maxHexes = Math.max(minHexes, asIntOr(placement != null ? placement.get("max_hexes") : null, 8));
        boolean flippable = featureFlippable(data, typeId);

        int wantPlayers = Math.max(1, cfg.players());
        List<TownSite> starts = new ArrayList<>();
        for (TownSite site : townSites) {
            if (site.starting()) {
                starts.add(site);
            }
        }
        // Fallback: first N sites if starting flags missing (legacy).
        if (starts.isEmpty()) {
            int boardCount = Math.min(wantPlayers, townSites.size());
            for (int i = 0; i < boardCount; i++) {
                starts.add(townSites.get(i));
            }
        }
        int boardCount = Math.min(wantPlayers, starts.size());
        if (boardCount <= 0) {
            return;
        }

        java.util.HashSet<String> forbiddenAdj = new java.util.HashSet<>();
        java.util.HashSet<String> occupied = new java.util.HashSet<>();
        for (MapObjectData obj : objects) {
            occupied.add(obj.q() + "," + obj.r());
            if ("fountain".equals(obj.kind())
                    || "chest".equals(obj.kind())
                    || "sign".equals(obj.kind())
                    || "library".equals(obj.kind())
                    || "hanger".equals(obj.kind())
                    || "dock".equals(obj.kind())
                    || "recruits".equals(obj.kind())
                    || "notice_board".equals(obj.kind())) {
                forbiddenAdj.add(obj.q() + "," + obj.r());
            }
            if (obj.guardQ() != null && obj.guardR() != null) {
                forbiddenAdj.add(obj.guardQ() + "," + obj.guardR());
            }
        }

        int placed = 0;
        for (int i = 0; i < boardCount; i++) {
            TownSite site = starts.get(i);
            int townQ = site.col() - offsetFromZero(site.row());
            int townR = site.row();
            List<int[]> candidates = new ArrayList<>();
            for (int[] colRow : placeable) {
                int col = colRow[0];
                int row = colRow[1];
                if (hasRoad[row][col]) {
                    continue;
                }
                HexTerrain terrain = cells[row][col];
                if (!terrain.isPassable() || terrain.movementCost() == null) {
                    continue;
                }
                int q = col - offsetFromZero(row);
                int r = row;
                String key = q + "," + r;
                if (occupied.contains(key) || forbiddenAdj.contains(key)) {
                    continue;
                }
                int dist = hexDistance(q, r, townQ, townR);
                if (dist < minHexes || dist > maxHexes) {
                    continue;
                }
                if (!hasWalkableNeighbor(q, r, cells, width, height)) {
                    continue;
                }
                if (adjacentToAny(q, r, forbiddenAdj)) {
                    continue;
                }
                candidates.add(colRow);
            }
            Collections.shuffle(candidates, rng);
            boolean didPlace = false;
            for (int[] colRow : candidates) {
                int col = colRow[0];
                int row = colRow[1];
                int q = col - offsetFromZero(row);
                int r = row;
                String key = q + "," + r;
                if (occupied.contains(key) || adjacentToAny(q, r, forbiddenAdj)) {
                    continue;
                }
                if (!allowPermanent(gen, objects, col, row)) {
                    continue;
                }
                boolean flipped = flippable && rng.nextBoolean();
                objects.add(MapObjectData.noticeBoard(q, r, flipped, townQ, townR));
                occupied.add(key);
                forbiddenAdj.add(key);
                placeable.removeIf(cr -> cr[0] == col && cr[1] == row);
                placed++;
                didPlace = true;
                break;
            }
            if (!didPlace) {
                log.warn(
                        "Notice Board placement: no valid hex  for town '{}' at ({},{}) within {}–{}",
                        site.name(),
                        townQ,
                        townR,
                        minHexes,
                        maxHexes);
            }
        }
        log.info("Notice Board placement: placed {} board(s) for {} starting player(s)", placed, boardCount);
    }

    /**
     * Neutral fountains (BR S9-2). Count = max(1, round(area / 1024)). Never on
     * roads/water/impassable, always &gt;10 hexes from any town hex, and must have
     * a walkable neighbor. Does not set tile.blocked — pathing treats them like
     * mines (walk-onto destination only).
     */
    private static void placeFountains(
            List<MapObjectData> objects,
            List<int[]> placeable,
            List<TownSite> townSites,
            HexTerrain[][] cells,
            int width,
            int height,
            Random rng,
            ReferenceData data,
            MapPlaceConfig cfg,
            MapGenContext gen) {
        int want = Math.max(0, cfg.fountains());
        List<int[]> townHexes = new ArrayList<>(townSites.size() * 2);
        for (TownSite site : townSites) {
            int eq = site.col() - offsetFromZero(site.row());
            int er = site.row();
            townHexes.add(new int[] {eq, er});
            townHexes.add(new int[] {HexCoords.qOf(site.keepCol(), er), er});
        }
        List<int[]> candidates = new ArrayList<>();
        for (int[] colRow : placeable) {
            int col = colRow[0];
            int row = colRow[1];
            HexTerrain terrain = cells[row][col];
            if (!terrain.isPassable() || terrain.movementCost() == null) {
                continue;
            }
            int q = col - offsetFromZero(row);
            int r = row;
            if (!farFromTowns(q, r, townHexes)) {
                continue;
            }
            if (!hasWalkableNeighbor(q, r, cells, width, height)) {
                continue;
            }
            candidates.add(colRow);
        }
        Collections.shuffle(candidates, rng);
        int placed = 0;
        for (int[] colRow : candidates) {
            if (placed >= want) {
                break;
            }
            int col = colRow[0];
            int row = colRow[1];
            int q = col - offsetFromZero(row);
            int r = row;
            if (!allowPermanent(gen, objects, col, row)) {
                continue;
            }
            objects.add(MapObjectData.basic(q, r, "fountain", null, "F", "Fountain", null, false, null));
            placeable.removeIf(cr -> cr[0] == col && cr[1] == row);
            placed++;
        }
        int skipped = want - placed;
        if (skipped > 0) {
            log.warn(
                    "Fountain placement: placed {} of {} (skipped {} — not enough valid hexes)",
                    placed,
                    want,
                    skipped);
        } else {
            log.info("Fountain placement: placed {} fountain(s)", placed);
        }
    }

    /**
     * Chests. Count from {@code map_config.chests} × size_scale. Weighted
     * level roll from {@code chest_mix}. Loot rolled at generation. Each chest
     * reserves an adjacent guard hex plus one free approach neighbor. Chests
     * are never adjacent to each other and never share a guard hex.
     */
    private static void placeChests(
            List<MapObjectData> objects,
            List<int[]> placeable,
            List<TownSite> townSites,
            HexTerrain[][] cells,
            int width,
            int height,
            Random rng,
            ReferenceData data,
            MapPlaceConfig cfg,
            MapGenContext gen) {
        int want = Math.max(0, cfg.chests());
        List<ChestDef> defs = chestDefs(data);
        if (defs.isEmpty()) {
            log.warn("Chest placement: no feature rows for type 'chest' — skipped");
            return;
        }
        double[] weights = new double[4];
        for (int level = 1; level <= 4; level++) {
            weights[level - 1] = Math.max(0, cfg.chestMix().getOrDefault(level, 0));
        }
        double weightSum = 0;
        for (double w : weights) {
            weightSum += w;
        }
        if (weightSum <= 0) {
            weights[0] = 1;
            weightSum = 1;
        }

        List<int[]> townHexes = new ArrayList<>(townSites.size() * 2);
        for (TownSite site : townSites) {
            int eq = site.col() - offsetFromZero(site.row());
            int er = site.row();
            townHexes.add(new int[] {eq, er});
            townHexes.add(new int[] {HexCoords.qOf(site.keepCol(), er), er});
        }

        java.util.HashSet<String> occupied = new java.util.HashSet<>();
        for (MapObjectData obj : objects) {
            occupied.add(obj.q() + "," + obj.r());
        }

        List<int[]> candidates = new ArrayList<>();
        for (int[] colRow : placeable) {
            int col = colRow[0];
            int row = colRow[1];
            HexTerrain terrain = cells[row][col];
            if (!terrain.isPassable() || terrain.movementCost() == null) {
                continue;
            }
            int q = col - offsetFromZero(row);
            int r = row;
            if (occupied.contains(q + "," + r)) {
                continue;
            }
            if (hexDistanceToNearest(q, r, townHexes) < FOUNTAIN_MIN_TOWN_DIST) {
                continue;
            }
            candidates.add(colRow);
        }
        Collections.shuffle(candidates, rng);

        int placed = 0;
        java.util.HashSet<String> chestKeys = new java.util.HashSet<>();
        java.util.HashSet<String> guardKeys = new java.util.HashSet<>();

        for (int[] colRow : candidates) {
            if (placed >= want) {
                break;
            }
            int col = colRow[0];
            int row = colRow[1];
            int q = col - offsetFromZero(row);
            int r = row;
            String chestKey = q + "," + r;
            if (occupied.contains(chestKey) || chestKeys.contains(chestKey)) {
                continue;
            }
            if (adjacentToAny(q, r, chestKeys)) {
                continue;
            }
            if (!allowTemporary(gen, objects, col, row, "chest")) {
                continue;
            }
            List<int[]> neighbors = walkableNeighbors(q, r, cells, width, height, occupied, guardKeys);
            if (neighbors.size() < 2) {
                continue;
            }
            Collections.shuffle(neighbors, rng);
            int[] guard = neighbors.get(0);
            String guardKey = guard[0] + "," + guard[1];
            if (guardKeys.contains(guardKey) || chestKeys.contains(guardKey)) {
                continue;
            }
            int guardCol = guard[0] + offsetFromZero(guard[1]);
            if (gen.featureRules != null
                    && gen.featureRules.stealsLastApproach(objects, guardCol, guard[1], null)) {
                continue;
            }
            // Confirm a second free approach neighbor remains after taking the guard.
            boolean hasApproach = false;
            for (int i = 1; i < neighbors.size(); i++) {
                String nk = neighbors.get(i)[0] + "," + neighbors.get(i)[1];
                if (!guardKey.equals(nk) && !chestKeys.contains(nk) && !guardKeys.contains(nk)) {
                    hasApproach = true;
                    break;
                }
            }
            if (!hasApproach) {
                continue;
            }

            int level = rollChestLevel(rng, weights, weightSum);
            ChestDef def = defForLevel(defs, level);
            if (def == null) {
                continue;
            }
            List<MapObjectData.LootEntry> loot = rollChestLoot(def, rng);
            objects.add(
                    new MapObjectData(
                            q,
                            r,
                            "chest",
                            null,
                            "C",
                            def.name(),
                            null,
                            false,
                            null,
                            def.level(),
                            List.copyOf(loot),
                            guard[0],
                            guard[1],
                            null,
                            null,
                            null,
                            null,
                            null,
                            null));
            chestKeys.add(chestKey);
            guardKeys.add(guardKey);
            occupied.add(chestKey);
            occupied.add(guardKey);
            placeable.removeIf(
                    cr -> {
                        int cq = cr[0] - offsetFromZero(cr[1]);
                        int crR = cr[1];
                        return (cq == q && crR == r) || (cq == guard[0] && crR == guard[1]);
                    });
            placed++;
        }
        int skipped = want - placed;
        if (skipped > 0) {
            log.warn(
                    "Chest placement: placed {} of {} (skipped {} — not enough valid hexes)",
                    placed,
                    want,
                    skipped);
        } else {
            log.info("Chest placement: placed {} chest(s)", placed);
        }
    }

    /**
     * Signs (BR S9-4). Count = max(1, round(area/1024 × sign_density)). Each
     * sign sits on a non-road hex adjacent to a road, never on water/impassable,
     * with a walkable neighbor. Spread ≥5 hexes apart; not adjacent to
     * fountain/chest/guard hexes. Picks a weighted {@code sign_text} row at
     * generation (terrain category gated by own + adjacent terrain ids).
     */
    private static void placeSigns(
            List<MapObjectData> objects,
            List<int[]> placeable,
            HexTerrain[][] cells,
            boolean[][] hasRoad,
            int width,
            int height,
            Random rng,
            ReferenceData data,
            MapPlaceConfig cfg,
            MapGenContext gen) {
        Integer typeId = featureTypeId(data, "sign");
        if (typeId == null) {
            log.warn("Sign placement: no feature_type named 'sign' — skipped");
            return;
        }
        boolean hasFeature = false;
        for (Map<String, Object> row : data.rows("feature")) {
            Integer rowType = intId(row, "feature_type_id");
            if (typeId.equals(rowType)) {
                hasFeature = true;
                break;
            }
        }
        if (!hasFeature) {
            log.warn("Sign placement: no feature rows for type 'sign' — skipped");
            return;
        }
        List<SignTextDef> texts = signTextDefs(data);
        if (texts.isEmpty()) {
            log.warn("Sign placement: sign_text empty — skipped");
            return;
        }
        int want = Math.max(0, cfg.signs());
        boolean flippable = featureFlippable(data, typeId);

        java.util.HashSet<String> forbiddenAdj = new java.util.HashSet<>();
        java.util.HashSet<String> occupied = new java.util.HashSet<>();
        for (MapObjectData obj : objects) {
            occupied.add(obj.q() + "," + obj.r());
            if ("fountain".equals(obj.kind()) || "chest".equals(obj.kind())) {
                forbiddenAdj.add(obj.q() + "," + obj.r());
            }
            if (obj.guardQ() != null && obj.guardR() != null) {
                forbiddenAdj.add(obj.guardQ() + "," + obj.guardR());
            }
        }

        List<int[]> candidates = new ArrayList<>();
        for (int[] colRow : placeable) {
            int col = colRow[0];
            int row = colRow[1];
            if (hasRoad[row][col]) {
                continue;
            }
            HexTerrain terrain = cells[row][col];
            if (!terrain.isPassable() || terrain.movementCost() == null) {
                continue;
            }
            int q = col - offsetFromZero(row);
            int r = row;
            String key = q + "," + r;
            if (occupied.contains(key) || forbiddenAdj.contains(key)) {
                continue;
            }
            if (!adjacentToRoad(q, r, hasRoad, width, height)) {
                continue;
            }
            if (!hasWalkableNeighbor(q, r, cells, width, height)) {
                continue;
            }
            if (adjacentToAny(q, r, forbiddenAdj)) {
                continue;
            }
            candidates.add(colRow);
        }
        Collections.shuffle(candidates, rng);

        int placed = 0;
        java.util.HashSet<String> signKeys = new java.util.HashSet<>();
        for (int[] colRow : candidates) {
            if (placed >= want) {
                break;
            }
            int col = colRow[0];
            int row = colRow[1];
            int q = col - offsetFromZero(row);
            int r = row;
            String key = q + "," + r;
            if (signKeys.contains(key) || occupied.contains(key)) {
                continue;
            }
            if (hexDistanceToNearestKeys(q, r, signKeys) < SIGN_MIN_SEPARATION) {
                continue;
            }
            if (adjacentToAny(q, r, forbiddenAdj) || adjacentToAny(q, r, signKeys)) {
                continue;
            }
            if (!allowPermanent(gen, objects, col, row)) {
                continue;
            }
            java.util.HashSet<Integer> terrainIds = terrainIdsAtAndAdjacent(q, r, cells, width, height);
            Integer textId = pickSignTextId(texts, terrainIds, rng);
            if (textId == null) {
                continue;
            }
            boolean flipped = flippable && rng.nextBoolean();
            objects.add(
                    new MapObjectData(
                            q,
                            r,
                            "sign",
                            null,
                            "S",
                            "Sign",
                            null,
                            flipped,
                            null,
                            null,
                            null,
                            null,
                            null,
                            textId,
                            null,
                            null,
                            null,
                            null,
                            null));
            signKeys.add(key);
            occupied.add(key);
            placeable.removeIf(cr -> cr[0] == col && cr[1] == row);
            placed++;
        }
        int skipped = want - placed;
        if (skipped > 0) {
            log.warn(
                    "Sign placement: placed {} of {} (skipped {} — not enough valid hexes)",
                    placed,
                    want,
                    skipped);
        } else {
            log.info("Sign placement: placed {} sign(s)", placed);
        }
    }

    /**
     * World Libraries. Count from {@code map_config.libraries} × size_scale.
     * Prefer hexes near map centre (middle half when placing several). ≥10 from
     * towns, not on roads, walkable neighbor required, not adjacent to other
     * features. Ability ids rolled from disciplines of town types on this map.
     */
    private static void placeLibraries(
            List<MapObjectData> objects,
            List<int[]> placeable,
            List<TownSite> townSites,
            HexTerrain[][] cells,
            boolean[][] hasRoad,
            int width,
            int height,
            Random rng,
            ReferenceData data,
            MapPlaceConfig cfg,
            MapGenContext gen) {
        Integer typeId = featureTypeId(data, "library");
        if (typeId == null) {
            log.warn("Library placement: no feature_type named 'library' — skipped");
            return;
        }
        Map<String, Object> featureRow = null;
        for (Map<String, Object> row : data.rows("feature")) {
            Integer rowType = intId(row, "feature_type_id");
            if (typeId.equals(rowType)) {
                featureRow = row;
                break;
            }
        }
        if (featureRow == null) {
            log.warn("Library placement: no feature rows for library type — skipped");
            return;
        }
        Map<Integer, Integer> tierCounts = parseTierCounts(featureRow.get("stats"));
        if (tierCounts.isEmpty()) {
            log.warn("Library placement: stats.tier_counts missing — skipped");
            return;
        }
        int want = Math.max(0, cfg.libraries());
        boolean flippable = featureFlippable(data, typeId);

        List<int[]> townHexes = new ArrayList<>(townSites.size() * 2);
        java.util.HashSet<Integer> townTypeIds = new java.util.HashSet<>();
        for (TownSite site : townSites) {
            int eq = site.col() - offsetFromZero(site.row());
            int er = site.row();
            townHexes.add(new int[] {eq, er});
            townHexes.add(new int[] {HexCoords.qOf(site.keepCol(), er), er});
            townTypeIds.add(site.townTypeId());
        }
        List<Integer> disciplinePool = disciplinePoolForTownTypes(data, townTypeIds);
        if (disciplinePool.isEmpty()) {
            log.warn("Library placement: no disciplines for map town types — skipped");
            return;
        }

        java.util.HashSet<String> forbiddenAdj = new java.util.HashSet<>();
        java.util.HashSet<String> occupied = new java.util.HashSet<>();
        for (MapObjectData obj : objects) {
            occupied.add(obj.q() + "," + obj.r());
            if ("fountain".equals(obj.kind())
                    || "chest".equals(obj.kind())
                    || "sign".equals(obj.kind())
                    || "library".equals(obj.kind())) {
                forbiddenAdj.add(obj.q() + "," + obj.r());
            }
            if (obj.guardQ() != null && obj.guardR() != null) {
                forbiddenAdj.add(obj.guardQ() + "," + obj.guardR());
            }
        }

        // Centre of the odd-r map in axial space.
        int centerCol = width / 2;
        int centerRow = height / 2;
        int centerQ = centerCol - offsetFromZero(centerRow);
        int centerR = centerRow;
        int midColMin = width / 4;
        int midColMax = (width * 3) / 4;
        int midRowMin = height / 4;
        int midRowMax = (height * 3) / 4;

        List<int[]> candidates = new ArrayList<>();
        for (int[] colRow : placeable) {
            int col = colRow[0];
            int row = colRow[1];
            if (hasRoad[row][col]) {
                continue;
            }
            HexTerrain terrain = cells[row][col];
            if (!terrain.isPassable() || terrain.movementCost() == null) {
                continue;
            }
            int q = col - offsetFromZero(row);
            int r = row;
            String key = q + "," + r;
            if (occupied.contains(key) || forbiddenAdj.contains(key)) {
                continue;
            }
            if (hexDistanceToNearest(q, r, townHexes) < FOUNTAIN_MIN_TOWN_DIST) {
                continue;
            }
            if (!hasWalkableNeighbor(q, r, cells, width, height)) {
                continue;
            }
            if (adjacentToAny(q, r, forbiddenAdj)) {
                continue;
            }
            if (want > 1
                    && (col < midColMin
                            || col > midColMax
                            || row < midRowMin
                            || row > midRowMax)) {
                continue;
            }
            candidates.add(colRow);
        }
        candidates.sort(
                Comparator.comparingInt(
                        cr -> {
                            int q = cr[0] - offsetFromZero(cr[1]);
                            int r = cr[1];
                            return hexDistance(q, r, centerQ, centerR);
                        }));

        int placed = 0;
        java.util.HashSet<String> libraryKeys = new java.util.HashSet<>();
        final int librarySeparation = 10;
        for (int[] colRow : candidates) {
            if (placed >= want) {
                break;
            }
            int col = colRow[0];
            int row = colRow[1];
            int q = col - offsetFromZero(row);
            int r = row;
            String key = q + "," + r;
            if (libraryKeys.contains(key)) {
                continue;
            }
            if (hexDistanceToNearestKeys(q, r, libraryKeys) < librarySeparation) {
                continue;
            }
            if (adjacentToAny(q, r, forbiddenAdj) || adjacentToAny(q, r, libraryKeys)) {
                continue;
            }
            if (!allowPermanent(gen, objects, col, row)) {
                continue;
            }
            List<Integer> abilityIds =
                    rollWorldLibraryAbilities(data, disciplinePool, tierCounts, rng);
            if (abilityIds.isEmpty()) {
                log.warn("Library placement: rolled 0 abilities — stopping");
                break;
            }
            boolean flipped = flippable && rng.nextBoolean();
            objects.add(
                    new MapObjectData(
                            q,
                            r,
                            "library",
                            null,
                            "L",
                            "Library",
                            null,
                            flipped,
                            null,
                            null,
                            null,
                            null,
                            null,
                            null,
                            List.copyOf(abilityIds),
                            null,
                            null,
                            null,
                            null));
            libraryKeys.add(key);
            occupied.add(key);
            forbiddenAdj.add(key);
            placeable.removeIf(cr -> cr[0] == col && cr[1] == row);
            placed++;
        }
        int skipped = want - placed;
        if (skipped > 0) {
            log.warn(
                    "Library placement: placed {} of {} (skipped {} — not enough valid hexes)",
                    placed,
                    want,
                    skipped);
        } else {
            log.info("Library placement: placed {} library(ies)", placed);
        }
    }

    /**
     * World Hangers. Count from {@code map_config.hangers} × size_scale.
     * Random valid hex ≥10 from towns, not on roads, walkable
     * neighbor, not adjacent to other features. Departure-only flight point.
     */
    private static void placeHangers(
            List<MapObjectData> objects,
            List<int[]> placeable,
            List<TownSite> townSites,
            HexTerrain[][] cells,
            boolean[][] hasRoad,
            int width,
            int height,
            Random rng,
            ReferenceData data,
            MapPlaceConfig cfg,
            MapGenContext gen) {
        Integer typeId = featureTypeId(data, "hanger");
        if (typeId == null) {
            log.warn("Hanger placement: no feature_type named 'hanger' — skipped");
            return;
        }
        boolean hasFeature = false;
        for (Map<String, Object> row : data.rows("feature")) {
            Integer rowType = intId(row, "feature_type_id");
            if (typeId.equals(rowType)) {
                hasFeature = true;
                break;
            }
        }
        if (!hasFeature) {
            log.warn("Hanger placement: no feature rows for type 'hanger' — skipped");
            return;
        }
        int want = Math.max(0, cfg.hangers());
        if (want <= 0) {
            log.info("Hanger placement: hangers=0 — skipped");
            return;
        }
        boolean flippable = featureFlippable(data, typeId);

        List<int[]> townHexes = new ArrayList<>(townSites.size() * 2);
        for (TownSite site : townSites) {
            int eq = site.col() - offsetFromZero(site.row());
            int er = site.row();
            townHexes.add(new int[] {eq, er});
            townHexes.add(new int[] {HexCoords.qOf(site.keepCol(), er), er});
        }

        java.util.HashSet<String> forbiddenAdj = new java.util.HashSet<>();
        java.util.HashSet<String> occupied = new java.util.HashSet<>();
        for (MapObjectData obj : objects) {
            occupied.add(obj.q() + "," + obj.r());
            if ("fountain".equals(obj.kind())
                    || "chest".equals(obj.kind())
                    || "sign".equals(obj.kind())
                    || "library".equals(obj.kind())
                    || "hanger".equals(obj.kind())
                    || "dock".equals(obj.kind())) {
                forbiddenAdj.add(obj.q() + "," + obj.r());
            }
            if (obj.guardQ() != null && obj.guardR() != null) {
                forbiddenAdj.add(obj.guardQ() + "," + obj.guardR());
            }
        }

        List<int[]> candidates = new ArrayList<>();
        for (int[] colRow : placeable) {
            int col = colRow[0];
            int row = colRow[1];
            if (hasRoad[row][col]) {
                continue;
            }
            HexTerrain terrain = cells[row][col];
            if (!terrain.isPassable() || terrain.movementCost() == null) {
                continue;
            }
            int q = col - offsetFromZero(row);
            int r = row;
            String key = q + "," + r;
            if (occupied.contains(key) || forbiddenAdj.contains(key)) {
                continue;
            }
            if (hexDistanceToNearest(q, r, townHexes) < FOUNTAIN_MIN_TOWN_DIST) {
                continue;
            }
            if (!hasWalkableNeighbor(q, r, cells, width, height)) {
                continue;
            }
            if (adjacentToAny(q, r, forbiddenAdj)) {
                continue;
            }
            candidates.add(colRow);
        }
        Collections.shuffle(candidates, rng);

        int placed = 0;
        for (int[] colRow : candidates) {
            if (placed >= want) {
                break;
            }
            int col = colRow[0];
            int row = colRow[1];
            int q = col - offsetFromZero(row);
            int r = row;
            String key = q + "," + r;
            if (occupied.contains(key)) {
                continue;
            }
            if (!allowPermanent(gen, objects, col, row)) {
                continue;
            }
            boolean flipped = flippable && rng.nextBoolean();
            objects.add(
                    MapObjectData.basic(q, r, "hanger", null, "H", "Hanger", null, flipped, null));
            occupied.add(key);
            forbiddenAdj.add(key);
            placeable.removeIf(cr -> cr[0] == col && cr[1] == row);
            placed++;
        }
        int skipped = want - placed;
        if (skipped > 0) {
            log.warn(
                    "Hanger placement: placed {} of {} (skipped {} — not enough valid hexes)",
                    placed,
                    want,
                    skipped);
        } else {
            log.info("Hanger placement: placed {} hanger(s)", placed);
        }
    }

    /**
     * Docks (BR S9-8 + addendum). Flood-fill deep Water only into bodies;
     * Shallow does not count toward {@code dock_min_water} / {@code dock_water_per}
     * (Shallow is walkable). Place docks on true land — never Water, Shallow,
     * or any boat-sailable terrain — on shores that satisfy
     * {@code feature.terrain_rules.adjacent_terrain}, not on roads, with a
     * walkable approach, not adjacent to other features.
     * Count per body: {@code 1 + floor((size − dock_min_water) / dock_water_per)}.
     * Each dock stores a launch hex on adjacent deep Water in that body.
     */
    private static void placeDocks(
            List<MapObjectData> objects,
            List<int[]> placeable,
            HexTerrain[][] cells,
            boolean[][] hasRoad,
            int width,
            int height,
            Random rng,
            ReferenceData data,
            MapPlaceConfig cfg,
            MapGenContext gen) {
        Integer typeId = featureTypeId(data, "dock");
        if (typeId == null) {
            log.warn("Dock placement: no feature_type named 'dock' — skipped");
            return;
        }
        Map<String, Object> featureRow = featureRowForType(data, typeId);
        if (featureRow == null) {
            log.warn("Dock placement: no feature rows for type 'dock' — skipped");
            return;
        }
        List<Integer> adjacentTerrain = adjacentTerrainIds(featureRow.get("terrain_rules"));
        if (adjacentTerrain.isEmpty()) {
            log.warn("Dock placement: terrain_rules.adjacent_terrain empty — skipped");
            return;
        }
        Integer deepWaterId = terrainIdByName(data, "Water");
        if (deepWaterId == null) {
            deepWaterId = adjacentTerrain.get(0);
        }
        if (deepWaterId == null) {
            log.warn("Dock placement: no Water terrain id — skipped");
            return;
        }
        Integer shallowId = terrainIdByName(data, "Shallow");
        int minWater = Math.max(1, cfg.dockMinWater());
        int waterPer = Math.max(1, cfg.dockWaterPer());
        boolean flippable = featureFlippable(data, typeId);

        // Body size = deep Water hexes only (Shallow excluded).
        java.util.HashSet<Integer> bodyTerrainIds = new java.util.HashSet<>();
        bodyTerrainIds.add(deepWaterId);

        List<java.util.HashSet<String>> bodies =
                waterBodies(cells, width, height, bodyTerrainIds);
        log.info(
                "Dock placement: found {} deep-water body(ies) (min={}, per={})",
                bodies.size(),
                minWater,
                waterPer);
        for (int i = 0; i < bodies.size(); i++) {
            log.info(
                    "Dock placement: deep-water body #{} size={}",
                    i + 1,
                    bodies.get(i).size());
        }

        java.util.HashSet<String> forbiddenAdj = new java.util.HashSet<>();
        java.util.HashSet<String> occupied = new java.util.HashSet<>();
        for (MapObjectData obj : objects) {
            occupied.add(obj.q() + "," + obj.r());
            if ("fountain".equals(obj.kind())
                    || "chest".equals(obj.kind())
                    || "sign".equals(obj.kind())
                    || "library".equals(obj.kind())
                    || "hanger".equals(obj.kind())
                    || "dock".equals(obj.kind())) {
                forbiddenAdj.add(obj.q() + "," + obj.r());
            }
            if (obj.guardQ() != null && obj.guardR() != null) {
                forbiddenAdj.add(obj.guardQ() + "," + obj.guardR());
            }
            if (obj.launchQ() != null && obj.launchR() != null) {
                occupied.add(obj.launchQ() + "," + obj.launchR());
            }
        }

        int totalPlaced = 0;
        int bodyIndex = 0;
        for (java.util.HashSet<String> body : bodies) {
            bodyIndex++;
            int size = body.size();
            if (size < minWater) {
                continue;
            }
            int want = 1 + (size - minWater) / waterPer;
            List<int[]> candidates = new ArrayList<>();
            for (int[] colRow : placeable) {
                int col = colRow[0];
                int row = colRow[1];
                if (hasRoad[row][col]) {
                    continue;
                }
                HexTerrain terrain = cells[row][col];
                if (!terrain.isPassable() || terrain.movementCost() == null) {
                    continue;
                }
                // True land only — never Water, Shallow, or boat-sailable.
                if (isBoatSailableTerrain(terrain, deepWaterId, shallowId)) {
                    continue;
                }
                int q = col - offsetFromZero(row);
                int r = row;
                String key = q + "," + r;
                if (occupied.contains(key) || forbiddenAdj.contains(key)) {
                    continue;
                }
                if (!satisfiesAdjacentTerrain(q, r, adjacentTerrain, cells, width, height)) {
                    continue;
                }
                if (!adjacentToBodyTerrain(
                        q, r, body, adjacentTerrain, cells, width, height)) {
                    continue;
                }
                if (!hasWalkableNeighbor(q, r, cells, width, height)) {
                    continue;
                }
                if (adjacentToAny(q, r, forbiddenAdj)) {
                    continue;
                }
                int[] launch =
                        pickLaunchHex(q, r, body, deepWaterId, cells, width, height, occupied);
                if (launch == null) {
                    continue;
                }
                candidates.add(new int[] {col, row, launch[0], launch[1]});
            }
            if (candidates.isEmpty()) {
                log.warn(
                        "Dock placement: body #{} size={} has no valid shore — skipped",
                        bodyIndex,
                        size);
                continue;
            }

            java.util.HashSet<String> dockKeys = new java.util.HashSet<>();
            int placed = 0;
            while (placed < want && !candidates.isEmpty()) {
                int pick = farthestDockCandidate(candidates, dockKeys, rng);
                int[] chosen = candidates.remove(pick);
                int col = chosen[0];
                int row = chosen[1];
                int q = col - offsetFromZero(row);
                int r = row;
                int lq = chosen[2];
                int lr = chosen[3];
                String key = q + "," + r;
                String launchKey = lq + "," + lr;
                if (occupied.contains(key) || occupied.contains(launchKey)) {
                    continue;
                }
                if (adjacentToAny(q, r, forbiddenAdj) || adjacentToAny(q, r, dockKeys)) {
                    continue;
                }
                if (!allowPermanent(gen, objects, col, row)) {
                    continue;
                }
                boolean flipped = flippable && rng.nextBoolean();
                objects.add(
                        new MapObjectData(
                                q,
                                r,
                                "dock",
                                null,
                                "D",
                                "Dock",
                                null,
                                flipped,
                                null,
                                null,
                                null,
                                null,
                                null,
                                null,
                                null,
                                lq,
                                lr,
                                null,
                                null));
                occupied.add(key);
                occupied.add(launchKey);
                forbiddenAdj.add(key);
                dockKeys.add(key);
                placeable.removeIf(cr -> cr[0] == col && cr[1] == row);
                placed++;
                totalPlaced++;
            }
            if (placed < want) {
                log.warn(
                        "Dock placement: body #{} size={} placed {} of {} (not enough shores)",
                        bodyIndex,
                        size,
                        placed,
                        want);
            } else {
                log.info(
                        "Dock placement: body #{} size={} → {} dock(s)",
                        bodyIndex,
                        size,
                        placed);
            }
        }
        log.info("Dock placement: placed {} dock(s) total", totalPlaced);
    }

    /** Water or Shallow — boats sail both; docks must not stand on either. */
    private static boolean isBoatSailableTerrain(
            HexTerrain terrain, Integer deepWaterId, Integer shallowId) {
        int id = terrain.id();
        if (deepWaterId != null && deepWaterId.equals(id)) {
            return true;
        }
        if (shallowId != null && shallowId.equals(id)) {
            return true;
        }
        String name = terrain.label();
        return name != null
                && ("water".equalsIgnoreCase(name) || "shallow".equalsIgnoreCase(name));
    }

    /**
     * Recruits for Hire. Count from {@code map_config.recruits} × size_scale.
     * ≥10 from towns, not on roads, walkable neighbor, not adjacent to other features. Spread ≥10
     * apart. {@code flippable=false} on the feature row → never mirrored.
     * Unit offer is rolled on the frontend (session), not here.
     */
    private static void placeRecruitBuildings(
            List<MapObjectData> objects,
            List<int[]> placeable,
            List<TownSite> townSites,
            HexTerrain[][] cells,
            boolean[][] hasRoad,
            int width,
            int height,
            Random rng,
            ReferenceData data,
            MapPlaceConfig cfg,
            MapGenContext gen) {
        Integer typeId = featureTypeId(data, "recruit_building");
        if (typeId == null) {
            log.warn("Recruit placement: no feature_type named 'recruit_building' — skipped");
            return;
        }
        if (featureRowForType(data, typeId) == null) {
            log.warn("Recruit placement: no feature rows for type 'recruit_building' — skipped");
            return;
        }
        int want = Math.max(0, cfg.recruits());
        boolean flippable = featureFlippable(data, typeId);

        List<int[]> townHexes = new ArrayList<>(townSites.size() * 2);
        for (TownSite site : townSites) {
            int eq = site.col() - offsetFromZero(site.row());
            int er = site.row();
            townHexes.add(new int[] {eq, er});
            townHexes.add(new int[] {HexCoords.qOf(site.keepCol(), er), er});
        }

        java.util.HashSet<String> forbiddenAdj = new java.util.HashSet<>();
        java.util.HashSet<String> occupied = new java.util.HashSet<>();
        for (MapObjectData obj : objects) {
            occupied.add(obj.q() + "," + obj.r());
            if ("fountain".equals(obj.kind())
                    || "chest".equals(obj.kind())
                    || "sign".equals(obj.kind())
                    || "library".equals(obj.kind())
                    || "hanger".equals(obj.kind())
                    || "dock".equals(obj.kind())
                    || "recruits".equals(obj.kind())
                    || "notice_board".equals(obj.kind())) {
                forbiddenAdj.add(obj.q() + "," + obj.r());
            }
            if (obj.guardQ() != null && obj.guardR() != null) {
                forbiddenAdj.add(obj.guardQ() + "," + obj.guardR());
            }
        }

        List<int[]> candidates = new ArrayList<>();
        for (int[] colRow : placeable) {
            int col = colRow[0];
            int row = colRow[1];
            if (hasRoad[row][col]) {
                continue;
            }
            HexTerrain terrain = cells[row][col];
            if (!terrain.isPassable() || terrain.movementCost() == null) {
                continue;
            }
            int q = col - offsetFromZero(row);
            int r = row;
            String key = q + "," + r;
            if (occupied.contains(key) || forbiddenAdj.contains(key)) {
                continue;
            }
            if (hexDistanceToNearest(q, r, townHexes) < FOUNTAIN_MIN_TOWN_DIST) {
                continue;
            }
            if (!hasWalkableNeighbor(q, r, cells, width, height)) {
                continue;
            }
            if (adjacentToAny(q, r, forbiddenAdj)) {
                continue;
            }
            candidates.add(colRow);
        }
        Collections.shuffle(candidates, rng);

        java.util.HashSet<String> recruitKeys = new java.util.HashSet<>();
        final int separation = 10;
        int placed = 0;
        for (int[] colRow : candidates) {
            if (placed >= want) {
                break;
            }
            int col = colRow[0];
            int row = colRow[1];
            int q = col - offsetFromZero(row);
            int r = row;
            String key = q + "," + r;
            if (occupied.contains(key)) {
                continue;
            }
            if (hexDistanceToNearestKeys(q, r, recruitKeys) < separation) {
                continue;
            }
            if (adjacentToAny(q, r, forbiddenAdj) || adjacentToAny(q, r, recruitKeys)) {
                continue;
            }
            if (!allowPermanent(gen, objects, col, row)) {
                continue;
            }
            boolean flipped = flippable && rng.nextBoolean();
            objects.add(
                    MapObjectData.basic(
                            q, r, "recruits", null, "R", "Recruits for Hire", null, flipped, null));
            occupied.add(key);
            forbiddenAdj.add(key);
            recruitKeys.add(key);
            placeable.removeIf(cr -> cr[0] == col && cr[1] == row);
            placed++;
        }
        int skipped = want - placed;
        if (skipped > 0) {
            log.warn(
                    "Recruit placement: placed {} of {} (skipped {} — not enough valid hexes)",
                    placed,
                    want,
                    skipped);
        } else {
            log.info("Recruit placement: placed {} recruit building(s)", placed);
        }
    }

    /** Flood-fill connected deep-Water regions (axial keys {@code q,r}). */
    private static List<java.util.HashSet<String>> waterBodies(
            HexTerrain[][] cells,
            int width,
            int height,
            java.util.Set<Integer> terrainIds) {
        boolean[][] seen = new boolean[height][width];
        List<java.util.HashSet<String>> bodies = new ArrayList<>();
        for (int row = 0; row < height; row++) {
            for (int col = 0; col < width; col++) {
                if (seen[row][col]) {
                    continue;
                }
                HexTerrain terrain = cells[row][col];
                if (!terrainIds.contains(terrain.id())) {
                    seen[row][col] = true;
                    continue;
                }
                java.util.HashSet<String> body = new java.util.HashSet<>();
                java.util.ArrayDeque<int[]> queue = new java.util.ArrayDeque<>();
                queue.add(new int[] {col, row});
                seen[row][col] = true;
                while (!queue.isEmpty()) {
                    int[] cur = queue.poll();
                    int c = cur[0];
                    int r = cur[1];
                    int q = c - offsetFromZero(r);
                    body.add(q + "," + r);
                    for (int[] delta : AXIAL_NEIGHBORS) {
                        int nq = q + delta[0];
                        int nr = r + delta[1];
                        int ncol = nq + offsetFromZero(nr);
                        if (nr < 0 || nr >= height || ncol < 0 || ncol >= width) {
                            continue;
                        }
                        if (seen[nr][ncol]) {
                            continue;
                        }
                        if (!terrainIds.contains(cells[nr][ncol].id())) {
                            seen[nr][ncol] = true;
                            continue;
                        }
                        seen[nr][ncol] = true;
                        queue.add(new int[] {ncol, nr});
                    }
                }
                bodies.add(body);
            }
        }
        return bodies;
    }

    /**
     * Generic {@code terrain_rules.adjacent_terrain}: land hex must neighbor at
     * least one listed terrain id (read from the feature row, not hardcoded).
     */
    private static boolean satisfiesAdjacentTerrain(
            int q,
            int r,
            List<Integer> requiredIds,
            HexTerrain[][] cells,
            int width,
            int height) {
        if (requiredIds == null || requiredIds.isEmpty()) {
            return true;
        }
        java.util.HashSet<Integer> want = new java.util.HashSet<>(requiredIds);
        for (int[] delta : AXIAL_NEIGHBORS) {
            int nq = q + delta[0];
            int nr = r + delta[1];
            int ncol = nq + offsetFromZero(nr);
            if (nr < 0 || nr >= height || ncol < 0 || ncol >= width) {
                continue;
            }
            if (want.contains(cells[nr][ncol].id())) {
                return true;
            }
        }
        return false;
    }

    /** Neighbor in {@code body} whose terrain id is in {@code terrainIds}. */
    private static boolean adjacentToBodyTerrain(
            int q,
            int r,
            java.util.Set<String> body,
            List<Integer> terrainIds,
            HexTerrain[][] cells,
            int width,
            int height) {
        java.util.HashSet<Integer> want = new java.util.HashSet<>(terrainIds);
        for (int[] delta : AXIAL_NEIGHBORS) {
            int nq = q + delta[0];
            int nr = r + delta[1];
            String nk = nq + "," + nr;
            if (!body.contains(nk)) {
                continue;
            }
            int ncol = nq + offsetFromZero(nr);
            if (nr < 0 || nr >= height || ncol < 0 || ncol >= width) {
                continue;
            }
            if (want.contains(cells[nr][ncol].id())) {
                return true;
            }
        }
        return false;
    }

    private static int[] pickLaunchHex(
            int q,
            int r,
            java.util.Set<String> body,
            Integer deepWaterId,
            HexTerrain[][] cells,
            int width,
            int height,
            java.util.Set<String> occupied) {
        if (deepWaterId == null) {
            return null;
        }
        List<int[]> options = new ArrayList<>();
        for (int[] delta : AXIAL_NEIGHBORS) {
            int nq = q + delta[0];
            int nr = r + delta[1];
            String nk = nq + "," + nr;
            if (!body.contains(nk) || occupied.contains(nk)) {
                continue;
            }
            int ncol = nq + offsetFromZero(nr);
            if (nr < 0 || nr >= height || ncol < 0 || ncol >= width) {
                continue;
            }
            if (deepWaterId.equals(cells[nr][ncol].id())) {
                options.add(new int[] {nq, nr});
            }
        }
        if (options.isEmpty()) {
            return null;
        }
        return options.get(0);
    }

    /** Prefer the candidate farthest from already-chosen docks on this body. */
    private static int farthestDockCandidate(
            List<int[]> candidates, java.util.Set<String> dockKeys, Random rng) {
        if (dockKeys.isEmpty()) {
            return rng.nextInt(candidates.size());
        }
        int bestIdx = 0;
        int bestDist = -1;
        for (int i = 0; i < candidates.size(); i++) {
            int[] c = candidates.get(i);
            int q = c[0] - offsetFromZero(c[1]);
            int r = c[1];
            int d = hexDistanceToNearestKeys(q, r, dockKeys);
            if (d > bestDist) {
                bestDist = d;
                bestIdx = i;
            }
        }
        return bestIdx;
    }

    private static Map<String, Object> featureRowForType(ReferenceData data, int typeId) {
        for (Map<String, Object> row : data.rows("feature")) {
            Integer rowType = intId(row, "feature_type_id");
            if (rowType != null && rowType == typeId) {
                return row;
            }
        }
        return null;
    }

    private static Integer terrainIdByName(ReferenceData data, String name) {
        for (Map<String, Object> row : data.rows("terrain")) {
            if (name.equalsIgnoreCase(stringVal(row, "name"))) {
                return intId(row, "id");
            }
        }
        return null;
    }

    /**
     * Read {@code terrain_rules.adjacent_terrain} (list of terrain ids) from a
     * feature row. Empty when missing — callers decide whether to skip.
     */
    private static List<Integer> adjacentTerrainIds(Object rawRules) {
        Map<String, Object> rules = asMap(rawRules);
        if (rules.isEmpty()) {
            return List.of();
        }
        Object raw = rules.get("adjacent_terrain");
        if (!(raw instanceof List<?> list)) {
            return List.of();
        }
        List<Integer> out = new ArrayList<>();
        for (Object entry : list) {
            if (entry instanceof Number n) {
                int id = n.intValue();
                if (id > 0) {
                    out.add(id);
                }
            } else if (entry != null) {
                try {
                    int id = Integer.parseInt(entry.toString().trim());
                    if (id > 0) {
                        out.add(id);
                    }
                } catch (NumberFormatException ignored) {
                    // skip
                }
            }
        }
        return out;
    }

    private static Map<Integer, Integer> parseTierCounts(Object rawStats) {
        Map<String, Object> stats = asMap(rawStats);
        Map<Integer, Integer> out = new LinkedHashMap<>();
        if (stats == null) {
            return out;
        }
        Object raw = stats.get("tier_counts");
        if (!(raw instanceof Map<?, ?> map)) {
            return out;
        }
        for (Map.Entry<?, ?> e : map.entrySet()) {
            if (e.getKey() == null) {
                continue;
            }
            Integer tier;
            try {
                tier = Integer.parseInt(e.getKey().toString().trim());
            } catch (NumberFormatException ex) {
                continue;
            }
            Integer count = asInt(e.getValue());
            if (tier == null || count == null || tier < 1 || count < 1) {
                continue;
            }
            out.put(tier, count);
        }
        return out;
    }

    private static List<Integer> disciplinePoolForTownTypes(
            ReferenceData data, java.util.Set<Integer> townTypeIds) {
        java.util.HashSet<Integer> classIds = new java.util.HashSet<>();
        for (Map<String, Object> row : data.rows("hero_type")) {
            Integer townId = intId(row, "town_id");
            Integer id = intId(row, "id");
            if (id != null && townId != null && townTypeIds.contains(townId)) {
                classIds.add(id);
            }
        }
        java.util.LinkedHashSet<Integer> disciplines = new java.util.LinkedHashSet<>();
        for (Map<String, Object> row : data.rows("hero_discipline")) {
            Integer heroId = intId(row, "hero_id");
            Integer disciplineId = intId(row, "discipline_id");
            if (heroId != null && disciplineId != null && classIds.contains(heroId)) {
                disciplines.add(disciplineId);
            }
        }
        return new ArrayList<>(disciplines);
    }

    /**
     * Prefer unused disciplines; within a discipline pick a random ability of
     * the requested tier. No duplicate ability ids within one Library.
     */
    private static List<Integer> rollWorldLibraryAbilities(
            ReferenceData data,
            List<Integer> disciplinePool,
            Map<Integer, Integer> tierCounts,
            Random rng) {
        Map<Integer, Map<Integer, List<Integer>>> byDiscTier = new LinkedHashMap<>();
        for (Map<String, Object> row : data.rows("ability")) {
            Integer id = intId(row, "id");
            Integer disc = intId(row, "discipline_id");
            Integer level = intId(row, "level_id");
            if (id == null || disc == null || level == null) {
                continue;
            }
            byDiscTier
                    .computeIfAbsent(disc, k -> new LinkedHashMap<>())
                    .computeIfAbsent(level, k -> new ArrayList<>())
                    .add(id);
        }
        java.util.HashSet<Integer> usedAbilities = new java.util.HashSet<>();
        java.util.HashSet<Integer> usedDisciplines = new java.util.HashSet<>();
        List<Integer> picked = new ArrayList<>();
        List<Integer> tiers = new ArrayList<>(tierCounts.keySet());
        tiers.sort(Integer::compareTo);
        for (Integer tier : tiers) {
            int want = tierCounts.getOrDefault(tier, 0);
            int got = 0;
            for (int n = 0; n < want; n++) {
                Integer abilityId =
                        pickLibraryAbility(
                                disciplinePool,
                                byDiscTier,
                                tier,
                                usedAbilities,
                                usedDisciplines,
                                rng);
                if (abilityId == null) {
                    break;
                }
                picked.add(abilityId);
                usedAbilities.add(abilityId);
                got++;
            }
            if (got < want) {
                log.warn(
                        "Library ability roll: tier {} wanted {} got {} (shortfall {})",
                        tier,
                        want,
                        got,
                        want - got);
            }
        }
        return picked;
    }

    private static Integer pickLibraryAbility(
            List<Integer> disciplinePool,
            Map<Integer, Map<Integer, List<Integer>>> byDiscTier,
            int tier,
            java.util.Set<Integer> usedAbilities,
            java.util.Set<Integer> usedDisciplines,
            Random rng) {
        List<Integer> fresh = new ArrayList<>();
        List<Integer> any = new ArrayList<>();
        for (Integer disc : disciplinePool) {
            List<Integer> pool =
                    availableAbilities(byDiscTier, disc, tier, usedAbilities);
            if (pool.isEmpty()) {
                continue;
            }
            any.add(disc);
            if (!usedDisciplines.contains(disc)) {
                fresh.add(disc);
            }
        }
        List<Integer> chooseFrom = !fresh.isEmpty() ? fresh : any;
        if (chooseFrom.isEmpty()) {
            return null;
        }
        Integer disc = chooseFrom.get(rng.nextInt(chooseFrom.size()));
        List<Integer> pool = availableAbilities(byDiscTier, disc, tier, usedAbilities);
        if (pool.isEmpty()) {
            return null;
        }
        Integer abilityId = pool.get(rng.nextInt(pool.size()));
        usedDisciplines.add(disc);
        // Once every discipline has been used, allow repeats by clearing.
        if (usedDisciplines.containsAll(disciplinePool)) {
            usedDisciplines.clear();
        }
        return abilityId;
    }

    private static List<Integer> availableAbilities(
            Map<Integer, Map<Integer, List<Integer>>> byDiscTier,
            Integer disc,
            int tier,
            java.util.Set<Integer> usedAbilities) {
        Map<Integer, List<Integer>> byTier = byDiscTier.get(disc);
        if (byTier == null) {
            return List.of();
        }
        List<Integer> pool = byTier.get(tier);
        if (pool == null || pool.isEmpty()) {
            return List.of();
        }
        List<Integer> available = new ArrayList<>();
        for (Integer id : pool) {
            if (!usedAbilities.contains(id)) {
                available.add(id);
            }
        }
        return available;
    }

    private record SignTextDef(int id, String category, Integer terrainId, int weight) {}

    private static List<SignTextDef> signTextDefs(ReferenceData data) {
        List<SignTextDef> out = new ArrayList<>();
        for (Map<String, Object> row : data.rows("sign_text")) {
            Integer id = intId(row, "id");
            if (id == null) {
                continue;
            }
            String category = stringVal(row, "category").toLowerCase();
            if (category.isEmpty()) {
                continue;
            }
            Integer terrainId = intId(row, "terrain_id");
            int weight = Math.max(1, asIntOr(row.get("weight"), 1));
            out.add(new SignTextDef(id, category, terrainId, weight));
        }
        return out;
    }

    private static Integer pickSignTextId(
            List<SignTextDef> texts, java.util.Set<Integer> terrainIds, Random rng) {
        List<SignTextDef> eligible = new ArrayList<>();
        for (SignTextDef def : texts) {
            if ("terrain".equals(def.category())) {
                if (def.terrainId() == null || !terrainIds.contains(def.terrainId())) {
                    continue;
                }
            }
            eligible.add(def);
        }
        if (eligible.isEmpty()) {
            return null;
        }
        int sum = 0;
        for (SignTextDef def : eligible) {
            sum += def.weight();
        }
        int roll = rng.nextInt(Math.max(1, sum));
        int acc = 0;
        for (SignTextDef def : eligible) {
            acc += def.weight();
            if (roll < acc) {
                return def.id();
            }
        }
        return eligible.get(eligible.size() - 1).id();
    }

    private static java.util.HashSet<Integer> terrainIdsAtAndAdjacent(
            int q, int r, HexTerrain[][] cells, int width, int height) {
        java.util.HashSet<Integer> ids = new java.util.HashSet<>();
        addTerrainId(ids, q, r, cells, width, height);
        for (int[] delta : AXIAL_NEIGHBORS) {
            addTerrainId(ids, q + delta[0], r + delta[1], cells, width, height);
        }
        return ids;
    }

    private static void addTerrainId(
            java.util.Set<Integer> ids,
            int q,
            int r,
            HexTerrain[][] cells,
            int width,
            int height) {
        int col = q + offsetFromZero(r);
        if (r < 0 || r >= height || col < 0 || col >= width) {
            return;
        }
        ids.add(cells[r][col].id());
    }

    private static boolean adjacentToRoad(
            int q, int r, boolean[][] hasRoad, int width, int height) {
        for (int[] delta : AXIAL_NEIGHBORS) {
            int nq = q + delta[0];
            int nr = r + delta[1];
            int ncol = nq + offsetFromZero(nr);
            if (nr < 0 || nr >= height || ncol < 0 || ncol >= width) {
                continue;
            }
            if (hasRoad[nr][ncol]) {
                return true;
            }
        }
        return false;
    }

    private static int hexDistanceToNearestKeys(int q, int r, java.util.Set<String> keys) {
        int best = Integer.MAX_VALUE;
        for (String key : keys) {
            int comma = key.indexOf(',');
            if (comma < 0) {
                continue;
            }
            try {
                int oq = Integer.parseInt(key.substring(0, comma));
                int or = Integer.parseInt(key.substring(comma + 1));
                int d = hexDistance(q, r, oq, or);
                if (d < best) {
                    best = d;
                }
            } catch (NumberFormatException ignored) {
                // skip
            }
        }
        return best;
    }

    private static Integer featureTypeId(ReferenceData data, String name) {
        for (Map<String, Object> row : data.rows("feature_type")) {
            if (name.equalsIgnoreCase(stringVal(row, "name"))) {
                return intId(row, "id");
            }
        }
        return null;
    }

    private static boolean featureFlippable(ReferenceData data, int typeId) {
        for (Map<String, Object> row : data.rows("feature")) {
            Integer rowType = intId(row, "feature_type_id");
            if (rowType == null || rowType != typeId) {
                continue;
            }
            Object flag = row.get("flippable");
            if (flag == null) {
                return true;
            }
            if (flag instanceof Boolean b) {
                return b;
            }
            String s = flag.toString().trim();
            return !"false".equalsIgnoreCase(s) && !"0".equals(s);
        }
        return true;
    }

    private record ChestDef(
            String name,
            int level,
            List<Integer> resourcePool,
            int resourcePicks,
            int resourceQty) {}

    private static List<ChestDef> chestDefs(ReferenceData data) {
        Integer typeId = null;
        for (Map<String, Object> row : data.rows("feature_type")) {
            if ("chest".equalsIgnoreCase(stringVal(row, "name"))) {
                typeId = intId(row, "id");
                break;
            }
        }
        List<ChestDef> out = new ArrayList<>();
        for (Map<String, Object> row : data.rows("feature")) {
            Integer rowType = intId(row, "feature_type_id");
            if (typeId != null && (rowType == null || !typeId.equals(rowType))) {
                continue;
            }
            Map<String, Object> stats = asMap(row.get("stats"));
            if (stats == null) {
                continue;
            }
            Integer level = asInt(stats.get("level"));
            if (level == null || level < 1) {
                continue;
            }
            List<Integer> pool = asIntList(stats.get("resource_pool"));
            int picks = Math.max(0, asIntOr(stats.get("resource_picks"), 0));
            int qty = Math.max(0, asIntOr(stats.get("resource_qty"), 0));
            String name = stringVal(row, "name");
            if (name.isEmpty()) {
                name = "Chest";
            }
            out.add(new ChestDef(name, level, pool, picks, qty));
        }
        out.sort(Comparator.comparingInt(ChestDef::level));
        return out;
    }

    private static ChestDef defForLevel(List<ChestDef> defs, int level) {
        for (ChestDef def : defs) {
            if (def.level() == level) {
                return def;
            }
        }
        return defs.isEmpty() ? null : defs.get(0);
    }

    /**
     * Pocket chest. No separate guard hex — the pocket entrance mob is the guard.
     */
    static MapObjectData makeChest(int col, int row, int level, Random rng, ReferenceData data) {
        ChestDef def = defForLevel(chestDefs(data), level);
        if (def == null) {
            return null;
        }
        int q = col - offsetFromZero(row);
        return new MapObjectData(
                q,
                row,
                "chest",
                null,
                "C",
                def.name(),
                null,
                false,
                null,
                def.level(),
                List.copyOf(rollChestLoot(def, rng)),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null);
    }

    private static int rollChestLevel(Random rng, double[] weights, double sum) {
        double roll = rng.nextDouble() * sum;
        double acc = 0;
        for (int i = 0; i < weights.length; i++) {
            acc += weights[i];
            if (roll < acc) {
                return i + 1;
            }
        }
        return weights.length;
    }

    private static List<MapObjectData.LootEntry> rollChestLoot(ChestDef def, Random rng) {
        List<Integer> pool = new ArrayList<>(def.resourcePool());
        Collections.shuffle(pool, rng);
        int picks = Math.min(def.resourcePicks(), pool.size());
        List<MapObjectData.LootEntry> loot = new ArrayList<>(picks);
        for (int i = 0; i < picks; i++) {
            loot.add(new MapObjectData.LootEntry(pool.get(i), def.resourceQty()));
        }
        return loot;
    }

    private static boolean adjacentToAny(int q, int r, java.util.Set<String> keys) {
        for (int[] delta : AXIAL_NEIGHBORS) {
            if (keys.contains((q + delta[0]) + "," + (r + delta[1]))) {
                return true;
            }
        }
        return false;
    }

    private static int hexDistanceToNearest(int q, int r, List<int[]> hexes) {
        int best = Integer.MAX_VALUE;
        for (int[] h : hexes) {
            int d = hexDistance(q, r, h[0], h[1]);
            if (d < best) {
                best = d;
            }
        }
        return best;
    }

    private static List<int[]> walkableNeighbors(
            int q,
            int r,
            HexTerrain[][] cells,
            int width,
            int height,
            java.util.Set<String> occupied,
            java.util.Set<String> guardKeys) {
        List<int[]> out = new ArrayList<>();
        for (int[] delta : AXIAL_NEIGHBORS) {
            int nq = q + delta[0];
            int nr = r + delta[1];
            String nk = nq + "," + nr;
            if (occupied.contains(nk) || guardKeys.contains(nk)) {
                continue;
            }
            int ncol = nq + offsetFromZero(nr);
            if (nr < 0 || nr >= height || ncol < 0 || ncol >= width) {
                continue;
            }
            HexTerrain n = cells[nr][ncol];
            if (n.isPassable() && n.movementCost() != null) {
                out.add(new int[] {nq, nr});
            }
        }
        return out;
    }

    private static Map<String, Object> asMap(Object raw) {
        Object value = decodeJsonb(raw);
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> out = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : map.entrySet()) {
                if (e.getKey() != null) {
                    out.put(e.getKey().toString(), e.getValue());
                }
            }
            return out;
        }
        if (value instanceof String s) {
            String trimmed = s.trim();
            if (trimmed.startsWith("{")) {
                try {
                    return JSON.readValue(trimmed, MAP_TYPE);
                } catch (Exception ignored) {
                    return null;
                }
            }
        }
        return null;
    }

    private static Integer asInt(Object raw) {
        if (raw instanceof Number n) {
            return n.intValue();
        }
        if (raw == null) {
            return null;
        }
        try {
            return Integer.parseInt(raw.toString().trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static int asIntOr(Object raw, int fallback) {
        Integer n = asInt(raw);
        return n == null ? fallback : n;
    }

    private static List<Integer> asIntList(Object raw) {
        List<Integer> out = new ArrayList<>();
        if (!(raw instanceof List<?> list)) {
            return out;
        }
        for (Object item : list) {
            Integer n = asInt(item);
            if (n != null) {
                out.add(n);
            }
        }
        return out;
    }

    private static double configDouble(ReferenceData data, String key, double fallback) {
        for (Map<String, Object> row : data.rows("app_config")) {
            if (!key.equals(stringVal(row, "key"))) {
                continue;
            }
            Object raw = row.get("value");
            if (raw instanceof Number n) {
                double value = n.doubleValue();
                return Double.isFinite(value) ? value : fallback;
            }
            if (raw == null) {
                return fallback;
            }
            try {
                double value = Double.parseDouble(raw.toString().trim());
                return Double.isFinite(value) ? value : fallback;
            } catch (NumberFormatException ignored) {
                return fallback;
            }
        }
        return fallback;
    }

    private static boolean farFromTowns(int q, int r, List<int[]> townHexes) {
        for (int[] th : townHexes) {
            if (hexDistance(q, r, th[0], th[1]) <= FOUNTAIN_MIN_TOWN_DIST) {
                return false;
            }
        }
        return true;
    }

    private static boolean hasWalkableNeighbor(
            int q, int r, HexTerrain[][] cells, int width, int height) {
        for (int[] delta : AXIAL_NEIGHBORS) {
            int nq = q + delta[0];
            int nr = r + delta[1];
            int ncol = nq + offsetFromZero(nr);
            if (nr < 0 || nr >= height || ncol < 0 || ncol >= width) {
                continue;
            }
            HexTerrain n = cells[nr][ncol];
            if (n.isPassable() && n.movementCost() != null) {
                return true;
            }
        }
        return false;
    }

    /**
     * Pick the right (drawbridge/entry) hex of a 2×1 town pair in the map
     * interior (away from the edge). Left hex (col-1, same row) must also be
     * placeable. Falls back to any valid pair if the interior band is empty.
     */
    private static int[] pickInteriorTownEntry(
            List<int[]> passable, Random rng, int width, int height) {
        int margin = Math.max(2, Math.min(width, height) / 12);
        java.util.HashMap<String, int[]> byKey = placeableIndex(passable);
        List<int[]> interior = new ArrayList<>();
        List<int[]> any = new ArrayList<>();
        for (int[] colRow : passable) {
            if (!hasTownLeft(byKey, colRow)) {
                continue;
            }
            any.add(colRow);
            int col = colRow[0];
            int row = colRow[1];
            if (col >= margin
                    && col < width - margin
                    && row >= margin
                    && row < height - margin) {
                interior.add(colRow);
            }
        }
        List<int[]> pool = !interior.isEmpty() ? interior : any;
        if (pool.isEmpty()) {
            return null;
        }
        Collections.shuffle(pool, rng);
        return pool.get(0);
    }

    private static java.util.HashMap<String, int[]> placeableIndex(List<int[]> passable) {
        java.util.HashMap<String, int[]> byKey = new java.util.HashMap<>();
        for (int[] colRow : passable) {
            byKey.put(colRow[0] + "," + colRow[1], colRow);
        }
        return byKey;
    }

    /** Entry (right) has a placeable left neighbor on the same row. */
    private static boolean hasTownLeft(java.util.HashMap<String, int[]> byKey, int[] entry) {
        return byKey.containsKey((entry[0] - 1) + "," + entry[1]);
    }

    private static int hexDistance(int aq, int ar, int bq, int br) {
        int dq = aq - bq;
        int dr = ar - br;
        return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    }

    /**
     * In-memory shuffle-and-consume of {@code town_name_pool} for one generate()
     * call (one game). Names are never written back to the database.
     */
    static final class TownNameSession {
        private final Map<Integer, List<String>> remaining = new LinkedHashMap<>();
        private final int startTownId;

        private TownNameSession(int startTownId) {
            this.startTownId = startTownId;
        }

        static TownNameSession from(ReferenceData data, Random rng) {
            List<Map<String, Object>> towns = data.rows("town");
            int startTownId = resolveStartTownTypeId(towns);
            TownNameSession session = new TownNameSession(startTownId);
            for (Map<String, Object> row : data.rows("town_name_pool")) {
                Object idObj = row.get("town_id");
                Object nameObj = row.get("name");
                if (!(idObj instanceof Number) || nameObj == null) {
                    continue;
                }
                int townId = ((Number) idObj).intValue();
                session
                        .remaining
                        .computeIfAbsent(townId, key -> new ArrayList<>())
                        .add(nameObj.toString());
            }
            for (List<String> names : session.remaining.values()) {
                Collections.shuffle(names, rng);
            }
            return session;
        }

        TownPick takePreferredStart(Random rng) {
            int townId = startTownId;
            if (!hasName(townId)) {
                Integer any = pickTownId(rng);
                if (any == null) {
                    return null;
                }
                townId = any;
            }
            String name = take(townId);
            if (name == null) {
                return null;
            }
            return new TownPick(townId, name);
        }

        Integer pickTownId(Random rng) {
            if (hasName(startTownId)) {
                return startTownId;
            }
            List<Integer> ids = new ArrayList<>();
            for (Map.Entry<Integer, List<String>> entry : remaining.entrySet()) {
                if (!entry.getValue().isEmpty()) {
                    ids.add(entry.getKey());
                }
            }
            if (ids.isEmpty()) {
                return null;
            }
            Collections.shuffle(ids, rng);
            return ids.get(0);
        }

        String take(int townId) {
            List<String> names = remaining.get(townId);
            if (names == null || names.isEmpty()) {
                return null;
            }
            return names.remove(0);
        }

        /** Any remaining name from any town type (last-resort label). */
        String takeAny(Random rng) {
            List<Integer> ids = new ArrayList<>();
            for (Map.Entry<Integer, List<String>> entry : remaining.entrySet()) {
                if (!entry.getValue().isEmpty()) {
                    ids.add(entry.getKey());
                }
            }
            if (ids.isEmpty()) {
                return null;
            }
            return take(ids.get(rng.nextInt(ids.size())));
        }

        boolean hasName(int townId) {
            List<String> names = remaining.get(townId);
            return names != null && !names.isEmpty();
        }

        private static int resolveStartTownTypeId(List<Map<String, Object>> towns) {
            for (Map<String, Object> row : towns) {
                if (row.get("id") instanceof Number id && id.intValue() == START_TOWN_TYPE_ID) {
                    return START_TOWN_TYPE_ID;
                }
            }
            if (!towns.isEmpty() && towns.get(0).get("id") instanceof Number id) {
                return id.intValue();
            }
            return START_TOWN_TYPE_ID;
        }
    }

    private record TownPick(int townTypeId, String name) {}

    record MapPlaceConfig(
            String sizeName,
            int players,
            int townsPerPlayer,
            int townsRandomMin,
            int townsRandomMax,
            int[] playerTownTypes,
            int fountains,
            int chests,
            int signs,
            int libraries,
            int hangers,
            int recruits,
            int dockMinWater,
            int dockWaterPer,
            Map<Integer, Integer> chestMix) {}

    static MapPlaceConfig mapPlaceConfig(
            ReferenceData data,
            MapSize size,
            Integer playersParam,
            int[] playerTownTypes) {
        String sizeName = size.name();
        int players =
                playersParam != null && playersParam > 0
                        ? playersParam
                        : Math.max(1, MapConfig.cfgInt(data, "new_players", sizeName, 1));
        int per = Math.max(0, MapConfig.cfgInt(data, "towns_per_player", sizeName, 3));
        int[] randRange = MapConfig.cfgIntRange(data, "towns_random", sizeName, 1, 1);
        return new MapPlaceConfig(
                sizeName,
                players,
                per,
                randRange[0],
                randRange[1],
                playerTownTypes != null ? playerTownTypes : new int[0],
                MapConfig.scaledCfgInt(data, "fountains", sizeName, 6),
                MapConfig.scaledCfgInt(data, "chests", sizeName, 24),
                MapConfig.scaledCfgInt(data, "signs", sizeName, 24),
                MapConfig.scaledCfgInt(data, "libraries", sizeName, 2),
                MapConfig.scaledCfgInt(data, "hangers", sizeName, 3),
                MapConfig.scaledCfgInt(data, "recruits", sizeName, 12),
                MapConfig.cfgInt(data, "dock_min_water", sizeName, 36),
                MapConfig.cfgInt(data, "dock_water_per", sizeName, 250),
                MapConfig.chestMix(data));
    }

    private static int configInt(ReferenceData data, String key, int fallback) {
        for (Map<String, Object> row : data.rows("app_config")) {
            if (!key.equals(stringVal(row, "key"))) {
                continue;
            }
            Object raw = row.get("value");
            if (raw instanceof Number n) {
                double value = n.doubleValue();
                if (Double.isFinite(value)) {
                    return Math.max(0, (int) Math.floor(value));
                }
                return fallback;
            }
            if (raw == null) {
                return fallback;
            }
            try {
                double value = Double.parseDouble(raw.toString().trim());
                if (Double.isFinite(value)) {
                    return Math.max(0, (int) Math.floor(value));
                }
            } catch (NumberFormatException ignored) {
                return fallback;
            }
            return fallback;
        }
        return fallback;
    }

    static List<Map<String, Object>> resourceRows(ReferenceData data) {
        List<Map<String, Object>> rows = new ArrayList<>(data.rows("resource"));
        rows.sort(Comparator.comparingInt(row -> {
            Integer id = intId(row, "id");
            return id == null ? Integer.MAX_VALUE : id;
        }));
        return rows;
    }

    private static Integer intId(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value instanceof Number n ? n.intValue() : null;
    }

    private static String stringVal(Map<String, Object> row, String key) {
        Object value = row.get(key);
        return value == null ? "" : value.toString();
    }

    static MapObjectData objectAt(
            int[] colRow,
            String kind,
            int resourceId,
            String resourceName,
            Random rng,
            ReferenceData data) {
        int col = colRow[0];
        int row = colRow[1];
        int q = col - offsetFromZero(row);
        int r = row;
        String marker =
                "mine".equals(kind)
                        ? Resource.mineMarker(resourceId, resourceName)
                        : Resource.pickupMarker(resourceId, resourceName);
        boolean flipped = false;
        if (featureFlippable(data, resourceId, kind) && rng.nextBoolean()) {
            flipped = true;
        }
        Integer qty = null;
        if ("pickup".equals(kind)) {
            qty = rollLooseQty(data, resourceId, rng);
        }
        return MapObjectData.basic(q, r, kind, resourceId, marker, null, null, flipped, qty);
    }

    /**
     * One-time pile amount from {@code resource.payload.loose_min}–{@code loose_max}
     * (inclusive). Falls back to 1 if payload is missing.
     */
    private static int rollLooseQty(ReferenceData data, int resourceId, Random rng) {
        int min = 1;
        int max = 1;
        for (Map<String, Object> row : data.rows("resource")) {
            Integer id = intId(row, "id");
            if (id == null || id != resourceId) {
                continue;
            }
            int[] range = looseRange(row.get("payload"));
            min = range[0];
            max = range[1];
            break;
        }
        if (max < min) {
            max = min;
        }
        if (max == min) {
            return min;
        }
        return min + rng.nextInt(max - min + 1);
    }

    /** Returns {@code [loose_min, loose_max]} from resource.payload JSONB/map. */
    private static int[] looseRange(Object payload) {
        Object decoded = decodeJsonb(payload);
        int min = 1;
        int max = 1;
        if (decoded instanceof Map<?, ?> raw) {
            @SuppressWarnings("unchecked")
            Map<String, Object> map = (Map<String, Object>) raw;
            Integer lo = intId(map, "loose_min");
            Integer hi = intId(map, "loose_max");
            if (lo != null) {
                min = Math.max(0, lo);
            }
            if (hi != null) {
                max = Math.max(min, hi);
            } else {
                max = min;
            }
            return new int[] {min, max};
        }
        if (decoded instanceof String text) {
            String trimmed = text.trim();
            if (trimmed.startsWith("{")) {
                Integer lo = jsonInt(trimmed, "loose_min");
                Integer hi = jsonInt(trimmed, "loose_max");
                if (lo != null) {
                    min = Math.max(0, lo);
                }
                if (hi != null) {
                    max = Math.max(min, hi);
                } else {
                    max = min;
                }
            }
        }
        return new int[] {min, max};
    }

    /** Unwrap PGobject / JSON string payloads from JDBC ColumnMapRowMapper. */
    private static Object decodeJsonb(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Map || value instanceof List) {
            return value;
        }
        if (value instanceof String text) {
            String trimmed = text.trim();
            if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                return trimmed;
            }
            return value;
        }
        try {
            Object raw = value.getClass().getMethod("getValue").invoke(value);
            if (raw instanceof String text) {
                String trimmed = text.trim();
                if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                    return trimmed;
                }
            }
            return raw;
        } catch (ReflectiveOperationException ignored) {
            return value;
        }
    }

    private static Integer jsonInt(String json, String key) {
        String needle = "\"" + key + "\"";
        int at = json.indexOf(needle);
        if (at < 0) {
            return null;
        }
        int colon = json.indexOf(':', at + needle.length());
        if (colon < 0) {
            return null;
        }
        int i = colon + 1;
        while (i < json.length() && Character.isWhitespace(json.charAt(i))) {
            i++;
        }
        int start = i;
        while (i < json.length() && (Character.isDigit(json.charAt(i)) || json.charAt(i) == '-')) {
            i++;
        }
        if (start == i) {
            return null;
        }
        try {
            return Integer.parseInt(json.substring(start, i));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * {@code feature.flippable} for this resource + kind (mine → resource_node,
     * pickup → loose_resource). Missing row or column defaults to true.
     */
    private static boolean featureFlippable(
            ReferenceData data, int resourceId, String kind) {
        String typeName = "mine".equals(kind) ? "resource_node" : "loose_resource";
        Integer typeId = null;
        for (Map<String, Object> row : data.rows("feature_type")) {
            if (typeName.equalsIgnoreCase(stringVal(row, "name"))) {
                typeId = intId(row, "id");
                break;
            }
        }
        for (Map<String, Object> row : data.rows("feature")) {
            Integer rowType = intId(row, "feature_type_id");
            if (typeId != null && (rowType == null || !typeId.equals(rowType))) {
                continue;
            }
            Integer rowResource = featureResourceId(row.get("stats"));
            if (rowResource == null || rowResource != resourceId) {
                continue;
            }
            Object flag = row.get("flippable");
            if (flag == null) {
                return true;
            }
            if (flag instanceof Boolean b) {
                return b;
            }
            String text = flag.toString().trim().toLowerCase();
            return !(text.equals("false") || text.equals("f") || text.equals("0"));
        }
        return true;
    }

    private static Integer featureResourceId(Object statsRaw) {
        Object value = statsRaw;
        if (value != null && !(value instanceof Map<?, ?>) && !(value instanceof String)) {
            value = value.toString();
        }
        if (value instanceof String s) {
            String trimmed = s.trim();
            if (trimmed.isEmpty() || !(trimmed.startsWith("{") || trimmed.startsWith("["))) {
                return null;
            }
            try {
                value = JSON.readValue(trimmed, MAP_TYPE);
            } catch (Exception ignored) {
                return null;
            }
        }
        if (!(value instanceof Map<?, ?> map)) {
            return null;
        }
        Object rid = map.get("resource_id");
        if (rid == null) {
            rid = map.get("resourceId");
        }
        return rid instanceof Number n ? n.intValue() : null;
    }

    /**
     * honeycomb-grid default offset (-1): {@code (axis + offset * (axis & 1)) >> 1}.
     * EXPERIMENT: pointy-top applies this to row (odd-r); flat used col (odd-q).
     */
    private static int offsetFromZero(int axis) {
        return (axis + (-1) * (axis & 1)) >> 1;
    }
}
