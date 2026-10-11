let upgradeAllHandler = null;
let popupOpen = false;
export function setArmyUpgradeAllHandler(handler) {
    upgradeAllHandler = handler;
}
export function runArmyUpgradeAllKeybind() {
    if (!upgradeAllHandler) {
        return false;
    }
    upgradeAllHandler();
    return true;
}
export function setArmyPopupOpen(open) {
    popupOpen = open;
}
export function isArmyPopupOpen() {
    return popupOpen;
}
let confirmHandler = null;
export function setArmyConfirmHandler(handler) {
    confirmHandler = handler;
}
/** popup_confirm while army split / confirm is open */
export function runArmyConfirmPopup() {
    if (!confirmHandler) {
        return false;
    }
    return confirmHandler();
}
