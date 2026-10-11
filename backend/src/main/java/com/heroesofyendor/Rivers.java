package com.heroesofyendor;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Zone-border rivers and bridges (BR S9-32). Painted inside layer 3 before walls;
 * bridges are realized after roads (layer 4).
 */
final class Rivers {

    private static final Logger log = LoggerFactory.getLogger(Rivers.class);

    record Edge(int zoneA, int zoneB, List<int[]> hexes) {}

    private Rivers() {}

    static boolean isBridge(MapGenContext ctx, int col, int row) {
        return ctx.bridge != null
                && row >= 0
                && col >= 0
                && row < ctx.height
                && col < ctx.width
                && ctx.bridge[row][col];
    }

    static String summary(MapGenContext ctx) {
        return "rivers="
                + ctx.riverCountPlaced
                + " riverHexes="
                + ctx.riverHexCount
                + " narrowed="
                + ctx.riverNarrowed;
    }

    static void paint(MapGenContext ctx, List<Edge> borders, Random rng) {
        ctx.river = new boolean[ctx.height][ctx.width];
        ctx.bridgeSpot = new boolean[ctx.height][ctx.width];
        ctx.bridge = new boolean[ctx.height][ctx.width];
        int minLen = Math.max(1, MapConfig.cfgInt(ctx.data, "river_min_length", ctx.sizeName(), 20));
        int[] count = MapConfig.cfgIntRange(ctx.data, "river_count", ctx.sizeName(), 0, 1);
        int[] width = MapConfig.cfgIntRange(ctx.data, "river_width", ctx.sizeName(), 1, 3);
        int townClear = Math.max(0, MapConfig.cfgInt(ctx.data, "river_town_clear", ctx.sizeName(), 3));
        int want = count[0] + (count[1] > count[0] ? rng.nextInt(count[1] - count[0] + 1) : 0);
        HexTerrain water = waterTerrain(ctx);
        if (water == null || want <= 0) {
            MapGenPipeline.logCounts("rivers", "skipped water=" + (water != null) + " want=" + want);
            return;
        }
        boolean[][] clear = townDisc(ctx, townClear);
        List<Edge> pool = new ArrayList<>();
        for (Edge edge : borders) {
            if (edge.hexes().size() >= minLen && !touchesPocket(ctx, edge.hexes())) {
                pool.add(edge);
            }
        }
        pool.sort((a, b) -> Integer.compare(b.hexes().size(), a.hexes().size()));
        int placed = 0;
        for (Edge edge : pool) {
            if (placed >= want) {
                break;
            }
            List<int[]> chain = order(edge.hexes());
            if (chain.size() < minLen) {
                continue;
            }
            int[] widths = widths(chain.size(), width[0], width[1], rng);
            int painted = paintChain(ctx, water, chain, widths, clear);
            if (painted < minLen) {
                continue;
            }
            ctx.riverBorderPairs.add(pairKey(edge.zoneA(), edge.zoneB()));
            markSpots(ctx, chain);
            placed++;
            ctx.riverHexCount += painted;
        }
        ctx.riverCountPlaced = placed;
    }

