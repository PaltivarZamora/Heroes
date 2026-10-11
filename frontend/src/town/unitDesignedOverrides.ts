import type {
  ReferenceCatalog,
  UnitCombatAbilities,
  UnitRetaliation,
  UnitRow,
} from './catalog'
import { unitHasNamedTag } from './unitTags'

function has(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  tag: string,
): boolean {
  return unitHasNamedTag(catalog, unit, tag)
}

/** BR S7-5 condition proc overrides — tag per row (base + advanced units share tag). */
export function s75UnitConditionNorm(
  catalog: ReferenceCatalog,
  unit: UnitRow,
): Partial<UnitCombatAbilities> | null {
  const tags: Array<[string, Partial<UnitCombatAbilities>]> = [
    [
      's75_fear_spirit_adv',
      { chancePct: 50, conditionDuration: 1, resistStat: 'resistance' },
    ],
    [
      's75_fear_nightmare',
      { chancePct: 33, conditionDuration: 1, resistStat: 'resistance' },
    ],
    [
      's75_fear_nightmare_adv',
      { chancePct: 50, conditionDuration: 1, resistStat: 'resistance' },
    ],
    [
      's75_fear_leviathan',
      { chancePct: 33, conditionDuration: 1, resistStat: 'resistance' },
    ],
    [
      's75_fear_bound_spirit',
      { chancePct: 33, conditionDuration: 1, resistStat: 'resistance' },
    ],
    [
      's75_stun_medusa',
      { chancePct: 33, conditionDuration: 1, resistStat: 'resistance' },
    ],
    [
      's75_stun_medusa_adv',
      { chancePct: 50, conditionDuration: 1, resistStat: 'resistance' },
    ],
    [
      's75_stun_arbalast',
      {
        chancePct: 33,
        conditionDuration: 1,
        resistStat: 'resistance',
        chancePctFlatStat: null,
      },
    ],
    [
      's75_stun_arbalast_adv',
      {
        chancePct: 50,
        conditionDuration: 1,
        resistStat: 'resistance',
        chancePctFlatStat: null,
      },
    ],
    ['s75_silence_concussive', { chancePct: 33, resistStat: 'resistance' }],
    ['s75_silence_concussive_adv', { chancePct: 50, resistStat: 'resistance' }],
    [
      's75_silence_siren',
      { chancePct: 33, resistStat: 'resistance', chancePctFlatStat: null },
    ],
    [
      's75_silence_siren_adv',
      { chancePct: 50, resistStat: 'resistance', chancePctFlatStat: null },
    ],
    [
      's75_confuse_succubus',
      {
        chancePct: 33,
        conditionDuration: 1,
        resistStat: 'resistance',
        chancePctFlatStat: null,
      },
    ],
    [
      's75_confuse_succubus_adv',
      {
        chancePct: 50,
        conditionDuration: 1,
        resistStat: 'resistance',
        chancePctFlatStat: null,
      },
    ],
  ]
  for (const [tag, patch] of tags) {
    if (has(catalog, unit, tag)) {
      return patch
    }
  }
  return null
}

