package com.heroesofyendor;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Treasure pockets (BR S9-23). Carved after wall edges: one entrance, a blocker
 * ring, loot filled later. Roads treat the whole pocket as blocked.
 */
final class Pockets {

    private static final Logger log = LoggerFactory.getLogger(Pockets.class);

    static final class Pocket {
        final int id;
        final int tier;
        final int chunkId;
        final boolean againstWall;
        final int[] entrance;
        final List<int[]> interior;
        int mines;
        int chests;
        int piles;
        int fillers;

        Pocket(int id, int tier, int chunkId, boolean againstWall, int[] entrance, List<int[]> interior) {
            this.id = id;
            this.tier = tier;
            this.chunkId = chunkId;
            this.againstWall = againstWall;
            this.entrance = entrance;
            this.interior = interior;
        }
    }

    private Pockets() {}

    static boolean seals(MapGenContext ctx, int col, int row) {
        return ctx.pocketSeal != null
                && row >= 0
                && col >= 0
                && row < ctx.height
                && col < ctx.width
                && ctx.pocketSeal[row][col];
    }

    /** Interior or entrance: the prop scatter does not fill these. */
    static boolean reserved(MapGenContext ctx, int row, int col) {
        if (row < 0 || col < 0 || row >= ctx.height || col >= ctx.width) {
            return false;
        }
        if (ctx.pocketInterior != null && ctx.pocketInterior[row][col]) {
            return true;
        }
        return ctx.pocketEntrance != null && ctx.pocketEntrance[row][col];
    }

