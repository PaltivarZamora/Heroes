import type { ReactNode } from 'react'

export function AbilityTip({
  description,
  children,
}: {
  description: string
  children: ReactNode
}) {
  if (!description) {
    return children
  }
  return (
    <span className="ability-tip">
      {children}
      <span className="ability-tip-body" role="tooltip">
        {description}
      </span>
    </span>
  )
}
