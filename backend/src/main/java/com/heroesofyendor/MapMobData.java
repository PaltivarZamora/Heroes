package com.heroesofyendor;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/** One generated world mob. The frontend assigns session ids when it hydrates. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record MapMobData(
        int q,
        int r,
        List<Stack> stacks,
        /** True for chest/pocket/island/ground-item guards — no item drops (BR S9-43). */
        Boolean guardsLoot) {

    public MapMobData(int q, int r, List<Stack> stacks) {
        this(q, r, stacks, false);
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Stack(int unitId, int qty) {}
}
