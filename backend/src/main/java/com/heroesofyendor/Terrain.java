package com.heroesofyendor;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** One row from {@code terrain_type}. World generation and tiles read this, not an enum. */
public final class Terrain {

    private final String name;
    private final Double moveCost;
    private final boolean blocked;
    private final boolean randomEligible;

    private Terrain(String name, Double moveCost, boolean blocked, boolean randomEligible) {
        this.name = name;
        this.moveCost = moveCost;
        this.blocked = blocked;
        this.randomEligible = randomEligible;
    }

    public static List<Terrain> all(ReferenceData data) {
        List<Terrain> out = new ArrayList<>();
        for (Map<String, Object> row : data.rows("terrain_type")) {
            Terrain terrain = fromRow(row);
            if (terrain != null) {
                out.add(terrain);
            }
        }
        return List.copyOf(out);
    }

    public static List<Terrain> generationPool(ReferenceData data) {
        List<Terrain> pool = new ArrayList<>();
        for (Terrain terrain : all(data)) {
            if (terrain.inGenerationPool()) {
                pool.add(terrain);
            }
        }
        return List.copyOf(pool);
    }

    private static Terrain fromRow(Map<String, Object> row) {
        String name = text(row.get("name"));
        if (name.isEmpty()) {
            return null;
        }
        return new Terrain(
                name,
                asDouble(row.get("move_cost")),
                asBool(row.get("is_blocked")),
                asBool(row.get("random_eligible"), true));
    }

    public String label() {
        return name;
    }

    public Double movementCost() {
        return moveCost;
    }

    public boolean blocked() {
        return blocked;
    }

    public boolean isPassable() {
        return !blocked;
    }

    /** Random world/combat sampling: random_eligible and not move_cost 99 (Moat). */
    public boolean inGenerationPool() {
        if (!randomEligible) {
            return false;
        }
        return moveCost == null || moveCost.doubleValue() != 99.0;
    }

    private static String text(Object value) {
        return value == null ? "" : value.toString().trim();
    }

    private static Double asDouble(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Number n) {
            return n.doubleValue();
        }
        try {
            return Double.parseDouble(value.toString().trim());
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private static boolean asBool(Object value) {
        return asBool(value, false);
    }

    private static boolean asBool(Object value, boolean whenMissing) {
        if (value == null) {
            return whenMissing;
        }
        if (value instanceof Boolean b) {
            return b;
        }
        if (value instanceof Number n) {
            return n.intValue() != 0;
        }
        String text = value.toString().trim();
        if (text.isEmpty()) {
            return whenMissing;
        }
        return text.equalsIgnoreCase("true") || text.equalsIgnoreCase("t") || text.equals("1");
    }
}