export function designedFactoryAbilities(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  _advanced: boolean,
): Partial<UnitCombatAbilities> | null {
  if (has(catalog, unit, 'designed_factory_ninja')) {
    return {
      shape: 'single',
      blinkMovement: true,
      requiresLos: true,
      respectsHexSize: true,
      grantsSecondAttack: true,
      chancePctFlatStat: 2,
      chanceHalvesEachAttempt: true,
    }
  }
  if (has(catalog, unit, 'designed_factory_hammersmith')) {
    return {
      shape: 'single',
      canTargetAllyIfTag: 8,
      healOnAllyTarget: true,
      healAmtPerUnit: 1,
    }
  }
  if (has(catalog, unit, 'designed_factory_void')) {
    return {
      shape: 'pulse',
      radius: 1,
      leavesGroundEffectOnMove: true,
      groundEffectId: 5,
    }
  }
  if (has(catalog, unit, 'designed_factory_bouncy_bomb')) {
    return { shape: 'pulse', radius: 1, killChainPulse: true }
  }
  if (has(catalog, unit, 'designed_factory_flesh_golem')) {
    return {
      shape: 'single',
      killAbsorbChancePct: 33,
      killAbsorbTagRequired: 10,
      growsQtyOnKill: 1,
    }
  }
  if (has(catalog, unit, 'designed_factory_pit_fiend_arch')) {
    return {
      shape: 'single',
      killAbsorbRequiresTier: 6,
      killAbsorbTagsRequired: [2, 10],
      growsQtyOnKill: 1,
      killAbsorbTrigger: 'per_attack',
      immuneToFire: true,
    }
  }
  if (has(catalog, unit, 'designed_factory_fire_immune')) {
    return { immuneToFire: true }
  }
  if (has(catalog, unit, 'designed_factory_weeping_angel')) {
    return {
      blinkMovement: true,
      requiresLos: true,
      respectsHexSize: true,
      shape: 'pulse',
      radius: 1,
      chancePct: 50,
      resistStat: 'resistance',
      inflictsCondition: 5,
      conditionDuration: 1,
      no_enemy_retaliation: true,
    }
  }
  if (has(catalog, unit, 'designed_factory_blink_dog')) {
    return { blinkMovement: true, requiresLos: true, respectsHexSize: true }
  }
  if (has(catalog, unit, 'designed_factory_chronomancer')) {
    return {
      shape: 'single',
      speedSwapIfTargetFaster: true,
      speedSwapDuration: 1,
    }
  }
  if (has(catalog, unit, 'designed_factory_imp_trail')) {
    return {
      shape: 'aoe',
      radius: 1,
      leavesGroundEffectOnAttack: true,
      groundEffectId: 6,
      chancePct: 40,
      immuneToFire: true,
      fizzleTerrainIds: [3, 20, 21],
    }
  }
  if (has(catalog, unit, 'designed_factory_smoldering_ooze_trail')) {
    return {
      shape: 'pulse',
      radius: 1,
      leavesGroundEffectOnAttack: true,
      groundEffectId: 6,
      chancePct: 40,
      immuneToFire: true,
      fizzleTerrainIds: [3, 20, 21],
    }
  }
  if (has(catalog, unit, 'designed_factory_cerberus_trail')) {
    return {
      shape: 'breath',
      rows: 2,
      leavesGroundEffectOnAttack: true,
      groundEffectId: 6,
      chancePct: 40,
      fizzleTerrainIds: [3, 20, 21],
    }
  }
  if (has(catalog, unit, 'designed_factory_efreeti_trail')) {
    return {
      shape: 'single',
      leavesGroundEffectOnAttack: true,
      groundEffectId: 6,
      chancePct: 100,
      fizzleTerrainIds: [3, 20, 21],
    }
  }
  if (has(catalog, unit, 'designed_factory_jouster_charge')) {
    return {
      shape: 'single',
      chargeDmgEscalation: true,
      escalationChancePctStat: 1,
      escalationMult: 1.5,
      escalationMinIncrease: 1,
    }
  }
  if (has(catalog, unit, 'designed_factory_war_mammoth_charge')) {
    return {
      shape: 'cleave',
      chargeDmgEscalation: true,
      escalationChancePctStat: 1,
      escalationMult: 1.5,
      escalationMinIncrease: 1,
    }
  }
  if (has(catalog, unit, 'designed_factory_gladiator_slow')) {
    return {
      shape: 'single',
      chancePct: 80,
      resistStat: 'resistance',
      speedDebuffFlatStatDiv: 9,
      conditionDuration: 1,
    }
  }
  return null
}

