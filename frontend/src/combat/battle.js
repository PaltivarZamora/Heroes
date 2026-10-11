import { ARMY_STACK_SLOTS, slotFromPlayerId } from '../session/types';
import { retaliationCharges, unitById } from '../town/catalog';
import { stacksWithoutOverlap } from './occupancy';
import { siegeStructureStacks } from './siege';
import { tickRoundConditions, isSlowed, SLOW_SPEED_REDUCTION_PCT, } from './condition';
import { applyStackHeal } from './attack';
import { tickShadowGrowth } from './shadow';
import { freezeArmyTagCounts, HUMANOID_TAG } from './armyTags';
import { applyBattleStartArmyPassives, freezeArmyTownCounts, } from './heroArmyPassives';
import { applyTempleEndOfRoundPassives } from './templePassive';
import { applyShamanBattleStartTotems, applyShamanEndOfRoundNatureHeals, } from './summon';
export function emptyStatFlat() {
    return {
        speed: 0,
        defense: 0,
        resistance: 0,
        minDmg: 0,
        maxDmg: 0,
        maxRange: 0,
        health: 0,
    };
}
export function addStatFlat(current, delta) {
    const base = current ?? emptyStatFlat();
    return {
        speed: base.speed + delta,
        defense: base.defense + delta,
        resistance: base.resistance + delta,
        minDmg: base.minDmg + delta,
        maxDmg: base.maxDmg + delta,
        maxRange: base.maxRange + delta,
        health: base.health + delta,
    };
}
/** True while Iron Will-style round immunity is active. */
export function hasDebuffImmunity(stack) {
    return (stack.debuffImmunityRoundsLeft ?? 0) > 0;
}
/**
 * Strip stat-style combat debuffs (not catalog conditions).
 * Keeps positive buffs on the same fields. Used by clears_stat_debuffs.
 */
export function clearStatDebuffs(stack) {
    const cleared = [];
    let next = { ...stack };
    if (next.outputMods) {
        const keys = Object.keys(next.outputMods);
        let changed = false;
        const out = { ...next.outputMods };
        for (const key of keys) {
            if (out[key] < 0) {
                out[key] = 0;
                changed = true;
            }
        }
        if (changed) {
            cleared.push('damage debuffs');
            const any = keys.some((key) => out[key] !== 0);
            next = { ...next, outputMods: any ? out : undefined };
        }
    }
    if (next.mitigationPct) {
        let changed = false;
        const mit = { ...next.mitigationPct };
        if (mit.defense < 0) {
            mit.defense = 0;
            changed = true;
        }
        if (mit.resistance < 0) {
            mit.resistance = 0;
            changed = true;
        }
        if (changed) {
            cleared.push('mitigation debuffs');
            next = {
                ...next,
                mitigationPct: mit.defense !== 0 || mit.resistance !== 0 ? mit : undefined,
            };
        }
    }
    if ((next.speedMod ?? 0) < 0) {
        cleared.push('speed debuff');
        next = { ...next, speedMod: undefined };
    }
    if (next.speedUses && next.speedUses.amount < 0) {
        cleared.push('speed debuff');
        next = { ...next, speedUses: undefined };
    }
    if (next.statFlat) {
        const flat = { ...next.statFlat };
        let changed = false;
        for (const key of Object.keys(flat)) {
            if (flat[key] < 0) {
                flat[key] = 0;
                changed = true;
            }
        }
        if (changed) {
            cleared.push('stat debuffs');
            const any = Object.keys(flat).some((key) => flat[key] !== 0);
            next = { ...next, statFlat: any ? flat : undefined };
        }
    }
    if ((next.defensePct ?? 0) < 0) {
        cleared.push('defense debuff');
        next = { ...next, defensePct: undefined, defenseFloor: undefined };
    }
    if ((next.resistancePct ?? 0) < 0) {
        cleared.push('resistance debuff');
        next = { ...next, resistancePct: undefined };
    }
    if (next.disarm) {
        cleared.push('disarm');
        next = { ...next, disarm: undefined };
    }
    if ((next.preventsCriticalRoundsLeft ?? 0) > 0) {
        cleared.push('crit lock');
        next = { ...next, preventsCriticalRoundsLeft: undefined };
    }
    if ((next.markHitsLeft ?? 0) > 0) {
        cleared.push('mark');
        next = { ...next, markHitsLeft: undefined };
    }
    if (next.forcedRetreatPending) {
        cleared.push('forced retreat');
        next = { ...next, forcedRetreatPending: undefined };
    }
    return { stack: next, cleared };
}
export function stackMaxHealth(stack, catalog) {
    const base = unitById(catalog, stack.unitId)?.health ?? 1;
    return Math.max(1, base + (stack.statFlat?.health ?? 0));
}
/**
 * Apply a signed percentage to an integer-ish base (floor).
 * Nonzero modifiers that would otherwise round to no change get a ±1 floor
 * so a real buff/debuff is never indistinguishable from casting nothing.
 */
