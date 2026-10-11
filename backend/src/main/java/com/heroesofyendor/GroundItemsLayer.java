package com.heroesofyendor;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** BR S9-42: ground items at world generation (same pipeline step as chest items). */
final class GroundItemsLayer {

    private static final Logger log = LoggerFactory.getLogger(GroundItemsLayer.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static volatile boolean warnedPerTown;
    private static volatile boolean warnedGuardTiers;

    private GroundItemsLayer() {}

    static void run(MapGenContext ctx) {
        int perTown = itemsPerTown(ctx.data);
        if (perTown < 0) {
            return;
        }
        int towns = 0;
        for (MapObjectData obj : ctx.objects) {
            if ("town".equals(obj.kind())) {
                towns++;
            }
        }
        int count = towns * perTown;
        if (count <= 0) {
            MapGenPipeline.logCounts("ground-items", "placed=0 pocket=0 standalone=0");
            return;
        }
        if (ctx.featureRules == null) {
            ctx.featureRules = FeatureRules.load(ctx);
        }
        Random rng = ctx.rngFor("ground-items");
        ItemRoller roller = new ItemRoller(ctx.data, JSON);
        int pocketPlaced = 0;
        int standalonePlaced = 0;
        for (int i = 0; i < count; i++) {
            ItemRoller.RolledItem rolled = roller.rollOne(rng, null);
            if (tryPocket(ctx, rng, rolled)) {
                pocketPlaced++;
            } else if (tryStandalone(ctx, rng, rolled)) {
                standalonePlaced++;
            }
        }
        MapGenPipeline.logCounts(
                "ground-items",
                "placed="
                        + (pocketPlaced + standalonePlaced)
                        + " pocket="
                        + pocketPlaced
                        + " standalone="
                        + standalonePlaced);
    }

    private static boolean tryPocket(MapGenContext ctx, Random rng, ItemRoller.RolledItem rolled) {
        if (ctx.pockets == null || ctx.pockets.isEmpty()) {
            return false;
        }
        List<Pockets.Pocket> allowed = new ArrayList<>();
        for (Pockets.Pocket pocket : ctx.pockets) {
            if (pocketAllowsRarity(ctx, pocket.tier, rolled.rarityId())) {
                allowed.add(pocket);
            }
        }
        if (allowed.isEmpty()) {
            return false;
        }
        Collections.shuffle(allowed, rng);
        for (Pockets.Pocket pocket : allowed) {
            List<int[]> free = freeInteriorHexes(ctx, pocket);
            if (free.isEmpty()) {
                continue;
            }
            int[] pick = free.get(rng.nextInt(free.size()));
            int col = pick[0];
            int row = pick[1];
            int q = HexCoords.qOf(col, row);
            ctx.objects.add(makeGroundItem(ctx, rng, rolled, q, row, pocket.id, pocket.tier, null, null));
            return true;
        }
        return false;
    }

    private static boolean tryStandalone(MapGenContext ctx, Random rng, ItemRoller.RolledItem rolled) {
        int minTown = Math.max(1, MapConfig.cfgInt(ctx.data, "mob_min_town_dist", ctx.sizeName(), 10));
        List<int[]> towns = townFootprints(ctx);
        List<int[]> candidates = new ArrayList<>();
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                int q = HexCoords.qOf(col, row);
                if (!standaloneItemHexOk(ctx, q, row, col, minTown, towns)) {
                    continue;
                }
                candidates.add(new int[] {q, row, col});
            }
        }
        if (candidates.isEmpty()) {
            return false;
        }
        Collections.shuffle(candidates, rng);
        List<Integer> tiers = guardTiersForRarity(ctx.data, rolled.rarityId());
        if (tiers.isEmpty()) {
            return false;
        }
        for (int[] hex : candidates) {
            int[] guard = pickGuardHex(ctx, rng, hex[0], hex[1]);
            if (guard == null) {
                continue;
            }
            int tier = tiers.get(rng.nextInt(tiers.size()));
            ctx.objects.add(
                    makeGroundItem(
                            ctx,
                            rng,
                            rolled,
                            hex[0],
                            hex[1],
                            null,
                            tier,
                            guard[0],
                            guard[1]));
            return true;
        }
        return false;
    }

    private static MapObjectData makeGroundItem(
            MapGenContext ctx,
            Random rng,
            ItemRoller.RolledItem rolled,
            int q,
            int r,
            Integer pocketId,
            int tierMeta,
            Integer guardQ,
            Integer guardR) {
        boolean flipped = itemFlippable(ctx, rolled.itemId()) && rng.nextBoolean();
        String marker = pocketId != null ? "P" + tierMeta : "S";
        return new MapObjectData(
                q,
                r,
                "ground_item",
                tierMeta,
                marker,
                "Ground Item",
                null,
                flipped,
                null,
                pocketId,
                null,
                guardQ,
                guardR,
                null,
                null,
                null,
                null,
                null,
                null,
                toChestItem(rolled));
    }

    private static MapObjectData.ChestRolledItem toChestItem(ItemRoller.RolledItem rolled) {
        List<MapObjectData.ChestRolledItem.ItemStatLine> stats = new ArrayList<>();
        for (ItemRoller.StatLine line : rolled.stats()) {
            stats.add(new MapObjectData.ChestRolledItem.ItemStatLine(line.statId(), line.amt()));
        }
        return new MapObjectData.ChestRolledItem(
                rolled.itemId(),
                rolled.rarityId(),
                rolled.adjId(),
                rolled.variation(),
                List.copyOf(stats));
    }

    private static boolean pocketAllowsRarity(MapGenContext ctx, int pocketTier, int rarityId) {
        return chestLevels(ctx, pocketTier).contains(rarityId);
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

    private static List<int[]> freeInteriorHexes(MapGenContext ctx, Pockets.Pocket pocket) {
        List<int[]> out = new ArrayList<>();
        for (int[] hex : pocket.interior) {
            int col = hex[0];
            int row = hex[1];
            int q = HexCoords.qOf(col, row);
            if (objectAt(ctx.objects, q, row) != null) {
                continue;
            }
            out.add(hex);
        }
        return out;
    }

    private static MapObjectData objectAt(List<MapObjectData> objects, int q, int r) {
        for (MapObjectData obj : objects) {
            if ("town".equals(obj.kind())) {
                continue;
            }
            if (obj.q() == q && obj.r() == r) {
                return obj;
            }
        }
        return null;
    }

    private static boolean standaloneItemHexOk(
            MapGenContext ctx,
            int q,
            int row,
            int col,
            int minTown,
            List<int[]> towns) {
        if (ctx.hasRoad != null && ctx.hasRoad[row][col]) {
            return false;
        }
        if (ctx.pocketInterior != null && ctx.pocketInterior[row][col]) {
            return false;
        }
        if (ctx.pocketEntrance != null && ctx.pocketEntrance[row][col]) {
            return false;
        }
        HexTerrain terrain = ctx.cells[row][col];
        if (terrain == null || !terrain.isPassable() || terrain.movementCost() == null) {
            return false;
        }
        if (ctx.featureRules != null) {
            String reject = ctx.featureRules.rejectTemporary(ctx.objects, col, row, "ground_item");
            if (reject != null) {
                return false;
            }
        }
        if (adjacentObject(ctx.objects, q, row)) {
            return false;
        }
        if (hexDistanceTo(q, row, towns) < minTown) {
            return false;
        }
        return true;
    }

    private static boolean adjacentObject(List<MapObjectData> objects, int q, int r) {
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nq = q + d[0];
            int nr = r + d[1];
            if (objectAt(objects, nq, nr) != null) {
                return true;
            }
            if (guardAt(objects, nq, nr)) {
                return true;
            }
        }
        return false;
    }

    private static boolean guardAt(List<MapObjectData> objects, int q, int r) {
        for (MapObjectData obj : objects) {
            if (obj.guardQ() != null && obj.guardR() != null && obj.guardQ() == q && obj.guardR() == r) {
                return true;
            }
        }
        return false;
    }

    private static int[] pickGuardHex(MapGenContext ctx, Random rng, int itemQ, int itemR) {
        List<int[]> neighbors = new ArrayList<>();
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nq = itemQ + d[0];
            int nr = itemR + d[1];
            int ncol = HexCoords.colOf(nq, nr);
            if (ncol < 0 || nr < 0 || ncol >= ctx.width || nr >= ctx.height) {
                continue;
            }
            if (ctx.hasRoad != null && ctx.hasRoad[nr][ncol]) {
                continue;
            }
            if (Pockets.seals(ctx, ncol, nr)) {
                continue;
            }
            HexTerrain terrain = ctx.cells[nr][ncol];
            if (terrain == null || !terrain.isPassable() || terrain.movementCost() == null) {
                continue;
            }
            if (ctx.featureRules != null) {
                String reject = ctx.featureRules.rejectTemporary(ctx.objects, ncol, nr, null);
                if (reject != null) {
                    continue;
                }
            }
            if (objectAt(ctx.objects, nq, nr) != null) {
                continue;
            }
            neighbors.add(new int[] {nq, nr});
        }
        if (neighbors.isEmpty()) {
            return null;
        }
        return neighbors.get(rng.nextInt(neighbors.size()));
    }

    private static List<int[]> townFootprints(MapGenContext ctx) {
        List<int[]> out = new ArrayList<>();
        for (MapObjectData obj : ctx.objects) {
            if ("town".equals(obj.kind())) {
                out.add(new int[] {obj.q(), obj.r()});
            }
        }
        return out;
    }

    private static int hexDistanceTo(int q, int r, List<int[]> towns) {
        int best = Integer.MAX_VALUE;
        for (int[] town : towns) {
            int d = HexCoords.hexDistance(q, r, town[0], town[1]);
            if (d < best) {
                best = d;
            }
        }
        return best == Integer.MAX_VALUE ? 0 : best;
    }

    private static boolean itemFlippable(MapGenContext ctx, int itemId) {
        for (Map<String, Object> row : ctx.data.rows("item")) {
            Integer id = MapConfig.asInt(row.get("id"));
            if (id != null && id == itemId) {
                Object raw = row.get("flippable");
                if (raw instanceof Boolean b) {
                    return b;
                }
                return "true".equalsIgnoreCase(String.valueOf(raw));
            }
        }
        return false;
    }

    private static int itemsPerTown(ReferenceData data) {
        Object raw = MapConfig.raw(data, "items_per_town");
        if (raw == null) {
            warnPerTownOnce("items_per_town missing from map_config");
            return -1;
        }
        Integer n = MapConfig.asInt(raw);
        if (n == null || n < 0) {
            warnPerTownOnce("items_per_town not numeric");
            return -1;
        }
        return n;
    }

    @SuppressWarnings("unchecked")
    private static List<Integer> guardTiersForRarity(ReferenceData data, int rarityId) {
        Object raw = MapConfig.raw(data, "item_guard_tiers");
        if (raw == null) {
            warnGuardTiersOnce("item_guard_tiers missing from map_config");
            return List.of();
        }
        if (!(raw instanceof Map<?, ?> top)) {
            warnGuardTiersOnce("item_guard_tiers is not an object");
            return List.of();
        }
        Object tierRaw = top.get(String.valueOf(rarityId));
        if (tierRaw == null) {
            tierRaw = top.get(rarityId);
        }
        if (!(tierRaw instanceof List<?> list) || list.size() < 2) {
            return List.of();
        }
        Integer lo = MapConfig.asInt(list.get(0));
        Integer hi = MapConfig.asInt(list.get(1));
        if (lo == null || hi == null || lo <= 0 || hi < lo) {
            return List.of();
        }
        List<Integer> out = new ArrayList<>();
        for (int t = lo; t <= hi; t++) {
            out.add(t);
        }
        return out;
    }

    private static void warnPerTownOnce(String message) {
        if (warnedPerTown) {
            return;
        }
        warnedPerTown = true;
        log.warn("[ground-items] {}", message);
    }

    private static void warnGuardTiersOnce(String message) {
        if (warnedGuardTiers) {
            return;
        }
        warnedGuardTiers = true;
        log.warn("[ground-items] {}", message);
    }
}
