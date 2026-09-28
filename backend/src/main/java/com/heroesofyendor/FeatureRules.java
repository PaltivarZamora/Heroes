package com.heroesofyendor;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Layer-5 adjacency, terrain, and gap-zone rules (BR S9-22).
 * Permanent means {@code feature_type.default_stats.disappears} is false.
 */
final class FeatureRules {

    private static final Logger log = LoggerFactory.getLogger(FeatureRules.class);

    final MapGenContext ctx;
    final Set<Integer> permNoTerrain;
    final Set<Integer> tempNoTerrain;
    final List<Integer> fairResources;
    final int fairRadius;
    final int townClear;
    /** Min hex distance from town footprint for permanent features and blocking props. */
    final int permTownClear;
    /** Hexes within {@link #permTownClear} of any town footprint (built once). */
    boolean[][] permTownClearHex;
    final List<String> notes = new ArrayList<>();
    private final Map<String, Boolean> disappearsByType = new HashMap<>();
    private final Map<String, Integer> typeIds = new HashMap<>();
    private final Map<String, Integer> featureIds = new HashMap<>();

    private FeatureRules(
            MapGenContext ctx,
            Set<Integer> permNoTerrain,
            Set<Integer> tempNoTerrain,
            List<Integer> fairResources,
            int fairRadius,
            int townClear,
            int permTownClear) {
        this.ctx = ctx;
        this.permNoTerrain = permNoTerrain;
        this.tempNoTerrain = tempNoTerrain;
        this.fairResources = fairResources;
        this.fairRadius = fairRadius;
        this.townClear = townClear;
        this.permTownClear = permTownClear;
    }

    static FeatureRules load(MapGenContext ctx) {
        String size = ctx.sizeName();
        FeatureRules rules =
                new FeatureRules(
                        ctx,
                        intSet(ctx.data, "perm_no_terrain", size, 3, 20, 21),
                        intSet(ctx.data, "temp_no_terrain", size, 3),
                        intList(ctx.data, "fair_start_resources", size, 1, 2, 3),
                        Math.max(1, MapConfig.cfgInt(ctx.data, "fair_start_radius", size, 12)),
                        Math.max(0, MapConfig.cfgInt(ctx.data, "wall_town_clear", size, 3)),
                        Math.max(0, MapConfig.cfgInt(ctx.data, "feature_town_clear", size, 1)));
        rules.buildPermTownClearHex();
        return rules;
    }

    private void buildPermTownClearHex() {
        if (permTownClear <= 0 || ctx.townSites == null || ctx.townSites.isEmpty()) {
            return;
        }
        permTownClearHex = new boolean[ctx.height][ctx.width];
        for (TownSite site : ctx.townSites) {
            int[][] feet = {{site.col(), site.row()}, {site.keepCol(), site.row()}};
            for (int[] foot : feet) {
                if (foot[0] < 0 || foot[0] >= ctx.width || foot[1] < 0 || foot[1] >= ctx.height) {
                    continue;
                }
                int aq = HexCoords.qOf(foot[0], foot[1]);
                int ar = foot[1];
                for (int row = 0; row < ctx.height; row++) {
                    for (int col = 0; col < ctx.width; col++) {
                        int q = HexCoords.qOf(col, row);
                        if (HexCoords.hexDistance(q, row, aq, ar) <= permTownClear) {
                            permTownClearHex[row][col] = true;
                        }
                    }
                }
            }
        }
    }

    /**
     * @return a short reason, or null when this hex may hold a new permanent feature
     */
    String rejectPermanent(List<MapObjectData> objects, int col, int row) {
        if (!inside(col, row)) {
            return "bounds";
        }
        if (ctx.hasRoad != null && ctx.hasRoad[row][col]) {
            return "road";
        }
        if (ctx.townReserved != null && ctx.townReserved[row][col]) {
            return "town";
        }
        if (inPermTownClear(HexCoords.qOf(col, row), row)) {
            return "town";
        }
        if (ctx.buildingLand != null && !ctx.buildingLand[row][col]) {
            return "land";
        }
        if (ctx.propBlocked != null && ctx.propBlocked[row][col]) {
            return "blocked";
        }
        if (Pockets.seals(ctx, col, row)) {
            return "pocket";
        }
        if (inGap(col, row)) {
            return "gap";
        }
        HexTerrain terrain = ctx.cells[row][col];
        if (terrain == null || !terrain.isPassable() || terrain.movementCost() == null) {
            return "terrain";
        }
        if (permNoTerrain.contains(terrain.id())) {
            return "terrain";
        }
        int q = HexCoords.qOf(col, row);
        if (occupied(objects, q, row)) {
            return "occupied";
        }
        if (adjacentPermanent(objects, q, row)) {
            return "adjacent";
        }
        if (approachCount(objects, q, row, -1, -1) < 1) {
            return "approach";
        }
        return null;
    }

