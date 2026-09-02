package com.heroesofyendor;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ReferenceCatalogController {

    private static final Set<String> COST_FIELDS = Set.of("cost", "destroy_cost");

    private final ReferenceData referenceData;
    private final ObjectMapper objectMapper;

    public ReferenceCatalogController(ReferenceData referenceData, ObjectMapper objectMapper) {
        this.referenceData = referenceData;
        this.objectMapper = objectMapper;
    }

    @GetMapping("/api/reference/catalog")
    public Map<String, List<Map<String, Object>>> catalog() {
        Map<String, Integer> resourceNameToId = resourceNameToId();
        Map<String, List<Map<String, Object>>> body = new LinkedHashMap<>();
        body.put("resource", decodeRows(referenceData.rows("resource"), resourceNameToId));
        body.put("town", decodeRows(referenceData.rows("town"), resourceNameToId));
        body.put("building", decodeRows(referenceData.rows("building"), resourceNameToId));
        body.put("unit", decodeRows(referenceData.rows("unit"), resourceNameToId));
        body.put("move_type", decodeRows(referenceData.rows("move_type"), resourceNameToId));
        body.put("hero_type", decodeRows(referenceData.rows("hero_type"), resourceNameToId));
        body.put("hero_pool", decodeRows(referenceData.rows("hero_pool"), resourceNameToId));
        body.put("town_layout", decodeRows(referenceData.rows("town_layout"), resourceNameToId));
        body.put("market", decodeRows(referenceData.rows("market"), resourceNameToId));
        body.put("ability", decodeRows(referenceData.rows("ability"), resourceNameToId));
        body.put("discipline", decodeRows(referenceData.rows("discipline"), resourceNameToId));
        body.put("ability_level", decodeRows(referenceData.rows("ability_level"), resourceNameToId));
        body.put("hero_discipline", decodeRows(referenceData.rows("hero_discipline"), resourceNameToId));
        body.put("difficulty", decodeRows(referenceData.rows("difficulty"), resourceNameToId));
        body.put("player_color", decodeRows(referenceData.rows("player_color"), resourceNameToId));
        body.put("terrain_type", decodeRows(referenceData.rows("terrain_type"), resourceNameToId));
        return body;
    }

    private Map<String, Integer> resourceNameToId() {
        Map<String, Integer> map = new LinkedHashMap<>();
        for (Map<String, Object> row : referenceData.rows("resource")) {
            Object id = row.get("id");
            Object name = row.get("name");
            if (id instanceof Number n && name != null) {
                map.put(name.toString(), n.intValue());
            }
        }
        return map;
    }

    private List<Map<String, Object>> decodeRows(
            List<Map<String, Object>> rows, Map<String, Integer> resourceNameToId) {
        List<Map<String, Object>> decoded = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> copy = new LinkedHashMap<>();
            for (Map.Entry<String, Object> entry : row.entrySet()) {
                Object value = decodeValue(entry.getValue());
                if (COST_FIELDS.contains(entry.getKey())) {
                    value = remapCostKeys(value, resourceNameToId);
                }
                copy.put(entry.getKey(), value);
            }
            decoded.add(copy);
        }
        return decoded;
    }

    private Object remapCostKeys(Object value, Map<String, Integer> resourceNameToId) {
        if (!(value instanceof Map<?, ?> raw)) {
            return value;
        }
        Map<String, Object> remapped = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : raw.entrySet()) {
            String key = String.valueOf(entry.getKey());
            Integer id = resourceNameToId.get(key);
            if (id == null) {
                try {
                    int parsed = Integer.parseInt(key);
                    if (resourceNameToId.containsValue(parsed)) {
                        id = parsed;
                    }
                } catch (NumberFormatException ignored) {
                    // Leave unknown keys out so callers never match on leftover names.
                }
            }
            if (id != null) {
                remapped.put(String.valueOf(id), entry.getValue());
            }
        }
        return remapped;
    }

    private Object decodeValue(Object value) {
        String json = jsonbText(value);
        if (json == null) {
            return value;
        }
        try {
            return objectMapper.readValue(json, Object.class);
        } catch (Exception ignored) {
            return value;
        }
    }

    /** JSONB arrives as PGobject (runtime-only driver) or a JSON string. */
    private static String jsonbText(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof String text) {
            String trimmed = text.trim();
            if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
                return text;
            }
            return null;
        }
        if (value instanceof Map || value instanceof List) {
            return null;
        }
        try {
            Object raw = value.getClass().getMethod("getValue").invoke(value);
            return raw instanceof String text ? text : null;
        } catch (ReflectiveOperationException ignored) {
            return null;
        }
    }
}
