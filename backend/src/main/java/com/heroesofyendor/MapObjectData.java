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
        Integer townTypeId,
        /** Horizontal mirror when placed; null/false = no flip. */
        Boolean flipped,
        /** Loose pile qty rolled at generation; null for mines/towns. */
        Integer qty) {
}
