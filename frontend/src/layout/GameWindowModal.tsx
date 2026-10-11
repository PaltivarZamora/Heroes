import type { MouseEvent, ReactNode } from 'react'

type GameWindowModalProps = {
  children: ReactNode
  /** Click backdrop to dismiss (optional). */
  onBackdropClick?: (event: MouseEvent<HTMLDivElement>) => void
  role?: string
  'aria-modal'?: boolean | 'true' | 'false'
  'aria-labelledby'?: string
  'aria-label'?: string
  'aria-live'?: 'polite' | 'assertive' | 'off'
  className?: string
}

/**
 * Centred overlay inside the 1273×840 game window (not the browser viewport).
 * Parent must be `.game-window` or another positioned game-window embed.
 */
export function GameWindowModal({
  children,
  onBackdropClick,
  role = 'dialog',
  className,
  ...aria
}: GameWindowModalProps) {
  return (
    <div
      className={`game-window-modal${className ? ` ${className}` : ''}`}
      role={role}
      onClick={onBackdropClick}
      {...aria}
    >
      <div
        className="game-window-modal-card date-notice-card"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
