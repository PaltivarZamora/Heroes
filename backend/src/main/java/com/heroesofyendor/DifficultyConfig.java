package com.heroesofyendor;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Per-game difficulty: `payload.overrides` for map generation and tuning. */
final class DifficultyConfig {

    private static final Logger log = LoggerFactory.getLogger(DifficultyConfig.class);

    private static final ThreadLocal<Map<String, Object>> MAP_OVERRIDES = new ThreadLocal<>();

    private DifficultyConfig() {}

    static Map<String, Object> mapOverrides() {
        Map<String, Object> map = MAP_OVERRIDES.get();
        return map == null ? Map.of() : map;
    }

    static void pushMapOverrides(ReferenceData data, Integer difficultyId) {
        MAP_OVERRIDES.set(loadMapConfigOverrides(data, normalizeDifficultyId(difficultyId)));
    }

    static void popMapOverrides() {
        MAP_OVERRIDES.remove();
    }

    static int normalizeDifficultyId(Integer difficultyId) {
        if (difficultyId != null && difficultyId > 0) {
            return difficultyId;
        }
        return 2;
    }

    static Map<String, Object> loadMapConfigOverrides(ReferenceData data, int difficultyId) {
        return overridesSection(data, difficultyId, "map_config");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> overridesSection(
            ReferenceData data, int difficultyId, String section) {
        Object payload = difficultyPayload(data, difficultyId);
        if (!(payload instanceof Map<?, ?> map)) {
            return Map.of();
        }
        Object overrides = map.get("overrides");
        if (!(overrides instanceof Map<?, ?> sections)) {
            return Map.of();
        }
        for (Map.Entry<?, ?> entry : sections.entrySet()) {
            String name = String.valueOf(entry.getKey());
            if (!isAllowedSection(name)) {
                log.warn(
                        "difficulty {}: ignoring unknown override section \"{}\"",
                        difficultyId,
                        name);
            }
        }
        Object sectionRaw = sections.get(section);
        if (!(sectionRaw instanceof Map<?, ?> keys)) {
            return Map.of();
        }
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : keys.entrySet()) {
            String key = String.valueOf(entry.getKey()).trim();
            if (!key.isEmpty()) {
                out.put(key, entry.getValue());
            }
        }
        return out;
    }

    private static boolean isAllowedSection(String section) {
        return section.equals("map_config")
                || section.equals("ai_config")
                || section.equals("combat_config")
                || section.equals("app_config");
    }

    private static Object difficultyPayload(ReferenceData data, int difficultyId) {
        for (Map<String, Object> row : data.rows("difficulty")) {
            Object id = row.get("id");
            if (id instanceof Number n && n.intValue() == difficultyId) {
                return MapConfig.decodeJsonb(row.get("payload"));
            }
        }
        return null;
    }
}
