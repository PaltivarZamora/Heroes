package com.heroesofyendor;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ReferenceCatalogController {

    private final ReferenceData referenceData;
    private final ObjectMapper objectMapper;

    public ReferenceCatalogController(ReferenceData referenceData, ObjectMapper objectMapper) {
        this.referenceData = referenceData;
        this.objectMapper = objectMapper;
    }

    @GetMapping("/api/reference/catalog")
    public Map<String, List<Map<String, Object>>> catalog() {
        Map<String, List<Map<String, Object>>> body = new LinkedHashMap<>();
        body.put("building", decodeRows(referenceData.rows("building")));
        body.put("unit", decodeRows(referenceData.rows("unit")));
        body.put("hero_type", decodeRows(referenceData.rows("hero_type")));
        return body;
    }

    private List<Map<String, Object>> decodeRows(List<Map<String, Object>> rows) {
        List<Map<String, Object>> decoded = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> copy = new LinkedHashMap<>();
            for (Map.Entry<String, Object> entry : row.entrySet()) {
                copy.put(entry.getKey(), decodeValue(entry.getValue()));
            }
            decoded.add(copy);
        }
        return decoded;
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
