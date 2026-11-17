import { animConfigRaw, positiveAnimConfig } from '../config/animConfig'
import type { ReferenceCatalog } from '../town/catalog'
import { conditionName } from '../town/catalog'
import type { CombatStack } from './battle'
import { appendBattleAnimCombatLog } from './battleAnimLogBridge'
import { devToolsEnabled } from '../settings/playerSettings'
import { polymorphBattleArtConfig } from './battleAnimConfig'
import { isPolymorphed } from './condition'
import type { BattleUnitSheetSet } from './battleUnitSheet'

const POLYMORPH_STEM_KEY = 'polymorph_stem'
const POLYMORPH_TOWN_ID_KEY = 'polymorph_town_id'

export type DevPolymorphSheetStatus =
  | { kind: 'loaded' }
  | { kind: 'null' }
  | { kind: 'failed'; reason: string }

let sheetStatus: DevPolymorphSheetStatus = { kind: 'null' }
const paintLogged = new Set<string>()

export function setDevPolymorphSheetStatus(status: DevPolymorphSheetStatus): void {
  sheetStatus = status
}

export function resetPolymorphDevDiagnostics(): void {
  sheetStatus = { kind: 'null' }
  paintLogged.clear()
}

function formatStackConditions(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): string {
  const bits: string[] = []
  for (const [rawId, left] of Object.entries(stack.conditions ?? {})) {
    if ((left ?? 0) <= 0) {
      continue
    }
    const id = Number(rawId)
    const name =
      Number.isInteger(id) && id > 0
        ? conditionName(catalog, id)
        : `id ${rawId}`
    bits.push(`${rawId}:${name}(${left})`)
  }
  return bits.length > 0 ? bits.join(', ') : '(none)'
}

function sheetStatusLabel(): string {
  if (sheetStatus.kind === 'loaded') {
    return 'loaded'
  }
  if (sheetStatus.kind === 'failed') {
    return `failed: ${sheetStatus.reason}`
  }
  return 'null'
}

function buildDevPolymorphLine(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  pathUsed: string,
  polymorphBattleSheet: BattleUnitSheetSet | null | undefined,
): string {
  const stemRaw = animConfigRaw(catalog, POLYMORPH_STEM_KEY) ?? ''
  const townIdRaw = animConfigRaw(catalog, POLYMORPH_TOWN_ID_KEY) ?? ''
  const townIdPositive = positiveAnimConfig(catalog, POLYMORPH_TOWN_ID_KEY)
  const cfg = polymorphBattleArtConfig(catalog)
  const folder = cfg?.townFolder ?? ''
  const poly = isPolymorphed(stack, catalog)
  const sheetNote =
    polymorphBattleSheet != null ? 'loaded' : sheetStatusLabel()
  return (
    `[Dev] Polymorph: stack ${stack.id} unit ${stack.unitId} | ` +
    `isPolymorphed ${poly} | conditions ${formatStackConditions(stack, catalog)} | ` +
    `stem '${stemRaw}' town_id '${townIdRaw}' (positiveAnim=${townIdPositive ?? 'null'}) folder '${folder}' | ` +
    `sheet ${sheetNote} | path used ${pathUsed}`
  )
}

/** Dev: log when condition 7 lands on a stack (combat log, dev tools on). */
export function devLogPolymorphConditionGained(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): void {
  if (!devToolsEnabled()) {
    return
  }
  appendBattleAnimCombatLog(
    buildDevPolymorphLine(stack, catalog, '(pending)', null),
  )
}

export type PolymorphPaintPath =
  | 'battle sheet'
  | 'static Stand'
  | 'unit art'

export function devLogPolymorphPaintOnce(
  stack: CombatStack,
  catalog: ReferenceCatalog,
  pathUsed: PolymorphPaintPath,
  polymorphBattleSheet: BattleUnitSheetSet | null | undefined,
): void {
  if (!devToolsEnabled()) {
    return
  }
  const fingerprint = Object.entries(stack.conditions ?? {})
    .filter(([, left]) => (left ?? 0) > 0)
    .map(([id, left]) => `${id}:${left}`)
    .sort()
    .join('|')
  const key = `${stack.id}:${fingerprint}:${pathUsed}`
  if (paintLogged.has(key)) {
    return
  }
  paintLogged.add(key)
  appendBattleAnimCombatLog(
    buildDevPolymorphLine(stack, catalog, pathUsed, polymorphBattleSheet),
  )
}

export function stackHasPolymorphCondition(
  stack: CombatStack,
  catalog: ReferenceCatalog,
): boolean {
  if (isPolymorphed(stack, catalog)) {
    return true
  }
  for (const [rawId, left] of Object.entries(stack.conditions ?? {})) {
    if ((left ?? 0) <= 0) {
      continue
    }
    const id = Number(rawId)
    if (
      id === 7 ||
      (Number.isInteger(id) &&
        conditionName(catalog, id).trim().toLowerCase() === 'polymorph')
    ) {
      return true
    }
  }
  return false
}