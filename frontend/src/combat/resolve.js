import { abortActiveMapMovement, getSelectedMapHeroId, selectHeroOnMap, syncSelectedHeroFromSession, } from '../hex/HexMap';
import { activePlayer, addHeroStackQty, claimTown, insertHeroArmyStack, nextUnitStackId, withEliminations, } from '../session/accessors';
import { awardScaledKillXp, levelUpNoticeForAward, partsArmyValue } from '../session/xp';
import { getSession, updateSession } from '../session/store';
import { ARMY_STACK_SLOTS } from '../session/types';
import { unitById } from '../town/catalog';
import { defenderArmyIsGarrison, isHeroStack } from './battle';
import { applyDemonReinforcement } from './demonReinforcement';
import { applyClericEndOfBattlePassive } from './templePassive';
import { isCreatureArmyUnit } from './siege';
import { creditDefeatMobKill } from '../session/quests';
import { removeWorldMob } from '../session/mobs';
import { GOLD_RESOURCE_ID } from '../hex/resources';
import { nearestFriendlyTown, placementAfterEscape, } from './escape';
import { rolledItemDisplayName } from '../items/display';
import { transferDefeatedHeroItems } from '../items/heroLoot';
import { logLostItemsToHero, logTookItemsFromHero, } from '../session/gameLog';
import { recycleDefeatedHero } from '../session/recycle';
import { applyMobKillGoldReward, snapshotMobKillRewards, } from '../session/mobKillRewards';
import { runAiItemMaintenanceForPlayer } from '../ai/itemEquip';
export function snapshotOpening(stacks) {
    return stacks
        .filter((stack) => !isHeroStack(stack))
        .map((stack) => ({
        id: stack.id,
        side: stack.side,
        slot: stack.slot,
        unitId: stack.unitId,
        qty: stack.qty,
    }));
}
/** Only creature army. Walls, fixtures, and Siege never decide victory. */
function stackCountsTowardWipe(stack, catalog) {
    if (stack.qty <= 0 || isHeroStack(stack)) {
        return false;
    }
    return isCreatureArmyUnit(unitById(catalog, stack.unitId));
}
function sideHasLiving(battle, side, catalog) {
    return battle.stacks.some((stack) => stack.side === side && stackCountsTowardWipe(stack, catalog));
}
export function defeatedSide(battle, catalog) {
    const atkLive = sideHasLiving(battle, 'atk', catalog);
    const defLive = sideHasLiving(battle, 'def', catalog);
    if (!atkLive && defLive) {
        return 'atk';
    }
    if (!defLive && atkLive) {
        return 'def';
    }
    return null;
}
function lossesFor(side, opening, battle, catalog) {
    return opening
        .filter((row) => row.side === side && row.qty > 0)
        .map((row) => {
        const live = battle.stacks.find((stack) => stack.id === row.id);
        const remaining = live?.qty ?? 0;
        return {
            qty: row.qty - remaining,
            unitName: unitById(catalog, row.unitId)?.name ?? 'Unknown',
        };
    })
        .filter((line) => line.qty > 0);
}
function creatureOpening(opening, catalog, side) {
    return opening.filter((row) => {
        if (row.side !== side || row.qty <= 0) {
            return false;
        }
        return isCreatureArmyUnit(unitById(catalog, row.unitId));
    });
}
function openingValueParts(opening, catalog, side) {
    return creatureOpening(opening, catalog, side).map((row) => ({
        unitId: row.unitId,
        qty: row.qty,
    }));
}
function openingKillParts(opening, battle, catalog, side) {
    return creatureOpening(opening, catalog, side)
        .map((row) => {
        const live = battle.stacks.find((stack) => stack.id === row.id);
        const remaining = live?.qty ?? 0;
        return {
            unitId: row.unitId,
            killed: Math.max(0, row.qty - remaining),
        };
    })
        .filter((part) => part.killed > 0);
}
function applyLiveArmySlots(session, slots, side, battle) {
    const liveBySlot = new Map(battle.stacks
        .filter((stack) => stack.side === side &&
        !isHeroStack(stack) &&
        stack.summonSeq == null &&
        stack.qty > 0)
        .map((stack) => [stack.slot, stack]));
    const nextSlots = [...slots];
    const drop = new Set();
    let units = session.units;
    for (let slot = 0; slot < nextSlots.length; slot += 1) {
        const unitId = nextSlots[slot];
        if (!unitId) {
            continue;
        }
        const live = liveBySlot.get(slot);
        if (!live) {
            nextSlots[slot] = null;
            drop.add(unitId);
            continue;
        }
        units = units.map((row) => row.id === unitId ? { ...row, qty: live.qty } : row);
    }
    if (drop.size > 0) {
        units = units.filter((row) => !drop.has(row.id));
    }
    return { units, slots: nextSlots };
}
function applyWinnerArmy(session, hero, winnerSide, battle) {
    const applied = applyLiveArmySlots(session, hero.army.slots_1_to_6, winnerSide, battle);
    return {
        ...session,
        units: applied.units,
        heroes: session.heroes.map((row) => row.id === hero.id
            ? { ...row, army: { ...row.army, slots_1_to_6: applied.slots } }
            : row),
    };
}
function applyGarrisonArmy(session, town, side, battle) {
    const applied = applyLiveArmySlots(session, town.garrison.slots_1_to_6, side, battle);
    return {
        ...session,
        units: applied.units,
        towns: session.towns.map((row) => row.id === town.id
            ? { ...row, garrison: { ...row.garrison, slots_1_to_6: applied.slots } }
            : row),
    };
}
function applyMobArmy(session, mob, side, battle) {
    const applied = applyLiveArmySlots(session, mob.slots_1_to_6, side, battle);
    return {
        ...session,
        units: applied.units,
        mobs: session.mobs.map((row) => row.id === mob.id ? { ...row, slots_1_to_6: applied.slots } : row),
    };
}
function removeDefeatedMob(session, mob) {
    return removeWorldMob(session, mob);
}
function occupiedArmySlots(hero) {
    return hero.army.slots_1_to_6.filter((id) => id != null && id !== '').length;
}
function firstOpenArmySlot(hero) {
    const slots = [...hero.army.slots_1_to_6];
    while (slots.length < ARMY_STACK_SLOTS) {
        slots.push(null);
    }
    const index = slots.findIndex((id) => id == null);
    return index >= 0 ? index : null;
}
function matchingArmyStackId(session, hero, unitId) {
    for (const id of hero.army.slots_1_to_6) {
        if (!id) {
            continue;
        }
        const row = session.units.find((unit) => unit.id === id);
        if (row && row.unit_id === unitId) {
            return id;
        }
    }
    return null;
}
/**
 * Post-battle summon reconciliation. Creation order. persists_on_summon
 * false is always discarded. True: new slot if room, else merge same
 * unit type, else discard.
 */
