import type { CombatBattle, CombatSide, CombatStack } from './battle'
import {
  scaleBySignedPct,
  stackCombatSpeed,
  stackDefense,
  stackMaxDmg,
  stackMaxHealth,
  stackMaxRange,
  stackMinDmg,
  stackResistance,
} from './battle'
import type { CombatHeroes } from './attack'
import { necromancerShadowDamageBonusPct } from './shadow'
import { visibleGroundEffects } from './groundEvasion'
import { occupancyKey, stackFootprint } from './occupancy'
import type { ReferenceCatalog, UnitCombatAbilities, UnitRetaliation } from '../town/catalog'
import {
  conditionName,
  debugSeeEnemyStats,
  unitById,
  unitRetaliation,
} from '../town/catalog'

function formatModified(base: number, pct: number): string {
  if (!pct) {
    return String(base)
  }
  if (base <= 0) {
    return `${pct > 0 ? '+' : ''}${pct}%`
  }
  return String(scaleBySignedPct(base, pct))
}

function formatRetaliation(row: UnitRetaliation): string {
  const dmg = row.dmgPct === 'max' ? 'max dmg' : `${row.dmgPct}%`
  const times = row.times === 'unlimited' ? 'unlimited' : `${row.times}×`
  const shape =
    row.shape != null && row.shape !== 'single'
      ? `, ${row.shape}${row.radius != null ? ` r${row.radius}` : ''}`
      : ''
  return `${dmg}, ${times}${row.preemptive ? ', preemptive' : ''}${shape}`
}

function formatAbilities(abilities: UnitCombatAbilities): string {
  return JSON.stringify(abilities, null, 0)
}

function countLabel(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

function signedPct(n: number): string {
  return `${n > 0 ? '+' : ''}${n}%`
}

function signedFlat(n: number): string {
  return `${n > 0 ? '+' : ''}${n}`
}

/** Effect row: name | (qty/duration) — renders as "Last Stand (min 1)" on tip. */
function effect(name: string, detail?: string | null): InspectRow {
  if (detail == null || detail === '') {
    return { label: name, value: '' }
  }
  return { label: name, value: `(${detail})` }
}

/** Per-creature min/max after output mods + Necromancer Shadow passive. */
function inspectDamageRange(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  battle?: CombatBattle,
  heroes?: CombatHeroes,
): { minDmg: number; maxDmg: number; shadowPct: number } {
  const unit = unitById(catalog, stack.unitId)
  const magic = (unit?.dmg_type ?? '').toLowerCase() === 'magic'
  const out = stack.outputMods
  const minPct = magic ? (out?.magicMin ?? 0) : (out?.physicalMin ?? 0)
  const maxPct = magic ? (out?.magicMax ?? 0) : (out?.physicalMax ?? 0)
  const shadowPct =
    battle != null
      ? necromancerShadowDamageBonusPct(stack, battle, catalog, heroes)
      : 0
  const totalPct =
    (magic ? (out?.magicTotal ?? 0) : (out?.physicalTotal ?? 0)) + shadowPct
  return {
    minDmg: scaleBySignedPct(
      scaleBySignedPct(stackMinDmg(stack, catalog), minPct),
      totalPct,
    ),
    maxDmg: scaleBySignedPct(
      scaleBySignedPct(stackMaxDmg(stack, catalog), maxPct),
      totalPct,
    ),
    shadowPct,
  }
}

export type InspectRow = {
  label: string
  value: string
}

export type InspectCondition = {
  name: string
  remaining: string
}

/** Full combat stats for allies, Expose, or debug_see_enemy_stats. */
export function canInspectFullStats(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  viewerSide: CombatSide | null | undefined,
): boolean {
  if (debugSeeEnemyStats(catalog)) {
    return true
  }
  if (viewerSide == null || stack.side === viewerSide) {
    return true
  }
  return stack.exposed === true
}

export function inspectConditions(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): InspectCondition[] {
  return Object.entries(stack.conditions ?? {})
    .filter(([, remaining]) => (remaining ?? 0) > 0)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([id, remaining]) => {
      const extra = stack.conditionExtra?.[Number(id)]
      const unit = extra?.hitTick ? 'hit' : extra?.roundTick ? 'round' : 'turn'
      return {
        name: conditionName(catalog, Number(id)),
        remaining:
          remaining === 1 ? `this ${unit}` : countLabel(remaining, unit),
      }
    })
}

