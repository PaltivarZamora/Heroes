let upgradeAllHandler: (() => void) | null = null
let popupOpen = false

export function setArmyUpgradeAllHandler(handler: (() => void) | null): void {
  upgradeAllHandler = handler
}

export function runArmyUpgradeAllKeybind(): boolean {
  if (!upgradeAllHandler) {
    return false
  }
  upgradeAllHandler()
  return true
}

export function setArmyPopupOpen(open: boolean): void {
  popupOpen = open
}

export function isArmyPopupOpen(): boolean {
  return popupOpen
}

let confirmHandler: (() => boolean) | null = null

export function setArmyConfirmHandler(handler: (() => boolean) | null): void {
  confirmHandler = handler
}

/** popup_confirm while army split / confirm is open */
export function runArmyConfirmPopup(): boolean {
  if (!confirmHandler) {
    return false
  }
  return confirmHandler()
}
