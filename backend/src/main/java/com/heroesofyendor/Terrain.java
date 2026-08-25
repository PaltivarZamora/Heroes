package com.heroesofyendor;

/**
 * Adventure-map terrain. {@code movementCost} {@code null} means impassable.
 */
public enum Terrain {
    STONE_PATH("Stone Path", 0.9),
    DIRT_PATH("Dirt Path", 1.0),
    GRASS("Grass", 1.1),
    ASH("Ash", 1.25),
    ROCKY("Rocky", 1.5),
    LAVA("Lava", 1.75),
    DESERT("Desert", 2.0),
    SNOW("Snow", 2.0),
    MUD("Mud", 2.0),
    SWAMP("Swamp", 2.5),
    SHALLOWS("Shallows", 2.5),
    FOREST("Forest", null),
    MOUNTAIN("Mountain", null),
    WATER("Water", null),
    BARRIER("Barrier", null),
    VOID("Void", null);

    private final String label;
    private final Double movementCost;

    Terrain(String label, Double movementCost) {
        this.label = label;
        this.movementCost = movementCost;
    }

    public String label() {
        return label;
    }

    public Double movementCost() {
        return movementCost;
    }

    public boolean isPassable() {
        return movementCost != null;
    }

    /** Barrier and Void stay in the enum but are not painted onto new maps for now. */
    public boolean inGenerationPool() {
        return this != BARRIER && this != VOID;
    }
}