function groundZonesUnderStack(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  battle: CombatBattle | undefined,
  viewerSide: CombatSide | null | undefined,
): InspectRow[] {
  if (!battle) {
    return []
  }
  const keys = new Set(
    stackFootprint(stack, catalog).map((hex) => occupancyKey(hex.q, hex.r)),
  )
  const side = viewerSide ?? stack.side
  const rows: InspectRow[] = []
  const seen = new Set<string>()
  for (const zone of visibleGroundEffects(battle, side)) {
    if (!zone.hexKeys.some((key) => keys.has(key))) {
      continue
    }
    const name = zone.name?.trim() || 'Ground effect'
    if (seen.has(name)) {
      continue
    }
    seen.add(name)
    const bits: string[] = []
    if (zone.roundsLeft != null && zone.roundsLeft > 0) {
      bits.push(countLabel(zone.roundsLeft, 'round'))
    }
    if (zone.evasionPct > 0) {
      bits.push(`${zone.evasionPct}% evade`)
    }
    if (zone.blocksMovement) {
      bits.push('blocks movement')
    }
    rows.push(effect(name, bits.length > 0 ? bits.join(', ') : 'standing in'))
  }
  return rows
}

/**
 * Active buffs, debuffs, conditions, and ground zones for tip / inspect.
 * Values use parentheses so UI reads as "Last Stand (min 1)".
 */
