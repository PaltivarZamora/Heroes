package com.heroesofyendor;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.Random;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Layer 1 (BR S9-24): optional lakes, islands, weighted land chunks, and
 * symmetric terrain exclusions. Beach exists only as shoreline and island rims.
 */
final class WaterTerrain {

    private static final Logger log = LoggerFactory.getLogger(WaterTerrain.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final TypeReference<List<Object>> LIST_TYPE = new TypeReference<>() {};
    private static final int MIN_BLOB = 25;
    private static final int SEPARATION = 10;
    /** Unstamped cells are treated as far from any lake. */
    private static final int SEP_UNSET = 100;

    static final class Lake {
        final int id;
        int deep;
        int shallow;
        int beach;
        boolean hasDock;

        Lake(int id) {
            this.id = id;
        }
    }

    static final class Island {
        final int id;
        final int lakeId;
        int size;
        int guards;
        int tier;
        int mines;
        int chests;
        int piles;
        boolean wantsTown;
        boolean hasTown;
        boolean hasLanding;
        final List<int[]> landings = new ArrayList<>();
        final List<Integer> guardTiers = new ArrayList<>();
        final List<int[]> hexes = new ArrayList<>();

        Island(int id, int lakeId) {
            this.id = id;
            this.lakeId = lakeId;
        }
    }

    private static final class Rules {
        final Map<String, HexTerrain> byName = new HashMap<>();
        final Map<Integer, HexTerrain> byId = new HashMap<>();
        final Map<Integer, Double> weights = new LinkedHashMap<>();
        final Set<Long> excluded = new HashSet<>();
        final Map<Integer, Integer> requires = new HashMap<>();
        final List<HexTerrain> buffers = new ArrayList<>();
        final List<HexTerrain> landPool = new ArrayList<>();
        HexTerrain water;
        HexTerrain shallow;
        HexTerrain beach;
        HexTerrain lava;
        HexTerrain ash;
        int exclusionPairs;
    }

    private WaterTerrain() {}

    static boolean onIsland(MapGenContext ctx, int col, int row) {
        return ctx.islandHex != null
                && row >= 0
                && col >= 0
                && row < ctx.height
                && col < ctx.width
                && ctx.islandHex[row][col];
    }

    static void paint(MapGenContext ctx) {
        long tAll = System.nanoTime();
        long tCarve = 0;
        long tShallow = 0;
        long tIslands = 0;
        long tPaint = 0;
        long tGap = 0;
        long tBeach = 0;
        long tRepair = 0;
        Random rng = ctx.rngFor("terrain");
        Rules rules = load(ctx);
        ctx.waterTerrainRules = rules;
        ctx.terrainExclusionPairs = rules.exclusionPairs;
        int h = ctx.height;
        int w = ctx.width;
        ctx.cells = new HexTerrain[h][w];
        ctx.chunkIds = new int[h][w];
        ctx.islandHex = new boolean[h][w];
        ctx.islandIds = new int[h][w];
        ctx.islandGuardTier = new int[h][w];
        ctx.lakeIds = new int[h][w];
        ctx.lakes = new ArrayList<>();
        ctx.islands = new ArrayList<>();
        ctx.terrainBuffers = 0;
        boolean[][] locked = new boolean[h][w];
        int[] nextId = {1};

        double chance = percent(ctx, "water_chance", 50);
        ctx.waterRolled = rng.nextDouble() * 100 < chance;
        int[][] sep = newSeparationGrid(h, w);
        if (ctx.waterRolled && rules.water != null) {
            int lakes = lakeCount(ctx);
            int[] lakeSize = MapConfig.cfgIntRange(ctx.data, "lake_size", ctx.sizeName(), 150, 400);
            int[] shallowW = MapConfig.cfgIntRange(ctx.data, "lake_shallow_edge", ctx.sizeName(), 1, 2);
            int inset = Math.max(0, MapConfig.cfgInt(ctx.data, "lake_edge_inset", ctx.sizeName(), 4));
            int[] beachW = MapConfig.cfgIntRange(ctx.data, "beach_width", ctx.sizeName(), 1, 5);
            int deepInset = inset + shallowW[1] + beachW[1];
            List<int[]> shallowStamp = new ArrayList<>();
            for (int n = 0; n < lakes; n++) {
                long t0 = System.nanoTime();
                DeepCarve carved =
                        carveLakeDeep(
                                ctx,
                                rng,
                                rules,
                                locked,
                                sep,
                                nextId,
                                lakeSize,
                                deepInset);
                tCarve += (System.nanoTime() - t0) / 1_000_000L;
                if (carved == null) {
                    break;
                }
                Lake lake = carved.lake;
                int width =
                        shallowW[0]
                                + (shallowW[1] > shallowW[0]
                                        ? rng.nextInt(shallowW[1] - shallowW[0] + 1)
                                        : 0);
                long t1 = System.nanoTime();
                maybeIsland(ctx, rng, rules, locked, nextId, lake, carved.deep);
                tIslands += (System.nanoTime() - t1) / 1_000_000L;
                long t2 = System.nanoTime();
                lake.shallow =
                        shallowRing(
                                ctx,
                                rules,
                                locked,
                                nextId,
                                lake,
                                width,
                                carved.deep,
                                shallowStamp);
                tShallow += (System.nanoTime() - t2) / 1_000_000L;
                List<int[]> stamp = new ArrayList<>(carved.deep);
                stamp.addAll(shallowStamp);
                shallowStamp.clear();
                stampSeparation(sep, ctx, stamp);
                ctx.lakes.add(lake);
            }
            if (rules.water != null && rules.shallow != null) {
                cleanupLakeSpecks(ctx, rules, locked);
            }
        }

        long tLandStart = System.nanoTime();
        paintLand(ctx, rng, rules, locked, nextId);
        tPaint = (System.nanoTime() - tLandStart) / 1_000_000L;
        long tGapStart = System.nanoTime();
        fillGaps(ctx, rng, rules, locked, nextId);
        absorb(ctx, rules, locked);
        tGap = (System.nanoTime() - tGapStart) / 1_000_000L;
        long tBeachStart = System.nanoTime();
        if (ctx.waterRolled && rules.beach != null && rules.water != null) {
            paintBeaches(ctx, rng, rules, locked, nextId, buildShoreIndex(ctx, rules));
        }
        tBeach = (System.nanoTime() - tBeachStart) / 1_000_000L;
        long tRepairStart = System.nanoTime();
        repair(ctx, rules, locked);
        tRepair = (System.nanoTime() - tRepairStart) / 1_000_000L;
        int excludedAdj = countExcluded(ctx);
        MapGenTimings.current()
                .layerDetail(
                        "L1",
                        "carve="
                                + tCarve
                                + " shallow="
                                + tShallow
                                + " islands="
                                + tIslands
                                + " beaches="
                                + tBeach
                                + " paint="
                                + tPaint
                                + " gap="
                                + tGap
                                + " repair="
                                + tRepair
                                + " exclusionPairs="
                                + rules.exclusionPairs
                                + " excludedAdj="
                                + excludedAdj);
        ctx.placeable = new ArrayList<>();
        for (int row = 0; row < h; row++) {
            for (int col = 0; col < w; col++) {
                HexTerrain terrain = ctx.cells[row][col];
                if (terrain != null && terrain.isPassable()) {
                    ctx.placeable.add(new int[] {col, row});
                }
            }
        }
        MapGenPipeline.logCounts(
                "terrain",
                "water="
                        + ctx.waterRolled
                        + " lakes="
                        + ctx.lakes.size()
                        + " islands="
                        + ctx.islands.size()
                        + " exclusionPairs="
                        + rules.exclusionPairs
                        + " excludedAdj="
                        + excludedAdj
                        + " passable="
                        + ctx.placeable.size());
    }

    private static final class DeepCarve {
        final Lake lake;
        final List<int[]> deep;

        DeepCarve(Lake lake, List<int[]> deep) {
            this.lake = lake;
            this.deep = deep;
        }
    }

    private static int[][] newSeparationGrid(int height, int width) {
        int[][] sep = new int[height][width];
        for (int row = 0; row < height; row++) {
            Arrays.fill(sep[row], SEP_UNSET);
        }
        return sep;
    }

    private static boolean sepOk(int[][] sep, int row, int col) {
        return sep[row][col] >= SEPARATION;
    }

    /** Mark lake water and shallow as taken; propagate distance up to {@link #SEPARATION}. */
    private static void stampSeparation(int[][] sep, MapGenContext ctx, List<int[]> hexes) {
        Queue<int[]> q = new ArrayDeque<>();
        for (int[] hex : hexes) {
            int col = hex[0];
            int row = hex[1];
            if (sep[row][col] > 0) {
                sep[row][col] = 0;
                q.add(hex);
            }
        }
        while (!q.isEmpty()) {
            int[] cur = q.poll();
            int dist = sep[cur[1]][cur[0]];
            if (dist >= SEPARATION - 1) {
                continue;
            }
            int qax = HexCoords.qOf(cur[0], cur[1]);
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nr = cur[1] + d[1];
                int ncol = HexCoords.colOf(qax + d[0], nr);
                if (!inside(ctx, ncol, nr)) {
                    continue;
                }
                int next = dist + 1;
                if (sep[nr][ncol] > next) {
                    sep[nr][ncol] = next;
                    q.add(new int[] {ncol, nr});
                }
            }
        }
    }

