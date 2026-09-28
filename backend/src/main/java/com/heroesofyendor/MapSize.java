package com.heroesofyendor;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * World-map size resolved from {@code map_config} ({@code sizes}, {@code size_dims},
 * {@code size_scale}). No hardcoded size list — adding a size is data-only.
 *
 * <p>Legacy dim strings / names (Small 36, Medium 72, old Large 108, …) still
 * resolve so older saves regenerate the correct grid.
 */
public final class MapSize {

    private final String name;
    private final int width;
    private final int height;
    private final double scale;

    private MapSize(String name, int width, int height, double scale) {
        this.name = name;
        this.width = width;
        this.height = height;
        this.scale = scale > 0 ? scale : 1.0;
    }

    public String name() {
        return name;
    }

    public int width() {
        return width;
    }

    public int height() {
        return height;
    }

    public double scale() {
        return scale;
    }

    public static MapSize of(String name, int width, int height, double scale) {
        return new MapSize(
                name == null || name.isBlank() ? width + "x" + height : name,
                width,
                height,
                scale);
    }

    /** New Game / API size name (e.g. {@code normal}). */
    public static MapSize fromName(ReferenceData data, String sizeName) {
        String name =
                sizeName == null || sizeName.isBlank()
                        ? MapConfig.defaultSizeName(data)
                        : sizeName.trim().toLowerCase(Locale.ROOT);
        // Legacy names that are not in map_config.sizes
        MapSize legacy = legacyByName(name);
        if (legacy != null) {
            return legacy;
        }
        int dim = MapConfig.sizeDim(data, name);
        double scale = MapConfig.sizeScale(data, name);
        return of(name, dim, dim, scale);
    }

    /**
     * Optional 1-based index into {@code map_config.sizes} (compat for old
     * {@code ?size=} clients). Prefer {@link #fromName}.
     */
    public static MapSize fromNewMapSize(ReferenceData data, Integer index) {
        List<String> names = MapConfig.sizeNames(data);
        if (index != null && index >= 1 && index <= names.size()) {
            return fromName(data, names.get(index - 1));
        }
        return fromName(data, MapConfig.defaultSizeName(data));
    }

    /**
     * Name, {@code 72x72} dims, or legacy label. Explicit dims win so old saves
     * that store {@code map_width}/{@code map_height} regenerate correctly.
     */
    public static MapSize fromLabel(ReferenceData data, String raw) {
        if (raw == null || raw.isBlank()) {
            return fromName(data, MapConfig.defaultSizeName(data));
        }
        String key = raw.trim();
        // Old saves used Title-Case picker labels with historical dims.
        if ("Large".equals(key)) {
            return of("large_legacy", 108, 108, 2.25);
        }
        if ("Giant".equals(key)) {
            return of("giant_legacy", 252, 252, 12.25);
        }
        String compact =
                key.toLowerCase(Locale.ROOT).replace('×', 'x').replace(' ', '_').replace('-', '_');

        int x = compact.indexOf('x');
        if (x > 0) {
            try {
                int w = Integer.parseInt(compact.substring(0, x));
                int h = Integer.parseInt(compact.substring(x + 1));
                if (w > 0 && h > 0) {
                    String matched = matchSizeNameByDim(data, w);
                    double scale =
                            matched != null
                                    ? MapConfig.sizeScale(data, matched)
                                    : scaleForLegacyDim(w);
                    return of(matched != null ? matched : (w + "x" + h), w, h, scale);
                }
            } catch (NumberFormatException ignored) {
                // fall through
            }
        }

        MapSize legacy = legacyByName(compact);
        if (legacy != null) {
            return legacy;
        }
        return fromName(data, compact);
    }

    public static List<MapSize> allConfigured(ReferenceData data) {
        List<MapSize> out = new ArrayList<>();
        for (String name : MapConfig.sizeNames(data)) {
            out.add(fromName(data, name));
        }
        return List.copyOf(out);
    }

    private static String matchSizeNameByDim(ReferenceData data, int dim) {
        for (String name : MapConfig.sizeNames(data)) {
            if (MapConfig.sizeDim(data, name) == dim) {
                return name;
            }
        }
        return null;
    }

    private static MapSize legacyByName(String compact) {
        return switch (compact) {
            case "small" -> of("small", 36, 36, 0.25);
            case "medium" -> of("normal", 72, 72, 1);
            case "extra_large", "extralarge" -> of("large", 144, 144, 4);
            case "huge" -> of("huge", 180, 180, 6.25);
            case "extra_huge", "extrahuge" -> of("giant", 216, 216, 9);
            case "large_legacy" -> of("large_legacy", 108, 108, 2.25);
            case "giant_legacy" -> of("giant_legacy", 252, 252, 12.25);
            default -> null;
        };
    }

    private static double scaleForLegacyDim(int dim) {
        return switch (dim) {
            case 36 -> 0.25;
            case 72 -> 1;
            case 108 -> 2.25;
            case 144 -> 4;
            case 180 -> 6.25;
            case 216 -> 9;
            case 252 -> 12.25;
            default -> Math.max(0.01, (dim / 72.0) * (dim / 72.0));
        };
    }
}
