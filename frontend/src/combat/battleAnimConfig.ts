import type { GameSession } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import type { BattleHitDirection, BattleHitReactionRow } from '../town/catalog'
import { getBattleHitReactionLoadStatus } from '../town/catalog'
import {
  nonNegativeAnimConfig,
  positiveAnimConfig,
  animConfigRaw,
} from '../config/animConfig'
import { isFootprintCode, type FootprintCode } from './footprint'
import { appendLogEntry, logViewPlayerId } from '../session/gameLog'
import { appendBattleAnimCombatLog } from './battleAnimLogBridge'
import type { UnitRow } from '../town/catalog'

const BATTLE_IDLE_FPS_KEY = 'battle_idle_fps'
const BATTLE_MOVE_FPS_KEY = 'battle_move_fps'
const DEFAULT_BATTLE_IDLE_FPS = 18
const DEFAULT_BATTLE_MOVE_FPS = 18

export type BattleAnimSettings = {
  spriteScalePct: number
  /** Null → no max-width cap (warn once if anim_config missing). */
  spriteMaxWidthPct: number | null
  footOffsetPct: number
  /** Ground effect display width as % of one hex width (uniform scale). */
  groundEffectWidthPct: number
  idleFps: number
  moveFps: number
  moveSecPerHex: number
  attackSec: number
  hitSec: number
  dieSec: number
  projectileHexPerSec: number
}

/** battle_idle_fps: Idle only; battle_move_fps: Move, Attack, Hit, Die, and effects. */
export function battleUnitSheetFps(
  settings: BattleAnimSettings,
  kind: import('./battleUnitSheet').BattleUnitAnimKind | 'idle',
): number {
  if (kind === 'Idle' || kind === 'idle') {
    return settings.idleFps
  }
  return settings.moveFps
}

function configuredBattleIdleFps(
  catalog: ReferenceCatalog | null | undefined,
): number {
  const v = positiveAnimConfig(catalog, BATTLE_IDLE_FPS_KEY)
  if (v == null && !warnedKeys.has(BATTLE_IDLE_FPS_KEY)) {
    warnedKeys.add(BATTLE_IDLE_FPS_KEY)
    appendBattleAnimCombatLog(
      `[Dev] [anim_config] ${BATTLE_IDLE_FPS_KEY} missing or invalid — using ${DEFAULT_BATTLE_IDLE_FPS}.`,
    )
  }
  return v ?? DEFAULT_BATTLE_IDLE_FPS
}

function configuredBattleMoveFps(
  catalog: ReferenceCatalog | null | undefined,
): number {
  const v = positiveAnimConfig(catalog, BATTLE_MOVE_FPS_KEY)
  if (v == null && !warnedKeys.has(BATTLE_MOVE_FPS_KEY)) {
    warnedKeys.add(BATTLE_MOVE_FPS_KEY)
    appendBattleAnimCombatLog(
      `[Dev] [anim_config] ${BATTLE_MOVE_FPS_KEY} missing or invalid — using ${DEFAULT_BATTLE_MOVE_FPS}.`,
    )
  }
  return v ?? DEFAULT_BATTLE_MOVE_FPS
}

export type BattleIdleSettings = {
  enabled: boolean
  breathPct: number
  bobPct: number
  driftPct: number
  periodSec: number
}

const warnedKeys = new Set<string>()
const devWarnings: string[] = []

function warnOnce(
  session: GameSession,
  key: string,
  message: string,
): GameSession {
  if (warnedKeys.has(key)) {
    return session
  }
  warnedKeys.add(key)
  return appendBattleAnimWorldLog(session, message)
}

/** Always-on world log + Dev copy buffer (not the live combat transcript). */
export function appendBattleAnimWorldLog(
  session: GameSession,
  message: string,
): GameSession {
  devWarnings.push(message)
  return appendLogEntry(session, logViewPlayerId(session), 'world', 'battle_anim', {
    message,
  })
}

export function battleAnimDevWarnings(): string[] {
  return devWarnings
}

/** Dev-only: one line per Hit/Die reaction on the Combat log tab. */
export function logBattleReactionTest(
  session: GameSession,
  message: string,
): GameSession {
  appendBattleAnimCombatLog(message)
  return session
}

