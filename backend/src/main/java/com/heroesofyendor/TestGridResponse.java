package com.heroesofyendor;

import java.util.List;

public record TestGridResponse(int seed, List<TileData> tiles, List<MapObjectData> objects) {
}
