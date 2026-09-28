package com.heroesofyendor;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Reads {@code map_config} (jsonb). Size-keyed objects use the current map size
 * name ({@code normal}/{@code large}/{@code giant}); plain values apply to all
 * sizes. Per-Normal counts are scaled by {@code size_scale[size]} and rounded.
 */
public final class MapConfig {

    private static final ObjectMapper JSON = new ObjectMapper();

    private MapConfig() {}

    /** Raw jsonb value for a key (decoded), or null. */
    public static Object raw(ReferenceData data, String key) {
        if (data == null || key == null) {
            return null;
        }
        for (Map<String, Object> row : data.rows("map_config")) {
            if (key.equals(stringVal(row, "key"))) {
                return decodeJsonb(row.get("value"));
            }
        }
        return null;
    }

    /** Decode resource/difficulty jsonb payloads (PGobject or JSON string). */
    public static Object decodeJsonb(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Map || value instanceof List || value instanceof Number || value instanceof Boolean) {
            return value;
        }
        String json = jsonbText(value);
        if (json == null) {
            return value;
        }
        try {
            return JSON.readValue(json, Object.class);
        } catch (Exception ignored) {
            return value;
        }
    }

    private static String jsonbText(Object value) {
        if (value instanceof String text) {
            String trimmed = text.trim();
            if (trimmed.startsWith("{")
                    || trimmed.startsWith("[")
                    || trimmed.startsWith("\"")
                    || Character.isDigit(trimmed.charAt(0))
                    || trimmed.equals("true")
                    || trimmed.equals("false")
                    || trimmed.equals("null")
                    || trimmed.startsWith("-")) {
                return text;
            }
            return null;
        }
        try {
            Object raw = value.getClass().getMethod("getValue").invoke(value);
            return raw instanceof String text ? text : null;
        } catch (ReflectiveOperationException ignored) {
            return null;
        }
    }

    /**
     * Size-aware lookup: if {@code value} is an object keyed by size name, return
     * that entry; otherwise return the plain value.
     */
    public static Object mapCfg(ReferenceData data, String key, String sizeName) {
        Object value = raw(data, key);
        if (!(value instanceof Map<?, ?> map) || sizeName == null || sizeName.isBlank()) {
            return value;
        }
        String want = sizeName.trim().toLowerCase(Locale.ROOT);
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            if (entry.getKey() == null) {
                continue;
            }
            if (want.equals(entry.getKey().toString().trim().toLowerCase(Locale.ROOT))) {
                return entry.getValue();
            }
        }
        return value;
    }

    public static String defaultSizeName(ReferenceData data) {
        Object raw = raw(data, "new_size");
        String name = asString(raw);
        if (name != null && !name.isBlank()) {
            return name.trim().toLowerCase(Locale.ROOT);
        }
        List<String> sizes = sizeNames(data);
        return sizes.isEmpty() ? "normal" : sizes.get(0);
    }

    public static List<String> sizeNames(ReferenceData data) {
        Object raw = raw(data, "sizes");
        List<String> out = new ArrayList<>();
        if (raw instanceof List<?> list) {
            for (Object entry : list) {
                if (entry == null) {
                    continue;
                }
                String name = entry.toString().trim().toLowerCase(Locale.ROOT);
                if (!name.isEmpty()) {
                    out.add(name);
                }
            }
        }
        if (out.isEmpty()) {
            out.add("normal");
            out.add("large");
            out.add("giant");
        }
        return List.copyOf(out);
    }

    public static double sizeScale(ReferenceData data, String sizeName) {
        Object v = mapCfg(data, "size_scale", sizeName);
        Double n = asDouble(v);
        return n != null && n > 0 ? n : 1.0;
    }

    public static int sizeDim(ReferenceData data, String sizeName) {
        Object v = mapCfg(data, "size_dims", sizeName);
        Integer n = asInt(v);
        if (n != null && n > 0) {
            return n;
        }
        // Fallbacks for missing data / legacy.
        String key = sizeName == null ? "" : sizeName.toLowerCase(Locale.ROOT);
        return switch (key) {
            case "large" -> 144;
            case "giant" -> 216;
            default -> 72;
        };
    }

    /** Round(normalCount × size_scale). */
    public static int scaledCount(ReferenceData data, String sizeName, double normalCount) {
        double scale = sizeScale(data, sizeName);
        return Math.max(0, (int) Math.round(normalCount * scale));
    }

    public static int scaledCfgInt(
            ReferenceData data, String key, String sizeName, int fallbackNormal) {
        Object v = mapCfg(data, key, sizeName);
        Double n = asDouble(v);
        double normal = n != null && Double.isFinite(n) ? n : fallbackNormal;
        return scaledCount(data, sizeName, normal);
    }

    public static int cfgInt(ReferenceData data, String key, String sizeName, int fallback) {
        Object v = mapCfg(data, key, sizeName);
        Integer n = asInt(v);
        return n != null ? n : fallback;
    }

    public static double cfgDouble(
            ReferenceData data, String key, String sizeName, double fallback) {
        Object v = mapCfg(data, key, sizeName);
        Double n = asDouble(v);
        return n != null ? n : fallback;
    }

    public static boolean cfgFlag(
            ReferenceData data, String key, String sizeName, boolean fallback) {
        Object v = mapCfg(data, key, sizeName);
        if (v == null) {
            return fallback;
        }
        if (v instanceof Boolean b) {
            return b;
        }
        if (v instanceof Number n) {
            return n.doubleValue() != 0;
        }
        String text = v.toString().trim().toLowerCase(Locale.ROOT);
        return text.equals("1")
                || text.equals("true")
                || text.equals("yes")
                || text.equals("on");
    }

    /** Random inclusive range from a [min,max] array for this size. */
    public static int[] cfgIntRange(
            ReferenceData data, String key, String sizeName, int fallbackMin, int fallbackMax) {
        Object v = mapCfg(data, key, sizeName);
        if (v instanceof List<?> list && list.size() >= 2) {
            Integer a = asInt(list.get(0));
            Integer b = asInt(list.get(1));
            if (a != null && b != null) {
                int lo = Math.min(a, b);
                int hi = Math.max(a, b);
                return new int[] {lo, hi};
            }
        }
        int lo = Math.min(fallbackMin, fallbackMax);
        int hi = Math.max(fallbackMin, fallbackMax);
        return new int[] {lo, hi};
    }

    /** Chest level → weight map (keys may be strings). */
    public static Map<Integer, Integer> chestMix(ReferenceData data) {
        Object v = raw(data, "chest_mix");
        Map<Integer, Integer> out = new LinkedHashMap<>();
        if (v instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                Integer level = asInt(entry.getKey());
                Integer weight = asInt(entry.getValue());
                if (level != null && weight != null && level > 0 && weight > 0) {
                    out.put(level, weight);
                }
            }
        }
        if (out.isEmpty()) {
            out.put(1, 60);
            out.put(2, 25);
            out.put(3, 10);
            out.put(4, 5);
        }
        return out;
    }

    public static Integer asInt(Object raw) {
        if (raw instanceof Number n) {
            double value = n.doubleValue();
            if (!Double.isFinite(value)) {
                return null;
            }
            return (int) Math.round(value);
        }
        if (raw == null) {
            return null;
        }
        try {
            double value = Double.parseDouble(raw.toString().trim());
            if (!Double.isFinite(value)) {
                return null;
            }
            return (int) Math.round(value);
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    public static Double asDouble(Object raw) {
        if (raw instanceof Number n) {
            double value = n.doubleValue();
            return Double.isFinite(value) ? value : null;
        }
        if (raw == null) {
            return null;
        }
        try {
            double value = Double.parseDouble(raw.toString().trim());
            return Double.isFinite(value) ? value : null;
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    public static String asString(Object raw) {
        if (raw == null) {
            return null;
        }
        if (raw instanceof String s) {
            String t = s.trim();
            // jsonb string may arrive quoted
            if (t.length() >= 2 && t.startsWith("\"") && t.endsWith("\"")) {
                return t.substring(1, t.length() - 1);
            }
            return t;
        }
        return raw.toString().trim();
    }

    private static String stringVal(Map<String, Object> row, String key) {
        Object raw = row.get(key);
        return raw == null ? "" : raw.toString().trim();
    }
}
