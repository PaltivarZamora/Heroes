package com.heroesofyendor;

public record TileData(
        int q, int r, String terrain, Double movementCostMultiplier, boolean blocked) {}
