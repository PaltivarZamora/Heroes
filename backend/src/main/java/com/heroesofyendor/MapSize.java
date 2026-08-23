package com.heroesofyendor;

public enum MapSize {
    SMALL(36, 36),
    MEDIUM(72, 72),
    LARGE(108, 108),
    EXTRA_LARGE(144, 144),
    HUGE(180, 180),
    EXTRA_HUGE(216, 216),
    GIANT(252, 252);

    private final int width;
    private final int height;

    MapSize(int width, int height) {
        this.width = width;
        this.height = height;
    }

    public int width() {
        return width;
    }

    public int height() {
        return height;
    }
}
