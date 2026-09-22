package com.heroesofyendor;

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
 * Seeded test grid: organic {@link HexTerrain} chunks via {@link TerrainChunks}.
 *
 * <p>Fixed build order so each layer sees prior blockers:
 * <ol>
 *   <li>Terrain (base + wedge / chunk paint)
 *   <li>Props (terrain eligibility; may mark hexes blocked)
 *   <li>Features (towns / mines / pickups on passable, non-prop-blocked hexes)
 * </ol>
 * World mobs are seeded on the frontend from the same passable set.
 */
final class TestGrid {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final TypeReference<Map<String, Object>> MAP_TYPE =
            new TypeReference<>() {};

    static final MapSize SIZE = MapSize.SMALL;

    static final int START_TOWN_TYPE_ID = 1;

    /** Same offset cell as frontend `HERO_START_OFFSET` (Small 36×36 center). */
    static final int HERO_START_COL = 18;
    static final int HERO_START_ROW = 18;

    private TestGrid() {
    }

    static TestGridResponse generate(ReferenceData data) {
        int seed = ThreadLocalRandom.current().nextInt(1, Integer.MAX_VALUE);
        return generate(seed, data);
    }

    static TestGridResponse generate(int seed, ReferenceData data) {
        Random rng = new Random(seed);
        int width = SIZE.width();
        int height = SIZE.height();
        List<HexTerrain> pool = HexTerrain.seedablePool(data);

        // 1. Terrain (base + wedge / chunk resolution).
        TerrainChunks.PaintResult painted = TerrainChunks.paint(width, height, rng, pool);
        HexTerrain[][] cells = painted.cells();
        int[][] chunkIds = painted.chunkIds();

        // 2. Props — terrain eligibility only; no features yet.
        List<WorldProps.PropDef> props = WorldProps.all(data);
        WorldProps.Seed[][] propSeeds = new WorldProps.Seed[height][width];
        boolean[][] propBlocked = new boolean[height][width];
        for (int row = 0; row < height; row++) {
            for (int col = 0; col < width; col++) {
                HexTerrain terrain = cells[row][col];
                if (!terrain.isPassable()) {
                    continue;
                }
                WorldProps.Seed prop = WorldProps.roll(terrain, props, rng);
                if (prop == null) {
                    continue;
                }
                propSeeds[row][col] = prop;
                propBlocked[row][col] = prop.blocker();
            }
        }

        // 3. Features — passable terrain and not occupied by a blocking prop.
        List<int[]> placeable = new ArrayList<>();
        for (int row = 0; row < height; row++) {
            for (int col = 0; col < width; col++) {
                if (cells[row][col].isPassable() && !propBlocked[row][col]) {
                    placeable.add(new int[] {col, row});
                }
            }
        }
        List<MapObjectData> objects = placeObjects(placeable, rng, data);

        // Left hex of each 2×1 town footprint is permanently blocked.
        java.util.HashSet<String> townLeftBlocked = new java.util.HashSet<>();
        for (MapObjectData obj : objects) {
            if (!"town".equals(obj.kind())) {
                continue;
            }
            // Object q,r = entry (right / drawbridge). Left = q-1, same r.
            townLeftBlocked.add((obj.q() - 1) + "," + obj.r());
        }

        List<TileData> tiles = new ArrayList<>(width * height);
        for (int row = 0; row < height; row++) {
            for (int col = 0; col < width; col++) {
                HexTerrain terrain = cells[row][col];
                // EXPERIMENT: pointy-top world map — odd-r (revert: q=col, r=row-offset(col)).
                int q = col - offsetFromZero(row);
                int r = row;
                int chunkId = chunkIds[row][col];
                WorldProps.Seed prop = propSeeds[row][col];
                boolean blocked =
                        terrain.blocked()
                                || (prop != null && prop.blocker())
                                || townLeftBlocked.contains(q + "," + r);
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
                                prop != null ? prop.fileName() : null));
            }
        }
        return new TestGridResponse(seed, List.copyOf(tiles), List.copyOf(objects));
    }

    /** Passable, non-prop-blocked hexes only; one object per hex. First town near hero spawn. */
    private static List<MapObjectData> placeObjects(
            List<int[]> placeable, Random rng, ReferenceData data) {
        MapPlaceConfig cfg = mapPlaceConfig(data);
        TownNameSession names = TownNameSession.from(data, rng);
        List<MapObjectData> objects = new ArrayList<>();
        int placed = 0;
        TownPick start = names.takePreferredStart(rng);
        if (start != null
                && placeStartTown(
                        objects,
                        placeable,
                        start,
                        rng,
                        cfg.startTownMin(),
                        cfg.startTownMax())) {
            placed = 1;
        }
        Collections.shuffle(placeable, rng);
        int i = 0;
        for (Map<String, Object> row : resourceRows(data)) {
            Integer resourceId = intId(row, "id");
            if (resourceId == null) {
                continue;
            }
            String resourceName = stringVal(row, "name");
            for (int n = 0; n < cfg.minesPerRes(); n++) {
                if (i >= placeable.size()) {
                    return objects;
                }
                objects.add(objectAt(placeable.get(i++), "mine", resourceId, resourceName, rng, data));
            }
            for (int n = 0; n < cfg.loosePerRes(); n++) {
                if (i >= placeable.size()) {
                    return objects;
                }
                objects.add(objectAt(placeable.get(i++), "pickup", resourceId, resourceName, rng, data));
            }
        }
        placeTowns(objects, placeable, i, names, rng, placed, cfg.townCount());
        return objects;
    }

    private static boolean placeStartTown(
            List<MapObjectData> objects,
            List<int[]> passable,
            TownPick start,
            Random rng,
            int startTownMin,
            int startTownMax) {
        // EXPERIMENT: pointy-top — odd-r hero spawn axial.
        int startQ = HERO_START_COL - offsetFromZero(HERO_START_ROW);
        int startR = HERO_START_ROW;
        int[] entry =
                pickNearbyTownEntry(passable, startQ, startR, rng, startTownMin, startTownMax);
        if (entry == null) {
            return false;
        }
        return commitTown2x1(objects, passable, entry, start.name(), start.townTypeId());
    }

    /**
     * Pick the right (drawbridge/entry) hex of a 2×1 town pair near spawn.
     * Left hex (col-1, same row) must also be placeable.
     */
    private static int[] pickNearbyTownEntry(
            List<int[]> passable,
            int startQ,
            int startR,
            Random rng,
            int startTownMin,
            int startTownMax) {
        int min = Math.max(1, startTownMin);
        int max = Math.max(min, startTownMax);
        java.util.HashMap<String, int[]> byKey = placeableIndex(passable);
        List<int[]> nearby = new ArrayList<>();
        int[] fallback = null;
        int fallbackDist = Integer.MAX_VALUE;
        for (int[] colRow : passable) {
            if (!hasTownLeft(byKey, colRow)) {
                continue;
            }
            int q = colRow[0] - offsetFromZero(colRow[1]);
            int r = colRow[1];
            int dist = hexDistance(startQ, startR, q, r);
            if (dist == 0) {
                continue;
            }
            if (dist >= min && dist <= max) {
                nearby.add(colRow);
            }
            if (dist < fallbackDist) {
                fallbackDist = dist;
                fallback = colRow;
            }
        }
        if (!nearby.isEmpty()) {
            Collections.shuffle(nearby, rng);
            return nearby.get(0);
        }
        return fallback;
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

    /**
     * Place town at entry (right/drawbridge). Removes left+entry from passable.
     * Object coordinates = entry hex.
     */
    private static boolean commitTown2x1(
            List<MapObjectData> objects,
            List<int[]> passable,
            int[] entry,
            String flavorName,
            int townTypeId) {
        java.util.HashMap<String, int[]> byKey = placeableIndex(passable);
        if (!hasTownLeft(byKey, entry)) {
            return false;
        }
        int[] left = byKey.get((entry[0] - 1) + "," + entry[1]);
        passable.remove(entry);
        passable.remove(left);
        int col = entry[0];
        int row = entry[1];
        int q = col - offsetFromZero(row);
        int r = row;
        objects.add(new MapObjectData(q, r, "town", null, "T", flavorName, townTypeId, null));
        return true;
    }

    private static int hexDistance(int aq, int ar, int bq, int br) {
        int dq = aq - bq;
        int dr = ar - br;
        return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    }

    private static void placeTowns(
            List<MapObjectData> objects,
            List<int[]> passable,
            int start,
            TownNameSession names,
            Random rng,
            int placed,
            int townCount) {
        // Rebuild candidates from remaining passable (mines may have consumed earlier slots).
        List<int[]> remaining = new ArrayList<>(passable.subList(Math.min(start, passable.size()), passable.size()));
        Collections.shuffle(remaining, rng);
        int want = Math.max(0, townCount);
        int guard = 0;
        while (placed < want && guard < remaining.size() + 8) {
            guard++;
            Integer townId = names.pickTownId(rng);
            if (townId == null) {
                return;
            }
            String name = names.take(townId);
            if (name == null) {
                return;
            }
            java.util.HashMap<String, int[]> byKey = placeableIndex(passable);
            int[] entry = null;
            for (int[] cand : remaining) {
                if (passable.contains(cand) && hasTownLeft(byKey, cand)) {
                    entry = cand;
                    break;
                }
            }
            if (entry == null) {
                return;
            }
            if (commitTown2x1(objects, passable, entry, name, townId)) {
                placed++;
            }
            remaining.remove(entry);
        }
    }

    /**
     * Prefer a passable hex in [min, max] from spawn (legacy single-hex helper).
     */
    private static int[] pickNearbyPassable(
            List<int[]> passable,
            int startQ,
            int startR,
            Random rng,
            int startTownMin,
            int startTownMax) {
        int min = Math.max(1, startTownMin);
        int max = Math.max(min, startTownMax);
        List<int[]> nearby = new ArrayList<>();
        int[] fallback = null;
        int fallbackDist = Integer.MAX_VALUE;
        for (int[] colRow : passable) {
            int q = colRow[0] - offsetFromZero(colRow[1]);
            int r = colRow[1];
            int dist = hexDistance(startQ, startR, q, r);
            if (dist == 0) {
                continue;
            }
            if (dist >= min && dist <= max) {
                nearby.add(colRow);
            }
            if (dist < fallbackDist) {
                fallbackDist = dist;
                fallback = colRow;
            }
        }
        if (!nearby.isEmpty()) {
            Collections.shuffle(nearby, rng);
            return nearby.get(0);
        }
        return fallback;
    }

    /**
     * In-memory shuffle-and-consume of {@code town_name_pool} for one generate()
     * call (one game). Names are never written back to the database.
     */
    private static final class TownNameSession {
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

    private record MapPlaceConfig(
            int minesPerRes,
            int loosePerRes,
            int townCount,
            int startTownMin,
            int startTownMax) {}

    private static MapPlaceConfig mapPlaceConfig(ReferenceData data) {
        int mines = configInt(data, "map_mines_per_res", 4);
        int loose = configInt(data, "map_loose_per_res", 10);
        int towns = configInt(data, "map_towns", 6);
        int min = configInt(data, "map_start_town_min", 2);
        int max = configInt(data, "map_start_town_max", 3);
        if (min > max) {
            int swap = min;
            min = max;
            max = swap;
        }
        return new MapPlaceConfig(mines, loose, towns, min, max);
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

    private static List<Map<String, Object>> resourceRows(ReferenceData data) {
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

    private static MapObjectData objectAt(
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
        return new MapObjectData(q, r, kind, resourceId, marker, null, null, flipped);
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
