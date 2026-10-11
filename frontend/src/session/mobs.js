import { buildingById, buildingGrowth, isAdvancedUnit, unitById, } from '../town/catalog';
import { ARMY_STACK_SLOTS, } from './types';
function padSlots(slots) {
    const next = slots.slice(0, ARMY_STACK_SLOTS);
    while (next.length < ARMY_STACK_SLOTS) {
        next.push(null);
    }
    return next;
}
function nextMobId(session) {
    let n = session.mobs.length + 1;
    let id = `mob-${n}`;
    while (session.mobs.some((row) => row.id === id)) {
        n += 1;
        id = `mob-${n}`;
    }
    return id;
}
function nextStackId(session) {
    let n = session.units.length + 1;
    while (session.units.some((unit) => unit.id === `unit-${n}`)) {
        n += 1;
    }
    return `unit-${n}`;
}
function appendStack(session, mobId, unitId, qty) {
    const id = nextStackId(session);
    const stack = {
        id,
        unit_id: unitId,
        qty,
        town_id: null,
        hero_id: null,
        mob_id: mobId,
    };
    return {
        session: { ...session, units: [...session.units, stack] },
        stackId: id,
    };
}
/**
 * Copy layer-6 mobs into the session. Skips when a save already has heroes
 * or mobs, so reload does not respawn what was killed or moved.
 */
export function hydrateGeneratedMobs(session, generated) {
    if (session.mobs.length > 0 || session.heroes.length > 0) {
        return session;
    }
    if (!generated || generated.length === 0) {
        return session;
    }
    let next = session;
    for (const row of generated) {
        if (!Number.isFinite(row.q) || !Number.isFinite(row.r)) {
            continue;
        }
        const parts = (row.stacks ?? [])
            .map((stack) => {
            const unitId = stack.unitId ?? stack.unit_id;
            const qty = Math.floor(Number(stack.qty));
            return unitId != null && unitId > 0 && qty > 0
                ? { unitId, qty }
                : null;
        })
            .filter((part) => part != null)
            .slice(0, ARMY_STACK_SLOTS);
        if (parts.length === 0) {
            continue;
        }
        const mobId = nextMobId(next);
        const slots = padSlots([]);
        let slot = 0;
        for (const part of parts) {
            const added = appendStack(next, mobId, part.unitId, part.qty);
            next = added.session;
            slots[slot] = added.stackId;
            slot += 1;
        }
        const guardsLoot = row.guardsLoot === true || row.guards_loot === true;
        const mob = {
            id: mobId,
            position: { q: row.q, r: row.r },
            slots_1_to_6: slots,
            guards_loot: guardsLoot ? true : undefined,
        };
        next = { ...next, mobs: [...next.mobs, mob] };
    }
    return next;
}
function dwellingGrowthFor(catalog, unitId) {
    const unit = unitById(catalog, unitId);
    if (!unit) {
        return 0;
    }
    return buildingGrowth(buildingById(catalog, unit.bldg_id));
}
function primaryUnitId(session, catalog, mob) {
    const stacks = mob.slots_1_to_6
        .map((id) => (id ? session.units.find((row) => row.id === id) : null))
        .filter((row) => row != null && row.qty > 0);
    const basic = stacks.find((row) => {
        const unit = unitById(catalog, row.unit_id);
        return unit != null && !isAdvancedUnit(catalog, unit);
    });
    return (basic ?? stacks[0])?.unit_id ?? null;
}
function distributeQty(session, stackIds, qty) {
    if (stackIds.length === 0 || qty <= 0) {
        return session;
    }
    const base = Math.floor(qty / stackIds.length);
    let rem = qty - base * stackIds.length;
    const add = new Map();
    for (const id of stackIds) {
        const extra = rem > 0 ? 1 : 0;
        rem -= extra;
        add.set(id, base + extra);
    }
    return {
        ...session,
        units: session.units.map((row) => {
            const extra = add.get(row.id);
            return extra ? { ...row, qty: row.qty + extra } : row;
        }),
    };
}
function growOneMob(session, catalog, mob) {
    const unitId = primaryUnitId(session, catalog, mob);
    if (unitId == null) {
        return session;
    }
    const growth = dwellingGrowthFor(catalog, unitId);
    if (growth <= 0) {
        return session;
    }
    const slots = padSlots(mob.slots_1_to_6);
    const empty = slots.findIndex((id) => id == null);
    if (empty >= 0) {
        const added = appendStack(session, mob.id, unitId, growth);
        const nextSlots = [...slots];
        nextSlots[empty] = added.stackId;
        return {
            ...added.session,
            mobs: added.session.mobs.map((row) => row.id === mob.id ? { ...row, slots_1_to_6: nextSlots } : row),
        };
    }
    const sameType = slots.filter((id) => {
        if (!id) {
            return false;
        }
        return session.units.find((row) => row.id === id)?.unit_id === unitId;
    });
    const targets = sameType.length > 0 ? sameType : slots.filter((id) => id != null);
    return distributeQty(session, targets, growth);
}
/** Same dwelling growth numbers as a recruited army; 6-stack cap then even split. */
export function applyWeeklyMobGrowth(session, catalog) {
    let next = session;
    for (const mob of session.mobs) {
        const live = next.mobs.find((row) => row.id === mob.id);
        if (live) {
            next = growOneMob(next, catalog, live);
        }
    }
    return next;
}
export function findMobAt(session, q, r) {
    return session.mobs.find((mob) => mob.position.q === q && mob.position.r === r);
}
export function mobLeadStack(session, mob) {
    const stacks = mob.slots_1_to_6
        .map((id) => (id ? session.units.find((row) => row.id === id) : null))
        .filter((row) => row != null && row.qty > 0);
    return [...stacks].sort((a, b) => b.qty - a.qty)[0] ?? null;
}
/** Total living qty of one unit type across all mob slots (matches surrender absorb). */
export function mobUnitQty(session, mob, unitId) {
    let total = 0;
    for (const id of mob.slots_1_to_6) {
        if (!id) {
            continue;
        }
        const row = session.units.find((stack) => stack.id === id);
        if (row && row.qty > 0 && row.unit_id === unitId) {
            total += row.qty;
        }
    }
    return total;
}
export function mobLabel(session, catalog, mob) {
    const top = mobLeadStack(session, mob);
    if (!top) {
        return 'Mob';
    }
    const name = unitById(catalog, top.unit_id)?.name ?? 'Mob';
    // Weekly growth can leave multiple same-type stacks; show consolidated qty.
    return `${mobUnitQty(session, mob, top.unit_id)} ${name}`;
}
export function removeWorldMob(session, mob) {
    const drop = new Set(mob.slots_1_to_6.filter((id) => id != null && id !== ''));
    return {
        ...session,
        units: session.units.filter((row) => !drop.has(row.id) && row.mob_id !== mob.id),
        mobs: session.mobs.filter((row) => row.id !== mob.id),
        // Clear Notice Board Defeat-Mob pointers so a later Accept can respawn.
        features: (session.features ?? []).map((row) => row.kind === 'notice_board' && row.target_mob_id === mob.id
            ? { ...row, target_mob_id: null }
            : row),
    };
}