export function battleAnimSettings(
  catalog: ReferenceCatalog | null | undefined,
): BattleAnimSettings {
  return {
    spriteScalePct: positiveAnimConfig(catalog, 'battle_sprite_scale_pct') ?? 100,
    spriteMaxWidthPct: positiveAnimConfig(
      catalog,
      'battle_sprite_max_width_pct',
    ),
    moveSecPerHex:
      positiveAnimConfig(catalog, 'battle_move_sec_per_hex') ?? 0.2,
    idleFps: configuredBattleIdleFps(catalog),
    moveFps: configuredBattleMoveFps(catalog),
    attackSec: positiveAnimConfig(catalog, 'battle_attack_sec') ?? 1,
    hitSec: positiveAnimConfig(catalog, 'battle_hit_sec') ?? 0.5,
    dieSec: positiveAnimConfig(catalog, 'battle_die_sec') ?? 1.5,
    footOffsetPct:
      nonNegativeAnimConfig(catalog, 'battle_foot_offset_pct') ?? 30,
    groundEffectWidthPct:
      positiveAnimConfig(catalog, 'ground_effect_width_pct') ?? 100,
    projectileHexPerSec:
      positiveAnimConfig(catalog, 'battle_projectile_hex_per_sec') ?? 12,
  }
}

/** Battlefield move slide timing for one stack (unit override or global anim_config). */
export function battleMoveSecPerHexForUnit(
  unit: UnitRow | null | undefined,
  catalog: ReferenceCatalog | null | undefined,
): number {
  const per = unit?.move_sec_per_hex
  if (per != null && per > 0) {
    return per
  }
  return battleAnimSettings(catalog).moveSecPerHex
}

const BATTLE_HERO_FOOTPRINT_KEY = 'battle_hero_footprint'
const HERO_MOUNT_FOOTPRINT_DEFAULT: FootprintCode = '2x1'

/** Visual footprint for hero mount art (anchor column hex; extra hexes outward / up only). */
export function battleHeroMountFootprint(
  catalog: ReferenceCatalog | null | undefined,
): FootprintCode {
  const raw = animConfigRaw(catalog, BATTLE_HERO_FOOTPRINT_KEY)
  if (raw == null || !raw.trim()) {
    if (!warnedKeys.has(BATTLE_HERO_FOOTPRINT_KEY)) {
      warnedKeys.add(BATTLE_HERO_FOOTPRINT_KEY)
      appendBattleAnimCombatLog(
        `[anim_config] ${BATTLE_HERO_FOOTPRINT_KEY} missing or invalid — using ${HERO_MOUNT_FOOTPRINT_DEFAULT}.`,
      )
    }
    return HERO_MOUNT_FOOTPRINT_DEFAULT
  }
  const code = raw.trim().toLowerCase()
  if (isFootprintCode(code)) {
    return code
  }
  if (!warnedKeys.has(BATTLE_HERO_FOOTPRINT_KEY)) {
    warnedKeys.add(BATTLE_HERO_FOOTPRINT_KEY)
    appendBattleAnimCombatLog(
      `[anim_config] ${BATTLE_HERO_FOOTPRINT_KEY} invalid (${raw.trim()}) — using ${HERO_MOUNT_FOOTPRINT_DEFAULT}.`,
    )
  }
  return HERO_MOUNT_FOOTPRINT_DEFAULT
}

const POLYMORPH_STEM_KEY = 'polymorph_stem'
const POLYMORPH_TOWN_ID_KEY = 'polymorph_town_id'

export type PolymorphBattleArtConfig = {
  stem: string
  townFolder: string
}

/** Polymorph battlefield + stack still (`{stem}_Stand.png` under the town units folder). */
export function polymorphBattleArtConfig(
  catalog: ReferenceCatalog | null | undefined,
): PolymorphBattleArtConfig | null {
  const stem = animConfigRaw(catalog, POLYMORPH_STEM_KEY)?.trim()
  const townId = positiveAnimConfig(catalog, POLYMORPH_TOWN_ID_KEY)
  if (!stem || townId == null) {
    return null
  }
  const town = catalog?.town.find((row) => row.id === townId)
  const townFolder = town?.name?.trim()
  if (!townFolder) {
    return null
  }
  return { stem, townFolder }
}

export function polymorphStandFilename(stem: string): string {
  return `${stem}_Stand.png`
}

const BATTLE_IDLE_CONFIG_KEY = 'battle_idle_config'
const BATTLE_HIT_CONFIG_KEY = 'battle_hit_config'

export type BattleHitSettings = {
  enabled: boolean
  byDirection: Map<BattleHitDirection, BattleHitReactionRow>
}

export function battleHitSettings(
  catalog: ReferenceCatalog | null | undefined,
): BattleHitSettings {
  const byDirection = new Map<BattleHitDirection, BattleHitReactionRow>()
  for (const row of catalog?.battle_hit_reaction ?? []) {
    byDirection.set(row.direction, row)
  }
  return {
    enabled: byDirection.has('level'),
    byDirection,
  }
}

export function ensureBattleHitConfigWarnings(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
): GameSession {
  if (battleHitSettings(catalog).enabled) {
    return session
  }
  if (warnedKeys.has(BATTLE_HIT_CONFIG_KEY)) {
    return session
  }
  const detail = getBattleHitReactionLoadStatus().message
  return warnOnce(session, BATTLE_HIT_CONFIG_KEY, detail)
}