    /** After wall edges. Chooses sites, builds rings, reserves interiors. */
    static void carve(MapGenContext ctx) {
        Random rng = ctx.rngFor("pockets");
        int pct = clampPct(MapConfig.cfgInt(ctx.data, "pocket_chunk_pct", ctx.sizeName(), 15));
        int minChunk = Math.max(1, MapConfig.cfgInt(ctx.data, "pocket_min_chunk", ctx.sizeName(), 60));
        int[] sizeRange = MapConfig.cfgIntRange(ctx.data, "pocket_size", ctx.sizeName(), 6, 10);
        int townDist = Math.max(0, MapConfig.cfgInt(ctx.data, "pocket_town_dist", ctx.sizeName(), 10));
        Set<Integer> permNo = intSet(ctx, "perm_no_terrain", 3, 20, 21);
        Set<Integer> wallIds = wallIds(ctx);

        ctx.pocketSeal = new boolean[ctx.height][ctx.width];
        ctx.pocketInterior = new boolean[ctx.height][ctx.width];
        ctx.pocketRing = new boolean[ctx.height][ctx.width];
        ctx.pocketEntrance = new boolean[ctx.height][ctx.width];
        ctx.pocketIds = new int[ctx.height][ctx.width];
        ctx.pocketTiers = new int[ctx.height][ctx.width];
        if (ctx.propSeeds == null) {
            ctx.propSeeds = new WorldProps.Seed[ctx.height][ctx.width];
            ctx.propBlocked = new boolean[ctx.height][ctx.width];
        }

        Map<Integer, List<int[]>> chunks = new HashMap<>();
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                int id = ctx.chunkIds[row][col];
                if (id <= 0) {
                    continue;
                }
                chunks.computeIfAbsent(id, k -> new ArrayList<>()).add(new int[] {col, row});
            }
        }
        Set<Integer> townChunks = new HashSet<>();
        for (TownSite site : ctx.townSites) {
            markTownChunk(ctx, townChunks, site.col(), site.row());
            markTownChunk(ctx, townChunks, site.keepCol(), site.row());
        }
        List<Integer> eligible = new ArrayList<>();
        for (Map.Entry<Integer, List<int[]>> entry : chunks.entrySet()) {
            if (entry.getValue().size() < minChunk || townChunks.contains(entry.getKey())) {
                continue;
            }
            eligible.add(entry.getKey());
        }
        ctx.pocketEligible = eligible.size();
        Collections.shuffle(eligible, rng);
        int want = (int) Math.round(eligible.size() * (pct / 100.0));
        List<WorldProps.PropDef> props = WorldProps.all(ctx.data);
        List<WorldProps.WallProp> walls = WorldProps.walls(ctx.data);

        int built = 0;
        for (int chunkId : eligible) {
            if (built >= want) {
                break;
            }
            String skip = tryChunk(
                    ctx, rng, chunks.get(chunkId), chunkId, sizeRange, townDist, permNo, wallIds, props, walls);
            if (skip == null) {
                built++;
            } else {
                ctx.pocketSkips.add("chunk " + chunkId + " " + skip);
            }
        }
        MapGenPipeline.logCounts(
                "pockets",
                "eligible=" + eligible.size() + " want=" + want + " built=" + ctx.pockets.size());
    }

    /** Step 5g. Extra loot; does not count toward the normal mine/pile/chest totals. */
    static void fill(MapGenContext ctx) {
        if (ctx.pockets.isEmpty()) {
            log.info("S9-23 seed={} size={} eligible={} built=0", ctx.mapSeed, ctx.sizeName(), ctx.pocketEligible);
            return;
        }
        if (ctx.featureRules == null) {
            ctx.featureRules = FeatureRules.load(ctx);
        }
        Random rng = ctx.rngFor("pockets-loot");
        int lootPct = clampPct(MapConfig.cfgInt(ctx.data, "pocket_loot_pct", ctx.sizeName(), 65));
        int[] chestRange = MapConfig.cfgIntRange(ctx.data, "pocket_chests", ctx.sizeName(), 1, 2);
        List<WorldProps.PropDef> props = WorldProps.all(ctx.data);
        StringBuilder detail = new StringBuilder();
        int against = 0;
        Map<Integer, Integer> tiers = new LinkedHashMap<>();
        for (Pocket pocket : ctx.pockets) {
            fillOne(ctx, pocket, rng, lootPct, chestRange, props);
            tiers.merge(pocket.tier, 1, Integer::sum);
            if (pocket.againstWall) {
                against++;
            }
            if (detail.length() > 0) {
                detail.append(" | ");
            }
            detail.append("p")
                    .append(pocket.id)
                    .append(" T")
                    .append(pocket.tier)
                    .append(" interior=")
                    .append(pocket.interior.size())
                    .append(pocket.againstWall ? " wall" : " open")
                    .append(" mine=")
                    .append(pocket.mines)
                    .append(" chests=")
                    .append(pocket.chests)
                    .append(" piles=")
                    .append(pocket.piles)
                    .append(" fillers=")
                    .append(pocket.fillers);
        }
        int roads = roadsTouching(ctx);
        int leaks = entranceLeaks(ctx);
        StringBuilder tiersText = new StringBuilder();
        for (Map.Entry<Integer, Integer> entry : tiers.entrySet()) {
            if (tiersText.length() > 0) {
                tiersText.append(" ");
            }
            tiersText.append("T").append(entry.getKey()).append("=").append(entry.getValue());
        }
        String skips = ctx.pocketSkips.isEmpty() ? "none" : ctx.pocketSkips.toString();
        log.info(
                "S9-23 seed={} size={} eligible={} built={} skipped={} againstWall={} tiers={} roadsTouch={} entranceOnlyFail={} | {} | skips {}",
                ctx.mapSeed,
                ctx.sizeName(),
                ctx.pocketEligible,
                ctx.pockets.size(),
                ctx.pocketSkips.size(),
                against,
                tiersText,
                roads,
                leaks,
                detail,
                skips);
    }

    private static void fillOne(
            MapGenContext ctx,
            Pocket pocket,
            Random rng,
            int lootPct,
            int[] chestRange,
            List<WorldProps.PropDef> props) {
        int size = pocket.interior.size();
        int lootN = Math.max(2, (int) Math.round(size * (lootPct / 100.0)));
        int chests = chestRange[0];
        if (chestRange[1] > chestRange[0]) {
            chests += rng.nextInt(chestRange[1] - chestRange[0] + 1);
        }
        chests = Math.min(chests, Math.max(1, lootN - 1));
        int piles = lootN - 1 - chests;
        while (piles >= 0 && !layoutFits(pocket, 1 + chests + piles)) {
            if (piles > 0) {
                piles--;
            } else if (chests > 1) {
                chests--;
            } else {
                break;
            }
        }
        int lootCount = 1 + chests + piles;
        List<int[]> lootHexes = lootHexes(pocket, lootCount);
        if (lootHexes.size() < lootCount) {
            piles = Math.max(0, lootHexes.size() - 1 - chests);
            if (1 + chests + piles > lootHexes.size()) {
                chests = Math.max(1, lootHexes.size() - 1);
                piles = Math.max(0, lootHexes.size() - 1 - chests);
            }
            lootHexes = lootHexes(pocket, 1 + chests + piles);
        }
        List<Integer> resources = resourcePool(ctx, pocket.tier);
        List<Integer> levels = chestLevels(ctx, pocket.tier);
        int cursor = 0;
        if (!lootHexes.isEmpty() && !resources.isEmpty()) {
            int resourceId = resources.get(rng.nextInt(resources.size()));
            ctx.objects.add(
                    TestGrid.objectAt(lootHexes.get(cursor++), "mine", resourceId, resourceName(ctx, resourceId), rng, ctx.data));
            pocket.mines = 1;
        }
        for (int i = 0; i < chests && cursor < lootHexes.size(); i++) {
            int level = levels.get(rng.nextInt(levels.size()));
            MapObjectData chest = TestGrid.makeChest(lootHexes.get(cursor)[0], lootHexes.get(cursor)[1], level, rng, ctx.data);
            cursor++;
            if (chest != null) {
                ctx.objects.add(chest);
                pocket.chests++;
            }
        }
        for (int i = 0; i < piles && cursor < lootHexes.size() && !resources.isEmpty(); i++) {
            int resourceId = resources.get(rng.nextInt(resources.size()));
            ctx.objects.add(
                    TestGrid.objectAt(
                            lootHexes.get(cursor++), "pickup", resourceId, resourceName(ctx, resourceId), rng, ctx.data));
            pocket.piles++;
        }
        List<int[]> empty = new ArrayList<>();
        Set<String> used = new HashSet<>();
        for (int i = 0; i < cursor && i < lootHexes.size(); i++) {
            used.add(lootHexes.get(i)[0] + "," + lootHexes.get(i)[1]);
        }
        for (int[] hex : pocket.interior) {
            if (!used.contains(hex[0] + "," + hex[1])) {
                empty.add(hex);
            }
        }
        Collections.shuffle(empty, rng);
        int fillers = Math.min(empty.size(), rng.nextInt(3));
        for (int i = 0; i < fillers; i++) {
            int[] hex = empty.get(i);
            HexTerrain terrain = ctx.cells[hex[1]][hex[0]];
            WorldProps.Seed prop = fillerProp(terrain, props, rng);
            if (prop == null) {
                continue;
            }
            if (ctx.propDefs == null || ctx.propDefs.isEmpty()) {
                ctx.propDefs = WorldProps.all(ctx.data);
            }
            ctx.propSeeds[hex[1]][hex[0]] =
                    WorldProps.withPlacementFlip(ctx, hex[0], hex[1], prop, ctx.propDefs);
            pocket.fillers++;
        }
    }

    /** Loot hexes that stay adjacent to a walkable path from the entrance. */
    private static List<int[]> lootHexes(Pocket pocket, int count) {
        List<int[]> empty = new ArrayList<>(pocket.interior);
        int[] door = pocket.entrance;
        empty.sort((a, b) -> {
            int da = HexCoords.hexDistance(
                    HexCoords.qOf(a[0], a[1]), a[1], HexCoords.qOf(door[0], door[1]), door[1]);
            int db = HexCoords.hexDistance(
                    HexCoords.qOf(b[0], b[1]), b[1], HexCoords.qOf(door[0], door[1]), door[1]);
            return Integer.compare(db, da);
        });
        List<int[]> loot = new ArrayList<>();
        while (loot.size() < count && !empty.isEmpty()) {
            int pick = -1;
            for (int i = 0; i < empty.size(); i++) {
                List<int[]> trialEmpty = new ArrayList<>(empty);
                trialEmpty.remove(i);
                if (pathReaches(pocket, trialEmpty, empty.get(i))) {
                    pick = i;
                    break;
                }
            }
            if (pick < 0) {
                break;
            }
            loot.add(empty.remove(pick));
        }
        return loot;
    }

    private static boolean layoutFits(Pocket pocket, int lootCount) {
        return lootHexes(pocket, lootCount).size() >= lootCount;
    }

    /** Empty interior hexes plus the entrance reach every loot hex. */
    private static boolean pathReaches(Pocket pocket, List<int[]> empty, int[] lootHex) {
        Set<String> walk = new HashSet<>();
        walk.add(pocket.entrance[0] + "," + pocket.entrance[1]);
        for (int[] hex : empty) {
            walk.add(hex[0] + "," + hex[1]);
        }
        Set<String> seen = new HashSet<>();
        List<int[]> stack = new ArrayList<>();
        stack.add(pocket.entrance);
        seen.add(pocket.entrance[0] + "," + pocket.entrance[1]);
        boolean touched = false;
        while (!stack.isEmpty()) {
            int[] cur = stack.remove(stack.size() - 1);
            int q = HexCoords.qOf(cur[0], cur[1]);
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nr = cur[1] + d[1];
                int ncol = HexCoords.colOf(q + d[0], nr);
                if (ncol == lootHex[0] && nr == lootHex[1]) {
                    touched = true;
                    continue;
                }
                String key = ncol + "," + nr;
                if (!walk.contains(key) || !seen.add(key)) {
                    continue;
                }
                stack.add(new int[] {ncol, nr});
            }
        }
        return touched;
    }

    private static String tryChunk(
            MapGenContext ctx,
            Random rng,
            List<int[]> cells,
            int chunkId,
            int[] sizeRange,
            int townDist,
            Set<Integer> permNo,
            Set<Integer> wallIds,
            List<WorldProps.PropDef> props,
            List<WorldProps.WallProp> walls) {
        List<int[]> wallSeeds = new ArrayList<>();
        List<int[]> anySeeds = new ArrayList<>();
        for (int[] hex : cells) {
            if (!seedOk(ctx, hex[0], hex[1], chunkId, townDist, permNo)) {
                continue;
            }
            anySeeds.add(hex);
            if (besideWall(ctx, hex[0], hex[1], wallIds)) {
                wallSeeds.add(hex);
            }
        }
        Collections.shuffle(wallSeeds, rng);
        Collections.shuffle(anySeeds, rng);
        String last = "no site";
        int tries = 0;
        for (int[] seed : wallSeeds) {
            if (tries++ >= 10) {
                break;
            }
            String reason = trySeed(
                    ctx, rng, cells, chunkId, seed, true, sizeRange, townDist, permNo, wallIds, props, walls);
            if (reason == null) {
                return null;
            }
            last = reason;
        }
        tries = 0;
        for (int[] seed : anySeeds) {
            if (tries++ >= 10) {
                break;
            }
            if (besideWall(ctx, seed[0], seed[1], wallIds)) {
                continue;
            }
            String reason = trySeed(
                    ctx, rng, cells, chunkId, seed, false, sizeRange, townDist, permNo, wallIds, props, walls);
            if (reason == null) {
                return null;
            }
            last = reason;
        }
        return last;
    }

    private static String trySeed(
            MapGenContext ctx,
            Random rng,
            List<int[]> cells,
            int chunkId,
            int[] seed,
            boolean againstWall,
            int[] sizeRange,
            int townDist,
            Set<Integer> permNo,
            Set<Integer> wallIds,
            List<WorldProps.PropDef> props,
            List<WorldProps.WallProp> walls) {
        int lo = sizeRange[0];
        int hi = Math.max(lo, sizeRange[1]);
        int target = lo + (hi > lo ? rng.nextInt(hi - lo + 1) : 0);
        List<int[]> blob = grow(ctx, seed, target, chunkId, townDist, permNo);
        if (blob.size() < lo) {
            return "too small";
        }
        Set<String> inside = new HashSet<>();
        for (int[] hex : blob) {
            inside.add(hex[0] + "," + hex[1]);
        }
        List<int[]> openable = new ArrayList<>();
        List<int[]> natural = new ArrayList<>();
        for (int[] hex : blob) {
            int q = HexCoords.qOf(hex[0], hex[1]);
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nr = hex[1] + d[1];
                int ncol = HexCoords.colOf(q + d[0], nr);
                if (ncol < 0 || nr < 0 || ncol >= ctx.width || nr >= ctx.height) {
                    continue;
                }
                String key = ncol + "," + nr;
                if (inside.contains(key)) {
                    continue;
                }
                inside.add("ring:" + key);
                if (isBarrier(ctx, ncol, nr)) {
                    natural.add(new int[] {ncol, nr});
                    continue;
                }
                // A walkable hole in another chunk, a gap, or forbidden terrain
                // cannot take a ring prop. enclosed() rejects the leak.
                if (ctx.chunkIds[nr][ncol] != chunkId
                        || !walkableLand(ctx, ncol, nr)
                        || inGap(ctx, ncol, nr)
                        || permNo.contains(ctx.cells[nr][ncol].id())
                        || !seedOk(ctx, ncol, nr, chunkId, townDist, permNo)) {
                    continue;
                }
                openable.add(new int[] {ncol, nr});
            }
        }
        int[] entrance = pickEntrance(ctx, blob, openable, chunkId, wallIds);
        if (entrance == null) {
            return "no entrance";
        }
        List<int[]> toBlock = new ArrayList<>();
        List<WorldProps.Seed> ringProps = new ArrayList<>();
        for (int[] hex : openable) {
            if (hex[0] == entrance[0] && hex[1] == entrance[1]) {
                continue;
            }
            WorldProps.Seed prop = ringProp(ctx.cells[hex[1]][hex[0]], props, walls, rng);
            if (prop == null) {
                return "no ring prop";
            }
            toBlock.add(hex);
            ringProps.add(prop);
        }
        if (!enclosed(ctx, cells, blob, toBlock, natural, entrance)) {
            return "leaks or cuts chunk";
        }
        int tier = rollTier(ctx, rng);
        int id = ctx.pockets.size() + 1;
        Pocket pocket = new Pocket(id, tier, chunkId, againstWall, entrance, List.copyOf(blob));
        for (int i = 0; i < toBlock.size(); i++) {
            int[] hex = toBlock.get(i);
            WorldProps.Seed prop = ringProps.get(i);
            if (ctx.propDefs == null || ctx.propDefs.isEmpty()) {
                ctx.propDefs = WorldProps.all(ctx.data);
            }
            prop = WorldProps.withPlacementFlip(ctx, hex[0], hex[1], prop, ctx.propDefs);
            ctx.propSeeds[hex[1]][hex[0]] = prop;
            ctx.propBlocked[hex[1]][hex[0]] = prop.blocker();
            mark(ctx, hex[0], hex[1], id, tier, false, true, false);
        }
        for (int[] hex : natural) {
            mark(ctx, hex[0], hex[1], id, tier, false, true, false);
        }
        for (int[] hex : blob) {
            mark(ctx, hex[0], hex[1], id, tier, true, false, false);
        }
        mark(ctx, entrance[0], entrance[1], id, tier, false, false, true);
        ctx.pockets.add(pocket);
        return null;
    }

    private static void mark(
            MapGenContext ctx, int col, int row, int id, int tier, boolean interior, boolean ring, boolean entrance) {
        ctx.pocketSeal[row][col] = true;
        ctx.pocketIds[row][col] = id;
        ctx.pocketTiers[row][col] = tier;
        if (interior) {
            ctx.pocketInterior[row][col] = true;
        }
        if (ring) {
            ctx.pocketRing[row][col] = true;
        }
        if (entrance) {
            ctx.pocketEntrance[row][col] = true;
        }
    }

    private static List<int[]> grow(
            MapGenContext ctx,
            int[] seed,
            int target,
            int chunkId,
            int townDist,
            Set<Integer> permNo) {
        List<int[]> blob = new ArrayList<>();
        Set<String> in = new HashSet<>();
        blob.add(seed);
        in.add(seed[0] + "," + seed[1]);
        while (blob.size() < target) {
            int[] best = null;
            int bestD = Integer.MAX_VALUE;
            for (int[] hex : blob) {
                int q = HexCoords.qOf(hex[0], hex[1]);
                for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                    int nr = hex[1] + d[1];
                    int ncol = HexCoords.colOf(q + d[0], nr);
                    if (!seedOk(ctx, ncol, nr, chunkId, townDist, permNo)) {
                        continue;
                    }
                    if (ctx.chunkIds[nr][ncol] != chunkId) {
                        continue;
                    }
                    String key = ncol + "," + nr;
                    if (in.contains(key)) {
                        continue;
                    }
                    int dist = HexCoords.hexDistance(HexCoords.qOf(seed[0], seed[1]), seed[1], HexCoords.qOf(ncol, nr), nr);
                    if (dist < bestD) {
                        bestD = dist;
                        best = new int[] {ncol, nr};
                    }
                }
            }
            if (best == null) {
                break;
            }
            blob.add(best);
            in.add(best[0] + "," + best[1]);
        }
        return blob;
    }

    private static int[] pickEntrance(
            MapGenContext ctx, List<int[]> blob, List<int[]> openable, int chunkId, Set<Integer> wallIds) {
        Set<String> inside = new HashSet<>();
        for (int[] hex : blob) {
            inside.add(hex[0] + "," + hex[1]);
        }
        int[] best = null;
        int bestScore = -1;
        for (int[] hex : openable) {
            int outside = 0;
            boolean faces = false;
            int q = HexCoords.qOf(hex[0], hex[1]);
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nr = hex[1] + d[1];
                int ncol = HexCoords.colOf(q + d[0], nr);
                if (ncol < 0 || nr < 0 || ncol >= ctx.width || nr >= ctx.height) {
                    continue;
                }
                if (inside.contains(ncol + "," + nr)) {
                    continue;
                }
                if (!walkableLand(ctx, ncol, nr) || blocked(ctx, ncol, nr)) {
                    continue;
                }
                outside++;
                if (ctx.chunkIds[nr][ncol] == chunkId) {
                    faces = true;
                }
            }
            if (outside <= 0) {
                continue;
            }
            int score = outside + (faces ? 20 : 0);
            if (!besideWall(ctx, hex[0], hex[1], wallIds)) {
                score += 5;
            }
            if (score > bestScore) {
                bestScore = score;
                best = hex;
            }
        }
        return best;
    }

    /**
     * Interior is reached only through the entrance, and blocking the new ring
     * does not split the rest of the chunk.
     */
    private static boolean enclosed(
            MapGenContext ctx,
            List<int[]> cells,
            List<int[]> blob,
            List<int[]> toBlock,
            List<int[]> natural,
            int[] entrance) {
        Set<String> interior = new HashSet<>();
        for (int[] hex : blob) {
            interior.add(hex[0] + "," + hex[1]);
        }
        Set<String> blocked = new HashSet<>();
        for (int[] hex : toBlock) {
            blocked.add(hex[0] + "," + hex[1]);
        }
        for (int[] hex : natural) {
            blocked.add(hex[0] + "," + hex[1]);
        }
        String entranceKey = entrance[0] + "," + entrance[1];
        Set<String> fromEntrance = flood(ctx, entrance, interior, blocked, entranceKey, true);
        if (!fromEntrance.containsAll(interior)) {
            return false;
        }
        int[] outside = outsideNeighbor(ctx, entrance, interior, blocked);
        if (outside == null) {
            return false;
        }
        Set<String> sealed = flood(ctx, outside, interior, blocked, entranceKey, false);
        for (String key : interior) {
            if (sealed.contains(key)) {
                return false;
            }
        }
        Set<String> chunkOutside = new HashSet<>();
        for (int[] hex : cells) {
            String key = hex[0] + "," + hex[1];
            if (interior.contains(key) || blocked.contains(key)) {
                continue;
            }
            if (walkableLand(ctx, hex[0], hex[1]) && !blocked(ctx, hex[0], hex[1])) {
                chunkOutside.add(key);
            }
        }
        if (chunkOutside.isEmpty()) {
            return true;
        }
        Set<String> beforeBlocked = new HashSet<>();
        int before = components(ctx, cells, interior, beforeBlocked);
        int after = components(ctx, cells, interior, blocked);
        return after <= before;
    }

    private static int components(
            MapGenContext ctx, List<int[]> cells, Set<String> interior, Set<String> blocked) {
        Set<String> seen = new HashSet<>();
        int n = 0;
        for (int[] hex : cells) {
            String key = hex[0] + "," + hex[1];
            if (interior.contains(key) || blocked.contains(key) || seen.contains(key)) {
                continue;
            }
            if (!walkableLand(ctx, hex[0], hex[1]) || blocked(ctx, hex[0], hex[1])) {
                continue;
            }
            n++;
            List<int[]> stack = new ArrayList<>();
            stack.add(hex);
            seen.add(key);
            while (!stack.isEmpty()) {
                int[] cur = stack.remove(stack.size() - 1);
                int q = HexCoords.qOf(cur[0], cur[1]);
                for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                    int nr = cur[1] + d[1];
                    int ncol = HexCoords.colOf(q + d[0], nr);
                    if (ncol < 0 || nr < 0 || ncol >= ctx.width || nr >= ctx.height) {
                        continue;
                    }
                    String nk = ncol + "," + nr;
                    if (interior.contains(nk) || blocked.contains(nk) || !seen.add(nk)) {
                        continue;
                    }
                    if (!sameChunk(ctx, cells, ncol, nr)) {
                        continue;
                    }
                    if (!walkableLand(ctx, ncol, nr) || blocked(ctx, ncol, nr)) {
                        continue;
                    }
                    stack.add(new int[] {ncol, nr});
                }
            }
        }
        return n;
    }

    private static boolean sameChunk(MapGenContext ctx, List<int[]> cells, int col, int row) {
        if (cells.isEmpty()) {
            return false;
        }
        int id = ctx.chunkIds[cells.get(0)[1]][cells.get(0)[0]];
        return ctx.chunkIds[row][col] == id;
    }

    private static Set<String> flood(
            MapGenContext ctx,
            int[] start,
            Set<String> interior,
            Set<String> blocked,
            String entranceKey,
            boolean allowInterior) {
        Set<String> seen = new HashSet<>();
        List<int[]> stack = new ArrayList<>();
        stack.add(start);
        seen.add(start[0] + "," + start[1]);
        while (!stack.isEmpty()) {
            int[] cur = stack.remove(stack.size() - 1);
            int q = HexCoords.qOf(cur[0], cur[1]);
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nr = cur[1] + d[1];
                int ncol = HexCoords.colOf(q + d[0], nr);
                if (ncol < 0 || nr < 0 || ncol >= ctx.width || nr >= ctx.height) {
                    continue;
                }
                String key = ncol + "," + nr;
                if (!seen.add(key)) {
                    continue;
                }
                if (blocked.contains(key)) {
                    continue;
                }
                if (!allowInterior && interior.contains(key)) {
                    continue;
                }
                if (!allowInterior && entranceKey.equals(key)) {
                    continue;
                }
                if (!walkableLand(ctx, ncol, nr)) {
                    continue;
                }
                if (blocked(ctx, ncol, nr) && !entranceKey.equals(key) && !interior.contains(key)) {
                    continue;
                }
                stack.add(new int[] {ncol, nr});
            }
        }
        return seen;
    }

    private static int[] outsideNeighbor(
            MapGenContext ctx, int[] entrance, Set<String> interior, Set<String> blocked) {
        int q = HexCoords.qOf(entrance[0], entrance[1]);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nr = entrance[1] + d[1];
            int ncol = HexCoords.colOf(q + d[0], nr);
            if (ncol < 0 || nr < 0 || ncol >= ctx.width || nr >= ctx.height) {
                continue;
            }
            String key = ncol + "," + nr;
            if (interior.contains(key) || blocked.contains(key)) {
                continue;
            }
            if (walkableLand(ctx, ncol, nr) && !blocked(ctx, ncol, nr)) {
                return new int[] {ncol, nr};
            }
        }
        return null;
    }

    private static boolean seedOk(
            MapGenContext ctx, int col, int row, int chunkId, int townDist, Set<Integer> permNo) {
        if (col < 0 || row < 0 || col >= ctx.width || row >= ctx.height) {
            return false;
        }
        if (ctx.chunkIds[row][col] != chunkId && chunkId > 0) {
            return false;
        }
        if (!walkableLand(ctx, col, row) || blocked(ctx, col, row)) {
            return false;
        }
        if (permNo.contains(ctx.cells[row][col].id())) {
            return false;
        }
        if (inGap(ctx, col, row)) {
            return false;
        }
        if (ctx.townReserved != null && ctx.townReserved[row][col]) {
            return false;
        }
        int q = HexCoords.qOf(col, row);
        for (TownSite site : ctx.townSites) {
            int eq = HexCoords.qOf(site.col(), site.row());
            int kq = HexCoords.qOf(site.keepCol(), site.row());
            int dist = Math.min(
                    HexCoords.hexDistance(q, row, eq, site.row()),
                    HexCoords.hexDistance(q, row, kq, site.row()));
            if (dist < townDist) {
                return false;
            }
        }
        return true;
    }

    private static boolean walkableLand(MapGenContext ctx, int col, int row) {
        if (col < 0 || row < 0 || col >= ctx.width || row >= ctx.height) {
            return false;
        }
        HexTerrain terrain = ctx.cells[row][col];
        return terrain != null && terrain.isPassable() && terrain.movementCost() != null && !terrain.blocked();
    }

    private static boolean blocked(MapGenContext ctx, int col, int row) {
        return ctx.propBlocked != null && ctx.propBlocked[row][col];
    }

    /** Impassable terrain, or a prop that already blocks movement. */
    private static boolean isBarrier(MapGenContext ctx, int col, int row) {
        if (!walkableLand(ctx, col, row)) {
            return true;
        }
        return blocked(ctx, col, row);
    }

    private static boolean besideWall(MapGenContext ctx, int col, int row, Set<Integer> wallIds) {
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nr = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nr);
            if (ncol < 0 || nr < 0 || ncol >= ctx.width || nr >= ctx.height) {
                continue;
            }
            if (!blocked(ctx, ncol, nr) || ctx.propSeeds[nr][ncol] == null) {
                continue;
            }
            if (wallIds.contains(ctx.propSeeds[nr][ncol].propId())) {
                return true;
            }
        }
        return false;
    }

    private static boolean inGap(MapGenContext ctx, int col, int row) {
        if (ctx.wallGap == null) {
            return false;
        }
        if (ctx.wallGap[row][col]) {
            return true;
        }
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nr = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nr);
            if (ncol >= 0 && nr >= 0 && ncol < ctx.width && nr < ctx.height && ctx.wallGap[nr][ncol]) {
                return true;
            }
        }
        return false;
    }

    private static WorldProps.Seed ringProp(
            HexTerrain terrain,
            List<WorldProps.PropDef> props,
            List<WorldProps.WallProp> walls,
            Random rng) {
        List<WorldProps.PropDef> blockers = new ArrayList<>();
        for (WorldProps.PropDef prop : props) {
            if (!prop.blocker()) {
                continue;
            }
            Double density = prop.terrainRules().get(terrain.id());
            if (density != null && density > 0) {
                blockers.add(prop);
            }
        }
        WorldProps.WallProp wall = null;
        for (WorldProps.WallProp candidate : walls) {
            if (candidate.terrains().contains(terrain.id())) {
                wall = candidate;
                break;
            }
        }
        boolean useWall = wall != null && (blockers.isEmpty() || rng.nextBoolean());
        if (useWall) {
            int variant = 1 + rng.nextInt(Math.max(1, wall.variantCount()));
            return new WorldProps.Seed(wall.id(), variant, wall.fileName(), true);
        }
        if (blockers.isEmpty()) {
            return null;
        }
        WorldProps.PropDef pick = blockers.get(rng.nextInt(blockers.size()));
        int variant = 1 + rng.nextInt(Math.max(1, pick.variantCount()));
        return new WorldProps.Seed(pick.id(), variant, pick.fileName(), true);
    }

    private static WorldProps.Seed fillerProp(HexTerrain terrain, List<WorldProps.PropDef> props, Random rng) {
        if (terrain == null) {
            return null;
        }
        List<WorldProps.PropDef> soft = new ArrayList<>();
        for (WorldProps.PropDef prop : props) {
            if (prop.blocker()) {
                continue;
            }
            Double density = prop.terrainRules().get(terrain.id());
            if (density != null && density > 0) {
                soft.add(prop);
            }
        }
        if (soft.isEmpty()) {
            return null;
        }
        WorldProps.PropDef pick = soft.get(rng.nextInt(soft.size()));
        int variant = 1 + rng.nextInt(Math.max(1, pick.variantCount()));
        return new WorldProps.Seed(pick.id(), variant, pick.fileName(), false);
    }

    private static int rollTier(MapGenContext ctx, Random rng) {
        Map<Integer, Integer> weights = weightMap(ctx);
        int total = 0;
        for (int weight : weights.values()) {
            total += weight;
        }
        if (total <= 0) {
            return 4;
        }
        int roll = rng.nextInt(total);
        int acc = 0;
        for (Map.Entry<Integer, Integer> entry : weights.entrySet()) {
            acc += entry.getValue();
            if (roll < acc) {
                return entry.getKey();
            }
        }
        return 4;
    }

    private static Map<Integer, Integer> weightMap(MapGenContext ctx) {
        Map<Integer, Integer> out = new LinkedHashMap<>();
        Object raw = MapConfig.mapCfg(ctx.data, "pocket_tier_weights", ctx.sizeName());
        if (raw instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                Integer tier = MapConfig.asInt(entry.getKey());
                Integer weight = MapConfig.asInt(entry.getValue());
                if (tier != null && weight != null && tier > 0 && weight > 0) {
                    out.put(tier, weight);
                }
            }
        }
        if (out.isEmpty()) {
            out.put(4, 50);
            out.put(5, 35);
            out.put(6, 15);
        }
        return out;
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

    private static int roadsTouching(MapGenContext ctx) {
        if (ctx.hasRoad == null || ctx.pocketSeal == null) {
            return 0;
        }
        int n = 0;
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (ctx.pocketSeal[row][col] && ctx.hasRoad[row][col]) {
                    n++;
                }
            }
        }
        return n;
    }

    private static int entranceLeaks(MapGenContext ctx) {
        int leaks = 0;
        for (Pocket pocket : ctx.pockets) {
            Set<String> interior = new HashSet<>();
            for (int[] hex : pocket.interior) {
                interior.add(hex[0] + "," + hex[1]);
            }
            Set<String> blocked = new HashSet<>();
            if (ctx.pocketRing != null) {
                for (int row = 0; row < ctx.height; row++) {
                    for (int col = 0; col < ctx.width; col++) {
                        if (ctx.pocketRing[row][col] && ctx.pocketIds[row][col] == pocket.id) {
                            blocked.add(col + "," + row);
                        }
                    }
                }
            }
            String entranceKey = pocket.entrance[0] + "," + pocket.entrance[1];
            Set<String> reached = flood(ctx, pocket.entrance, interior, blocked, entranceKey, true);
            if (!reached.containsAll(interior)) {
                leaks++;
                continue;
            }
            int[] outside = outsideNeighbor(ctx, pocket.entrance, interior, blocked);
            if (outside == null) {
                leaks++;
                continue;
            }
            Set<String> sealed = flood(ctx, outside, interior, blocked, entranceKey, false);
            for (String key : interior) {
                if (sealed.contains(key)) {
                    leaks++;
                    break;
                }
            }
        }
        return leaks;
    }

    private static void markTownChunk(MapGenContext ctx, Set<Integer> townChunks, int col, int row) {
        if (col < 0 || row < 0 || col >= ctx.width || row >= ctx.height) {
            return;
        }
        int id = ctx.chunkIds[row][col];
        if (id > 0) {
            townChunks.add(id);
        }
    }

    private static Set<Integer> wallIds(MapGenContext ctx) {
        Set<Integer> ids = new HashSet<>();
        for (WorldProps.WallProp wall : WorldProps.walls(ctx.data)) {
            ids.add(wall.id());
        }
        return ids;
    }

    private static Set<Integer> intSet(MapGenContext ctx, String key, int... fallback) {
        Set<Integer> out = new HashSet<>();
        Object raw = MapConfig.mapCfg(ctx.data, key, ctx.sizeName());
        if (raw instanceof List<?> list) {
            for (Object item : list) {
                Integer n = MapConfig.asInt(item);
                if (n != null) {
                    out.add(n);
                }
            }
        }
        if (out.isEmpty()) {
            for (int n : fallback) {
                out.add(n);
            }
        }
        return out;
    }

    private static int clampPct(int value) {
        return Math.max(0, Math.min(100, value));
    }
}