    private static Rules rulesFor(MapGenContext ctx) {
        if (ctx.waterTerrainRules instanceof Rules rules) {
            return rules;
        }
        return load(ctx);
    }

    /** Extra island loot, then the S9-24 report. Guards are stamped for the client. */
    static void fillIslands(MapGenContext ctx) {
        if (ctx.islands != null && !ctx.islands.isEmpty()) {
            Random rng = ctx.rngFor("island-loot");
            int lootPct = (int) Math.round(percent(ctx, "island_loot_pct", 35));
            int[] mines = MapConfig.cfgIntRange(ctx.data, "island_mines", ctx.sizeName(), 1, 2);
            int[] chests = MapConfig.cfgIntRange(ctx.data, "island_chests", ctx.sizeName(), 2, 3);
            for (Island island : ctx.islands) {
                assignGuards(ctx, island, rng);
                fillOne(ctx, island, rng, lootPct, mines, chests);
            }
        }
        report(ctx);
    }

    /** Every lake gets a dock on the outer shore if the normal pass missed it. */
    static void ensureDocks(MapGenContext ctx) {
        if (ctx.lakes == null || ctx.lakes.isEmpty() || ctx.lakeIds == null) {
            return;
        }
        Set<Integer> covered = new HashSet<>();
        if (ctx.objects != null) {
            for (MapObjectData obj : ctx.objects) {
                if (!"dock".equals(obj.kind()) || obj.launchQ() == null || obj.launchR() == null) {
                    continue;
                }
                int col = HexCoords.colOf(obj.launchQ(), obj.launchR());
                int row = obj.launchR();
                if (row >= 0 && col >= 0 && row < ctx.height && col < ctx.width) {
                    covered.add(ctx.lakeIds[row][col]);
                }
            }
        }
        for (Lake lake : ctx.lakes) {
            if (covered.contains(lake.id)) {
                lake.hasDock = true;
                continue;
            }
            int[] site = dockSite(ctx, lake.id);
            if (site == null) {
                site = forceBeachDock(ctx, lake);
            }
            if (site == null) {
                continue;
            }
            int q = HexCoords.qOf(site[0], site[1]);
            ctx.objects.add(
                    new MapObjectData(
                            q,
                            site[1],
                            "dock",
                            null,
                            "D",
                            "Dock",
                            null,
                            false,
                            null,
                            null,
                            null,
                            null,
                            null,
                            null,
                            null,
                            site[2],
                            site[3],
                            null,
                            null));
            lake.hasDock = true;
        }
    }

    private static DeepCarve carveLakeDeep(
            MapGenContext ctx,
            Random rng,
            Rules rules,
            boolean[][] locked,
            int[][] sep,
            int[] nextId,
            int[] lakeSize,
            int deepInset) {
        int want = lakeSize[0] + (lakeSize[1] > lakeSize[0] ? rng.nextInt(lakeSize[1] - lakeSize[0] + 1) : 0);
        List<int[]> seeds = new ArrayList<>();
        for (int row = deepInset; row < ctx.height - deepInset; row++) {
            for (int col = deepInset; col < ctx.width - deepInset; col++) {
                if (ctx.cells[row][col] != null || !sepOk(sep, row, col)) {
                    continue;
                }
                seeds.add(new int[] {col, row});
            }
        }
        java.util.Collections.shuffle(seeds, rng);
        int tries = Math.min(24, seeds.size());
        for (int i = 0; i < tries; i++) {
            int[] seed = seeds.get(i);
            List<int[]> blob =
                    growSet(
                            ctx,
                            seed,
                            want,
                            (col, row) ->
                                    col >= deepInset
                                            && row >= deepInset
                                            && col < ctx.width - deepInset
                                            && row < ctx.height - deepInset
                                            && ctx.cells[row][col] == null
                                            && sepOk(sep, row, col));
            if (blob.size() < lakeSize[0] && blob.size() < want) {
                continue;
            }
            if (blob.size() < Math.min(lakeSize[0], want)) {
                continue;
            }
            Lake lake = new Lake(ctx.lakes.size() + 1);
            int chunk = nextId[0]++;
            for (int[] hex : blob) {
                ctx.cells[hex[1]][hex[0]] = rules.water;
                ctx.chunkIds[hex[1]][hex[0]] = chunk;
                ctx.lakeIds[hex[1]][hex[0]] = lake.id;
                locked[hex[1]][hex[0]] = true;
            }
            lake.deep = blob.size();
            return new DeepCarve(lake, blob);
        }
        return null;
    }

