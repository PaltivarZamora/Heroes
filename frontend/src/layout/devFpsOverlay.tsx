import { useEffect } from 'react'
import { devToolsEnabled } from '../settings/playerSettings'

function mountDevFpsOverlay(): () => void {
  if (!devToolsEnabled()) {
    return () => {}
  }
  const host =
    document.querySelector('.game-window') ??
    document.querySelector('.game-stage')
  if (!host) {
    return () => {}
  }
  const el = document.createElement('div')
  el.className = 'dev-fps-counter'
  el.setAttribute('aria-hidden', 'true')
  el.textContent = '… FPS'
  host.appendChild(el)

  let rafId = 0
  let running = true
  let lastFrameMs = 0
  let accMs = 0
  let frameCount = 0
  let lastPaintMs = 0

  const tick = (now: number) => {
    if (!running) {
      return
    }
    if (lastFrameMs > 0) {
      accMs += now - lastFrameMs
      frameCount += 1
    }
    lastFrameMs = now
    if (now - lastPaintMs >= 500 && frameCount > 0) {
      el.textContent = `${Math.round((frameCount * 1000) / accMs)} FPS`
      accMs = 0
      frameCount = 0
      lastPaintMs = now
    }
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)

  return () => {
    running = false
    cancelAnimationFrame(rafId)
    el.remove()
  }
}

/** Dev-only FPS label; updates via rAF + textContent (no React state). */
export function DevFpsOverlay() {
  useEffect(() => mountDevFpsOverlay(), [])
  return null
}
