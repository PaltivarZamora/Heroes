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
            boolean flippable,
            double renderScale,
            Map<Integer, Double> terrainRules) {}

    record Seed(
            int propId,
            int variant,
            String fileName,
            boolean blocker,
            boolean flipped,
            double renderScale) {

        Seed(int propId, int variant, String fileName, boolean blocker) {
            this(propId, variant, fileName, blocker, false, 1.0);
        }

        Seed(int propId, int variant, String fileName, boolean blocker, boolean flipped) {
            this(propId, variant, fileName, blocker, flipped, 1.0);
        }
    }

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
        return roll(terrain, props, rng, 1.0);
    }

    /**
     * @param densityMult {@code map_config.prop_density_mult}; chance is capped at 1
     */
    static Seed roll(HexTerrain terrain, List<PropDef> props, Random rng, double densityMult) {
        if (terrain == null || props.isEmpty()) {
            return null;
        }
        double mult = densityMult > 0 ? densityMult : 1.0;
        int terrainId = terrain.id();
        List<PropDef> hits = new ArrayList<>();
        for (PropDef prop : props) {
            Double density = prop.terrainRules().get(terrainId);
            if (density == null || !(density > 0)) {
                continue;
            }
            // Accept 0..1 fractions or whole-number percents (e.g. 10 → 10%).
            double chance = density > 1.0 ? density / 100.0 : density;
            chance = Math.min(1.0, Math.max(0.0, chance * mult));
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
        return new Seed(
                pick.id(), variant, pick.fileName(), pick.blocker(), false, pick.renderScale());
    }

    static boolean isFlippable(List<PropDef> defs, int propId) {
        for (PropDef def : defs) {
            if (def.id() == propId) {
                return def.flippable();
            }
        }
        return false;
    }

    /** Flip roll uses its own sub-seed so scatter RNG order stays unchanged. */
    static Seed withPlacementFlip(
            MapGenContext ctx, int col, int row, Seed seed, List<PropDef> defs) {
        if (seed == null || !isFlippable(defs, seed.propId())) {
            return seed;
        }
        boolean flipped = ctx.rngFor("prop-flip:" + col + "," + row).nextBoolean();
        return new Seed(
                seed.propId(),
                seed.variant(),
                seed.fileName(),
                seed.blocker(),
                flipped,
                seed.renderScale());
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
        boolean flippable = asBool(row.get("flippable"), true);
        boolean navalOnly = parseFlag(row.get("terrain_rules"), "naval_only");
        boolean wall = parseFlag(row.get("terrain_rules"), "wall");
        Map<Integer, Double> rules = parseTerrainRules(row.get("terrain_rules"));
        if (navalOnly || wall) {
            // Naval-only: combat naval layout. wall:true: Walls layer only.
            return null;
        }
        if (rules.isEmpty()) {
            return null;
        }
        return new PropDef(
                id, fileName, variantCount, blocker, flippable, readRenderScale(row), rules);
    }

    static double readRenderScale(Map<String, Object> row) {
        Double scale = MapConfig.asDouble(row.get("render_scale"));
        return scale != null && scale > 0 ? scale : 1.0;
    }

    /** Wall-type props ({@code terrain_rules.wall = true}), lowest id first. */
    static List<WallProp> walls(ReferenceData data) {
        List<WallProp> out = new ArrayList<>();
        if (data == null) {
            return out;
        }
        for (Map<String, Object> row : data.rows("prop")) {
            if (!parseFlag(row.get("terrain_rules"), "wall")) {
                continue;
            }
            Integer id = asInt(row.get("id"));
            String fileName = text(row.get("file_name"));
            if (fileName.isEmpty()) {
                fileName = text(row.get("filename"));
            }
            if (fileName.isEmpty()) {
                fileName = text(row.get("image_path"));
            }
            if (id == null || fileName.isEmpty()) {
                continue;
            }
            fileName = fileName.replace('\\', '/');
            int slash = fileName.lastIndexOf('/');
            if (slash >= 0) {
                fileName = fileName.substring(slash + 1);
            }
            if (fileName.toLowerCase().endsWith(".png")) {
                fileName = fileName.substring(0, fileName.length() - 4);
            }
            String name = text(row.get("name"));
            fileName = wallArtFile(name, fileName);
            out.add(
                    new WallProp(
                            id,
                            name,
                            fileName,
                            Math.max(1, asInt(row.get("variant_count"), 1)),
                            asBool(row.get("is_blocker"), true),
                            readRenderScale(row),
                            parseTerrainList(row.get("terrain_rules"))));
        }
        out.sort((a, b) -> Integer.compare(a.id(), b.id()));
        return out;
    }

    /**
     * Catalog rows still store the placeholder {@code Wall.png}. Named uploads
     * replace that placeholder; a specific {@code image_path} is left alone.
     * Dead Trees has no named file yet, so it keeps {@code Wall}.
     */
    private static String wallArtFile(String name, String fileName) {
        if (fileName == null || !fileName.equalsIgnoreCase("Wall")) {
            return fileName;
        }
        String n = name == null ? "" : name.trim().toLowerCase();
        return switch (n) {
            case "wall oak forest" -> "Wall_Oaks";
            case "wall pine forest" -> "Wall_Snowcaps";
            case "wall mountains" -> "Wall_Mountains";
            case "wall volcanic rock" -> "Wall_Volcanic";
            case "wall mesa" -> "Wall_Mesa";
            case "wall cave rock" -> "Wall_Cave";
            default -> fileName;
        };
    }

    record WallProp(
            int id,
            String name,
            String fileName,
            int variantCount,
            boolean blocker,
            double renderScale,
            List<Integer> terrains) {}

    private static boolean parseFlag(Object raw, String flagName) {
        Map<?, ?> map = asRulesMap(raw);
        if (map == null) {
            return false;
        }
        Object flag = map.get(flagName);
        if (flag instanceof Boolean b) {
            return b;
        }
        if (flag instanceof Number n) {
            return n.intValue() != 0;
        }
        if (flag != null) {
            String t = flag.toString().trim();
            return "true".equalsIgnoreCase(t) || "1".equals(t);
        }
        return false;
    }

    private static Map<?, ?> asRulesMap(Object raw) {
        Object value = raw;
        if (value != null && !(value instanceof Map<?, ?>) && !(value instanceof String)) {
            value = value.toString();
        }
        if (value instanceof String s) {
            String trimmed = s.trim();
            if (trimmed.isEmpty()) {
                return null;
            }
            try {
                value = JSON.readValue(trimmed, MAP_TYPE);
            } catch (Exception ignored) {
                return null;
            }
        }
        return value instanceof Map<?, ?> map ? map : null;
    }

    private static List<Integer> parseTerrainList(Object raw) {
        Map<?, ?> map = asRulesMap(raw);
        if (map == null) {
            return List.of();
        }
        Object terrains = map.get("terrains");
        if (!(terrains instanceof List<?> list)) {
            return List.of();
        }
        List<Integer> out = new ArrayList<>();
        for (Object item : list) {
            Integer id = asInt(item);
            if (id != null && id > 0) {
                out.add(id);
            }
        }
        return List.copyOf(out);
    }

    private static Map<Integer, Double> parseTerrainRules(Object raw) {
        Map<?, ?> map = asRulesMap(raw);
        if (map == null || map.isEmpty()) {
            return Map.of();
        }
        Map<Integer, Double> out = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            String key = String.valueOf(entry.getKey());
            if ("naval_only".equals(key) || "wall".equals(key) || "terrains".equals(key)) {
                continue;
            }
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