function persistSummonedStacks(session, hero, winnerSide, battle, catalog) {
    const summons = battle.stacks
        .filter((stack) => stack.side === winnerSide &&
        stack.qty > 0 &&
        stack.summonSeq != null)
        .sort((a, b) => (a.summonSeq ?? 0) - (b.summonSeq ?? 0));
    let next = session;
    const gains = [];
    for (const stack of summons) {
        if (stack.persistOnSummon !== true) {
            continue;
        }
        const liveHero = next.heroes.find((row) => row.id === hero.id);
        if (!liveHero) {
            break;
        }
        const name = unitById(catalog, stack.unitId)?.name ?? 'Unknown';
        if (occupiedArmySlots(liveHero) < ARMY_STACK_SLOTS) {
            const slot = firstOpenArmySlot(liveHero);
            if (slot == null) {
                continue;
            }
            next = insertHeroArmyStack(next, hero.id, slot, {
                id: nextUnitStackId(next),
                unitId: stack.unitId,
                qty: stack.qty,
            });
            gains.push({ qty: stack.qty, unitName: name });
            continue;
        }
        const sameId = matchingArmyStackId(next, liveHero, stack.unitId);
        if (sameId) {
            next = addHeroStackQty(next, sameId, stack.qty);
            gains.push({ qty: stack.qty, unitName: name });
        }
    }
    return { session: next, gains };
}
function reselectHero(session) {
    const selected = getSelectedMapHeroId();
    if (selected && session.heroes.some((hero) => hero.id === selected)) {
        return;
    }
    const actor = activePlayer(session);
    const next = session.heroes.find((hero) => hero.player_id === actor?.id) ??
        session.heroes[0];
    if (next) {
        selectHeroOnMap(next.id);
    }
}
export function applyCombatOutcome(session, catalog, attackerHeroId, defenderHeroId, battle, opening, siegeTownId, defenderMobId) {
    const loserSide = defeatedSide(battle, catalog);
    if (!loserSide) {
        return null;
    }
    const winnerSide = loserSide === 'atk' ? 'def' : 'atk';
    const loserId = loserSide === 'atk' ? attackerHeroId : defenderHeroId;
    const winnerId = winnerSide === 'atk' ? attackerHeroId : defenderHeroId;
    const loser = loserId
        ? session.heroes.find((hero) => hero.id === loserId)
        : undefined;
    const winner = winnerId
        ? session.heroes.find((hero) => hero.id === winnerId)
        : undefined;
    const siegeTown = siegeTownId
        ? session.towns.find((row) => row.id === siegeTownId)
        : undefined;
    const mob = defenderMobId
        ? session.mobs.find((row) => row.id === defenderMobId)
        : undefined;
    if (!loser && !(siegeTown && loserSide === 'def') && !(mob && loserSide === 'def')) {
        return null;
    }
    // Cleric: end-of-battle rez before losses / army writeback so persisted
    // qty reflects a full-stack resurrect.
    let battleResolved = battle;
    let clericLines = [];
    if (winner) {
        const clericPass = applyClericEndOfBattlePassive(battle, catalog, winner, winnerSide, opening, Math.random);
        battleResolved = clericPass.battle;
        clericLines = clericPass.lines;
    }
    const summary = {
        loserPlayer: loserSide === 'atk' ? battle.attackerPlayer : battle.defenderPlayer,
        loserHeroName: loser?.name ?? siegeTown?.name ?? (mob ? 'Creatures' : 'Town'),
        winnerPlayer: winnerSide === 'atk' ? battle.attackerPlayer : battle.defenderPlayer,
        winnerHeroName: winner?.name ?? siegeTown?.name ?? (mob ? 'Creatures' : 'Town'),
        loserLosses: lossesFor(loserSide, opening, battle, catalog),
        winnerLosses: lossesFor(winnerSide, opening, battleResolved, catalog),
        winnerGains: [],
        xpLines: [...clericLines],
        itemsTakenLines: [],
        levelUpNotice: null,
    };
    let next = session;
    if (winner) {
        next = applyWinnerArmy(next, winner, winnerSide, battleResolved);
        const persisted = persistSummonedStacks(next, winner, winnerSide, battleResolved, catalog);
        next = persisted.session;
        summary.winnerGains = persisted.gains;
        // XP (and any level-ups) before demon tier — INT bumps from this battle
        // must count toward floor(INT/6) Warlock / floor(INT/4) Heretic. Demons
        // previously ran first, so a hero who crossed the tier threshold on this
        // fight still resolved at the old tier.
        const ownValue = partsArmyValue(catalog, openingValueParts(opening, catalog, winnerSide));
        const enemyValue = partsArmyValue(catalog, openingValueParts(opening, catalog, loserSide));
        const xp = awardScaledKillXp(next, catalog, winner.id, openingKillParts(opening, battleResolved, catalog, loserSide), enemyValue, ownValue, 'battle');
        next = xp.session;
        summary.xpLines = [...summary.xpLines, ...xp.lines];
        summary.levelUpNotice = levelUpNoticeForAward(catalog, xp);
        const winnerLive = next.heroes.find((hero) => hero.id === winner.id) ?? winner;
        const demons = applyDemonReinforcement(next, catalog, winnerLive, battleResolved, opening, loserSide);
        next = demons.session;
        if (demons.gains.length > 0) {
            summary.winnerGains = [...summary.winnerGains, ...demons.gains];
        }
    }
    if (loser && winner) {
        const loot = transferDefeatedHeroItems(next, catalog, winner.id, loser.id);
        next = loot.session;
        if (loot.taken.length > 0) {
            const items = loot.taken.map((item) => ({
                uid: item.uid,
                name: rolledItemDisplayName(catalog, item),
            }));
            summary.itemsTakenLines = [
                `Took ${items.map((row) => row.name).join(', ')}`,
            ];
            next = logTookItemsFromHero(next, winner.player_id, winner.id, items);
            next = logLostItemsToHero(next, loser.player_id, loser.name, items.map((row) => row.name).join(', '));
        }
        const winnerPlayer = next.players.find((row) => row.id === winner.player_id);
        if (winnerPlayer?.is_ai) {
            next = runAiItemMaintenanceForPlayer(next, catalog, winner.player_id, [
                winner.id,
            ]);
        }
        const liveLoser = next.heroes.find((row) => row.id === loser.id);
        if (liveLoser) {
            next = recycleDefeatedHero(next, catalog, liveLoser);
        }
    }
    else if (loser) {
        next = recycleDefeatedHero(next, catalog, loser);
    }
    if (siegeTown && defenderArmyIsGarrison(session, siegeTown, attackerHeroId)) {
        next = applyGarrisonArmy(next, siegeTown, 'def', battle);
    }
    if (mob && loserSide === 'def') {
        const attacker = session.heroes.find((hero) => hero.id === attackerHeroId);
        if (attacker && winner) {
            const snap = snapshotMobKillRewards(session, catalog, mob, opening);
            const goldResult = applyMobKillGoldReward(next, catalog, winner.id, snap);
            next = goldResult.session;
            if (goldResult.line) {
                summary.rewardLines = [goldResult.line];
            }
            next = creditDefeatMobKill(next, mob.id, attacker.player_id);
        }
        next = removeDefeatedMob(next, mob);
    }
    else if (mob && winnerSide === 'def') {
        next = applyMobArmy(next, mob, 'def', battle);
    }
    if (siegeTown && winnerSide === 'atk') {
        // Town stays on the map; only owner_id / player_id changes.
        next = claimTown(next, siegeTown.position.q, siegeTown.position.r);
    }
    next = withEliminations(next);
    return { session: next, summary };
}
function transferGoldBetweenPlayers(session, fromPlayerId, toPlayerId, cost) {
    const gold = Math.max(0, Math.floor(cost[GOLD_RESOURCE_ID] ?? 0));
    if (gold <= 0) {
        return session;
    }
    return {
        ...session,
        players: session.players.map((player) => {
            if (player.id === fromPlayerId) {
                const resources = { ...player.resources };
                resources[GOLD_RESOURCE_ID] = Math.max(0, (resources[GOLD_RESOURCE_ID] ?? 0) - gold);
                return { ...player, resources };
            }
            if (toPlayerId && player.id === toPlayerId) {
                const resources = { ...player.resources };
                resources[GOLD_RESOURCE_ID] = (resources[GOLD_RESOURCE_ID] ?? 0) + gold;
                return { ...player, resources };
            }
            return player;
        }),
    };
}
function placeEscapedHero(session, hero, position) {
    return {
        ...session,
        heroes: session.heroes.map((row) => row.id === hero.id
            ? {
                ...row,
                position,
                movement_remaining: 0,
                flight: null,
            }
            : row),
    };
}
export function applyCombatEscape(session, catalog, attackerHeroId, defenderHeroId, battle, opening, escapingSide, kind, siegeTownId, defenderMobId, surrenderCost) {
    const winnerSide = escapingSide === 'atk' ? 'def' : 'atk';
    const loserId = escapingSide === 'atk' ? attackerHeroId : defenderHeroId;
    const winnerId = winnerSide === 'atk' ? attackerHeroId : defenderHeroId;
    const loser = loserId
        ? session.heroes.find((hero) => hero.id === loserId)
        : undefined;
    const winner = winnerId
        ? session.heroes.find((hero) => hero.id === winnerId)
        : undefined;
    const siegeTown = siegeTownId
        ? session.towns.find((row) => row.id === siegeTownId)
        : undefined;
    const mob = defenderMobId
        ? session.mobs.find((row) => row.id === defenderMobId)
        : undefined;
    if (!loser) {
        return null;
    }
    const summary = {
        loserPlayer: escapingSide === 'atk' ? battle.attackerPlayer : battle.defenderPlayer,
        loserHeroName: loser.name,
        winnerPlayer: winnerSide === 'atk' ? battle.attackerPlayer : battle.defenderPlayer,
        winnerHeroName: winner?.name ?? siegeTown?.name ?? (mob ? 'Creatures' : 'Town'),
        loserLosses: lossesFor(escapingSide, opening, battle, catalog),
        winnerLosses: lossesFor(winnerSide, opening, battle, catalog),
        winnerGains: [],
        itemsTakenLines: [],
        xpLines: [
            kind === 'flee'
                ? `${loser.name} fled the battle.`
                : `${loser.name} surrendered.`,
        ],
        levelUpNotice: null,
    };
    let next = session;
    if (winner) {
        next = applyWinnerArmy(next, winner, winnerSide, battle);
        const persisted = persistSummonedStacks(next, winner, winnerSide, battle, catalog);
        next = persisted.session;
        summary.winnerGains = persisted.gains;
        const ownValue = partsArmyValue(catalog, openingValueParts(opening, catalog, winnerSide));
        const enemyValue = partsArmyValue(catalog, openingValueParts(opening, catalog, escapingSide));
        const xp = awardScaledKillXp(next, catalog, winner.id, openingKillParts(opening, battle, catalog, escapingSide), enemyValue, ownValue, 'battle');
        next = xp.session;
        summary.xpLines = [...summary.xpLines, ...xp.lines];
        summary.levelUpNotice = levelUpNoticeForAward(catalog, xp);
    }
    next = applyWinnerArmy(next, loser, escapingSide, battle);
    const town = nearestFriendlyTown(next, loser);
    if (town) {
        const position = placementAfterEscape(next, loser, town);
        next = placeEscapedHero(next, loser, position);
    }
    else {
        next = placeEscapedHero(next, loser, loser.position);
    }
    if (kind === 'surrender' && surrenderCost) {
        const winnerPlayerId = winner?.player_id ?? null;
        next = transferGoldBetweenPlayers(next, loser.player_id, mob ? null : winnerPlayerId, surrenderCost);
    }
    if (siegeTown && defenderArmyIsGarrison(session, siegeTown, attackerHeroId)) {
        next = applyGarrisonArmy(next, siegeTown, 'def', battle);
    }
    if (mob) {
        next = applyMobArmy(next, mob, 'def', battle);
    }
    next = withEliminations(next);
    return { session: next, summary };
}
export function commitCombatEscape(catalog, attackerHeroId, defenderHeroId, battle, opening, escapingSide, kind, siegeTownId, defenderMobId, surrenderCost) {
    let summary = null;
    const next = updateSession((current) => {
        const applied = applyCombatEscape(current, catalog, attackerHeroId, defenderHeroId, battle, opening, escapingSide, kind, siegeTownId, defenderMobId, surrenderCost);
        if (!applied) {
            return current;
        }
        summary = applied.summary;
        return applied.session;
    });
    if (summary) {
        syncSelectedHeroFromSession();
        abortActiveMapMovement();
        reselectHero(getSession() ?? next);
    }
    return summary;
}
export function commitCombatOutcome(catalog, attackerHeroId, defenderHeroId, battle, opening, siegeTownId, defenderMobId) {
    let summary = null;
    const next = updateSession((current) => {
        const applied = applyCombatOutcome(current, catalog, attackerHeroId, defenderHeroId, battle, opening, siegeTownId, defenderMobId);
        if (!applied) {
            return current;
        }
        summary = applied.summary;
        return applied.session;
    });
    if (summary) {
        reselectHero(getSession() ?? next);
    }
    return summary;
}
