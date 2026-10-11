import { footprintBottomRow, footprintHexes } from '../combat/footprint';
import { featureForResource } from '../town/catalog';
import { mapObjectResourceId, mapObjectTownTypeId } from './types';
function facingLeft(position, flipped) {
    if (typeof flipped === 'boolean') {
        return flipped;
    }
    return position.flipped === true;
}
export function townEntryHex(position) {
    return { q: position.q, r: position.r };
}
/** Keep hex. Blocked. Opposite the drawbridge. */
export function townBlockedHex(position, flipped) {
    const dir = facingLeft(position, flipped) ? 1 : -1;
    return { q: position.q + dir, r: position.r };
}
/** Footprint origin = leftmost hex (for {@link footprintHexes} along=+1). */
export function townFootprintOrigin(position, flipped) {
    if (facingLeft(position, flipped)) {
        return { q: position.q, r: position.r };
    }
    return townBlockedHex(position, false);
}
export function townFootprintHexes(position, flipped) {
    return footprintHexes(townFootprintOrigin(position, flipped), '2x1', 1);
}
export function townFootprintBottomRow(position, flipped) {
    return footprintBottomRow(townFootprintOrigin(position, flipped), '2x1', 1);
}
export function isTownEntryHex(townPos, q, r) {
    return townPos.q === q && townPos.r === r;
}
export function isTownBlockedHex(townPos, q, r, flipped) {
    const keep = townBlockedHex(townPos, flipped);
    return keep.q === q && keep.r === r;
}
export function isTownFootprintHex(townPos, q, r) {
    return isTownEntryHex(townPos, q, r) || isTownBlockedHex(townPos, q, r);
}
/**
 * Whether the town building should draw above a unit at `unit`.
 * Entry/drawbridge hex → unit on top; blocked hex, left approach, or north of
 * the keep → town on top.
 */
