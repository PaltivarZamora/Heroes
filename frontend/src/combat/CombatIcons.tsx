import type { TargetIconKind } from './target'

type IconProps = {
  kind: TargetIconKind
}

export function CombatTargetIcon({ kind }: IconProps) {
  if (kind === 'move') {
    return (
      <svg className="combat-target-svg" viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M8 14 L16 6 L24 14"
          fill="none"
          stroke="#fff59d"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M8 22 L16 14 L24 22"
          fill="none"
          stroke="#ffe082"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }
  if (kind === 'magic') {
    return (
      <svg className="combat-target-svg" viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="16" r="5" fill="#ffe082" />
        <path
          d="M16 2 L18 12 L16 10 L14 12 Z M30 16 L20 18 L22 16 L20 14 Z M16 30 L14 20 L16 22 L18 20 Z M2 16 L12 14 L10 16 L12 18 Z M26 6 L19 13 L21 12 L22 10 Z M26 26 L19 19 L21 20 L22 22 Z M6 26 L13 19 L11 20 L10 22 Z M6 6 L13 13 L11 12 L10 10 Z"
          fill="#ffeb3b"
        />
      </svg>
    )
  }
  if (kind === 'ranged') {
    return (
      <svg className="combat-target-svg" viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M6 6 Q22 16 6 26"
          fill="none"
          stroke="#eceff1"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path d="M4 16 H26" stroke="#ffcc80" strokeWidth="2" />
        <path d="M24 12 L30 16 L24 20 Z" fill="#ffcc80" />
      </svg>
    )
  }
  return (
    <svg className="combat-target-svg" viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="M8 26 L12 6 L15 7 L11 27 Z"
        fill="#b0bec5"
        transform="rotate(-32 16 16)"
      />
      <path
        d="M8 26 L12 6 L15 7 L11 27 Z"
        fill="#cfd8dc"
        transform="rotate(32 16 16)"
      />
      <circle cx="16" cy="16" r="2.2" fill="#ffe082" />
    </svg>
  )
}
