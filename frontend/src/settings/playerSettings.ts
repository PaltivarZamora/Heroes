import { getCachedCatalog } from '../town/catalog'
import { appConfigNumber } from '../town/catalog'

const STORAGE_KEY = 'heroes.playerSettings.v1'
const KEYBIND_OVERRIDES_KEY = 'heroes.keybindOverrides.v1'

export type PlayerSettings = {
  confirmEndTurn: boolean
  confirmUpgrade: boolean
  confirmUpgradeAll: boolean
  volumeMusic: number
  volumeEffects: number
  volumeUi: number
  combatEndTimerSec: number | null
  combatLogTimerSec: number | null
  fullscreenPreferred: boolean
  hexScale: string | null
}

function defaultFromCatalog(): PlayerSettings {
  const catalog = getCachedCatalog()
  return {
    confirmEndTurn: appConfigNumber(catalog, 'setting_confirm_end_turn', 1) !== 0,
    confirmUpgrade: appConfigNumber(catalog, 'setting_confirm_upgrade', 1) !== 0,
    confirmUpgradeAll:
      appConfigNumber(catalog, 'setting_confirm_upgrade_all', 1) !== 0,
    volumeMusic: Math.min(
      100,
      Math.max(0, appConfigNumber(catalog, 'setting_volume_music', 80)),
    ),
    volumeEffects: Math.min(
      100,
      Math.max(0, appConfigNumber(catalog, 'setting_volume_effects', 80)),
    ),
    volumeUi: Math.min(
      100,
      Math.max(0, appConfigNumber(catalog, 'setting_volume_ui', 80)),
    ),
    combatEndTimerSec: null,
    combatLogTimerSec: null,
    fullscreenPreferred: false,
    hexScale: null,
  }
}

export function loadPlayerSettings(): PlayerSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return defaultFromCatalog()
    }
    const parsed = JSON.parse(raw) as Partial<PlayerSettings>
    return { ...defaultFromCatalog(), ...parsed }
  } catch {
    return defaultFromCatalog()
  }
}

export function savePlayerSettings(next: PlayerSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

export function loadKeybindOverrides(): Record<string, { key: string; altKey?: string | null }> {
  try {
    const raw = localStorage.getItem(KEYBIND_OVERRIDES_KEY)
    if (!raw) {
      return {}
    }
    return JSON.parse(raw) as Record<string, { key: string; altKey?: string | null }>
  } catch {
    return {}
  }
}

export function saveKeybindOverrides(
  overrides: Record<string, { key: string; altKey?: string | null }>,
): void {
  localStorage.setItem(KEYBIND_OVERRIDES_KEY, JSON.stringify(overrides))
}

export function clearKeybindOverrides(): void {
  localStorage.removeItem(KEYBIND_OVERRIDES_KEY)
}

let warnedMissingDevTools = false

export function devToolsEnabled(): boolean {
  const catalog = getCachedCatalog()
  const fromDb = appConfigNumber(catalog, 'dev_tools', -1)
  if (fromDb < 0) {
    if (!warnedMissingDevTools) {
      warnedMissingDevTools = true
      console.warn(
        '[app_config] Missing dev_tools; treating as off (dev keybind disabled).',
      )
    }
    return false
  }
  return fromDb !== 0
}

/** Player override or catalog combat_config / app_config defaults. */
export function effectiveCombatEndTimerSec(): number {
  const settings = loadPlayerSettings()
  if (settings.combatEndTimerSec != null) {
    return settings.combatEndTimerSec
  }
  const catalog = getCachedCatalog()
  return Math.max(
    0,
    Math.floor(appConfigNumber(catalog, 'combat_end_timer', 99)),
  )
}

export function effectiveCombatLogTimerSec(): number {
  const settings = loadPlayerSettings()
  if (settings.combatLogTimerSec != null) {
    return settings.combatLogTimerSec
  }
  const catalog = getCachedCatalog()
  return Math.max(
    0,
    Math.floor(appConfigNumber(catalog, 'combat_log_timer', 2)),
  )
}
