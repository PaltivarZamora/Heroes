package com.heroesofyendor;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Mines (fair start, then the rest), loose piles, and the world prop scatter
 * (BR S9-22). Permanent buildings and chests stay in {@link TestGrid}.
 */
final class FeatureSpread {

    private static final Logger log = LoggerFactory.getLogger(FeatureSpread.class);

    private FeatureSpread() {}

    static void placeMines(
            MapGenContext ctx,
            List<MapObjectData> objects,
            List<int[]> placeable,
            Random rng) {
        FeatureRules rules = ctx.featureRules;
        List<Map<String, Object>> resources = TestGrid.resourceRows(ctx.data);
        Map<Integer, Integer> remaining = new LinkedHashMap<>();
        Map<Integer, String> names = new LinkedHashMap<>();
        for (Map<String, Object> row : resources) {
            Integer id = asInt(row.get("id"));
            if (id == null) {
                continue;
            }
            names.put(id, text(row.get("name")));
            remaining.put(id, TestGrid.resourceScaledCount(row, "mines_normal", ctx.data, ctx.sizeName(), 4));
        }
        List<TownSite> starts = new ArrayList<>();
        for (TownSite site : ctx.townSites) {
            if (site.starting()) {
                starts.add(site);
            }
        }
        for (TownSite town : starts) {
            StringBuilder line = new StringBuilder();
            line.append("fair ").append(town.name());
            for (int resourceId : rules.fairResources) {
                String name = names.getOrDefault(resourceId, "#" + resourceId);
                int budget = remaining.getOrDefault(resourceId, 0);
                if (budget <= 0) {
                    log.warn(
                            "Fair start {}: no {} mine budget left (within {})",
                            town.name(),
                            name,
                            rules.fairRadius);
                    line.append(" ").append(name).append("=none");
                    continue;
                }
                int[] hex = pickFair(ctx, rules, objects, placeable, town, rng);
                if (hex == null) {
                    log.warn(
                            "Fair start {}: no {} mine within {} outside clear {}",
                            town.name(),
                            name,
                            rules.fairRadius,
                            rules.townClear);
                    line.append(" ").append(name).append("=none");
                    continue;
                }
                int q = HexCoords.qOf(hex[0], hex[1]);
                int dist = rules.townDistance(town, q, hex[1]);
                objects.add(TestGrid.objectAt(hex, "mine", resourceId, name, rng, ctx.data));
                removeHex(placeable, hex[0], hex[1]);
                remaining.put(resourceId, budget - 1);
                line.append(" ").append(name).append("@").append(dist);
            }
            rules.notes.add(line.toString());
        }
        Collections.shuffle(placeable, rng);
        for (Map.Entry<Integer, Integer> entry : remaining.entrySet()) {
            int resourceId = entry.getKey();
            int want = entry.getValue();
            String name = names.getOrDefault(resourceId, "#" + resourceId);
            int placed = 0;
            Map<String, Integer> why = new LinkedHashMap<>();
            for (int[] hex : placeable) {
                if (placed >= want) {
                    break;
                }
                String reason = rules.rejectPermanent(objects, hex[0], hex[1]);
                if (reason != null) {
                    why.merge(reason, 1, Integer::sum);
                    continue;
                }
                objects.add(TestGrid.objectAt(hex, "mine", resourceId, name, rng, ctx.data));
                hex[0] = Integer.MIN_VALUE;
                placed++;
            }
            placeable.removeIf(hex -> hex[0] == Integer.MIN_VALUE);
            if (placed < want) {
                log.warn("Mine placement {}: placed {} of {} remainder ({})", name, placed, want, why);
                rules.notes.add("mine " + name + " short " + placed + "/" + want + " " + why);
            }
        }
        Map<Integer, Integer> placedMines = new LinkedHashMap<>();
        for (MapObjectData obj : objects) {
            if ("mine".equals(obj.kind()) && obj.resourceId() != null) {
                placedMines.merge(obj.resourceId(), 1, Integer::sum);
            }
        }
        for (Map<String, Object> row : resources) {
            Integer id = asInt(row.get("id"));
            if (id == null) {
                continue;
            }
            int want = TestGrid.resourceScaledCount(row, "mines_normal", ctx.data, ctx.sizeName(), 4);
            int got = placedMines.getOrDefault(id, 0);
            rules.notes.add("mine " + names.getOrDefault(id, "#" + id) + " " + got + "/" + want);
        }
    }

    static void placePiles(
            MapGenContext ctx,
            List<MapObjectData> objects,
            List<int[]> placeable,
            Random rng) {
        FeatureRules rules = ctx.featureRules;
        Collections.shuffle(placeable, rng);
        for (Map<String, Object> row : TestGrid.resourceRows(ctx.data)) {
            Integer resourceId = asInt(row.get("id"));
            if (resourceId == null) {
                continue;
            }
            String name = text(row.get("name"));
            int want = TestGrid.resourceScaledCount(row, "loose_normal", ctx.data, ctx.sizeName(), 10);
            String group = rules.groupKeyForPickup(resourceId);
            int placed = 0;
            Map<String, Integer> why = new LinkedHashMap<>();
            for (int[] hex : placeable) {
                if (placed >= want) {
                    break;
                }
                String reason = rules.rejectTemporary(objects, hex[0], hex[1], group);
                if (reason != null) {
                    why.merge(reason, 1, Integer::sum);
                    continue;
                }
                objects.add(TestGrid.objectAt(hex, "pickup", resourceId, name, rng, ctx.data));
                hex[0] = Integer.MIN_VALUE;
                placed++;
            }
            placeable.removeIf(hex -> hex[0] == Integer.MIN_VALUE);
            String note = "pile " + name + " " + placed + "/" + want;
            if (placed < want) {
                note += " skip " + why;
                log.warn("Pile placement {}: placed {} of {} ({})", name, placed, want, why);
            }
            rules.notes.add(note);
        }
    }