    /** Drop river hexes that landed inside a treasure pocket (pockets carve after rivers). */
    static void yieldToPockets(MapGenContext ctx) {
        if (ctx.river == null || ctx.pocketInterior == null) {
            return;
        }
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (!ctx.river[row][col]) {
                    continue;
                }
                boolean pocket =
                        ctx.pocketInterior[row][col]
                                || (ctx.pocketRing != null && ctx.pocketRing[row][col])
                                || (ctx.pocketSeal != null && ctx.pocketSeal[row][col]);
                if (!pocket) {
                    continue;
                }
                HexTerrain land = neighbourLand(ctx, col, row);
                if (land != null) {
                    ctx.cells[row][col] = land;
                }
                ctx.river[row][col] = false;
                ctx.bridgeSpot[row][col] = false;
            }
        }
    }

    /** After roads: props on crossings, plus required and shortcut bridges. */
    static void finishBridges(MapGenContext ctx) {
        if (ctx.river == null || ctx.riverCountPlaced == 0) {
            MapGenPipeline.logCounts("bridges", "none");
            return;
        }
        long t0 = System.nanoTime();
        int spacing = Math.max(1, MapConfig.cfgInt(ctx.data, "river_bridge_spacing", ctx.sizeName(), 12));
        int detour = Math.max(1, MapConfig.cfgInt(ctx.data, "river_bridge_detour", ctx.sizeName(), 30));
        List<BridgeProp> props = bridgeProps(ctx);
        if (props.isEmpty()) {
            log.warn("BR S9-32: no bridge prop with terrain_rules.axis (across/up/down)");
        }
        int road = 0;
        int required = 0;
        int shortcut = 0;
        List<int[]> used = new ArrayList<>();
        if (ctx.hasRoad != null) {
            for (int row = 0; row < ctx.height; row++) {
                for (int col = 0; col < ctx.width; col++) {
                    if (!ctx.hasRoad[row][col] || !ctx.river[row][col]) {
                        continue;
                    }
                    if (!ctx.bridgeSpot[row][col]) {
                        if (narrow(ctx, col, row)) {
                            ctx.riverNarrowed++;
                        }
                    }
                    if (realize(ctx, col, row, props)) {
                        road++;
                        used.add(new int[] {col, row});
                    }
                }
            }
        }
        required += connectBanks(ctx, props, used, spacing);
        shortcut += shortcutBridges(ctx, props, used, spacing, detour);
        ctx.bridgeRoad = road;
        ctx.bridgeRequired = required;
        ctx.bridgeShortcut = shortcut;
        long ms = (System.nanoTime() - t0) / 1_000_000L;
        MapGenPipeline.logCounts(
                "bridges",
                "ms="
                        + ms
                        + " road="
                        + road
                        + " required="
                        + required
                        + " shortcut="
                        + shortcut
                        + " narrowed="
                        + ctx.riverNarrowed);
    }

    private static int paintChain(
            MapGenContext ctx,
            HexTerrain water,
            List<int[]> chain,
            int[] widths,
            boolean[][] clear) {
        int n = 0;
        Set<String> center = new HashSet<>();
        for (int[] hex : chain) {
            center.add(hex[0] + "," + hex[1]);
        }
        for (int i = 0; i < chain.size(); i++) {
            int[] hex = chain.get(i);
            if (clear[hex[1]][hex[0]] || !canPaint(ctx, hex[0], hex[1])) {
                continue;
            }
            ctx.cells[hex[1]][hex[0]] = water;
            ctx.river[hex[1]][hex[0]] = true;
            n++;
            int extra = Math.max(0, widths[i] - 1);
            if (extra == 0) {
                continue;
            }
            int[] step = i + 1 < chain.size() ? chain.get(i + 1) : (i > 0 ? chain.get(i - 1) : hex);
            List<int[]> sides = sideHexes(hex, step);
            int added = 0;
            for (int s = 0; s < sides.size() && added < extra; s++) {
                int[] side = sides.get(s);
                if (center.contains(side[0] + "," + side[1]) || clear[side[1]][side[0]]) {
                    continue;
                }
                if (!canPaint(ctx, side[0], side[1])) {
                    continue;
                }
                ctx.cells[side[1]][side[0]] = water;
                ctx.river[side[1]][side[0]] = true;
                added++;
                n++;
            }
        }
        return n;
    }

    private static void markSpots(MapGenContext ctx, List<int[]> chain) {
        for (int[] hex : chain) {
            if (!ctx.river[hex[1]][hex[0]]) {
                continue;
            }
            int axis = crossingAxis(ctx, hex[0], hex[1]);
            if (axis >= 0) {
                ctx.bridgeSpot[hex[1]][hex[0]] = true;
            }
        }
        boolean any = false;
        for (int[] hex : chain) {
            if (ctx.bridgeSpot[hex[1]][hex[0]]) {
                any = true;
                break;
            }
        }
        if (!any && !chain.isEmpty()) {
            int mid = chain.size() / 2;
            int[] hex = chain.get(mid);
            if (narrow(ctx, hex[0], hex[1])) {
                ctx.riverNarrowed++;
            }
        }
    }

    /** Shrink neighbours so this water hex is a 1-wide land–water–land crossing. */
    private static boolean narrow(MapGenContext ctx, int col, int row) {
        if (row < 0 || col < 0 || row >= ctx.height || col >= ctx.width || !ctx.river[row][col]) {
            return false;
        }
        int q = HexCoords.qOf(col, row);
        for (int i = 0; i < HexCoords.AXIAL_NEIGHBORS.length; i++) {
            int opp = (i + 3) % 6;
            int[] a = HexCoords.AXIAL_NEIGHBORS[i];
            int[] b = HexCoords.AXIAL_NEIGHBORS[opp];
            int ar = row + a[1];
            int ac = HexCoords.colOf(q + a[0], ar);
            int br = row + b[1];
            int bc = HexCoords.colOf(q + b[0], br);
            if (!inside(ctx, ac, ar) || !inside(ctx, bc, br)) {
                continue;
            }
            if (ctx.river[ar][ac]) {
                HexTerrain land = neighbourLand(ctx, ac, ar);
                if (land != null) {
                    ctx.cells[ar][ac] = land;
                    ctx.river[ar][ac] = false;
                }
            }
            if (ctx.river[br][bc]) {
                HexTerrain land = neighbourLand(ctx, bc, br);
                if (land != null) {
                    ctx.cells[br][bc] = land;
                    ctx.river[br][bc] = false;
                }
            }
            if (dryLand(ctx, ac, ar) && dryLand(ctx, bc, br)) {
                ctx.bridgeSpot[row][col] = true;
                return true;
            }
        }
        return false;
    }

    private static int crossingAxis(MapGenContext ctx, int col, int row) {
        int q = HexCoords.qOf(col, row);
        for (int i = 0; i < 3; i++) {
            int[] a = HexCoords.AXIAL_NEIGHBORS[i];
            int[] b = HexCoords.AXIAL_NEIGHBORS[i + 3];
            int ar = row + a[1];
            int ac = HexCoords.colOf(q + a[0], ar);
            int br = row + b[1];
            int bc = HexCoords.colOf(q + b[0], br);
            if (dryLand(ctx, ac, ar) && dryLand(ctx, bc, br)) {
                return i;
            }
        }
        return -1;
    }

    private static boolean realize(MapGenContext ctx, int col, int row, List<BridgeProp> props) {
        int axis = crossingAxis(ctx, col, row);
        if (axis < 0) {
            return false;
        }
        ctx.bridge[row][col] = true;
        ctx.bridgeSpot[row][col] = true;
        String axisName = axis == 0 ? "across" : axis == 1 ? "up" : "down";
        BridgeProp prop = null;
        for (BridgeProp rowProp : props) {
            if (axisName.equals(rowProp.axis)) {
                prop = rowProp;
                break;
            }
        }
        if (prop == null) {
            log.warn("BR S9-32: missing bridge prop axis '{}'", axisName);
        } else if (ctx.propSeeds != null) {
            ctx.propSeeds[row][col] =
                    new WorldProps.Seed(
                            prop.id, 1, prop.file, false, false, prop.scale);
            if (ctx.propBlocked != null) {
                ctx.propBlocked[row][col] = false;
            }
        }
        markGapEnds(ctx, col, row, axis);
        return true;
    }

    private static void markGapEnds(MapGenContext ctx, int col, int row, int axis) {
        if (ctx.wallGap == null) {
            return;
        }
        ctx.wallGap[row][col] = true;
        int q = HexCoords.qOf(col, row);
        int[] a = HexCoords.AXIAL_NEIGHBORS[axis];
        int[] b = HexCoords.AXIAL_NEIGHBORS[axis + 3];
        int ar = row + a[1];
        int ac = HexCoords.colOf(q + a[0], ar);
        int br = row + b[1];
        int bc = HexCoords.colOf(q + b[0], br);
        if (inside(ctx, ac, ar)) {
            ctx.wallGap[ar][ac] = true;
        }
        if (inside(ctx, bc, br)) {
            ctx.wallGap[br][bc] = true;
        }
    }

    private static int connectBanks(
            MapGenContext ctx, List<BridgeProp> props, List<int[]> used, int spacing) {
        int added = 0;
        boolean[][] seen = new boolean[ctx.height][ctx.width];
        int comp = 0;
        int[][] id = new int[ctx.height][ctx.width];
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (seen[row][col] || !dryLand(ctx, col, row)) {
                    continue;
                }
                if (!touchesRiver(ctx, col, row)) {
                    continue;
                }
                comp++;
                floodLand(ctx, col, row, seen, id, comp);
            }
        }
        if (comp < 2) {
            return 0;
        }
        for (int row = 0; row < ctx.height && added < comp - 1; row++) {
            for (int col = 0; col < ctx.width && added < comp - 1; col++) {
                if (!ctx.bridgeSpot[row][col] || ctx.bridge[row][col]) {
                    continue;
                }
                if (tooClose(ctx, col, row, used, spacing)) {
                    continue;
                }
                if (realize(ctx, col, row, props)) {
                    used.add(new int[] {col, row});
                    added++;
                }
            }
        }
        return added;
    }

    private static int shortcutBridges(
            MapGenContext ctx,
            List<BridgeProp> props,
            List<int[]> used,
            int spacing,
            int detourLimit) {
        int added = 0;
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (!ctx.bridgeSpot[row][col] || ctx.bridge[row][col]) {
                    continue;
                }
                if (tooClose(ctx, col, row, used, spacing)) {
                    continue;
                }
                int axis = crossingAxis(ctx, col, row);
                if (axis < 0) {
                    continue;
                }
                int q = HexCoords.qOf(col, row);
                int[] a = HexCoords.AXIAL_NEIGHBORS[axis];
                int[] b = HexCoords.AXIAL_NEIGHBORS[axis + 3];
                int ar = row + a[1];
                int ac = HexCoords.colOf(q + a[0], ar);
                int br = row + b[1];
                int bc = HexCoords.colOf(q + b[0], br);
                int around = landDistance(ctx, ac, ar, bc, br, detourLimit + 4);
                if (around > detourLimit + 1 && realize(ctx, col, row, props)) {
                    used.add(new int[] {col, row});
                    added++;
                }
            }
        }
        return added;
    }

    private static int landDistance(MapGenContext ctx, int c0, int r0, int c1, int r1, int cap) {
        if (!inside(ctx, c0, r0) || !inside(ctx, c1, r1)) {
            return cap + 1;
        }
        ArrayList<int[]> q = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        q.add(new int[] {c0, r0, 0});
        seen.add(c0 + "," + r0);
        for (int i = 0; i < q.size(); i++) {
            int[] cur = q.get(i);
            if (cur[2] > cap) {
                return cap + 1;
            }
            if (cur[0] == c1 && cur[1] == r1) {
                return cur[2];
            }
            int aq = HexCoords.qOf(cur[0], cur[1]);
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nr = cur[1] + d[1];
                int nc = HexCoords.colOf(aq + d[0], nr);
                if (!dryLand(ctx, nc, nr) && !(nc == c1 && nr == r1)) {
                    continue;
                }
                if (ctx.river != null && inside(ctx, nc, nr) && ctx.river[nr][nc] && !isBridge(ctx, nc, nr)) {
                    continue;
                }
                String key = nc + "," + nr;
                if (!seen.add(key)) {
                    continue;
                }
                q.add(new int[] {nc, nr, cur[2] + 1});
            }
        }
        return cap + 1;
    }

    private static void floodLand(
            MapGenContext ctx, int col, int row, boolean[][] seen, int[][] id, int comp) {
        ArrayList<int[]> q = new ArrayList<>();
        q.add(new int[] {col, row});
        seen[row][col] = true;
        id[row][col] = comp;
        for (int i = 0; i < q.size(); i++) {
            int[] cur = q.get(i);
            int aq = HexCoords.qOf(cur[0], cur[1]);
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nr = cur[1] + d[1];
                int nc = HexCoords.colOf(aq + d[0], nr);
                if (!inside(ctx, nc, nr) || seen[nr][nc] || !dryLand(ctx, nc, nr)) {
                    continue;
                }
                if (ctx.river[nr][nc] && !ctx.bridge[nr][nc]) {
                    continue;
                }
                seen[nr][nc] = true;
                id[nr][nc] = comp;
                q.add(new int[] {nc, nr});
            }
        }
    }

    private static boolean tooClose(
            MapGenContext ctx, int col, int row, List<int[]> used, int spacing) {
        for (int[] other : used) {
            int dist = hexDist(ctx, col, row, other[0], other[1]);
            if (dist >= 0 && dist < spacing) {
                return true;
            }
        }
        return false;
    }

    private static int hexDist(MapGenContext ctx, int c0, int r0, int c1, int r1) {
        int q0 = HexCoords.qOf(c0, r0);
        int q1 = HexCoords.qOf(c1, r1);
        int dq = q0 - q1;
        int dr = r0 - r1;
        return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    }

    private static boolean touchesRiver(MapGenContext ctx, int col, int row) {
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nr = row + d[1];
            int nc = HexCoords.colOf(q + d[0], nr);
            if (inside(ctx, nc, nr) && ctx.river[nr][nc]) {
                return true;
            }
        }
        return false;
    }

    private static List<int[]> sideHexes(int[] hex, int[] step) {
        List<int[]> out = new ArrayList<>();
        int q = HexCoords.qOf(hex[0], hex[1]);
        int sq = HexCoords.qOf(step[0], step[1]);
        int sdq = Integer.signum(sq - q);
        int sdr = Integer.signum(step[1] - hex[1]);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            if (d[0] == sdq && d[1] == sdr) {
                continue;
            }
            if (d[0] == -sdq && d[1] == -sdr) {
                continue;
            }
            int nr = hex[1] + d[1];
            int nc = HexCoords.colOf(q + d[0], nr);
            out.add(new int[] {nc, nr});
        }
        return out;
    }

    private static int[] widths(int n, int lo, int hi, Random rng) {
        int min = Math.max(1, lo);
        int max = Math.max(min, hi);
        int[] w = new int[n];
        int cur = min + (max > min ? rng.nextInt(max - min + 1) : 0);
        for (int i = 0; i < n; i++) {
            if (i < 2 || i > n - 3) {
                cur = Math.max(0, cur - 1);
            } else if (rng.nextBoolean() && cur < max) {
                cur++;
            } else if (rng.nextBoolean() && cur > min) {
                cur--;
            }
            w[i] = Math.max(1, cur);
        }
        if (n > 0) {
            w[0] = 1;
            w[n - 1] = 1;
        }
        return w;
    }

    private static List<int[]> order(List<int[]> hexes) {
        if (hexes.size() <= 2) {
            return hexes;
        }
        Map<String, int[]> by = new HashMap<>();
        Set<String> keys = new HashSet<>();
        for (int[] hex : hexes) {
            String key = hex[0] + "," + hex[1];
            keys.add(key);
            by.put(key, hex);
        }
        int[] start = hexes.get(0);
        int best = 99;
        for (int[] hex : hexes) {
            int deg = 0;
            int q = HexCoords.qOf(hex[0], hex[1]);
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nr = hex[1] + d[1];
                int nc = HexCoords.colOf(q + d[0], nr);
                if (keys.contains(nc + "," + nr)) {
                    deg++;
                }
            }
            if (deg < best) {
                best = deg;
                start = hex;
            }
        }
        List<int[]> chain = new ArrayList<>();
        Set<String> used = new HashSet<>();
        int[] cur = start;
        while (cur != null) {
            chain.add(cur);
            used.add(cur[0] + "," + cur[1]);
            int[] next = null;
            int q = HexCoords.qOf(cur[0], cur[1]);
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nr = cur[1] + d[1];
                int nc = HexCoords.colOf(q + d[0], nr);
                String key = nc + "," + nr;
                if (keys.contains(key) && !used.contains(key)) {
                    next = by.get(key);
                    break;
                }
            }
            cur = next;
        }
        return chain;
    }

    private static boolean canPaint(MapGenContext ctx, int col, int row) {
        if (!inside(ctx, col, row)) {
            return false;
        }
        if (ctx.townReserved != null && ctx.townReserved[row][col]) {
            return false;
        }
        HexTerrain t = ctx.cells[row][col];
        if (t == null || t.blocked() || isWetName(t)) {
            return false;
        }
        return true;
    }

    private static boolean dryLand(MapGenContext ctx, int col, int row) {
        if (!inside(ctx, col, row)) {
            return false;
        }
        if (ctx.river != null && ctx.river[row][col]) {
            return false;
        }
        HexTerrain t = ctx.cells[row][col];
        if (t == null || t.blocked() || isWetName(t)) {
            return false;
        }
        return true;
    }

    private static boolean isWetName(HexTerrain t) {
        String name = t.label() == null ? "" : t.label().trim().toLowerCase();
        return name.equals("water") || name.equals("shallow") || name.equals("shallows") || name.equals("swamp");
    }

    private static HexTerrain neighbourLand(MapGenContext ctx, int col, int row) {
        if (!inside(ctx, col, row)) {
            return null;
        }
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nr = row + d[1];
            int nc = HexCoords.colOf(q + d[0], nr);
            if (dryLand(ctx, nc, nr)) {
                return ctx.cells[nr][nc];
            }
        }
        return null;
    }

    private static boolean[][] townDisc(MapGenContext ctx, int radius) {
        boolean[][] clear = new boolean[ctx.height][ctx.width];
        if (radius <= 0) {
            return clear;
        }
        for (TownSite site : ctx.townSites) {
            stamp(ctx, clear, site.col(), site.row(), radius);
            stamp(ctx, clear, site.keepCol(), site.row(), radius);
        }
        return clear;
    }

    private static void stamp(MapGenContext ctx, boolean[][] clear, int col, int row, int radius) {
        if (!inside(ctx, col, row)) {
            return;
        }
        ArrayList<int[]> q = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        q.add(new int[] {col, row, 0});
        seen.add(col + "," + row);
        for (int i = 0; i < q.size(); i++) {
            int[] cur = q.get(i);
            clear[cur[1]][cur[0]] = true;
            if (cur[2] >= radius) {
                continue;
            }
            int aq = HexCoords.qOf(cur[0], cur[1]);
            for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
                int nr = cur[1] + d[1];
                int nc = HexCoords.colOf(aq + d[0], nr);
                if (!inside(ctx, nc, nr) || !seen.add(nc + "," + nr)) {
                    continue;
                }
                q.add(new int[] {nc, nr, cur[2] + 1});
            }
        }
    }

    private static boolean touchesPocket(MapGenContext ctx, List<int[]> hexes) {
        if (ctx.pocketIds == null) {
            return false;
        }
        for (int[] hex : hexes) {
            if (ctx.pocketIds[hex[1]][hex[0]] > 0) {
                return true;
            }
        }
        return false;
    }

    private static HexTerrain waterTerrain(MapGenContext ctx) {
        for (HexTerrain terrain : HexTerrain.all(ctx.data)) {
            if (terrain.id() == 3 || "water".equalsIgnoreCase(terrain.label())) {
                return terrain;
            }
        }
        return null;
    }

    private static boolean inside(MapGenContext ctx, int col, int row) {
        return col >= 0 && row >= 0 && col < ctx.width && row < ctx.height;
    }

    private static long pairKey(int a, int b) {
        int lo = Math.min(a, b);
        int hi = Math.max(a, b);
        return (((long) lo) << 32) ^ (hi & 0xffffffffL);
    }

    private record BridgeProp(int id, String file, String axis, double scale) {}

    private static List<BridgeProp> bridgeProps(MapGenContext ctx) {
        List<BridgeProp> out = new ArrayList<>();
        if (ctx.data == null) {
            return out;
        }
        for (Map<String, Object> row : ctx.data.rows("prop")) {
            Object rules = row.get("terrain_rules");
            if (!WorldProps.parseFlag(rules, "bridge_only")) {
                continue;
            }
            String axis = axisOf(rules);
            if (axis == null) {
                log.warn("BR S9-32: bridge prop id {} has no terrain_rules.axis", row.get("id"));
                continue;
            }
            Integer id = asInt(row.get("id"));
            String file = text(row.get("file_name"));
            if (file.isEmpty()) {
                file = text(row.get("image_path"));
            }
            if (id == null || file.isEmpty()) {
                continue;
            }
            file = file.replace('\\', '/');
            int slash = file.lastIndexOf('/');
            if (slash >= 0) {
                file = file.substring(slash + 1);
            }
            if (file.toLowerCase().endsWith(".png")) {
                file = file.substring(0, file.length() - 4);
            }
            out.add(new BridgeProp(id, file, axis, WorldProps.readRenderScale(row)));
        }
        return out;
    }

    private static String axisOf(Object rules) {
        Map<?, ?> map = WorldProps.asRulesMap(rules);
        if (map == null) {
            return null;
        }
        Object axis = map.get("axis");
        if (axis == null) {
            return null;
        }
        String text = axis.toString().trim().toLowerCase();
        if (text.equals("across") || text.equals("up") || text.equals("down")) {
            return text;
        }
        return null;
    }

    private static String text(Object value) {
        return value == null ? "" : value.toString().trim();
    }

    private static Integer asInt(Object value) {
        if (value instanceof Number n) {
            return n.intValue();
        }
        return null;
    }
}
