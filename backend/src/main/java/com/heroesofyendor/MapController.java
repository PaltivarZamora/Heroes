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

    @GetMapping("/api/map/test-grid")
    public TestGridResponse testGrid(@RequestParam(required = false) Integer seed) {
        if (seed == null) {
            return TestGrid.generate(referenceData);
        }
        return TestGrid.generate(seed, referenceData);
    }
}
