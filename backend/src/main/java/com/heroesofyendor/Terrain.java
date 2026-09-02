package com.heroesofyendor;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** One row from {@code terrain_type}. World generation and tiles read this, not an enum. */
public final class Terrain {

    private final String name;
    private final Double moveCost;
    private final boolean blocked;

    private Terrain(String name, Double moveCost, boolean blocked) {
        this.name = name;
        this.moveCost = moveCost;
        this.blocked = blocked;
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
        return new Terrain(name, asDouble(row.get("move_cost")), asBool(row.get("is_blocked")));
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

    /** Barrier and Void stay in the table but are not painted onto new world maps. */
    public boolean inGenerationPool() {
        return !name.equalsIgnoreCase("Barrier") && !name.equalsIgnoreCase("Void");
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
        if (value instanceof Boolean b) {
            return b;
        }
        if (value instanceof Number n) {
            return n.intValue() != 0;
        }
        if (value == null) {
            return false;
        }
        String text = value.toString().trim();
        return text.equalsIgnoreCase("true") || text.equalsIgnoreCase("t") || text.equals("1");
    }
}