    /**
     * Temporary features may sit in the gap zone and beside permanents.
     * Same {@code feature} row (all chests share one group) may not touch.
     */
    String rejectTemporary(List<MapObjectData> objects, int col, int row, String groupKey) {
        if (!inside(col, row)) {
            return "bounds";
        }
        if (ctx.hasRoad != null && ctx.hasRoad[row][col]) {
            return "road";
        }
        if (ctx.townReserved != null && ctx.townReserved[row][col]) {
            return "town";
        }
        if (ctx.propBlocked != null && ctx.propBlocked[row][col]) {
            return "blocked";
        }
        if (Pockets.seals(ctx, col, row)) {
            return "pocket";
        }
        HexTerrain terrain = ctx.cells[row][col];
        if (terrain == null || !terrain.isPassable() || terrain.movementCost() == null) {
            return "terrain";
        }
        if (tempNoTerrain.contains(terrain.id())) {
            return "terrain";
        }
        int q = HexCoords.qOf(col, row);
        if (occupied(objects, q, row)) {
            return "occupied";
        }
        if (groupKey != null && adjacentGroup(objects, q, row, groupKey)) {
            return "duplicate";
        }
        if (stealsLastApproach(objects, col, row, null)) {
            return "approach";
        }
        return null;
    }

    boolean inGap(int col, int row) {
        if (ctx.wallGap == null || !inside(col, row)) {
            return false;
        }
        if (ctx.wallGap[row][col]) {
            return true;
        }
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nr = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nr);
            if (inside(ncol, nr) && ctx.wallGap[nr][ncol]) {
                return true;
            }
        }
        return false;
    }

    boolean inTownClear(int q, int r) {
        for (TownSite site : ctx.townSites) {
            if (townDistance(site, q, r) <= townClear) {
                return true;
            }
        }
        return false;
    }

    boolean inPermTownClear(int q, int r) {
        if (permTownClear <= 0) {
            return false;
        }
        if (permTownClearHex != null) {
            int col = HexCoords.colOf(q, r);
            if (col < 0 || r < 0 || col >= ctx.width || r >= ctx.height) {
                return false;
            }
            return permTownClearHex[r][col];
        }
        for (TownSite site : ctx.townSites) {
            if (townDistance(site, q, r) <= permTownClear) {
                return true;
            }
        }
        return false;
    }

    int townDistance(TownSite site, int q, int r) {
        int eq = HexCoords.qOf(site.col(), site.row());
        int kq = HexCoords.qOf(site.keepCol(), site.row());
        return Math.min(
                HexCoords.hexDistance(q, r, eq, site.row()),
                HexCoords.hexDistance(q, r, kq, site.row()));
    }

    boolean isPermanent(MapObjectData obj) {
        if (obj == null || "town".equals(obj.kind())) {
            return false;
        }
        return !disappears(obj.kind());
    }

    boolean disappears(String kind) {
        String typeName = typeNameForKind(kind);
        if (typeName == null) {
            return false;
        }
        Boolean cached = disappearsByType.get(typeName);
        if (cached != null) {
            return cached;
        }
        Boolean flag = readDisappears(typeName);
        if (flag == null) {
            flag = "chest".equals(kind) || "pickup".equals(kind);
        }
        disappearsByType.put(typeName, flag);
        return flag;
    }

    /** Duplicate-group key for a temporary feature, or null when permanent. */
    String groupKey(MapObjectData obj) {
        if (obj == null || !disappears(obj.kind())) {
            return null;
        }
        if ("chest".equals(obj.kind())) {
            return "chest";
        }
        if ("pickup".equals(obj.kind()) && obj.resourceId() != null) {
            Integer id = featureId("loose_resource", obj.resourceId());
            return id == null ? "loose:" + obj.resourceId() : "feature:" + id;
        }
        return "kind:" + obj.kind();
    }

    String groupKeyForPickup(int resourceId) {
        Integer id = featureId("loose_resource", resourceId);
        return id == null ? "loose:" + resourceId : "feature:" + id;
    }

    /**
     * A blocking prop on this hex would remove the last walkable approach of a
     * neighbouring permanent feature.
     */
    boolean stealsLastApproach(List<MapObjectData> objects, int col, int row, boolean[][] extraBlocked) {
        if (!inside(col, row)) {
            return false;
        }
        int q = HexCoords.qOf(col, row);
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nq = q + d[0];
            int nr = row + d[1];
            MapObjectData feature = featureAt(objects, nq, nr);
            if (feature == null || !isPermanent(feature)) {
                continue;
            }
            if (approachCount(objects, nq, nr, col, row, extraBlocked) < 1) {
                return true;
            }
        }
        return false;
    }

    void report(int propsBefore, int propsAfter, double propMult) {
        StringBuilder body = new StringBuilder();
        body.append("S9-22 seed=").append(ctx.mapSeed).append(" size=").append(ctx.sizeName());
        for (String note : notes) {
            body.append(" | ").append(note);
        }
        body.append(" | props before=").append(propsBefore);
        body.append(" after=").append(propsAfter);
        body.append(" mult=").append(propMult);
        int permAdj = 0;
        int dupTemp = 0;
        int gapPerm = 0;
        int badLand = 0;
        List<MapObjectData> objects = ctx.objects == null ? List.of() : ctx.objects;
        List<MapObjectData> perm = new ArrayList<>();
        List<MapObjectData> temp = new ArrayList<>();
        for (MapObjectData obj : objects) {
            if ("town".equals(obj.kind())) {
                continue;
            }
            if (isPermanent(obj)) {
                perm.add(obj);
            } else if (disappears(obj.kind())) {
                temp.add(obj);
            }
        }
        for (int i = 0; i < perm.size(); i++) {
            MapObjectData a = perm.get(i);
            if (inGap(HexCoords.colOf(a.q(), a.r()), a.r())) {
                gapPerm++;
            }
            if (onShallowOrSwamp(a)) {
                badLand++;
            }
            for (int j = i + 1; j < perm.size(); j++) {
                MapObjectData b = perm.get(j);
                if (HexCoords.hexDistance(a.q(), a.r(), b.q(), b.r()) == 1) {
                    permAdj++;
                }
            }
        }
        for (int i = 0; i < temp.size(); i++) {
            MapObjectData a = temp.get(i);
            String key = groupKey(a);
            if (key == null) {
                continue;
            }
            for (int j = i + 1; j < temp.size(); j++) {
                MapObjectData b = temp.get(j);
                if (!key.equals(groupKey(b))) {
                    continue;
                }
                if (HexCoords.hexDistance(a.q(), a.r(), b.q(), b.r()) == 1) {
                    if (pocketInterior(a) && pocketInterior(b)) {
                        continue;
                    }
                    dupTemp++;
                }
            }
        }
        int gapBlock = blockingPropsInGap();
        int[] roads = roadEdgeAudit();
        body.append(" | permAdj=").append(permAdj);
        body.append(" dupTemp=").append(dupTemp);
        body.append(" gapPerm=").append(gapPerm);
        body.append(" gapBlock=").append(gapBlock);
        body.append(" shallowSwamp=").append(badLand);
        body.append(" roadEdges=").append(roads[0]);
        body.append(" roadSuppressed=").append(roads[1]);
        body.append(" roadDangling=").append(roads[2]);
        log.info("{}", body);
    }

    private int blockingPropsInGap() {
        if (ctx.propSeeds == null) {
            return 0;
        }
        Set<Integer> wallIds = new HashSet<>();
        for (WorldProps.WallProp wall : WorldProps.walls(ctx.data)) {
            wallIds.add(wall.id());
        }
        int n = 0;
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                WorldProps.Seed prop = ctx.propSeeds[row][col];
                if (prop == null || !prop.blocker() || !inGap(col, row)) {
                    continue;
                }
                if (wallIds.contains(prop.propId())) {
                    continue;
                }
                n++;
            }
        }
        return n;
    }

    /** {@code [linked edges, suppressed geometric edges, dangling mask bits]}. */
    private int[] roadEdgeAudit() {
        int linked = 0;
        int geom = 0;
        int dangling = 0;
        if (ctx.hasRoad == null) {
            return new int[] {0, 0, 0};
        }
        for (int row = 0; row < ctx.height; row++) {
            for (int col = 0; col < ctx.width; col++) {
                if (!ctx.hasRoad[row][col]) {
                    continue;
                }
                int q = HexCoords.qOf(col, row);
                int bits = ctx.roadMask == null ? 0 : ctx.roadMask[row][col];
                for (int dir = 0; dir < 6; dir++) {
                    int[] d = HexCoords.AXIAL_NEIGHBORS[dir];
                    int nr = row + d[1];
                    int ncol = HexCoords.colOf(q + d[0], nr);
                    boolean roadNbr = inside(ncol, nr) && ctx.hasRoad[nr][ncol];
                    boolean bit = (bits & (1 << dir)) != 0;
                    if (dir < 3 && roadNbr) {
                        geom++;
                        if (bit) {
                            linked++;
                        }
                    }
                    if (bit && !roadNbr) {
                        dangling++;
                    }
                }
            }
        }
        return new int[] {linked, Math.max(0, geom - linked), dangling};
    }

    private boolean onShallowOrSwamp(MapObjectData obj) {
        int col = HexCoords.colOf(obj.q(), obj.r());
        int row = obj.r();
        if (!inside(col, row)) {
            return false;
        }
        HexTerrain terrain = ctx.cells[row][col];
        if (terrain == null) {
            return false;
        }
        String name = terrain.label() == null ? "" : terrain.label().trim();
        return name.equalsIgnoreCase("Shallow") || name.equalsIgnoreCase("Swamp");
    }

    private boolean adjacentPermanent(List<MapObjectData> objects, int q, int r) {
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            MapObjectData obj = featureAt(objects, q + d[0], r + d[1]);
            if (obj != null && isPermanent(obj)) {
                return true;
            }
        }
        return false;
    }

    private boolean pocketInterior(MapObjectData obj) {
        int col = HexCoords.colOf(obj.q(), obj.r());
        int row = obj.r();
        return ctx.pocketInterior != null
                && row >= 0
                && col >= 0
                && row < ctx.height
                && col < ctx.width
                && ctx.pocketInterior[row][col];
    }

    private boolean adjacentGroup(List<MapObjectData> objects, int q, int r, String groupKey) {
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            MapObjectData obj = featureAt(objects, q + d[0], r + d[1]);
            if (obj != null && groupKey.equals(groupKey(obj))) {
                return true;
            }
        }
        return false;
    }

    private int approachCount(List<MapObjectData> objects, int q, int r, int blockCol, int blockRow) {
        return approachCount(objects, q, r, blockCol, blockRow, null);
    }

    private int approachCount(
            List<MapObjectData> objects,
            int q,
            int r,
            int blockCol,
            int blockRow,
            boolean[][] extraBlocked) {
        int n = 0;
        for (int[] d : HexCoords.AXIAL_NEIGHBORS) {
            int nq = q + d[0];
            int nr = r + d[1];
            int ncol = HexCoords.colOf(nq, nr);
            if (ncol == blockCol && nr == blockRow) {
                continue;
            }
            if (!inside(ncol, nr)) {
                continue;
            }
            if (ctx.townReserved != null && ctx.townReserved[nr][ncol]) {
                continue;
            }
            if (ctx.propBlocked != null && ctx.propBlocked[nr][ncol]) {
                continue;
            }
            if (extraBlocked != null && extraBlocked[nr][ncol]) {
                continue;
            }
            HexTerrain terrain = ctx.cells[nr][ncol];
            if (terrain == null || !terrain.isPassable() || terrain.movementCost() == null) {
                continue;
            }
            if (occupied(objects, nq, nr)) {
                continue;
            }
            n++;
        }
        return n;
    }

    private boolean occupied(List<MapObjectData> objects, int q, int r) {
        return featureAt(objects, q, r) != null || guardAt(objects, q, r);
    }

    private static MapObjectData featureAt(List<MapObjectData> objects, int q, int r) {
        if (objects == null) {
            return null;
        }
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

    private static boolean guardAt(List<MapObjectData> objects, int q, int r) {
        if (objects == null) {
            return false;
        }
        for (MapObjectData obj : objects) {
            if (obj.guardQ() != null && obj.guardR() != null && obj.guardQ() == q && obj.guardR() == r) {
                return true;
            }
        }
        return false;
    }

    private boolean inside(int col, int row) {
        return col >= 0 && row >= 0 && col < ctx.width && row < ctx.height;
    }

    private Boolean readDisappears(String typeName) {
        for (Map<String, Object> row : ctx.data.rows("feature_type")) {
            if (!typeName.equalsIgnoreCase(text(row.get("name")))) {
                continue;
            }
            Object raw = row.get("default_stats");
            if (raw == null) {
                raw = row.get("stats");
            }
            Map<String, Object> stats = asMap(raw);
            if (stats == null || !stats.containsKey("disappears")) {
                return null;
            }
            return flag(stats.get("disappears"));
        }
        return null;
    }

    private Integer featureId(String typeName, int resourceId) {
        String cacheKey = typeName + "#" + resourceId;
        if (featureIds.containsKey(cacheKey)) {
            return featureIds.get(cacheKey);
        }
        Integer typeId = typeId(typeName);
        Integer found = null;
        for (Map<String, Object> row : ctx.data.rows("feature")) {
            Integer rowType = asInt(row.get("feature_type_id"));
            if (typeId != null && (rowType == null || !typeId.equals(rowType))) {
                continue;
            }
            Integer rid = resourceId(row.get("stats"));
            if (rid == null || rid != resourceId) {
                continue;
            }
            found = asInt(row.get("id"));
            break;
        }
        featureIds.put(cacheKey, found);
        return found;
    }

    private Integer typeId(String typeName) {
        if (typeIds.containsKey(typeName)) {
            return typeIds.get(typeName);
        }
        Integer id = null;
        for (Map<String, Object> row : ctx.data.rows("feature_type")) {
            if (typeName.equalsIgnoreCase(text(row.get("name")))) {
                id = asInt(row.get("id"));
                break;
            }
        }
        typeIds.put(typeName, id);
        return id;
    }

    static String typeNameForKind(String kind) {
        if (kind == null) {
            return null;
        }
        return switch (kind) {
            case "mine" -> "resource_node";
            case "pickup" -> "loose_resource";
            case "notice_board" -> "quest";
            case "recruits" -> "recruit_building";
            default -> kind;
        };
    }

    private static Integer resourceId(Object statsRaw) {
        Map<String, Object> stats = asMap(statsRaw);
        if (stats == null) {
            return null;
        }
        Integer id = asInt(stats.get("resource_id"));
        if (id == null) {
            id = asInt(stats.get("resourceId"));
        }
        return id;
    }

    private static Map<String, Object> asMap(Object raw) {
        Object value = MapConfig.decodeJsonb(raw);
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> out = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (entry.getKey() != null) {
                    out.put(entry.getKey().toString(), entry.getValue());
                }
            }
            return out;
        }
        return null;
    }

    private static boolean flag(Object raw) {
        if (raw instanceof Boolean b) {
            return b;
        }
        if (raw instanceof Number n) {
            return n.intValue() != 0;
        }
        if (raw == null) {
            return false;
        }
        String text = raw.toString().trim();
        return text.equalsIgnoreCase("true") || text.equals("1");
    }

    private static String text(Object raw) {
        return raw == null ? "" : raw.toString().trim();
    }

    private static Integer asInt(Object raw) {
        return MapConfig.asInt(raw);
    }

    private static Set<Integer> intSet(ReferenceData data, String key, String size, int... fallback) {
        Set<Integer> out = new HashSet<>();
        Object raw = MapConfig.mapCfg(data, key, size);
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

    private static List<Integer> intList(ReferenceData data, String key, String size, int... fallback) {
        List<Integer> out = new ArrayList<>();
        Object raw = MapConfig.mapCfg(data, key, size);
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
        return List.copyOf(out);
    }
}
