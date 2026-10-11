import { DEFAULT_UNIT_ABILITIES, } from './catalog';
import { designedChronomancerRetaliation, designedConfluenceAbilities, designedFactoryAbilities, designedTempleAbilities, designedTempleRetaliation, designedWeepingAngelRetaliation, s75UnitConditionNorm, } from './unitDesignedOverrides';
import { TAG_FIRE_TOTEM, TAG_LIGHTNING_TOTEM, TAG_NATURE_TOTEM, unitHasNamedTag, } from './unitTags';
import { unitDwellingLevel } from './unitUpgrade';
function isAdvancedForm(_catalog, unit) {
    return unitDwellingLevel(unit) === 2;
}
function mergeRetaliation(base, patch) {
    return {
        ...base,
        ...patch,
        shape: base.shape ?? patch.shape,
        jumps: base.jumps ?? patch.jumps,
        falloff: base.falloff ?? patch.falloff,
        dmgPct: base.dmgPct !== 'default' ? base.dmgPct : (patch.dmgPct ?? base.dmgPct),
        times: base.times !== 1 || patch.times == null ? base.times : patch.times,
    };
}
function enrichRetaliation(catalog, unit, base) {
    const advanced = isAdvancedForm(catalog, unit);
    const weeping = designedWeepingAngelRetaliation(catalog, unit);
    if (weeping) {
        return { ...base, ...weeping };
    }
    const chrono = designedChronomancerRetaliation(catalog, unit, advanced);
    if (chrono) {
        return mergeRetaliation(base, chrono);
    }
    const temple = designedTempleRetaliation(catalog, unit, advanced);
    if (temple) {
        return mergeRetaliation(base, temple);
    }
    return base;
}
function enrichAbilities(catalog, unit, base) {
    const advanced = isAdvancedForm(catalog, unit);
    let next = base;
    if (unitHasNamedTag(catalog, unit, 'designed_mud_golem')) {
        next = { ...next, autoSplitOnTurn: true, skipFirstTurn: true };
    }
    if (unitHasNamedTag(catalog, unit, 'designed_vines_resist')) {
        next = { ...next, resistStat: next.resistStat ?? 'resistance' };
    }
    const s75 = s75UnitConditionNorm(catalog, unit);
    if (s75) {
        next = {
            ...next,
            ...s75,
            resistStat: s75.resistStat ?? next.resistStat ?? 'resistance',
        };
    }
    if (!unit.has_abilities) {
        const designed = designedTempleAbilities(catalog, unit, advanced) ??
            designedConfluenceAbilities(catalog, unit, advanced) ??
            designedFactoryAbilities(catalog, unit, advanced);
        if (designed) {
            next = { ...DEFAULT_UNIT_ABILITIES, ...designed };
        }
    }
    const temple = designedTempleAbilities(catalog, unit, advanced);
    if (temple) {
        next = {
            ...next,
            ...(temple.healMostInjuredOnKill ? { healMostInjuredOnKill: true } : {}),
            ...(temple.healFull ? { healFull: true } : {}),
            ...(temple.extraTurnOnKill ? { extraTurnOnKill: true } : {}),
            ...(temple.chancePctFlatStat != null && next.chancePctFlatStat == null
                ? { chancePctFlatStat: temple.chancePctFlatStat }
                : {}),
            ...(temple.dualAttack
                ? {
                    dualAttack: true,
                    secondAttackDmgType: next.secondAttackDmgType ?? temple.secondAttackDmgType,
                    secondAttackMinDmg: next.secondAttackMinDmg ?? temple.secondAttackMinDmg,
                    secondAttackMaxDmg: next.secondAttackMaxDmg ?? temple.secondAttackMaxDmg,
                    retaliateOnceAfterBoth: true,
                    shape: next.shape === 'single'
                        ? (temple.shape ?? next.shape)
                        : next.shape,
                }
                : {}),
            ...(temple.auraCountsAlliesAsExtraQty
                ? {
                    auraCountsAlliesAsExtraQty: true,
                    auraRadius: next.auraRadius ?? temple.auraRadius,
                }
                : {}),
        };
    }
    const confluence = designedConfluenceAbilities(catalog, unit, advanced);
    if (confluence) {
        next = {
            ...next,
            ...(confluence.scatterGroundEffectOnMoveStop
                ? {
                    scatterGroundEffectOnMoveStop: true,
                    groundEffectId: next.groundEffectId ?? confluence.groundEffectId,
                    chancePctIntelStat: next.chancePctIntelStat ?? confluence.chancePctIntelStat,
                    radius: Math.max(next.radius ?? 0, confluence.radius ?? 0),
                }
                : {}),
            ...(confluence.leavesGroundEffectOnAttack
                ? {
                    leavesGroundEffectOnAttack: true,
                    groundEffectId: next.groundEffectId ?? confluence.groundEffectId,
                    chancePct: next.chancePct ?? confluence.chancePct,
                    chancePctIntelStat: next.chancePctIntelStat ?? confluence.chancePctIntelStat,
                    fizzleTerrainIds: next.fizzleTerrainIds.length > 0
                        ? next.fizzleTerrainIds
                        : (confluence.fizzleTerrainIds ?? []),
                }
                : {}),
            ...(confluence.selfRezOnWipe
                ? {
                    selfRezOnWipe: true,
                    selfRezChanceStatDiv: next.selfRezChanceStatDiv ?? confluence.selfRezChanceStatDiv,
                    selfRezCapPct: next.selfRezCapPct ?? confluence.selfRezCapPct,
                    selfRezBasedOnKillsThisRound: true,
                }
                : {}),
            ...(confluence.absorbTerrainIds != null &&
                confluence.absorbTerrainIds.length > 0
                ? {
                    absorbTerrainIds: next.absorbTerrainIds.length > 0
                        ? next.absorbTerrainIds
                        : confluence.absorbTerrainIds,
                }
                : {}),
            ...(confluence.clearsGroundEffectId != null
                ? {
                    clearsGroundEffectId: next.clearsGroundEffectId ?? confluence.clearsGroundEffectId,
                    dmgIncreasePerHex: next.dmgIncreasePerHex ?? confluence.dmgIncreasePerHex,
                    shape: next.shape === 'single'
                        ? (confluence.shape ?? next.shape)
                        : next.shape,
                }
                : {}),
            ...(confluence.shape === 'spiral'
                ? {
                    shape: 'spiral',
                    radius: Math.max(next.radius ?? 0, confluence.radius ?? 0),
                    spiralChanceDecayPct: next.spiralChanceDecayPct ?? confluence.spiralChanceDecayPct,
                    groundEffectId: next.groundEffectId ?? confluence.groundEffectId,
                    fizzleTerrainIds: next.fizzleTerrainIds.length > 0
                        ? next.fizzleTerrainIds
                        : (confluence.fizzleTerrainIds ?? []),
                }
                : {}),
            ...(confluence.immuneToLightning ? { immuneToLightning: true } : {}),
            ...(confluence.immuneToFire ? { immuneToFire: true } : {}),
        };
    }
    if (next.groundEffectId === 6 && next.fizzleTerrainIds.length === 0) {
        next = { ...next, fizzleTerrainIds: [3, 20, 21] };
    }
    if (unitHasNamedTag(catalog, unit, 'designed_factory_fire_immune')) {
        next = { ...next, immuneToFire: true };
    }
    if (unitHasNamedTag(catalog, unit, 'designed_arcane_illusion')) {
        next = { ...next, aiTreatAsThreat: true };
    }
    if (unitHasNamedTag(catalog, unit, 'designed_arcane_shield')) {
        next = { ...next, immuneToMagicDmg: true };
    }
    if (unitHasNamedTag(catalog, unit, 'designed_arcane_animated_weapon') &&
        next.autoTarget == null) {
        next = { ...next, autoTarget: 'random_enemy' };
    }
    if (unitHasNamedTag(catalog, unit, TAG_FIRE_TOTEM)) {
        next = {
            ...next,
            shape: 'single',
            autoTarget: next.autoTarget ?? 'random_enemy',
        };
    }
    if (unitHasNamedTag(catalog, unit, TAG_LIGHTNING_TOTEM)) {
        next = {
            ...next,
            shape: 'beam',
            autoTarget: next.autoTarget ?? 'random_enemy',
        };
    }
    if (unitHasNamedTag(catalog, unit, TAG_NATURE_TOTEM)) {
        next = { ...next, shape: next.shape ?? 'single' };
    }
    const factory = designedFactoryAbilities(catalog, unit, advanced);
    if (factory) {
        if (unitHasNamedTag(catalog, unit, 'designed_factory_weeping_angel')) {
            next = {
                ...next,
                blinkMovement: true,
                requiresLos: true,
                respectsHexSize: true,
                shape: next.shape === 'single' ? 'pulse' : next.shape,
                radius: Math.max(1, next.radius),
                chancePct: next.chancePct ?? 50,
                resistStat: next.resistStat ?? 'resistance',
                inflictsCondition: next.inflictsCondition ?? 5,
                conditionDuration: Math.max(1, next.conditionDuration),
                no_enemy_retaliation: true,
            };
        }
        if (unitHasNamedTag(catalog, unit, 'designed_factory_blink_dog')) {
            next = {
                ...next,
                blinkMovement: true,
                requiresLos: true,
                respectsHexSize: true,
            };
        }
        if (unitHasNamedTag(catalog, unit, 'designed_factory_ninja')) {
            next = {
                ...next,
                blinkMovement: true,
                requiresLos: true,
                respectsHexSize: true,
                grantsSecondAttack: true,
                chancePctFlatStat: 2,
                chanceHalvesEachAttempt: true,
                extraAttackOnAttackOnly: false,
            };
        }
        if (unitHasNamedTag(catalog, unit, 'designed_factory_chronomancer')) {
            next = {
                ...next,
                speedSwapIfTargetFaster: true,
                speedSwapDuration: Math.max(1, next.speedSwapDuration || 1),
            };
        }
    }
    return next;
}
function enrichMaxRange(catalog, unit, parsed) {
    if (unitHasNamedTag(catalog, unit, 'designed_halberdier_reach') &&
        parsed < 2) {
        return 2;
    }
    return parsed;
}
function enrichBlocksLos(catalog, unit, fromDb) {
    if (fromDb) {
        return true;
    }
    return unitHasNamedTag(catalog, unit, 'terrain_los_blocker');
}
export function enrichCatalogUnits(catalog) {
    catalog.unit = catalog.unit.map((unit) => {
        const retaliation = enrichRetaliation(catalog, unit, unit.retaliation);
        const abilities = enrichAbilities(catalog, unit, unit.abilities);
        const max_range = enrichMaxRange(catalog, unit, unit.max_range);
        const blocks_los = enrichBlocksLos(catalog, unit, unit.blocks_los === true);
        let image_path = unit.image_path;
        let image_path_alt = unit.image_path_alt;
        if (unitHasNamedTag(catalog, unit, 'unstable_rift')) {
            image_path = image_path ?? 'Unstable_Rift_1.png';
            image_path_alt = image_path_alt ?? 'Silent_Rift_1.png';
        }
        return {
            ...unit,
            retaliation,
            abilities,
            max_range,
            blocks_los,
            image_path,
            image_path_alt,
        };
    });
}