export function battleIdleSettings(
  catalog: ReferenceCatalog | null | undefined,
): BattleIdleSettings {
  const breathPct = nonNegativeAnimConfig(catalog, 'battle_idle_breath_pct')
  const bobPct = nonNegativeAnimConfig(catalog, 'battle_idle_bob_pct')
  const driftPct = nonNegativeAnimConfig(catalog, 'battle_idle_drift_pct')
  const periodSec = positiveAnimConfig(catalog, 'battle_idle_period_sec')
  const enabled =
    breathPct != null &&
    bobPct != null &&
    driftPct != null &&
    periodSec != null
  return {
    enabled,
    breathPct: breathPct ?? 0,
    bobPct: bobPct ?? 0,
    driftPct: driftPct ?? 0,
    periodSec: periodSec ?? 3,
  }
}

export function ensureBattleIdleConfigWarnings(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
): GameSession {
  if (battleIdleSettings(catalog).enabled) {
    return session
  }
  if (warnedKeys.has(BATTLE_IDLE_CONFIG_KEY)) {
    return session
  }
  return warnOnce(
    session,
    BATTLE_IDLE_CONFIG_KEY,
    '[anim_config] battle idle config missing or invalid — procedural idle motion disabled.',
  )
}

export function ensureBattleAnimConfigWarnings(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
): GameSession {
  let next = session
  const keys: { key: string; ok: boolean; label: string }[] = [
    {
      key: 'battle_sprite_scale_pct',
      ok: positiveAnimConfig(catalog, 'battle_sprite_scale_pct') != null,
      label: 'battle_sprite_scale_pct',
    },
    {
      key: 'battle_sprite_max_width_pct',
      ok:
        positiveAnimConfig(catalog, 'battle_sprite_max_width_pct') != null,
      label: 'battle_sprite_max_width_pct',
    },
    {
      key: 'battle_foot_offset_pct',
      ok: nonNegativeAnimConfig(catalog, 'battle_foot_offset_pct') != null,
      label: 'battle_foot_offset_pct',
    },
    {
      key: 'ground_effect_width_pct',
      ok: positiveAnimConfig(catalog, 'ground_effect_width_pct') != null,
      label: 'ground_effect_width_pct',
    },
    {
      key: BATTLE_IDLE_FPS_KEY,
      ok: positiveAnimConfig(catalog, BATTLE_IDLE_FPS_KEY) != null,
      label: BATTLE_IDLE_FPS_KEY,
    },
    {
      key: BATTLE_MOVE_FPS_KEY,
      ok: positiveAnimConfig(catalog, BATTLE_MOVE_FPS_KEY) != null,
      label: BATTLE_MOVE_FPS_KEY,
    },
    {
      key: 'battle_move_sec_per_hex',
      ok: positiveAnimConfig(catalog, 'battle_move_sec_per_hex') != null,
      label: 'battle_move_sec_per_hex',
    },
    {
      key: 'battle_attack_sec',
      ok: positiveAnimConfig(catalog, 'battle_attack_sec') != null,
      label: 'battle_attack_sec',
    },
    {
      key: 'battle_hit_sec',
      ok: positiveAnimConfig(catalog, 'battle_hit_sec') != null,
      label: 'battle_hit_sec',
    },
    {
      key: 'battle_die_sec',
      ok: positiveAnimConfig(catalog, 'battle_die_sec') != null,
      label: 'battle_die_sec',
    },
    {
      key: 'battle_projectile_hex_per_sec',
      ok: positiveAnimConfig(catalog, 'battle_projectile_hex_per_sec') != null,
      label: 'battle_projectile_hex_per_sec',
    },
  ]
  for (const row of keys) {
    if (!row.ok && !warnedKeys.has(row.key)) {
      const message =
        row.key === 'battle_sprite_max_width_pct'
          ? `[anim_config] ${row.label} missing or invalid — battle animation applies no max sprite width cap.`
          : `[anim_config] ${row.label} missing or invalid — battle animation uses built-in defaults for that part.`
      next = warnOnce(next, row.key, message)
    }
  }
  return next
}

/** Foot Y on a 1×1 hex floor anchor (same fixed half-hex gap as stackArtBoxFoot). */
export function combatFootY(floorY: number, hexPx: number, footOffsetPct: number): number {
  const bottomY = floorY
  return bottomY - (hexPx / 2) * ((100 - footOffsetPct) / 100)
}

/** 1×1 rest height: one hex + (scalePct − 100)% of one hex. */
export function combatSpriteScale(
  hexPx: number,
  restHeight: number,
  spriteScalePct: number,
): number {
  if (restHeight < 1) {
    return 1
  }
  const targetRest = hexPx + hexPx * ((spriteScalePct - 100) / 100)
  return targetRest / restHeight
}
