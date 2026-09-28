package com.heroesofyendor;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Ordered map-generation layers (BR S9-18). Each layer: Place → Validate → Repair.
 * Later layers may nudge earlier content but never redo an earlier layer.
 */
@FunctionalInterface
interface MapGenLayer {
    void run(MapGenContext ctx);
}

final class MapGenPipeline {

    private static final Logger log = LoggerFactory.getLogger(MapGenPipeline.class);
    private static final long STEP_WARN_MS = 15_000L;

    private MapGenPipeline() {}

    static void runLayer(MapGenContext ctx, String name, MapGenLayer layer) {
        long t0 = System.nanoTime();
        log.info(
                "Map gen layer '{}' start (seed={} subseed-from='{}')",
                name,
                ctx.mapSeed,
                name);
        try {
            layer.run(ctx);
        } catch (RuntimeException e) {
            long ms = (System.nanoTime() - t0) / 1_000_000L;
            log.error("Map gen layer '{}' failed after {} ms: {}", name, ms, e.toString());
            throw e;
        }
        long ms = (System.nanoTime() - t0) / 1_000_000L;
        if (ms >= STEP_WARN_MS) {
            log.warn("Map gen layer '{}' took {} ms (slow)", name, ms);
        } else {
            log.info("Map gen layer '{}': {} ms", name, ms);
        }
    }

    static void logRelax(String layer, String detail) {
        log.info("Map gen layer '{}' relax: {}", layer, detail);
    }

    static void logRepair(String layer, String detail) {
        log.info("Map gen layer '{}' repair: {}", layer, detail);
    }

    static void logCounts(String layer, String detail) {
        log.info("Map gen layer '{}' counts: {}", layer, detail);
    }
}
