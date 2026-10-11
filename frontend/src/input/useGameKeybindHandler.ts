import { useEffect } from 'react'
import { activeScopes, matchKeybindAction } from './keybindEngine'
import { getCombatKeyBridge } from './combatKeyBridge'
import { devToolsEnabled } from '../settings/playerSettings'
import { isArmyPopupOpen, runArmyUpgradeAllKeybind } from '../town/armyKeybindBridge'

export type KeybindUiContext = {
  popupOpen: boolean
  inBattle: boolean
  mapViewOpen: boolean
  townOpen: boolean
  heroOpen: boolean
  aiAnimating: boolean
  blockEndTurn?: boolean
}

export type KeybindActions = {
  onBack: () => void
  onConfirm: () => void
  onEndTurn: () => void
  onHeroScreen: () => void
  onTownScreen: () => void
  onNextActionable: (reverse: boolean) => void
  onMapView: () => void
  onQuestLog: () => void
  onGameLog: () => void
  onKeybinds: () => void
  onDevMenu: () => void
  onMainMenu: () => void
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }
  const el = target.closest('input, textarea, select, [contenteditable="true"]')
  return el != null
}

export function useGameKeybindHandler(
  context: KeybindUiContext,
  actions: KeybindActions,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) {
      return
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return
      }
      if (isEditableTarget(event.target)) {
        return
      }
      if (context.aiAnimating && !context.inBattle) {
        return
      }
      const scopes = activeScopes({
        popupOpen: context.popupOpen,
        inBattle: context.inBattle,
        mapViewOpen: context.mapViewOpen,
        townOpen: context.townOpen,
        heroOpen: context.heroOpen,
      })
      const action = matchKeybindAction(event, scopes)
      if (!action) {
        return
      }
      if (event.repeat && action !== 'menu') {
        return
      }
      switch (action) {
        case 'menu':
          event.preventDefault()
          actions.onBack()
          return
        case 'upgrade_all':
          if (context.inBattle || context.popupOpen) {
            return
          }
          if (!context.townOpen && !context.heroOpen) {
            return
          }
          if (runArmyUpgradeAllKeybind()) {
            event.preventDefault()
          }
          return
        case 'popup_confirm':
          if (context.inBattle) {
            const handled = getCombatKeyBridge().confirmModal?.()
            if (handled) {
              event.preventDefault()
              return
            }
          }
          if (!context.popupOpen && !isArmyPopupOpen()) {
            return
          }
          event.preventDefault()
          actions.onConfirm()
          return
        case 'end_turn':
          if (context.popupOpen || context.inBattle || context.blockEndTurn) {
            return
          }
          event.preventDefault()
          actions.onEndTurn()
          return
        case 'hero_screen':
          if (context.inBattle || context.popupOpen) {
            return
          }
          event.preventDefault()
          actions.onHeroScreen()
          return
        case 'town_screen':
          if (context.inBattle || context.popupOpen) {
            return
          }
          event.preventDefault()
          actions.onTownScreen()
          return
        case 'next_actionable':
          if (context.inBattle) {
            event.preventDefault()
            return
          }
          event.preventDefault()
          actions.onNextActionable(event.shiftKey)
          return
        case 'map_view':
          if (context.inBattle || context.popupOpen) {
            return
          }
          event.preventDefault()
          actions.onMapView()
          return
        case 'quest_log':
          if (context.inBattle) {
            return
          }
          event.preventDefault()
          event.stopImmediatePropagation()
          actions.onQuestLog()
          return
        case 'log':
          event.preventDefault()
          event.stopImmediatePropagation()
          actions.onGameLog()
          return
        case 'keybinds':
          if (context.inBattle) {
            return
          }
          event.preventDefault()
          actions.onKeybinds()
          return
        case 'dev':
          if (!devToolsEnabled()) {
            return
          }
          event.preventDefault()
          actions.onDevMenu()
          return
        case 'skip_turn':
          if (!context.inBattle) {
            return
          }
          event.preventDefault()
          getCombatKeyBridge().skipUnitTurn?.()
          return
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [context, actions, enabled])
}
