const PAD = 8

export type ClientRect = {
  left: number
  top: number
  right: number
  bottom: number
}

/** Clamp bounds for tooltips anchored inside `.game-window` (not the left panel). */
export function gameWindowTipInnerRect(anchor: HTMLElement): ClientRect | null {
  const gameWindow = anchor.closest('.game-window')
  if (!(gameWindow instanceof HTMLElement) || !gameWindow.contains(anchor)) {
    return null
  }
  if (anchor.closest('.game-left-panel')) {
    return null
  }
  const box = gameWindow.getBoundingClientRect()
  return {
    left: box.left + PAD,
    top: box.top + PAD,
    right: box.right - PAD,
    bottom: box.bottom - PAD,
  }
}

export function clampBoxInRect(
  left: number,
  top: number,
  width: number,
  height: number,
  inner: ClientRect,
): { left: number; top: number } {
  let x = left
  let y = top
  if (x + width > inner.right) {
    x = inner.right - width
  }
  if (x < inner.left) {
    x = inner.left
  }
  if (y + height > inner.bottom) {
    y = inner.bottom - height
  }
  if (y < inner.top) {
    y = inner.top
  }
  return { left: x, top: y }
}

/** Position a tip inside `hostEl` from pointer coords; keep inside the game window. */
export function positionWorldTipInGameWindow(
  tipEl: HTMLElement,
  hostEl: HTMLElement,
  clientX: number,
  clientY: number,
  offsetX = 14,
  offsetY = 14,
): void {
  const hostBox = hostEl.getBoundingClientRect()
  tipEl.style.left = `${clientX - hostBox.left + offsetX}px`
  tipEl.style.top = `${clientY - hostBox.top + offsetY}px`
  tipEl.hidden = false
  const inner = gameWindowTipInnerRect(hostEl)
  if (!inner) {
    return
  }
  const tip = tipEl.getBoundingClientRect()
  const next = clampBoxInRect(tip.left, tip.top, tip.width, tip.height, inner)
  if (next.left !== tip.left || next.top !== tip.top) {
    tipEl.style.left = `${next.left - hostBox.left}px`
    tipEl.style.top = `${next.top - hostBox.top}px`
  }
}
