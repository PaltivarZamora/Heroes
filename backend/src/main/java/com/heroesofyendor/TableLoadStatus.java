package com.heroesofyendor;

public record TableLoadStatus(String table, boolean ok, int rowCount, String error) {
}
