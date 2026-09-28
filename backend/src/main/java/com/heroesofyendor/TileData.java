package com.heroesofyendor;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

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
        String propFile,
        /** Auto-generated road overlay; does not replace {@code terrain}. */
        Boolean hasRoad,
        /** 6-bit neighbour mask. Bit i links axial neighbour i. Null when this hex has no road. */
        Integer roadMask,
        /** Zone id from the walls layer; null when unset. */
        Integer zoneId,
        /** Intentional passage in a zone wall (debug overlay). */
        Boolean wallGap,
        /**
         * Neighbour zone ids for which this hex lies on a walled chunk edge.
         * Null when this hex is not on a walled edge.
         */
        List<Integer> wallBorders,
        /** Treasure pocket id; null when this hex is not part of a pocket. */
        Integer pocketId,
        /** Pocket guard tier (T4–T6). Set on every hex of that pocket. */
        Integer pocketTier,
        /** The one open hex of a pocket. The guard stands here. */
        Boolean pocketEntrance,
        /** Island landing guard tier. Null when this hex has no island guard. */
        Integer islandGuardTier,
        /** Horizontal mirror for world props when {@code prop.flippable}. */
        Boolean propFlipped,
        /** Visual scale from {@code prop.render_scale} (blocking unchanged). */
        Double propRenderScale) {

    public TileData(
            int q, int r, String terrain, Double movementCostMultiplier, boolean blocked) {
        this(
                q,
                r,
                terrain,
                movementCostMultiplier,
                blocked,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null);
    }

    public TileData(
            int q,
            int r,
            String terrain,
            Double movementCostMultiplier,
            boolean blocked,
            Integer chunkId) {
        this(
                q,
                r,
                terrain,
                movementCostMultiplier,
                blocked,
                chunkId,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null);
    }
}
