package com.heroesofyendor;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;

/** `town.enabled` — disabled towns stay in reference data but are excluded from play. */
final class TownEnablement {

    private TownEnablement() {}

    static boolean isEnabled(Map<String, Object> row) {
        if (row == null) {
            return true;
        }
        Object raw = row.get("enabled");
        if (raw instanceof Boolean) {
            return (Boolean) raw;
        }
        if (raw instanceof Number) {
            return ((Number) raw).intValue() != 0;
        }
        if (raw instanceof String) {
            String s = ((String) raw).trim().toLowerCase();
            if (s.isEmpty()) {
                return true;
            }
            return !("false".equals(s) || "0".equals(s) || "f".equals(s));
        }
        return true;
    }

    static List<Integer> enabledTownTypeIds(ReferenceData data) {
        List<Integer> ids = new ArrayList<>();
        for (Map<String, Object> row : data.rows("town")) {
            if (!isEnabled(row)) {
                continue;
            }
            Integer id = intId(row, "id");
            if (id != null && id > 0) {
                ids.add(id);
            }
        }
        return ids;
    }

    static int pickRandomEnabledTownType(ReferenceData data, Random rng) {
        List<Integer> ids = enabledTownTypeIds(data);
        if (ids.isEmpty()) {
            return TestGrid.START_TOWN_TYPE_ID;
        }
        return ids.get(rng.nextInt(ids.size()));
    }

    private static Integer intId(Map<String, Object> row, String key) {
        Object raw = row.get(key);
        if (raw instanceof Number) {
            return ((Number) raw).intValue();
        }
        return null;
    }
}
