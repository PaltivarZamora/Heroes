package com.heroesofyendor;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * World prop definitions from the {@code prop} table and per-hex seeding.
 *
 * {@code terrain_rules} is a map of {@code terrain.id → density} (0..1 chance).
 * At most one prop is placed per hex. Blocking props mark the hex impassable
 * so later feature / mob placement skips them.
 */
final class WorldProps {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final TypeReference<Map<String, Object>> MAP_TYPE =
            new TypeReference<>() {};

    record PropDef(
            int id,
            String fileName,
            int variantCount,
            boolean blocker,
            Map<Integer, Double> terrainRules) {}

    record Seed(int propId, int variant, String fileName, boolean blocker) {}

    private WorldProps() {}

    static List<PropDef> all(ReferenceData data) {
        List<PropDef> out = new ArrayList<>();
        for (Map<String, Object> row : data.rows("prop")) {
            PropDef def = fromRow(row);
            if (def != null) {
                out.add(def);
            }
        }
        return List.copyOf(out);
    }

    /**
     * Roll eligible props for this base terrain. Independent density rolls; if
     * several hit, one is chosen at random. Returns null when none place.
     */
    static Seed roll(HexTerrain terrain, List<PropDef> props, Random rng) {
        if (terrain == null || props.isEmpty()) {
            return null;
        }
        int terrainId = terrain.id();
        List<PropDef> hits = new ArrayList<>();
        for (PropDef prop : props) {
            Double density = prop.terrainRules().get(terrainId);
            if (density == null || !(density > 0)) {
                continue;
            }
            // Accept 0..1 fractions or whole-number percents (e.g. 10 → 10%).
            double chance = density > 1.0 ? density / 100.0 : density;
            chance = Math.min(1.0, Math.max(0.0, chance));
            if (rng.nextDouble() < chance) {
                hits.add(prop);
            }
        }
        if (hits.isEmpty()) {
            return null;
        }
        PropDef pick = hits.get(rng.nextInt(hits.size()));
        // Equal weight across all variants (not terrain's skewed table).
        int variants = Math.max(1, pick.variantCount());
        int variant = rng.nextInt(variants) + 1;
        return new Seed(pick.id(), variant, pick.fileName(), pick.blocker());
    }

    private static PropDef fromRow(Map<String, Object> row) {
        Integer id = asInt(row.get("id"));
        String fileName = text(row.get("file_name"));
        if (fileName.isEmpty()) {
            fileName = text(row.get("filename"));
        }
        if (fileName.isEmpty()) {
            fileName = text(row.get("image_path"));
        }
        if (id == null || fileName.isEmpty()) {
            return null;
        }
        // Strip accidental extension / path so frontend can append variants.
        fileName = fileName.replace('\\', '/');
        int slash = fileName.lastIndexOf('/');
        if (slash >= 0) {
            fileName = fileName.substring(slash + 1);
        }
        if (fileName.toLowerCase().endsWith(".png")) {
            fileName = fileName.substring(0, fileName.length() - 4);
        }
        int variantCount = Math.max(1, asInt(row.get("variant_count"), 1));
        boolean blocker = asBool(row.get("is_blocker"), false);
        Map<Integer, Double> rules = parseTerrainRules(row.get("terrain_rules"));
        if (rules.isEmpty()) {
            return null;
        }
        return new PropDef(id, fileName, variantCount, blocker, rules);
    }

    private static Map<Integer, Double> parseTerrainRules(Object raw) {
        Object value = raw;
        if (value != null && !(value instanceof Map<?, ?>) && !(value instanceof String)) {
            // JDBC jsonb often arrives as PGobject — use its string form.
            value = value.toString();
        }
        if (value instanceof String s) {
            String trimmed = s.trim();
            if (trimmed.isEmpty()) {
                return Map.of();
            }
            try {
                value = JSON.readValue(trimmed, MAP_TYPE);
            } catch (Exception ignored) {
                return Map.of();
            }
        }
        if (!(value instanceof Map<?, ?> map) || map.isEmpty()) {
            return Map.of();
        }
        Map<Integer, Double> out = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            Integer terrainId = asInt(entry.getKey());
            Double density = asDouble(entry.getValue());
            if (terrainId == null || terrainId <= 0 || density == null) {
                continue;
            }
            if (!(density > 0)) {
                continue;
            }
            out.put(terrainId, density);
        }
        return Collections.unmodifiableMap(out);
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

    private static int asInt(Object value, int whenMissing) {
        Integer n = asInt(value);
        return n == null ? whenMissing : n;
    }

    private static Double asDouble(Object value) {
        if (value instanceof Number n) {
            return n.doubleValue();
        }
        if (value == null) {
            return null;
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
