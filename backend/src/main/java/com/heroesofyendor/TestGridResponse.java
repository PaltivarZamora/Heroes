package com.heroesofyendor;

import java.util.List;

public record TestGridResponse(
        int seed,
        List<TileData> tiles,
        List<MapObjectData> objects,
        /** Each entry is one town→endpoint branch as axial hex centers, for continuous stroke. */
        List<List<RoadPoint>> roads,
        /** Debug overlay of the planned chain before washout and orphan trim. Null when roads are off. */
        RoadPlan roadPlan) {

    public record RoadPoint(int q, int r) {}

    /** One town-to-town link, or a feature branch, before trimming. */
    public record RoadLink(String from, String to, List<RoadPoint> hexes, boolean branch) {}

    /** Planned links plus the hexes washout and orphan cleanup removed. */
    public record RoadPlan(List<RoadLink> links, List<RoadPoint> washed, List<RoadPoint> orphans) {}

    public TestGridResponse(
            int seed, List<TileData> tiles, List<MapObjectData> objects, List<List<RoadPoint>> roads) {
        this(seed, tiles, objects, roads, null);
    }

    /** Back-compat: empty road polylines. */
    public TestGridResponse(int seed, List<TileData> tiles, List<MapObjectData> objects) {
        this(seed, tiles, objects, List.of(), null);
    }
}
