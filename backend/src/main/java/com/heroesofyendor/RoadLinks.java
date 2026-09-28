package com.heroesofyendor;

import java.util.List;

/**
 * 6-bit road edge mask (BR S9-22). Bit {@code i} is set only when a routed
 * path steps between this hex and {@link HexCoords#AXIAL_NEIGHBORS}[i].
 * Washout and orphan trimming clear both ends of a removed step.
 */
final class RoadLinks {

    private RoadLinks() {}

    static void ensure(MapGenContext ctx) {
        if (ctx.roadMask == null) {
            ctx.roadMask = new int[ctx.height][ctx.width];
        }
    }

    /** Connect consecutive axial hexes of one routed path. Non-neighbours are ignored. */
    static void connectPath(MapGenContext ctx, List<int[]> axial) {
        if (ctx == null || axial == null || axial.size() < 2) {
            return;
        }
        ensure(ctx);
        for (int i = 1; i < axial.size(); i++) {
            int[] a = axial.get(i - 1);
            int[] b = axial.get(i);
            connect(ctx, a[0], a[1], b[0], b[1]);
        }
    }

    static void connect(MapGenContext ctx, int q1, int r1, int q2, int r2) {
        int dir = direction(q2 - q1, r2 - r1);
        if (dir < 0) {
            return;
        }
        ensure(ctx);
        int c1 = HexCoords.colOf(q1, r1);
        int c2 = HexCoords.colOf(q2, r2);
        if (!inside(ctx, c1, r1) || !inside(ctx, c2, r2)) {
            return;
        }
        ctx.roadMask[r1][c1] |= 1 << dir;
        ctx.roadMask[r2][c2] |= 1 << ((dir + 3) % 6);
    }

    /** Drop every link into this hex, including the neighbour's reverse bit. */
    static void clear(MapGenContext ctx, int col, int row) {
        if (ctx.roadMask == null || !inside(ctx, col, row)) {
            return;
        }
        ctx.roadMask[row][col] = 0;
        int q = HexCoords.qOf(col, row);
        for (int dir = 0; dir < 6; dir++) {
            int[] d = HexCoords.AXIAL_NEIGHBORS[dir];
            int nr = row + d[1];
            int ncol = HexCoords.colOf(q + d[0], nr);
            if (!inside(ctx, ncol, nr)) {
                continue;
            }
            ctx.roadMask[nr][ncol] &= ~(1 << ((dir + 3) % 6));
        }
    }

    private static int direction(int dq, int dr) {
        for (int i = 0; i < HexCoords.AXIAL_NEIGHBORS.length; i++) {
            int[] d = HexCoords.AXIAL_NEIGHBORS[i];
            if (d[0] == dq && d[1] == dr) {
                return i;
            }
        }
        return -1;
    }

    private static boolean inside(MapGenContext ctx, int col, int row) {
        return col >= 0 && row >= 0 && col < ctx.width && row < ctx.height;
    }
}
