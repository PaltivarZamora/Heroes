package com.heroesofyendor;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Random;

/**
 * Mutable state shared across map-generation layers (BR S9-18).
 * Each layer gets its own {@link #rngFor(String)} sub-seed so edits to one
 * layer do not reshuffle another.
 */
final class MapGenContext {

    /** Max placement retries at a given rule before relaxing / skipping. */
    static final int LAYER_ATTEMPTS = 8;

    final int mapSeed;
    final ReferenceData data;
    final MapSize size;
    final int width;
    final int height;
    final Integer playersParam;
    final int[] playerTownTypes;

    HexTerrain[][] cells;
    int[][] chunkIds;
    /** Zone id per hex after the walls layer. 0 = unset. */
    int[][] zoneIds;
    /** Intentional wall-gap hexes (debug overlay). */
    boolean[][] wallGap;
    /** Neighbour zone ids for which this hex sits on a walled chunk edge. */
    java.util.Map<Integer, java.util.List<Integer>> wallBeside;
    /** Terrain ids that never receive a wall prop (`wall_no_terrain`). */
    java.util.Set<Integer> wallNoTerrain = java.util.Set.of();
    List<int[]> placeable = new ArrayList<>();
    boolean[][] townReserved;
    List<TownSite> townSites = new ArrayList<>();
    boolean[][] hasRoad;
    /** 6-bit edge mask per hex. Bit i links {@link HexCoords#AXIAL_NEIGHBORS}[i]. */
    int[][] roadMask;
    List<List<int[]>> roadPaths = new ArrayList<>();
    /**
     * Display-only copy of each chain link as routed, plus hexes later removed
     * by washout and orphan cleanup. Generation does not read these back.
     */
    List<RoadDebugLink> roadDebugLinks = new ArrayList<>();
    List<int[]> roadDebugWashed = new ArrayList<>();
    List<int[]> roadDebugOrphans = new ArrayList<>();
    List<WorldProps.PropDef> propDefs = List.of();
    WorldProps.Seed[][] propSeeds;
    boolean[][] propBlocked;
    List<MapObjectData> objects = new ArrayList<>();
    /** Layer-5 rules, loaded when features start. */
    FeatureRules featureRules;
    /** Treasure pockets carved with the walls (BR S9-23). */
    List<Pockets.Pocket> pockets = new ArrayList<>();
    /** Interior, ring, and entrance. Roads and outside features stay out. */
    boolean[][] pocketSeal;
    boolean[][] pocketInterior;
    boolean[][] pocketRing;
    boolean[][] pocketEntrance;
    int[][] pocketIds;
    int[][] pocketTiers;
    /** Skip reasons from pocket carving, for the report. */
    List<String> pocketSkips = new ArrayList<>();
    int pocketEligible;
    /** Layer-1 water, lakes, and islands (BR S9-24). */
    boolean waterRolled;
    List<WaterTerrain.Lake> lakes = new ArrayList<>();
    List<WaterTerrain.Island> islands = new ArrayList<>();
    boolean[][] islandHex;
    int[][] islandIds;
    int[][] islandGuardTier;
    int[][] lakeIds;
    int terrainBuffers;
    TestGrid.MapPlaceConfig cfg;
    TestGrid.TownNameSession names;

    /** One chain link's planned hexes (axial), before washout and orphan trim. */
    static final class RoadDebugLink {
        final String from;
        final String to;
        final List<int[]> hexes;
        /** Feature branch, not an interstate link. Display only. */
        final boolean branch;

        RoadDebugLink(String from, String to, List<int[]> hexes) {
            this(from, to, hexes, false);
        }

        RoadDebugLink(String from, String to, List<int[]> hexes, boolean branch) {
            this.from = from;
            this.to = to;
            this.hexes = hexes;
            this.branch = branch;
        }
    }

    MapGenContext(
            int mapSeed,
            ReferenceData data,
            MapSize size,
            Integer playersParam,
            int[] playerTownTypes) {
        this.mapSeed = mapSeed;
        this.data = data;
        this.size = size;
        this.width = size.width();
        this.height = size.height();
        this.playersParam = playersParam;
        this.playerTownTypes = playerTownTypes != null ? playerTownTypes : new int[0];
    }

    /** Deterministic sub-RNG for a named layer (seed ⊕ layer). */
    Random rngFor(String layerName) {
        long mix =
                ((long) mapSeed << 32)
                        ^ (Integer.toUnsignedLong(Objects.hashCode(layerName))
                                * 0x9E3779B97F4A7C15L);
        return new Random(mix);
    }

    String sizeName() {
        return size.name();
    }
}
