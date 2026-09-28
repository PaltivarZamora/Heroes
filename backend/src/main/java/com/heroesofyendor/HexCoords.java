package com.heroesofyendor;

/** Shared pointy-top odd-r axial helpers for map generation. */
final class HexCoords {

    static final int[][] AXIAL_NEIGHBORS = {
        {1, 0}, {1, -1}, {0, -1}, {-1, 0}, {-1, 1}, {0, 1},
    };

    private HexCoords() {}

    /** Odd-r offset: axial q from column. */
    static int offsetFromZero(int row) {
        return row / 2;
    }

    static int colOf(int q, int r) {
        return q + offsetFromZero(r);
    }

    static int qOf(int col, int row) {
        return col - offsetFromZero(row);
    }

    static int hexDistance(int aq, int ar, int bq, int br) {
        int dq = aq - bq;
        int dr = ar - br;
        return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
    }

    static String key(int q, int r) {
        return q + "," + r;
    }

    static String colRowKey(int col, int row) {
        return col + "," + row;
    }
}
