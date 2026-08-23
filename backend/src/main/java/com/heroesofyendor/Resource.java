package com.heroesofyendor;

/**
 * Adventure-map resources. Marker is the name initial; Aether uses E and
 * Incense uses N because A/I collide with Ash/Ichor.
 */
public enum Resource {
    GOLD("Gold", "G"),
    WOOD("Wood", "W"),
    ORE("Ore", "O"),
    ICHOR("Ichor", "I"),
    CRYSTAL("Crystal", "C"),
    SAP("Sap", "S"),
    ASH("Ash", "A"),
    AETHER("Aether", "E"),
    INCENSE("Incense", "N"),
    BRIMSTONE("Brimstone", "B");

    private final String displayName;
    private final String mineMarker;

    Resource(String displayName, String mineMarker) {
        this.displayName = displayName;
        this.mineMarker = mineMarker;
    }

    public String displayName() {
        return displayName;
    }

    public String mineMarker() {
        return mineMarker;
    }

    public String pickupMarker() {
        return mineMarker.toLowerCase();
    }
}
