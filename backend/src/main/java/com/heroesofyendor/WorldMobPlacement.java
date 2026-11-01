package com.heroesofyendor;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** Map-gen mob anchor rules (mirrors frontend {@code worldMobFootprint.ts}). */
final class WorldMobPlacement {

    /** Search radius for alternate anchors (axial steps). */
    static final int ANCHOR_SEARCH_RADIUS = 10;

    private WorldMobPlacement() {}

    static boolean anchorFits(
            MapGenContext ctx,
            Set<String> occupied,
            Set<String> featureKeys,
            Set<String> townFootprintKeys,
            int originQ,
            int originR,
            String footprintCode) {
        for (int[] hex :
                Footprint.footprintBlockingHexes(
                        originQ, originR, footprintCode, Footprint.WORLD_MOB_ALONG)) {
            if (!bodyHexOk(ctx, occupied, featureKeys, townFootprintKeys, hex[0], hex[1])) {
                return false;
            }
        }
        for (int[] hex :
                Footprint.footprintHeadHexes(
                        originQ, originR, footprintCode, Footprint.WORLD_MOB_ALONG)) {
            if (headHexForbidden(ctx, occupied, featureKeys, townFootprintKeys, hex[0], hex[1])) {
                return false;
            }
        }
        return true;
    }

    static void reserveShape(
            Set<String> occupied, int originQ, int originR, String footprintCode) {
        for (int[] hex :
                Footprint.footprintHexes(
                        originQ, originR, footprintCode, Footprint.WORLD_MOB_ALONG)) {
            occupied.add(HexCoords.key(hex[0], hex[1]));
        }
    }

    static Set<String> allMobShapeKeys(
            List<MapMobData> mobs, java.util.Map<Integer, String> unitFootprints) {
        Set<String> keys = new HashSet<>();
        for (MapMobData mob : mobs) {
            keys.addAll(
                    Footprint.shapeKeys(
                            mob.q(),
                            mob.r(),
                            footprintForStacks(mob.stacks(), unitFootprints)));
        }
        return keys;
    }

    static String footprintForStacks(
            List<MapMobData.Stack> stacks, java.util.Map<Integer, String> unitFootprints) {
        if (stacks == null || stacks.isEmpty()) {
            return "1x1";
        }
        int leadId = stacks.get(0).unitId();
        int leadQty = stacks.get(0).qty();
        for (MapMobData.Stack stack : stacks) {
            if (stack.qty() > leadQty) {
                leadQty = stack.qty();
                leadId = stack.unitId();
            }
        }
        return unitFootprints.getOrDefault(leadId, "1x1");
    }

