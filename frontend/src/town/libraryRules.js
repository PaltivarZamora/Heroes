import { GOLD_RESOURCE_ID } from '../hex/resources';
import { getCachedCatalog, libraryGoldCost, } from './catalog';
export const LIBRARY_TIERS = [1, 2, 3];
function shufflePick(ids, keep) {
    const copy = ids.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        const a = copy[i];
        const b = copy[j];
        if (a === undefined || b === undefined) {
            continue;
        }
        copy[i] = b;
        copy[j] = a;
    }
    return copy.slice(0, Math.min(keep, copy.length));
}
export function townHeroClasses(catalog, townTypeId) {
    return catalog.hero_type
        .filter((row) => row.town_id === townTypeId)
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
}
export function classDisciplines(catalog, classId) {
    const ids = catalog.hero_discipline
        .filter((row) => row.hero_id === classId)
        .map((row) => row.discipline_id);
    return ids
        .map((id) => catalog.discipline.find((row) => row.id === id))
        .filter((row) => row != null);
}
export function townDisciplineIds(catalog, townTypeId) {
    const classIds = new Set(townHeroClasses(catalog, townTypeId).map((row) => row.id));
    const ids = new Set();
    for (const row of catalog.hero_discipline) {
        if (classIds.has(row.hero_id)) {
            ids.add(row.discipline_id);
        }
    }
    return [...ids].sort((a, b) => a - b);
}
export function heroHasDiscipline(catalog, classId, disciplineId) {
    if (classId == null) {
        return false;
    }
    return catalog.hero_discipline.some((row) => row.hero_id === classId && row.discipline_id === disciplineId);
}
export function abilitiesFor(catalog, disciplineId, levelId) {
    return catalog.ability.filter((row) => row.discipline_id === disciplineId && row.level_id === levelId);
}
export function findOffer(offers, disciplineId, level) {
    return (offers ?? []).find((row) => row.discipline_id === disciplineId && row.level === level);
}
export function rollLibraryOffers(catalog, buildingId, disciplineId, level) {
    const pool = abilitiesFor(catalog, disciplineId, level).map((row) => row.id);
    const keep = level >= 3 ? pool.length : 2;
    return {
        building_id: buildingId,
        discipline_id: disciplineId,
        level,
        ability_ids: shufflePick(pool, keep),
    };
}
export function mergeLibraryOffers(existing, catalog, buildingId, townTypeId, buildingLevel) {
    const current = existing ?? [];
    if (buildingLevel < 1 || buildingId <= 0) {
        return current;
    }
    const additions = [];
    for (const disciplineId of townDisciplineIds(catalog, townTypeId)) {
        for (const level of LIBRARY_TIERS) {
            if (level > buildingLevel) {
                continue;
            }
            if (findOffer(current, disciplineId, level) || findOffer(additions, disciplineId, level)) {
                continue;
            }
            additions.push(rollLibraryOffers(catalog, buildingId, disciplineId, level));
        }
    }
    return additions.length === 0 ? current : [...current, ...additions];
}
export function librarySlotKind(buildingLevel, level, abilityId, visiting, catalog, disciplineId) {
    if (buildingLevel < level || abilityId == null) {
        return 'unopened';
    }
    if (visiting && visiting.learned.includes(abilityId)) {
        return 'bought';
    }
    if (visiting &&
        heroHasDiscipline(catalog, visiting.classId, disciplineId) &&
        !visiting.learned.includes(abilityId)) {
        return 'buyable';
    }
    return 'locked';
}
/**
 * World Library cards are always "open" (no building tier). Same green / yellow
 * / grey rules as {@link librarySlotKind} for a max-level town Library.
 */
export function worldLibrarySlotKind(abilityId, visiting, catalog, disciplineId) {
    return librarySlotKind(3, 1, abilityId, visiting, catalog, disciplineId);
}
export function goldCostForLevel(levelId) {
    return { [GOLD_RESOURCE_ID]: libraryGoldCost(getCachedCatalog(), levelId) };
}
export function abilityById(catalog, id) {
    return catalog.ability.find((row) => row.id === id);
}
/**
 * First unlearned offered ability this hero can take at this Library,
 * in the same discipline → tier → slot order the Library UI uses.
 */
export function firstLearnableAbility(catalog, hero, libraryLevel, offers) {
    if (hero.class_id == null || libraryLevel < 1) {
        return null;
    }
    const learned = new Set(hero.learned_abilities ?? []);
    for (const discipline of classDisciplines(catalog, hero.class_id)) {
        for (const level of LIBRARY_TIERS) {
            if (libraryLevel < level) {
                continue;
            }
            const offer = findOffer(offers, discipline.id, level);
            for (const id of offer?.ability_ids ?? []) {
                if (learned.has(id)) {
                    continue;
                }
                const ability = abilityById(catalog, id);
                if (ability) {
                    return ability;
                }
            }
        }
    }
    return null;
}
export function learnedAbilitiesAtTier(catalog, learnedIds, disciplineId, levelId) {
    const have = new Set(learnedIds);
    return abilitiesFor(catalog, disciplineId, levelId).filter((row) => have.has(row.id));
}
/** Abilities at one Library tier across a class's two disciplines. */
export function classAbilityIdsAtTier(catalog, classId, levelId) {
    if (classId == null) {
        return [];
    }
    const ids = [];
    for (const discipline of classDisciplines(catalog, classId)) {
        for (const ability of abilitiesFor(catalog, discipline.id, levelId)) {
            ids.push(ability.id);
        }
    }
    return ids;
}
/** Every ability across a class's two disciplines (Basic/Advanced/Expert). */
export function classAbilityIds(catalog, classId) {
    if (classId == null) {
        return [];
    }
    const ids = [];
    for (const tier of LIBRARY_TIERS) {
        ids.push(...classAbilityIdsAtTier(catalog, classId, tier));
    }
    return ids;
}
export function tierLabel(catalog, levelId) {
    return catalog.ability_level.find((row) => row.id === levelId)?.value ?? `Tier ${levelId}`;
}
