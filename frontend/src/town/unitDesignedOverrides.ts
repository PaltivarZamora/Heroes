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

export function designedFactoryAbilities(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  _advanced: boolean,
): Partial<UnitCombatAbilities> | null {
  if (has(catalog, unit, 'designed_ninja')) {
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
  if (has(catalog, unit, 'designed_void')) {
    return {
      shape: 'pulse',
      radius: 1,
      leavesGroundEffectOnMove: true,
      groundEffectId: 5,
    }
  }
  if (has(catalog, unit, 'designed_bouncy_bomb')) {
    return { shape: 'pulse', radius: 1, killChainPulse: true }
  }
  if (has(catalog, unit, 'designed_flesh_golem')) {
    return {
      shape: 'single',
      killAbsorbChancePct: 33,
      killAbsorbTagsRequired: [10],
      growsQtyOnKill: 1,
    }
  }
  if (has(catalog, unit, 'designed_princess_of_darkness')) {
    return {
      shape: 'single',
      killAbsorbRequiresTier: 6,
      killAbsorbTagsRequired: [2, 10],
      growsQtyOnKill: 1,
      killAbsorbTrigger: 'per_attack',
      immuneToFire: true,
    }
  }
  if (has(catalog, unit, 'designed_fire_immune')) {
    return { immuneToFire: true }
  }
  if (has(catalog, unit, 'designed_weeping_angel')) {
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
  if (has(catalog, unit, 'designed_blink_dog')) {
    return { blinkMovement: true, requiresLos: true, respectsHexSize: true }
  }
  if (has(catalog, unit, 'designed_chronomancer')) {
    return {
      shape: 'single',
      speedSwapIfTargetFaster: true,
      speedSwapDuration: 1,
    }
  }
  if (has(catalog, unit, 'designed_imp_trail')) {
    return {
      shape: 'aoe',
      radius: 1,
      leavesGroundEffectOnAttack: true,
      groundEffectId: 6,
      immuneToFire: true,
      fizzleTerrainIds: [3, 20, 21],
    }
  }
  if (has(catalog, unit, 'designed_smoldering_ooze_trail')) {
    return {
      shape: 'pulse',
      radius: 1,
      leavesGroundEffectOnAttack: true,
      groundEffectId: 6,
      immuneToFire: true,
      fizzleTerrainIds: [3, 20, 21],
    }
  }
  if (has(catalog, unit, 'designed_cerberus_trail')) {
    return {
      shape: 'breath',
      rows: 2,
      leavesGroundEffectOnAttack: true,
      groundEffectId: 6,
      fizzleTerrainIds: [3, 20, 21],
    }
  }
  if (has(catalog, unit, 'designed_efreeti_trail')) {
    return {
      shape: 'single',
      leavesGroundEffectOnAttack: true,
      groundEffectId: 6,
      fizzleTerrainIds: [3, 20, 21],
    }
  }
  if (has(catalog, unit, 'designed_inquisitor_charge')) {
    return {
      shape: 'single',
      chargeDmgEscalation: true,
      escalationChancePctStat: 1,
      escalationMult: 1.5,
      escalationMinIncrease: 1,
    }
  }
  if (has(catalog, unit, 'designed_war_mammoth_charge')) {
    return {
      shape: 'cleave',
      chargeDmgEscalation: true,
      escalationChancePctStat: 1,
      escalationMult: 1.5,
      escalationMinIncrease: 1,
    }
  }
  if (has(catalog, unit, 'designed_gladiator_slow')) {
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
  _advanced: boolean,
): Partial<UnitCombatAbilities> | null {
  if (has(catalog, unit, 'designed_mud_spawn')) {
    return { shape: 'single', absorbTerrainIds: [5] }
  }
  if (has(catalog, unit, 'designed_tidal_caller')) {
    return {
      shape: 'line',
      dmgIncreasePerHex: 1,
      clearsGroundEffectId: 6,
    }
  }
  if (has(catalog, unit, 'designed_thunder_lizard')) {
    return {
      shape: 'beam',
      leavesGroundEffectOnAttack: true,
      groundEffectId: 7,
      immuneToLightning: true,
    }
  }
  if (has(catalog, unit, 'designed_phoenix')) {
    return {
      shape: 'single',
      selfRezOnWipe: true,
      selfRezChanceStatDiv: 3,
      selfRezCapPct: 90,
      selfRezBasedOnKillsThisRound: true,
    }
  }
  if (has(catalog, unit, 'designed_cloud_panther')) {
    return { shape: 'single', immuneToLightning: true }
  }
  if (has(catalog, unit, 'designed_void_immune')) {
    return { immuneToLightning: true, immuneToFire: true }
  }
  if (has(catalog, unit, 'designed_lightning_totem')) {
    return { immuneToLightning: true }
  }
  return null
}

export function designedTempleAbilities(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  advanced: boolean,
): Partial<UnitCombatAbilities> | null {
  if (has(catalog, unit, 'designed_abbott')) {
    return { shape: 'single' }
  }
  if (has(catalog, unit, 'designed_high_priestess')) {
    return {
      shape: 'single',
      healMostInjuredOnKill: true,
      healFull: true,
    }
  }
  if (has(catalog, unit, 'designed_angelic_warrior')) {
    return {
      shape: 'cleave',
      dualAttack: true,
      secondAttackDmgType: 'Physical',
      secondAttackMinDmg: advanced ? 36 : 35,
      secondAttackMaxDmg: advanced ? 46 : 45,
      retaliateOnceAfterBoth: true,
    }
  }
  return null
}

export function designedTempleRetaliation(
  catalog: ReferenceCatalog,
  unit: UnitRow,
  advanced: boolean,
): Partial<UnitRetaliation> | null {
  if (has(catalog, unit, 'designed_abbott')) {
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
  if (!has(catalog, unit, 'designed_chronomancer')) {
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
  if (!has(catalog, unit, 'designed_weeping_angel')) {
    return null
  }
  return { times: 0 }
}
