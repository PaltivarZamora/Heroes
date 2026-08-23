package com.heroesofyendor;

import java.util.List;

public record DataStatusResponse(boolean ok, List<TableLoadStatus> tables) {
}