    /**
     * @param write when false, count only (dry run shares the caller's RNG sequence shape)
     * @return props that would be / were placed by this pass, excluding walls already present
     */
    static int scatter(MapGenContext ctx, Random rng, double densityMult, boolean write) {
        if (ctx.propSeeds == null) {
            ctx.propSeeds = new WorldProps.Seed[ctx.height][ctx.width];
            ctx.propBlocked = new boolean[ctx.height][ctx.width];
        }
        if (ctx.propDefs == null || ctx.propDefs.isEmpty()) {
            ctx.propDefs = WorldProps.all(ctx.data);
        }
        FeatureRules rules = ctx.featureRules != null ? ctx.featureRules : FeatureRules.load(ctx);
        boolean[][] virtual = write ? null : copyBlocked(ctx);
        int placed = 0;
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (ctx.hasRoad != null && ctx.hasRoad[row][col]) {
                    continue;
                }
                if (ctx.townReserved != null && ctx.townReserved[row][col]) {
                    continue;
                }
                if (ctx.propSeeds[row][col] != null) {
                    continue;
                }
                if (Pockets.reserved(ctx, row, col)) {
                    continue;
                }
                if (ctx.islandGuardTier != null && ctx.islandGuardTier[row][col] > 0) {
                    continue;
                }
                HexTerrain terrain = ctx.cells[row][col];
                if (terrain == null || !terrain.isPassable()) {
                    continue;
                }
                int q = HexCoords.qOf(col, row);
                if (featureOrGuard(ctx.objects, q, row)) {
                    continue;
                }
                WorldProps.Seed prop = WorldProps.roll(terrain, ctx.propDefs, rng, densityMult);
                if (prop == null) {
                    continue;
                }
                if (prop.blocker()) {
                    if (rules.inGap(col, row)) {
                        continue;
                    }
                    if (rules.inPermTownClear(q, row)) {
                        continue;
                    }
                    if (rules.stealsLastApproach(ctx.objects, col, row, virtual)) {
                        continue;
                    }
                }
                placed++;
                if (write) {
                    prop = WorldProps.withPlacementFlip(ctx, col, row, prop, ctx.propDefs);
                    ctx.propSeeds[row][col] = prop;
                    if (prop.blocker()) {
                        ctx.propBlocked[row][col] = true;
                    }
                } else if (prop.blocker()) {
                    virtual[row][col] = true;
                }
            }
        }
        return placed;
    }

    private static int[] pickFair(
            MapGenContext ctx,
            FeatureRules rules,
            List<MapObjectData> objects,
            List<int[]> placeable,
            TownSite town,
            Random rng) {
        List<int[]> band = new ArrayList<>();
        for (int[] hex : placeable) {
            int q = HexCoords.qOf(hex[0], hex[1]);
            int dist = rules.townDistance(town, q, hex[1]);
            if (dist <= rules.townClear || dist > rules.fairRadius) {
                continue;
            }
            if (WaterTerrain.onIsland(ctx, hex[0], hex[1])) {
                continue;
            }
            band.add(hex);
        }
        Collections.shuffle(band, rng);
        for (int[] hex : band) {
            if (rules.rejectPermanent(objects, hex[0], hex[1]) == null) {
                return hex;
            }
        }
        return null;
    }

    private static void removeHex(List<int[]> placeable, int col, int row) {
        placeable.removeIf(hex -> hex[0] == col && hex[1] == row);
    }

    private static boolean[][] copyBlocked(MapGenContext ctx) {
        boolean[][] copy = new boolean[ctx.height][ctx.width];
        if (ctx.propBlocked == null) {
            return copy;
        }
        for (int row = 0; row < ctx.height; row++) {
            System.arraycopy(ctx.propBlocked[row], 0, copy[row], 0, ctx.width);
        }
        return copy;
    }

    private static boolean featureOrGuard(List<MapObjectData> objects, int q, int r) {
        if (objects == null) {
            return false;
        }
        for (MapObjectData obj : objects) {
            if (!"town".equals(obj.kind()) && obj.q() == q && obj.r() == r) {
                return true;
            }
            if (obj.guardQ() != null && obj.guardR() != null && obj.guardQ() == q && obj.guardR() == r) {
                return true;
            }
        }
        return false;
    }

    private static Integer asInt(Object raw) {
        return MapConfig.asInt(raw);
    }

    private static String text(Object raw) {
        return raw == null ? "" : raw.toString().trim();
    }
}
