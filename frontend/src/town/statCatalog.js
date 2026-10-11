/** Single mapping: `stat.key` → `hero_type` column. Regen keys omitted (no column yet). */
export const STAT_KEY_TO_HERO_COLUMN = {
    SPD: 'speed',
    STAM: 'stamina',
    STR: 'strength',
    INT: 'intel',
    DEF: 'defense',
    RES: 'resist',
    CRIT_PCT: 'crit_pct',
    CRIT_AMT: 'crit_amt',
};
const COLUMN_TO_STAT_KEY = {
    speed: 'SPD',
    stamina: 'STAM',
    strength: 'STR',
    intel: 'INT',
    defense: 'DEF',
    resist: 'RES',
    crit_pct: 'CRIT_PCT',
    crit_amt: 'CRIT_AMT',
};
const warnedMissingStat = new Set();
function warnMissingStatKey(key, context) {
    const id = `${key}:${context}`;
    if (warnedMissingStat.has(id)) {
        return;
    }
    warnedMissingStat.add(id);
    console.warn(`[stat] no row for key "${key}" (${context})`);
}
export function parseStatTags(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    const ids = [];
    for (const entry of value) {
        const n = Number(entry);
        if (Number.isFinite(n) && n > 0) {
            ids.push(Math.floor(n));
        }
    }
    return ids;
}
export function asStatRows(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const rows = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const rec = entry;
        const id = Number(rec.id);
        const key = String(rec.key ?? '').trim();
        if (!Number.isFinite(id) || !key) {
            continue;
        }
        const name = String(rec.name ?? '').trim();
        const description = rec.description == null || rec.description === ''
            ? null
            : String(rec.description);
        rows.push({
            id: Math.floor(id),
            key,
            name: name || key,
            description,
            tags: parseStatTags(rec.tags),
            sort_order: Number.isFinite(Number(rec.sort_order))
                ? Math.floor(Number(rec.sort_order))
                : id,
        });
    }
    return rows.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
}
export function isStatGroup(row) {
    return row.tags.length > 0;
}
export function statByKey(catalog, key) {
    const normalized = key.trim().toUpperCase();
    return catalog?.stat.find((row) => row.key.toUpperCase() === normalized);
}
export function statById(catalog, id) {
    return catalog?.stat.find((row) => row.id === id);
}
const warnedRegenStatKey = new Set();
function regenStatIdForKey(catalog, key, context) {
    const row = statByKey(catalog, key);
    if (!row) {
        const id = `${key}:${context}`;
        if (!warnedRegenStatKey.has(id)) {
            warnedRegenStatKey.add(id);
            console.warn(`[stat] no row for key "${key}" (${context})`);
        }
        return null;
    }
    return row.id;
}
export function manaRegenStatId(catalog) {
    return regenStatIdForKey(catalog, 'MANA', 'mana regen');
}
export function energyRegenStatId(catalog) {
    return regenStatIdForKey(catalog, 'ENERGY', 'energy regen');
}
/** Member stat rows for a group (PROTECT, CRITS, REGEN). */
export function statGroupMembers(catalog, group) {
    if (!catalog || group.tags.length === 0) {
        return [];
    }
    return group.tags
        .map((id) => statById(catalog, id))
        .filter((row) => row != null);
}
export function heroColumnForStatKey(key) {
    return STAT_KEY_TO_HERO_COLUMN[key.trim().toUpperCase()] ?? null;
}
export function statKeyForHeroColumn(column) {
    return COLUMN_TO_STAT_KEY[column];
}
/** Real hero stats with a `hero_type` column, in `stat.sort_order`. */
export function heroDisplayStats(catalog) {
    if (!catalog) {
        return [];
    }
    const out = [];
    for (const row of catalog.stat) {
        if (isStatGroup(row)) {
            continue;
        }
        const column = heroColumnForStatKey(row.key);
        if (!column) {
            continue;
        }
        out.push({ column, stat: row });
    }
    return out;
}
export function statNameForHeroColumn(catalog, column, context = 'display') {
    const key = statKeyForHeroColumn(column);
    const row = statByKey(catalog, key);
    if (!row) {
        warnMissingStatKey(key, context);
        return key;
    }
    return row.name;
}
export function statDescriptionForHeroColumn(catalog, column) {
    const row = statByKey(catalog, statKeyForHeroColumn(column));
    return row?.description ?? null;
}
export function statNameForHeroStatKey(catalog, column) {
    return statNameForHeroColumn(catalog, column, 'stat bump');
}
/** Lines for hero tooltips: "Speed: 12" in table order. */
export function heroStatValueLines(catalog, stats) {
    return heroDisplayStats(catalog).map(({ column, stat }) => `${stat.name}: ${stats[column]}`);
}
