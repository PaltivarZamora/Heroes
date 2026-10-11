package com.heroesofyendor;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.Set;

/**
 * World mobs (BR S9-25), pipeline layer 6. Random, gap, road, and guard mobs
 * share one sub-seed. They are not terrain blockers; the final check still runs
 * after this layer.
 */
final class MobsLayer {

    private MobsLayer() {}

    static void run(MapGenContext ctx) {
        Random rng = ctx.rngFor("mobs");
        Catalog cat = Catalog.load(ctx.data);
        int minTown = Math.max(1, MapConfig.cfgInt(ctx.data, "mob_min_town_dist", ctx.sizeName(), 10));
        int tierMax = Math.max(1, MapConfig.cfgInt(ctx.data, "mob_tier_max", ctx.sizeName(), 3));
        int advancedPct =
                Math.max(
                        0,
                        Math.min(
                                100,
                                (int) Math.round(
                                        MapConfig.cfgDouble(
                                                ctx.data, "mob_advanced_pct", ctx.sizeName(), 10))));
        int townType = Math.max(0, MapConfig.cfgInt(ctx.data, "mob_town_type", ctx.sizeName(), 0));
        double gapPct = MapConfig.cfgDouble(ctx.data, "gap_mob_pct", ctx.sizeName(), 50) / 100.0;
        double roadPct = MapConfig.cfgDouble(ctx.data, "road_mob_pct", ctx.sizeName(), 20) / 100.0;
        int total = MapConfig.scaledCfgInt(ctx.data, "mobs", ctx.sizeName(), 100);
        int roadTarget = Math.max(0, (int) Math.round(total * roadPct));
        List<int[]> bands = tierBands(ctx);
        Set<String> occupied = new HashSet<>();
        Set<String> features = featureKeys(ctx);
        List<int[]> towns = townFootprints(ctx);
        List<int[]> starts = startingTowns(ctx);

        int chest = 0;
        int pocket = 0;
        int island = 0;
        List<MapMobData> mobs = new ArrayList<>();

        int groundItemGuards = 0;
        for (MapObjectData obj : ctx.objects) {
            if (!"chest".equals(obj.kind()) || obj.guardQ() == null || obj.guardR() == null) {
                continue;
            }
            int level = obj.level() == null ? 0 : obj.level();
            if (placeGuard(
                    ctx,
                    cat,
                    rng,
                    mobs,
                    occupied,
                    obj.guardQ(),
                    obj.guardR(),
                    cat.chestTiers(level),
                    townType,
                    advancedPct)) {
                chest++;
            }
        }
        for (MapObjectData obj : ctx.objects) {
            if (!"ground_item".equals(obj.kind()) || obj.guardQ() == null || obj.guardR() == null) {
                continue;
            }
            int tierMeta = obj.resourceId() == null ? 2 : obj.resourceId();
            List<Integer> tiers = List.of(tierMeta);
            if (placeGuard(
                    ctx,
                    cat,
                    rng,
                    mobs,
                    occupied,
                    obj.guardQ(),
                    obj.guardR(),
                    tiers,
                    townType,
                    advancedPct)) {
                groundItemGuards++;
            }
        }
        if (ctx.pocketEntrance != null && ctx.pocketTiers != null) {
            List<int[]> doors = new ArrayList<>();
            for (int row = 0; row < ctx.height; row++) {
                for (int col = 0; col < ctx.width; col++) {
                    if (ctx.pocketEntrance[row][col] && ctx.pocketTiers[row][col] > 0) {
                        doors.add(new int[] {HexCoords.qOf(col, row), row, ctx.pocketTiers[row][col]});
                    }
                }
            }
            doors.sort(Comparator.comparingInt((int[] a) -> a[0]).thenComparingInt(a -> a[1]));
            for (int[] door : doors) {
                if (placeGuard(
                        ctx,
                        cat,
                        rng,
                        mobs,
                        occupied,
                        door[0],
                        door[1],
                        List.of(door[2]),
                        townType,
                        advancedPct)) {
                    pocket++;
                }
            }
        }
        if (ctx.islandGuardTier != null) {
            List<int[]> landings = new ArrayList<>();
            for (int row = 0; row < ctx.height; row++) {
                for (int col = 0; col < ctx.width; col++) {
                    if (ctx.islandGuardTier[row][col] > 0) {
                        landings.add(
                                new int[] {
                                    HexCoords.qOf(col, row), row, ctx.islandGuardTier[row][col]
                                });
                    }
                }
            }
            landings.sort(Comparator.comparingInt((int[] a) -> a[0]).thenComparingInt(a -> a[1]));
            for (int[] landing : landings) {
                if (placeGuard(
                        ctx,
                        cat,
                        rng,
                        mobs,
                        occupied,
                        landing[0],
                        landing[1],
                        List.of(landing[2]),
                        townType,
                        advancedPct)) {
                    island++;
                }
            }
        }

        List<int[]> valid = new ArrayList<>();
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                int q = HexCoords.qOf(col, row);
                if (!randomHexOk(ctx, q, row, col, occupied, features, towns, minTown)) {
                    continue;
                }
                valid.add(new int[] {q, row, col});
            }
        }

        int gaps = 0;
        for (List<int[]> gap : gapComponents(ctx)) {
            if (rng.nextDouble() >= gapPct) {
                continue;
            }
            List<int[]> spots = new ArrayList<>();
            for (int[] hex : gap) {
                if (randomHexOk(ctx, hex[0], hex[1], hex[2], occupied, features, towns, minTown)) {
                    spots.add(hex);
                }
            }
            if (spots.isEmpty()) {
                continue;
            }
            int[] pick = spots.get(rng.nextInt(spots.size()));
            if (placeRandom(
                    ctx, cat, rng, mobs, occupied, pick, starts, tierMax, bands, townType, advancedPct)) {
                gaps++;
            }
        }

        Set<String> nearRoad = roadNeighborhood(ctx, 2);
        List<int[]> roadSpots = new ArrayList<>();
        List<int[]> open = new ArrayList<>();
        for (int[] hex : valid) {
            if (occupied.contains(HexCoords.key(hex[0], hex[1]))) {
                continue;
            }
            open.add(hex);
            if (nearRoad.contains(HexCoords.key(hex[0], hex[1]))) {
                roadSpots.add(hex);
            }
        }
        shuffle(roadSpots, rng);
        int roads = 0;
        int roadLeft = roadTarget;
        for (int[] hex : roadSpots) {
            if (roadLeft <= 0) {
                break;
            }
            if (!occupied.contains(HexCoords.key(hex[0], hex[1]))
                    && placeRandom(
                            ctx,
                            cat,
                            rng,
                            mobs,
                            occupied,
                            hex,
                            starts,
                            tierMax,
                            bands,
                            townType,
                            advancedPct)) {
                roads++;
                roadLeft--;
            }
        }
        shuffle(open, rng);
        int scatterTarget = Math.max(0, total - roadTarget) + roadLeft;
        int scatter = 0;
        for (int[] hex : open) {
            if (scatter >= scatterTarget) {
                break;
            }
            if (occupied.contains(HexCoords.key(hex[0], hex[1]))) {
                continue;
            }
            if (placeRandom(
                    ctx, cat, rng, mobs, occupied, hex, starts, tierMax, bands, townType, advancedPct)) {
                scatter++;
            }
        }

        ctx.mobs = mobs;
        String detail =
                "gap="
                        + gaps
                        + " road="
                        + roads
                        + " scatter="
                        + scatter
                        + " chest="
                        + chest
                        + " ground_item="
                        + groundItemGuards
                        + " pocket="
                        + pocket
                        + " island="
                        + island
                        + " total="
                        + mobs.size();
        MapGenTimings.current().layerDetail("L6", detail);
        MapGenPipeline.logCounts("mobs", detail);
    }

    private static boolean placeGuard(
            MapGenContext ctx,
            Catalog cat,
            Random rng,
            List<MapMobData> mobs,
            Set<String> occupied,
            int q,
            int r,
            List<Integer> tiers,
            int townType,
            int advancedPct) {
        return placeGuard(
                ctx, cat, rng, mobs, occupied, q, r, tiers, townType, advancedPct, true);
    }

    private static boolean placeGuard(
            MapGenContext ctx,
            Catalog cat,
            Random rng,
            List<MapMobData> mobs,
            Set<String> occupied,
            int q,
            int r,
            List<Integer> tiers,
            int townType,
            int advancedPct,
            boolean guardsLoot) {
        String key = HexCoords.key(q, r);
        if (occupied.contains(key) || tiers.isEmpty()) {
            return false;
        }
        int col = HexCoords.colOf(q, r);
        if (col < 0 || r < 0 || col >= ctx.width || r >= ctx.height) {
            return false;
        }
        HexTerrain terrain = ctx.cells[r][col];
        if (terrain == null || terrain.blocked()) {
            return false;
        }
        List<Unit> pool = cat.pool(tiers, townType, false);
        if (pool.isEmpty() && townType > 0) {
            pool = cat.pool(tiers, 0, false);
        }
        if (pool.isEmpty()) {
            return false;
        }
        Unit unit = pool.get(rng.nextInt(pool.size()));
        mobs.add(new MapMobData(q, r, cat.composition(unit, advancedPct), guardsLoot));
        occupied.add(key);
        return true;
    }

    private static boolean placeRandom(
            MapGenContext ctx,
            Catalog cat,
            Random rng,
            List<MapMobData> mobs,
            Set<String> occupied,
            int[] hex,
            List<int[]> starts,
            int tierMax,
            List<int[]> bands,
            int townType,
            int advancedPct) {
        int maxTier = Math.min(tierMax, tierForDistance(hexDistanceTo(hex[0], hex[1], starts), bands));
        maxTier = Math.max(1, maxTier);
        List<Integer> tiers = new ArrayList<>();
        for (int t = 1; t <= maxTier; t++) {
            tiers.add(t);
        }
        return placeGuard(
                ctx,
                cat,
                rng,
                mobs,
                occupied,
                hex[0],
                hex[1],
                tiers,
                townType,
                advancedPct,
                false);
    }

    private static boolean randomHexOk(
            MapGenContext ctx,
            int q,
            int row,
            int col,
            Set<String> occupied,
            Set<String> features,
            List<int[]> towns,
            int minTown) {
        if (occupied.contains(HexCoords.key(q, row)) || features.contains(HexCoords.key(q, row))) {
            return false;
        }
        if (ctx.pocketInterior != null && ctx.pocketInterior[row][col]) {
            return false;
        }
        if (ctx.townReserved != null && ctx.townReserved[row][col]) {
            return false;
        }
        HexTerrain terrain = ctx.cells[row][col];
        if (terrain == null || terrain.blocked() || isWater(terrain)) {
            return false;
        }
        if (ctx.propSeeds != null) {
            WorldProps.Seed prop = ctx.propSeeds[row][col];
            if (prop != null && prop.blocker()) {
                return false;
            }
        }
        return hexDistanceTo(q, row, towns) >= minTown;
    }

    private static boolean isWater(HexTerrain terrain) {
        String name = terrain.label().toLowerCase(Locale.ROOT);
        return name.equals("water") || name.equals("shallow");
    }

    private static int tierForDistance(int dist, List<int[]> bands) {
        int cap = 6;
        for (int[] band : bands) {
            cap = band[1];
            if (dist <= band[0]) {
                return cap;
            }
        }
        return cap;
    }

    private static List<int[]> tierBands(MapGenContext ctx) {
        Object raw = MapConfig.mapCfg(ctx.data, "mob_tier_by_dist", ctx.sizeName());
        List<int[]> bands = new ArrayList<>();
        if (raw instanceof List<?> list) {
            for (Object entry : list) {
                if (!(entry instanceof List<?> pair) || pair.size() < 2) {
                    continue;
                }
                Integer dist = asInt(pair.get(0));
                Integer tier = asInt(pair.get(1));
                if (dist != null && tier != null && dist > 0 && tier > 0) {
                    bands.add(new int[] {dist, tier});
                }
            }
        }
        if (bands.isEmpty()) {
            bands.add(new int[] {15, 2});
            bands.add(new int[] {30, 4});
            bands.add(new int[] {9999, 6});
        }
        bands.sort(Comparator.comparingInt(a -> a[0]));
        return bands;
    }

    private static List<List<int[]>> gapComponents(MapGenContext ctx) {
        List<List<int[]>> gaps = new ArrayList<>();
        if (ctx.wallGap == null) {
            return gaps;
        }
        boolean[][] seen = new boolean[ctx.height][ctx.width];
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (!ctx.wallGap[row][col] || seen[row][col]) {
                    continue;
                }
                List<int[]> comp = new ArrayList<>();
                List<int[]> stack = new ArrayList<>();
                stack.add(new int[] {col, row});
                seen[row][col] = true;
                while (!stack.isEmpty()) {
                    int[] cur = stack.remove(stack.size() - 1);
                    int q = HexCoords.qOf(cur[0], cur[1]);
                    comp.add(new int[] {q, cur[1], cur[0]});
                    for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                        int nr = cur[1] + d[1];
                        int ncol = HexCoords.colOf(q + d[0], nr);
                        if (ncol < 0 || nr < 0 || ncol >= ctx.width || nr >= ctx.height) {
                            continue;
                        }
                        if (seen[nr][ncol] || !ctx.wallGap[nr][ncol]) {
                            continue;
                        }
                        seen[nr][ncol] = true;
                        stack.add(new int[] {ncol, nr});
                    }
                }
                comp.sort(Comparator.comparingInt((int[] a) -> a[0]).thenComparingInt(a -> a[1]));
                gaps.add(comp);
            }
        }
        gaps.sort(
                Comparator.comparingInt((List<int[]> g) -> g.get(0)[0])
                        .thenComparingInt(g -> g.get(0)[1]));
        return gaps;
    }

    private static Set<String> roadNeighborhood(MapGenContext ctx, int radius) {
        Set<String> marked = new HashSet<>();
        if (ctx.hasRoad == null || radius < 0) {
            return marked;
        }
        List<int[]> frontier = new ArrayList<>();
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (!ctx.hasRoad[row][col]) {
                    continue;
                }
                int q = HexCoords.qOf(col, row);
                String key = HexCoords.key(q, row);
                if (marked.add(key)) {
                    frontier.add(new int[] {q, row, 0});
                }
            }
        }
        for (int i = 0; i < frontier.size(); i++) {
            int[] hex = frontier.get(i);
            if (hex[2] >= radius) {
                continue;
            }
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nq = hex[0] + d[0];
                int nr = hex[1] + d[1];
                int ncol = HexCoords.colOf(nq, nr);
                if (ncol < 0 || nr < 0 || ncol >= ctx.width || nr >= ctx.height) {
                    continue;
                }
                String key = HexCoords.key(nq, nr);
                if (!marked.add(key)) {
                    continue;
                }
                frontier.add(new int[] {nq, nr, hex[2] + 1});
            }
        }
        return marked;
    }

    private static Set<String> featureKeys(MapGenContext ctx) {
        Set<String> keys = new HashSet<>();
        for (MapObjectData obj : ctx.objects) {
            keys.add(HexCoords.key(obj.q(), obj.r()));
        }
        return keys;
    }

    private static List<int[]> townFootprints(MapGenContext ctx) {
        List<int[]> towns = new ArrayList<>();
        for (TownSite site : ctx.townSites) {
            towns.add(new int[] {HexCoords.qOf(site.col(), site.row()), site.row()});
            towns.add(new int[] {HexCoords.qOf(site.keepCol(), site.row()), site.row()});
        }
        return towns;
    }

    private static List<int[]> startingTowns(MapGenContext ctx) {
        List<int[]> starts = new ArrayList<>();
        for (TownSite site : ctx.townSites) {
            if (!site.starting()) {
                continue;
            }
            starts.add(new int[] {HexCoords.qOf(site.col(), site.row()), site.row()});
        }
        if (starts.isEmpty()) {
            return townFootprints(ctx);
        }
        return starts;
    }

    private static int hexDistanceTo(int q, int r, List<int[]> hexes) {
        int best = Integer.MAX_VALUE;
        for (int[] hex : hexes) {
            best = Math.min(best, HexCoords.hexDistance(q, r, hex[0], hex[1]));
        }
        return best;
    }

    private static void shuffle(List<int[]> list, Random rng) {
        for (int i = list.size() - 1; i > 0; i--) {
            int j = rng.nextInt(i + 1);
            int[] tmp = list.get(i);
            list.set(i, list.get(j));
            list.set(j, tmp);
        }
    }

    private static Integer asInt(Object value) {
        if (value instanceof Number n) {
            return n.intValue();
        }
        if (value == null) {
            return null;
        }
        try {
            return Integer.parseInt(value.toString().trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static final class Unit {
        final int id;
        /** Faction filter: unit town, else the dwelling's town. */
        final int townId;
        /** Unit row only. Upgrade pairing does not fall back to the dwelling. */
        final int rawTown;
        final int tier;
        final int rawClass;
        final int level;
        final int growth;

        Unit(int id, int townId, int rawTown, int tier, int rawClass, int level, int growth) {
            this.id = id;
            this.townId = townId;
            this.rawTown = rawTown;
            this.tier = tier;
            this.rawClass = rawClass;
            this.level = level;
            this.growth = growth;
        }
    }

    private static final class Catalog {
        final List<Unit> units;
        final Map<Integer, List<Integer>> chestTiersByLevel;

        Catalog(List<Unit> units, Map<Integer, List<Integer>> chestTiersByLevel) {
            this.units = units;
            this.chestTiersByLevel = chestTiersByLevel;
        }

        static Catalog load(ReferenceData data) {
            Map<Integer, int[]> buildings = new HashMap<>();
            for (Map<String, Object> row : data.rows("building")) {
                Integer id = asInt(row.get("id"));
                if (id == null) {
                    continue;
                }
                int growth = growthOf(row);
                int townId = asInt(row.get("town_id")) == null ? 0 : asInt(row.get("town_id"));
                int classId = asInt(row.get("class_id")) == null ? 0 : asInt(row.get("class_id"));
                buildings.put(id, new int[] {growth, townId, classId});
            }
            List<Unit> units = new ArrayList<>();
            for (Map<String, Object> row : data.rows("unit")) {
                Integer id = asInt(row.get("id"));
                if (id == null || !hasAbilities(row.get("abilities"))) {
                    continue;
                }
                Integer speed = asInt(row.get("speed"));
                if (speed == null || speed <= 0) {
                    continue;
                }
                int level = asInt(row.get("level")) == null ? 1 : Math.max(1, asInt(row.get("level")));
                int bldgId = asInt(row.get("bldg_id")) == null ? 0 : asInt(row.get("bldg_id"));
                int[] bldg = buildings.get(bldgId);
                int growth = bldg == null ? 0 : bldg[0];
                if (level == 1 && growth <= 0) {
                    continue;
                }
                if (level != 1 && level != 2) {
                    continue;
                }
                int rawTown = asInt(row.get("town_id")) == null ? 0 : asInt(row.get("town_id"));
                int townId = rawTown > 0 ? rawTown : (bldg == null ? 0 : bldg[1]);
                int rawClass = asInt(row.get("class_id")) == null ? 0 : asInt(row.get("class_id"));
                int tier = asInt(row.get("tier")) == null ? 0 : asInt(row.get("tier"));
                if (tier <= 0) {
                    continue;
                }
                units.add(new Unit(id, townId, rawTown, tier, rawClass, level, growth));
            }
            units.sort(Comparator.comparingInt(u -> u.id));
            return new Catalog(units, loadChestTiers(data));
        }

        List<Integer> chestTiers(int level) {
            List<Integer> tiers = chestTiersByLevel.get(level);
            return tiers == null ? List.of() : tiers;
        }

        List<Unit> pool(List<Integer> tiers, int townType, boolean advanced) {
            Set<Integer> allowed = new HashSet<>(tiers);
            List<Unit> out = new ArrayList<>();
            for (Unit unit : units) {
                if (advanced ? unit.level != 2 : unit.level != 1) {
                    continue;
                }
                if (!allowed.contains(unit.tier)) {
                    continue;
                }
                if (townType > 0 && unit.townId != townType) {
                    continue;
                }
                out.add(unit);
            }
            return out;
        }

        List<MapMobData.Stack> composition(Unit base, int advancedPct) {
            int qty = Math.max(1, base.growth);
            Unit advanced = advancedFor(base);
            List<MapMobData.Stack> stacks = new ArrayList<>();
            if (advanced == null) {
                stacks.add(new MapMobData.Stack(base.id, qty));
                return stacks;
            }
            int advQty = Math.min(qty - 1, (qty * advancedPct) / 100);
            if (advQty <= 0) {
                stacks.add(new MapMobData.Stack(base.id, qty));
                return stacks;
            }
            stacks.add(new MapMobData.Stack(base.id, qty - advQty));
            stacks.add(new MapMobData.Stack(advanced.id, advQty));
            return stacks;
        }

        private Unit advancedFor(Unit base) {
            if (base.level != 1) {
                return null;
            }
            Unit found = null;
            for (Unit unit : units) {
                if (unit.level != 2
                        || unit.tier != base.tier
                        || unit.rawClass != base.rawClass
                        || unit.rawTown != base.rawTown) {
                    continue;
                }
                if (found != null) {
                    return null;
                }
                found = unit;
            }
            return found;
        }
    }

    private static int growthOf(Map<String, Object> row) {
        Integer growth = asInt(row.get("growth"));
        if (growth != null && growth > 0) {
            return growth;
        }
        Object payload = MapConfig.decodeJsonb(row.get("payload"));
        if (payload instanceof Map<?, ?> map) {
            Integer weekly = asInt(map.get("weekly_growth"));
            if (weekly != null && weekly > 0) {
                return weekly;
            }
        }
        return 0;
    }

    private static boolean hasAbilities(Object raw) {
        Object decoded = MapConfig.decodeJsonb(raw);
        if (!(decoded instanceof Map<?, ?> map)) {
            return false;
        }
        return !map.isEmpty();
    }

    private static Map<Integer, List<Integer>> loadChestTiers(ReferenceData data) {
        Integer chestType = null;
        for (Map<String, Object> row : data.rows("feature_type")) {
            Object name = row.get("name");
            if (name != null && "chest".equalsIgnoreCase(name.toString().trim())) {
                chestType = asInt(row.get("id"));
                break;
            }
        }
        Map<Integer, List<Integer>> out = new HashMap<>();
        for (Map<String, Object> row : data.rows("feature")) {
            if (chestType != null) {
                Integer typeId = asInt(row.get("feature_type_id"));
                if (typeId == null || typeId.intValue() != chestType.intValue()) {
                    continue;
                }
            }
            Object statsRaw = MapConfig.decodeJsonb(row.get("stats"));
            if (!(statsRaw instanceof Map<?, ?> stats)) {
                continue;
            }
            Integer level = asInt(stats.get("level"));
            Object tiersRaw = stats.get("guard_tiers");
            if (level == null || !(tiersRaw instanceof List<?> list)) {
                continue;
            }
            List<Integer> tiers = new ArrayList<>();
            for (Object entry : list) {
                Integer tier = asInt(entry);
                if (tier != null && tier > 0) {
                    tiers.add(tier);
                }
            }
            if (!tiers.isEmpty()) {
                out.put(level, List.copyOf(tiers));
            }
        }
        return out;
    }
}
