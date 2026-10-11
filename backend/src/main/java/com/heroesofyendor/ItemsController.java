package com.heroesofyendor;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Gameplay item rolls (BR S9-41). Dev tooling uses {@link DebugItemsController}. */
@RestController
public class ItemsController {

    private final ItemRoller itemRoller;

    public ItemsController(ItemRoller itemRoller) {
        this.itemRoller = itemRoller;
    }

    @GetMapping("/api/items/roll")
    public Map<String, Object> roll(
            @RequestParam(defaultValue = "1") int count,
            @RequestParam(defaultValue = "1") long seed,
            @RequestParam(required = false) Integer rarityId) {
        Random rng = new Random(seed);
        List<ItemRoller.RolledItem> items = itemRoller.rollMany(rng, count, rarityId);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("seed", seed);
        body.put("count", items.size());
        body.put("items", items);
        return body;
    }
}
