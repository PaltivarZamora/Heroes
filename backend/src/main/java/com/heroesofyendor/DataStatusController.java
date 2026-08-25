package com.heroesofyendor;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DataStatusController {

    private final ReferenceData referenceData;

    public DataStatusController(ReferenceData referenceData) {
        this.referenceData = referenceData;
    }

    @GetMapping("/api/system/data-status")
    public DataStatusResponse dataStatus() {
        return referenceData.status();
    }

    @PostMapping("/api/system/reload-reference-data")
    public DataStatusResponse reloadReferenceData() {
        return referenceData.reload();
    }
}
