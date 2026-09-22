package com.heroesofyendor;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record TileData(
        int q,
        int r,
        String terrain,
        Double movementCostMultiplier,
        boolean blocked,
        /** Generation chunk id for continuous terrain texturing; null when unused. */
        Integer chunkId,
        /** Seeded world prop id from {@code prop} table; null when none. */
        Integer propId,
        /** 1-based variant index for {@code propFile}. */
        Integer propVariant,
        /** Base file name (no extension / variant suffix), e.g. {@code Oak_Tree}. */
        String propFile) {

    public TileData(
            int q, int r, String terrain, Double movementCostMultiplier, boolean blocked) {
        this(q, r, terrain, movementCostMultiplier, blocked, null, null, null, null);
    }

    public TileData(
            int q,
            int r,
            String terrain,
            Double movementCostMultiplier,
            boolean blocked,
            Integer chunkId) {
        this(q, r, terrain, movementCostMultiplier, blocked, chunkId, null, null, null);
    }
}
