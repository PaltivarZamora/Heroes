package com.heroesofyendor;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Per-generation layer timings for logs and {@code Server-Timing}. */
final class MapGenTimings {

    private static final ThreadLocal<MapGenTimings> CURRENT = new ThreadLocal<>();

    private final Map<String, Long> layersMs = new LinkedHashMap<>();
    private final Map<String, String> layerDetails = new LinkedHashMap<>();
    private long totalMs;

    static MapGenTimings start() {
        MapGenTimings t = new MapGenTimings();
        CURRENT.set(t);
        return t;
    }

    static MapGenTimings current() {
        MapGenTimings t = CURRENT.get();
        if (t == null) {
            t = new MapGenTimings();
            CURRENT.set(t);
        }
        return t;
    }

    static MapGenTimings take() {
        MapGenTimings t = CURRENT.get();
        CURRENT.remove();
        return t;
    }

    void layer(String id, long ms) {
        layersMs.put(id, ms);
    }

    void layerDetail(String id, String detail) {
        layerDetails.put(id, detail);
    }

    void total(long ms) {
        totalMs = ms;
    }

    private static String logLabel(String id) {
        return switch (id) {
            case "L1" -> "L1 terrain";
            case "L2" -> "L2 towns";
            case "L3" -> "L3 walls";
            case "L4" -> "L4 roads";
            case "L5a" -> "L5a buildings";
            case "L5b" -> "L5b branch-roads";
            case "L5c" -> "L5c spread";
            case "L5f" -> "L5f props";
            case "L5g" -> "L5g pockets";
            case "L5g-island" -> "L5g island-loot";
            case "L6" -> "L6 mobs";
            case "L7" -> "L7 final";
            case "asm" -> "assemble";
            default -> id;
        };
    }

    String logLine() {
        StringBuilder sb = new StringBuilder("[gen]");
        for (Map.Entry<String, Long> e : layersMs.entrySet()) {
            sb.append(' ').append(logLabel(e.getKey())).append(' ').append(e.getValue()).append("ms");
            String detail = layerDetails.get(e.getKey());
            if (detail != null && !detail.isEmpty()) {
                sb.append(" (").append(detail).append(')');
            }
            sb.append(" |");
        }
        sb.append(" total ").append(totalMs).append("ms");
        return sb.toString();
    }

    String serverTimingHeader() {
        List<String> parts = new ArrayList<>();
        for (Map.Entry<String, Long> e : layersMs.entrySet()) {
            parts.add(e.getKey() + ";dur=" + e.getValue());
        }
        parts.add("total;dur=" + totalMs);
        return String.join(", ", parts);
    }
}
