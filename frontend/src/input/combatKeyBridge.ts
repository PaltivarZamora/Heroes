/** Lets the central keybind handler invoke battle-only actions (Space skip, etc.). */
type CombatKeyBridge = {
  skipUnitTurn?: () => void
  dismissLog?: () => void
  showLog?: () => void
  /** Enter / confirm key while a combat modal is open. Returns true if handled. */
  confirmModal?: () => boolean
}

let bridge: CombatKeyBridge = {}

export function setCombatKeyBridge(next: CombatKeyBridge): void {
  bridge = next
}

export function getCombatKeyBridge(): CombatKeyBridge {
  return bridge
}
