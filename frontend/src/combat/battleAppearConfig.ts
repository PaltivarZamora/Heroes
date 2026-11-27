import { positiveAnimConfig } from '../config/animConfig'
import type { ReferenceCatalog } from '../town/catalog'
import { appendBattleAnimCombatLog } from './battleAnimLogBridge'

export const APPEAR_STAGGER_SEC_KEY = 'appear_stagger_sec'
export const APPEAR_RISE_SEC_KEY = 'appear_rise_sec'
export const APPEAR_RAIN_HEX_PER_SEC_KEY = 'appear_rain_hex_per_sec'

const warned = new Set<string>()

function warnMissing(key: string): void {
  if (warned.has(key)) {
    return
  }
  warned.add(key)
  appendBattleAnimCombatLog(
    `[Dev] [anim_config] ${key} missing or invalid — mid-battle appear timing disabled for that style.`,
  )
}

export function appearStaggerSec(
  catalog: ReferenceCatalog | null | undefined,
): number | null {
  const v = positiveAnimConfig(catalog, APPEAR_STAGGER_SEC_KEY)
  if (v == null) {
    warnMissing(APPEAR_STAGGER_SEC_KEY)
    return null
  }
  return v
}

export function appearRiseSec(
  catalog: ReferenceCatalog | null | undefined,
): number | null {
  const v = positiveAnimConfig(catalog, APPEAR_RISE_SEC_KEY)
  if (v == null) {
    warnMissing(APPEAR_RISE_SEC_KEY)
    return null
  }
  return v
}

export function appearRainHexPerSec(
  catalog: ReferenceCatalog | null | undefined,
): number | null {
  const v = positiveAnimConfig(catalog, APPEAR_RAIN_HEX_PER_SEC_KEY)
  if (v == null) {
    warnMissing(APPEAR_RAIN_HEX_PER_SEC_KEY)
    return null
  }
  return v
}