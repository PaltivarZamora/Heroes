import { useEffect, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { ArmyRowId } from '../session/accessors'
import { heroPortraitUrl } from './slotArt'
import { UnitStackFace, type UnitStackView } from './unitStack'
import { AbilityTip } from './AbilityTip'

export function PortraitFace({
  label,
  filename,
}: {
  label: string
  filename: string | null
}) {
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    setMissing(false)
  }, [filename])
  if (!filename) {
    return label
  }
  if (missing) {
    return <span className="town-building-slot-filename">{filename}</span>
  }
  return (
    <img
      src={heroPortraitUrl(filename)}
      alt={label}
      onError={() => setMissing(true)}
    />
  )
}

function maybeTip(description: string | null | undefined, child: ReactNode) {
  if (!description) {
    return child
  }
  return <AbilityTip description={description}>{child}</AbilityTip>
}

export function ArmyRow({
  row,
  heroId,
  portraitLabel,
  portraitFilename,
  armyStacks,
  portraitTip,
  slotTip,
  onSlotPointerDown,
  onSlotContextMenu,
  onPortraitClick,
}: {
  row: ArmyRowId
  heroId?: string | null
  portraitLabel: string
  portraitFilename: string | null
  armyStacks: UnitStackView[]
  /** Shared Hero / Garrison mouseover text. */
  portraitTip?: string | null
  /** Per-slot unit toolkit tip (1-based slot → text). */
  slotTip?: (slot: number, stack: UnitStackView) => string | null
  onSlotPointerDown?: (slot: number, event: ReactPointerEvent) => void
  onSlotContextMenu?: (slot: number, event: ReactMouseEvent) => void
  onPortraitClick?: () => void
}) {
  const portrait = <PortraitFace label={portraitLabel} filename={portraitFilename} />
  const interactive = onSlotPointerDown != null || onSlotContextMenu != null
  const portraitBox = onPortraitClick ? (
    <button
      type="button"
      className="town-army-box town-army-portrait"
      data-portrait={row}
      aria-label={portraitLabel}
      onClick={onPortraitClick}
    >
      {portrait}
    </button>
  ) : (
    <div
      className="town-army-box town-army-portrait"
      data-portrait={row}
      aria-label={portraitLabel}
    >
      {portrait}
    </div>
  )
  return (
    <div className="town-army-row">
      {maybeTip(portraitTip, portraitBox)}
      {armyStacks.map((stack, index) => {
        const tip = slotTip?.(index + 1, stack) ?? null
        const face = <UnitStackFace {...stack} />
        const box = interactive ? (
          <button
            type="button"
            className="town-army-box town-army-slot"
            data-row={row}
            data-slot={index + 1}
            data-hero-id={heroId ?? undefined}
            onPointerDown={(event) => onSlotPointerDown?.(index + 1, event)}
            onContextMenu={(event) => onSlotContextMenu?.(index + 1, event)}
          >
            {face}
          </button>
        ) : (
          <div
            className="town-army-box town-army-slot town-army-slot-static"
          >
            {face}
          </div>
        )
        return (
          <span key={index} className="town-army-slot-tip-wrap">
            {maybeTip(tip, box)}
          </span>
        )
      })}
    </div>
  )
}