export function scaleBySignedPct(n, signedPct) {
    if (!signedPct) {
        return Math.max(0, n);
    }
    if (n <= 0) {
        // 0 × anything % is still 0 before rounding — still force ±1 when the
        // modifier itself is nonzero so the cast is visible.
        return Math.max(0, signedPct > 0 ? 1 : 0);
    }
    const scaled = Math.floor((n * (100 + signedPct)) / 100);
    if (scaled === n) {
        return Math.max(0, n + (signedPct > 0 ? 1 : -1));
    }
    return Math.max(0, scaled);
}
export function stackDefense(stack, catalog) {
    if (stack.defenseSet != null) {
        return Math.max(0, stack.defenseSet);
    }
    const base = unitById(catalog, stack.unitId)?.defense ?? 0;
    const flat = base + (stack.statFlat?.defense ?? 0);
    const bonus = stack.defenseBonus?.amount ?? 0;
    const withBonus = flat + bonus;
    const mult = stack.defenseMult?.mult;
    const multiplied = mult != null && Number.isFinite(mult) && mult > 0
        ? Math.max(0, Math.floor(withBonus * mult))
        : withBonus;
    const pct = stack.defensePct ?? 0;
    let scaled = scaleBySignedPct(multiplied, pct);
    const div = stack.defenseDiv;
    if (div != null && div.divisor > 0) {
        scaled = Math.max(div.floor, Math.floor(scaled / div.divisor));
    }
    const floor = stack.defenseFloor ?? 0;
    return Math.max(floor, scaled);
}
export function stackResistance(stack, catalog) {
    if (stack.resistanceSet != null) {
        return Math.max(0, stack.resistanceSet);
    }
    const base = unitById(catalog, stack.unitId)?.resistance ?? 0;
    const flat = Math.max(0, base +
        (stack.statFlat?.resistance ?? 0) +
        (stack.resistanceBonus?.amount ?? 0));
    const mult = stack.resistanceMult?.mult;
    const multiplied = mult != null && Number.isFinite(mult) && mult > 0
        ? Math.max(0, Math.floor(flat * mult))
        : flat;
    const pct = stack.resistancePct ?? 0;
    return scaleBySignedPct(multiplied, pct);
}
export function stackMinDmg(stack, catalog) {
    const base = unitById(catalog, stack.unitId)?.min_dmg ?? 0;
    const mult = stack.minDmgMult;
    const scaled = mult != null && Number.isFinite(mult) && mult > 0
        ? Math.max(0, Math.floor(base * mult))
        : base;
    return Math.max(0, scaled + (stack.statFlat?.minDmg ?? 0));
}
export function stackMaxDmg(stack, catalog) {
    const base = unitById(catalog, stack.unitId)?.max_dmg ?? 0;
    const mult = stack.maxDmgMult;
    const scaled = mult != null && Number.isFinite(mult) && mult > 0
        ? Math.max(0, Math.floor(base * mult))
        : base;
    return Math.max(0, scaled + (stack.statFlat?.maxDmg ?? 0));
}
export function stackMaxRange(stack, catalog) {
    const base = unitById(catalog, stack.unitId)?.max_range ?? 1;
    return Math.max(1, base + (stack.statFlat?.maxRange ?? 0));
}
export function isHeroStack(stack) {
    return stack != null && Boolean(stack.heroId);
}
export function noteUnitDeaths(battle, unitId, killed) {
    if (killed <= 0) {
        return battle;
    }
    return {
        ...battle,
        unitDeaths: {
            ...(battle.unitDeaths ?? {}),
            [unitId]: (battle.unitDeaths?.[unitId] ?? 0) + killed,
        },
        roundUnitDeaths: {
            ...(battle.roundUnitDeaths ?? {}),
            [unitId]: (battle.roundUnitDeaths?.[unitId] ?? 0) + killed,
        },
    };
}
export function mergeUnitDeaths(into, unitId, killed) {
    if (killed <= 0) {
        return into;
    }
    return { ...into, [unitId]: (into[unitId] ?? 0) + killed };
}
function fullHealth(catalog, unitId) {
    return Math.max(1, unitById(catalog, unitId)?.health ?? 1);
}
function playerNumber(hero) {
    return slotFromPlayerId(hero?.player_id ?? '') ?? 1;
}
function padArmySlots(slots) {
    const next = (slots ?? []).slice(0, ARMY_STACK_SLOTS);
    while (next.length < ARMY_STACK_SLOTS) {
        next.push(null);
    }
    return next;
}
function stackFromSlotId(session, catalog, slotId, side, start) {
    if (!slotId) {
        return null;
    }
    const unitStack = session.units.find((row) => row.id === slotId);
    if (!unitStack || unitStack.qty <= 0) {
        return null;
    }
    return {
        id: `combat-${side}-${start.slot}`,
        side,
        slot: start.slot,
        unitId: unitStack.unit_id,
        qty: unitStack.qty,
        topHealth: fullHealth(catalog, unitStack.unit_id),
        startingQty: unitStack.qty,
        q: start.q,
        r: start.r,
        startHex: { q: start.q, r: start.r },
        hasActedThisRound: false,
        retaliationsLeft: retaliationCharges(unitById(catalog, unitStack.unit_id)),
        sessionStackId: unitStack.id,
        armySlot: start.slot,
    };
}
function hasLivingStacks(session, slots) {
    if (!slots) {
        return false;
    }
    return slots.some((id) => {
        if (!id) {
            return false;
        }
        const row = session.units.find((unit) => unit.id === id);
        return row != null && row.qty > 0;
    });
}
function defendingHero(session, town, attackerId) {
    return session.heroes.find((hero) => {
        if (hero.id === attackerId) {
            return false;
        }
        if (hero.position.q !== town.position.q ||
            hero.position.r !== town.position.r) {
            return false;
        }
        if (town.player_id && hero.player_id !== town.player_id) {
            return false;
        }
        return true;
    });
}
/** Defending hero army if present, else town garrison. */
function siegeDefenderSlots(session, town, attackerId) {
    const hero = defendingHero(session, town, attackerId);
    const heroSlots = hero?.army.slots_1_to_6;
    if (hasLivingStacks(session, heroSlots)) {
        return heroSlots;
    }
    const garrison = town.garrison.slots_1_to_6;
    if (hasLivingStacks(session, garrison)) {
        return garrison;
    }
    return heroSlots ?? garrison;
}
/** True when this siege fights the town garrison, not a visiting hero's army. */
export function defenderArmyIsGarrison(session, town, attackerId) {
    const hero = defendingHero(session, town, attackerId);
    if (hasLivingStacks(session, hero?.army.slots_1_to_6)) {
        return false;
    }
    return hasLivingStacks(session, town.garrison.slots_1_to_6);
}
/**
 * Army slot index N maps only to the battlefield start for slot N.
 * Empty army slots leave the matching battlefield stand empty — never pack
 * living stacks upward to fill gaps.
 */
