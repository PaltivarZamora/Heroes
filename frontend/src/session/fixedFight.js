import { getSelectedMapHeroId } from '../hex/HexMap';
import { buildingById, buildingGrowth, getCachedCatalog, heroResourcePools, isAdvancedUnit, unitById, unitEffectiveTier, unitHasTag, unitIdByName, } from '../town/catalog';
import { DEFAULT_AI_ARCH_ID } from '../ai/types';
import { insertHeroArmyStack, nextUnitStackId } from './accessors';
import { startingResources } from './create';
import { difficultyIdFromSettings } from './gameDifficulty';
import { emptyHeroInventory } from '../items/state';
import { ARMY_STACK_SLOTS, playerIdForSlot, } from './types';
/** Fortress ladder for Raise Demons (+ Pit Fiends enemy) — resolved by name. */
const RAISE_DEMON_ENEMY_SPEC = [
    { name: 'Bandit', qty: 20 },
    { name: 'Gypsy', qty: 15 },
    { name: 'Yeti', qty: 10 },
    { name: 'Arsonist', qty: 2 },
    { name: 'Ninja', qty: 2 },
    { name: 'Assassin', qty: 2 },
];
const PIT_FIEND_ARCH_NAME = 'Pit Fiend Arch';
const PIT_FIEND_ARCH_QTY = 3;
const HORNED_HELLION_NAME = 'Horned Hellion';
function resolveNamedArmy(catalog, parts) {
    const out = [];
    for (const part of parts) {
        const id = unitIdByName(catalog, part.name);
        if (id == null) {
            return null;
        }
        out.push({ unitId: id, qty: part.qty });
    }
    return out;
}
function isImpUnitId(catalog, unitId) {
    const name = unitById(catalog, unitId)?.name.trim().toLowerCase() ?? '';
    return name === 'imp' || name === 'advanced imp';
}
/** BR S6-41: T1/T3/T3/T4/T5/T5 — skips T2/T6; intentional (data fit). */
const HOARD_TIERS = [1, 3, 3, 4, 5, 5];
const HOARD_LEVEL = 25;
function nextMobId(session) {
    let n = session.mobs.length + 1;
    let id = `mob-${n}`;
    while (session.mobs.some((row) => row.id === id)) {
        n += 1;
        id = `mob-${n}`;
    }
    return id;
}
function nextHeroId(session) {
    let n = session.heroes.length + 1;
    let id = `hero-${n}`;
    while (session.heroes.some((row) => row.id === id)) {
        n += 1;
        id = `hero-${n}`;
    }
    return id;
}
function clearHeroArmy(session, heroId) {
    const hero = session.heroes.find((row) => row.id === heroId);
    if (!hero) {
        return session;
    }
    const drop = new Set(hero.army.slots_1_to_6.filter((id) => id != null));
    return {
        ...session,
        units: session.units.filter((row) => !drop.has(row.id)),
        heroes: session.heroes.map((row) => row.id === heroId
            ? {
                ...row,
                army: {
                    ...row.army,
                    slots_1_to_6: Array.from({ length: ARMY_STACK_SLOTS }, () => null),
                },
            }
            : row),
    };
}
/** Swap Imp stacks on this hero to Horned Hellions, keeping qty. */
function replaceHeroImpsWithHornedHellions(session, heroId, catalog) {
    const hero = session.heroes.find((row) => row.id === heroId);
    if (!hero) {
        return session;
    }
    const hellionId = unitIdByName(catalog, HORNED_HELLION_NAME);
    if (hellionId == null) {
        return session;
    }
    const heroStackIds = new Set(hero.army.slots_1_to_6.filter((id) => id != null));
    return {
        ...session,
        units: session.units.map((row) => heroStackIds.has(row.id) && isImpUnitId(catalog, row.unit_id)
            ? { ...row, unit_id: hellionId }
            : row),
    };
}
function spawnFixedMob(session, position, parts) {
    const mobId = nextMobId(session);
    const slots = Array.from({ length: ARMY_STACK_SLOTS }, () => null);
    let next = session;
    let slot = 0;
    for (const part of parts) {
        if (slot >= ARMY_STACK_SLOTS || part.qty <= 0) {
            continue;
        }
        const id = nextUnitStackId(next);
        const stack = {
            id,
            unit_id: part.unitId,
            qty: part.qty,
            town_id: null,
            hero_id: null,
            mob_id: mobId,
        };
        next = { ...next, units: [...next.units, stack] };
        slots[slot] = id;
        slot += 1;
    }
    if (slot === 0) {
        return null;
    }
    const mob = { id: mobId, position: { ...position }, slots_1_to_6: slots };
    return { session: { ...next, mobs: [...next.mobs, mob] }, mobId };
}
function pickDebugHero(session) {
    const selectedId = getSelectedMapHeroId();
    const selected = selectedId
        ? session.heroes.find((row) => row.id === selectedId)
        : undefined;
    const human = session.players.find((player) => !player.is_ai);
    return (selected ??
        (human
            ? session.heroes.find((row) => row.player_id === human.id)
            : undefined) ??
        session.heroes[0] ??
        null);
}
function tagIdByName(catalog, name) {
    const needle = name.trim().toLowerCase();
    const row = catalog.unit_tag.find((entry) => entry.value.trim().toLowerCase() === needle);
    return row?.id ?? null;
}
function citadelTownId(catalog) {
    const row = catalog.town.find((entry) => entry.name.trim().toLowerCase() === 'citadel');
    return row?.id ?? null;
}
function unitTownTypeId(catalog, unit) {
    if (unit.town_id != null && unit.town_id > 0) {
        return unit.town_id;
    }
    const building = buildingById(catalog, unit.bldg_id);
    return building != null && building.town_id > 0 ? building.town_id : null;
}
/** Same dwelling-growth qty used when spawning world mobs. */
function growthQty(catalog, unit) {
    return Math.max(1, buildingGrowth(buildingById(catalog, unit.bldg_id)));
}
function pickRandom(pool, random) {
    if (pool.length === 0) {
        return null;
    }
    return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}
