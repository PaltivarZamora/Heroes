/** Diamond-stacked battlefield footprint codes (odd-r aware via axial math). */
export const FOOTPRINT_CODES = ['1x1', '2x1', '3x1', '2x2', '3x2', '3x3'];
/** Bottom→top row widths for each shape. */
const FOOTPRINT_ROW_WIDTHS = {
    '1x1': [1],
    '2x1': [2],
    '3x1': [3],
    '2x2': [2, 1],
    '3x2': [3, 2],
    '3x3': [3, 2, 3],
};
/** Pointy-top northern neighbor deltas (toward smaller `r` / screen top). */
const NORTH_DELTAS = [
    { q: 0, r: -1 },
    { q: 1, r: -1 },
];
export function isFootprintCode(value) {
    return FOOTPRINT_CODES.includes(value);
}
/**
 * Parse `unit.footprint` / `prop.footprint`. Unknown → `1x1`.
 * Legacy numeric hex_size: 1→1x1, 2→2x1 (linear pair); larger → 1x1.
 */
export function parseFootprint(raw) {
    if (typeof raw === 'string') {
        const trimmed = raw.trim().toLowerCase();
        if (isFootprintCode(trimmed)) {
            return trimmed;
        }
    }
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n) && n >= 2) {
        return Math.floor(n) === 2 ? '2x1' : '1x1';
    }
    return '1x1';
}
/** Bounding cols×rows of the diamond (for sprite scaling). */
export function footprintExtent(code) {
    const widths = FOOTPRINT_ROW_WIDTHS[code];
    return {
        cols: Math.max(...widths),
        rows: widths.length,
        hexCount: widths.reduce((sum, w) => sum + w, 0),
    };
}
/**
 * Contiguous row of `width` hexes centered among northern neighbors of `below`.
 */
function centeredRowAbove(below, width) {
    const seen = new Set();
    const cands = [];
    for (const hex of below) {
        for (const d of NORTH_DELTAS) {
            const next = { q: hex.q + d.q, r: hex.r + d.r };
            const key = `${next.q},${next.r}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            cands.push(next);
        }
    }
    cands.sort((a, b) => a.q - b.q || a.r - b.r);
    if (cands.length <= width) {
        return cands;
    }
    const start = Math.floor((cands.length - width) / 2);
    return cands.slice(start, start + width);
}
/**
 * All hexes covered by a footprint.
 * `along`: +1 extends bottom row +q (attacker / props); −1 extends −q (defender).
 * Origin = leftmost (along=+1) or rightmost (along=−1) hex of the bottom row.
 */
export function footprintHexes(origin, code, along = 1) {
    const widths = FOOTPRINT_ROW_WIDTHS[code] ?? FOOTPRINT_ROW_WIDTHS['1x1'];
    const bottomW = widths[0] ?? 1;
    let row = [];
    for (let i = 0; i < bottomW; i += 1) {
        row.push({ q: origin.q + along * i, r: origin.r });
    }
    const out = [...row];
    for (let u = 1; u < widths.length; u += 1) {
        row = centeredRowAbove(row, widths[u] ?? 1);
        out.push(...row);
    }
    return out;
}
/**
 * Prop footprints anchored on the **centre** hex (BR S9-12 gangplank 3x1).
 * Odd-width bottom rows centre on `origin`; even widths keep left-origin
 * `footprintHexes(..., +1)` so town/unit 2x1 is unchanged when called there.
 */
export function footprintHexesCentered(origin, code) {
    const widths = FOOTPRINT_ROW_WIDTHS[code] ?? FOOTPRINT_ROW_WIDTHS['1x1'];
    const bottomW = widths[0] ?? 1;
    if (bottomW % 2 === 0) {
        return footprintHexes(origin, code, 1);
    }
    const half = Math.floor(bottomW / 2);
    let row = [];
    for (let i = -half; i <= half; i += 1) {
        row.push({ q: origin.q + i, r: origin.r });
    }
    const out = [...row];
    for (let u = 1; u < widths.length; u += 1) {
        row = centeredRowAbove(row, widths[u] ?? 1);
        out.push(...row);
    }
    return out;
}
/** Bottom-row hexes only (for render anchor: bottom-center). */
export function footprintBottomRow(origin, code, along = 1) {
    const bottomW = FOOTPRINT_ROW_WIDTHS[code]?.[0] ?? 1;
    const row = [];
    for (let i = 0; i < bottomW; i += 1) {
        row.push({ q: origin.q + along * i, r: origin.r });
    }
    return row;
}
/** Bottom row centred on `origin` (props / gangplank). */
export function footprintBottomRowCentered(origin, code) {
    const bottomW = FOOTPRINT_ROW_WIDTHS[code]?.[0] ?? 1;
    if (bottomW % 2 === 0) {
        return footprintBottomRow(origin, code, 1);
    }
    const half = Math.floor(bottomW / 2);
    const row = [];
    for (let i = -half; i <= half; i += 1) {
        row.push({ q: origin.q + i, r: origin.r });
    }
    return row;
}
