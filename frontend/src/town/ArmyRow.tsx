import { useEffect, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { ArmyRowId } from '../session/accessors'
import { heroPortraitUrl } from './slotArt'
import { UnitStackFace, type UnitStackView } from './unitStack'

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

export function ArmyRow({
  row,
  heroId,
  portraitLabel,
  portraitFilename,
  armyStacks,
  onSlotPointerDown,
  onSlotContextMenu,
  onPortraitClick,
}: {
  row: ArmyRowId
  heroId?: string | null
  portraitLabel: string
  portraitFilename: string | null
  armyStacks: UnitStackView[]
  onSlotPointerDown?: (slot: number, event: ReactPointerEvent) => void
  onSlotContextMenu?: (slot: number, event: ReactMouseEvent) => void
  onPortraitClick?: () => void
}) {
  const portrait = <PortraitFace label={portraitLabel} filename={portraitFilename} />
  const interactive = onSlotPointerDown != null || onSlotContextMenu != null
  return (
    <div className="town-army-row">
      {onPortraitClick ? (
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
      )}
      {armyStacks.map((stack, index) =>
        interactive ? (
          <button
            key={index}
            type="button"
            className="town-army-box town-army-slot"
            data-row={row}
            data-slot={index + 1}
            data-hero-id={heroId ?? undefined}
            onPointerDown={(event) => onSlotPointerDown?.(index + 1, event)}
            onContextMenu={(event) => onSlotContextMenu?.(index + 1, event)}
          >
            <UnitStackFace {...stack} />
          </button>
        ) : (
          <div
            key={index}
            className="town-army-box town-army-slot town-army-slot-static"
          >
            <UnitStackFace {...stack} />
          </div>
        ),
      )}
    </div>
  )
}