    private static void maybeIsland(
            MapGenContext ctx,
            Random rng,
            Rules rules,
            boolean[][] locked,
            int[] nextId,
            Lake lake,
            List<int[]> water) {
        double chance = percent(ctx, "island_chance", 50);
        if (rng.nextDouble() * 100 >= chance || rules.beach == null) {
            return;
        }
        int[] sizeR = MapConfig.cfgIntRange(ctx.data, "island_size", ctx.sizeName(), 15, 40);
        int[] rimR = MapConfig.cfgIntRange(ctx.data, "island_beach_rim", ctx.sizeName(), 1, 2);
        int target = sizeR[0] + (sizeR[1] > sizeR[0] ? rng.nextInt(sizeR[1] - sizeR[0] + 1) : 0);
        int rim = rimR[0] + (rimR[1] > rimR[0] ? rng.nextInt(rimR[1] - rimR[0] + 1) : 0);
        int[][] dist = waterDistance(ctx, lake.id, water);
        List<int[]> pocket = new ArrayList<>();
        for (int[] hex : water) {
            if (dist[hex[1]][hex[0]] >= 3) {
                pocket.add(hex);
            }
        }
        if (pocket.isEmpty()) {
            return;
        }
        java.util.Collections.shuffle(pocket, rng);
        List<int[]> body = null;
        int tries = Math.min(12, pocket.size());
        for (int i = 0; i < tries; i++) {
            int[] seed = pocket.get(i);
            List<int[]> grown = growSet(ctx, seed, target, (col, row) ->
                    ctx.lakeIds[row][col] == lake.id && dist[row][col] >= 3);
            if (grown.size() >= sizeR[0]) {
                body = grown;
                break;
            }
        }
        if (body == null) {
            return;
        }
        int dockMin = Math.max(1, MapConfig.cfgInt(ctx.data, "dock_min_water", ctx.sizeName(), 36));
        if (lake.deep - body.size() < dockMin) {
            return;
        }
        Island island = new Island(ctx.islands.size() + 1, lake.id);
        island.size = body.size();
        island.hexes.addAll(body);
        Set<String> inside = new HashSet<>();
        for (int[] hex : body) {
            inside.add(hex[0] + "," + hex[1]);
        }
        int[][] rimDist = new int[ctx.height][ctx.width];
        for (int row = 0; row < ctx.height; row++) {
            java.util.Arrays.fill(rimDist[row], -1);
        }
        List<int[]> queue = new ArrayList<>();
        for (int[] hex : body) {
            if (touchesWater(ctx, hex[0], hex[1], lake.id, inside)) {
                rimDist[hex[1]][hex[0]] = 0;
                queue.add(hex);
                island.landings.add(hex);
            }
        }
        int qi = 0;
        while (qi < queue.size()) {
            int[] cur = queue.get(qi++);
            int q = HexCoords.qOf(cur[0], cur[1]);
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nr = cur[1] + d[1];
                int ncol = HexCoords.colOf(q + d[0], nr);
                if (!inside(ctx, ncol, nr) || !inside.contains(ncol + "," + nr)) {
                    continue;
                }
                if (rimDist[nr][ncol] >= 0) {
                    continue;
                }
                rimDist[nr][ncol] = rimDist[cur[1]][cur[0]] + 1;
                queue.add(new int[] {ncol, nr});
            }
        }
        List<int[]> interior = new ArrayList<>();
        for (int[] hex : body) {
            int depth = rimDist[hex[1]][hex[0]];
            if (depth < 0 || depth >= rim) {
                interior.add(hex);
            }
        }
        boolean allBeach = interior.size() < MIN_BLOB;
        HexTerrain core = allBeach ? rules.beach : interiorTerrain(ctx, rng, rules);
        int beachChunk = nextId[0]++;
        int coreChunk = allBeach ? beachChunk : nextId[0]++;
        for (int[] hex : body) {
            boolean rimHex = !allBeach && rimDist[hex[1]][hex[0]] >= 0 && rimDist[hex[1]][hex[0]] < rim;
            ctx.cells[hex[1]][hex[0]] = rimHex || allBeach ? rules.beach : core;
            ctx.chunkIds[hex[1]][hex[0]] = rimHex || allBeach ? beachChunk : coreChunk;
            ctx.lakeIds[hex[1]][hex[0]] = 0;
            ctx.islandHex[hex[1]][hex[0]] = true;
            ctx.islandIds[hex[1]][hex[0]] = island.id;
            locked[hex[1]][hex[0]] = true;
        }
        lake.deep -= body.size();
        island.hasLanding = !island.landings.isEmpty();
        double townPct = percent(ctx, "island_town_pct", 30);
        island.wantsTown = rng.nextDouble() * 100 < townPct;
        int per = Math.max(1, MapConfig.cfgInt(ctx.data, "island_mob_per", ctx.sizeName(), 15));
        int guardCount = Math.max(1, (int) Math.round(island.size / (double) per));
        guardCount = Math.min(guardCount, Math.max(1, island.landings.size()));
        for (int g = 0; g < guardCount; g++) {
            island.guardTiers.add(rollTier(ctx, rng));
        }
        island.guards = island.guardTiers.size();
        island.tier = 4;
        for (int tier : island.guardTiers) {
            island.tier = Math.max(island.tier, tier);
        }
        ctx.islands.add(island);
    }

    private static int shallowRing(
            MapGenContext ctx,
            Rules rules,
            boolean[][] locked,
            int[] nextId,
            Lake lake,
            int width,
            List<int[]> lakeDeep,
            List<int[]> shallowOut) {
        if (rules.shallow == null || width <= 0) {
            return 0;
        }
        int chunk = nextId[0]++;
        int painted = 0;
        Set<String> edge = new HashSet<>();
        for (int[] hex : lakeDeep) {
            edge.add(hex[0] + "," + hex[1]);
        }
        for (int layer = 0; layer < width; layer++) {
            List<int[]> add = new ArrayList<>();
            for (String key : edge) {
                String[] parts = key.split(",");
                int col = Integer.parseInt(parts[0]);
                int row = Integer.parseInt(parts[1]);
                int q = HexCoords.qOf(col, row);
                for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                    int nr = row + d[1];
                    int ncol = HexCoords.colOf(q + d[0], nr);
                    if (!inside(ctx, ncol, nr) || ctx.cells[nr][ncol] != null) {
                        continue;
                    }
                    add.add(new int[] {ncol, nr});
                }
            }
            if (add.isEmpty()) {
                break;
            }
            for (int[] hex : add) {
                if (ctx.cells[hex[1]][hex[0]] != null) {
                    continue;
                }
                ctx.cells[hex[1]][hex[0]] = rules.shallow;
                ctx.chunkIds[hex[1]][hex[0]] = chunk;
                locked[hex[1]][hex[0]] = true;
                shallowOut.add(hex);
                edge.add(hex[0] + "," + hex[1]);
                painted++;
            }
        }
        return painted;
    }

    private static void paintLand(
            MapGenContext ctx, Random rng, Rules rules, boolean[][] locked, int[] nextId) {
        int remaining = 0;
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (ctx.cells[row][col] == null) {
                    remaining++;
                }
            }
        }
        for (int pass = 0; pass < 512 && remaining >= MIN_BLOB; pass++) {
            int[] seed = randomEmpty(ctx, rng);
            if (seed == null) {
                break;
            }
            List<HexTerrain> neighbors = neighborTerrains(ctx, seed[0], seed[1]);
            HexTerrain chosen = choose(ctx, rng, rules, neighbors);
            if (chosen == null) {
                break;
            }
            boolean pair = rules.lava != null && rules.ash != null && chosen.id() == rules.lava.id();
            int target = blobTarget(rng, remaining);
            int chunk = nextId[0]++;
            List<int[]> blob = growSet(ctx, seed, target, (col, row) ->
                    ctx.cells[row][col] == null && fits(ctx, rules, chosen, col, row));
            if (blob.isEmpty()) {
                ctx.cells[seed[1]][seed[0]] = buffer(ctx, rules, neighbors, rng);
                ctx.chunkIds[seed[1]][seed[0]] = chunk;
                ctx.terrainBuffers++;
                remaining--;
                continue;
            }
            paintBlob(ctx, blob, chosen, chunk);
            remaining -= blob.size();
            if (pair) {
                int[] ashSeed = emptyFitNeighbor(ctx, rules, rules.ash, blob);
                if (ashSeed == null) {
                    paintBlob(ctx, blob, buffer(ctx, rules, neighbors, rng), chunk);
                    ctx.terrainBuffers++;
                } else {
                    int ashChunk = nextId[0]++;
                    List<int[]> ash = growSet(ctx, ashSeed, Math.max(MIN_BLOB, target / 2), (col, row) ->
                            ctx.cells[row][col] == null && fits(ctx, rules, rules.ash, col, row));
                    if (ash.isEmpty()) {
                        paintBlob(ctx, blob, buffer(ctx, rules, neighbors, rng), chunk);
                        ctx.terrainBuffers++;
                    } else {
                        paintBlob(ctx, ash, rules.ash, ashChunk);
                        remaining -= ash.size();
                    }
                }
            }
        }
    }

    private static void fillGaps(
            MapGenContext ctx, Random rng, Rules rules, boolean[][] locked, int[] nextId) {
        List<int[]> empty = new ArrayList<>();
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (ctx.cells[row][col] == null) {
                    empty.add(new int[] {col, row});
                }
            }
        }
        while (!empty.isEmpty()) {
            boolean progress = false;
            List<int[]> nextEmpty = new ArrayList<>();
            for (int[] cell : empty) {
                int col = cell[0];
                int row = cell[1];
                if (ctx.cells[row][col] != null) {
                    continue;
                }
                HexTerrain adopt = null;
                int chunk = 0;
                int q = HexCoords.qOf(col, row);
                for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                    int nr = row + d[1];
                    int ncol = HexCoords.colOf(q + d[0], nr);
                    if (!inside(ctx, ncol, nr) || ctx.cells[nr][ncol] == null) {
                        continue;
                    }
                    HexTerrain candidate = ctx.cells[nr][ncol];
                    if (rules.water != null && candidate.id() == rules.water.id()) {
                        continue;
                    }
                    if (fits(ctx, rules, candidate, col, row)) {
                        adopt = candidate;
                        chunk = ctx.chunkIds[nr][ncol];
                        break;
                    }
                }
                if (adopt != null) {
                    ctx.cells[row][col] = adopt;
                    ctx.chunkIds[row][col] = chunk;
                    progress = true;
                } else {
                    nextEmpty.add(cell);
                }
            }
            if (!progress) {
                for (int[] cell : nextEmpty) {
                    int col = cell[0];
                    int row = cell[1];
                    if (ctx.cells[row][col] != null) {
                        continue;
                    }
                    HexTerrain adopt = buffer(ctx, rules, neighborTerrains(ctx, col, row), rng);
                    ctx.cells[row][col] = adopt;
                    ctx.chunkIds[row][col] = nextId[0]++;
                    ctx.terrainBuffers++;
                }
                break;
            }
            empty = nextEmpty;
        }
    }

    private static void absorb(MapGenContext ctx, Rules rules, boolean[][] locked) {
        for (int pass = 0; pass < 64; pass++) {
            boolean changed = false;
            for (int row = 0; row < ctx.height; row++) {
                for (int col = 0; col < ctx.width; col++) {
                    if (locked[row][col] || ctx.cells[row][col] == null) {
                        continue;
                    }
                    HexTerrain self = ctx.cells[row][col];
                    Map<Integer, Integer> tallies = new HashMap<>();
                    int q = HexCoords.qOf(col, row);
                    for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                        int nr = row + d[1];
                        int ncol = HexCoords.colOf(q + d[0], nr);
                        if (inside(ctx, ncol, nr) && ctx.cells[nr][ncol] != null) {
                            tallies.merge(ctx.cells[nr][ncol].id(), 1, Integer::sum);
                        }
                    }
                    int same = tallies.getOrDefault(self.id(), 0);
                    int foreign = 0;
                    for (Map.Entry<Integer, Integer> e : tallies.entrySet()) {
                        if (e.getKey() != self.id()) {
                            foreign = Math.max(foreign, e.getValue());
                        }
                    }
                    if (same > 2 || (same > 0 && foreign < 3)) {
                        continue;
                    }
                    HexTerrain next = allowedPlurality(ctx, rules, col, row, self.id());
                    if (next == null || next.id() == self.id()) {
                        continue;
                    }
                    ctx.cells[row][col] = next;
                    int[] donor = neighborOfTerrain(ctx, col, row, next.id());
                    if (donor != null) {
                        ctx.chunkIds[row][col] = ctx.chunkIds[donor[1]][donor[0]];
                    }
                    changed = true;
                }
            }
            if (!changed) {
                break;
            }
        }
    }

    /**
     * Remove star-shaped deep/shallow specks on lake edges (deterministic row-major
     * scan; no RNG). Runs after lake carve, before land paint and beaches.
     */
    private static void cleanupLakeSpecks(MapGenContext ctx, Rules rules, boolean[][] locked) {
        int deepId = rules.water.id();
        int shallowId = rules.shallow.id();
        List<int[]> toShallow = new ArrayList<>();
        List<int[]> toDeep = new ArrayList<>();
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                HexTerrain self = ctx.cells[row][col];
                if (self == null) {
                    continue;
                }
                int id = self.id();
                if (id != deepId && id != shallowId) {
                    continue;
                }
                if (ctx.lakeIds[row][col] <= 0) {
                    continue;
                }
                int same = 0;
                int q = HexCoords.qOf(col, row);
                boolean allOtherWaterShallow = true;
                boolean allOtherWaterDeep = true;
                boolean hasWaterNeighbor = false;
                for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                    int nr = row + d[1];
                    int ncol = HexCoords.colOf(q + d[0], nr);
                    if (!inside(ctx, ncol, nr)) {
                        continue;
                    }
                    HexTerrain neighbor = ctx.cells[nr][ncol];
                    if (neighbor == null) {
                        continue;
                    }
                    int nid = neighbor.id();
                    if (nid == id) {
                        same++;
                    }
                    if (nid == deepId || nid == shallowId) {
                        hasWaterNeighbor = true;
                        if (nid != shallowId) {
                            allOtherWaterShallow = false;
                        }
                        if (nid != deepId) {
                            allOtherWaterDeep = false;
                        }
                    }
                }
                if (same > 1) {
                    continue;
                }
                if (id == deepId && allOtherWaterShallow && hasWaterNeighbor) {
                    toShallow.add(new int[] {col, row});
                } else if (id == shallowId && allOtherWaterDeep && hasWaterNeighbor) {
                    toDeep.add(new int[] {col, row});
                }
            }
        }
        for (int[] hex : toShallow) {
            ctx.cells[hex[1]][hex[0]] = rules.shallow;
        }
        for (int[] hex : toDeep) {
            ctx.cells[hex[1]][hex[0]] = rules.water;
        }
    }

    private static Map<Integer, List<int[]>> buildShoreIndex(MapGenContext ctx, Rules rules) {
        Map<Integer, List<int[]>> byLake = new HashMap<>();
        if (rules.shallow == null) {
            return byLake;
        }
        int shallowId = rules.shallow.id();
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                HexTerrain terrain = ctx.cells[row][col];
                if (terrain == null || terrain.id() != shallowId) {
                    continue;
                }
                int lakeId = adjacentLakeId(ctx, col, row);
                if (lakeId <= 0) {
                    continue;
                }
                byLake.computeIfAbsent(lakeId, k -> new ArrayList<>()).add(new int[] {col, row});
            }
        }
        return byLake;
    }

    private static int adjacentLakeId(MapGenContext ctx, int col, int row) {
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nr = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nr);
            if (!inside(ctx, ncol, nr)) {
                continue;
            }
            int id = ctx.lakeIds[nr][ncol];
            if (id > 0) {
                return id;
            }
        }
        return 0;
    }

    private static void paintBeaches(
            MapGenContext ctx,
            Random rng,
            Rules rules,
            boolean[][] locked,
            int[] nextId,
            Map<Integer, List<int[]>> shoreByLake) {
        int[] pct = MapConfig.cfgIntRange(ctx.data, "beach_shore_pct", ctx.sizeName(), 25, 50);
        int shorePct = pct[0] + (pct[1] > pct[0] ? rng.nextInt(pct[1] - pct[0] + 1) : 0);
        int[] widths = MapConfig.cfgIntRange(ctx.data, "beach_width", ctx.sizeName(), 1, 5);
        for (Lake lake : ctx.lakes) {
            List<int[]> shore = shoreByLake.get(lake.id);
            if (shore == null || shore.isEmpty()) {
                continue;
            }
            List<int[]> coast = traceCoast(ctx, shore, lake.id);
            if (coast.size() < 6) {
                continue;
            }
            int want = Math.max(6, (int) Math.round(shore.size() * (shorePct / 100.0)));
            want = Math.min(want, Math.max(6, coast.size() * 2 / 3));
            int width = widths[0] + (widths[1] > widths[0] ? rng.nextInt(widths[1] - widths[0] + 1) : 0);
            int runs = want >= 36 ? 4 : want >= 20 ? 3 : want >= 12 ? 2 : 1;
            while (runs > 1 && want / runs < 6) {
                runs--;
            }
            int runLen = Math.max(6, want / runs);
            while (runs > 1 && runLen * runs > coast.size() - runs) {
                runs--;
                runLen = Math.max(6, want / runs);
            }
            boolean cycle = shoreAdjacent(ctx, coast.get(0), coast.get(coast.size() - 1));
            int gap = Math.max(1, (coast.size() - runLen * runs) / runs);
            int cursor = rng.nextInt(coast.size());
            for (int run = 0; run < runs; run++) {
                int chunk = nextId[0]++;
                int[] prev = null;
                int guard = 0;
                int index = cursor;
                while (guard < runLen) {
                    if (index >= coast.size()) {
                        if (!cycle) {
                            break;
                        }
                        index %= coast.size();
                    }
                    int[] hex = coast.get(index);
                    if (prev != null && !shoreAdjacent(ctx, prev, hex)) {
                        break;
                    }
                    prev = hex;
                    index++;
                    guard++;
                    if (ctx.cells[hex[1]][hex[0]] == null
                            || ctx.cells[hex[1]][hex[0]].id() != rules.shallow.id()) {
                        break;
                    }
                    ctx.cells[hex[1]][hex[0]] = rules.beach;
                    ctx.chunkIds[hex[1]][hex[0]] = chunk;
                    locked[hex[1]][hex[0]] = true;
                    lake.beach++;
                    widenBeach(ctx, rules, locked, lake, hex, chunk, width - 1);
                }
                cursor += runLen + gap;
                if (cursor >= coast.size()) {
                    if (!cycle) {
                        break;
                    }
                    cursor %= coast.size();
                }
            }
        }
    }

    private static void widenBeach(
            MapGenContext ctx,
            Rules rules,
            boolean[][] locked,
            Lake lake,
            int[] start,
            int chunk,
            int extra) {
        Set<String> seen = new HashSet<>();
        List<int[]> layer = new ArrayList<>();
        layer.add(start);
        seen.add(start[0] + "," + start[1]);
        for (int step = 0; step < extra && !layer.isEmpty(); step++) {
            List<int[]> next = new ArrayList<>();
            for (int[] hex : layer) {
                int q = HexCoords.qOf(hex[0], hex[1]);
                for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                    int nr = hex[1] + d[1];
                    int ncol = HexCoords.colOf(q + d[0], nr);
                    if (!inside(ctx, ncol, nr) || !seen.add(ncol + "," + nr)) {
                        continue;
                    }
                    if (ctx.lakeIds[nr][ncol] == lake.id || onIsland(ctx, ncol, nr)) {
                        continue;
                    }
                    HexTerrain terrain = ctx.cells[nr][ncol];
                    if (terrain == null || terrain.id() == rules.water.id() || terrain.id() == rules.shallow.id()) {
                        continue;
                    }
                    if (locked[nr][ncol] && terrain.id() == rules.beach.id()) {
                        continue;
                    }
                    ctx.cells[nr][ncol] = rules.beach;
                    ctx.chunkIds[nr][ncol] = chunk;
                    locked[nr][ncol] = true;
                    lake.beach++;
                    next.add(new int[] {ncol, nr});
                }
            }
            layer = next;
        }
    }

    private static void repair(MapGenContext ctx, Rules rules, boolean[][] locked) {
        if (!rules.excluded.isEmpty()) {
            for (int pass = 0; pass < 8; pass++) {
                boolean changed = false;
                for (int row = 0; row < ctx.height; row++) {
                    for (int col = 0; col < ctx.width; col++) {
                        HexTerrain self = ctx.cells[row][col];
                        if (self == null) {
                            continue;
                        }
                        int q = HexCoords.qOf(col, row);
                        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                            int nr = row + d[1];
                            int ncol = HexCoords.colOf(q + d[0], nr);
                            if (!inside(ctx, ncol, nr) || ctx.cells[nr][ncol] == null) {
                                continue;
                            }
                            if (!excluded(rules, self.id(), ctx.cells[nr][ncol].id())) {
                                continue;
                            }
                            int fixCol = col;
                            int fixRow = row;
                            if (locked[row][col] && !locked[nr][ncol]) {
                                fixCol = ncol;
                                fixRow = nr;
                            } else if (locked[row][col]) {
                                continue;
                            }
                            HexTerrain next =
                                    buffer(ctx, rules, neighborTerrains(ctx, fixCol, fixRow), null);
                            if (next == null || next.id() == ctx.cells[fixRow][fixCol].id()) {
                                continue;
                            }
                            ctx.cells[fixRow][fixCol] = next;
                            changed = true;
                        }
                    }
                }
                if (!changed) {
                    break;
                }
            }
        }
        for (Map.Entry<Integer, Integer> req : rules.requires.entrySet()) {
            fixRequires(ctx, rules, locked, req.getKey(), req.getValue());
        }
    }

    private static void fixRequires(
            MapGenContext ctx, Rules rules, boolean[][] locked, int terrainId, int needId) {
        boolean[][] seen = new boolean[ctx.height][ctx.width];
        HexTerrain need = rules.byId.get(needId);
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (seen[row][col] || ctx.cells[row][col] == null || ctx.cells[row][col].id() != terrainId) {
                    continue;
                }
                List<int[]> component = new ArrayList<>();
                List<int[]> stack = new ArrayList<>();
                stack.add(new int[] {col, row});
                seen[row][col] = true;
                boolean ok = false;
                while (!stack.isEmpty()) {
                    int[] cur = stack.remove(stack.size() - 1);
                    component.add(cur);
                    int q = HexCoords.qOf(cur[0], cur[1]);
                    for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                        int nr = cur[1] + d[1];
                        int ncol = HexCoords.colOf(q + d[0], nr);
                        if (!inside(ctx, ncol, nr) || ctx.cells[nr][ncol] == null) {
                            continue;
                        }
                        if (ctx.cells[nr][ncol].id() == needId) {
                            ok = true;
                        }
                        if (seen[nr][ncol] || ctx.cells[nr][ncol].id() != terrainId) {
                            continue;
                        }
                        seen[nr][ncol] = true;
                        stack.add(new int[] {ncol, nr});
                    }
                }
                if (ok || need == null) {
                    continue;
                }
                boolean flipped = false;
                for (int[] hex : component) {
                    int q = HexCoords.qOf(hex[0], hex[1]);
                    for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                        int nr = hex[1] + d[1];
                        int ncol = HexCoords.colOf(q + d[0], nr);
                        if (!inside(ctx, ncol, nr) || locked[nr][ncol]) {
                            continue;
                        }
                        if (ctx.cells[nr][ncol] != null && fits(ctx, rules, need, ncol, nr)) {
                            ctx.cells[nr][ncol] = need;
                            flipped = true;
                            break;
                        }
                    }
                    if (flipped) {
                        break;
                    }
                }
                if (flipped) {
                    continue;
                }
                HexTerrain fallback = rules.buffers.isEmpty() ? null : rules.buffers.get(0);
                if (fallback == null) {
                    continue;
                }
                for (int[] hex : component) {
                    if (!locked[hex[1]][hex[0]]) {
                        ctx.cells[hex[1]][hex[0]] = fallback;
                    }
                }
            }
        }
    }

    private static void assignGuards(MapGenContext ctx, Island island, Random rng) {
        List<int[]> spots = new ArrayList<>();
        for (int[] hex : island.landings) {
            if (ctx.townReserved != null && ctx.townReserved[hex[1]][hex[0]]) {
                continue;
            }
            spots.add(hex);
        }
        java.util.Collections.shuffle(spots, rng);
        int n = Math.min(island.guardTiers.size(), spots.size());
        for (int i = 0; i < n; i++) {
            int[] hex = spots.get(i);
            ctx.islandGuardTier[hex[1]][hex[0]] = island.guardTiers.get(i);
        }
        island.guards = n;
        island.hasLanding = !island.landings.isEmpty();
    }

    private static void fillOne(
            MapGenContext ctx, Island island, Random rng, int lootPct, int[] mineRange, int[] chestRange) {
        List<int[]> room = new ArrayList<>();
        for (int[] hex : island.hexes) {
            if (ctx.islandGuardTier[hex[1]][hex[0]] > 0) {
                continue;
            }
            if (ctx.townReserved != null && ctx.townReserved[hex[1]][hex[0]]) {
                continue;
            }
            room.add(hex);
        }
        if (room.isEmpty()) {
            return;
        }
        int lootN = Math.max(1, (int) Math.round(island.size * (lootPct / 100.0)));
        lootN = Math.min(lootN, room.size());
        int mineN = mineRange[0] + (mineRange[1] > mineRange[0] ? rng.nextInt(mineRange[1] - mineRange[0] + 1) : 0);
        int chestN = chestRange[0] + (chestRange[1] > chestRange[0] ? rng.nextInt(chestRange[1] - chestRange[0] + 1) : 0);
        mineN = Math.min(mineN, lootN);
        chestN = Math.min(chestN, Math.max(0, lootN - mineN));
        int piles = Math.max(0, lootN - mineN - chestN);
        java.util.Collections.shuffle(room, rng);
        List<Integer> resources = resourcePool(ctx, island.tier);
        List<Integer> levels = chestLevels(ctx, island.tier);
        int cursor = 0;
        for (int i = 0; i < mineN && cursor < room.size() && !resources.isEmpty(); i++) {
            int resourceId = resources.get(rng.nextInt(resources.size()));
            ctx.objects.add(TestGrid.objectAt(room.get(cursor++), "mine", resourceId, resourceName(ctx, resourceId), rng, ctx.data));
            island.mines++;
        }
        for (int i = 0; i < chestN && cursor < room.size(); i++) {
            int level = levels.get(rng.nextInt(levels.size()));
            int[] hex = room.get(cursor++);
            MapObjectData chest = TestGrid.makeChest(hex[0], hex[1], level, rng, ctx.data);
            if (chest != null) {
                ctx.objects.add(chest);
                island.chests++;
            }
        }
        for (int i = 0; i < piles && cursor < room.size() && !resources.isEmpty(); i++) {
            int resourceId = resources.get(rng.nextInt(resources.size()));
            ctx.objects.add(TestGrid.objectAt(room.get(cursor++), "pickup", resourceId, resourceName(ctx, resourceId), rng, ctx.data));
            island.piles++;
        }
    }

    private static void report(MapGenContext ctx) {
        int excluded = countExcluded(ctx);
        int requiresMiss = countRequiresMiss(ctx);
        int land = 0;
        int water = 0;
        Map<String, Integer> mix = new LinkedHashMap<>();
        if (ctx.cells != null) {
            for (int row = 0; row < ctx.height; row++) {
                for (int col = 0; col < ctx.width; col++) {
                    HexTerrain terrain = ctx.cells[row][col];
                    if (terrain == null) {
                        continue;
                    }
                    if ("Water".equalsIgnoreCase(terrain.label())) {
                        water++;
                        continue;
                    }
                    land++;
                    mix.merge(terrain.label(), 1, Integer::sum);
                }
            }
        }
        StringBuilder mixText = new StringBuilder();
        for (Map.Entry<String, Integer> e : mix.entrySet()) {
            if (mixText.length() > 0) {
                mixText.append(' ');
            }
            int pct = land == 0 ? 0 : (int) Math.round(100.0 * e.getValue() / land);
            mixText.append(e.getKey()).append('=').append(pct).append('%');
        }
        StringBuilder lakes = new StringBuilder();
        if (ctx.lakes != null) {
            for (Lake lake : ctx.lakes) {
                if (lakes.length() > 0) {
                    lakes.append(" | ");
                }
                lakes.append("L").append(lake.id)
                        .append(" deep=").append(lake.deep)
                        .append(" shallow=").append(lake.shallow)
                        .append(" beach=").append(lake.beach)
                        .append(" dock=").append(lake.hasDock);
            }
        }
        StringBuilder islands = new StringBuilder();
        int landingMiss = 0;
        int dockMiss = 0;
        if (ctx.islands != null) {
            for (Island island : ctx.islands) {
                if (!island.hasLanding) {
                    landingMiss++;
                }
                boolean dock = false;
                if (ctx.lakes != null) {
                    for (Lake lake : ctx.lakes) {
                        if (lake.id == island.lakeId) {
                            dock = lake.hasDock;
                        }
                    }
                }
                if (!dock) {
                    dockMiss++;
                }
                if (islands.length() > 0) {
                    islands.append(" | ");
                }
                islands.append("I").append(island.id)
                        .append(" lake=").append(island.lakeId)
                        .append(" size=").append(island.size)
                        .append(" guards=").append(island.guards)
                        .append(" T").append(island.tier)
                        .append(" mine=").append(island.mines)
                        .append(" chests=").append(island.chests)
                        .append(" piles=").append(island.piles)
                        .append(island.hasTown ? " town" : " noTown")
                        .append(island.hasLanding ? " landing" : " noLanding");
            }
        }
        log.info(
                "S9-24 seed={} size={} water={} lakes={} islands={} buffers={} excluded={} requiresMiss={} landingMiss={} dockMiss={} waterHexes={} | {} | {} | mix {}",
                ctx.mapSeed,
                ctx.sizeName(),
                ctx.waterRolled,
                ctx.lakes == null ? 0 : ctx.lakes.size(),
                ctx.islands == null ? 0 : ctx.islands.size(),
                ctx.terrainBuffers,
                excluded,
                requiresMiss,
                landingMiss,
                dockMiss,
                water,
                lakes.length() == 0 ? "no-lakes" : lakes,
                islands.length() == 0 ? "no-islands" : islands,
                mixText);
    }

    private static int countExcluded(MapGenContext ctx) {
        Rules rules = rulesFor(ctx);
        int n = 0;
        if (ctx.cells == null) {
            return 0;
        }
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                HexTerrain self = ctx.cells[row][col];
                if (self == null) {
                    continue;
                }
                int q = HexCoords.qOf(col, row);
                for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                    int nr = row + d[1];
                    int ncol = HexCoords.colOf(q + d[0], nr);
                    if (!inside(ctx, ncol, nr) || ctx.cells[nr][ncol] == null) {
                        continue;
                    }
                    if (self.id() < ctx.cells[nr][ncol].id()
                            && excluded(rules, self.id(), ctx.cells[nr][ncol].id())) {
                        n++;
                    }
                }
            }
        }
        return n;
    }

    private static int countRequiresMiss(MapGenContext ctx) {
        Rules rules = load(ctx);
        int miss = 0;
        if (ctx.cells == null) {
            return 0;
        }
        for (Map.Entry<Integer, Integer> req : rules.requires.entrySet()) {
            boolean[][] seen = new boolean[ctx.height][ctx.width];
            for (int row = 0; row < ctx.height; row++) {
                for (int col = 0; col < ctx.width; col++) {
                    if (seen[row][col]
                            || ctx.cells[row][col] == null
                            || ctx.cells[row][col].id() != req.getKey()) {
                        continue;
                    }
                    List<int[]> stack = new ArrayList<>();
                    stack.add(new int[] {col, row});
                    seen[row][col] = true;
                    boolean ok = false;
                    while (!stack.isEmpty()) {
                        int[] cur = stack.remove(stack.size() - 1);
                        int q = HexCoords.qOf(cur[0], cur[1]);
                        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                            int nr = cur[1] + d[1];
                            int ncol = HexCoords.colOf(q + d[0], nr);
                            if (!inside(ctx, ncol, nr) || ctx.cells[nr][ncol] == null) {
                                continue;
                            }
                            if (ctx.cells[nr][ncol].id() == req.getValue()) {
                                ok = true;
                            }
                            if (seen[nr][ncol] || ctx.cells[nr][ncol].id() != req.getKey()) {
                                continue;
                            }
                            seen[nr][ncol] = true;
                            stack.add(new int[] {ncol, nr});
                        }
                    }
                    if (!ok) {
                        miss++;
                    }
                }
            }
        }
        return miss;
    }

    private static int[] dockSite(MapGenContext ctx, int lakeId) {
        Rules rules = load(ctx);
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (onIsland(ctx, col, row) || ctx.cells[row][col] == null || !ctx.cells[row][col].isPassable()) {
                    continue;
                }
                if (rules.beach != null && ctx.cells[row][col].id() != rules.beach.id()) {
                    continue;
                }
                int[] launch = waterNeighbor(ctx, col, row, lakeId);
                if (launch == null) {
                    continue;
                }
                return new int[] {col, row, launch[0], launch[1]};
            }
        }
        return null;
    }

    private static int[] forceBeachDock(MapGenContext ctx, Lake lake) {
        Rules rules = load(ctx);
        if (rules.beach == null) {
            return null;
        }
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (onIsland(ctx, col, row) || ctx.cells[row][col] == null) {
                    continue;
                }
                if (rules.shallow == null || ctx.cells[row][col].id() != rules.shallow.id()) {
                    continue;
                }
                int[] launch = waterNeighbor(ctx, col, row, lake.id);
                if (launch == null) {
                    continue;
                }
                ctx.cells[row][col] = rules.beach;
                lake.beach++;
                return new int[] {col, row, launch[0], launch[1]};
            }
        }
        return null;
    }

    private static int[] waterNeighbor(MapGenContext ctx, int col, int row, int lakeId) {
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nr = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nr);
            if (inside(ctx, ncol, nr) && ctx.lakeIds[nr][ncol] == lakeId) {
                return new int[] {HexCoords.qOf(ncol, nr), nr};
            }
        }
        return null;
    }

    private interface CellOk {
        boolean ok(int col, int row);
    }

    private static List<int[]> growSet(MapGenContext ctx, int[] seed, int target, CellOk ok) {
        List<int[]> body = new ArrayList<>();
        if (!ok.ok(seed[0], seed[1])) {
            return body;
        }
        Set<String> inn = new HashSet<>();
        List<int[]> frontier = new ArrayList<>();
        body.add(seed);
        inn.add(seed[0] + "," + seed[1]);
        addFrontier(ctx, seed[0], seed[1], inn, frontier, ok);
        Random jitter = new Random(seed[0] * 31L + seed[1] * 17L + target);
        while (body.size() < target && !frontier.isEmpty()) {
            int index = jitter.nextInt(frontier.size());
            int[] next = frontier.remove(index);
            if (!inn.add(next[0] + "," + next[1]) || !ok.ok(next[0], next[1])) {
                continue;
            }
            body.add(next);
            addFrontier(ctx, next[0], next[1], inn, frontier, ok);
        }
        return body;
    }

    private static void addFrontier(
            MapGenContext ctx, int col, int row, Set<String> inn, List<int[]> frontier, CellOk ok) {
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nr = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nr);
            if (!inside(ctx, ncol, nr) || inn.contains(ncol + "," + nr)) {
                continue;
            }
            if (ok.ok(ncol, nr)) {
                frontier.add(new int[] {ncol, nr});
            }
        }
    }

    private static void paintBlob(MapGenContext ctx, List<int[]> blob, HexTerrain terrain, int chunk) {
        for (int[] hex : blob) {
            ctx.cells[hex[1]][hex[0]] = terrain;
            ctx.chunkIds[hex[1]][hex[0]] = chunk;
        }
    }

    /** Distance from the lake shore (in water hexes only). */
    private static int[][] waterDistance(MapGenContext ctx, int lakeId, List<int[]> lakeDeep) {
        int[][] dist = new int[ctx.height][ctx.width];
        for (int row = 0; row < ctx.height; row++) {
            Arrays.fill(dist[row], -1);
        }
        Queue<int[]> q = new ArrayDeque<>();
        for (int[] hex : lakeDeep) {
            int col = hex[0];
            int row = hex[1];
            if (touchesNonLakeWater(ctx, col, row, lakeId)) {
                dist[row][col] = 0;
                q.add(hex);
            }
        }
        while (!q.isEmpty()) {
            int[] cur = q.poll();
            int qax = HexCoords.qOf(cur[0], cur[1]);
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nr = cur[1] + d[1];
                int ncol = HexCoords.colOf(qax + d[0], nr);
                if (!inside(ctx, ncol, nr) || ctx.lakeIds[nr][ncol] != lakeId || dist[nr][ncol] >= 0) {
                    continue;
                }
                dist[nr][ncol] = dist[cur[1]][cur[0]] + 1;
                q.add(new int[] {ncol, nr});
            }
        }
        return dist;
    }

    private static boolean touchesNonLakeWater(MapGenContext ctx, int col, int row, int lakeId) {
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nr = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nr);
            if (!inside(ctx, ncol, nr)) {
                return true;
            }
            if (ctx.lakeIds[nr][ncol] != lakeId) {
                return true;
            }
        }
        return false;
    }

    private static boolean touchesWater(MapGenContext ctx, int col, int row, int lakeId, Set<String> inside) {
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nr = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nr);
            if (!inside(ctx, ncol, nr)) {
                continue;
            }
            if (inside.contains(ncol + "," + nr)) {
                continue;
            }
            if (ctx.lakeIds[nr][ncol] == lakeId) {
                return true;
            }
        }
        return false;
    }

    private static boolean touchesLakeWater(MapGenContext ctx, int col, int row, int lakeId) {
        return waterNeighbor(ctx, col, row, lakeId) != null;
    }

    /**
     * Walk the shallow hexes that touch this lake, keeping the water on one side,
     * so a beach run is one long shoreline arc.
     */
    private static List<int[]> traceCoast(MapGenContext ctx, List<int[]> shore, int lakeId) {
        Map<String, int[]> byKey = new HashMap<>();
        Set<String> shoreSet = new HashSet<>();
        for (int[] hex : shore) {
            String key = hex[0] + "," + hex[1];
            byKey.put(key, hex);
            shoreSet.add(key);
        }
        List<int[]> best = new ArrayList<>();
        int tries = Math.min(12, shore.size());
        int stride = Math.max(1, shore.size() / tries);
        for (int t = 0; t < tries; t++) {
            int[] start = shore.get((t * stride) % shore.size());
            for (int turn : new int[] {1, 5}) {
                List<int[]> line = traceOne(ctx, byKey, shoreSet, start, lakeId, turn);
                if (line.size() > best.size()) {
                    best = line;
                }
            }
        }
        return best;
    }

    private static List<int[]> traceOne(
            MapGenContext ctx,
            Map<String, int[]> byKey,
            Set<String> shoreSet,
            int[] start,
            int lakeId,
            int turn) {
        List<int[]> line = new ArrayList<>();
        Set<String> used = new HashSet<>();
        int[] cur = start;
        int back = directionToward(ctx, cur[0], cur[1], lakeId);
        if (back < 0) {
            return line;
        }
        while (cur != null && used.add(cur[0] + "," + cur[1])) {
            line.add(cur);
            int q = HexCoords.qOf(cur[0], cur[1]);
            int[] next = null;
            int nextBack = -1;
            for (int step = 1; step <= 6; step++) {
                int idx = Math.floorMod(back + turn * step, 6);
                int nr = cur[1] + HexCoords.AXIAL_NEIGHBORS[idx][1];
                int ncol = HexCoords.colOf(q + HexCoords.AXIAL_NEIGHBORS[idx][0], nr);
                String key = ncol + "," + nr;
                if (used.contains(key)) {
                    break;
                }
                if (!shoreSet.contains(key)) {
                    continue;
                }
                next = byKey.get(key);
                nextBack = Math.floorMod(idx + 3, 6);
                break;
            }
            if (next == null) {
                break;
            }
            back = nextBack;
            cur = next;
        }
        return line;
    }

    private static int directionToward(MapGenContext ctx, int col, int row, int lakeId) {
        int q = HexCoords.qOf(col, row);
        for (int i = 0; i < HexCoords.AXIAL_NEIGHBORS.length; i++) {
            int[] d = HexCoords.AXIAL_NEIGHBORS[i];
            int nr = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nr);
            if (inside(ctx, ncol, nr) && ctx.lakeIds[nr][ncol] == lakeId) {
                return i;
            }
        }
        return -1;
    }

    private static boolean shoreAdjacent(MapGenContext ctx, int[] a, int[] b) {
        int q = HexCoords.qOf(a[0], a[1]);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nr = a[1] + d[1];
            int ncol = HexCoords.colOf(q + d[0], nr);
            if (ncol == b[0] && nr == b[1]) {
                return true;
            }
        }
        return false;
    }

    private static int[] randomEmpty(MapGenContext ctx, Random rng) {
        int empty = 0;
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (ctx.cells[row][col] == null) {
                    empty++;
                }
            }
        }
        if (empty == 0) {
            return null;
        }
        int pick = rng.nextInt(empty);
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (ctx.cells[row][col] != null) {
                    continue;
                }
                if (pick == 0) {
                    return new int[] {col, row};
                }
                pick--;
            }
        }
        return null;
    }

    private static int blobTarget(Random rng, int remaining) {
        int w = 5 + rng.nextInt(6);
        int h = 5 + rng.nextInt(6);
        int want = Math.max(MIN_BLOB, w * h);
        int jitter = 1 + rng.nextInt(Math.max(1, want / 3));
        want = rng.nextBoolean() ? want + jitter : Math.max(5, want - jitter);
        return Math.min(want, remaining);
    }

    private static HexTerrain choose(MapGenContext ctx, Random rng, Rules rules, List<HexTerrain> neighbors) {
        List<HexTerrain> allowed = new ArrayList<>();
        List<Double> weight = new ArrayList<>();
        for (HexTerrain terrain : rules.landPool) {
            if (rules.ash != null && terrain.id() == rules.ash.id()) {
                continue;
            }
            if (!fitsAll(rules, terrain, neighbors)) {
                continue;
            }
            allowed.add(terrain);
            weight.add(rules.weights.getOrDefault(terrain.id(), 0.1));
        }
        if (allowed.isEmpty()) {
            ctx.terrainBuffers++;
            return buffer(ctx, rules, neighbors, rng);
        }
        double sum = 0;
        for (double w : weight) {
            sum += w;
        }
        double roll = rng.nextDouble() * sum;
        double acc = 0;
        for (int i = 0; i < allowed.size(); i++) {
            acc += weight.get(i);
            if (roll <= acc) {
                return allowed.get(i);
            }
        }
        return allowed.get(allowed.size() - 1);
    }

    private static HexTerrain interiorTerrain(MapGenContext ctx, Random rng, Rules rules) {
        List<HexTerrain> neighbors = rules.beach == null ? List.of() : List.of(rules.beach);
        HexTerrain chosen = choose(ctx, rng, rules, neighbors);
        if (chosen != null && rules.lava != null && chosen.id() == rules.lava.id()) {
            return buffer(ctx, rules, neighbors, rng);
        }
        return chosen == null ? rules.beach : chosen;
    }

    private static HexTerrain buffer(MapGenContext ctx, Rules rules, List<HexTerrain> neighbors, Random rng) {
        List<HexTerrain> ok = new ArrayList<>();
        for (HexTerrain terrain : rules.buffers) {
            if (fitsAll(rules, terrain, neighbors)) {
                ok.add(terrain);
            }
        }
        if (ok.isEmpty()) {
            return rules.buffers.isEmpty() ? null : rules.buffers.get(0);
        }
        if (rng == null) {
            return ok.get(0);
        }
        return ok.get(rng.nextInt(ok.size()));
    }

    private static boolean fits(MapGenContext ctx, Rules rules, HexTerrain terrain, int col, int row) {
        return fitsAll(rules, terrain, neighborTerrains(ctx, col, row));
    }

    private static boolean fitsAll(Rules rules, HexTerrain terrain, List<HexTerrain> neighbors) {
        for (HexTerrain neighbor : neighbors) {
            if (neighbor.id() != terrain.id() && excluded(rules, terrain.id(), neighbor.id())) {
                return false;
            }
        }
        return true;
    }

    private static boolean excluded(Rules rules, int a, int b) {
        if (a == b) {
            return false;
        }
        int lo = Math.min(a, b);
        int hi = Math.max(a, b);
        return rules.excluded.contains(lo * 10000L + hi);
    }

    private static List<HexTerrain> neighborTerrains(MapGenContext ctx, int col, int row) {
        List<HexTerrain> out = new ArrayList<>();
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nr = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nr);
            if (inside(ctx, ncol, nr) && ctx.cells[nr][ncol] != null) {
                out.add(ctx.cells[nr][ncol]);
            }
        }
        return out;
    }

    private static HexTerrain allowedPlurality(MapGenContext ctx, Rules rules, int col, int row, int selfId) {
        Map<Integer, Integer> tallies = new HashMap<>();
        Map<Integer, HexTerrain> terrains = new HashMap<>();
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nr = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nr);
            if (!inside(ctx, ncol, nr) || ctx.cells[nr][ncol] == null) {
                continue;
            }
            HexTerrain terrain = ctx.cells[nr][ncol];
            if (terrain.id() == selfId) {
                continue;
            }
            tallies.merge(terrain.id(), 1, Integer::sum);
            terrains.putIfAbsent(terrain.id(), terrain);
        }
        HexTerrain best = null;
        int bestN = -1;
        for (Map.Entry<Integer, Integer> e : tallies.entrySet()) {
            HexTerrain terrain = terrains.get(e.getKey());
            if (!fits(ctx, rules, terrain, col, row)) {
                continue;
            }
            if (e.getValue() > bestN) {
                bestN = e.getValue();
                best = terrain;
            }
        }
        return best;
    }

    private static int[] neighborOfTerrain(MapGenContext ctx, int col, int row, int terrainId) {
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nr = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nr);
            if (inside(ctx, ncol, nr)
                    && ctx.cells[nr][ncol] != null
                    && ctx.cells[nr][ncol].id() == terrainId) {
                return new int[] {ncol, nr};
            }
        }
        return null;
    }

    private static int[] emptyFitNeighbor(MapGenContext ctx, Rules rules, HexTerrain terrain, List<int[]> blob) {
        for (int[] hex : blob) {
            int q = HexCoords.qOf(hex[0], hex[1]);
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nr = hex[1] + d[1];
                int ncol = HexCoords.colOf(q + d[0], nr);
                if (inside(ctx, ncol, nr) && ctx.cells[nr][ncol] == null && fits(ctx, rules, terrain, ncol, nr)) {
                    return new int[] {ncol, nr};
                }
            }
        }
        return null;
    }

    private static boolean inside(MapGenContext ctx, int col, int row) {
        return col >= 0 && row >= 0 && col < ctx.width && row < ctx.height;
    }

    private static int lakeCount(MapGenContext ctx) {
        int fallback = switch (ctx.sizeName() == null ? "" : ctx.sizeName()) {
            case "large" -> 2;
            case "giant" -> 3;
            default -> 1;
        };
        return Math.max(0, MapConfig.cfgInt(ctx.data, "lake_count", ctx.sizeName(), fallback));
    }

    private static double percent(MapGenContext ctx, String key, double fallback) {
        double value = MapConfig.cfgDouble(ctx.data, key, ctx.sizeName(), fallback);
        if (value < 0) {
            return 0;
        }
        if (value <= 1) {
            return value * 100;
        }
        return Math.min(100, value);
    }

    private static int rollTier(MapGenContext ctx, Random rng) {
        Map<Integer, Integer> weights = new LinkedHashMap<>();
        Object raw = MapConfig.mapCfg(ctx.data, "island_tier_weights", ctx.sizeName());
        if (raw instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                Integer tier = MapConfig.asInt(entry.getKey());
                Integer weight = MapConfig.asInt(entry.getValue());
                if (tier != null && weight != null && tier > 0 && weight > 0) {
                    weights.put(tier, weight);
                }
            }
        }
        if (weights.isEmpty()) {
            weights.put(4, 30);
            weights.put(5, 40);
            weights.put(6, 30);
        }
        int total = 0;
        for (int weight : weights.values()) {
            total += weight;
        }
        int roll = rng.nextInt(Math.max(1, total));
        int acc = 0;
        for (Map.Entry<Integer, Integer> entry : weights.entrySet()) {
            acc += entry.getValue();
            if (roll < acc) {
                return entry.getKey();
            }
        }
        return 4;
    }

    private static List<Integer> chestLevels(MapGenContext ctx, int tier) {
        List<Integer> parsed = tierList(ctx, "pocket_chest_levels", tier);
        if (!parsed.isEmpty()) {
            return parsed;
        }
        return switch (tier) {
            case 6 -> List.of(3, 4);
            case 5 -> List.of(2, 3);
            default -> List.of(1, 2);
        };
    }

    private static List<Integer> resourcePool(MapGenContext ctx, int tier) {
        List<Integer> parsed = tierList(ctx, "pocket_resources", tier);
        if (!parsed.isEmpty()) {
            return parsed;
        }
        return switch (tier) {
            case 6 -> List.of(1, 5, 6, 7, 8, 9, 10);
            case 5 -> List.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
            default -> List.of(1, 2, 3, 4);
        };
    }

    private static List<Integer> tierList(MapGenContext ctx, String key, int tier) {
        Object raw = MapConfig.mapCfg(ctx.data, key, ctx.sizeName());
        if (!(raw instanceof Map<?, ?> map)) {
            return List.of();
        }
        Object list = map.get(String.valueOf(tier));
        if (list == null) {
            list = map.get(tier);
        }
        if (!(list instanceof List<?> items)) {
            return List.of();
        }
        List<Integer> out = new ArrayList<>();
        for (Object item : items) {
            Integer n = MapConfig.asInt(item);
            if (n != null) {
                out.add(n);
            }
        }
        return out;
    }

    private static String resourceName(MapGenContext ctx, int resourceId) {
        for (Map<String, Object> row : ctx.data.rows("resource")) {
            Integer id = MapConfig.asInt(row.get("id"));
            if (id != null && id == resourceId) {
                Object name = row.get("name");
                return name == null ? "#" + resourceId : name.toString();
            }
        }
        return "#" + resourceId;
    }

    private static Rules load(MapGenContext ctx) {
        Rules rules = new Rules();
        for (HexTerrain terrain : HexTerrain.all(ctx.data)) {
            rules.byName.put(terrain.label().toLowerCase(), terrain);
            rules.byId.put(terrain.id(), terrain);
        }
        rules.water = rules.byName.get("water");
        rules.shallow = rules.byName.get("shallow");
        rules.beach = rules.byName.get("beach");
        rules.lava = rules.byName.get("lava");
        rules.ash = rules.byName.get("ash");
        Map<String, Double> fallback = new LinkedHashMap<>();
        fallback.put("grass", 0.6);
        fallback.put("dirt", 0.6);
        fallback.put("desert", 0.4);
        fallback.put("rocky", 0.4);
        fallback.put("mud", 0.4);
        fallback.put("tundra", 0.4);
        fallback.put("snow", 0.3);
        fallback.put("ice", 0.3);
        fallback.put("lava", 0.3);
        fallback.put("ash", 0.3);
        fallback.put("shallow", 0.25);
        fallback.put("swamp", 0.25);
        Object rawWeights = MapConfig.mapCfg(ctx.data, "terrain_weights", ctx.sizeName());
        Map<String, Double> named = new LinkedHashMap<>();
        if (rawWeights instanceof Map<?, ?> map && !map.isEmpty()) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (entry.getKey() == null) {
                    continue;
                }
                Double weight = MapConfig.asDouble(entry.getValue());
                if (weight != null && weight > 0) {
                    named.put(entry.getKey().toString().trim().toLowerCase(), weight);
                }
            }
        }
        if (named.isEmpty()) {
            named = fallback;
        }
        for (Map.Entry<String, Double> entry : named.entrySet()) {
            Integer id = resolveId(entry.getKey(), rules);
            HexTerrain terrain = id == null ? null : rules.byId.get(id);
            if (terrain == null) {
                continue;
            }
            String label = terrain.label().toLowerCase();
            if (label.equals("beach") || label.equals("water")) {
                continue;
            }
            rules.weights.put(terrain.id(), entry.getValue());
            rules.landPool.add(terrain);
        }
        for (Map<String, Object> row : ctx.data.rows("terrain")) {
            Integer id = MapConfig.asInt(row.get("id"));
            if (id == null) {
                continue;
            }
            for (Integer other : idList(row.get("exclusion"), rules)) {
                int lo = Math.min(id, other);
                int hi = Math.max(id, other);
                if (lo != hi) {
                    rules.excluded.add(lo * 10000L + hi);
                }
            }
        }
        rules.exclusionPairs = rules.excluded.size();
        if (rules.exclusionPairs > 0) {
            log.debug(
                    "terrain exclusions loaded: {} symmetric pairs from terrain.exclusion",
                    rules.exclusionPairs);
        }
        Object rawReq = MapConfig.mapCfg(ctx.data, "terrain_requires", ctx.sizeName());
        if (rawReq instanceof Map<?, ?> map && !map.isEmpty()) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                Integer from = resolveId(entry.getKey(), rules);
                if (from == null || !(entry.getValue() instanceof List<?> list) || list.isEmpty()) {
                    continue;
                }
                Integer to = resolveId(list.get(0), rules);
                if (to != null) {
                    rules.requires.put(from, to);
                }
            }
        }
        if (rules.requires.isEmpty()) {
            putRequire(rules, "beach", "water");
            putRequire(rules, "lava", "ash");
            putRequire(rules, "ash", "lava");
        }
        Object rawBuffers = MapConfig.mapCfg(ctx.data, "terrain_buffers", ctx.sizeName());
        List<String> bufferNames = new ArrayList<>();
        if (rawBuffers instanceof List<?> list && !list.isEmpty()) {
            for (Object item : list) {
                if (item != null) {
                    bufferNames.add(item.toString());
                }
            }
        }
        if (bufferNames.isEmpty()) {
            bufferNames = List.of("Dirt", "Mud", "Tundra", "Rocky");
        }
        for (String name : bufferNames) {
            Integer id = resolveId(name, rules);
            HexTerrain terrain = id == null ? null : rules.byId.get(id);
            if (terrain != null) {
                rules.buffers.add(terrain);
            }
        }
        return rules;
    }

    private static void putRequire(Rules rules, String from, String to) {
        HexTerrain a = rules.byName.get(from);
        HexTerrain b = rules.byName.get(to);
        if (a != null && b != null) {
            rules.requires.put(a.id(), b.id());
        }
    }

    private static Integer resolveId(Object raw, Rules rules) {
        if (raw == null) {
            return null;
        }
        Integer id = MapConfig.asInt(raw);
        if (id != null && rules.byId.containsKey(id)) {
            return id;
        }
        HexTerrain terrain = rules.byName.get(raw.toString().trim().toLowerCase());
        return terrain == null ? id : terrain.id();
    }

    private static List<Integer> idList(Object raw, Rules rules) {
        Object value = decodeJsonList(raw);
        if (!(value instanceof List<?> list)) {
            return List.of();
        }
        List<Integer> out = new ArrayList<>();
        for (Object item : list) {
            Integer id = resolveId(item, rules);
            if (id != null) {
                out.add(id);
            }
        }
        return out;
    }

    private static Object decodeJsonList(Object raw) {
        if (raw == null) {
            return null;
        }
        if (raw instanceof List<?> || raw instanceof Map<?, ?>) {
            return raw;
        }
        String text = raw.toString().trim();
        if (text.isEmpty() || "{}".equals(text)) {
            return List.of();
        }
        if (text.startsWith("[")) {
            try {
                return JSON.readValue(text, LIST_TYPE);
            } catch (Exception ignored) {
                return List.of();
            }
        }
        return raw;
    }
}
