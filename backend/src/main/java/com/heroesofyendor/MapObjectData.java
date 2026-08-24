package com.heroesofyendor;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record MapObjectData(
        int q,
        int r,
        String kind,
        Integer resourceId,
        String marker,
        String name,
        Integer townTypeId) {
}
