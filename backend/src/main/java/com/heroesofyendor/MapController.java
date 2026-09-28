package com.heroesofyendor;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class MapController {

    private final ReferenceData referenceData;

    public MapController(ReferenceData referenceData) {
        this.referenceData = referenceData;
    }

    /**
     * @param seed optional; random when omitted
     * @param players starting player count (notice boards + town typing)
     * @param size 1-based index into {@code map_config.sizes}
     * @param mapSize size name or {@code 72x72} dims; used when {@code size} omitted
     * @param townTypes comma-separated town type ids per player (own-type towns)
     */
    @GetMapping("/api/map/test-grid")
    public TestGridResponse testGrid(
            @RequestParam(required = false) Integer seed,
            @RequestParam(required = false) Integer players,
            @RequestParam(required = false) Integer size,
            @RequestParam(required = false) String mapSize,
            @RequestParam(required = false) String townTypes) {
        MapSize resolved =
                size != null
                        ? MapSize.fromNewMapSize(referenceData, size)
                        : MapSize.fromLabel(referenceData, mapSize);
        int[] playerTownTypes = parseTownTypes(townTypes);
        if (seed == null) {
            return TestGrid.generate(referenceData, players, resolved, playerTownTypes);
        }
        return TestGrid.generate(seed, referenceData, players, resolved, playerTownTypes);
    }

    private static int[] parseTownTypes(String raw) {
        if (raw == null || raw.isBlank()) {
            return new int[0];
        }
        String[] parts = raw.split(",");
        int[] out = new int[parts.length];
        for (int i = 0; i < parts.length; i++) {
            try {
                out[i] = Integer.parseInt(parts[i].trim());
            } catch (NumberFormatException ignored) {
                out[i] = 0;
            }
        }
        return out;
    }
}
