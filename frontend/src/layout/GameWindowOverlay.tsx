import type { ReactNode } from 'react'

/**
 * Fills the game window above world / town / battle / map views (z-index 50).
 * Children (e.g. GameWindowModal) receive pointer events.
 */
export function GameWindowOverlay({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`game-window-embed game-window-overlay-host${className ? ` ${className}` : ''}`}
    >
      {children}
    </div>
  )
}
