package com.heroesofyendor;

/**
 * One reserved 2×1 town footprint. {@code col}/{@code row} are the entry
 * (drawbridge) hex in odd-r offset coords. Unflipped, the keep is the hex to
 * the left ({@code col - 1}) and the spur leaves to the right. Flipped, the
 * entry is the left hex and the keep is {@code col + 1}. Starting towns are
 * listed first in generation order (one per player) for Notice Boards / hero spawn.
 */
record TownSite(
        int col,
        int row,
        String name,
        int townTypeId,
        boolean starting,
        /** Owning player index for own-type towns; {@code -1} for random-type. */
        int playerIndex,
        /** Drawbridge on the left, keep on the right. */
        boolean flipped) {

    TownSite(int col, int row, String name, int townTypeId, boolean starting, int playerIndex) {
        this(col, row, name, townTypeId, starting, playerIndex, false);
    }

    TownSite(int col, int row, String name, int townTypeId) {
        this(col, row, name, townTypeId, false, -1, false);
    }

    /** Keep hex column. Opposite the drawbridge. */
    int keepCol() {
        return flipped ? col + 1 : col - 1;
    }
}