function stacksForSide(session, catalog, slotIds, side, starts) {
    const slots = padArmySlots(slotIds);
    const startBySlot = new Map();
    for (const start of starts) {
        if (start.side !== side) {
            continue;
        }
        if (start.slot < 0 || start.slot >= ARMY_STACK_SLOTS) {
            continue;
        }
        startBySlot.set(start.slot, start);
    }
    const live = [];
    for (let slot = 0; slot < ARMY_STACK_SLOTS; slot += 1) {
        const start = startBySlot.get(slot);
        if (!start) {
            continue;
        }
        const stack = stackFromSlotId(session, catalog, slots[slot], side, start);
        if (stack) {
            live.push(stack);
        }
    }
    return live;
}
export function stackCombatSpeed(stack, catalog) {
    const base = unitById(catalog, stack.unitId)?.speed;
    if (base == null) {
        return null;
    }
    if (stack.speedLock != null) {
        return Math.max(0, stack.speedLock.value);
    }
    let speed = Math.max(0, base +
        (stack.speedMod ?? 0) +
        (stack.statFlat?.speed ?? 0) +
        (stack.speedUses?.amount ?? 0) +
        (stack.speedBoost?.amount ?? 0));
    // BR S7-4 Slow: flat −33% of live Speed for initiative / turn order.
    if (isSlowed(stack, catalog) && speed > 0) {
        let cut = Math.floor((speed * SLOW_SPEED_REDUCTION_PCT) / 100);
        if (cut === 0) {
            cut = 1;
        }
        speed = Math.max(0, speed - cut);
    }
    return speed;
}
/** Movement budget this turn. Furious Rush multiplies live speed; initiative does not. */
export function stackMoveSpeed(stack, catalog) {
    const live = stackCombatSpeed(stack, catalog);
    if (live == null) {
        return null;
    }
    const coeff = stack.chargeRush?.coefficient;
    if (coeff == null || coeff <= 0) {
        return live;
    }
    return Math.max(0, live * coeff);
}
function stackSpeed(stack, catalog) {
    return stackCombatSpeed(stack, catalog);
}
function shuffleStacks(stacks, random) {
    const out = [...stacks];
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.min(i, Math.floor(random() * (i + 1)));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
    }
    return out;
}
/**
 * Recalculated every round: Speed desc, then a fresh random shuffle of all
 * stacks at that speed (both sides together — no attacker/defender bias).
 */
