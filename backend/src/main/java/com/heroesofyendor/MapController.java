package com.heroesofyendor;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class MapController {

    @GetMapping("/api/map/test-grid")
    public TestGridResponse testGrid() {
        return TestGrid.generate();
    }
}
