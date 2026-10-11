package com.heroesofyendor;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Rolls optional item rewards onto chests (BR S9-41). Runs after all feature layers,
 * before world mobs (layer L5h).
 */
final class ChestItemsLayer {

    private static final Logger log = LoggerFactory.getLogger(ChestItemsLayer.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static volatile boolean warnedPct;
    private static volatile boolean warnedRarity;

    private ChestItemsLayer() {}

    static void run(MapGenContext ctx) {
        Random rng = ctx.rngFor("chest-items");
        ItemRoller roller = new ItemRoller(ctx.data, JSON);
        double pct = itemRewardPct(ctx.data);
        Map<Integer, Map<Integer, Integer>> rarityByLevel = chestItemRarity(ctx.data);
        int withItem = 0;
        List<MapObjectData> next = new ArrayList<>(ctx.objects.size());
        for (MapObjectData obj : ctx.objects) {
            if (!"chest".equals(obj.kind())) {
                next.add(obj);
                continue;
            }
            if (pct < 0 || rarityByLevel.isEmpty()) {
                next.add(obj);
                continue;
            }
            if (rng.nextDouble() * 100.0 >= pct) {
                next.add(obj);
                continue;
            }
            int level = obj.level() != null ? Math.max(1, Math.min(4, obj.level())) : 1;
            Map<Integer, Integer> weights = rarityByLevel.get(level);
            Integer rarityId = pickWeighted(rng, weights);
            if (rarityId == null) {
                next.add(obj);
                continue;
            }
            ItemRoller.RolledItem rolled = roller.rollOne(rng, rarityId);
            next.add(withChestItem(obj, toChestItem(rolled)));
            withItem++;
        }
        ctx.objects.clear();
        ctx.objects.addAll(next);
        MapGenPipeline.logCounts("chest-items", "with_item=" + withItem);
        GroundItemsLayer.run(ctx);
    }

    private static double itemRewardPct(ReferenceData data) {
        Object raw = MapConfig.raw(data, "item_reward_pct");
        if (raw == null) {
            warnPctOnce("item_reward_pct missing from map_config");
            return -1;
        }
        if (raw instanceof Number n) {
            return n.doubleValue();
        }
        try {
            return Double.parseDouble(String.valueOf(raw).trim());
        } catch (NumberFormatException e) {
            warnPctOnce("item_reward_pct not numeric");
            return -1;
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<Integer, Map<Integer, Integer>> chestItemRarity(ReferenceData data) {
        Object raw = MapConfig.raw(data, "chest_item_rarity");
        if (raw == null) {
            warnRarityOnce("chest_item_rarity missing from map_config");
            return Map.of();
        }
        if (!(raw instanceof Map<?, ?> top)) {
            warnRarityOnce("chest_item_rarity is not an object");
            return Map.of();
        }
        Map<Integer, Map<Integer, Integer>> out = new LinkedHashMap<>();
        for (Map.Entry<?, ?> levelEntry : top.entrySet()) {
            int level;
            try {
                level = Integer.parseInt(String.valueOf(levelEntry.getKey()));
            } catch (NumberFormatException e) {
                continue;
            }
            Object weightsRaw = levelEntry.getValue();
            if (!(weightsRaw instanceof Map<?, ?> weightMap)) {
                continue;
            }
            Map<Integer, Integer> weights = new LinkedHashMap<>();
            for (Map.Entry<?, ?> w : weightMap.entrySet()) {
                try {
                    int rarityId = Integer.parseInt(String.valueOf(w.getKey()));
                    int weight = asInt(w.getValue());
                    if (weight > 0) {
                        weights.put(rarityId, weight);
                    }
                } catch (NumberFormatException ignored) {
                    // Skip malformed row.
                }
            }
            if (!weights.isEmpty()) {
                out.put(level, weights);
            }
        }
        if (out.isEmpty()) {
            warnRarityOnce("chest_item_rarity has no usable levels");
        }
        return out;
    }

    private static Integer pickWeighted(Random rng, Map<Integer, Integer> weights) {
        if (weights == null || weights.isEmpty()) {
            return null;
        }
        int sum = 0;
        for (int w : weights.values()) {
            sum += Math.max(0, w);
        }
        if (sum <= 0) {
            return null;
        }
        int roll = rng.nextInt(sum);
        int acc = 0;
        for (Map.Entry<Integer, Integer> e : weights.entrySet()) {
            acc += Math.max(0, e.getValue());
            if (roll < acc) {
                return e.getKey();
            }
        }
        return weights.keySet().iterator().next();
    }

    private static MapObjectData.ChestRolledItem toChestItem(ItemRoller.RolledItem rolled) {
        List<MapObjectData.ChestRolledItem.ItemStatLine> stats = new ArrayList<>();
        for (ItemRoller.StatLine line : rolled.stats()) {
            stats.add(new MapObjectData.ChestRolledItem.ItemStatLine(line.statId(), line.amt()));
        }
        return new MapObjectData.ChestRolledItem(
                rolled.itemId(),
                rolled.rarityId(),
                rolled.adjId(),
                rolled.variation(),
                List.copyOf(stats));
    }

    private static MapObjectData withChestItem(MapObjectData obj, MapObjectData.ChestRolledItem chestItem) {
        return new MapObjectData(
                obj.q(),
                obj.r(),
                obj.kind(),
                obj.resourceId(),
                obj.marker(),
                obj.name(),
                obj.townTypeId(),
                obj.flipped(),
                obj.qty(),
                obj.level(),
                obj.loot(),
                obj.guardQ(),
                obj.guardR(),
                obj.signTextId(),
                obj.abilityIds(),
                obj.launchQ(),
                obj.launchR(),
                obj.linkedTownQ(),
                obj.linkedTownR(),
                chestItem);
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

    private static void warnPctOnce(String message) {
        if (warnedPct) {
            return;
        }
        warnedPct = true;
        log.warn("[chest-items] {}", message);
    }

    private static void warnRarityOnce(String message) {
        if (warnedRarity) {
            return;
        }
        warnedRarity = true;
        log.warn("[chest-items] {}", message);
    }
}