export function inspectActiveEffects(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  viewerSide?: CombatSide | null,
  battle?: CombatBattle,
  heroes?: CombatHeroes,
): InspectRow[] {
  const rows: InspectRow[] = []

  for (const cond of inspectConditions(stack, catalog)) {
    rows.push(effect(cond.name, cond.remaining))
  }

  const out = stack.outputMods
  if (out) {
    const parts: string[] = []
    if (out.physicalTotal) {
      parts.push(`phys ${signedPct(out.physicalTotal)}`)
    }
    if (out.magicTotal) {
      parts.push(`magic ${signedPct(out.magicTotal)}`)
    }
    if (out.physicalMin) {
      parts.push(`phys min ${signedPct(out.physicalMin)}`)
    }
    if (out.magicMin) {
      parts.push(`magic min ${signedPct(out.magicMin)}`)
    }
    if (out.physicalMax) {
      parts.push(`phys max ${signedPct(out.physicalMax)}`)
    }
    if (out.magicMax) {
      parts.push(`magic max ${signedPct(out.magicMax)}`)
    }
    if (parts.length > 0) {
      rows.push(effect('Dmg mod', parts.join(', ')))
    }
  }

  const mit = stack.mitigationPct
  if (mit) {
    const parts: string[] = []
    if (mit.defense) {
      parts.push(`def ${signedPct(mit.defense)}`)
    }
    if (mit.resistance) {
      parts.push(`res ${signedPct(mit.resistance)}`)
    }
    if (parts.length > 0) {
      rows.push(effect('Mitigation', parts.join(', ')))
    }
  }

  if (stack.speedMod) {
    rows.push(effect('Speed mod', signedFlat(stack.speedMod)))
  }

  if (stack.minDmgMult != null && stack.minDmgMult !== 1) {
    rows.push(effect('Min dmg', `×${stack.minDmgMult}`))
  }
  if (stack.maxDmgMult != null && stack.maxDmgMult !== 1) {
    rows.push(effect('Max dmg', `×${stack.maxDmgMult}`))
  }
  if (stack.defenseSet != null) {
    rows.push(effect('Defense set', String(stack.defenseSet)))
  }
  if (stack.defensePct) {
    const floor =
      stack.defenseFloor != null ? `, floor ${stack.defenseFloor}` : ''
    rows.push(effect('Defense', `${signedPct(stack.defensePct)}${floor}`))
  }
  if (stack.resistancePct) {
    rows.push(effect('Resistance', signedPct(stack.resistancePct)))
  }

  const flat = stack.statFlat
  if (flat) {
    const parts: string[] = []
    if (flat.speed) {
      parts.push(`spd ${signedFlat(flat.speed)}`)
    }
    if (flat.defense) {
      parts.push(`def ${signedFlat(flat.defense)}`)
    }
    if (flat.resistance) {
      parts.push(`res ${signedFlat(flat.resistance)}`)
    }
    if (flat.minDmg) {
      parts.push(`min ${signedFlat(flat.minDmg)}`)
    }
    if (flat.maxDmg) {
      parts.push(`max ${signedFlat(flat.maxDmg)}`)
    }
    if (flat.maxRange) {
      parts.push(`range ${signedFlat(flat.maxRange)}`)
    }
    if (flat.health) {
      parts.push(`HP ${signedFlat(flat.health)}`)
    }
    if (parts.length > 0) {
      rows.push(effect('Mutation', parts.join(', ')))
    }
  }

  if (stack.vampiricStrike) {
    rows.push(effect('Vampiric Strike'))
  }
  if (stack.killOnOverflow) {
    rows.push(effect('Execute'))
  }
  if (stack.critPctBonus) {
    rows.push(effect('Crit chance', signedPct(stack.critPctBonus)))
  }
  if (stack.critAmtBonus) {
    rows.push(effect('Crit damage', signedPct(stack.critAmtBonus)))
  }
  if (stack.minCritBonusDmg) {
    rows.push(effect('Crit floor', String(stack.minCritBonusDmg)))
  }
  if (stack.speedUses) {
    rows.push(
      effect(
        'Adrenaline Rush',
        `${signedFlat(stack.speedUses.amount)}, ${countLabel(stack.speedUses.usesLeft, 'use')}`,
      ),
    )
  }
  if (stack.chargeRush) {
    rows.push(
      effect(
        'Furious Rush',
        `×${stack.chargeRush.coefficient}, ${countLabel(stack.chargeRush.usesLeft, 'use')}`,
      ),
    )
  }
  if (stack.ignoreMinRangePenalty) {
    rows.push(effect('Steady Aim'))
  }
  if (stack.parryPhysicalUses) {
    const note = stack.parryIgnoresRetaliation ? ', ignores retaliation' : ''
    rows.push(
      effect(
        'Parry',
        `${countLabel(stack.parryPhysicalUses, 'physical hit')}${note}`,
      ),
    )
  }
  if ((stack.conditionImmunityUsesLeft ?? 0) > 0) {
    rows.push(
      effect(
        'Hyper Focus',
        countLabel(stack.conditionImmunityUsesLeft ?? 0, 'condition block'),
      ),
    )
  }
  if (stack.speedLock) {
    rows.push(
      effect(
        'Temporal Bolt',
        `Speed ${stack.speedLock.value}, ${countLabel(stack.speedLock.roundsLeft, 'round')}`,
      ),
    )
  }
  if (stack.guardianAngel) {
    rows.push(
      effect(
        'Guardian Angel',
        `restore to ${stack.guardianAngel.snapshotQty} once`,
      ),
    )
  }
  if (stack.ignoresSublethal) {
    rows.push(effect('Fortify'))
  }
  if (stack.lastStand) {
    rows.push(
      effect(
        'Last Stand',
        `min ${stack.lastStand.minQty}, last @${stack.lastStand.lastUnitHp} HP`,
      ),
    )
  }
  if (stack.barragePct) {
    const left =
      stack.barrageUsesLeft != null
        ? `, ${countLabel(stack.barrageUsesLeft, 'use')}`
        : ''
    rows.push(effect('Barrage', `${stack.barragePct}% before retaliation${left}`))
  }
  if (stack.battleCryRetaliation) {
    rows.push(
      effect(
        'Battle Cry',
        `retaliation ${stack.battleCryRetaliation.pct}%, ${countLabel(stack.battleCryRetaliation.usesLeft, 'use')}`,
      ),
    )
  }
  if (stack.deflect) {
    rows.push(
      effect(
        'Deflect',
        `${stack.deflect.pct}% of attacker min, ${countLabel(stack.deflect.usesLeft, 'use')}`,
      ),
    )
  }
  if (stack.immunityHitsLeft) {
    rows.push(
      effect('Immunity', countLabel(stack.immunityHitsLeft, 'hit')),
    )
  }
  if (stack.doubleTapUsesLeft) {
    rows.push(
      effect('Double Tap', countLabel(stack.doubleTapUsesLeft, 'use')),
    )
  }
  if (stack.preemptiveStrikeUsesLeft) {
    rows.push(
      effect(
        'Preemptive Strike',
        countLabel(stack.preemptiveStrikeUsesLeft, 'use'),
      ),
    )
  }
  if (stack.speedBoost) {
    const amt = stack.speedBoost.amount
    rows.push(
      effect(
        amt < 0 ? 'Slow' : 'Charge',
        `${amt < 0 ? '' : '+'}${amt} speed, ${countLabel(stack.speedBoost.roundsLeft, 'round')}`,
      ),
    )
  }
  if (stack.defenseMult && stack.resistanceMult) {
    rows.push(
      effect(
        'Shield Wall',
        `def ×${stack.defenseMult.mult}, res ×${stack.resistanceMult.mult}, ${countLabel(stack.defenseMult.roundsLeft, 'round')}`,
      ),
    )
  } else if (stack.defenseMult) {
    rows.push(
      effect(
        'Guard',
        `def ×${stack.defenseMult.mult}, ${countLabel(stack.defenseMult.roundsLeft, 'round')}`,
      ),
    )
  } else if (stack.resistanceMult) {
    rows.push(
      effect(
        'Shield Wall',
        `res ×${stack.resistanceMult.mult}, ${countLabel(stack.resistanceMult.roundsLeft, 'round')}`,
      ),
    )
  }
  if (stack.evasion) {
    rows.push(
      effect(
        'Camouflage',
        `${stack.evasion.pct}% evade, ${countLabel(stack.evasion.roundsLeft, 'round')}`,
      ),
    )
  }
  if (stack.markHitsLeft) {
    rows.push(
      effect('Marked', countLabel(stack.markHitsLeft, 'max-dmg hit')),
    )
  }
  if (stack.disarm) {
    rows.push(
      effect(
        'Disarmed',
        `${countLabel(stack.disarm.roundsLeft, 'round')}, ${
          stack.disarm.physicalOnly ? 'Physical min dmg' : 'min dmg'
        }`,
      ),
    )
  }
  if (stack.ignoreTargetArmor) {
    rows.push(
      effect(
        'Sunder',
        stack.ignoreTargetArmorPhysicalOnly
          ? 'ignore armor (Physical)'
          : 'ignore armor',
      ),
    )
  }
  if (stack.reflect) {
    const phys = stack.reflect.physicalOnly ? ', Physical' : ''
    rows.push(
      effect(
        'Reflect',
        `${stack.reflect.pct}%, ${countLabel(stack.reflect.hitsLeft, 'hit')}${phys}`,
      ),
    )
  }
  if (stack.spellReflect) {
    rows.push(
      effect(
        'Spell Reflect',
        countLabel(stack.spellReflect.usesLeft, 'use'),
      ),
    )
  }
  if (stack.exposed) {
    rows.push(effect('Expose', 'stats revealed'))
  }
  if (stack.forcedRetreatPending) {
    rows.push(effect('Forced Retreat', 'returns next turn'))
  }
  if (stack.fervor) {
    const streak =
      stack.fervor.streak != null && stack.fervor.streak > 0
        ? `, streak ${stack.fervor.streak}`
        : ''
    rows.push(
      effect(
        'Fervor',
        `${stack.fervor.chancePct}% chain, ${countLabel(stack.fervor.roundsLeft, 'round')}${streak}`,
      ),
    )
  }
  if (stack.extraTurnThisRound) {
    rows.push(effect('Time Warp', 'extra turn'))
  }
  if (stack.silenced) {
    rows.push(effect('Rift', 'silent'))
  } else if (stack.silenceShotsLeft != null && stack.silenceShotsLeft > 0) {
    rows.push(
      effect(
        'Rift',
        `${stack.silenceShotsLeft} shot${stack.silenceShotsLeft === 1 ? '' : 's'} left`,
      ),
    )
  }

  const zones = groundZonesUnderStack(stack, catalog, battle, viewerSide)
  const { shadowPct } = inspectDamageRange(stack, catalog, battle, heroes)
  if (shadowPct > 0) {
    const idx = zones.findIndex(
      (row) => row.label.trim().toLowerCase() === 'shadow',
    )
    if (idx >= 0) {
      const prior = zones[idx].value.replace(/^\(|\)$/g, '')
      const bits = [prior, `+${shadowPct}% dmg`].filter((part) => part.length > 0)
      zones[idx] = effect('Shadow', bits.join(', '))
    } else {
      zones.push(effect('Shadow', `+${shadowPct}% dmg`))
    }
  }
  rows.push(...zones)

  return rows
}