export function townOccludesUnit(townPos, unit, flipped) {
    if (isTownEntryHex(townPos, unit.q, unit.r)) {
        return false;
    }
    if (isTownBlockedHex(townPos, unit.q, unit.r, flipped)) {
        return true;
    }
    const keep = townBlockedHex(townPos, flipped);
    const entry = townEntryHex(townPos);
    const side = facingLeft(townPos, flipped) ? 1 : -1;
    const along = (unit.q - keep.q) * side;
    if (unit.r === keep.r && along > 0 && along <= 2) {
        return true;
    }
    // Pointy-top: smaller `r` is screen-north (behind / above the keep).
    // Cover two rows — town art is taller than the 2×1 footprint.
    if (unit.r >= keep.r || unit.r < keep.r - 2) {
        return false;
    }
    const minQ = Math.min(keep.q, entry.q) - 1;
    const maxQ = Math.max(keep.q, entry.q) + 1;
    return unit.q >= minQ && unit.q <= maxQ;
}
/** `feature` row for a town type (`feature_type` = town, stats.town_id). */
export function featureForTownType(catalog, townTypeId) {
    if (!catalog || townTypeId == null || !Number.isFinite(townTypeId) || townTypeId <= 0) {
        return undefined;
    }
    const typeId = catalog.feature_type.find((row) => row.name === 'town')?.id;
    return catalog.feature.find((row) => {
        if (typeId != null && row.feature_type_id !== typeId) {
            return false;
        }
        const tid = Number(row.stats?.town_id);
        return Number.isFinite(tid) && tid === townTypeId;
    });
}
/** `feature` row for the world fountain (`feature_type` = fountain). */
export function featureForFountain(catalog) {
    if (!catalog) {
        return undefined;
    }
    const typeId = catalog.feature_type.find((row) => row.name === 'fountain')?.id;
    if (typeId == null) {
        return undefined;
    }
    return catalog.feature.find((row) => row.feature_type_id === typeId);
}
/** `feature` row for a chest level (`feature_type` = chest, stats.level). */
export function featureForChest(catalog, level) {
    if (!catalog || level == null || !Number.isFinite(level) || level < 1) {
        return undefined;
    }
    const typeId = catalog.feature_type.find((row) => row.name === 'chest')?.id;
    return catalog.feature.find((row) => {
        if (typeId != null && row.feature_type_id !== typeId) {
            return false;
        }
        const lvl = Number(row.stats?.level);
        return Number.isFinite(lvl) && lvl === level;
    });
}
export function chestOpenImage(catalog, level) {
    const row = featureForChest(catalog, level);
    const raw = row?.stats?.open_image;
    if (typeof raw === 'string' && raw.trim()) {
        return raw.trim().replace(/\.png$/i, '') + '.png';
    }
    return null;
}
export function chestClosedImage(catalog, level) {
    const row = featureForChest(catalog, level);
    return row?.image_path ?? null;
}
export function chestXp(catalog, level) {
    const raw = featureForChest(catalog, level)?.stats?.xp;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
export function chestGold(catalog, level) {
    const raw = featureForChest(catalog, level)?.stats?.gold;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
export function chestGuardTiers(catalog, level) {
    const raw = featureForChest(catalog, level)?.stats?.guard_tiers;
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .map((v) => (typeof v === 'number' ? v : Number(v)))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => Math.floor(n));
}
/** `feature` row for the world sign (`feature_type` = sign). */
export function featureForSign(catalog) {
    if (!catalog) {
        return undefined;
    }
    const typeId = catalog.feature_type.find((row) => row.name === 'sign')?.id;
    if (typeId == null) {
        return undefined;
    }
    return catalog.feature.find((row) => row.feature_type_id === typeId);
}
/**
 * World-map Library feature (`feature_type` = library).
 * Distinct from the in-town Library building.
 */
export function featureForWorldLibrary(catalog) {
    if (!catalog) {
        return undefined;
    }
    const typeId = catalog.feature_type.find((row) => row.name === 'library')?.id;
    if (typeId == null) {
        return undefined;
    }
    return catalog.feature.find((row) => row.feature_type_id === typeId);
}
/**
 * World-map Hanger feature (`feature_type` = hanger).
 * Distinct from the town Hanger building (slot 8).
 */
export function featureForWorldHanger(catalog) {
    if (!catalog) {
        return undefined;
    }
    const typeId = catalog.feature_type.find((row) => row.name === 'hanger')?.id;
    if (typeId == null) {
        return undefined;
    }
    return catalog.feature.find((row) => row.feature_type_id === typeId);
}
/** World-map Dock feature (`feature_type` = dock). */
export function featureForWorldDock(catalog) {
    if (!catalog) {
        return undefined;
    }
    const typeId = catalog.feature_type.find((row) => row.name === 'dock')?.id;
    if (typeId == null) {
        return undefined;
    }
    return catalog.feature.find((row) => row.feature_type_id === typeId);
}
/** World-map Recruits for Hire (`feature_type` = recruit_building). */
export function featureForWorldRecruits(catalog) {
    if (!catalog) {
        return undefined;
    }
    const typeId = catalog.feature_type.find((row) => row.name === 'recruit_building')?.id;
    if (typeId == null) {
        return undefined;
    }
    return catalog.feature.find((row) => row.feature_type_id === typeId);
}
/** World-map Notice Board (`feature_type` = quest). */
export function featureForNoticeBoard(catalog) {
    if (!catalog) {
        return undefined;
    }
    const typeId = catalog.feature_type.find((row) => row.name === 'quest')?.id;
    if (typeId == null) {
        return undefined;
    }
    return catalog.feature.find((row) => row.feature_type_id === typeId);
}
/** Resolve catalog `feature` row for a world-map object (for draw-time render_scale). */
export function featureRowForMapObject(catalog, data, opts) {
    switch (data.kind) {
        case 'town':
            return featureForTownType(catalog, opts?.townTypeId ?? mapObjectTownTypeId(data) ?? null);
        case 'fountain':
            return featureForFountain(catalog);
        case 'chest': {
            const level = opts?.chestLevel ??
                (typeof data.level === 'number' ? data.level : 0);
            return featureForChest(catalog, level);
        }
        case 'sign':
            return featureForSign(catalog);
        case 'library':
            return featureForWorldLibrary(catalog);
        case 'hanger':
            return featureForWorldHanger(catalog);
        case 'dock':
            return featureForWorldDock(catalog);
        case 'recruits':
            return featureForWorldRecruits(catalog);
        case 'notice_board':
            return featureForNoticeBoard(catalog);
        case 'mine':
        case 'pickup': {
            const resourceId = mapObjectResourceId(data);
            if (resourceId == null) {
                return undefined;
            }
            return featureForResource(catalog, resourceId, data.kind);
        }
        default:
            return undefined;
    }
}
