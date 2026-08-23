package com.heroesofyendor;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.ThreadLocalRandom;

/**
 * Seeded test grid: 3–8 hex wide, 1–2 hex tall segments (not full-width bands).
 */
final class TestGrid {

    static final MapSize SIZE = MapSize.SMALL;

    static final int MIN_SEGMENT_WIDTH = 3;
    static final int MAX_SEGMENT_WIDTH = 8;
    static final int MINES_PER_RESOURCE = 2;
    static final int PICKUPS_PER_RESOURCE = 2;
    static final int TOWN_COUNT = 5;

    /** Same offset cell as frontend `HERO_START_OFFSET` (Small 36×36 center). */
    static final int HERO_START_COL = 18;
    static final int HERO_START_ROW = 18;
    static final int START_TOWN_MIN_DIST = 2;
    static final int START_TOWN_MAX_DIST = 3;

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
        Terrain[][] cells = paintSegments(width, height, rng);
        List<TileData> tiles = new ArrayList<>(width * height);
        for (int row = 0; row < height; row++) {
            for (int col = 0; col < width; col++) {
                Terrain terrain = cells[row][col];
                int q = col;
                int r = row - offsetFromZero(col);
                tiles.add(new TileData(q, r, terrain.label(), terrain.movementCost()));
            }
        }
        List<MapObjectData> objects = placeObjects(cells, rng, data);
        return new TestGridResponse(seed, List.copyOf(tiles), List.copyOf(objects));
    }

    /** Passable hexes only, one object per hex. First town sits near hero spawn. */
    private static List<MapObjectData> placeObjects(
            Terrain[][] cells, Random rng, ReferenceData data) {
        int height = cells.length;
        int width = cells[0].length;
        List<int[]> passable = new ArrayList<>();
        for (int row = 0; row < height; row++) {
            for (int col = 0; col < width; col++) {
                if (cells[row][col].movementCost() != null) {
                    passable.add(new int[] {col, row});
                }
            }
        }
        TownNameSession names = TownNameSession.from(data, rng);
        List<MapObjectData> objects = new ArrayList<>();
        int placed = 0;
        String startName = names.takePreferredStart(rng);
        if (startName != null && placeStartTown(objects, passable, startName, rng)) {
            placed = 1;
        }
        Collections.shuffle(passable, rng);
        int i = 0;
        for (Resource resource : Resource.values()) {
            for (int n = 0; n < MINES_PER_RESOURCE; n++) {
                if (i >= passable.size()) {
                    return objects;
                }
                objects.add(objectAt(passable.get(i++), "mine", resource));
            }
            for (int n = 0; n < PICKUPS_PER_RESOURCE; n++) {
                if (i >= passable.size()) {
                    return objects;
                }
                objects.add(objectAt(passable.get(i++), "pickup", resource));
            }
        }
        placeTowns(objects, passable, i, names, rng, placed);
        return objects;
    }

    private static boolean placeStartTown(
            List<MapObjectData> objects,
            List<int[]> passable,
            String name,
            Random rng) {
        int startQ = HERO_START_COL;
        int startR = HERO_START_ROW - offsetFromZero(HERO_START_COL);
        int[] chosen = pickNearbyPassable(passable, startQ, startR, rng);
        if (chosen == null) {
            return false;
        }
        passable.remove(chosen);
        int col = chosen[0];
        int row = chosen[1];
        int q = col;
        int r = row - offsetFromZero(col);
        objects.add(new MapObjectData(q, r, "town", "", "T1", name));
        return true;
    }

    /** Prefer a passable hex 2–3 away from spawn so the first town is in starting vision. */
    private static int[] pickNearbyPassable(
            List<int[]> passable,
            int startQ,
            int startR,
            Random rng) {
        List<int[]> nearby = new ArrayList<>();
        int[] fallback = null;
        int fallbackDist = Integer.MAX_VALUE;
        for (int[] colRow : passable) {
            int q = colRow[0];
            int r = colRow[1] - offsetFromZero(colRow[0]);
            int dist = hexDistance(startQ, startR, q, r);
            if (dist == 0) {
                continue;
            }
            if (dist >= START_TOWN_MIN_DIST && dist <= START_TOWN_MAX_DIST) {
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
            int placed) {
        int i = start;
        while (placed < TOWN_COUNT) {
            Integer townId = names.pickTownId(rng);
            if (townId == null) {
                return;
            }
            String name = names.take(townId);
            if (name == null) {
                return;
            }
            if (i >= passable.size()) {
                return;
            }
            int[] colRow = passable.get(i++);
            int col = colRow[0];
            int row = colRow[1];
            int q = col;
            int r = row - offsetFromZero(col);
            objects.add(new MapObjectData(q, r, "town", "", "T1", name));
            placed++;
        }
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
            int startTownId = findTownId(towns, "Necropolis");
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

        String takePreferredStart(Random rng) {
            int townId = startTownId;
            if (!hasName(townId)) {
                Integer any = pickTownId(rng);
                if (any == null) {
                    return null;
                }
                townId = any;
            }
            return take(townId);
        }

        Integer pickTownId(Random rng) {
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

        private static int findTownId(List<Map<String, Object>> towns, String typeName) {
            for (Map<String, Object> row : towns) {
                if (typeName.equalsIgnoreCase(String.valueOf(row.get("name")))
                        && row.get("id") instanceof Number id) {
                    return id.intValue();
                }
            }
            if (!towns.isEmpty() && towns.get(0).get("id") instanceof Number id) {
                return id.intValue();
            }
            return 1;
        }
    }

    private static MapObjectData objectAt(int[] colRow, String kind, Resource resource) {
        int col = colRow[0];
        int row = colRow[1];
        int q = col;
        int r = row - offsetFromZero(col);
        String marker = "mine".equals(kind) ? resource.mineMarker() : resource.pickupMarker();
        return new MapObjectData(q, r, kind, resource.displayName(), marker, null);
    }

    private static Terrain[][] paintSegments(int width, int height, Random rng) {
        Terrain[][] cells = new Terrain[height][width];
        for (int row = 0; row < height; row++) {
            Terrain previous = null;
            int col = 0;
            while (col < width) {
                if (cells[row][col] != null) {
                    previous = cells[row][col];
                    col++;
                    continue;
                }
                int remaining = width - col;
                int segW = segmentWidth(rng, remaining);
                int segH = segmentHeight(rng, cells, row, col, segW, height);
                Terrain terrain = pickTerrain(rng, previous);
                for (int dr = 0; dr < segH; dr++) {
                    for (int c = col; c < col + segW; c++) {
                        cells[row + dr][c] = terrain;
                    }
                }
                previous = terrain;
                col += segW;
            }
        }
        return cells;
    }

    /** 3–8 hexes, or whatever is left at the end of a row (never leave a 1–2 gap). */
    private static int segmentWidth(Random rng, int remaining) {
        int span = MAX_SEGMENT_WIDTH - MIN_SEGMENT_WIDTH + 1;
        int segW = MIN_SEGMENT_WIDTH + rng.nextInt(span);
        if (segW > remaining) {
            segW = remaining;
        }
        int leftover = remaining - segW;
        if (leftover > 0 && leftover < MIN_SEGMENT_WIDTH) {
            segW = remaining;
        }
        return segW;
    }

    private static int segmentHeight(
            Random rng,
            Terrain[][] cells,
            int row,
            int col,
            int segW,
            int height) {
        if (row + 1 >= height) {
            return 1;
        }
        for (int c = col; c < col + segW; c++) {
            if (cells[row + 1][c] != null) {
                return 1;
            }
        }
        return 1 + rng.nextInt(2);
    }

    /** Adjacent segments in a row use different types so one terrain cannot wall the row. */
    private static Terrain pickTerrain(Random rng, Terrain avoid) {
        Terrain[] all = Terrain.values();
        int index = rng.nextInt(all.length);
        Terrain picked = all[index];
        if (avoid != null && picked == avoid) {
            picked = all[(index + 1) % all.length];
        }
        return picked;
    }

    /**
     * honeycomb-grid default offset (-1): {@code (col + offset * (col & 1)) >> 1}.
     */
    private static int offsetFromZero(int col) {
        return (col + (-1) * (col & 1)) >> 1;
    }
}
