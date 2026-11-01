package com.heroesofyendor;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Battlefield / world mob footprint hex layout (BR S13-33 / S13-35). Row widths
 * come from {@code shared/footprint-shapes.json} — same file the frontend loads.
 */
final class Footprint {

    static final int WORLD_MOB_ALONG = 1;

    private static final int[][] NORTH_DELTAS = {{0, -1}, {1, -1}};

    private static final Map<String, int[]> ROW_WIDTHS = loadRowWidths();

    private Footprint() {}

    private static Map<String, int[]> loadRowWidths() {
        try (InputStream in =
                Footprint.class.getResourceAsStream("/footprint-shapes.json")) {
            if (in == null) {
                throw new IllegalStateException("missing footprint-shapes.json on classpath");
            }
            Map<String, List<Integer>> raw =
                    new ObjectMapper()
                            .readValue(in, new TypeReference<Map<String, List<Integer>>>() {});
            Map<String, int[]> out = new HashMap<>();
            for (Map.Entry<String, List<Integer>> entry : raw.entrySet()) {
                List<Integer> list = entry.getValue();
                int[] widths = new int[list.size()];
                for (int i = 0; i < list.size(); i++) {
                    widths[i] = list.get(i);
                }
                out.put(entry.getKey(), widths);
            }
            return Map.copyOf(out);
        } catch (Exception e) {
            throw new IllegalStateException("footprint-shapes.json load failed", e);
        }
    }

    static String parseFootprint(Object footprintRaw, Object hexSizeRaw) {
        if (footprintRaw instanceof String s) {
            String trimmed = s.trim().toLowerCase(Locale.ROOT);
            if (ROW_WIDTHS.containsKey(trimmed)) {
                return trimmed;
            }
        }
        Integer n = asInt(hexSizeRaw);
        if (n != null && n >= 2) {
            return n == 2 ? "2x1" : "1x1";
        }
        if (footprintRaw != null) {
            n = asInt(footprintRaw);
            if (n != null && n >= 2) {
                return n == 2 ? "2x1" : "1x1";
            }
        }
        return "1x1";
    }

    static List<int[]> footprintHexes(int originQ, int originR, String code, int along) {
        int[] widths = ROW_WIDTHS.getOrDefault(code, ROW_WIDTHS.get("1x1"));
        int bottomW = widths.length > 0 ? widths[0] : 1;
        List<int[]> row = new ArrayList<>();
        for (int i = 0; i < bottomW; i++) {
            row.add(new int[] {originQ + along * i, originR});
        }
        List<int[]> out = new ArrayList<>(row);
        for (int u = 1; u < widths.length; u++) {
            row = centeredRowAbove(row, widths[u]);
            out.addAll(row);
        }
        return out;
    }

    static List<int[]> footprintBlockingHexes(int originQ, int originR, String code, int along) {
        return footprintHexes(originQ, originR, footprintBlockingCode(code), along);
    }

    static List<int[]> footprintHeadHexes(int originQ, int originR, String code, int along) {
        int[] widths = ROW_WIDTHS.getOrDefault(code, ROW_WIDTHS.get("1x1"));
        if (widths.length <= 1) {
            return List.of();
        }
        List<int[]> all = footprintHexes(originQ, originR, code, along);
        Set<String> bodyKeys = new HashSet<>();
        for (int[] hex : footprintBlockingHexes(originQ, originR, code, along)) {
            bodyKeys.add(HexCoords.key(hex[0], hex[1]));
        }
        List<int[]> head = new ArrayList<>();
        for (int[] hex : all) {
            if (!bodyKeys.contains(HexCoords.key(hex[0], hex[1]))) {
                head.add(hex);
            }
        }
        return head;
    }

    static String footprintBlockingCode(String code) {
        int[] widths = ROW_WIDTHS.getOrDefault(code, ROW_WIDTHS.get("1x1"));
        if (widths.length <= 1) {
            return code;
        }
        int[] body = new int[widths.length - 1];
        System.arraycopy(widths, 0, body, 0, body.length);
        return codeForRowWidths(body);
    }

    static Set<String> shapeKeys(int originQ, int originR, String code) {
        Set<String> keys = new HashSet<>();
        for (int[] hex : footprintHexes(originQ, originR, code, WORLD_MOB_ALONG)) {
            keys.add(HexCoords.key(hex[0], hex[1]));
        }
        return keys;
    }

    private static String codeForRowWidths(int[] widths) {
        String key = rowWidthsKey(widths);
        for (Map.Entry<String, int[]> entry : ROW_WIDTHS.entrySet()) {
            if (rowWidthsKey(entry.getValue()).equals(key)) {
                return entry.getKey();
            }
        }
        return "1x1";
    }

    private static String rowWidthsKey(int[] widths) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < widths.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(widths[i]);
        }
        return sb.toString();
    }

    private static List<int[]> centeredRowAbove(List<int[]> below, int width) {
        Set<String> seen = new HashSet<>();
        List<int[]> cands = new ArrayList<>();
        for (int[] hex : below) {
            for (int[] d : NORTH_DELTAS) {
                int nq = hex[0] + d[0];
                int nr = hex[1] + d[1];
                String key = HexCoords.key(nq, nr);
                if (!seen.add(key)) {
                    continue;
                }
                cands.add(new int[] {nq, nr});
            }
        }
        cands.sort(
                Comparator.comparingInt((int[] a) -> a[0]).thenComparingInt(a -> a[1]));
        if (cands.size() <= width) {
            return cands;
        }
        int start = (cands.size() - width) / 2;
        return new ArrayList<>(cands.subList(start, start + width));
    }

    private static Integer asInt(Object value) {
        if (value instanceof Number n) {
            return n.intValue();
        }
        if (value == null) {
            return null;
        }
        try {
            return Integer.parseInt(value.toString().trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