export function initiativeOrder(stacks, catalog, random) {
    const bySpeed = new Map();
    for (const stack of stacks) {
        const speed = stackSpeed(stack, catalog);
        if (speed == null) {
            continue;
        }
        const list = bySpeed.get(speed) ?? [];
        list.push(stack);
        bySpeed.set(speed, list);
    }
    const speeds = [...bySpeed.keys()].sort((a, b) => b - a);
    const order = [];
    for (const speed of speeds) {
        order.push(...shuffleStacks(bySpeed.get(speed) ?? [], random));
    }
    return order.map((stack) => stack.id);
}
/**
 * Sides whose live combat speed changed between two battle snapshots
 * (buff or debuff). Used to re-sort initiative for the affected side(s).
 */
export function combatSpeedChangedSides(before, after, catalog) {
    const prev = new Map(before.stacks.map((stack) => [
        stack.id,
        stackCombatSpeed(stack, catalog),
    ]));
    const sides = new Set();
    for (const stack of after.stacks) {
        if (stack.qty <= 0) {
            continue;
        }
        const was = prev.get(stack.id);
        const now = stackCombatSpeed(stack, catalog);
        if (was !== now) {
            sides.add(stack.side);
        }
    }
    return [...sides];
}
/**
 * Re-sort only the remaining (not-yet-acted) suffix of this round's queue.
 * Prefix through the current actor is frozen. Other sides' suffix slots stay
 * put; `side`'s remaining entries permute among their existing suffix slots by
 * live speed (desc), then army slot (asc). No RNG.
 *
 * Call once per side that had a speed buff or debuff — slowed enemies must
 * shift later the same way hastened allies shift earlier.
 */
export function resortRemainingInitiative(battle, catalog, side) {
    const actorIdx = battle.activeIndex;
    if (actorIdx < 0 || actorIdx >= battle.order.length) {
        return battle;
    }
    const prefix = battle.order.slice(0, actorIdx + 1);
    const suffix = battle.order.slice(actorIdx + 1);
    if (suffix.length === 0) {
        return battle;
    }
    const byId = new Map(battle.stacks.map((stack) => [stack.id, stack]));
    const movable = [];
    suffix.forEach((id, index) => {
        const stack = byId.get(id);
        if (!stack ||
            stack.qty <= 0 ||
            stack.side !== side ||
            stack.hasActedThisRound) {
            return;
        }
        movable.push({ index, stack });
    });
    if (movable.length < 2) {
        return battle;
    }
    const sorted = [...movable].sort((a, b) => {
        const speedA = stackCombatSpeed(a.stack, catalog) ?? 0;
        const speedB = stackCombatSpeed(b.stack, catalog) ?? 0;
        if (speedB !== speedA) {
            return speedB - speedA;
        }
        return a.stack.slot - b.stack.slot;
    });
    const nextSuffix = [...suffix];
    movable.forEach((slot, i) => {
        nextSuffix[slot.index] = sorted[i].stack.id;
    });
    const nextOrder = [...prefix, ...nextSuffix];
    if (nextOrder.join('\0') === battle.order.join('\0')) {
        return battle;
    }
    return { ...battle, order: nextOrder };
}
/** Re-sort each listed side's remaining initiative (buff or debuff). */
export function resortRemainingInitiativeForSides(battle, catalog, sides) {
    let next = battle;
    for (const side of sides) {
        next = resortRemainingInitiative(next, catalog, side);
    }
    return next;
}
/**
 * Splice a newly summoned stack into the remaining (not-yet-acted) suffix
 * by live speed, descending. Prefix through the current actor is frozen.
 */
