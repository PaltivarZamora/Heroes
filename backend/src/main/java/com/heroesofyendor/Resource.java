package com.heroesofyendor;

/**
 * Adventure-map marker letters keyed by resource table id. Aether uses E and
 * Incense uses N because A/I collide with Ash/Ichor. Display names come from
 * the resource table, not this enum.
 */
public enum Resource {
    GOLD(1, "G"),
    WOOD(2, "W"),
    ORE(3, "O"),
    ICHOR(4, "I"),
    CRYSTAL(5, "C"),
    SAP(6, "S"),
    ASH(7, "A"),
    AETHER(8, "E"),
    INCENSE(9, "N"),
    BRIMSTONE(10, "B");

    private final int id;
    private final String mineMarker;

    Resource(int id, String mineMarker) {
        this.id = id;
        this.mineMarker = mineMarker;
    }

    public static String mineMarker(int resourceId, String fallbackName) {
        for (Resource resource : values()) {
            if (resource.id == resourceId) {
                return resource.mineMarker;
            }
        }
        if (fallbackName != null && !fallbackName.isBlank()) {
            return fallbackName.substring(0, 1).toUpperCase();
        }
        return "?";
    }

    public static String pickupMarker(int resourceId, String fallbackName) {
        return mineMarker(resourceId, fallbackName).toLowerCase();
    }
}
