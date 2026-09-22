package com.heroesofyendor;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * One row from the {@code terrain} table (hex / wedge system).
 * World generation and wedge rendering read this table.
 */
public final class HexTerrain {

    private final int id;
    private final String name;
    private final int zOrder;
    private final boolean blocker;
    private final boolean seedable;
    private final String color;
    private final String imagePath;
    private final Double moveCost;

    private HexTerrain(
            int id,
            String name,
            int zOrder,
            boolean blocker,
            boolean seedable,
            String color,
            String imagePath,
            Double moveCost) {
        this.id = id;
        this.name = name;
        this.zOrder = zOrder;
        this.blocker = blocker;
        this.seedable = seedable;
        this.color = color;
        this.imagePath = imagePath;
        this.moveCost = moveCost;
    }

    public static List<HexTerrain> all(ReferenceData data) {
        List<HexTerrain> out = new ArrayList<>();
        for (Map<String, Object> row : data.rows("terrain")) {
            HexTerrain terrain = fromRow(row);
            if (terrain != null) {
                out.add(terrain);
            }
        }
        return List.copyOf(out);
    }

    /** Chunk generation pool — {@code is_seedable = true} only. */
    public static List<HexTerrain> seedablePool(ReferenceData data) {
        List<HexTerrain> pool = new ArrayList<>();
        for (HexTerrain terrain : all(data)) {
            if (terrain.seedable) {
                pool.add(terrain);
            }
        }
        return List.copyOf(pool);
    }

    private static HexTerrain fromRow(Map<String, Object> row) {
        String name = text(row.get("name"));
        if (name.isEmpty()) {
            return null;
        }
        Integer id = asInt(row.get("id"));
        Integer z = asInt(row.get("z_order"));
        if (id == null || z == null) {
            return null;
        }
        return new HexTerrain(
                id,
                name,
                z,
                asBool(row.get("is_blocker"), false),
                asBool(row.get("is_seedable"), true),
                text(row.get("color")),
                text(row.get("image_path")),
                asDouble(row.get("move_cost")));
    }

    public int id() {
        return id;
    }

    public String label() {
        return name;
    }

    public int zOrder() {
        return zOrder;
    }

    public String color() {
        return color;
    }

    public String imagePath() {
        return imagePath;
    }

    public Double movementCost() {
        return moveCost;
    }

    public boolean blocked() {
        return blocker || moveCost == null;
    }

    public boolean isPassable() {
        return !blocked();
    }

    public boolean seedable() {
        return seedable;
    }

    private static String text(Object value) {
        return value == null ? "" : value.toString().trim();
    }

    private static Integer asInt(Object value) {
        if (value instanceof Number n) {
            return n.intValue();
        }
        if (value == null) {
            return null;
        }
        try {
            return Integer.parseInt(value.toString().trim());
        } catch (NumberFormatException ignored) {
            return null;
        }
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