export function designedConfluenceAbilities(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  advanced: boolean,
): Partial<UnitCombatAbilities> | null {
  if (has(catalog, unit, 'designed_confluence_mud_sprite')) {
    return { shape: 'single', absorbTerrainIds: [5] }
  }
  if (has(catalog, unit, 'designed_confluence_spark')) {
    return {
      shape: 'single',
      leavesGroundEffectOnAttack: true,
      groundEffectId: 7,
      chancePct: 100,
      immuneToLightning: true,
    }
  }
  if (has(catalog, unit, 'designed_confluence_tidal_caller')) {
    return {
      shape: 'line',
      dmgIncreasePerHex: 1,
      clearsGroundEffectId: 6,
    }
  }
  if (has(catalog, unit, 'designed_confluence_thunder_lizard')) {
    return {
      shape: 'beam',
      leavesGroundEffectOnAttack: true,
      groundEffectId: 7,
      chancePctIntelStat: 4,
      immuneToLightning: true,
    }
  }
  if (has(catalog, unit, 'designed_confluence_tempest')) {
    return {
      shape: 'aoe',
      radius: advanced ? 3 : 2,
      scatterGroundEffectOnMoveStop: true,
      groundEffectId: 7,
      chancePctIntelStat: 4,
      immuneToLightning: true,
    }
  }
  if (has(catalog, unit, 'designed_confluence_pyromaniac')) {
    return {
      shape: 'spiral',
      radius: advanced ? 3 : 2,
      spiralChanceDecayPct: advanced ? 5 : 10,
      groundEffectId: 6,
      fizzleTerrainIds: [3, 20, 21],
    }
  }
  if (has(catalog, unit, 'designed_confluence_tesla_coil')) {
    return {
      shape: 'multi',
      targets: advanced ? 3 : 2,
      leavesGroundEffectOnAttack: true,
      groundEffectId: 7,
      chancePct: 80,
      immuneToLightning: true,
    }
  }
  if (has(catalog, unit, 'designed_confluence_phoenix')) {
    return {
      shape: 'single',
      selfRezOnWipe: true,
      selfRezChanceStatDiv: 3,
      selfRezCapPct: 90,
      selfRezBasedOnKillsThisRound: true,
    }
  }
  if (has(catalog, unit, 'designed_confluence_cloud_panther')) {
    return { shape: 'single', immuneToLightning: true }
  }
  if (has(catalog, unit, 'designed_confluence_channeler')) {
    return { shape: 'chain', immuneToLightning: true }
  }
  if (has(catalog, unit, 'designed_confluence_void_immune')) {
    return { immuneToLightning: true, immuneToFire: true }
  }
  if (has(catalog, unit, 'designed_confluence_lightning_totem')) {
    return { immuneToLightning: true }
  }
  return null
}

export function designedTempleAbilities(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  advanced: boolean,
): Partial<UnitCombatAbilities> | null {
  if (has(catalog, unit, 'designed_temple_zealot')) {
    return { shape: 'single' }
  }
  if (has(catalog, unit, 'designed_temple_high_priestess')) {
    return {
      shape: 'single',
      healMostInjuredOnKill: true,
      healFull: true,
    }
  }
  if (has(catalog, unit, 'designed_temple_inquisitor')) {
    return {
      shape: 'single',
      extraTurnOnKill: true,
      chancePctFlatStat: 1,
    }
  }
  if (has(catalog, unit, 'designed_temple_angelic_warrior')) {
    return {
      shape: 'cleave',
      dualAttack: true,
      secondAttackDmgType: 'Physical',
      secondAttackMinDmg: advanced ? 36 : 35,
      secondAttackMaxDmg: advanced ? 46 : 45,
      retaliateOnceAfterBoth: true,
    }
  }
  if (has(catalog, unit, 'designed_temple_divine_aura')) {
    return {
      shape: 'single',
      auraRadius: advanced ? 2 : 1,
      auraCountsAlliesAsExtraQty: true,
    }
  }
  return null
}

export function designedTempleRetaliation(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  advanced: boolean,
): Partial<UnitRetaliation> | null {
  if (has(catalog, unit, 'designed_temple_zealot')) {
    return {
      shape: 'chain',
      jumps: advanced ? 3 : 2,
      falloff: 33,
      times: 1,
      dmgPct: 50,
    }
  }
  return null
}

export function designedChronomancerRetaliation(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  advanced: boolean,
): Partial<UnitRetaliation> | null {
  if (!has(catalog, unit, 'designed_factory_chronomancer')) {
    return null
  }
  return {
    teleportsAttacker: true,
    teleportChancePct: advanced ? 75 : 50,
    resistStat: 'resistance',
    dmgPct: 50,
  }
}

export function designedWeepingAngelRetaliation(
  catalog: ReferenceCatalog,
  unit: UnitRow,
): Partial<UnitRetaliation> | null {
  if (!has(catalog, unit, 'designed_factory_weeping_angel')) {
    return null
  }
  return { times: 0 }
}