function combatEligible(unit) {
    return unit.has_abilities && (unit.speed ?? 0) > 0;
}
function unitsMatchingTagsAtTier(catalog, tagIds, tier, opts) {
    const wanted = new Set(tagIds.filter((id) => id > 0));
    if (wanted.size === 0) {
        return [];
    }
    const base = catalog.unit.filter((unit) => {
        if (!combatEligible(unit) || isAdvancedUnit(catalog, unit)) {
            return false;
        }
        if (unitEffectiveTier(catalog, unit) !== tier) {
            return false;
        }
        if (opts?.townId != null && unitTownTypeId(catalog, unit) !== opts.townId) {
            return false;
        }
        if (opts?.humanoidOnly) {
            const humanoid = tagIdByName(catalog, 'Humanoid');
            if (humanoid == null || !unitHasTag(unit, humanoid)) {
                return false;
            }
        }
        return [...wanted].some((tagId) => unitHasTag(unit, tagId));
    });
    if (base.length > 0) {
        return base;
    }
    // Fallback: allow Advanced if no base unit exists at this tier/tag.
    return catalog.unit.filter((unit) => {
        if (!combatEligible(unit)) {
            return false;
        }
        if (unitEffectiveTier(catalog, unit) !== tier) {
            return false;
        }
        if (opts?.townId != null && unitTownTypeId(catalog, unit) !== opts.townId) {
            return false;
        }
        if (opts?.humanoidOnly) {
            const humanoid = tagIdByName(catalog, 'Humanoid');
            if (humanoid == null || !unitHasTag(unit, humanoid)) {
                return false;
            }
        }
        return [...wanted].some((tagId) => unitHasTag(unit, tagId));
    });
}
function pickTaggedStack(catalog, tagIds, tier, random, opts) {
    const unit = pickRandom(unitsMatchingTagsAtTier(catalog, tagIds, tier, opts), random);
    if (!unit) {
        return null;
    }
    return { unitId: unit.id, qty: growthQty(catalog, unit) };
}
function buildHolyWrathEnemies(catalog, random) {
    const demon = tagIdByName(catalog, 'Demon');
    const undead = tagIdByName(catalog, 'Undead');
    if (demon == null || undead == null) {
        return null;
    }
    const parts = [];
    const t1 = pickTaggedStack(catalog, [demon], 1, random);
    const t2 = pickTaggedStack(catalog, [undead], 2, random);
    if (!t1 || !t2) {
        return null;
    }
    parts.push(t1, t2);
    for (let tier = 3; tier <= 6; tier += 1) {
        const tag = random() < 0.5 ? demon : undead;
        const part = pickTaggedStack(catalog, [tag], tier, random);
        if (!part) {
            // If the chosen tag has no unit at this tier, try the other.
            const other = tag === demon ? undead : demon;
            const fallback = pickTaggedStack(catalog, [other], tier, random);
            if (!fallback) {
                return null;
            }
            parts.push(fallback);
        }
        else {
            parts.push(part);
        }
    }
    return parts;
}
function buildHoardArmy(catalog, random) {
    const humanoid = tagIdByName(catalog, 'Humanoid');
    const townId = citadelTownId(catalog);
    if (humanoid == null || townId == null) {
        return null;
    }
    const parts = [];
    for (const tier of HOARD_TIERS) {
        const part = pickTaggedStack(catalog, [humanoid], tier, random, {
            townId,
            humanoidOnly: true,
        });
        if (!part) {
            return null;
        }
        parts.push(part);
    }
    return parts;
}
function knightClassId(catalog) {
    const row = catalog.hero_type.find((entry) => entry.name.trim().toLowerCase() === 'knight');
    return row?.id ?? null;
}
function configureKnightHero(session, heroId, catalog, classId) {
    const pools = heroResourcePools(catalog, {
        class_id: classId,
        current_level: HOARD_LEVEL,
    });
    return {
        ...session,
        heroes: session.heroes.map((row) => row.id === heroId
            ? {
                ...row,
                class_id: classId,
                current_level: HOARD_LEVEL,
                current_xp: 0,
                learned_abilities: [],
                used_abilities_this_battle: [],
                used_abilities_today: [],
                current_mana: pools.current_mana,
                current_energy: pools.current_energy,
            }
            : row),
    };
}
function fillHeroArmy(session, heroId, parts) {
    let next = clearHeroArmy(session, heroId);
    let slot = 0;
    for (const part of parts) {
        if (slot >= ARMY_STACK_SLOTS || part.qty <= 0) {
            continue;
        }
        next = insertHeroArmyStack(next, heroId, slot, {
            id: nextUnitStackId(next),
            unitId: part.unitId,
            qty: part.qty,
        });
        slot += 1;
    }
    return next;
}
/** Solo debug games may only have player-1; hero vs hero needs a distinct defender slot. */
function opponentPlayerForFixedFight(session, attacker) {
    const existing = session.players.find((player) => player.is_ai) ??
        session.players.find((player) => player.id !== attacker.player_id);
    if (existing) {
        return { session, player: existing };
    }
    const slot = session.players.length + 1;
    const player = {
        id: playerIdForSlot(slot),
        is_ai: true,
        ai_spectator: false,
        arch_id: DEFAULT_AI_ARCH_ID,
        eliminated: false,
        resources: startingResources(difficultyIdFromSettings(session.game.settings), true),
        hero_ids: [],
        town_ids: [],
        explored: [],
    };
    return {
        session: { ...session, players: [...session.players, player] },
        player,
    };
}
function ensureOpponentHero(session, attacker, catalog, classId) {
    const { session: withPlayer, player: aiPlayer } = opponentPlayerForFixedFight(session, attacker);
    session = withPlayer;
    const existing = session.heroes.find((row) => row.player_id === aiPlayer.id && row.id !== attacker.id);
    if (existing) {
        return { session, heroId: existing.id };
    }
    const id = nextHeroId(session);
    const pools = heroResourcePools(catalog, {
        class_id: classId,
        current_level: HOARD_LEVEL,
    });
    const hero = {
        id,
        player_id: aiPlayer.id,
        name: 'Hoard Rival',
        class_id: classId,
        image_path: null,
        position: { ...attacker.position },
        movement_remaining: 0,
        army: {
            slot_0: 'Hoard Rival',
            slots_1_to_6: Array.from({ length: ARMY_STACK_SLOTS }, () => null),
        },
        learned_abilities: [],
        current_level: HOARD_LEVEL,
        current_xp: 0,
        used_abilities_this_battle: [],
        used_abilities_today: [],
        arch_id: null,
        current_mana: pools.current_mana,
        current_energy: pools.current_energy,
        flight: null,
        ...emptyHeroInventory(),
    };
    return {
        session: {
            ...session,
            heroes: [...session.heroes, hero],
            players: session.players.map((player) => player.id === aiPlayer.id
                ? { ...player, hero_ids: [...player.hero_ids, id] }
                : player),
        },
        heroId: id,
    };
}
function prepareHolyWrath(session, hero, catalog, random) {
    const enemies = buildHolyWrathEnemies(catalog, random);
    if (!enemies) {
        return { error: 'Holy Wrath: could not pick Demon/Undead stacks' };
    }
    const spawned = spawnFixedMob(session, hero.position, enemies);
    if (!spawned) {
        return { error: 'Could not spawn Holy Wrath enemies' };
    }
    return {
        session: spawned.session,
        heroId: hero.id,
        mobId: spawned.mobId,
        defenderHeroId: null,
        notice: `${hero.name}: Holy Wrath`,
    };
}
function ensureMirrorDefender(session, attacker) {
    const { session: withPlayer, player: aiPlayer } = opponentPlayerForFixedFight(session, attacker);
    session = withPlayer;
    const existing = session.heroes.find((row) => row.player_id === aiPlayer.id && row.id !== attacker.id);
    if (existing) {
        return { session, heroId: existing.id };
    }
    const id = nextHeroId(session);
    const hero = {
        id,
        player_id: aiPlayer.id,
        name: `${attacker.name} (Mirror)`,
        class_id: attacker.class_id,
        image_path: attacker.image_path,
        position: { ...attacker.position },
        movement_remaining: 0,
        army: {
            slot_0: attacker.army.slot_0,
            slots_1_to_6: Array.from({ length: ARMY_STACK_SLOTS }, () => null),
        },
        learned_abilities: [...attacker.learned_abilities],
        current_level: attacker.current_level,
        current_xp: attacker.current_xp,
        used_abilities_this_battle: [],
        used_abilities_today: [],
        arch_id: attacker.arch_id,
        current_mana: attacker.current_mana,
        current_energy: attacker.current_energy,
        flight: null,
        ...emptyHeroInventory(),
    };
    return {
        session: {
            ...session,
            heroes: [...session.heroes, hero],
            players: session.players.map((player) => player.id === aiPlayer.id
                ? { ...player, hero_ids: [...player.hero_ids, id] }
                : player),
        },
        heroId: id,
    };
}
function cloneHeroAsMirror(session, fromHeroId, toHeroId) {
    const from = session.heroes.find((row) => row.id === fromHeroId);
    if (!from) {
        return session;
    }
    let next = clearHeroArmy(session, toHeroId);
    for (let slot = 0; slot < ARMY_STACK_SLOTS; slot += 1) {
        const stackId = from.army.slots_1_to_6[slot];
        if (!stackId) {
            continue;
        }
        const stack = next.units.find((row) => row.id === stackId);
        if (!stack || stack.qty <= 0) {
            continue;
        }
        next = insertHeroArmyStack(next, toHeroId, slot, {
            id: nextUnitStackId(next),
            unitId: stack.unit_id,
            qty: stack.qty,
        });
    }
    return {
        ...next,
        heroes: next.heroes.map((row) => row.id === toHeroId
            ? {
                ...row,
                name: `${from.name} (Mirror)`,
                class_id: from.class_id,
                image_path: from.image_path,
                army: { ...row.army, slot_0: from.army.slot_0 },
                learned_abilities: [...from.learned_abilities],
                current_level: from.current_level,
                current_xp: from.current_xp,
                arch_id: from.arch_id,
                current_mana: from.current_mana,
                current_energy: from.current_energy,
                used_abilities_this_battle: [],
                used_abilities_today: [],
            }
            : row),
    };
}
function prepareFightYourself(session, hero) {
    if (hero.class_id == null) {
        return { error: 'Fight Yourself: hero has no class' };
    }
    const defender = ensureMirrorDefender(session, hero);
    const next = cloneHeroAsMirror(defender.session, hero.id, defender.heroId);
    return {
        session: next,
        heroId: hero.id,
        mobId: null,
        defenderHeroId: defender.heroId,
        notice: `${hero.name}: Fight Yourself`,
    };
}
function prepareNavalMirrorFight(session, hero, layout, label) {
    if (hero.class_id == null) {
        return { error: `${label}: hero has no class` };
    }
    const defender = ensureMirrorDefender(session, hero);
    const next = cloneHeroAsMirror(defender.session, hero.id, defender.heroId);
    return {
        session: next,
        heroId: hero.id,
        mobId: null,
        defenderHeroId: defender.heroId,
        notice: `${hero.name}: ${label}`,
        navalLayout: layout,
    };
}
function prepareForTheHoard(session, hero, catalog, random) {
    const classId = knightClassId(catalog);
    if (classId == null) {
        return { error: 'For the Hoard: Knight hero type missing' };
    }
    const army = buildHoardArmy(catalog, random);
    if (!army) {
        return { error: 'For the Hoard: could not pick Citadel Humanoid stacks' };
    }
    const rival = ensureOpponentHero(session, hero, catalog, classId);
    if (!rival) {
        return { error: 'For the Hoard: need an AI/opponent player' };
    }
    let next = rival.session;
    next = configureKnightHero(next, hero.id, catalog, classId);
    next = configureKnightHero(next, rival.heroId, catalog, classId);
    next = fillHeroArmy(next, hero.id, army);
    next = fillHeroArmy(next, rival.heroId, army);
    return {
        session: next,
        heroId: hero.id,
        mobId: null,
        defenderHeroId: rival.heroId,
        notice: `${hero.name}: For the Hoard (Knight L${HOARD_LEVEL})`,
    };
}
/**
 * Debug: stage army + fixed mob/hero for an immediate fight (no flee/surrender gate).
 * Pit Fiends replaces the hero army; Raise Demons swaps Imps → Horned Hellions.
 */
