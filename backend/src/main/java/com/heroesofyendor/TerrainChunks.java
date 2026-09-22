package com.heroesofyendor;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * Organic terrain chunks for the hex/`terrain` wedge system.
 * Contiguous blobs (~3–9 × 3–9) of one seedable {@link HexTerrain}.
 * Solid fills automatically keep "cores" from touching foreign cores — the
 * shared edge hexes are always border hexes of their own chunk.
 * Post-paint {@link #absorbOrphans} removes 1-hex islands and thin tips that
 * would render as orphan wedge stars / leftover single wedges.
 * {@code exclusion} is intentionally not enforced yet.
 * {@code required_buffer} is render-only (frontend wedges); chunks may still
 * share edges — the buffer appears as a 2-hex visual border, not a third chunk.
 */
final class TerrainChunks {

    private static final int MIN_SPAN = 3;
    private static final int MAX_SPAN = 9;
    /** Smallest blob we will seed; leftovers below this merge via fillGaps. */
    private static final int MIN_BLOB_CELLS = MIN_SPAN * MIN_SPAN;

    /** Axial neighbor deltas (same set the frontend pathfinding uses). */
    private static final int[][] NEIGHBOR_DQ_DR = {
        {1, 0},
        {1, -1},
        {0, -1},
        {-1, 0},
        {-1, 1},
        {0, 1},
    };

    /** Painted cells plus generation chunk ids (for continuous terrain photos). */
    record PaintResult(HexTerrain[][] cells, int[][] chunkIds) {}

    private TerrainChunks() {
    }

    static PaintResult paint(int width, int height, Random rng, List<HexTerrain> pool) {
        if (pool.isEmpty()) {
            throw new IllegalStateException("terrain seedable pool is empty");
        }
        HexTerrain[][] cells = new HexTerrain[height][width];
        int[][] chunkIds = new int[height][width];
        int remaining = width * height;
        int nextChunkId = 1;
        int guard = width * height * 4;
        while (remaining > 0 && guard-- > 0) {
            if (remaining < MIN_BLOB_CELLS) {
                break;
            }
            int[] seed = pickEmpty(cells, width, height, rng);
            if (seed == null) {
                break;
            }
            HexTerrain terrain = pool.get(rng.nextInt(pool.size()));
            int target = targetSize(rng, remaining);
            int chunkId = nextChunkId++;
            int painted =
                    growBlob(
                            cells,
                            chunkIds,
                            width,
                            height,
                            seed[0],
                            seed[1],
                            terrain,
                            chunkId,
                            target,
                            rng);
            remaining -= painted;
        }
        fillGaps(cells, chunkIds, width, height, pool, rng, nextChunkId);
        absorbOrphans(cells, chunkIds, width, height);
        return new PaintResult(cells, chunkIds);
    }

    private static int targetSize(Random rng, int remaining) {
        int w = MIN_SPAN + rng.nextInt(MAX_SPAN - MIN_SPAN + 1);
        int h = MIN_SPAN + rng.nextInt(MAX_SPAN - MIN_SPAN + 1);
        int want = Math.max(MIN_BLOB_CELLS, w * h);
        // Soft irregularity: shrink/grow by up to ~30%.
        int jitter = 1 + rng.nextInt(Math.max(1, want / 3));
        want = rng.nextBoolean() ? want + jitter : Math.max(MIN_SPAN, want - jitter);
        return Math.min(want, remaining);
    }

    private static int[] pickEmpty(HexTerrain[][] cells, int width, int height, Random rng) {
        int empty = 0;
        for (int row = 0; row < height; row++) {
            for (int col = 0; col < width; col++) {
                if (cells[row][col] == null) {
                    empty++;
                }
            }
        }
        if (empty == 0) {
            return null;
        }
        int pick = rng.nextInt(empty);
        for (int row = 0; row < height; row++) {
            for (int col = 0; col < width; col++) {
                if (cells[row][col] != null) {
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

    /**
     * Grow an irregular blob from (seedCol, seedRow) into empty cells only.
     * Returns how many cells were painted.
     */
    private static int growBlob(
            HexTerrain[][] cells,
            int[][] chunkIds,
            int width,
            int height,
            int seedCol,
            int seedRow,
            HexTerrain terrain,
            int chunkId,
            int target,
            Random rng) {
        if (cells[seedRow][seedCol] != null) {
            return 0;
        }
        List<int[]> frontier = new ArrayList<>();
        cells[seedRow][seedCol] = terrain;
        chunkIds[seedRow][seedCol] = chunkId;
        int painted = 1;
        addEmptyNeighbors(cells, width, height, seedCol, seedRow, frontier);

        while (painted < target && !frontier.isEmpty()) {
            int index = rng.nextInt(frontier.size());
            int[] next = frontier.remove(index);
            int col = next[0];
            int row = next[1];
            if (cells[row][col] != null) {
                continue;
            }
            cells[row][col] = terrain;
            chunkIds[row][col] = chunkId;
            painted++;
            addEmptyNeighbors(cells, width, height, col, row, frontier);
        }
        return painted;
    }

    private static void addEmptyNeighbors(
            HexTerrain[][] cells,
            int width,
            int height,
            int col,
            int row,
            List<int[]> frontier) {
        forEachNeighbor(width, height, col, row, (ncol, nrow) -> {
            if (cells[nrow][ncol] == null) {
                frontier.add(new int[] {ncol, nrow});
            }
        });
    }

    private static void fillGaps(
            HexTerrain[][] cells,
            int[][] chunkIds,
            int width,
            int height,
            List<HexTerrain> pool,
            Random rng,
            int nextChunkId) {
        int nextId = nextChunkId;
        boolean progress = true;
        while (progress) {
            progress = false;
            for (int row = 0; row < height; row++) {
                for (int col = 0; col < width; col++) {
                    if (cells[row][col] != null) {
                        continue;
                    }
                    int[] neighbor = anyNeighborCell(cells, width, height, col, row);
                    if (neighbor != null) {
                        cells[row][col] = cells[neighbor[1]][neighbor[0]];
                        chunkIds[row][col] = chunkIds[neighbor[1]][neighbor[0]];
                    } else {
                        cells[row][col] = pool.get(rng.nextInt(pool.size()));
                        chunkIds[row][col] = nextId++;
                    }
                    progress = true;
                }
            }
        }
    }

    /**
     * Reassign structurally weak hexes to the plurality of their neighbors:
     * <ul>
     *   <li>0 same-terrain neighbors — classic orphan / 6-wedge star</li>
     *   <li>≤2 same-terrain neighbors with ≥3 of one foreign terrain —
     *       buried tips, 1-wide tendrils, and zigzag pinch necks</li>
     * </ul>
     * Then absorbs leftover connected components smaller than {@link #MIN_BLOB_CELLS}.
     */
    private static void absorbOrphans(
            HexTerrain[][] cells, int[][] chunkIds, int width, int height) {
        int guard = width * height;
        while (guard-- > 0) {
            boolean changed = false;
            for (int row = 0; row < height; row++) {
                for (int col = 0; col < width; col++) {
                    HexTerrain self = cells[row][col];
                    if (self == null) {
                        continue;
                    }
                    if (!isAbsorbCandidate(cells, width, height, col, row, self)) {
                        continue;
                    }
                    int[] absorb = pluralityNeighborCell(cells, width, height, col, row);
                    if (absorb == null) {
                        continue;
                    }
                    HexTerrain terrain = cells[absorb[1]][absorb[0]];
                    if (terrain == null || terrain.id() == self.id()) {
                        continue;
                    }
                    cells[row][col] = terrain;
                    chunkIds[row][col] = chunkIds[absorb[1]][absorb[0]];
                    changed = true;
                }
            }
            if (!changed) {
                break;
            }
        }
        absorbTinyComponents(cells, chunkIds, width, height);
    }

    private static boolean isAbsorbCandidate(
            HexTerrain[][] cells,
            int width,
            int height,
            int col,
            int row,
            HexTerrain self) {
        Map<Integer, Integer> tallies = neighborTallies(cells, width, height, col, row);
        int same = tallies.getOrDefault(self.id(), 0);
        if (same == 0) {
            return true;
        }
        if (same > 2) {
            return false;
        }
        int bestForeign = 0;
        for (Map.Entry<Integer, Integer> e : tallies.entrySet()) {
            if (e.getKey() == self.id()) {
                continue;
            }
            bestForeign = Math.max(bestForeign, e.getValue());
        }
        // Tips + 1-wide / zigzag corridors buried in a foreign majority.
        return bestForeign >= 3;
    }

    private static void absorbTinyComponents(
            HexTerrain[][] cells, int[][] chunkIds, int width, int height) {
        int guard = width * height;
        while (guard-- > 0) {
            boolean[][] visited = new boolean[height][width];
            boolean changed = false;
            for (int row = 0; row < height; row++) {
                for (int col = 0; col < width; col++) {
                    if (visited[row][col] || cells[row][col] == null) {
                        continue;
                    }
                    HexTerrain terrain = cells[row][col];
                    List<int[]> component = new ArrayList<>();
                    ArrayDeque<int[]> queue = new ArrayDeque<>();
                    queue.add(new int[] {col, row});
                    visited[row][col] = true;
                    while (!queue.isEmpty()) {
                        int[] cur = queue.removeFirst();
                        component.add(cur);
                        forEachNeighbor(width, height, cur[0], cur[1], (ncol, nrow) -> {
                            if (visited[nrow][ncol]) {
                                return;
                            }
                            HexTerrain t = cells[nrow][ncol];
                            if (t == null || t.id() != terrain.id()) {
                                return;
                            }
                            visited[nrow][ncol] = true;
                            queue.add(new int[] {ncol, nrow});
                        });
                    }
                    if (component.size() >= MIN_BLOB_CELLS) {
                        continue;
                    }
                    for (int[] cell : component) {
                        int[] absorb =
                                pluralityForeignNeighborCell(
                                        cells, width, height, cell[0], cell[1], terrain.id());
                        if (absorb == null) {
                            absorb = pluralityNeighborCell(cells, width, height, cell[0], cell[1]);
                        }
                        if (absorb == null) {
                            continue;
                        }
                        HexTerrain next = cells[absorb[1]][absorb[0]];
                        if (next != null && next.id() != terrain.id()) {
                            cells[cell[1]][cell[0]] = next;
                            chunkIds[cell[1]][cell[0]] = chunkIds[absorb[1]][absorb[0]];
                            changed = true;
                        }
                    }
                }
            }
            if (!changed) {
                return;
            }
        }
    }

    /** Plurality among neighbors whose terrain id differs from {@code selfId}. */
    private static int[] pluralityForeignNeighborCell(
            HexTerrain[][] cells,
            int width,
            int height,
            int col,
            int row,
            int selfId) {
        Map<Integer, Integer> tallies = new HashMap<>();
        Map<Integer, int[]> cellByTerrain = new HashMap<>();
        forEachNeighbor(width, height, col, row, (ncol, nrow) -> {
            HexTerrain t = cells[nrow][ncol];
            if (t == null || t.id() == selfId) {
                return;
            }
            cellByTerrain.putIfAbsent(t.id(), new int[] {ncol, nrow});
            tallies.merge(t.id(), 1, Integer::sum);
        });
        int bestId = -1;
        int bestCount = -1;
        for (Map.Entry<Integer, Integer> e : tallies.entrySet()) {
            if (e.getValue() > bestCount) {
                bestCount = e.getValue();
                bestId = e.getKey();
            }
        }
        return bestId < 0 ? null : cellByTerrain.get(bestId);
    }

    private static Map<Integer, Integer> neighborTallies(
            HexTerrain[][] cells, int width, int height, int col, int row) {
        Map<Integer, Integer> tallies = new HashMap<>();
        forEachNeighbor(width, height, col, row, (ncol, nrow) -> {
            HexTerrain t = cells[nrow][ncol];
            if (t != null) {
                tallies.merge(t.id(), 1, Integer::sum);
            }
        });
        return tallies;
    }

    /** Plurality neighbor cell (col,row) for adopting terrain + chunk id. */
    private static int[] pluralityNeighborCell(
            HexTerrain[][] cells, int width, int height, int col, int row) {
        Map<Integer, Integer> tallies = neighborTallies(cells, width, height, col, row);
        Map<Integer, int[]> cellByTerrain = new HashMap<>();
        forEachNeighbor(width, height, col, row, (ncol, nrow) -> {
            HexTerrain t = cells[nrow][ncol];
            if (t != null) {
                cellByTerrain.putIfAbsent(t.id(), new int[] {ncol, nrow});
            }
        });
        int bestId = -1;
        int bestCount = -1;
        for (Map.Entry<Integer, Integer> e : tallies.entrySet()) {
            if (e.getValue() > bestCount) {
                bestCount = e.getValue();
                bestId = e.getKey();
            }
        }
        return bestId < 0 ? null : cellByTerrain.get(bestId);
    }

    /** First painted neighbor as {col,row}, or null. */
    private static int[] anyNeighborCell(
            HexTerrain[][] cells, int width, int height, int col, int row) {
        int[][] box = {null};
        forEachNeighbor(width, height, col, row, (ncol, nrow) -> {
            if (box[0] == null && cells[nrow][ncol] != null) {
                box[0] = new int[] {ncol, nrow};
            }
        });
        return box[0];
    }

    @FunctionalInterface
    private interface NeighborVisitor {
        void visit(int col, int row);
    }

    private static void forEachNeighbor(
            int width, int height, int col, int row, NeighborVisitor visitor) {
        // EXPERIMENT: pointy-top world map — odd-r axial (revert: q=col, r=row-offset(col)).
        int q = col - offsetFromZero(row);
        int r = row;
        for (int[] d : NEIGHBOR_DQ_DR) {
            int nq = q + d[0];
            int nr = r + d[1];
            int nrow = nr;
            int ncol = nq + offsetFromZero(nrow);
            if (ncol < 0 || ncol >= width || nrow < 0 || nrow >= height) {
                continue;
            }
            visitor.visit(ncol, nrow);
        }
    }

    /** honeycomb-grid default offset (-1). EXPERIMENT: applied to row for odd-r. */
    private static int offsetFromZero(int axis) {
        return (axis + (-1) * (axis & 1)) >> 1;
    }
}
