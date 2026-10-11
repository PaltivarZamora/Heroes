import { GOLD_RESOURCE_ID, RESOURCES, applyResourceCatalog, costKeyToResourceId, formatAmount, resourceById, } from '../hex/resources';
import { slotFromPlayerId } from '../session/types';
import { parseFootprint as parseFootprintCode } from '../combat/footprint';
import { BUILDING_SLOT_HANGER, BUILDING_SLOT_LIBRARY, BUILDING_SLOT_MARKETPLACE, BUILDING_SLOT_TAVERN, BUILDING_SLOT_TOWN_UNIQUE, buildingInSlot, } from './buildingSlots';
import { enrichCatalogUnits } from './enrichCatalogUnits';
import { asStatRows } from './statCatalog';
import { asItemAdjs, asItemTemplates, asItemTypes, asRarities, auditItemSlotTypes, } from '../items/itemCatalog';
import { equippedItemBonuses, mergeHeroStats, } from '../items/bonuses';
import { auditUpgradePairing, unitDwellingLevel, advancedUnitsFor, } from './unitUpgrade';
import { TAG_AUTO_TARGET_RANDOM_ENEMY, TAG_AUTO_TARGET_RANDOM_WALL, unitHasNamedTag, unitHasTag, } from './unitTags';
export const DEFAULT_UNIT_RETALIATION = {
    dmgPct: 'default',
    times: 1,
    preemptive: false,
};
export const DEFAULT_UNIT_ABILITIES = {
    no_enemy_retaliation: false,
    shape: 'single',
    radius: 1,
    jumps: 1,
    falloff: 0,
    targets: 1,
    rows: 2,
    autoTarget: null,
    skipIfNone: false,
    inflictsCondition: null,
    resistStat: null,
    conditionDuration: 1,
    autoSplitOnTurn: false,
    skipFirstTurn: false,
    killOnOverflow: false,
    chancePct: null,
    extraAttackOnAttackOnly: false,
    speedDebuffPct: null,
    leavesGroundEffectOnMove: false,
    leavesGroundEffectOnAttack: false,
    groundEffectId: null,
    immuneToFire: false,
    immuneToLightning: false,
    fullPath: false,
    canTargetAllyIfTag: null,
    healOnAllyTarget: false,
    healAmtPerUnit: null,
    killChainPulse: false,
    killAbsorbChancePct: null,
    killAbsorbTagRequired: null,
    killAbsorbTagsRequired: [],
    killAbsorbRequiresTier: null,
    killAbsorbTrigger: null,
    growsQtyOnKill: null,
    dmgIncreasePerHex: null,
    chargeDmgEscalation: false,
    escalationChancePctStat: null,
    escalationMult: null,
    escalationMinIncrease: null,
    speedDebuffFlatStatDiv: null,
    bonusDmgTags: [],
    bonusDmgMult: null,
    aiTreatAsThreat: false,
    immuneToMagicDmg: false,
    blinkMovement: false,
    requiresLos: false,
    respectsHexSize: false,
    speedSwapIfTargetFaster: false,
    speedSwapDuration: 1,
    healMostInjuredOnKill: false,
    healFull: false,
    extraTurnOnKill: false,
    chancePctFlatStat: null,
    chanceHalvesEachAttempt: false,
    grantsSecondAttack: false,
    dualAttack: false,
    secondAttackDmgType: null,
    secondAttackMinDmg: null,
    secondAttackMaxDmg: null,
    retaliateOnceAfterBoth: false,
    auraRadius: null,
    auraCountsAlliesAsExtraQty: false,
    absorbTerrainIds: [],
    terrainGrowthTerrainTypeId: null,
    terrainGrowthAmount: null,
    fizzleTerrainIds: [],
    clearsGroundEffectId: null,
    chancePctIntelStat: null,
    scatterGroundEffectOnMoveStop: false,
    spiralChanceDecayPct: null,
    selfRezOnWipe: false,
    selfRezChanceStatDiv: null,
    selfRezCapPct: null,
    selfRezBasedOnKillsThisRound: false,
};
export const HERO_STAT_KEYS = [
    'speed',
    'stamina',
    'strength',
    'intel',
    'defense',
    'resist',
    'crit_pct',
    'crit_amt',
];
function asCost(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    const cost = {};
    for (const [key, amount] of Object.entries(value)) {
        const n = Number(amount);
        // Same id-key path as building.cost — names only for legacy rows.
        const id = costKeyToResourceId(key);
        if (id != null && Number.isFinite(n) && n !== 0) {
            cost[id] = n;
        }
    }
    return cost;
}
function asHeroPool(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    const pool = [];
    for (const row of rows) {
        if (row == null || typeof row !== 'object') {
            continue;
        }
        const rec = row;
        const id = Number(rec.id);
        const classId = Number(rec.class_id);
        const name = typeof rec.name === 'string' ? rec.name.trim() : '';
        if (!Number.isInteger(id) || !Number.isInteger(classId) || !name) {
            continue;
        }
        const image = typeof rec.image_path === 'string' ? rec.image_path.trim() : '';
        pool.push({
            id,
            name,
            class_id: classId,
            image_path: image || null,
            arch_id: asOptionalId(rec.arch_id),
        });
    }
    return pool;
}
function asInt(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function asOptionalId(value) {
    if (value == null || value === '') {
        return null;
    }
    const n = asInt(value);
    return n > 0 ? n : null;
}
function asIdList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => asInt(item))
        .filter((id) => id > 0);
}
function asRequires(value) {
    if (value == null) {
        return null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        try {
            return asRequires(JSON.parse(trimmed));
        }
        catch {
            return null;
        }
    }
    // Some rows store a bare {"any":[...]} / {"all":[...]} instead of a list.
    if (!Array.isArray(value) && typeof value === 'object') {
        return asRequires([value]);
    }
    if (!Array.isArray(value) || value.length === 0) {
        return null;
    }
    const clauses = [];
    for (const entry of value) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const rec = entry;
        if (Array.isArray(rec.all)) {
            const all = asIdList(rec.all);
            if (all.length > 0) {
                clauses.push({ all });
            }
            continue;
        }
        if (Array.isArray(rec.any)) {
            const any = asIdList(rec.any);
            if (any.length > 0) {
                clauses.push({ any });
            }
        }
    }
    return clauses.length > 0 ? clauses : null;
}
function catalogLevel(value) {
    const n = asInt(value, 1);
    return n > 0 ? n : 1;
}
function asHexNumber(value) {
    if (value == null || value === '') {
        return null;
    }
    const n = asInt(value);
    return n > 0 ? n : null;
}
function asHexNumberList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const out = [];
    const seen = new Set();
    for (const entry of value) {
        const n = asHexNumber(entry);
        if (n == null || seen.has(n)) {
            continue;
        }
        seen.add(n);
        out.push(n);
    }
    return out;
}
function asTownGroundPlan(value) {
    const rec = asJsonObject(value);
    if (!rec) {
        return null;
    }
    const entry = asHexNumber(rec.entry);
    const road = asHexNumberList(rec.road);
    if (entry == null && road.length === 0) {
        return null;
    }
    return { entry, road };
}
function asTownRows(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    const towns = [];
    for (const row of rows) {
        if (row == null || typeof row !== 'object') {
            continue;
        }
        const raw = row;
        const id = asInt(raw.id);
        const name = typeof raw.name === 'string' ? raw.name : '';
        if (id <= 0) {
            continue;
        }
        towns.push({
            id,
            name,
            map: asTownGroundPlan(raw.map),
        });
    }
    return towns;
}
function asTownLayoutHexes(value) {
    const rec = asJsonObject(value);
    if (!rec) {
        return { door: null, blocked: [] };
    }
    return {
        door: asHexNumber(rec.door),
        blocked: asHexNumberList(rec.blocked),
    };
}
function asTownLayoutMapDisplay(value) {
    const rules = asJsonObject(value);
    const map = rules ? asJsonObject(rules.map) : null;
    if (!map) {
        return null;
    }
    const scale = Number(map.scale);
    const dx = Number(map.dx);
    const dy = Number(map.dy);
    return {
        scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
        dx: Number.isFinite(dx) ? dx : 0,
        dy: Number.isFinite(dy) ? dy : 0,
    };
}
function asTownLayout(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows.map((row) => {
        const raw = row;
        return {
            id: asInt(raw.id),
            town_type_id: asInt(raw.town_type_id),
            slot: asInt(raw.slot),
            hexes: asTownLayoutHexes(raw.hexes),
            mapDisplay: asTownLayoutMapDisplay(raw.display_rules),
        };
    });
}
function asMarket(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const raw = row;
        return {
            qty: asInt(raw.qty),
            conversion_rate: asInt(raw.conversion_rate),
        };
    })
        .filter((row) => row.qty > 0 && row.conversion_rate > 0);
}
function asResourcePayload(value) {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const rec = value;
    const looseMin = Number(rec.loose_min);
    const looseMax = Number(rec.loose_max);
    const weekly = Number(rec.weekly_node);
    if (!Number.isFinite(looseMin) ||
        !Number.isFinite(looseMax) ||
        !Number.isFinite(weekly)) {
        return null;
    }
    const min = Math.max(0, Math.floor(looseMin));
    const max = Math.max(min, Math.floor(looseMax));
    return {
        loose_min: min,
        loose_max: max,
        weekly_node: Math.max(0, Math.floor(weekly)),
    };
}
function asResources(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const raw = row;
        const name = typeof raw.name === 'string' ? raw.name.trim() : '';
        return {
            id: asInt(raw.id),
            name,
            base_value: asInt(raw.base_value),
            payload: asResourcePayload(raw.payload),
        };
    })
        .filter((row) => row.id > 0 && row.name.length > 0);
}
function asNamed(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const raw = row;
        const name = typeof raw.name === 'string' ? raw.name.trim() : '';
        return { id: asInt(raw.id), name };
    })
        .filter((row) => row.id > 0 && row.name.length > 0);
}
function asMoveTypes(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        const value = typeof rec.value === 'string'
            ? rec.value.trim()
            : typeof rec.name === 'string'
                ? rec.name.trim()
                : '';
        const name = typeof rec.name === 'string' && rec.name.trim()
            ? rec.name.trim()
            : value;
        const description = typeof rec.description === 'string' ? rec.description.trim() : null;
        return {
            id: asInt(rec.id),
            name,
            value: value || name,
            description: description || null,
        };
    })
        .filter((row) => row.id > 0 && row.value.length > 0)
        .sort((a, b) => a.id - b.id);
}
/**
 * Resolve `move_type.value` for a unit's move_type_id (falls back to name).
 * Null / missing id → empty string (non-mover; not an error, not Walker).
 */
export function moveTypeValue(catalog, moveTypeId) {
    if (!catalog || moveTypeId == null || moveTypeId <= 0) {
        return '';
    }
    const row = catalog.move_type.find((entry) => entry.id === moveTypeId);
    const raw = row?.value?.trim() || row?.name?.trim() || '';
    return raw;
}
/** Hover rule text — overrides stale DB copy after Submerge retirement. */
const HOVER_MOVE_DESCRIPTION = 'Flies. Takes half damage from ground melee.';
/**
 * Display name + description for a move_type id.
 * Null id → null (non-mover; omit from tips).
 */
export function moveTypeDisplay(catalog, moveTypeId) {
    if (!catalog || moveTypeId == null || moveTypeId <= 0) {
        return null;
    }
    const row = catalog.move_type.find((entry) => entry.id === moveTypeId);
    const value = row?.value?.trim() || row?.name?.trim() || '';
    if (!value) {
        return null;
    }
    const name = row?.name?.trim() || value;
    if (value.toLowerCase().includes('hover')) {
        return { name, description: HOVER_MOVE_DESCRIPTION };
    }
    const description = row?.description?.trim() || '';
    return { name, description };
}
function asKeybind(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        const action = typeof rec.action === 'string' ? rec.action.trim() : '';
        const label = typeof rec.label === 'string' ? rec.label.trim() : action;
        const key = typeof rec.key === 'string' ? rec.key.trim().toLowerCase() : '';
        const altRaw = rec.alt_key;
        const alt_key = typeof altRaw === 'string' && altRaw.trim()
            ? altRaw.trim().toLowerCase()
            : null;
        const scope = typeof rec.scope === 'string' ? rec.scope.trim() : 'world';
        const rebindable = Number(rec.rebindable) !== 0;
        const sort_order = Number(rec.sort_order) || 0;
        return { action, label, key, alt_key, scope, rebindable, sort_order };
    })
        .filter((row) => row.action.length > 0 && row.key.length > 0);
}
function asAppConfig(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        const key = typeof rec.key === 'string' ? rec.key.trim() : '';
        const value = rec.value == null ? '' : String(rec.value);
        const description = typeof rec.description === 'string' ? rec.description : null;
        return { key, value, description };
    })
        .filter((row) => row.key.length > 0);
}
/** Keep jsonb values as objects/numbers/arrays (do not stringify). */
function asJsonConfig(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        const key = typeof rec.key === 'string' ? rec.key.trim() : '';
        const description = typeof rec.description === 'string' ? rec.description : null;
        return { key, value: rec.value, description };
    })
        .filter((row) => row.key.length > 0);
}
function asAiArch(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    const out = [];
    for (const row of rows) {
        if (row == null || typeof row !== 'object') {
            continue;
        }
        const rec = row;
        const id = asInt(rec.id);
        const name = typeof rec.name === 'string' ? rec.name.trim() : '';
        if (id <= 0 || !name) {
            continue;
        }
        out.push({
            id,
            name,
            description: typeof rec.description === 'string' ? rec.description : null,
        });
    }
    return out;
}
function asAiArchWeight(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    const out = [];
    for (const row of rows) {
        if (row == null || typeof row !== 'object') {
            continue;
        }
        const rec = row;
        const archId = asInt(rec.arch_id);
        const decision = typeof rec.decision_key === 'string' ? rec.decision_key.trim() : '';
        const factor = typeof rec.factor_key === 'string' ? rec.factor_key.trim() : '';
        const weight = Number(rec.weight);
        if (archId <= 0 || !decision || !factor || !Number.isFinite(weight)) {
            continue;
        }
        out.push({ arch_id: archId, decision_key: decision, factor_key: factor, weight });
    }
    return out;
}
function asBoolFlag(value) {
    if (value === true || value === 1) {
        return true;
    }
    if (typeof value === 'string') {
        const text = value.trim().toLowerCase();
        return text === 'true' || text === 't' || text === '1';
    }
    return false;
}
function asRequiredBuffer(value) {
    let raw = value;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) {
            return {};
        }
        try {
            raw = JSON.parse(trimmed);
        }
        catch {
            return {};
        }
    }
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
        return {};
    }
    const out = {};
    for (const [key, entry] of Object.entries(raw)) {
        const otherId = Math.floor(Number(key));
        const bufferId = Math.floor(Number(entry));
        if (Number.isFinite(otherId) &&
            otherId > 0 &&
            Number.isFinite(bufferId) &&
            bufferId > 0) {
            out[otherId] = bufferId;
        }
    }
    return out;
}
function asHexTerrains(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        const name = typeof rec.name === 'string' ? rec.name.trim() : '';
        const color = typeof rec.color === 'string' && rec.color.trim() !== ''
            ? rec.color.trim()
            : '#607D8B';
        const imageRaw = rec.image_path;
        const image_path = typeof imageRaw === 'string' && imageRaw.trim() !== ''
            ? imageRaw.trim()
            : null;
        const costRaw = rec.move_cost;
        const cost = costRaw == null || costRaw === ''
            ? null
            : Number(costRaw);
        const exclusion = Array.isArray(rec.exclusion) ? rec.exclusion : [];
        return {
            id: asInt(rec.id),
            name,
            z_order: asInt(rec.z_order),
            is_blocker: asBoolFlag(rec.is_blocker),
            is_seedable: rec.is_seedable == null || rec.is_seedable === ''
                ? true
                : asBoolFlag(rec.is_seedable),
            exclusion,
            required_buffer: asRequiredBuffer(rec.required_buffer),
            color,
            image_path,
            move_cost: cost != null && Number.isFinite(cost) ? cost : null,
        };
    })
        .filter((row) => row.id > 0 && row.name.length > 0)
        .sort((a, b) => a.z_order - b.z_order || a.id - b.id);
}
function asPropTerrainRules(value) {
    let raw = value;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) {
            return {};
        }
        try {
            raw = JSON.parse(trimmed);
        }
        catch {
            return {};
        }
    }
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
        return {};
    }
    const out = {};
    for (const [key, entry] of Object.entries(raw)) {
        if (key === 'naval_only') {
            continue;
        }
        const terrainId = Math.floor(Number(key));
        const density = Number(entry);
        if (Number.isFinite(terrainId) &&
            terrainId > 0 &&
            Number.isFinite(density) &&
            density > 0) {
            out[terrainId] = density;
        }
    }
    return out;
}
function asPropWall(value) {
    let raw = value;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) {
            return false;
        }
        try {
            raw = JSON.parse(trimmed);
        }
        catch {
            return false;
        }
    }
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
        return false;
    }
    const flag = raw.wall;
    return flag === true || flag === 1 || flag === 'true' || flag === '1';
}
function asPropNavalOnly(value) {
    let raw = value;
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) {
            return false;
        }
        try {
            raw = JSON.parse(trimmed);
        }
        catch {
            return false;
        }
    }
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
        return false;
    }
    const flag = raw.naval_only;
    return flag === true || flag === 1 || flag === 'true' || flag === '1';
}
function asProps(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        const name = typeof rec.name === 'string' ? rec.name.trim() : '';
        let file = typeof rec.file_name === 'string'
            ? rec.file_name.trim()
            : typeof rec.filename === 'string'
                ? rec.filename.trim()
                : typeof rec.image_path === 'string'
                    ? rec.image_path.trim()
                    : '';
        file = file.replaceAll('\\', '/');
        const slash = file.lastIndexOf('/');
        if (slash >= 0) {
            file = file.slice(slash + 1);
        }
        if (file.toLowerCase().endsWith('.png')) {
            file = file.slice(0, -4);
        }
        const variantRaw = Number(rec.variant_count);
        const footprintRaw = rec.footprint ?? rec.hex_size ?? rec.hexSize ?? '1x1';
        return {
            id: asInt(rec.id),
            name: name || file,
            file_name: file,
            variant_count: Number.isFinite(variantRaw) && variantRaw > 0
                ? Math.floor(variantRaw)
                : 1,
            is_blocker: asBoolFlag(rec.is_blocker),
            is_los_blocker: asBoolFlag(rec.is_los_blocker),
            terrain_rules: asPropTerrainRules(rec.terrain_rules),
            naval_only: asPropNavalOnly(rec.terrain_rules),
            wall: asPropWall(rec.terrain_rules),
            footprint: parseFootprintCode(footprintRaw),
            render_scale: (() => {
                const n = Number(rec.render_scale);
                return Number.isFinite(n) && n > 0 ? n : 1;
            })(),
        };
    })
        .filter((row) => row.id > 0 && row.file_name.length > 0)
        .sort((a, b) => a.id - b.id);
}
export function propRowById(catalog, propId) {
    if (catalog == null || propId == null || propId <= 0) {
        return null;
    }
    return catalog.prop.find((row) => row.id === propId) ?? null;
}
function normalizeAssetFileName(raw) {
    let file = typeof raw === 'string'
        ? raw.trim()
        : '';
    file = file.replaceAll('\\', '/');
    const slash = file.lastIndexOf('/');
    if (slash >= 0) {
        file = file.slice(slash + 1);
    }
    return file;
}
function asFeatureTypes(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        const name = typeof rec.name === 'string' ? rec.name.trim() : '';
        return {
            id: asInt(rec.id),
            name,
            default_stats: asJsonObject(rec.default_stats),
        };
    })
        .filter((row) => row.id > 0 && row.name.length > 0)
        .sort((a, b) => a.id - b.id);
}
function asFeatures(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        const name = typeof rec.name === 'string' ? rec.name.trim() : '';
        const typeRaw = rec.feature_type_id;
        const typeId = typeRaw == null || typeRaw === ''
            ? null
            : asInt(typeRaw);
        return {
            id: asInt(rec.id),
            name,
            feature_type_id: typeId != null && typeId > 0 ? typeId : null,
            is_blocker: asBoolFlag(rec.is_blocker),
            terrain_rules: asPropTerrainRules(rec.terrain_rules),
            interact: asJsonObject(rec.interact),
            stats: asJsonObject(rec.stats),
            image_path: normalizeAssetFileName(rec.image_path),
            flippable: rec.flippable == null || rec.flippable === ''
                ? true
                : asBoolFlag(rec.flippable),
            render_scale: (() => {
                const n = Number(rec.render_scale);
                return Number.isFinite(n) && n > 0 ? n : 1;
            })(),
        };
    })
        .filter((row) => row.id > 0 && row.image_path.length > 0)
        .sort((a, b) => a.id - b.id);
}
/** Catalog `feature.render_scale` (default 1). Read at draw time, not from tiles. */
export function featureRenderScale(row) {
    const n = row?.render_scale;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 1;
}
function asSignText(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        const category = typeof rec.category === 'string' ? rec.category.trim().toLowerCase() : '';
        const text = typeof rec.text === 'string' ? rec.text : '';
        const terrainRaw = rec.terrain_id;
        const terrainId = terrainRaw == null || terrainRaw === ''
            ? null
            : asInt(terrainRaw);
        const weight = Math.max(1, asInt(rec.weight) || 1);
        return {
            id: asInt(rec.id),
            category,
            text,
            terrain_id: terrainId != null && terrainId > 0 ? terrainId : null,
            weight,
        };
    })
        .filter((row) => row.id > 0 && row.category.length > 0 && row.text.length > 0)
        .sort((a, b) => a.id - b.id);
}
function asQuestText(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        const category = typeof rec.category === 'string' ? rec.category.trim().toLowerCase() : '';
        const text = typeof rec.text === 'string' ? rec.text : '';
        const resourceRaw = rec.resource_id;
        const resourceId = resourceRaw == null || resourceRaw === ''
            ? null
            : asInt(resourceRaw);
        const terrainRaw = rec.terrain_id;
        const terrainId = terrainRaw == null || terrainRaw === ''
            ? null
            : asInt(terrainRaw);
        const weight = Math.max(1, asInt(rec.weight) || 1);
        return {
            id: asInt(rec.id),
            category,
            text,
            resource_id: resourceId != null && resourceId > 0 ? resourceId : null,
            terrain_id: terrainId != null && terrainId > 0 ? terrainId : null,
            weight,
        };
    })
        .filter((row) => row.id > 0 && row.category.length > 0 && row.text.length > 0)
        .sort((a, b) => a.id - b.id);
}
/**
 * Loose pickup or claimable node art for a resource.
 * `kind` maps to `feature_type.name`: pickup → loose_resource, mine → resource_node.
 */