    /**
     * Deterministic nearby anchors: preferred first, then by distance, q, r.
     * Returns null when nothing fits within {@link #ANCHOR_SEARCH_RADIUS}.
     */
    static int[] findAnchor(
            MapGenContext ctx,
            Set<String> occupied,
            Set<String> featureKeys,
            Set<String> townFootprintKeys,
            int preferredQ,
            int preferredR,
            String footprintCode) {
        List<int[]> candidates = new ArrayList<>();
        candidates.add(new int[] {preferredQ, preferredR});
        boolean[][] seen = new boolean[ctx.height][ctx.width];
        int pCol = HexCoords.colOf(preferredQ, preferredR);
        if (pCol >= 0 && preferredR >= 0 && pCol < ctx.width && preferredR < ctx.height) {
            seen[preferredR][pCol] = true;
        }
        List<int[]> frontier = new ArrayList<>();
        frontier.add(new int[] {preferredQ, preferredR});
        for (int dist = 1; dist <= ANCHOR_SEARCH_RADIUS && !frontier.isEmpty(); dist++) {
            List<int[]> next = new ArrayList<>();
            for (int[] hex : frontier) {
                for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                    int nq = hex[0] + d[0];
                    int nr = hex[1] + d[1];
                    int ncol = HexCoords.colOf(nq, nr);
                    if (ncol < 0 || nr < 0 || ncol >= ctx.width || nr >= ctx.height) {
                        continue;
                    }
                    if (seen[nr][ncol]) {
                        continue;
                    }
                    seen[nr][ncol] = true;
                    int[] cand = new int[] {nq, nr};
                    candidates.add(cand);
                    next.add(cand);
                }
            }
            frontier = next;
        }
        candidates.sort(
                Comparator.comparingInt(
                                (int[] h) ->
                                        HexCoords.hexDistance(
                                                preferredQ, preferredR, h[0], h[1]))
                        .thenComparingInt(h -> h[0])
                        .thenComparingInt(h -> h[1]));
        for (int[] cand : candidates) {
            if (anchorFits(
                    ctx,
                    occupied,
                    featureKeys,
                    townFootprintKeys,
                    cand[0],
                    cand[1],
                    footprintCode)) {
                return cand;
            }
        }
        return null;
    }

    static boolean mobShapeBlocksWalk(
            MapGenContext ctx, int col, int row, Set<String> mobShapeKeys) {
        if (mobShapeKeys == null || mobShapeKeys.isEmpty()) {
            return false;
        }
        int q = HexCoords.qOf(col, row);
        return mobShapeKeys.contains(HexCoords.key(q, row));
    }

    private static boolean bodyHexOk(
            MapGenContext ctx,
            Set<String> occupied,
            Set<String> featureKeys,
            Set<String> townFootprintKeys,
            int q,
            int r) {
        String key = HexCoords.key(q, r);
        if (occupied.contains(key)) {
            return false;
        }
        if (featureKeys.contains(key)) {
            return false;
        }
        if (townFootprintKeys.contains(key)) {
            return false;
        }
        int col = HexCoords.colOf(q, r);
        if (col < 0 || r < 0 || col >= ctx.width || r >= ctx.height) {
            return false;
        }
        if (ctx.pocketInterior != null && ctx.pocketInterior[r][col]) {
            return false;
        }
        if (ctx.townReserved != null && ctx.townReserved[r][col]) {
            return false;
        }
        HexTerrain terrain = ctx.cells[r][col];
        if (terrain == null || terrain.blocked() || isWater(terrain)) {
            return false;
        }
        if (terrain.movementCost() == null || !terrain.isPassable()) {
            return false;
        }
        if (ctx.propSeeds != null) {
            WorldProps.Seed prop = ctx.propSeeds[r][col];
            if (prop != null && prop.blocker()) {
                return false;
            }
        }
        if (ctx.propBlocked != null && ctx.propBlocked[r][col]) {
            return false;
        }
        return true;
    }

    private static boolean headHexForbidden(
            MapGenContext ctx,
            Set<String> occupied,
            Set<String> featureKeys,
            Set<String> townFootprintKeys,
            int q,
            int r) {
        String key = HexCoords.key(q, r);
        if (occupied.contains(key)) {
            return true;
        }
        if (townFootprintKeys.contains(key)) {
            return true;
        }
        if (featureKeys.contains(key) || roadFeatureAt(ctx, q, r, featureKeys)) {
            return true;
        }
        if (pickupAt(ctx, q, r)) {
            return true;
        }
        return false;
    }

    private static boolean roadFeatureAt(
            MapGenContext ctx, int q, int r, Set<String> featureKeys) {
        if (ctx.hasRoad == null) {
            return false;
        }
        int col = HexCoords.colOf(q, r);
        if (col < 0 || r < 0 || col >= ctx.width || r >= ctx.height) {
            return false;
        }
        return ctx.hasRoad[r][col] && featureKeys.contains(HexCoords.key(q, r));
    }

    private static boolean pickupAt(MapGenContext ctx, int q, int r) {
        for (MapObjectData obj : ctx.objects) {
            if (!"pickup".equals(obj.kind())) {
                continue;
            }
            if (obj.q() == q && obj.r() == r) {
                return true;
            }
        }
        return false;
    }

    private static boolean isWater(HexTerrain terrain) {
        String name = terrain.label().toLowerCase(Locale.ROOT);
        return name.equals("water") || name.equals("shallow");
    }
}