export function insertIntoRemainingInitiative(battle, catalog, stackId) {
    const stack = battle.stacks.find((row) => row.id === stackId);
    if (!stack || stack.qty <= 0) {
        return battle;
    }
    // Wall / Arcane Shield / other null-speed fixtures never join the queue.
    if (stackCombatSpeed(stack, catalog) == null) {
        return {
            ...battle,
            order: battle.order.filter((id) => id !== stackId),
        };
    }
    const speed = stackCombatSpeed(stack, catalog) ?? 0;
    const actorIdx = Math.max(0, battle.activeIndex);
    const without = battle.order.filter((id) => id !== stackId);
    const prefix = without.slice(0, Math.min(actorIdx + 1, without.length));
    const suffix = without.slice(prefix.length);
    const byId = new Map(battle.stacks.map((row) => [row.id, row]));
    let insertAt = suffix.length;
    for (let i = 0; i < suffix.length; i += 1) {
        const other = byId.get(suffix[i]);
        const otherSpeed = other ? (stackCombatSpeed(other, catalog) ?? 0) : 0;
        if (speed > otherSpeed) {
            insertAt = i;
            break;
        }
    }
    return {
        ...battle,
        order: [...prefix, ...suffix.slice(0, insertAt), stackId, ...suffix.slice(insertAt)],
    };
}
/** After this Rift's turn: count down shots, silence when the last one is spent. */
export function applyOwnSilenceAfterTurn(battle, stackId, catalog) {
    const stack = battle.stacks.find((row) => row.id === stackId);
    if (!stack ||
        stack.silenced ||
        stack.silenceShotsLeft == null ||
        stack.qty <= 0) {
        return { battle, line: null };
    }
    const left = stack.silenceShotsLeft - 1;
    if (left > 0) {
        return {
            battle: {
                ...battle,
                stacks: battle.stacks.map((row) => row.id === stackId ? { ...row, silenceShotsLeft: left } : row),
            },
            line: null,
        };
    }
    const name = unitById(catalog, stack.unitId)?.name ?? 'Unknown';
    return {
        battle: {
            ...battle,
            stacks: battle.stacks.map((row) => row.id === stackId
                ? { ...row, silenceShotsLeft: 0, silenced: true }
                : row),
        },
        line: `${name} goes silent.`,
    };
}
function tickEvasion(stack) {
    const ev = stack.evasion;
    if (!ev) {
        return stack;
    }
    const left = ev.roundsLeft - 1;
    if (left <= 0) {
        return { ...stack, evasion: undefined };
    }
    return { ...stack, evasion: { ...ev, roundsLeft: left } };
}
function tickDisarm(stack) {
    const debuff = stack.disarm;
    if (!debuff) {
        return stack;
    }
    const left = debuff.roundsLeft - 1;
    if (left <= 0) {
        return { ...stack, disarm: undefined };
    }
    return { ...stack, disarm: { ...debuff, roundsLeft: left } };
}
function tickFervor(stack) {
    const buff = stack.fervor;
    if (!buff) {
        return stack;
    }
    const left = buff.roundsLeft - 1;
    if (left <= 0) {
        return { ...stack, fervor: undefined };
    }
    return { ...stack, fervor: { ...buff, roundsLeft: left } };
}
function tickSpeedBoost(stack) {
    const boost = stack.speedBoost;
    if (!boost) {
        return stack;
    }
    const left = boost.roundsLeft - 1;
    if (left <= 0) {
        return { ...stack, speedBoost: undefined };
    }
    return { ...stack, speedBoost: { ...boost, roundsLeft: left } };
}
function tickSpeedLock(stack) {
    const lock = stack.speedLock;
    if (!lock) {
        return stack;
    }
    const left = lock.roundsLeft - 1;
    if (left <= 0) {
        return { ...stack, speedLock: undefined };
    }
    return { ...stack, speedLock: { ...lock, roundsLeft: left } };
}
function tickDefenseMult(stack) {
    const buff = stack.defenseMult;
    if (!buff) {
        return stack;
    }
    const left = buff.roundsLeft - 1;
    if (left <= 0) {
        return { ...stack, defenseMult: undefined };
    }
    return { ...stack, defenseMult: { ...buff, roundsLeft: left } };
}
function tickDefenseBonus(stack) {
    const buff = stack.defenseBonus;
    if (!buff) {
        return stack;
    }
    const left = buff.roundsLeft - 1;
    if (left <= 0) {
        return { ...stack, defenseBonus: undefined };
    }
    return { ...stack, defenseBonus: { ...buff, roundsLeft: left } };
}
function tickResistanceMult(stack) {
    const buff = stack.resistanceMult;
    if (!buff) {
        return stack;
    }
    const left = buff.roundsLeft - 1;
    if (left <= 0) {
        return { ...stack, resistanceMult: undefined };
    }
    return { ...stack, resistanceMult: { ...buff, roundsLeft: left } };
}
function tickResistanceBonus(stack) {
    const buff = stack.resistanceBonus;
    if (!buff) {
        return stack;
    }
    const left = buff.roundsLeft - 1;
    if (left <= 0) {
        return { ...stack, resistanceBonus: undefined };
    }
    return { ...stack, resistanceBonus: { ...buff, roundsLeft: left } };
}
function tickDefenseSet(stack) {
    if (stack.defenseSetRoundsLeft == null) {
        return stack;
    }
    const left = stack.defenseSetRoundsLeft - 1;
    if (left <= 0) {
        return {
            ...stack,
            defenseSet: undefined,
            defenseSetRoundsLeft: undefined,
        };
    }
    return { ...stack, defenseSetRoundsLeft: left };
}
function tickResistanceSet(stack) {
    if (stack.resistanceSetRoundsLeft == null) {
        return stack;
    }
    const left = stack.resistanceSetRoundsLeft - 1;
    if (left <= 0) {
        return {
            ...stack,
            resistanceSet: undefined,
            resistanceSetRoundsLeft: undefined,
        };
    }
    return { ...stack, resistanceSetRoundsLeft: left };
}
function tickDmgMult(stack) {
    if (stack.dmgMultRoundsLeft == null) {
        return stack;
    }
    const left = stack.dmgMultRoundsLeft - 1;
    if (left <= 0) {
        return {
            ...stack,
            minDmgMult: undefined,
            maxDmgMult: undefined,
            dmgMultRoundsLeft: undefined,
        };
    }
    return { ...stack, dmgMultRoundsLeft: left };
}
function tickIgnoreTargetArmor(stack) {
    if (stack.ignoreTargetArmorRoundsLeft == null) {
        return stack;
    }
    const left = stack.ignoreTargetArmorRoundsLeft - 1;
    if (left <= 0) {
        return {
            ...stack,
            ignoreTargetArmor: undefined,
            ignoreTargetArmorPhysicalOnly: undefined,
            ignoreTargetArmorRoundsLeft: undefined,
        };
    }
    return { ...stack, ignoreTargetArmorRoundsLeft: left };
}
function tickDefenseDiv(stack) {
    const buff = stack.defenseDiv;
    if (!buff) {
        return stack;
    }
    const left = buff.roundsLeft - 1;
    if (left <= 0) {
        return { ...stack, defenseDiv: undefined };
    }
    return { ...stack, defenseDiv: { ...buff, roundsLeft: left } };
}
function tickTimedDamagePct(stack) {
    const buff = stack.timedDamagePct;
    if (!buff) {
        return stack;
    }
    const left = buff.roundsLeft - 1;
    if (left <= 0) {
        return { ...stack, timedDamagePct: undefined };
    }
    return { ...stack, timedDamagePct: { ...buff, roundsLeft: left } };
}
function tickPreventsCritical(stack) {
    if (stack.preventsCriticalRoundsLeft == null) {
        return stack;
    }
    const left = stack.preventsCriticalRoundsLeft - 1;
    if (left <= 0) {
        return { ...stack, preventsCriticalRoundsLeft: undefined };
    }
    return { ...stack, preventsCriticalRoundsLeft: left };
}
function tickDebuffImmunity(stack) {
    if (stack.debuffImmunityRoundsLeft == null) {
        return stack;
    }
    const left = stack.debuffImmunityRoundsLeft - 1;
    if (left <= 0) {
        return { ...stack, debuffImmunityRoundsLeft: undefined };
    }
    return { ...stack, debuffImmunityRoundsLeft: left };
}
function tickDurationBuffs(stack) {
    return tickDebuffImmunity(tickPreventsCritical(tickTimedDamagePct(tickDefenseDiv(tickIgnoreTargetArmor(tickDmgMult(tickResistanceSet(tickDefenseSet(tickResistanceBonus(tickDefenseBonus(tickResistanceMult(tickDefenseMult(tickSpeedLock(tickSpeedBoost(tickFervor(tickDisarm(tickEvasion(stack)))))))))))))))));
}
export function startRound(battle, catalog, random = Math.random, opts) {
    const skipTicks = opts?.skipDurationTicks === true;
    const ticked = skipTicks
        ? { stacks: battle.stacks, lines: [] }
        : tickRoundConditions(battle.stacks, catalog, random);
    const newRound = battle.round + 1;
    const stacks = ticked.stacks.map((stack) => {
        const reset = {
            ...stack,
            hasActedThisRound: false,
            extraTurnThisRound: false,
            retaliationsLeft: retaliationCharges(unitById(catalog, stack.unitId)),
        };
        return skipTicks ? reset : tickDurationBuffs(reset);
    });
    const order = initiativeOrder(stacks, catalog, random);
    let groundEffects = battle.groundEffects ?? [];
    if (!skipTicks && groundEffects.length > 0) {
        groundEffects = groundEffects
            .map((row) => row.roundsLeft == null
            ? row
            : { ...row, roundsLeft: row.roundsLeft - 1 })
            .filter((row) => row.roundsLeft == null || row.roundsLeft > 0);
    }
    return {
        ...battle,
        round: newRound,
        stacks,
        order,
        activeIndex: 0,
        roundLog: ticked.lines,
        groundEffects,
        roundUnitDeaths: {},
    };
}
/** End-of-round recurring heals (Brisk Renewal), then start the next round. */
function applyRecurringEndOfRoundHeals(battle, catalog) {
    const entries = battle.recurringHeals ?? [];
    if (entries.length === 0) {
        return { battle, lines: [] };
    }
    let stacks = battle.stacks;
    const lines = [];
    for (const entry of entries) {
        const amount = Math.max(entry.healMin, Math.floor(entry.intel * (entry.healPctStat / 100)));
        if (amount <= 0) {
            continue;
        }
        for (const stack of stacks) {
            if (stack.side !== entry.side ||
                stack.qty <= 0 ||
                isHeroStack(stack) ||
                stack.indestructible) {
                continue;
            }
            const full = stackMaxHealth(stack, catalog);
            if (stack.topHealth >= full) {
                continue;
            }
            const healed = applyStackHeal(stack, amount, full);
            if (healed.healed <= 0) {
                continue;
            }
            stacks = stacks.map((row) => row.id === stack.id ? healed.stack : row);
            const unit = unitById(catalog, stack.unitId);
            lines.push(`Brisk Renewal: ${stack.qty} ${unit?.name ?? 'unit'} healed ${healed.healed}.`);
        }
    }
    return {
        battle: { ...battle, stacks },
        lines,
    };
}
export function advanceTurn(battle, catalog, random = Math.random, opts) {
    const next = battle.order.findIndex((id) => {
        const stack = battle.stacks.find((row) => row.id === id);
        return stack != null && !stack.hasActedThisRound;
    });
    if (next < 0) {
        return forceEndRound(battle, catalog, random, {
            skipDurationTicks: false,
            tiles: opts?.tiles,
            heroes: opts?.heroes,
        });
    }
    return { ...battle, activeIndex: next, roundLog: [] };
}
/** Jump straight to the next round (Rally). Optionally skip duration ticks. */
export function forceEndRound(battle, catalog, random = Math.random, opts) {
    const healed = applyRecurringEndOfRoundHeals(battle, catalog);
    const temple = applyTempleEndOfRoundPassives(healed.battle, catalog, opts?.heroes);
    const nature = applyShamanEndOfRoundNatureHeals(temple.battle, catalog, opts?.heroes);
    const grown = opts?.tiles && opts.tiles.length > 0
        ? tickShadowGrowth(nature.battle, catalog, opts.heroes, opts.tiles, random)
        : { battle: nature.battle, lines: [] };
    const started = startRound(grown.battle, catalog, random, {
        skipDurationTicks: opts?.skipDurationTicks,
    });
    // Shaman: +totem_spawn_per_round at the start of each new round (battle-start
    // fill is handled separately with fillToCap in CombatScreen).
    const totems = opts?.tiles && opts.tiles.length > 0
        ? applyShamanBattleStartTotems(started, catalog, opts.tiles, { atk: opts.heroes?.atk, def: opts.heroes?.def }, random)
        : { battle: started, lines: [] };
    const prefix = [
        ...healed.lines,
        ...temple.lines,
        ...nature.lines,
        ...grown.lines,
        ...totems.lines,
    ];
    const hitKeys = [...(temple.hitKeys ?? [])];
    const healKeys = [
        ...(temple.healKeys ?? []),
        ...(nature.healKeys ?? []),
    ];
    if (prefix.length === 0 && hitKeys.length === 0 && healKeys.length === 0) {
        return totems.battle;
    }
    return {
        ...totems.battle,
        roundLog: [...prefix, ...(totems.battle.roundLog ?? [])],
        roundHitKeys: hitKeys.length > 0 ? hitKeys : undefined,
        roundHealKeys: healKeys.length > 0 ? healKeys : undefined,
    };
}
function makeHeroStack(hero, side, pos) {
    return {
        id: `combat-${side}-hero`,
        side,
        slot: -1,
        unitId: 0,
        qty: 1,
        topHealth: 1,
        startingQty: 1,
        q: pos.q,
        r: pos.r,
        startHex: { q: pos.q, r: pos.r },
        hasActedThisRound: false,
        retaliationsLeft: 0,
        indestructible: true,
        heroId: hero.id,
    };
}
export function createBattle(session, catalog, attackerHeroId, defenderHeroId, starts, random = Math.random, siege, heroStarts, defenderMobId) {
    const attacker = session.heroes.find((hero) => hero.id === attackerHeroId);
    const defender = defenderHeroId
        ? session.heroes.find((hero) => hero.id === defenderHeroId)
        : undefined;
    const town = siege
        ? session.towns.find((row) => row.id === siege.townId)
        : undefined;
    const mob = defenderMobId
        ? session.mobs.find((row) => row.id === defenderMobId)
        : undefined;
    const portraits = [];
    if (attacker && heroStarts?.atk) {
        portraits.push(makeHeroStack(attacker, 'atk', heroStarts.atk));
    }
    if (defender && heroStarts?.def) {
        portraits.push(makeHeroStack(defender, 'def', heroStarts.def));
    }
    const atk = stacksForSide(session, catalog, attacker?.army.slots_1_to_6, 'atk', starts);
    const defSlots = siege && town
        ? siegeDefenderSlots(session, town, attackerHeroId)
        : (mob?.slots_1_to_6 ?? defender?.army.slots_1_to_6);
    const def = stacksForSide(session, catalog, defSlots, 'def', starts);
    const extra = siege
        ? siegeStructureStacks(session, catalog, siege.townId, siege.wallHexes, siege.catapult)
        : [];
    const stacksRaw = stacksWithoutOverlap([...portraits, ...atk, ...def, ...extra], catalog).map((stack) => ({
        ...stack,
        startingQty: stack.qty,
        startHex: stack.startHex ?? { q: stack.q, r: stack.r },
    }));
    const armyTownCounts = freezeArmyTownCounts(stacksRaw, catalog);
    const stacks = applyBattleStartArmyPassives(stacksRaw, catalog, { atk: attacker, def: defender }, armyTownCounts);
    const gate = siege?.drawbridge && siege.drawbridgeMoat
        ? {
            q: siege.drawbridge.q,
            r: siege.drawbridge.r,
            moatQ: siege.drawbridgeMoat.q,
            moatR: siege.drawbridgeMoat.r,
        }
        : null;
    return startRound({
        round: 0,
        stacks,
        order: [],
        activeIndex: 0,
        attackerPlayer: playerNumber(attacker),
        defenderPlayer: defender
            ? playerNumber(defender)
            : slotFromPlayerId(town?.player_id ?? '') ?? (mob ? 2 : 1),
        siegeGate: gate,
        unitDeaths: {},
        roundUnitDeaths: {},
        tombstones: [],
        groundEffects: [],
        armyTagCounts: freezeArmyTagCounts(stacks, catalog, [HUMANOID_TAG]),
        armyTownCounts,
    }, catalog, random);
}
export function activeStack(battle) {
    const id = battle.order[battle.activeIndex];
    if (!id) {
        return null;
    }
    return battle.stacks.find((stack) => stack.id === id) ?? null;
}
export function moveStack(battle, stackId, q, r) {
    const target = battle.stacks.find((stack) => stack.id === stackId);
    if (isHeroStack(target)) {
        return battle;
    }
    return {
        ...battle,
        stacks: battle.stacks.map((stack) => stack.id === stackId ? { ...stack, q, r } : stack),
    };
}
export function endStackTurn(battle, stackId, wasteExtraTurn = false) {
    const current = battle.stacks.find((stack) => stack.id === stackId);
    const grantExtra = !wasteExtraTurn && current?.extraTurnThisRound === true;
    return {
        ...battle,
        stacks: battle.stacks.map((stack) => {
            if (stack.id !== stackId) {
                return stack;
            }
            const spent = consumeTurnUses(stack);
            if (grantExtra) {
                return { ...spent, hasActedThisRound: false, extraTurnThisRound: false };
            }
            return { ...spent, hasActedThisRound: true, extraTurnThisRound: false };
        }),
    };
}
/** Hard stop so STR×pct ≈ 100% cannot hang the engine. */
export const FERVOR_CHAIN_SAFETY = 32;
export function rollFervorChain(stack, random = Math.random) {
    return tryFervorChain(stack, random).triggered;
}
/** Fervor roll with chance% for battle-log formatting. */
export function tryFervorChain(stack, random = Math.random) {
    const buff = stack?.fervor;
    const chancePct = buff?.chancePct ?? 0;
    if (!buff || buff.roundsLeft <= 0 || chancePct <= 0) {
        return { triggered: false, chancePct };
    }
    if ((buff.streak ?? 0) >= FERVOR_CHAIN_SAFETY) {
        return { triggered: false, chancePct };
    }
    return { triggered: random() * 100 < chancePct, chancePct };
}
/** After a completed turn, Fervor lets the stack act again immediately. */
export function grantFervorExtraTurn(battle, stackId) {
    return {
        ...battle,
        stacks: battle.stacks.map((row) => {
            if (row.id !== stackId) {
                return row;
            }
            const buff = row.fervor;
            return {
                ...row,
                hasActedThisRound: false,
                fervor: buff
                    ? { ...buff, streak: (buff.streak ?? 0) + 1 }
                    : undefined,
            };
        }),
    };
}
export function clearFervorStreak(battle, stackId) {
    return {
        ...battle,
        stacks: battle.stacks.map((row) => {
            if (row.id !== stackId || !row.fervor || row.fervor.streak == null) {
                return row;
            }
            return { ...row, fervor: { ...row.fervor, streak: 0 } };
        }),
    };
}
function consumeTurnUses(stack) {
    return consumeChargeRush(consumeSpeedUse(stack));
}
function consumeSpeedUse(stack) {
    const burst = stack.speedUses;
    if (!burst) {
        return stack;
    }
    const left = burst.usesLeft - 1;
    if (left <= 0) {
        return { ...stack, speedUses: undefined };
    }
    return { ...stack, speedUses: { amount: burst.amount, usesLeft: left } };
}
function consumeChargeRush(stack) {
    const rush = stack.chargeRush;
    if (!rush) {
        return stack;
    }
    const left = rush.usesLeft - 1;
    if (left <= 0) {
        return { ...stack, chargeRush: undefined };
    }
    return { ...stack, chargeRush: { ...rush, usesLeft: left } };
}
export function applyMove(battle, stackId, q, r) {
    return endStackTurn(moveStack(battle, stackId, q, r), stackId);
}