export function featureForResource(catalog, resourceId, kind) {
    if (!catalog || !Number.isFinite(resourceId) || resourceId <= 0) {
        return undefined;
    }
    const typeName = kind === 'mine' ? 'resource_node' : 'loose_resource';
    const typeId = catalog.feature_type.find((row) => row.name === typeName)?.id;
    const candidates = catalog.feature.filter((row) => {
        const rid = Number(row.stats?.resource_id);
        return Number.isFinite(rid) && rid === resourceId;
    });
    if (candidates.length === 0) {
        return undefined;
    }
    if (typeId != null) {
        const byType = candidates.find((row) => row.feature_type_id === typeId);
        if (byType) {
            return byType;
        }
    }
    const needle = kind === 'mine' ? 'node' : 'loose';
    const byName = candidates.find((row) => row.name.toLowerCase().includes(needle));
    if (byName) {
        return byName;
    }
    if (kind === 'mine') {
        return (candidates.find((row) => /_node\.png$/i.test(row.image_path)) ??
            candidates[0]);
    }
    return (candidates.find((row) => !/_node\.png$/i.test(row.image_path)) ??
        candidates[0]);
}
/** Alternate art filenames for UI only (resource bar). World map never
 * cross-falls between Loose and Node — each kind uses its own image_path. */
