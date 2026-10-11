package com.heroesofyendor;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Deterministic item generator (BR S9-40). Caller supplies the {@link Random};
 * never seeds internally.
 */
@Service
public class ItemRoller {

    private static final Logger log = LoggerFactory.getLogger(ItemRoller.class);
    private static final int ITEM_KIND_SLOT = 1;
    private static final Set<String> warned = ConcurrentHashMap.newKeySet();

    private final ReferenceData referenceData;
    private final ObjectMapper objectMapper;

    public ItemRoller(ReferenceData referenceData, ObjectMapper objectMapper) {
        this.referenceData = referenceData;
        this.objectMapper = objectMapper;
    }

    public record StatLine(int statId, int amt) {}

    public record RolledItem(
            int itemId,
            int rarityId,
            Integer adjId,
            int variation,
            List<StatLine> stats) {}

    public List<RolledItem> rollMany(Random rng, int count, Integer forcedRarityId) {
        int n = Math.max(0, Math.min(count, 500));
        List<RolledItem> out = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            out.add(rollOne(rng, forcedRarityId));
        }
        return out;
    }

    public RolledItem rollOne(Random rng, Integer forcedRarityId) {
        List<Map<String, Object>> rarities = referenceData.rows("rarity");
        List<Map<String, Object>> itemTypes = referenceData.rows("item_type");
        List<Map<String, Object>> items = referenceData.rows("item");
        List<Map<String, Object>> adjs = referenceData.rows("item_adj");
        List<Map<String, Object>> stats = referenceData.rows("stat");

        int rarityId =
                forcedRarityId != null
                        ? forcedRarityId
                        : weightedRarityId(rng, rarities);
        int points = rarityId;

        List<Map<String, Object>> slots =
                itemTypes.stream()
                        .filter(row -> asInt(row.get("kind_id")) == ITEM_KIND_SLOT)
                        .toList();
        if (slots.isEmpty()) {
            throw new IllegalStateException("No item_type slot rows (kind_id=1)");
        }
        Map<String, Object> slotRow = slots.get(rng.nextInt(slots.size()));
        int slotTypeId = asInt(slotRow.get("id"));
        List<Integer> statTags = parseIntList(slotRow.get("stat_tags"));

        StatRollResult rolled = rollStatLines(rng, points, statTags, stats);
        List<StatLine> storedStats = rolled.lines;
        int primaryStatId = rolled.primaryStatId;

        List<Map<String, Object>> candidates =
                items.stream()
                        .filter(row -> asInt(row.get("slot_type_id")) == slotTypeId)
                        .toList();
        candidates = filterByWeaponCategory(candidates, primaryStatId);
        if (candidates.isEmpty()) {
            throw new IllegalStateException(
                    "No item candidates for slot_type_id=" + slotTypeId);
        }
        Map<String, Object> itemRow = candidates.get(rng.nextInt(candidates.size()));
        int itemId = asInt(itemRow.get("id"));
        int variations = Math.max(1, asInt(itemRow.get("variations")));
        int variation = 1 + rng.nextInt(variations);

        Integer adjId = pickAdj(rng, adjs, itemRow);

        return new RolledItem(itemId, rarityId, adjId, variation, storedStats);
    }

    private int weightedRarityId(Random rng, List<Map<String, Object>> rarities) {
        int total = 0;
        for (Map<String, Object> row : rarities) {
            total += Math.max(0, asInt(row.get("weight")));
        }
        if (total <= 0) {
            return 1;
        }
        int roll = rng.nextInt(total);
        int acc = 0;
        for (Map<String, Object> row : rarities) {
            acc += Math.max(0, asInt(row.get("weight")));
            if (roll < acc) {
                return asInt(row.get("id"));
            }
        }
        return asInt(rarities.get(rarities.size() - 1).get("id"));
    }

    private record StatRollResult(int primaryStatId, List<StatLine> lines) {}

    private StatRollResult rollStatLines(
            Random rng, int points, List<Integer> statTags, List<Map<String, Object>> statRows) {
        if (statTags.isEmpty()) {
            return new StatRollResult(1, List.of());
        }
        record Line(int statId, int total, int firstOrder) {}
        Map<Integer, Line> lines = new LinkedHashMap<>();
        int order = 0;
        for (int i = 0; i < points; i++) {
            int pick = statTags.get(rng.nextInt(statTags.size()));
            Line line = lines.get(pick);
            if (line == null) {
                lines.put(pick, new Line(pick, 1, order++));
            } else {
                lines.put(pick, new Line(pick, line.total + 1, line.firstOrder));
            }
        }
        List<Line> sorted =
                lines.values().stream()
                        .sorted(
                                Comparator.comparingInt(Line::total)
                                        .reversed()
                                        .thenComparingInt(Line::firstOrder))
                        .toList();

        int primaryStatId = sorted.isEmpty() ? statTags.get(0) : sorted.get(0).statId;

        List<StatLine> out = new ArrayList<>();
        for (Line line : sorted) {
            Map<String, Object> statRow =
                    statRows.stream()
                            .filter(r -> asInt(r.get("id")) == line.statId)
                            .findFirst()
                            .orElse(null);
            List<Integer> members = groupMemberIds(statRow);
            if (!members.isEmpty()) {
                for (int memberId : members) {
                    out.add(new StatLine(memberId, line.total));
                }
            } else {
                out.add(new StatLine(line.statId, line.total));
            }
        }
        return new StatRollResult(primaryStatId, out);
    }

    private List<Integer> groupMemberIds(Map<String, Object> statRow) {
        if (statRow == null) {
            return List.of();
        }
        return parseIntList(statRow.get("tags"));
    }

    private List<Map<String, Object>> filterByWeaponCategory(
            List<Map<String, Object>> candidates, int primaryStatId) {
        Map<Integer, Integer> weaponMap = weaponCategoryByStat();
        Integer catId = weaponMap.get(primaryStatId);
        if (catId == null) {
            return candidates;
        }
        List<Map<String, Object>> filtered =
                candidates.stream()
                        .filter(row -> Objects.equals(asInt(row.get("cat_type_id")), catId))
                        .toList();
        return filtered.isEmpty() ? candidates : filtered;
    }

    private Map<Integer, Integer> weaponCategoryByStat() {
        for (Map<String, Object> row : referenceData.rows("app_config")) {
            if (!"item_weapon_category_by_stat".equals(String.valueOf(row.get("key")))) {
                continue;
            }
            Object value = row.get("value");
            String json = value == null ? null : String.valueOf(value);
            if (json == null || json.isBlank()) {
                warnOnce("item_weapon_category_by_stat empty");
                return Map.of();
            }
            try {
                Map<String, Integer> raw =
                        objectMapper.readValue(
                                json, new TypeReference<Map<String, Integer>>() {});
                Map<Integer, Integer> out = new LinkedHashMap<>();
                for (Map.Entry<String, Integer> e : raw.entrySet()) {
                    out.put(Integer.parseInt(e.getKey()), e.getValue());
                }
                return out;
            } catch (Exception e) {
                warnOnce("item_weapon_category_by_stat parse: " + e.getMessage());
                return Map.of();
            }
        }
        warnOnce("item_weapon_category_by_stat missing");
        return Map.of();
    }

    private Integer pickAdj(Random rng, List<Map<String, Object>> adjs, Map<String, Object> item) {
        int slotId = asInt(item.get("slot_type_id"));
        int catId = asInt(item.get("cat_type_id"));
        Integer subCat = optionalInt(item.get("sub_cat_type_id"));
        List<Map<String, Object>> fits = new ArrayList<>();
        for (Map<String, Object> adj : adjs) {
            List<Integer> tags = parseIntList(adj.get("tags"));
            if (tags.isEmpty()) {
                fits.add(adj);
                continue;
            }
            if (tags.contains(slotId) || tags.contains(catId)) {
                fits.add(adj);
                continue;
            }
            if (subCat != null && tags.contains(subCat)) {
                fits.add(adj);
            }
        }
        if (fits.isEmpty()) {
            return null;
        }
        return asInt(fits.get(rng.nextInt(fits.size())).get("id"));
    }

    private List<Integer> parseIntList(Object raw) {
        if (raw == null) {
            return List.of();
        }
        List<Integer> out = new ArrayList<>();
        if (raw instanceof List<?> list) {
            for (Object entry : list) {
                int n = asInt(entry);
                if (n > 0) {
                    out.add(n);
                }
            }
            return out;
        }
        String json = jsonbText(raw);
        if (json != null && !json.isBlank()) {
            try {
                List<Integer> parsed =
                        objectMapper.readValue(json, new TypeReference<List<Integer>>() {});
                for (Integer n : parsed) {
                    if (n != null && n > 0) {
                        out.add(n);
                    }
                }
            } catch (Exception ignored) {
                // Fall through.
            }
        }
        return out;
    }

    private static String jsonbText(Object value) {
        if (value instanceof String text) {
            String trimmed = text.trim();
            if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
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

    private static int asInt(Object value) {
        if (value instanceof Number n) {
            return n.intValue();
        }
        if (value == null) {
            return 0;
        }
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static Integer optionalInt(Object value) {
        if (value == null || "".equals(String.valueOf(value))) {
            return null;
        }
        int n = asInt(value);
        return n > 0 ? n : null;
    }

    private static void warnOnce(String message) {
        if (warned.add(message)) {
            log.warn("[items] {}", message);
        }
    }
}