export function prepareFixedFight(session, kind, random = Math.random) {
    const hero = pickDebugHero(session);
    if (!hero) {
        return { error: 'No hero for Fixed Fight' };
    }
    if (kind === 'holy_wrath' ||
        kind === 'for_the_hoard' ||
        kind === 'fight_yourself' ||
        kind === 'boat_vs_boat' ||
        kind === 'boat_vs_land' ||
        kind === 'land_vs_boat') {
        if (kind === 'fight_yourself') {
            return prepareFightYourself(session, hero);
        }
        if (kind === 'boat_vs_boat') {
            return prepareNavalMirrorFight(session, hero, 'boat_vs_boat', 'Boat vs Boat');
        }
        if (kind === 'boat_vs_land') {
            return prepareNavalMirrorFight(session, hero, 'boat_vs_land', 'Boat vs Land');
        }
        if (kind === 'land_vs_boat') {
            return prepareNavalMirrorFight(session, hero, 'land_vs_boat', 'Land vs Boat');
        }
        const catalog = getCachedCatalog();
        if (!catalog) {
            return { error: 'Catalog not loaded' };
        }
        return kind === 'holy_wrath'
            ? prepareHolyWrath(session, hero, catalog, random)
            : prepareForTheHoard(session, hero, catalog, random);
    }
    let next = session;
    const catalog = getCachedCatalog();
    if (!catalog) {
        return { error: 'Catalog not loaded' };
    }
    if (kind === 'pit_fiends') {
        const archId = unitIdByName(catalog, PIT_FIEND_ARCH_NAME);
        if (archId == null) {
            return { error: `Fixed Fight: missing unit "${PIT_FIEND_ARCH_NAME}"` };
        }
        next = clearHeroArmy(next, hero.id);
        next = insertHeroArmyStack(next, hero.id, 0, {
            id: nextUnitStackId(next),
            unitId: archId,
            qty: PIT_FIEND_ARCH_QTY,
        });
    }
    else {
        next = replaceHeroImpsWithHornedHellions(next, hero.id, catalog);
    }
    const enemies = kind === 'pit_fiends'
        ? resolveNamedArmy(catalog, [{ name: 'Assassin', qty: 2 }])
        : resolveNamedArmy(catalog, RAISE_DEMON_ENEMY_SPEC);
    if (!enemies) {
        return { error: 'Fixed Fight: could not resolve enemy unit names' };
    }
    const spawned = spawnFixedMob(next, hero.position, enemies);
    if (!spawned) {
        return { error: 'Could not spawn Fixed Fight enemies' };
    }
    const notice = kind === 'pit_fiends'
        ? `${hero.name}: Pit Fiends (3 Arch vs Assassin×2)`
        : `${hero.name}: Raise Demons`;
    return {
        session: spawned.session,
        heroId: hero.id,
        mobId: spawned.mobId,
        defenderHeroId: null,
        notice,
    };
}