export function featureFallbackImagePaths(catalog, resourceId, kind) {
    const paths = [];
    const name = catalog?.resource.find((row) => row.id === resourceId)?.name;
    if (name) {
        const base = name.trim().replaceAll(' ', '_');
        // Prefer the kind's own filename; Node is last-resort for UI icons only.
        if (kind === 'pickup') {
            paths.push(`${base}.png`, `${base}_Node.png`);
        }
        else {
            paths.push(`${base}_Node.png`, `${base}.png`);
        }
    }
    const other = featureForResource(catalog, resourceId, kind === 'mine' ? 'pickup' : 'mine');
    if (other?.image_path) {
        paths.push(other.image_path);
    }
    return paths;
}
function asHeroTypes(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        const name = typeof rec.name === 'string' ? rec.name.trim() : '';
        const livePassive = asJsonObject(rec.passive_ability);
        const lower = name.toLowerCase();
        // Warlock / Heretic (Pandemonium): keep DB payload, finalize display copy.
        // Knight / Monk / Shaman: display fallbacks only — passive_stats come from DB as-is.
        let passive_ability = livePassive;
        if (lower === 'warlock') {
            passive_ability = {
                ...(livePassive ?? {}),
                display: 'Post-battle: converts Humanoid+Living kills into demon reinforcements. Max tier = floor(INT/6), capped by highest tier killed. Qty = INT.',
            };
        }
        else if (lower === 'heretic') {
            passive_ability = {
                ...(livePassive ?? {}),
                display: 'Post-battle: converts Humanoid+Living kills into demon reinforcements. Max tier = floor(INT/4), capped by highest tier killed. Qty = INT.',
            };
        }
        else if (lower === 'knight') {
            // Display from DB when present; fallback only if display text missing.
            passive_ability = {
                ...(livePassive ?? {}),
                display: livePassive?.display ??
                    'Chance to Retaliate Twice STR x2.5%',
            };
        }
        else if (lower === 'monk') {
            passive_ability = {
                ...(livePassive ?? {}),
                display: livePassive?.display ??
                    'Chance to Reflect Retaliation Dmg STR x2.5%',
            };
        }
        else if (lower === 'wizard') {
            passive_ability = {
                ...(livePassive ?? {}),
                mana_on_tower_magic_attack: true,
                display: livePassive?.display ??
                    'When a Tower unit deals Magic damage with an attack, gain +1 Mana (once per attack action, capped at max).',
            };
        }
        else if (lower === 'sorcerer') {
            passive_ability = {
                ...(livePassive ?? {}),
                mana_on_tower_magic_taken: true,
                display: livePassive?.display ??
                    'When a Tower unit takes Magic damage from an attack, gain +1 Mana (once per unit hit per attack action, capped at max).',
            };
        }
        else if (lower === 'cleric') {
            // End-of-round heal pool + end-of-battle rez chance.
            passive_ability = {
                ...(livePassive ?? {}),
                display: 'End of round: heals damaged Temple stacks (most-hurt first) from a pool of INT x Temple stack count HP. End of battle: 1% chance to fully resurrect a random Temple stack that took casualties.',
            };
        }
        else if (lower === 'paladin') {
            // BR S7-1: Temple stack dmg% bonuses replace the prior end-of-round execute copy.
            passive_ability = {
                ...(livePassive ?? {}),
                display: 'STR + Temple stacks bonus Physical dmg%; INT + Temple stacks bonus Magic dmg%',
            };
        }
        else if (lower === 'druid') {
            passive_ability = {
                ...(livePassive ?? {}),
                display: 'Hero gains +1 Mana when a Grove stack attacks (once per attack action, capped at max)',
            };
        }
        else if (lower === 'ranger') {
            passive_ability = {
                ...(livePassive ?? {}),
                display: livePassive?.display ??
                    'STR + (Grove stacks x5) chance to avoid enemy retaliation 1-90%',
            };
        }
        else if (lower === 'barbarian') {
            passive_ability = {
                ...(livePassive ?? {}),
                display: livePassive?.display ??
                    'Bonus Physical Dmg STR + (Fortress Stacks)%',
            };
        }
        else if (lower === 'rogue') {
            passive_ability = {
                ...(livePassive ?? {}),
                display: livePassive?.display ??
                    '+1 current hero Energy whenever a Fortress unit attack is retaliated against',
            };
        }
        else if (lower === 'forge master') {
            passive_ability = {
                ...(livePassive ?? {}),
                display: 'STR + (Non-Living Factory stacks x2) bonus Physical dmg%, applies only to Non-Living Factory units',
            };
        }
        else if (lower === 'conjurer') {
            passive_ability = {
                ...(livePassive ?? {}),
                display: 'INT + (Non-Living Factory stacks x2) bonus Magic dmg%, applies only to Non-Living Factory units',
            };
        }
        else if (lower === 'shaman') {
            // Display from DB when present; passive_stats are DB-only (no loader pin).
            passive_ability = {
                ...(livePassive ?? {}),
                display: livePassive?.display ??
                    'Battle start: drops all totems behind the army (up to INT/4, min 1). Each later round, adds 1 if below max — random Fire, Lightning, or Nature. Nature totems heal the most injured stack INT x4 at end of round if they survive.',
            };
        }
        else if (lower === 'evoker') {
            passive_ability = {
                ...(livePassive ?? {}),
                display: livePassive?.display ??
                    '(INT + Confluence STACKS in army)% bonus dmg on Hero own spell casts',
            };
        }
        else if (lower === 'death knight') {
            passive_ability = {
                ...(livePassive ?? {}),
                display: 'On Shadow: step cost × (1 - STR × 2%), max 75% reduction. While standing in Shadow, Ground units deal STR% bonus Physical damage.',
            };
        }
        return {
            id: asInt(rec.id),
            name,
            town_id: asInt(rec.town_id),
            class_type_id: rec.class_type_id == null || rec.class_type_id === ''
                ? null
                : asInt(rec.class_type_id) || null,
            // Prefer DB sort_order; fall back to id so older payloads still order stably.
            sort_order: asInt(rec.sort_order, asInt(rec.id)),
            speed: asInt(rec.speed, 10),
            strength: asInt(rec.strength, 10),
            intel: asInt(rec.intel, 10),
            defense: asInt(rec.defense, 10),
            resist: asInt(rec.resist, 10),
            crit_pct: asInt(rec.crit_pct, 10),
            crit_amt: asInt(rec.crit_amt, 10),
            stamina: asInt(rec.stamina, 10),
            passive_ability,
            // Cleric S7-3: ensure engine keys exist when DB still has the old
            // 1%-rez-only payload. DB values override defaults when present.
            // Knight / Monk / Shaman: no loader pin — passive_stats is DB-only.
            passive_stats: lower === 'cleric'
                ? {
                    heal_stat_source: 'INT',
                    heal_town_filter: 'Temple',
                    heal_timing: 'end_of_round',
                    heal_target_rule: 'most_hurt_first',
                    rez_chance_pct: 1,
                    rez_town_filter: 'Temple',
                    rez_condition: 'casualties_gt_0',
                    rez_selection: 'random',
                    rez_scope: 'full_stack',
                    ...(asJsonObject(rec.passive_stats) ?? {}),
                }
                : lower === 'death knight'
                    ? {
                        // Move reduction (existing) + S7-1 addendum Physical dmg on Shadow.
                        stat_source: 'STR',
                        pct_per_point: 2,
                        max_reduction_pct: 75,
                        condition: 'standing_in_shadow',
                        dmg_stat_source: 'STR',
                        dmg_multiplier_pct: 1,
                        unit_filter: ['Ground'],
                        ...(asJsonObject(rec.passive_stats) ?? {}),
                    }
                    : asJsonObject(rec.passive_stats),
        };
    })
        .filter((row) => row.id > 0 && row.name.length > 0);
}
function asLevels(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        return { id: asInt(rec.id), xp: asInt(rec.xp) };
    })
        .filter((row) => row.id > 0)
        .sort((a, b) => a.id - b.id);
}
function asStatBumps(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    const rec = value;
    const bumps = {};
    for (const key of HERO_STAT_KEYS) {
        if (rec[key] == null || rec[key] === '') {
            continue;
        }
        bumps[key] = asInt(rec[key]);
    }
    return bumps;
}
function asHeroLevels(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        return {
            hero_type_id: asInt(rec.hero_type_id),
            level_id: asInt(rec.level_id),
            stat_bumps: asStatBumps(rec.stat_bumps),
        };
    })
        .filter((row) => row.hero_type_id > 0 && row.level_id > 0);
}
function asAbilityCost(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.trunc(value));
    }
    if (typeof value === 'string' && value.trim()) {
        const n = Number(value);
        return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        let total = 0;
        for (const amount of Object.values(value)) {
            const n = Number(amount);
            if (Number.isFinite(n)) {
                total += Math.trunc(n);
            }
        }
        return Math.max(0, total);
    }
    return 0;
}
function asAbilities(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        const name = typeof rec.name === 'string' ? rec.name.trim() : '';
        const description = typeof rec.description === 'string' ? rec.description.trim() : '';
        return {
            id: asInt(rec.id),
            discipline_id: asInt(rec.discipline_id),
            level_id: asInt(rec.level_id),
            name,
            description,
            resource_id: asInt(rec.resource_id),
            cost: asAbilityCost(rec.cost),
            cooldown_id: asInt(rec.cooldown_id),
            target_id: asOptionalId(rec.target_id),
            ability_type_id: asOptionalId(rec.ability_type_id),
            stats: normalizeAbilityStatFlags(asJsonObject(rec.stats)),
        };
    })
        .filter((row) => row.id > 0 && row.name.length > 0);
}
/** Boolean-like ability.stats keys — coerce 1/"true" at catalog load. */
const ABILITY_BOOL_STAT_KEYS = [
    'resorts_remaining_initiative',
    'reveals_enemy_stats',
    'forces_return_to_start',
    'persists_on_summon',
    'duplicates_target',
    'places_on_nearest_open_hex',
    'insert_into_current_round_queue',
    'summon_as_separate_stacks',
    'condition_immunity',
    'revive_on_dmg_dealt',
    'drain_heal',
    'vampiric_strike',
    'grants_extra_turn',
    'grants_kill_on_overflow',
    'guaranteed_max_dmg',
    'guaranteed_hit',
    'disable_min_range_penalty',
    'guarantees_miss_next_physical_hit',
    'instant',
    'no_turn_cost',
    'forces_max_dmg_on_target',
    'forces_min_dmg_on_target',
    'prevents_critical',
    'grants_ignore_target_armor',
    'physical_only',
    'reflects_physical_only',
    'ends_round_immediately',
    'skips_duration_tick',
    'direction_by_target_side',
    'clears_conditions',
    'clears_stat_debuffs',
    'grants_condition_immunity',
    'clears_terrain',
    'clears_los_blockers',
    'heals_to_full',
    'snapshot_qty_on_cast',
    'prevents_death_once',
    'targets_hexes',
    'friendly_takes_dmg',
    'no_stat_threshold',
    'before_retaliation',
    'ignores_retaliation',
    'insert_into_current_round_queue',
    'kill_on_overflow',
    'breaks_on_damage',
    'skip_occupied_adjacent',
    'redistribute_if_single_adjacent',
    'self_teleport',
    'respects_hex_size',
    'ignores_mitigation',
    'second_attack_after_retaliation',
    'blocks_direct_targeting',
    'aoe_still_hits',
    'can_still_retaliate',
    'retaliates_before_attack_resolves',
    'targets_empty_hexes',
    'prefers_empty_ground_effect_hexes',
    'ignores_sublethal_damage',
    'show_placement_preview',
    'avoids_occupied_hexes',
    'stops_if_blocked',
];
function normalizeAbilityStatFlags(stats) {
    if (!stats) {
        return null;
    }
    let changed = false;
    const next = { ...stats };
    for (const key of ABILITY_BOOL_STAT_KEYS) {
        if (!(key in next) || next[key] == null) {
            continue;
        }
        const raw = next[key];
        const normalized = asBoolFlag(raw);
        if (raw !== normalized) {
            next[key] = normalized;
            changed = true;
        }
    }
    return changed ? next : stats;
}
function fillDesignedAbilities(abilities, targets, types) {
    const friendSingle = targets.find((row) => row.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_single')?.id ?? 1;
    const buffType = types.find((row) => row.value.trim().toLowerCase() === 'buff')?.id ?? 2;
    return abilities.map((row) => {
        if (row.name === 'Vampiric Strike') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: { revive_on_dmg_dealt: true, ...(row.stats ?? {}) },
            };
        }
        if (row.name === 'Raise Skeleton') {
            const friendAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all')?.id ?? 3;
            const summonType = types.find((entry) => entry.value.trim().toLowerCase() === 'summon')?.id ?? 4;
            return {
                ...row,
                target_id: row.target_id ?? friendAll,
                ability_type_id: row.ability_type_id ?? summonType,
                stats: {
                    kill_pct_stat: 4,
                    kill_tag: 2,
                    summon_tag: 12,
                    persists_on_summon: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Recruit the Dead') {
            const friendAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all')?.id ?? 3;
            const summonType = types.find((entry) => entry.value.trim().toLowerCase() === 'summon')?.id ?? 4;
            const rest = { ...(row.stats ?? {}) };
            delete rest.requires_existing_summon_tag;
            return {
                ...row,
                target_id: row.target_id ?? friendAll,
                ability_type_id: row.ability_type_id ?? summonType,
                stats: {
                    kill_pct_stat: 4,
                    kill_tag: 2,
                    summon_tag: 12,
                    persists_on_summon: true,
                    ...rest,
                },
            };
        }
        if (row.name === 'Summon Bound Spirit') {
            const friendAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all')?.id ?? 3;
            const summonType = types.find((entry) => entry.value.trim().toLowerCase() === 'summon')?.id ?? 4;
            return {
                ...row,
                target_id: row.target_id ?? friendAll,
                ability_type_id: row.ability_type_id ?? summonType,
                stats: {
                    persists_on_summon: false,
                    summon_qty_int_stat: 1,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Unstable Rift') {
            const summonType = types.find((entry) => entry.value.trim().toLowerCase() === 'summon')?.id ?? 4;
            const rest = { ...(row.stats ?? {}) };
            // S7-11: silence_schedule was a misnamed bolt-count schedule.
            const schedule = (Array.isArray(rest.bolt_schedule) ? rest.bolt_schedule : null) ??
                (Array.isArray(rest.silence_schedule) ? rest.silence_schedule : null) ??
                [3, 2, 1];
            delete rest.silence_schedule;
            return {
                ...row,
                ability_type_id: row.ability_type_id ?? summonType,
                stats: {
                    ...rest,
                    summon_count: 3,
                    persists_on_summon: false,
                    bolt_schedule: schedule,
                },
            };
        }
        if (row.name === 'Earth Spikes') {
            const allAoe = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'all_aoe')?.id ?? 8;
            const attackType = types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1;
            return {
                ...row,
                target_id: row.target_id ?? allAoe,
                ability_type_id: row.ability_type_id ?? attackType,
                stats: {
                    shape: 'multi',
                    radius: 4,
                    bolts_stat: 1,
                    int_dmg: 1.5,
                    friendly_takes_dmg: false,
                    move_type: 'random',
                    move_dist_range: [1, 2],
                    move_dist_fallback: 3,
                    // Terrain object per erupted hex — summon_unit_id from DB.
                    targets_hexes: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Brisk Renewal') {
            const friendAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all')?.id ?? 3;
            const buffTypeId = types.find((entry) => entry.value.trim().toLowerCase() === 'buff')?.id ?? 2;
            return {
                ...row,
                target_id: row.target_id ?? friendAll,
                ability_type_id: row.ability_type_id ?? buffTypeId,
                stats: {
                    recurring_trigger: 'end_of_round',
                    heal_pct_stat: 2,
                    heal_min: 1,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Gift of Gaia') {
            const allAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'all_all')?.id ??
                targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all')?.id ??
                3;
            const utilType = types.find((entry) => entry.value.trim().toLowerCase() === 'utility')
                ?.id ?? 5;
            return {
                ...row,
                target_id: row.target_id ?? allAll,
                ability_type_id: row.ability_type_id ?? utilType,
                stats: {
                    clear_chance_pct_stat: 2,
                    clears_terrain: true,
                    clears_los_blockers: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Ice Shards') {
            const enemySingle = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') ===
                'enemy_single')?.id ?? 4;
            const attackType = types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1;
            // Live DB has swapped stats with Earthquake on some rows — keep placement keys.
            const raw = { ...(row.stats ?? {}) };
            delete raw.min_dmg;
            delete raw.max_dmg;
            delete raw.inflicts_condition;
            delete raw.chance_pct_flat_stat;
            delete raw.no_stat_threshold;
            delete raw.duration;
            delete raw.resist_stat;
            return {
                ...row,
                target_id: enemySingle,
                ability_type_id: row.ability_type_id ?? attackType,
                stats: {
                    ...raw,
                    int_dmg: 5,
                    summon_count: 5,
                    shard_radius: 1,
                    skip_occupied_adjacent: true,
                    redistribute_if_single_adjacent: true,
                },
            };
        }
        if (row.name === 'Blizzard') {
            const enemyAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_all')?.id ?? 6;
            const attackType = types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1;
            return {
                ...row,
                target_id: row.target_id ?? enemyAll,
                ability_type_id: row.ability_type_id ?? attackType,
                stats: {
                    ...(row.stats ?? {}),
                    min_dmg: 10,
                    max_dmg: 20,
                    // BR S7-4: Slow (condition 12), not Stun — differentiates from Earthquake.
                    inflicts_condition: 12,
                    duration: 1,
                    resist_stat: 'resistance',
                },
            };
        }
        if (row.name === 'Earthquake') {
            const enemyAoe = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_aoe')?.id ?? 5;
            const attackType = types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1;
            const raw = { ...(row.stats ?? {}) };
            delete raw.skip_occupied_adjacent;
            delete raw.shard_radius;
            delete raw.redistribute_if_single_adjacent;
            delete raw.summon_unit_id;
            delete raw.summon_count;
            delete raw.int_dmg;
            return {
                ...row,
                target_id: row.target_id ?? enemyAoe,
                ability_type_id: row.ability_type_id ?? attackType,
                stats: {
                    ...raw,
                    min_dmg: 10,
                    max_dmg: 20,
                    shape: 'aoe',
                    radius: 3,
                    inflicts_condition: 2,
                    duration: 1,
                    resist_stat: 'resistance',
                },
            };
        }
        if (row.name === 'Summon Mud Golem') {
            const friendAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all')?.id ?? 3;
            const summonType = types.find((entry) => entry.value.trim().toLowerCase() === 'summon')?.id ?? 4;
            return {
                ...row,
                target_id: row.target_id ?? friendAll,
                ability_type_id: row.ability_type_id ?? summonType,
                stats: {
                    summon_qty_stat_div: 2,
                    persists_on_summon: true,
                    insert_into_current_round_queue: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Time Warp') {
            return {
                ...row,
                stats: {
                    grants_extra_turn: true,
                    duration: 1,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Mass Slow') {
            const enemyAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_all')?.id ?? 6;
            return {
                ...row,
                target_id: enemyAll,
            };
        }
        if (row.name === 'Berserk') {
            const rest = { ...(row.stats ?? {}) };
            // S7-10: strip legacy permanent-only payload; force duration + Res=0.
            delete rest.def_mult;
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    ...rest,
                    min_dmg_mult: 2,
                    max_dmg_mult: 2,
                    set_defense: 0,
                    set_resistance: 0,
                    duration_stat_div: 9,
                },
            };
        }
        if (row.name === 'Execute') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    grants_kill_on_overflow: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Furious Rush') {
            const rest = { ...(row.stats ?? {}) };
            return {
                ...row,
                target_id: friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    movement: 'max_distance',
                    speed_bonus_stat_div: 10,
                    max_dmg_mult_stat_div: 10,
                    guaranteed_max_dmg: true,
                    guaranteed_hit: true,
                    crit_pct_flat_stat_div: 10,
                    crit_amt_flat_stat_div: 10,
                    no_stat_threshold: true,
                    uses: 1,
                    ...rest,
                },
            };
        }
        if (row.name === 'Critical Attacks') {
            const friendAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all')?.id ?? 3;
            return {
                ...row,
                target_id: row.target_id ?? friendAll,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    crit_pct_flat_stat: 1.5,
                    crit_amt_flat_stat: 0.8,
                    no_stat_threshold: true,
                    min_crit_bonus_dmg: 1,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Adrenaline Rush') {
            const friendAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all')?.id ?? 3;
            const rest = { ...(row.stats ?? {}) };
            delete rest.duration;
            return {
                ...row,
                target_id: row.target_id ?? friendAll,
                ability_type_id: row.ability_type_id ?? buffType,
                // resorts_remaining_initiative must come from DB stats (not hardcoded).
                stats: {
                    speed_buff_stat_div: 4,
                    uses: 1,
                    ...rest,
                },
            };
        }
        if (row.name === 'Blood Lust') {
            const friendAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all')?.id ?? 3;
            const utilityType = types.find((entry) => entry.value.trim().toLowerCase() === 'utility')?.id ?? 5;
            const rest = { ...(row.stats ?? {}) };
            // S7-10: replace % Def decay with flat halving.
            delete rest.def_debuff_pct_stat;
            return {
                ...row,
                target_id: row.target_id ?? friendAll,
                ability_type_id: row.ability_type_id ?? utilityType,
                stats: {
                    ...rest,
                    dmg_buff_pct_stat: 10,
                    def_divisor: 2,
                    def_floor: 1,
                    duration: 1,
                },
            };
        }
        if (row.name === 'Steady Aim') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    disable_min_range_penalty: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Parry') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    guarantees_miss_next_physical_hit: true,
                    uses: 1,
                    ignores_retaliation: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Call Beast') {
            const friendAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all')?.id ?? 3;
            const summonType = types.find((entry) => entry.value.trim().toLowerCase() === 'summon')?.id ?? 4;
            return {
                ...row,
                target_id: row.target_id ?? friendAll,
                ability_type_id: row.ability_type_id ?? summonType,
                stats: {
                    summon_qty_stat_div: 2,
                    persists_on_summon: true,
                    insert_into_current_round_queue: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Critical Chance') {
            const friendAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all')?.id ?? 3;
            return {
                ...row,
                target_id: row.target_id ?? friendAll,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    crit_pct_flat_stat: 2,
                    no_stat_threshold: true,
                    min_crit_bonus_dmg: 1,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Barrage') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    grants_second_attack_pct: 50,
                    second_attack_pct_flat_stat: 1,
                    before_retaliation: true,
                    no_stat_threshold: true,
                    uses_stat_div: 5,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Overcharge') {
            const attackType = types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1;
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? attackType,
                stats: {
                    shape: 'pulse',
                    guaranteed_max_dmg: true,
                    instant: true,
                    no_turn_cost: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Camouflage') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    evasion_pct: 25,
                    duration_stat_div: 7,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Mark Target') {
            const enemySingle = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single')?.id ?? 4;
            const debuffType = types.find((entry) => entry.value.trim().toLowerCase() === 'debuff')?.id ?? 3;
            return {
                ...row,
                target_id: enemySingle,
                ability_type_id: row.ability_type_id ?? debuffType,
                stats: {
                    forces_max_dmg_on_target: true,
                    hit_count_stat_div: 7,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Expose') {
            const enemyAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_all')?.id ?? 5;
            const utilityType = types.find((entry) => entry.value.trim().toLowerCase() === 'utility')?.id ?? 5;
            return {
                ...row,
                target_id: row.target_id ?? enemyAll,
                ability_type_id: row.ability_type_id ?? utilityType,
                stats: {
                    reveals_enemy_stats: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Forced Retreat' || row.name === 'Retreat') {
            const enemySingle = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single')?.id ?? 4;
            const debuffType = types.find((entry) => entry.value.trim().toLowerCase() === 'debuff')?.id ?? 3;
            return {
                ...row,
                target_id: row.target_id ?? enemySingle,
                ability_type_id: row.ability_type_id ?? debuffType,
                stats: {
                    forces_return_to_start: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Curse' || row.id === 2) {
            const enemySingle = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single')?.id ?? 4;
            const debuffType = types.find((entry) => entry.value.trim().toLowerCase() === 'debuff')?.id ?? 3;
            const rest = { ...(row.stats ?? {}) };
            // S7-11: replace obsolete flat_dmg attack payload.
            delete rest.flat_dmg;
            return {
                ...row,
                target_id: row.target_id ?? enemySingle,
                ability_type_id: row.ability_type_id ?? debuffType,
                stats: {
                    ...rest,
                    duration_stat_div: 10,
                    forces_min_dmg_on_target: true,
                    prevents_critical: true,
                },
            };
        }
        if (row.name === 'Fervor') {
            const friendAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all')?.id ?? 3;
            const buffType = types.find((entry) => entry.value.trim().toLowerCase() === 'buff')?.id ?? 2;
            return {
                ...row,
                target_id: row.target_id ?? friendAll,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    chain_trigger_pct_stat: 1,
                    duration: 3,
                    applies_to: ['turn', 'retaliation'],
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Battle Cry') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    retaliation_dmg_pct: 100,
                    uses_stat_div: 6,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Hyper Focus') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    condition_immunity: true,
                    uses: 1,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Illusions') {
            const friendAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all')?.id ?? 3;
            const summonType = types.find((entry) => entry.value.trim().toLowerCase() === 'summon')?.id ?? 4;
            return {
                ...row,
                target_id: row.target_id ?? friendAll,
                ability_type_id: row.ability_type_id ?? summonType,
                stats: {
                    summon_qty_stat_div: 3,
                    summon_as_separate_stacks: true,
                    placement: 'map_center_scattered',
                    persists_on_summon: false,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Animate Weapon') {
            const friendAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all')?.id ?? 3;
            const summonType = types.find((entry) => entry.value.trim().toLowerCase() === 'summon')?.id ?? 4;
            return {
                ...row,
                target_id: row.target_id ?? friendAll,
                ability_type_id: row.ability_type_id ?? summonType,
                stats: {
                    summon_qty_stat_div: 2,
                    persists_on_summon: false,
                    insert_into_current_round_queue: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Mirror Image') {
            const summonType = types.find((entry) => entry.value.trim().toLowerCase() === 'summon')?.id ?? 4;
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? summonType,
                stats: {
                    duplicates_target: true,
                    duplicate_hp_cap_stat: 1,
                    places_on_nearest_open_hex: true,
                    insert_into_current_round_queue: true,
                    persists_on_summon: false,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Arcane Shield') {
            const enemySingle = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single')?.id ?? 4;
            const summonType = types.find((entry) => entry.value.trim().toLowerCase() === 'summon')?.id ?? 4;
            return {
                ...row,
                target_id: row.target_id ?? enemySingle,
                ability_type_id: row.ability_type_id ?? summonType,
                stats: {
                    summon_count: 4,
                    placement: 'front_of_target',
                    persists_on_summon: false,
                    ...(row.stats ?? {}),
                    // Pure blocker — never join initiative (same as Wall/Drawbridge).
                    insert_into_current_round_queue: false,
                },
            };
        }
        if (row.name === 'Charge') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                // resorts_remaining_initiative must come from DB stats (not hardcoded).
                stats: {
                    speed_buff_flat_stat: 1,
                    duration: 1,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Guard') {
            const rest = { ...(row.stats ?? {}) };
            // S7-10: additive Def (STR/3), not ×2 multiplier.
            delete rest.def_mult;
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    ...rest,
                    def_bonus_stat_div: 3,
                    duration_stat_div: 5,
                },
            };
        }
        if (row.name === 'Rend') {
            const enemySingle = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') ===
                'enemy_single')?.id ?? 4;
            const rest = { ...(row.stats ?? {}) };
            return {
                ...row,
                target_id: row.target_id ?? enemySingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    ...rest,
                    set_defense: 0,
                    duration_stat_div: 5,
                },
            };
        }
        if (row.name === 'Sunder Armor') {
            const friendAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all')?.id ?? 3;
            const rest = { ...(row.stats ?? {}) };
            return {
                ...row,
                // S7-10: army-wide (DB may still say friend_single).
                target_id: friendAll,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    ...rest,
                    physical_only: true,
                    grants_ignore_target_armor: true,
                    duration_stat_div: 9,
                },
            };
        }
        if (row.name === 'Stoneskin') {
            const friendAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all')?.id ?? 3;
            const rest = { ...(row.stats ?? {}) };
            // S7-10: flat Res bonus — strip old Def% key.
            delete rest.unit_defense_pct_stat;
            return {
                ...row,
                target_id: row.target_id ?? friendAll,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    ...rest,
                    res_bonus_stat_div: 7,
                    duration_stat_div: 5,
                },
            };
        }
        if (row.name === 'Shield Wall') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                resource_id: row.resource_id > 0 ? row.resource_id : 1,
                stats: {
                    def_mult_stat_div: 5,
                    res_mult_stat_div: 5,
                    duration_stat_div: 5,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Immunity') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                resource_id: row.resource_id > 0 ? row.resource_id : 1,
                stats: {
                    dmg_taken_pct: 0,
                    hit_count_stat_div: 9,
                    ignores_retaliation: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Rally') {
            const friendAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all')?.id ?? 3;
            const utilityType = types.find((entry) => entry.value.trim().toLowerCase() === 'utility')?.id ?? 5;
            return {
                ...row,
                target_id: row.target_id ?? friendAll,
                ability_type_id: row.ability_type_id ?? utilityType,
                stats: {
                    ends_round_immediately: true,
                    skips_duration_tick: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Mutation') {
            const allSingle = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'all_single')?.id ?? 7;
            const utilityType = types.find((entry) => entry.value.trim().toLowerCase() === 'utility')?.id ?? 5;
            return {
                ...row,
                target_id: allSingle,
                ability_type_id: row.ability_type_id ?? utilityType,
                description: "Target any single stack, either side. Friendly targets are buffed, enemy targets are debuffed: Speed, Defense, Resistance, Min/Max damage, Max Range, and Max HP all shift by the same amount, scaled off the caster's Intelligence.",
                stats: {
                    delta_all_stats_stat: 0.10,
                    direction_by_target_side: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Cleanse') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    clears_conditions: true,
                    clears_stat_debuffs: true,
                    secondary_random_targets_stat_div: 5,
                    secondary_pool: 'friend_with_negative_condition',
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Mass Dispel') {
            const friendAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_all')?.id ?? 3;
            return {
                ...row,
                target_id: row.target_id ?? friendAll,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    clears_conditions: true,
                    clears_stat_debuffs: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Iron Will') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    clears_conditions: true,
                    clears_stat_debuffs: true,
                    grants_condition_immunity: true,
                    duration: 1,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Guardian Angel') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    snapshot_qty_on_cast: true,
                    prevents_death_once: true,
                    uses: 1,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Fortify') {
            const friendAoe = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_aoe')?.id ?? 2;
            return {
                ...row,
                target_id: row.target_id ?? friendAoe,
                ability_type_id: row.ability_type_id ?? buffType,
                resource_id: row.resource_id > 0 ? row.resource_id : 1,
                stats: {
                    shape: 'aoe',
                    radius_stat_div: 6,
                    ignores_sublethal_damage: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Last Stand') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                resource_id: row.resource_id > 0 ? row.resource_id : 1,
                stats: {
                    min_qty_stat_div: 8,
                    min_qty_last_unit_hp: 1,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Barrier') {
            const allSingle = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'all_single')?.id ?? 7;
            const utilityType = types.find((entry) => entry.value.trim().toLowerCase() === 'utility')?.id ?? 5;
            // Force empty-hex line placement. Live DB still has target_id=8 (all_aoe).
            const raw = { ...(row.stats ?? {}) };
            delete raw.targets_empty_hexes;
            delete raw.show_placement_preview;
            return {
                ...row,
                target_id: allSingle,
                ability_type_id: row.ability_type_id ?? utilityType,
                resource_id: row.resource_id > 0 ? row.resource_id : 1,
                stats: {
                    ground_effect_id: 4,
                    line_length_stat_div: 5,
                    avoids_occupied_hexes: true,
                    ...raw,
                    targets_empty_hexes: true,
                    show_placement_preview: true,
                },
            };
        }
        if (row.name === 'Push Back') {
            const enemySingle = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single')?.id ?? 4;
            const attackType = types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1;
            return {
                ...row,
                target_id: row.target_id ?? enemySingle,
                ability_type_id: row.ability_type_id ?? attackType,
                resource_id: row.resource_id > 0 ? row.resource_id : 1,
                stats: {
                    str_dmg: 2.5,
                    push_dist_stat_div: 7,
                    push_direction: 'away_from_caster',
                    stops_if_blocked: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Wind Shear' || row.id === 42) {
            const enemySingle = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single')?.id ?? 4;
            const attackType = types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1;
            return {
                ...row,
                target_id: row.target_id ?? enemySingle,
                ability_type_id: row.ability_type_id ?? attackType,
                resource_id: row.resource_id > 0 ? row.resource_id : 2,
                stats: {
                    shape: 'cleave',
                    int_dmg: 2,
                    chance_pct: 50,
                    resist_stat: 'resistance',
                    push_dist: 1,
                    push_direction: 'away_from_caster',
                    stops_if_blocked: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Chain Lightning' || row.id === 48) {
            const enemySingle = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single')?.id ?? 4;
            const attackType = types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1;
            return {
                ...row,
                target_id: row.target_id ?? enemySingle,
                ability_type_id: row.ability_type_id ?? attackType,
                resource_id: row.resource_id > 0 ? row.resource_id : 2,
                stats: {
                    shape: 'chain',
                    int_dmg: 3,
                    jumps: 5,
                    falloff: 15,
                    allow_repeat_target: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Fireball' || row.id === 41) {
            const enemySingle = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single')?.id ?? 4;
            const attackType = types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1;
            return {
                ...row,
                target_id: row.target_id ?? enemySingle,
                ability_type_id: row.ability_type_id ?? attackType,
                resource_id: row.resource_id > 0 ? row.resource_id : 2,
                stats: {
                    int_dmg: 2,
                    ground_effect_id: 6,
                    fire_radius_stat_div: 9,
                    fire_drop_chance_pct: 50,
                    includes_target_hex: true,
                    ...(row.stats ?? {}),
                    // Force after DB spread — `terrain` ids Water / Shallow / Swamp.
                    fizzle_terrain_ids: (() => {
                        const fromDb = asIdList(row.stats
                            ?.fizzle_terrain_ids);
                        return fromDb.length > 0 ? fromDb : [3, 20, 21];
                    })(),
                },
            };
        }
        if (row.name === 'Wildfire' || row.id === 45) {
            const enemySingle = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single')?.id ?? 4;
            const attackType = types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1;
            return {
                ...row,
                target_id: row.target_id ?? enemySingle,
                ability_type_id: row.ability_type_id ?? attackType,
                resource_id: row.resource_id > 0 ? row.resource_id : 2,
                stats: {
                    ground_effect_id: 6,
                    line_from_caster_to_target: true,
                    skips_los_blocker_hexes: true,
                    ...(row.stats ?? {}),
                    fizzle_terrain_ids: (() => {
                        const fromDb = asIdList(row.stats
                            ?.fizzle_terrain_ids);
                        return fromDb.length > 0 ? fromDb : [3, 20, 21];
                    })(),
                },
            };
        }
        if (row.name === 'Spell Reflect' || row.id === 46) {
            const friendSingle = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') ===
                'friend_single')?.id ?? 2;
            const buffType = types.find((entry) => entry.value.trim().toLowerCase() === 'buff')?.id ?? 2;
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                resource_id: row.resource_id > 0 ? row.resource_id : 2,
                stats: {
                    uses_stat_div: 7,
                    redirects_dmg_type: 'Magic',
                    redirect_target: 'random_enemy',
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Meteor' || row.id === 47) {
            const allAll = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'all_all')?.id ??
                targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'all_aoe')?.id ??
                8;
            const attackType = types.find((entry) => entry.value.trim().toLowerCase() === 'attack')?.id ?? 1;
            // Force whole-board auto-cast. Live DB may still ship all_aoe / aimed targeting.
            return {
                ...row,
                target_id: allAll,
                ability_type_id: row.ability_type_id ?? attackType,
                resource_id: row.resource_id > 0 ? row.resource_id : 2,
                stats: {
                    shape: 'multi',
                    bolts_stat: 2,
                    targets_hexes: true,
                    avoids_friendly_hexes: true,
                    avoids_los_blocker_hexes: true,
                    int_dmg: 3,
                    drops_fire_on_hit: true,
                    ground_effect_id: 6,
                    move_type: 'random',
                    ...(row.stats ?? {}),
                    fizzle_terrain_ids: (() => {
                        const fromDb = asIdList(row.stats
                            ?.fizzle_terrain_ids);
                        return fromDb.length > 0 ? fromDb : [3, 20, 21];
                    })(),
                },
            };
        }
        if (row.name === 'Confuse') {
            const enemySingle = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'enemy_single')?.id ?? 4;
            const debuffType = types.find((entry) => entry.value.trim().toLowerCase() === 'debuff')?.id ?? 3;
            return {
                ...row,
                target_id: row.target_id ?? enemySingle,
                ability_type_id: row.ability_type_id ?? debuffType,
                stats: {
                    inflicts_condition: 3,
                    resist_stat: 'resistance',
                    duration: 1,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Shadow Step') {
            const friendSingleTarget = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'friend_single')?.id ?? 1;
            const utilityType = types.find((entry) => entry.value.trim().toLowerCase() === 'utility')?.id ?? 5;
            return {
                ...row,
                target_id: row.target_id ?? friendSingleTarget,
                ability_type_id: row.ability_type_id ?? utilityType,
                stats: {
                    self_teleport: true,
                    respects_hex_size: true,
                    move_delay_ms: 500,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Deflect') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    takes_dmg_source: 'attacker_min_dmg',
                    dmg_taken_pct: 50,
                    ignores_mitigation: true,
                    uses_stat_div: 7,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Double Tap') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    second_attack_after_retaliation: true,
                    uses_stat_div: 10,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Vanish') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    inflicts_condition: 9,
                    duration_stat_div: 7,
                    blocks_direct_targeting: true,
                    aoe_still_hits: true,
                    can_still_retaliate: true,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Preemptive Strike') {
            return {
                ...row,
                target_id: row.target_id ?? friendSingle,
                ability_type_id: row.ability_type_id ?? buffType,
                stats: {
                    retaliates_before_attack_resolves: true,
                    uses_stat_div: 10,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Smoke Bomb') {
            const allAoe = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') === 'all_aoe')?.id ?? 8;
            const utilityType = types.find((entry) => entry.value.trim().toLowerCase() === 'utility')
                ?.id ?? 5;
            return {
                ...row,
                target_id: row.target_id ?? allAoe,
                ability_type_id: row.ability_type_id ?? utilityType,
                stats: {
                    shape: 'aoe',
                    radius: 2,
                    ground_effect_id: 1,
                    evasion_pct_flat_stat: 3,
                    // Rod: duration not specified — default 3 rounds until confirmed.
                    duration: 3,
                    ...(row.stats ?? {}),
                },
            };
        }
        if (row.name === 'Explosive Trap') {
            const allSingle = targets.find((entry) => entry.value.trim().toLowerCase().replaceAll(' ', '_') ===
                'all_single')?.id ?? 7;
            const utilityType = types.find((entry) => entry.value.trim().toLowerCase() === 'utility')
                ?.id ?? 5;
            // Force placement targeting: empty hexes, never all_aoe. DB currently
            // ships target_id=8 (all_aoe), which would resolve as a whole-board cast.
            const raw = { ...(row.stats ?? {}) };
            delete raw.shape;
            delete raw.radius;
            const num = (value, fallback) => {
                const n = typeof value === 'number' ? value : Number(value);
                return Number.isFinite(n) ? n : fallback;
            };
            return {
                ...row,
                target_id: allSingle,
                ability_type_id: row.ability_type_id ?? utilityType,
                stats: {
                    ...raw,
                    // Placement: whole-board empty hexes. Explosion radius is separate.
                    targets_empty_hexes: true,
                    ground_effect_id: 2,
                    flat_dmg_flat_stat: num(raw.flat_dmg_flat_stat, 3),
                    radius_stat_div: num(raw.radius_stat_div, 10),
                    chance_pct_flat_stat: num(raw.chance_pct_flat_stat, 3),
                    inflicts_condition: num(raw.inflicts_condition, 2),
                    resist_stat: typeof raw.resist_stat === 'string' ? raw.resist_stat : 'resistance',
                    // Always enemy-only for blast + trigger (DB may omit the flag).
                    friendly_takes_dmg: false,
                },
            };
        }
        return row;
    })
        .map(applyS75AbilityNormalization)
        .map(applyS712StickyBattleDuration);
}
/**
 * BR S7-12: sticky-for-battle lifecycle marker for tooltip `[duration]`.
 * `duration: null` → "for the battle". No combat change — duration already omitted
 * on these abilities means permanent until battle end.
 */
function applyS712StickyBattleDuration(row) {
    const stickyIds = new Set([3, 18, 34, 40, 51, 69, 76, 84, 86, 90]);
    const stickyNames = new Set([
        'sap strength',
        'bless',
        'mutation',
        'mass slow',
        'expose',
        'critical chance',
        'last stand',
        'execute',
        'critical attacks',
        'slow',
    ]);
    const lower = row.name.trim().toLowerCase();
    if (!stickyIds.has(row.id) && !stickyNames.has(lower)) {
        return row;
    }
    const stats = { ...(row.stats ?? {}) };
    // Prefer duration_stat_div when present (round-scaled); do not clobber it.
    if (Object.prototype.hasOwnProperty.call(stats, 'duration_stat_div')) {
        return row;
    }
    stats.duration = null;
    return { ...row, stats };
}
/**
 * BR S7-5: normalize condition chance / resist patterns on listed hero abilities.
 * Final pass so older fillDesignedAbilities blocks cannot leave resist_stat or
 * chance_pct_flat_stat on rows that must not have them.
 */
function applyS75AbilityNormalization(row) {
    const id = row.id;
    const name = row.name.trim().toLowerCase();
    const stats = { ...(row.stats ?? {}) };
    const stripResistAndLegacyChance = () => {
        delete stats.resist_stat;
        delete stats.no_stat_threshold;
        delete stats.chance_pct_flat_stat;
    };
    // Condition-is-the-point: 100%, resistable.
    if (id === 59 || name === 'confuse') {
        stats.chance_pct = 100;
        stats.resist_stat = 'resistance';
        stats.duration = 1;
        stats.inflicts_condition = 3;
        return { ...row, stats };
    }
    if (id === 95 || name === 'fear') {
        stripResistAndLegacyChance();
        stats.chance_pct = 100;
        stats.resist_stat = 'resistance';
        stats.duration = 1;
        stats.inflicts_condition = 1;
        return { ...row, stats };
    }
    // Condition-as-side-effect: tier flat %, NOT resistable.
    if (id === 26 || name === 'mind spike') {
        stripResistAndLegacyChance();
        stats.chance_pct = 25;
        stats.duration = 1;
        stats.inflicts_condition = 4;
        return { ...row, stats };
    }
    // Mass Silence: Rod exception (then standing rule) — AOE total-action-denial
    // conditions are resistable even as the ability's primary side effect.
    if (id === 27 || name === 'mass silence') {
        delete stats.chance_pct_flat_stat;
        delete stats.no_stat_threshold;
        stats.chance_pct = 25;
        stats.resist_stat = 'resistance';
        stats.duration = 1;
        stats.inflicts_condition = 4;
        return { ...row, stats };
    }
    // Blizzard / Earthquake: damage always lands; riding Slow/Stun is resistable.
    if (id === 14 || name === 'blizzard') {
        delete stats.chance_pct_flat_stat;
        delete stats.no_stat_threshold;
        stats.chance_pct = 33;
        stats.resist_stat = 'resistance';
        stats.duration = 1;
        stats.inflicts_condition = 12;
        return { ...row, stats };
    }
    if (id === 61 || name === 'explosive trap') {
        stripResistAndLegacyChance();
        stats.chance_pct = 33;
        stats.duration = 1;
        stats.inflicts_condition = 2;
        return { ...row, stats };
    }
    if (id === 15 || name === 'earthquake') {
        delete stats.chance_pct_flat_stat;
        delete stats.no_stat_threshold;
        stats.chance_pct = 50;
        stats.resist_stat = 'resistance';
        stats.duration = 1;
        stats.inflicts_condition = 2;
        return { ...row, stats };
    }
    if (id === 79 || name === 'shield slam') {
        stripResistAndLegacyChance();
        stats.chance_pct = 50;
        stats.duration = 1;
        stats.inflicts_condition = 2;
        return { ...row, stats };
    }
    // Knockback — 100%, not resistable (not a condition).
    if (id === 42 || name === 'wind shear') {
        delete stats.resist_stat;
        stats.chance_pct = 100;
        return { ...row, stats };
    }
    return row;
}
function asGroundEffects(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        const id = asInt(rec.id);
        const name = typeof rec.name === 'string' ? rec.name.trim() : '';
        const description = typeof rec.description === 'string' ? rec.description.trim() : null;
        const image = typeof rec.image_path === 'string' ? rec.image_path.trim() : '';
        const rules = asJsonObject(rec.display_rules);
        const layerRaw = typeof rules?.layer === 'string' ? rules.layer.trim().toLowerCase() : '';
        const display_rules = layerRaw === 'above_units' || layerRaw === 'below_units'
            ? { layer: layerRaw }
            : null;
        return {
            id,
            name,
            description: description || null,
            mechanic: asJsonObject(rec.mechanic),
            hidden: asBoolFlag(rec.hidden),
            image_path: image || null,
            display_rules,
        };
    })
        .filter((row) => row.id > 0 && row.name.length > 0);
}
function asAbilityResources(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        const value = typeof rec.value === 'string'
            ? rec.value.trim()
            : typeof rec.name === 'string'
                ? rec.name.trim()
                : '';
        return { id: asInt(rec.id), value };
    })
        .filter((row) => row.id > 0 && row.value.length > 0)
        .sort((a, b) => a.id - b.id);
}
function asAbilityCooldowns(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        const value = typeof rec.value === 'string'
            ? rec.value.trim()
            : typeof rec.name === 'string'
                ? rec.name.trim()
                : '';
        const description = typeof rec.description === 'string' ? rec.description.trim() : '';
        return { id: asInt(rec.id), value, description };
    })
        .filter((row) => row.id >= 0 && row.value.length > 0)
        .sort((a, b) => a.id - b.id);
}
function asNamedValues(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        const value = typeof rec.value === 'string'
            ? rec.value.trim()
            : typeof rec.name === 'string'
                ? rec.name.trim()
                : '';
        return { id: asInt(rec.id), value };
    })
        .filter((row) => row.id > 0 && row.value.length > 0)
        .sort((a, b) => a.id - b.id);
}
function asAbilityLevels(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const raw = row;
        const value = typeof raw.value === 'string'
            ? raw.value.trim()
            : typeof raw.name === 'string'
                ? raw.name.trim()
                : '';
        return { id: asInt(raw.id), value };
    })
        .filter((row) => row.id > 0 && row.value.length > 0);
}
function asHeroDisciplines(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const raw = row;
        return {
            hero_id: asInt(raw.hero_id),
            discipline_id: asInt(raw.discipline_id),
        };
    })
        .filter((row) => row.hero_id > 0 && row.discipline_id > 0);
}
function asIntIds(value) {
    if (!Array.isArray(value)) {
        // Single id (legacy) — treat as a one-element list.
        if (value != null && value !== '') {
            const n = typeof value === 'number' ? value : Number(value);
            if (Number.isInteger(n) && n > 0) {
                return [n];
            }
        }
        return [];
    }
    const ids = [];
    for (const entry of value) {
        const n = typeof entry === 'number' ? entry : Number(entry);
        if (Number.isInteger(n) && n > 0) {
            ids.push(n);
        }
    }
    return ids;
}
function asJsonObject(value) {
    if (value == null) {
        return null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        try {
            return asJsonObject(JSON.parse(trimmed));
        }
        catch {
            return null;
        }
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value;
}
function asUnitRetaliation(value) {
    const rec = asJsonObject(value);
    if (!rec) {
        return { ...DEFAULT_UNIT_RETALIATION };
    }
    const dmgRaw = rec.dmg_pct;
    let dmgPct = 'default';
    if (typeof dmgRaw === 'string' && dmgRaw.trim().toLowerCase() === 'max') {
        dmgPct = 'max';
    }
    else if (dmgRaw != null && dmgRaw !== '') {
        const n = Number(dmgRaw);
        if (Number.isFinite(n)) {
            dmgPct = Math.min(100, Math.max(0, n));
        }
    }
    const timesRaw = rec.times;
    let times = DEFAULT_UNIT_RETALIATION.times;
    if (typeof timesRaw === 'string' &&
        timesRaw.trim().toLowerCase() === 'unlimited') {
        times = 'unlimited';
    }
    else if (timesRaw != null && timesRaw !== '') {
        const n = Number(timesRaw);
        if (Number.isFinite(n)) {
            times = Math.max(0, Math.floor(n));
        }
    }
    const shapeRaw = typeof rec.shape === 'string' ? rec.shape.trim().toLowerCase() : '';
    const shape = shapeRaw.length > 0 && ATTACK_SHAPES.has(shapeRaw)
        ? shapeRaw
        : undefined;
    const radiusRaw = Number(rec.radius);
    const radius = shape != null && Number.isFinite(radiusRaw) && radiusRaw >= 1
        ? Math.floor(radiusRaw)
        : shape != null
            ? 1
            : undefined;
    const jumpsRaw = Number(rec.jumps);
    const jumps = shape != null && Number.isFinite(jumpsRaw) && jumpsRaw >= 1
        ? Math.floor(jumpsRaw)
        : undefined;
    const falloffRaw = Number(rec.falloff);
    const falloff = shape != null && Number.isFinite(falloffRaw) && falloffRaw >= 0
        ? Math.min(100, falloffRaw)
        : undefined;
    return {
        dmgPct,
        times,
        preemptive: rec.preemptive === true,
        ...(shape != null ? { shape, radius: radius ?? 1 } : {}),
        ...(jumps != null ? { jumps } : {}),
        ...(falloff != null ? { falloff } : {}),
        ...(rec.teleports_attacker === true
            ? {
                teleportsAttacker: true,
                teleportChancePct: (() => {
                    const n = Number(rec.teleport_chance_pct);
                    return Number.isFinite(n) && n > 0
                        ? Math.min(100, Math.floor(n))
                        : 50;
                })(),
                resistStat: asResistStat(rec.resist_stat),
            }
            : {}),
    };
}
const ATTACK_SHAPES = new Set([
    'single',
    'cleave',
    'aoe',
    'pulse',
    'chain',
    'beam',
    'line',
    'charge_line',
    'multi',
    'rain',
    'breath',
    'spiral',
]);
function asAttackShape(raw) {
    if (raw === 'screen') {
        return 'rain';
    }
    if (ATTACK_SHAPES.has(raw)) {
        return raw;
    }
    return DEFAULT_UNIT_ABILITIES.shape;
}
export function parseAttackShape(raw) {
    return asAttackShape(raw.trim().toLowerCase());
}
function asShapeInt(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 1) {
        return fallback;
    }
    return Math.floor(n);
}
function asAutoTarget(value) {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (text === 'random_wall_segment' ||
        text === 'random_enemy' ||
        text === 'random_enemy_los') {
        return text;
    }
    return null;
}
function abilitiesConfigPresent(value) {
    const rec = asJsonObject(value);
    if (!rec) {
        return false;
    }
    return Object.keys(rec).length > 0;
}
function asUnitCombatAbilities(value) {
    const rec = asJsonObject(value);
    const shapeRaw = typeof rec?.shape === 'string' ? rec.shape.trim().toLowerCase() : '';
    const falloffRaw = rec?.falloff;
    const falloffNum = Number(falloffRaw);
    const chanceRaw = Number(rec?.chance_pct);
    return {
        no_enemy_retaliation: rec?.no_enemy_retaliation === true || rec?.ignores_retaliation === true,
        shape: asAttackShape(shapeRaw),
        radius: asShapeInt(rec?.radius, DEFAULT_UNIT_ABILITIES.radius),
        jumps: asShapeInt(rec?.jumps, DEFAULT_UNIT_ABILITIES.jumps),
        falloff: Number.isFinite(falloffNum) && falloffNum >= 0
            ? Math.min(100, falloffNum)
            : DEFAULT_UNIT_ABILITIES.falloff,
        targets: asShapeInt(rec?.targets, DEFAULT_UNIT_ABILITIES.targets),
        rows: asShapeInt(rec?.rows, DEFAULT_UNIT_ABILITIES.rows),
        autoTarget: asAutoTarget(rec?.auto_target) ?? asAutoTarget(rec?.target),
        skipIfNone: rec?.skip_if_none === true,
        inflictsCondition: asOptionalId(rec?.inflicts_condition),
        resistStat: asResistStat(rec?.resist_stat),
        conditionDuration: asShapeInt(rec?.debuff_duration ?? rec?.duration, DEFAULT_UNIT_ABILITIES.conditionDuration),
        autoSplitOnTurn: rec?.auto_split_on_turn === true,
        skipFirstTurn: rec?.skip_first_turn === true,
        killOnOverflow: rec?.kill_on_overflow === true,
        chancePct: Number.isFinite(chanceRaw) && chanceRaw > 0
            ? Math.min(100, Math.floor(chanceRaw))
            : null,
        extraAttackOnAttackOnly: rec?.extra_attack_on_attack_only === true,
        speedDebuffPct: (() => {
            const n = Number(rec?.speed_debuff_pct);
            return Number.isFinite(n) && n > 0 ? Math.min(100, Math.floor(n)) : null;
        })(),
        leavesGroundEffectOnMove: rec?.leaves_ground_effect_on_move === true,
        leavesGroundEffectOnAttack: rec?.leaves_ground_effect_on_attack === true,
        groundEffectId: asOptionalId(rec?.ground_effect_id),
        immuneToFire: rec?.immune_to_fire === true,
        immuneToLightning: rec?.immune_to_lightning === true,
        fullPath: rec?.full_path === true,
        canTargetAllyIfTag: asOptionalId(rec?.can_target_ally_if_tag),
        healOnAllyTarget: rec?.heal_on_ally_target === true,
        healAmtPerUnit: (() => {
            const n = Number(rec?.heal_amt_per_unit);
            return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        })(),
        killChainPulse: rec?.kill_chain_pulse === true,
        killAbsorbChancePct: (() => {
            const n = Number(rec?.kill_absorb_chance_pct);
            return Number.isFinite(n) && n > 0 ? Math.min(100, Math.floor(n)) : null;
        })(),
        killAbsorbTagRequired: asOptionalId(rec?.kill_absorb_tag_required),
        killAbsorbTagsRequired: asIntIds(rec?.kill_absorb_tags_required),
        killAbsorbRequiresTier: (() => {
            const n = Number(rec?.kill_absorb_requires_tier);
            return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        })(),
        killAbsorbTrigger: typeof rec?.kill_absorb_trigger === 'string' &&
            rec.kill_absorb_trigger.trim().toLowerCase() === 'per_attack'
            ? 'per_attack'
            : null,
        growsQtyOnKill: (() => {
            const n = Number(rec?.grows_qty_on_kill);
            return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        })(),
        dmgIncreasePerHex: (() => {
            const n = Number(rec?.dmg_increase_per_hex);
            return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        })(),
        chargeDmgEscalation: rec?.charge_dmg_escalation === true,
        escalationChancePctStat: (() => {
            const n = Number(rec?.escalation_chance_pct_stat);
            return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        escalationMult: (() => {
            const n = Number(rec?.escalation_mult);
            return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        escalationMinIncrease: (() => {
            const n = Number(rec?.escalation_min_increase);
            return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        })(),
        speedDebuffFlatStatDiv: (() => {
            const n = Number(rec?.speed_debuff_flat_stat_div);
            return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        bonusDmgTags: asIntIds(rec?.bonus_dmg_tag),
        bonusDmgMult: (() => {
            const n = Number(rec?.bonus_dmg_mult);
            return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        aiTreatAsThreat: rec?.ai_treat_as_threat === true,
        immuneToMagicDmg: rec?.immune_to_magic_dmg === true,
        blinkMovement: rec?.blink_movement === true,
        requiresLos: rec?.requires_los === true,
        respectsHexSize: rec?.respects_hex_size === true,
        speedSwapIfTargetFaster: rec?.speed_swap_if_target_faster === true,
        speedSwapDuration: asShapeInt(rec?.speed_swap_duration, DEFAULT_UNIT_ABILITIES.speedSwapDuration),
        healMostInjuredOnKill: rec?.heal_most_injured_on_kill === true,
        healFull: rec?.heal_full === true,
        extraTurnOnKill: rec?.extra_turn_on_kill === true,
        chancePctFlatStat: (() => {
            const n = Number(rec?.chance_pct_flat_stat);
            return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        chanceHalvesEachAttempt: rec?.chance_halves_each_attempt === true,
        grantsSecondAttack: rec?.grants_second_attack === true ||
            rec?.grants_second_attack_pct === true ||
            Number(rec?.grants_second_attack) === 1,
        dualAttack: rec?.dual_attack === true,
        secondAttackDmgType: (() => {
            const raw = typeof rec?.second_attack_dmg_type === 'string'
                ? rec.second_attack_dmg_type.trim().toLowerCase()
                : '';
            if (raw === 'physical') {
                return 'Physical';
            }
            if (raw === 'magic') {
                return 'Magic';
            }
            return null;
        })(),
        secondAttackMinDmg: (() => {
            const n = Number(rec?.second_attack_min_dmg);
            return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
        })(),
        secondAttackMaxDmg: (() => {
            const n = Number(rec?.second_attack_max_dmg);
            return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
        })(),
        retaliateOnceAfterBoth: rec?.retaliate_once_after_both === true,
        auraRadius: (() => {
            const n = Number(rec?.aura_radius);
            return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
        })(),
        auraCountsAlliesAsExtraQty: rec?.aura_counts_allies_as_extra_qty === true,
        absorbTerrainIds: asIdList(rec?.absorb_terrain_ids),
        terrainGrowthTerrainTypeId: asOptionalId(rec?.terrain_growth_terrain_type_id),
        terrainGrowthAmount: (() => {
            const n = Number(rec?.terrain_growth_amount);
            return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        })(),
        fizzleTerrainIds: asIdList(rec?.fizzle_terrain_ids),
        clearsGroundEffectId: asOptionalId(rec?.clears_ground_effect_id),
        chancePctIntelStat: (() => {
            const n = Number(rec?.chance_pct_intel_stat);
            return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        scatterGroundEffectOnMoveStop: rec?.scatter_ground_effect_on_move_stop === true,
        spiralChanceDecayPct: (() => {
            const n = Number(rec?.spiral_chance_decay_pct);
            return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        })(),
        selfRezOnWipe: rec?.self_rez_on_wipe === true,
        selfRezChanceStatDiv: (() => {
            const n = Number(rec?.self_rez_chance_stat_div);
            return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        })(),
        selfRezCapPct: (() => {
            const n = Number(rec?.self_rez_cap_pct);
            return Number.isFinite(n) && n > 0 ? Math.min(100, Math.floor(n)) : null;
        })(),
        selfRezBasedOnKillsThisRound: rec?.self_rez_based_on_kills_this_round === true,
    };
}
function asResistStat(value) {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (text === 'resistance' || text === 'defense') {
        return text;
    }
    return null;
}
function asPayload(value) {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    return value;
}
function asDifficulties(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const raw = row;
        const name = typeof raw.name === 'string' ? raw.name.trim() : '';
        return {
            id: asInt(raw.id),
            name,
            payload: asPayload(raw.payload),
        };
    })
        .filter((row) => row.id > 0 && row.name.length > 0)
        .sort((a, b) => a.id - b.id);
}
function asPlayerColors(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows
        .map((row) => {
        const rec = row;
        const name = typeof rec.name === 'string' ? rec.name.trim() : '';
        const hex = typeof rec.hex_value === 'string'
            ? rec.hex_value.trim()
            : typeof rec.hexValue === 'string'
                ? rec.hexValue.trim()
                : '';
        return {
            id: asInt(rec.id),
            name,
            hex_value: hex,
        };
    })
        .filter((row) => row.id > 0 && row.hex_value.length > 0)
        .sort((a, b) => a.id - b.id);
}
function parseCssHex(value) {
    const trimmed = value.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
        return Number.parseInt(trimmed, 16);
    }
    if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
        const r = trimmed[0];
        const g = trimmed[1];
        const b = trimmed[2];
        return Number.parseInt(`${r}${r}${g}${g}${b}${b}`, 16);
    }
    return null;
}
/** Pixi fill for an owned token, or null if unowned/neutral. */
export function ownerTint(playerId) {
    if (!playerId) {
        return null;
    }
    const slot = slotFromPlayerId(playerId);
    if (slot == null) {
        return null;
    }
    const row = getCachedCatalog()?.player_color?.find((color) => color.id === slot);
    if (!row) {
        return null;
    }
    return parseCssHex(row.hex_value);
}
export async function fetchCatalog() {
    const response = await fetch('/api/reference/catalog');
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const payload = (await response.json());
    const resource = asResources(payload.resource);
    applyResourceCatalog(resource);
    const building = (Array.isArray(payload.building) ? payload.building : []).map((row) => {
        const raw = row;
        const growthNum = Number(raw.growth);
        const name = typeof raw.name === 'string' ? raw.name.trim() : '';
        return {
            id: asInt(raw.id),
            name,
            town_id: asInt(raw.town_id),
            class_id: raw.class_id == null || raw.class_id === ''
                ? null
                : asInt(raw.class_id),
            cost: asCost(raw.cost),
            effect_type: typeof raw.effect_type === 'string' ? raw.effect_type.trim() : '',
            payload: raw.payload != null &&
                typeof raw.payload === 'object' &&
                !Array.isArray(raw.payload)
                ? raw.payload
                : null,
            destroy_cost: asCost(raw.destroy_cost),
            slot_num: raw.slot_num == null || raw.slot_num === ''
                ? null
                : asInt(raw.slot_num),
            image_path: typeof raw.image_path === 'string' && raw.image_path.trim()
                ? raw.image_path.trim()
                : null,
            growth: Number.isFinite(growthNum) ? growthNum : null,
            level: catalogLevel(raw.level),
            requires: asRequires(raw.requires),
        };
    }).filter((row) => row.id > 0 && row.name.length > 0);
    let unit = (Array.isArray(payload.unit) ? payload.unit : []).map((row) => {
        const extra = row;
        const image = typeof row.image_path === 'string' ? row.image_path.trim() : '';
        const imageAlt = typeof extra.image_path_alt === 'string' ? extra.image_path_alt.trim() : '';
        const footprint = parseFootprintCode(extra.footprint ?? extra.hex_size ?? '1x1');
        const moveRaw = extra.move_type_id;
        const moveId = moveRaw == null || moveRaw === '' ? null : asInt(moveRaw);
        const dmgType = typeof extra.dmg_type === 'string' ? extra.dmg_type.trim() : '';
        const maxRangeRaw = extra.max_range;
        const townRaw = extra.town_id;
        const townId = townRaw == null || townRaw === '' ? null : asInt(townRaw);
        return {
            ...row,
            cost: asCost(row.cost),
            image_path: image || null,
            image_path_alt: imageAlt || null,
            footprint,
            speed: extra.speed == null || extra.speed === ''
                ? null
                : asInt(extra.speed),
            stationary: asBoolFlag(extra.stationary),
            move_type_id: moveId != null && moveId > 0 ? moveId : null,
            health: asInt(extra.health),
            defense: Math.max(0, asInt(extra.defense)),
            resistance: Math.max(0, asInt(extra.resistance)),
            dmg_type: dmgType.length > 0 ? dmgType : null,
            min_dmg: asInt(extra.min_dmg),
            max_dmg: asInt(extra.max_dmg),
            min_range: asInt(extra.min_range),
            max_range: maxRangeRaw == null || maxRangeRaw === '' ? 1 : asInt(maxRangeRaw),
            retaliation: asUnitRetaliation(extra.retaliation),
            abilities: asUnitCombatAbilities(extra.abilities),
            tags: asIntIds(extra.tags),
            has_abilities: abilitiesConfigPresent(extra.abilities),
            blocks_los: asBoolFlag(extra.blocks_los),
            town_id: townId != null && townId > 0 ? townId : null,
            class_id: extra.class_id == null || extra.class_id === '' ? null : asInt(extra.class_id),
            tier: extra.tier == null || extra.tier === '' ? null : asInt(extra.tier),
            upgrade_cost: asCost(row
                .upgrade_cost),
            level: catalogLevel(row.level),
        };
    });
    const catalog = {
        building,
        unit,
        hero_type: asHeroTypes(payload.hero_type),
        hero_pool: asHeroPool(payload.hero_pool),
        resource,
        town: asTownRows(payload.town),
        town_layout: asTownLayout(payload.town_layout),
        market: asMarket(payload.market),
        ability: asAbilities(payload.ability),
        ability_resource: asAbilityResources(payload.ability_resource),
        ability_cooldown: asAbilityCooldowns(payload.ability_cooldown),
        ability_target: asNamedValues(payload.ability_target),
        ability_type: asNamedValues(payload.ability_type),
        unit_tag: asNamedValues(payload.unit_tag),
        condition: (() => {
            const rows = asNamedValues(payload.condition);
            // BR S7-4: Slow (id 12) — keep a local label if Rod's SQL hasn't landed yet.
            if (!rows.some((row) => row.id === 12 || row.value.toLowerCase() === 'slow')) {
                return [
                    ...rows,
                    { id: 12, value: 'Slow' },
                ].sort((a, b) => a.id - b.id);
            }
            return rows;
        })(),
        discipline: asNamed(payload.discipline),
        ability_level: asAbilityLevels(payload.ability_level),
        hero_discipline: asHeroDisciplines(payload.hero_discipline),
        difficulty: asDifficulties(payload.difficulty),
        player_color: asPlayerColors(payload.player_color),
        move_type: asMoveTypes(payload.move_type),
        terrain: asHexTerrains(payload.terrain),
        prop: asProps(payload.prop),
        feature_type: asFeatureTypes(payload.feature_type),
        feature: asFeatures(payload.feature),
        sign_text: asSignText(payload.sign_text),
        quest_text: asQuestText(payload.quest_text),
        stat: asStatRows(payload.stat),
        class_type: Array.isArray(payload.class_type)
            ? payload.class_type
                .map((rec) => ({
                id: asInt(rec.id),
                name: String(rec.name ?? '').trim(),
            }))
                .filter((row) => row.id > 0 && row.name.length > 0)
            : [],
        rarity: asRarities(payload.rarity),
        item_kind: Array.isArray(payload.item_kind)
            ? payload.item_kind.map((rec) => ({
                id: Math.floor(Number(rec.id) || 0),
                name: String(rec.name ?? ''),
            }))
            : [],
        item_type: asItemTypes(payload.item_type),
        item: asItemTemplates(payload.item),
        item_adj: asItemAdjs(payload.item_adj),
        app_config: asAppConfig(payload.app_config),
        keybind: asKeybind(payload.keybind),
        map_config: asJsonConfig(payload.map_config),
        combat_config: asJsonConfig(payload.combat_config),
        ai_config: asJsonConfig(payload.ai_config),
        ai_arch: asAiArch(payload.ai_arch),
        ai_arch_weight: asAiArchWeight(payload.ai_arch_weight),
        levels: asLevels(payload.levels),
        hero_levels: asHeroLevels(payload.hero_levels),
        ground_effect: asGroundEffects(payload.ground_effect),
    };
    enrichCatalogUnits(catalog);
    auditItemSlotTypes(catalog);
    const upgradePairingIssues = auditUpgradePairing(catalog);
    if (upgradePairingIssues.length > 0) {
        console.warn('[catalog] upgrade pairing issues', upgradePairingIssues);
    }
    catalog.ability = fillDesignedAbilities(catalog.ability, catalog.ability_target, catalog.ability_type).map((row) => ({
        ...row,
        stats: normalizeAbilityStatFlags(row.stats),
    }));
    rebuildGameDifficultyCatalog(catalog);
    emitCatalog();
    return catalog;
}
let cachedCatalog = null;
let baselineCatalog = null;
let activeDifficultyId = null;
let activeGameCatalog = null;
const catalogListeners = new Set();
const DIFFICULTY_OVERRIDE_SECTIONS = new Set([
    'map_config',
    'ai_config',
    'combat_config',
    'app_config',
]);
function replaceJsonConfigKey(rows, key, value) {
    const trimmed = key.trim();
    if (!trimmed) {
        return rows;
    }
    let found = false;
    const next = rows.map((row) => {
        if (row.key !== trimmed) {
            return row;
        }
        found = true;
        return { ...row, value };
    });
    if (!found) {
        return [...next, { key: trimmed, value, description: null }];
    }
    return next;
}
function applyDifficultyOverrides(catalog, difficultyId) {
    const row = catalog.difficulty.find((entry) => entry.id === difficultyId) ??
        catalog.difficulty.find((entry) => entry.name.trim().toLowerCase() === 'normal');
    const overrides = row?.payload?.overrides;
    if (overrides == null ||
        typeof overrides !== 'object' ||
        Array.isArray(overrides)) {
        return catalog;
    }
    const sections = overrides;
    let next = { ...catalog };
    for (const section of DIFFICULTY_OVERRIDE_SECTIONS) {
        const keys = sections[section];
        if (keys == null || typeof keys !== 'object' || Array.isArray(keys)) {
            continue;
        }
        const current = catalog[section];
        if (!Array.isArray(current)) {
            continue;
        }
        let rows = current;
        for (const [key, value] of Object.entries(keys)) {
            rows = replaceJsonConfigKey(rows, key, value);
        }
        next = { ...next, [section]: rows };
    }
    return next;
}
export function rebuildGameDifficultyCatalog(catalog) {
    baselineCatalog = catalog;
    if (activeDifficultyId != null && activeDifficultyId > 0) {
        activeGameCatalog = applyDifficultyOverrides(catalog, activeDifficultyId);
        cachedCatalog = activeGameCatalog;
        return;
    }
    activeGameCatalog = null;
    cachedCatalog = catalog;
}
export function setGameDifficultyCatalog(difficultyId) {
    activeDifficultyId =
        difficultyId != null && difficultyId > 0 ? Math.floor(difficultyId) : null;
    if (baselineCatalog) {
        rebuildGameDifficultyCatalog(baselineCatalog);
        emitCatalog();
    }
}
export function getBaselineCatalog() {
    return baselineCatalog ?? cachedCatalog;
}
export function difficultyName(catalog, difficultyId) {
    const row = catalog?.difficulty.find((entry) => entry.id === difficultyId);
    return row?.name?.trim() || 'Normal';
}
function emitCatalog() {
    for (const listener of catalogListeners) {
        listener();
    }
}
export function subscribeCatalog(listener) {
    catalogListeners.add(listener);
    return () => {
        catalogListeners.delete(listener);
    };
}
export function getCachedCatalog() {
    return cachedCatalog;
}
export async function reloadReferenceData() {
    const response = await fetch('/api/system/reload-reference-data', {
        method: 'POST',
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const payload = (await response.json());
    return {
        ok: payload.ok,
        tables: Array.isArray(payload.tables) ? payload.tables : [],
    };
}
/** Re-read Postgres into Spring, then refresh the frontend catalog. */
export async function refreshCatalogFromDb() {
    await reloadReferenceData();
    return fetchCatalog();
}
export function buildingGrowth(building) {
    if (!building) {
        return 0;
    }
    if (typeof building.growth === 'number' && Number.isFinite(building.growth) && building.growth > 0) {
        return Math.floor(building.growth);
    }
    const weekly = building.payload?.weekly_growth;
    if (typeof weekly === 'number' && Number.isFinite(weekly) && weekly > 0) {
        return Math.floor(weekly);
    }
    return 0;
}
function asPositiveInt(value) {
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(n) || n <= 0) {
        return null;
    }
    return Math.floor(n);
}
/**
 * Weekly resource grants from `payload.produces` (Halls gold, Resource
 * Generators, etc.). Empty when payload is missing or malformed.
 */
export function buildingProduces(building) {
    const raw = building?.payload?.produces;
    if (!Array.isArray(raw)) {
        return [];
    }
    const grants = [];
    for (const entry of raw) {
        if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) {
            continue;
        }
        const rec = entry;
        const resourceId = asPositiveInt(rec.resource_id);
        const qty = asPositiveInt(rec.qty);
        if (resourceId == null || qty == null) {
            continue;
        }
        grants.push({ resourceId, qty });
    }
    return grants;
}
export function buildingHasProduces(building) {
    return buildingProduces(building).length > 0;
}
/** Per-creature recruit cost (`unit.cost` JSONB, resource-id keys — same as `building.cost`). */
export function unitCost(unit) {
    return unit ? asCost(unit.cost) : {};
}
export function unitUpgradeCost(unit) {
    return unit ? asCost(unit.upgrade_cost) : {};
}
/** Catalog upgraded dwelling row (`level` 2). */
export function isAdvancedUnit(_catalog, unit) {
    return unit != null && unitDwellingLevel(unit) === 2;
}
/** Level-2 partner: same `town_id`, `tier`, `class_id`, `level` 2. */
export function advancedUnitFor(catalog, unit) {
    if (!catalog || !unit || unitDwellingLevel(unit) !== 1) {
        return null;
    }
    const matches = advancedUnitsFor(catalog, unit);
    return matches.length === 1 ? matches[0] : null;
}
export { auditUpgradePairing } from './unitUpgrade';
/** Battlefield footprint shape for this unit. Null/missing → `1x1`. */
export function unitFootprint(unit) {
    return parseFootprintCode(unit?.footprint ?? '1x1');
}
/** @deprecated Prefer unitFootprint — returns hex count for legacy callers. */
export function unitHexFootprint(unit) {
    const code = unitFootprint(unit);
    if (code === '1x1')
        return 1;
    if (code === '2x1')
        return 2;
    if (code === '2x2')
        return 3;
    if (code === '3x2')
        return 5;
    if (code === '3x3')
        return 8;
    return 1;
}
export function unitRetaliation(unit, catalog) {
    const spec = unit?.retaliation ?? DEFAULT_UNIT_RETALIATION;
    const dmgPct = spec.dmgPct === 'default'
        ? retaliationDefaultDmgPct(catalog)
        : spec.dmgPct;
    return { ...spec, dmgPct };
}
export function unitBlocksEnemyRetaliation(unit) {
    return unit?.abilities?.no_enemy_retaliation === true;
}
export function unitAttackShape(unit) {
    const raw = unit?.abilities;
    if (!raw) {
        return DEFAULT_UNIT_ABILITIES;
    }
    return {
        ...DEFAULT_UNIT_ABILITIES,
        ...raw,
        shape: raw.shape ?? DEFAULT_UNIT_ABILITIES.shape,
    };
}
export function unitAutoTarget(unit, catalog) {
    const fromAbilities = unitAttackShape(unit).autoTarget;
    if (fromAbilities) {
        return fromAbilities;
    }
    const cat = catalog ?? getCachedCatalog();
    if (cat && unit) {
        if (unitHasNamedTag(cat, unit, TAG_AUTO_TARGET_RANDOM_WALL)) {
            return 'random_wall_segment';
        }
        if (unitHasNamedTag(cat, unit, TAG_AUTO_TARGET_RANDOM_ENEMY)) {
            return 'random_enemy';
        }
    }
    return null;
}
export function conditionName(catalog, conditionId) {
    const row = catalog.condition.find((entry) => entry.id === conditionId);
    const label = row?.value?.trim() ?? '';
    return label.length > 0 ? label : `condition ${conditionId}`;
}
export function shapeIsUntargeted(shape) {
    return shape === 'rain' || shape === 'multi';
}
export function shapePulsesOnMove(shape) {
    return shape === 'pulse';
}
/** Remaining charges to grant at round start. Infinity = unlimited. */
export function retaliationCharges(unit) {
    const times = unitRetaliation(unit).times;
    return times === 'unlimited' ? Number.POSITIVE_INFINITY : times;
}
export function scaleCost(cost, qty) {
    const scaled = {};
    for (const [key, amount] of Object.entries(cost)) {
        scaled[Number(key)] = amount * qty;
    }
    return scaled;
}
export function maxAffordableQty(wallet, cost, cap) {
    if (cap <= 0) {
        return 0;
    }
    let max = cap;
    for (const [key, amount] of Object.entries(cost)) {
        if (amount <= 0) {
            continue;
        }
        const have = wallet[Number(key)]?.stockpile ?? 0;
        max = Math.min(max, Math.floor(have / amount));
    }
    return Math.max(0, Math.floor(max));
}
export const TOWN_LAYOUT_SLOT_COUNT = 16;
export function isArmySlot(slotId) {
    return slotId >= 11 && slotId <= 16;
}
export function isTavernBuilding(building) {
    return buildingInSlot(building, BUILDING_SLOT_TAVERN);
}
export function isMarketplaceBuilding(building) {
    return buildingInSlot(building, BUILDING_SLOT_MARKETPLACE);
}
/** Town / Village Hall — `gold_income` effect. */
export function isHallBuilding(building) {
    return building.effect_type.trim().toLowerCase() === 'gold_income';
}
export function isLibraryBuilding(building) {
    return buildingInSlot(building, BUILDING_SLOT_LIBRARY);
}
/** Catalog row that only pads an otherwise-empty slot (`effect_type` = `empty_slot`). */
export function isEmptyPlaceholder(building) {
    return building.effect_type.trim().toLowerCase() === 'empty_slot';
}
export function isHangerBuilding(building) {
    return buildingInSlot(building, BUILDING_SLOT_HANGER);
}
export function isTownUniqueSlotBuilding(building) {
    return buildingInSlot(building, BUILDING_SLOT_TOWN_UNIQUE);
}
export function isEmptyPlaceholderSlot(catalog, slotId, townTypeId) {
    const rows = buildingsInSlot(catalog, slotId, townTypeId);
    const real = rows.filter((row) => !isEmptyPlaceholder(row));
    return real.length === 0 && rows.some(isEmptyPlaceholder);
}
export function townLayoutFor(catalog, townTypeId) {
    return catalog.town_layout
        .filter((row) => row.town_type_id === townTypeId)
        .slice()
        .sort((a, b) => a.slot - b.slot);
}
export function townLayoutError(catalog, townTypeId) {
    const rows = townLayoutFor(catalog, townTypeId);
    if (rows.length === 0) {
        return `town_layout — 0 rows for town_type_id ${townTypeId}`;
    }
    if (rows.length !== TOWN_LAYOUT_SLOT_COUNT) {
        return `town_layout — expected ${TOWN_LAYOUT_SLOT_COUNT} slots, got ${rows.length}`;
    }
    return null;
}
export function armyTier(slotId) {
    return slotId - 10;
}
export function buildingCost(building) {
    return asCost(building.cost);
}
/** Construction cost; if the building row has none, use that dwelling's unit cost. */
export function constructionCost(catalog, building) {
    const listed = buildingCost(building);
    if (Object.keys(listed).length > 0) {
        return listed;
    }
    return unitCost(unitForBuilding(catalog, building.id));
}
export function hasPrerequisite(building, builtIds) {
    const clauses = building.requires;
    if (clauses == null || clauses.length === 0) {
        return true;
    }
    return clauses.every((clause) => requireClausePasses(clause, builtIds));
}
function requireClausePasses(clause, builtIds) {
    if ('all' in clause) {
        return clause.all.every((id) => builtIds.has(id));
    }
    return clause.any.some((id) => builtIds.has(id));
}
export function isBuildRoot(building) {
    return building.level === 1;
}
function prerequisiteBuildingName(catalog, id) {
    const pre = buildingById(catalog, id);
    const name = pre?.name?.trim();
    return name && name.length > 0 ? name : `building #${id}`;
}
/** One line per unmet requires group (all / any), naming live building rows. */
export function formatUnmetRequires(catalog, building, builtIds) {
    const parts = [];
    for (const clause of building.requires ?? []) {
        if (requireClausePasses(clause, builtIds)) {
            continue;
        }
        if ('all' in clause) {
            const missing = clause.all
                .filter((id) => !builtIds.has(id))
                .map((id) => prerequisiteBuildingName(catalog, id));
            if (missing.length === 1) {
                parts.push(`Requires: ${missing[0]}`);
            }
            else if (missing.length > 1) {
                parts.push(`Requires: ${missing.join(', ')}`);
            }
            continue;
        }
        const names = clause.any.map((id) => prerequisiteBuildingName(catalog, id));
        if (names.length === 1) {
            parts.push(`Requires: ${names[0]}`);
        }
        else if (names.length > 1) {
            parts.push(`Requires one of: ${names.join(', ')}`);
        }
    }
    return parts.length > 0
        ? parts.join(' ')
        : 'Build the required prerequisite first.';
}
export function armyBuildOptions(catalog, slotId, townTypeId, builtIds) {
    return armyOptions(catalog, slotId, townTypeId).filter((row) => isBuildRoot(row) && hasPrerequisite(row, builtIds));
}
/** Locked army roots with name + unmet requires (for empty-slot panel / hover). */
export function lockedArmyPrerequisiteLines(catalog, slotId, townTypeId, builtIds) {
    const locked = armyOptions(catalog, slotId, townTypeId).filter((row) => isBuildRoot(row) && !hasPrerequisite(row, builtIds));
    if (locked.length === 0) {
        return ['Build the required prerequisite first.'];
    }
    const lines = [];
    for (const row of locked) {
        const unitName = unitForBuilding(catalog, row.id)?.name?.trim();
        lines.push(`Build ${row.name}${unitName ? ` (${unitName})` : ''}`);
        lines.push(formatUnmetRequires(catalog, row, builtIds));
    }
    return lines;
}
export function missingArmyPrerequisiteLine(catalog, slotId, townTypeId, builtIds) {
    return lockedArmyPrerequisiteLines(catalog, slotId, townTypeId, builtIds).join(' ');
}
export function missingGenericPrerequisiteLine(catalog, building, builtIds) {
    return formatUnmetRequires(catalog, building, builtIds);
}
/** Hover/preview text for an empty town slot (same info as the Build panel). */
export function emptySlotPreviewLines(catalog, slotId, townTypeId, builtIds, costOf = (building) => constructionCost(catalog, building)) {
    if (isUndesignedSlot(catalog, slotId, townTypeId)) {
        return ['Not yet designed'];
    }
    if (isEmptyPlaceholderSlot(catalog, slotId, townTypeId)) {
        return ['Nothing built here yet.'];
    }
    if (isArmySlot(slotId)) {
        const options = armyBuildOptions(catalog, slotId, townTypeId, builtIds);
        if (options.length === 0) {
            return lockedArmyPrerequisiteLines(catalog, slotId, townTypeId, builtIds);
        }
        const lines = [];
        for (const building of options) {
            const unitName = unitForBuilding(catalog, building.id)?.name?.trim();
            lines.push(`Build ${building.name}${unitName ? ` (${unitName})` : ''}`);
            const effect = effectLine(building);
            if (effect) {
                lines.push(effect);
            }
            lines.push(`Cost: ${formatCost(costOf(building))}`);
        }
        return lines;
    }
    const root = genericRoot(genericSlotBuildings(catalog, slotId, townTypeId));
    if (!root) {
        return ['No building defined for this slot.'];
    }
    if (!hasPrerequisite(root, builtIds)) {
        return [missingGenericPrerequisiteLine(catalog, root, builtIds)];
    }
    const lines = [`Build ${root.name}`];
    const effect = effectLine(root);
    if (effect) {
        lines.push(effect);
    }
    lines.push(`Cost: ${formatCost(costOf(root))}`);
    return lines;
}
/** Destroy cost from the building row only — no app-config / hardcoded fallback. */
export function destroyCostOf(building) {
    return asCost(building.destroy_cost);
}
export function formatCost(cost) {
    const parts = [];
    const seen = new Set();
    for (const resource of RESOURCES) {
        const amount = cost[resource.id];
        if (amount) {
            seen.add(resource.id);
            parts.push(`${formatAmount(amount)} ${resource.name}`);
        }
    }
    for (const [key, amount] of Object.entries(cost)) {
        const id = Number(key);
        if (amount && !seen.has(id)) {
            const resource = resourceById(id);
            parts.push(`${formatAmount(amount)} ${resource?.name ?? `#${key}`}`);
        }
    }
    return parts.length > 0 ? parts.join(', ') : 'Free';
}
export function effectLine(building) {
    const display = building.payload?.display;
    return typeof display === 'string' ? display : '';
}
export function difficultyDisplay(row) {
    const display = row?.payload?.display;
    return typeof display === 'string' ? display : '';
}
export function heroTypeName(catalog, classId) {
    if (classId == null) {
        return '';
    }
    return catalog.hero_type.find((row) => row.id === classId)?.name ?? '';
}
/** The two hero classes that belong to this town type. */
export function tavernClassIds(catalog, townTypeId) {
    return catalog.hero_type
        .filter((row) => row.town_id === townTypeId)
        .map((row) => row.id);
}
/** Tavern hire roster: unused names are applied by the caller. */
export function tavernHirePool(catalog, townTypeId) {
    const classIds = new Set(tavernClassIds(catalog, townTypeId));
    return catalog.hero_pool.filter((row) => classIds.has(row.class_id));
}
function emptyHeroStats() {
    const n = dummyHeroStat(getCachedCatalog());
    return {
        speed: n,
        stamina: n,
        strength: n,
        intel: n,
        defense: n,
        resist: n,
        crit_pct: n,
        crit_amt: n,
    };
}
export function heroTypeBaseStats(row) {
    if (!row) {
        return emptyHeroStats();
    }
    return {
        speed: row.speed,
        stamina: row.stamina,
        strength: row.strength,
        intel: row.intel,
        defense: row.defense,
        resist: row.resist,
        crit_pct: row.crit_pct,
        crit_amt: row.crit_amt,
    };
}
/** Base hero_type stats plus hero_levels.stat_bumps up through current_level. */
export function heroEffectiveStats(catalog, classId, currentLevel, itemBonus) {
    const type = classId != null
        ? catalog.hero_type.find((row) => row.id === classId)
        : undefined;
    const stats = heroTypeBaseStats(type);
    if (classId == null) {
        return mergeHeroStats(stats, itemBonus ?? {});
    }
    const cap = Math.max(1, Math.floor(currentLevel));
    for (const row of catalog.hero_levels) {
        if (row.hero_type_id !== classId || row.level_id > cap) {
            continue;
        }
        for (const key of HERO_STAT_KEYS) {
            const bump = row.stat_bumps[key];
            if (typeof bump === 'number' && Number.isFinite(bump)) {
                stats[key] += bump;
            }
        }
    }
    return mergeHeroStats(stats, itemBonus ?? {});
}
/** Base + level bumps + equipped item stat bonuses (not backpack). */
export function heroEffectiveStatsForHero(catalog, hero) {
    if (!hero) {
        return emptyHeroStats();
    }
    const bonus = equippedItemBonuses(catalog, hero).hero;
    return heroEffectiveStats(catalog, hero.class_id, hero.current_level ?? 1, bonus);
}
export function heroEquippedRegenBonus(catalog, hero) {
    if (!hero) {
        return { manaRegen: 0, energyRegen: 0 };
    }
    const part = equippedItemBonuses(catalog, hero);
    return { manaRegen: part.manaRegen, energyRegen: part.energyRegen };
}
/**
 * Cumulative XP needed to advance out of `levelId` into the next level
 * (`levels.xp` where id = the level being left). Null if that row is missing.
 */
export function xpToReachLevel(catalog, levelId) {
    const row = catalog.levels.find((entry) => entry.id === levelId);
    if (!row) {
        return null;
    }
    return row.xp;
}
export function formatHeroLevelLine(catalog, name, currentLevel, currentXp) {
    const level = Math.max(1, Math.floor(currentLevel));
    const xp = Math.max(0, Math.floor(currentXp));
    const maxLevel = catalog
        ? catalog.levels.reduce((max, row) => (row.id > max ? row.id : max), 0)
        : 0;
    // Threshold to leave current level; omit at max (no next level).
    const nextXp = catalog && level < maxLevel ? xpToReachLevel(catalog, level) : null;
    if (nextXp == null) {
        return `${name} - Lvl ${level} - XP ${xp}`;
    }
    return `${name} - Lvl ${level} - XP ${xp}/${nextXp}`;
}
/** World-map daily movement: hero speed × this (app_config hero_steps_per_speed). */
export const DEFAULT_HERO_STEPS_PER_SPEED = 10;
/** Flat daily steps when New Game Speed = 100 Steps. */
export const FLAT_HERO_MOVEMENT_STEPS = 100;
/**
 * World-map movement budget (steps per day).
 * - {@code flat_100}: every hero gets {@link FLAT_HERO_MOVEMENT_STEPS}
 * - default / {@code hero_speed}: hero speed × {@code hero_steps_per_speed}
 */
export function heroMovementPoints(catalog, hero, moveMode) {
    if (moveMode === 'flat_100') {
        return FLAT_HERO_MOVEMENT_STEPS;
    }
    const stepsPer = Math.max(1, Math.floor(appConfigNumber(catalog, 'hero_steps_per_speed', DEFAULT_HERO_STEPS_PER_SPEED)));
    if (!catalog) {
        return Math.max(1, 10 * stepsPer);
    }
    const level = Math.max(1, Math.floor(hero?.current_level ?? 1));
    const speed = hero && 'equipment' in hero
        ? heroEffectiveStatsForHero(catalog, hero).speed
        : heroEffectiveStats(catalog, hero?.class_id ?? null, level).speed;
    return Math.max(1, Math.floor(Math.max(0, speed) * stepsPer));
}
export function abilityMult(catalog) {
    return Math.max(0, Math.floor(appConfigNumber(catalog, 'ability_mult', 4)));
}
export function regenPure(catalog) {
    return Math.max(0, Math.floor(appConfigNumber(catalog, 'regen_pure', 4)));
}
export function regenHybrid(catalog) {
    return Math.max(0, Math.floor(appConfigNumber(catalog, 'regen_hybrid', 2)));
}
export function minRangePenaltyMult(catalog) {
    return Math.max(0, appConfigNumber(catalog, 'min_range_penalty_mult', 0.5));
}
export function wallDamageMult(catalog) {
    return Math.max(0, appConfigNumber(catalog, 'wall_damage_mult', 0.5));
}
export function retaliationDefaultDmgMult(catalog) {
    return Math.max(0, appConfigNumber(catalog, 'retaliation_default_dmg_mult', 0.5));
}
function retaliationDefaultDmgPct(catalog) {
    return Math.min(100, Math.max(0, Math.round(retaliationDefaultDmgMult(catalog) * 100)));
}
/**
 * Starting stockpile from `difficulty.payload.start_resources` for the chosen
 * difficulty. Keys may be resource ids or names; missing resource → 0.
 */
export function startingStockpileFor(catalog, resource, difficultyId, forAi = false) {
    const id = difficultyId != null && difficultyId > 0
        ? difficultyId
        : Math.trunc(mapCfgNumber(catalog, 'new_difficulty', null, 2));
    const row = catalog?.difficulty.find((entry) => entry.id === id) ??
        catalog?.difficulty.find((entry) => entry.name.trim().toLowerCase() === 'normal') ??
        null;
    const payload = row?.payload;
    const startKey = forAi ? 'ai_start_resources' : 'start_resources';
    const start = payload != null &&
        typeof payload === 'object' &&
        !Array.isArray(payload)
        ? payload[startKey] ??
            (forAi ? undefined : payload.start_resources)
        : undefined;
    if (start == null || typeof start !== 'object' || Array.isArray(start)) {
        return 0;
    }
    const map = start;
    const byId = map[String(resource.id)] ?? map[resource.id];
    if (byId != null) {
        const n = Number(byId);
        return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    }
    const want = resource.name.trim().toLowerCase();
    for (const [key, amount] of Object.entries(map)) {
        if (key.trim().toLowerCase() === want) {
            const n = Number(amount);
            return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
        }
    }
    return 0;
}
/** Whole units per week from an owned mine of this resource (`payload.weekly_node`). */
export function resourceWeeklyNode(catalog, resourceId) {
    const row = catalog?.resource.find((entry) => entry.id === resourceId) ?? null;
    return Math.max(0, row?.payload?.weekly_node ?? 0);
}
/** Daily fractional mine accrual rate: weekly_node / 7. */
export function resourceDailyMineRate(catalog, resourceId) {
    return resourceWeeklyNode(catalog, resourceId) / 7;
}
export function hireHeroGoldCost(catalog) {
    return {
        [GOLD_RESOURCE_ID]: Math.max(0, Math.floor(appConfigNumber(catalog, 'hire_hero_cost', 1000))),
    };
}
export function libraryGoldCost(catalog, levelId) {
    const key = levelId === 1
        ? 'library_cost_1'
        : levelId === 2
            ? 'library_cost_2'
            : levelId === 3
                ? 'library_cost_3'
                : null;
    const fallback = levelId === 1 ? 500 : levelId === 2 ? 1000 : levelId === 3 ? 2000 : 0;
    if (!key) {
        return 0;
    }
    return Math.max(0, Math.floor(appConfigNumber(catalog, key, fallback)));
}
export function visionRange(catalog) {
    return Math.max(0, Math.floor(mapCfgNumber(catalog, 'vision_range', null, 6)));
}
export function heroInteractCost(catalog) {
    return Math.max(0, appConfigNumber(catalog, 'hero_interact_cost', 0.25));
}
export function dummyHeroStat(catalog) {
    return Math.max(0, Math.floor(appConfigNumber(catalog, 'dummy_hero_stat', 10)));
}
/**
 * STR/INT/etc. for combat formulas. When no commanding Hero is present
 * (world mobs, hero-less sides), every stat is app_config.dummy_hero_stat.
 */
export function commandingHeroStats(catalog, hero) {
    if (!catalog || !hero) {
        const n = dummyHeroStat(catalog);
        return {
            speed: n,
            stamina: n,
            strength: n,
            intel: n,
            defense: n,
            resist: n,
            crit_pct: n,
            crit_amt: n,
        };
    }
    if (hero.equipment) {
        return heroEffectiveStatsForHero(catalog, hero);
    }
    return heroEffectiveStats(catalog, hero.class_id, hero.current_level ?? 1);
}
export function dummyArmyQty(catalog) {
    return Math.max(0, Math.floor(appConfigNumber(catalog, 'dummy_army_qty', 16)));
}
/** Starting / missing-save Mana and Energy. Energy = strength × ability_mult; Mana = intel × ability_mult. */
export function heroResourcePools(catalog, hero) {
    const stats = catalog && hero
        ? hero.equipment
            ? heroEffectiveStatsForHero(catalog, hero)
            : heroEffectiveStats(catalog, hero.class_id, hero.current_level ?? 1)
        : emptyHeroStats();
    const mult = abilityMult(catalog);
    return {
        current_energy: Math.max(0, stats.strength * mult),
        current_mana: Math.max(0, stats.intel * mult),
    };
}
function buildingsInSlot(catalog, slotId, townTypeId) {
    return catalog.building.filter((row) => row.town_id === townTypeId && row.slot_num === slotId);
}
export function undesignedBuilding(catalog, slotId, townTypeId) {
    return (buildingsInSlot(catalog, slotId, townTypeId).find((row) => row.effect_type === 'TBD') ?? null);
}
/** Every town slot has a real building after the S8 layout; kept for call-site compatibility. */
export function isUndesignedSlot(_catalog, _slotId, _townTypeId) {
    return false;
}
export function isMarketplaceSlot(catalog, slotId, townTypeId) {
    return buildingsInSlot(catalog, slotId, townTypeId).some(isMarketplaceBuilding);
}
export function isLibrarySlot(catalog, slotId, townTypeId) {
    return buildingsInSlot(catalog, slotId, townTypeId).some(isLibraryBuilding);
}
export function armyOptions(catalog, slotId, townTypeId) {
    return buildingsInSlot(catalog, slotId, townTypeId).filter((row) => {
        if (isEmptyPlaceholder(row)) {
            return false;
        }
        // Necropolis sets building.class_id; Grove (and similar) leave it null and
        // link the unit via unit.bldg_id instead.
        if (row.class_id != null) {
            return true;
        }
        return unitForBuilding(catalog, row.id) != null;
    });
}
export function genericSlotBuildings(catalog, slotId, townTypeId) {
    return buildingsInSlot(catalog, slotId, townTypeId)
        .filter((row) => row.class_id == null && !isEmptyPlaceholder(row))
        .sort((a, b) => a.id - b.id);
}
export function genericRoot(buildings) {
    if (buildings.length === 0) {
        return null;
    }
    const roots = buildings.filter(isBuildRoot);
    return (roots[0] ?? null);
}
/** Branch key for dwelling upgrades: building.class_id, else unit.class_id. */
function armyBranchKey(catalog, building) {
    if (building.class_id != null && building.class_id > 0) {
        return building.class_id;
    }
    const unit = unitForBuilding(catalog, building.id);
    return unit?.class_id != null && unit.class_id > 0 ? unit.class_id : null;
}
export function nextInChain(current, catalog, slotId, townTypeId) {
    const group = isArmySlot(slotId)
        ? armyOptions(catalog, slotId, townTypeId)
        : genericSlotBuildings(catalog, slotId, townTypeId);
    const want = current.level + 1;
    const currentKey = armyBranchKey(catalog, current);
    const byBranch = group.find((row) => {
        if (row.level !== want) {
            return false;
        }
        if (currentKey != null) {
            return armyBranchKey(catalog, row) === currentKey;
        }
        return row.class_id === current.class_id;
    });
    if (byBranch) {
        return byBranch;
    }
    // Grove-style: Advanced X lists Basic X in requires.all when class_id is null.
    return (group.find((row) => row.level === want &&
        (row.requires ?? []).some((clause) => 'all' in clause && clause.all.includes(current.id))) ?? null);
}
export function buildingById(catalog, id) {
    if (id == null) {
        return null;
    }
    return catalog.building.find((row) => row.id === id) ?? null;
}
export function unitForBuilding(catalog, buildingId) {
    if (buildingId == null) {
        return null;
    }
    return catalog.unit.find((row) => row.bldg_id === buildingId) ?? null;
}
export function unitById(catalog, id) {
    if (!catalog || id == null) {
        return null;
    }
    return catalog.unit.find((row) => row.id === id) ?? null;
}
/** Case-insensitive exact name match; optional town filter when names collide. */
export function unitByName(catalog, name, townId) {
    if (!catalog) {
        return null;
    }
    const want = name.trim().toLowerCase();
    if (!want) {
        return null;
    }
    const matches = catalog.unit.filter((row) => row.name.trim().toLowerCase() === want);
    if (matches.length === 0) {
        return null;
    }
    if (townId != null && townId > 0) {
        const inTown = matches.find((row) => row.town_id === townId);
        if (inTown) {
            return inTown;
        }
    }
    return matches[0] ?? null;
}
export function unitIdByName(catalog, name, townId) {
    return unitByName(catalog, name, townId)?.id ?? null;
}
/** Hero class this unit belongs to — unit.class_id, else the dwelling's class. */
export function unitClassId(catalog, unit) {
    if (!unit) {
        return null;
    }
    if (unit.class_id != null && unit.class_id > 0) {
        return unit.class_id;
    }
    const building = buildingById(catalog, unit.bldg_id);
    return building?.class_id != null && building.class_id > 0
        ? building.class_id
        : null;
}
export function unitEffectiveTier(catalog, unit) {
    return unitCreatureTier(catalog, unit);
}
function unitCreatureTier(catalog, unit) {
    if (unit.tier != null && unit.tier > 0) {
        return unit.tier;
    }
    // unit.tier is canonical; slot is only a last resort when the row is missing.
    const building = buildingById(catalog, unit.bldg_id);
    if (building?.slot_num != null && isArmySlot(building.slot_num)) {
        return armyTier(building.slot_num);
    }
    return 99;
}
/**
 * Rank-th base (non-Advanced) unit of a hero class branch.
 * rank 1 = lowest-tier, rank 2 = next tier of that same class.
 */
export function classBranchBaseUnit(catalog, classId, rank) {
    if (classId == null || classId <= 0 || rank < 1) {
        return null;
    }
    const byTier = new Map();
    for (const unit of catalog.unit) {
        if (isAdvancedUnit(catalog, unit) || unitClassId(catalog, unit) !== classId) {
            continue;
        }
        const tier = unitCreatureTier(catalog, unit);
        const existing = byTier.get(tier);
        if (!existing || unit.id < existing.id) {
            byTier.set(tier, unit);
        }
    }
    const ranked = [...byTier.entries()]
        .sort((a, b) => a[0] - b[0] || a[1].id - b[1].id)
        .map((entry) => entry[1]);
    return ranked[rank - 1] ?? null;
}
export { unitHasTag } from './unitTags';
export function unitsWithTag(catalog, tagId) {
    return catalog.unit.filter((row) => unitHasTag(row, tagId));
}
export function unitIsStationary(unit) {
    return unit?.stationary === true;
}
/** Null speed never acts — not the same as speed 0. */
export function unitTakesTurns(unit) {
    return unit != null && unit.speed != null;
}
function jsonConfigRaw(rows, key) {
    return rows?.find((row) => row.key === key)?.value;
}
function asFiniteNumber(raw) {
    if (typeof raw === 'boolean') {
        return raw ? 1 : 0;
    }
    if (typeof raw === 'number') {
        return Number.isFinite(raw) ? raw : null;
    }
    if (typeof raw === 'string' && raw.trim()) {
        const n = Number(raw.trim());
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
/**
 * Size-aware `map_config` lookup: if value is an object keyed by size name,
 * return that entry; otherwise return the plain value.
 */
export function mapCfg(catalog, key, sizeName) {
    const value = jsonConfigRaw(catalog?.map_config, key);
    if (value == null ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        sizeName == null ||
        !String(sizeName).trim()) {
        return value;
    }
    const want = String(sizeName).trim().toLowerCase();
    const map = value;
    for (const [entryKey, entryValue] of Object.entries(map)) {
        if (entryKey.trim().toLowerCase() === want) {
            return entryValue;
        }
    }
    return value;
}
export function mapCfgNumber(catalog, key, sizeName, fallback) {
    const n = asFiniteNumber(mapCfg(catalog, key, sizeName));
    return n != null ? n : fallback;
}
export function mapCfgFlag(catalog, key, sizeName, fallback = false) {
    const raw = mapCfg(catalog, key, sizeName);
    if (raw == null || raw === '') {
        return fallback;
    }
    if (typeof raw === 'boolean') {
        return raw;
    }
    const text = String(raw).trim().toLowerCase();
    if (text === '1' || text === 'true' || text === 't' || text === 'yes' || text === 'on') {
        return true;
    }
    if (text === '0' || text === 'false' || text === 'f' || text === 'no' || text === 'off') {
        return false;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) {
        return n !== 0;
    }
    return fallback;
}
/** Round(normalCount × size_scale) for a map_config count key. */
export function scaledMapCount(catalog, key, sizeName, fallbackNormal = 0) {
    const name = sizeName?.trim() || defaultSizeName(catalog);
    const normal = mapCfgNumber(catalog, key, name, fallbackNormal);
    const scale = sizeScale(catalog, name);
    return Math.max(0, Math.round(normal * scale));
}
export function sizeNames(catalog) {
    const raw = jsonConfigRaw(catalog?.map_config, 'sizes');
    const out = [];
    if (Array.isArray(raw)) {
        for (const entry of raw) {
            if (entry == null) {
                continue;
            }
            const name = String(entry).trim().toLowerCase();
            if (name) {
                out.push(name);
            }
        }
    }
    return out.length > 0 ? out : ['normal', 'large', 'giant'];
}
export function sizeDims(catalog) {
    const raw = jsonConfigRaw(catalog?.map_config, 'size_dims');
    const out = {};
    if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [key, value] of Object.entries(raw)) {
            const n = asFiniteNumber(value);
            if (n != null && n > 0) {
                out[key.trim().toLowerCase()] = Math.floor(n);
            }
        }
    }
    if (Object.keys(out).length === 0) {
        return { normal: 72, large: 144, giant: 216 };
    }
    return out;
}
export function sizeScale(catalog, sizeName) {
    const name = sizeName?.trim() || defaultSizeName(catalog);
    const n = asFiniteNumber(mapCfg(catalog, 'size_scale', name));
    return n != null && n > 0 ? n : 1;
}
export function sizeDim(catalog, sizeName) {
    const name = (sizeName?.trim() || defaultSizeName(catalog)).toLowerCase();
    const dims = sizeDims(catalog);
    if (dims[name] != null && dims[name] > 0) {
        return dims[name];
    }
    if (name === 'large') {
        return 144;
    }
    if (name === 'giant') {
        return 216;
    }
    return 72;
}
export function defaultSizeName(catalog) {
    const raw = jsonConfigRaw(catalog?.map_config, 'new_size');
    if (typeof raw === 'string' && raw.trim()) {
        return raw.trim().toLowerCase();
    }
    const names = sizeNames(catalog);
    return names[0] ?? 'normal';
}
/** Resolve size name from stored WxH (or fall back to map_size / default). */
export function sizeNameFromDims(catalog, width, height, mapSize) {
    if (width != null && width > 0) {
        const dim = height != null && height > 0 ? Math.min(width, height) : width;
        for (const [name, value] of Object.entries(sizeDims(catalog))) {
            if (value === dim || value === width) {
                return name;
            }
        }
    }
    if (mapSize && mapSize.trim()) {
        const want = mapSize.trim().toLowerCase();
        const names = sizeNames(catalog);
        const match = names.find((name) => name === want);
        if (match) {
            return match;
        }
    }
    return defaultSizeName(catalog);
}
export function playersMin(catalog, sizeName) {
    const name = sizeName?.trim() || defaultSizeName(catalog);
    return Math.max(1, Math.floor(mapCfgNumber(catalog, 'players_min', name, 1)));
}
export function playersMax(catalog, sizeName) {
    const name = sizeName?.trim() || defaultSizeName(catalog);
    const min = playersMin(catalog, name);
    return Math.max(min, Math.floor(mapCfgNumber(catalog, 'players_max', name, 6)));
}
/** Slot index (1-based) → hero_type id from `map_config.new_heroes`; missing → null (Random). */
export function newHeroTypeId(catalog, slotIndex1Based) {
    const raw = jsonConfigRaw(catalog?.map_config, 'new_heroes');
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }
    const map = raw;
    const entry = map[String(slotIndex1Based)] ?? map[slotIndex1Based];
    const id = Math.trunc(Number(entry));
    return id > 0 ? id : null;
}
export function signTokenRadius(catalog) {
    return Math.max(1, Math.floor(mapCfgNumber(catalog, 'sign_token_radius', null, 12)));
}
export function questFeatureMult(catalog) {
    return Math.max(1, Math.floor(mapCfgNumber(catalog, 'quest_feature_mult', null, 8)));
}
export function aiCfgNumber(catalog, key, fallback) {
    const n = asFiniteNumber(jsonConfigRaw(catalog?.ai_config, key));
    return n != null ? n : fallback;
}
export function aiCfgRaw(catalog, key) {
    return jsonConfigRaw(catalog?.ai_config, key);
}
export function appConfigNumber(catalog, key, fallback) {
    const raw = catalog?.app_config.find((row) => row.key === key)?.value;
    const n = raw == null || raw === '' ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
}
export function combatConfigNumber(catalog, key, fallback) {
    const n = asFiniteNumber(jsonConfigRaw(catalog?.combat_config, key));
    return n != null ? n : fallback;
}
/** Roll a percent from a scalar or `{ min, max }` combat_config entry. */
export function combatConfigRollPercent(catalog, key, fallback, random) {
    const raw = jsonConfigRaw(catalog?.combat_config, key);
    if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
        const rec = raw;
        const min = asFiniteNumber(rec.min) ?? asFiniteNumber(rec.lo);
        const max = asFiniteNumber(rec.max) ?? asFiniteNumber(rec.hi);
        if (min != null && max != null) {
            const lo = Math.min(min, max);
            const hi = Math.max(min, max);
            return lo + random() * (hi - lo);
        }
    }
    return combatConfigNumber(catalog, key, fallback);
}
/** Map View overview hex width in px (`app_config.map_view_hex_px`). */
export function mapViewHexPx(catalog) {
    return Math.max(4, Math.floor(appConfigNumber(catalog, 'map_view_hex_px', 10)));
}
/** Map View wall overlay fill (`app_config.map_view_wall_color`). */
export function mapViewWallColor(catalog) {
    const raw = catalog?.app_config.find((row) => row.key === 'map_view_wall_color')
        ?.value;
    const text = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : '#2B2B2B';
    return parseCssHex(text) ?? 0x2b2b2b;
}
/** Hexes per day while airborne (`app_config.flight_speed`). */
export function flightSpeed(catalog) {
    return Math.max(1, Math.floor(appConfigNumber(catalog, 'flight_speed', 15)));
}
/** Gold charged per hex of straight-line flight at launch. */
export function flightCostPerHex(catalog) {
    return Math.max(0, Math.floor(appConfigNumber(catalog, 'flight_cost_per_hex', 50)));
}
/**
 * Flat movement cost on `hasRoad` hexes (`map_config.road_move_cost`).
 * Default 0.75 — cheaper than common open terrain (Grass/Dirt = 1.0).
 */
export function roadMoveCost(catalog) {
    return Math.max(0.01, mapCfgNumber(catalog, 'road_move_cost', null, 0.75));
}
/**
 * Straight-line hex span treated as "more than 1 day's walk" for AI empire
 * spread (Hanger build boost / flight usefulness).
 *
 * Derived from daily MP ÷ typical terrain move_cost (excludes dump-cost 99).
 * Catalog plains-scale costs are often ~1; raw days then exceed map size, so
 * the result is clamped to a usable band around {@link flightSpeed}.
 */
export function empireSpreadHexThreshold(catalog) {
    const dumpCost = 99;
    const costs = (catalog?.terrain ?? [])
        .map((row) => row.move_cost)
        .filter((c) => c != null && Number.isFinite(c) && c > 0 && c < dumpCost)
        .sort((a, b) => a - b);
    // Prefer cheaper (common open) terrain; fallback 100 if catalog empty/odd.
    const typical = costs.length > 0 ? costs[Math.floor(costs.length * 0.25)] : 100;
    const dailyMp = heroMovementPoints(catalog);
    const raw = Math.floor(dailyMp / Math.max(typical, 1e-9));
    const flightDay = flightSpeed(catalog);
    // At least one flight-day of hexes; cap so tiny maps still get a signal.
    return Math.max(flightDay, Math.min(raw, Math.max(flightDay * 3, 24)));
}
/** True when app_config value is 1 / true / "1". */
export function appConfigFlag(catalog, key, fallback = false) {
    const raw = catalog?.app_config.find((row) => row.key === key)?.value;
    if (raw == null || raw === '') {
        return fallback;
    }
    if (typeof raw === 'boolean') {
        return raw;
    }
    const text = String(raw).trim().toLowerCase();
    if (text === '1' || text === 'true' || text === 't' || text === 'yes') {
        return true;
    }
    if (text === '0' || text === 'false' || text === 'f' || text === 'no') {
        return false;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) {
        return n !== 0;
    }
    return fallback;
}
/** Show world-map hex outline strokes (`map_config.show_hexes`). */
export function mapShowHexesWorld(catalog) {
    return mapCfgFlag(catalog, 'show_hexes', null, false);
}
/** Show battle hex outline strokes (app_config map_show_hexes_battle). */
export function mapShowHexesBattle(catalog) {
    return appConfigFlag(catalog, 'map_show_hexes_battle', true);
}
/**
 * World hex radius sampled for battle prop dressing
 * (`app_config.battle_prop_sample_radius`, default 2).
 */
export function battlePropSampleRadiusConfig(catalog) {
    return Math.max(0, Math.floor(appConfigNumber(catalog, 'battle_prop_sample_radius', 2)));
}
/**
 * Scales world-sampled prop density onto the battlefield
 * (`app_config.battle_prop_density_multiplier`, default 0.33).
 */
export function battlePropDensityMultiplier(catalog) {
    return Math.max(0, appConfigNumber(catalog, 'battle_prop_density_multiplier', 0.33));
}
/** BR: terrain.image_path textures vs terrain.color flat fills (`map_config.use_images`). */
export function mapUseTerrainImages(catalog) {
    return mapCfgFlag(catalog, 'use_images', null, true);
}
export function hexTerrainByName(catalog, name) {
    if (!catalog || !name) {
        return null;
    }
    const trimmed = name.trim();
    return (catalog.terrain.find((row) => row.name === trimmed) ??
        catalog.terrain.find((row) => row.name.replaceAll('_', ' ').toLowerCase() ===
            trimmed.replaceAll('_', ' ').toLowerCase()) ??
        null);
}
export function hexTerrainById(catalog, id) {
    if (!catalog || id == null || id <= 0) {
        return null;
    }
    return catalog.terrain.find((row) => row.id === id) ?? null;
}
/**
 * Buffer terrain required between two chunk terrains, if either row declares one.
 * Returns null when blank (normal 1-hex border) or on conflicting declarations.
 */
export function requiredBufferBetween(catalog, a, b) {
    if (!catalog || !a || !b || a.id === b.id) {
        return null;
    }
    const fromA = a.required_buffer[b.id];
    const fromB = b.required_buffer[a.id];
    if (fromA != null && fromB != null && fromA !== fromB) {
        // Asymmetric matrix entry — do not invent a buffer.
        return null;
    }
    const bufferId = fromA ?? fromB;
    if (bufferId == null || bufferId <= 0) {
        return null;
    }
    return hexTerrainById(catalog, bufferId);
}
/** Dev toggle: always show full enemy inspect stats (independent of Expose). */
export function debugSeeEnemyStats(catalog) {
    return appConfigNumber(catalog, 'debug_see_enemy_stats', 0) !== 0;
}
/**
 * Post-turn battle log popup seconds.
 * 0 = skip popup; 99 = stay open until dismissed (no auto-advance).
 */
export function combatLogTimerSeconds(catalog) {
    return Math.max(0, Math.floor(appConfigNumber(catalog, 'combat_log_timer', 2)));
}
/**
 * Post-combat results popup seconds.
 * 0 = skip popup; 99 = stay open until dismissed (no auto-advance).
 */
export function combatEndTimerSeconds(catalog) {
    return Math.max(0, Math.floor(appConfigNumber(catalog, 'combat_end_timer', 99)));
}
/** Catalog convention: always enterable, dumps remaining MP. Not a literal cost. */
export const DUMP_REMAINING_MOVE_COST = 99;