/** Compact mouseover tip (Expose / ally / debug_see_enemy_stats). */
export function inspectHoverRows(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  viewerSide?: CombatSide | null,
  battle?: CombatBattle,
  heroes?: CombatHeroes,
): InspectRow[] {
  const unit = unitById(catalog, stack.unitId)
  if (!unit) {
    return [{ label: 'name', value: `unit ${stack.unitId}` }]
  }
  if (!canInspectFullStats(stack, catalog, viewerSide)) {
    return [
      { label: 'name', value: unit.name },
      { label: 'qty', value: String(stack.qty) },
      { label: 'scout', value: 'unknown — cast Expose to reveal' },
    ]
  }
  const mit = stack.mitigationPct
  const { minDmg, maxDmg } = inspectDamageRange(
    stack,
    catalog,
    battle,
    heroes,
  )
  const maxHp = stackMaxHealth(stack, catalog)
  const effects = inspectActiveEffects(
    stack,
    catalog,
    viewerSide,
    battle,
    heroes,
  )
  return [
    { label: 'name', value: unit.name },
    { label: 'qty', value: `${stack.qty} / ${stack.startingQty}` },
    { label: 'top HP', value: `${stack.topHealth} / ${maxHp}` },
    { label: 'dmg', value: `${minDmg}–${maxDmg}` },
    {
      label: 'defense',
      value: formatModified(stackDefense(stack, catalog), mit?.defense ?? 0),
    },
    {
      label: 'resistance',
      value: formatModified(stackResistance(stack, catalog), mit?.resistance ?? 0),
    },
    {
      label: 'speed',
      value:
        unit.speed == null
          ? '—'
          : String(stackCombatSpeed(stack, catalog) ?? unit.speed),
    },
    ...effects,
  ]
}

