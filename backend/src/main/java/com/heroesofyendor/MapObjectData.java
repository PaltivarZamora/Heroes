package com.heroesofyendor;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;

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
        Integer qty,
        /** Chest level ({@code stats.level}); null for non-chests. */
        Integer level,
        /** Chest loot rolled at generation; null for non-chests. */
        List<LootEntry> loot,
        /** Adjacent guard hex for chests; null when none. */
        Integer guardQ,
        Integer guardR,
        /** Chosen {@code sign_text.id} at generation; null for non-signs. */
        Integer signTextId,
        /** World Library ability ids rolled at generation; null otherwise. */
        List<Integer> abilityIds,
        /** Dock boat-launch hex (deep Water); null for non-docks. */
        Integer launchQ,
        Integer launchR,
        /** Notice Board linked town axial q (permanent). */
        Integer linkedTownQ,
        /** Notice Board linked town axial r (permanent). */
        Integer linkedTownR) {

    /** One rolled resource pick inside a chest. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LootEntry(int resourceId, int qty) {}

    /** Convenience for objects that do not use chest/sign/library/dock fields. */
    public static MapObjectData basic(
            int q,
            int r,
            String kind,
            Integer resourceId,
            String marker,
            String name,
            Integer townTypeId,
            Boolean flipped,
            Integer qty) {
        return new MapObjectData(
                q, r, kind, resourceId, marker, name, townTypeId, flipped, qty,
                null, null, null, null, null, null, null, null, null, null);
    }

    /** Notice Board linked to a town entry hex. */
    public static MapObjectData noticeBoard(
            int q,
            int r,
            boolean flipped,
            int linkedTownQ,
            int linkedTownR) {
        return new MapObjectData(
                q,
                r,
                "notice_board",
                null,
                "Q",
                "Notice Board",
                null,
                flipped,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                linkedTownQ,
                linkedTownR);
    }
}