/** Live post-modifier stats for the inspect popup. */
export function inspectRows(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  viewerSide?: CombatSide | null,
  battle?: CombatBattle,
  heroes?: CombatHeroes,
): InspectRow[] {
  const unit = unitById(catalog, stack.unitId)
  if (!unit) {
    return [{ label: 'name', value: `unit ${stack.unitId}` }]
  }
  if (!canInspectFullStats(stack, catalog, viewerSide)) {
    return [
      { label: 'name', value: unit.name },
      { label: 'qty', value: String(stack.qty) },
      { label: 'scout', value: 'unknown — cast Expose to reveal' },
    ]
  }
  const mit = stack.mitigationPct
  const { minDmg, maxDmg } = inspectDamageRange(
    stack,
    catalog,
    battle,
    heroes,
  )
  const maxHp = stackMaxHealth(stack, catalog)
  return [
    { label: 'name', value: unit.name },
    { label: 'qty', value: `${stack.qty} / ${stack.startingQty}` },
    { label: 'health (max per creature)', value: String(maxHp) },
    { label: 'top HP', value: `${stack.topHealth} / ${maxHp}` },
    { label: 'dmg_type', value: unit.dmg_type ?? '—' },
    { label: 'min_dmg', value: String(minDmg) },
    { label: 'max_dmg', value: String(maxDmg) },
    { label: 'min_range', value: String(unit.min_range) },
    { label: 'max_range', value: String(stackMaxRange(stack, catalog)) },
    { label: 'defense', value: formatModified(stackDefense(stack, catalog), mit?.defense ?? 0) },
    {
      label: 'resistance',
      value: formatModified(stackResistance(stack, catalog), mit?.resistance ?? 0),
    },
    { label: 'speed', value: unit.speed == null ? '—' : String(stackCombatSpeed(stack, catalog) ?? unit.speed) },
    { label: 'retaliation', value: formatRetaliation(unitRetaliation(unit, catalog)) },
    { label: 'stationary', value: unit.stationary ? 'true' : 'false' },
    ...(unit.abilities.killOnOverflow
      ? [{ label: 'kill on overflow', value: 'true' }]
      : []),
    ...(unit.abilities.chancePct != null && unit.abilities.extraAttackOnAttackOnly
      ? [
          {
            label: 'assassinate',
            value: `${unit.abilities.chancePct}% extra attack`,
          },
        ]
      : []),
    { label: 'abilities', value: formatAbilities(unit.abilities) },
  ]
}
