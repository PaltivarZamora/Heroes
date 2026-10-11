import { useEffect, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
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

function maybeTip(
  description: string | null | undefined,
  child: ReactNode,
  placement?: 'default' | 'beside-right' | 'beside-left',
) {
  if (!description) {
    return child
  }
  return (
    <AbilityTip description={description} placement={placement ?? 'default'}>
      {child}
    </AbilityTip>
  )
}

export type ArmySlotActions = {
  canUpgrade?: boolean
  canSplit?: boolean
  upgradeTip?: string
  splitTip?: string
  onUpgrade?: () => void
  onSplit?: () => void
}

export function ArmyRow({
  row,
  heroId,
  portraitLabel,
  portraitFilename,
  armyStacks,
  portraitTip,
  slotTip,
  slotActions,
  onSlotPointerDown,
  onEmptySlotPointerDown,
  onPortraitClick,
  portraitUpgrade,
  trailingSlot,
  orientation = 'horizontal',
  showPortrait = true,
  padSlotsTo,
  portraitOverlay,
  evenlyPickHighlight,
}: {
  row: ArmyRowId
  heroId?: string | null
  portraitLabel: string
  portraitFilename: string | null
  armyStacks: UnitStackView[]
  portraitTip?: string | null
  slotTip?: (slot: number, stack: UnitStackView) => string | null
  slotActions?: (slot: number, stack: UnitStackView) => ArmySlotActions
  onSlotPointerDown?: (slot: number, event: ReactPointerEvent) => void
  onEmptySlotPointerDown?: (slot: number, event: ReactPointerEvent) => void
  onPortraitClick?: () => void
  portraitUpgrade?: { show: boolean; tip?: string; onClick: () => void }
  trailingSlot?: ReactNode
  orientation?: 'horizontal' | 'vertical'
  showPortrait?: boolean
  padSlotsTo?: number
  portraitOverlay?: ReactNode
  evenlyPickHighlight?: boolean
}) {
  const portrait = <PortraitFace label={portraitLabel} filename={portraitFilename} />
  const portraitInner = (
    <>
      {portrait}
      {portraitOverlay ? (
        <span className="game-hero-steps-overlay">{portraitOverlay}</span>
      ) : null}
      {portraitUpgrade?.show ? (
        <button
          type="button"
          className="army-slot-btn army-slot-btn-upgrade army-portrait-upgrade"
          aria-label="Upgrade all"
          title={portraitUpgrade.tip ?? 'Upgrade all'}
          onClick={(event) => {
            event.stopPropagation()
            portraitUpgrade.onClick()
          }}
        >
          ↑
        </button>
      ) : null}
    </>
  )
  const portraitBox = onPortraitClick ? (
    <button
      type="button"
      className="town-army-box town-army-portrait"
      data-portrait={row}
      data-hero-id={heroId ?? undefined}
      aria-label={portraitLabel}
      onClick={onPortraitClick}
    >
      {portraitInner}
    </button>
  ) : (
    <div
      className="town-army-box town-army-portrait"
      data-portrait={row}
      data-hero-id={heroId ?? undefined}
      aria-label={portraitLabel}
    >
      {portraitInner}
    </div>
  )
  const padCount =
    padSlotsTo != null
      ? Math.max(
          0,
          padSlotsTo -
            armyStacks.length -
            (showPortrait ? 1 : 0) -
            (trailingSlot ? 1 : 0),
        )
      : 0

  return (
    <div
      className={
        orientation === 'vertical'
          ? 'town-army-row town-army-row-vertical'
          : 'town-army-row'
      }
    >
      {showPortrait ? maybeTip(portraitTip, portraitBox) : null}
      {armyStacks.map((stack, index) => {
        const slot = index + 1
        const tip = slotTip?.(slot, stack) ?? null
        const actions = slotActions?.(slot, stack)
        const face = <UnitStackFace {...stack} />
        const box = (
          <button
            type="button"
            className={`town-army-box town-army-slot${evenlyPickHighlight && stack.empty ? ' army-evenly-pick' : ''}`}
            data-row={row}
            data-slot={slot}
            data-hero-id={heroId ?? undefined}
            onPointerDown={(event) => {
              if (stack.empty) {
                onEmptySlotPointerDown?.(slot, event)
                return
              }
              onSlotPointerDown?.(slot, event)
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            {face}
            {!stack.empty && actions?.canUpgrade ? (
              <button
                type="button"
                className="army-slot-btn army-slot-btn-upgrade"
                aria-label="Upgrade stack"
                title={actions.upgradeTip ?? 'Upgrade'}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  actions.onUpgrade?.()
                }}
              >
                ↑
              </button>
            ) : null}
            {!stack.empty && actions?.canSplit ? (
              <button
                type="button"
                className="army-slot-btn army-slot-btn-split"
                aria-label="Split stack"
                title={actions.splitTip ?? 'Split'}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation()
                  actions.onSplit?.()
                }}
              >
                ⇆
              </button>
            ) : null}
          </button>
        )
        return (
          <span key={index} className="town-army-slot-tip-wrap">
            {maybeTip(tip, box, 'beside-right')}
          </span>
        )
      })}
      {Array.from({ length: padCount }, (_, index) => (
        <div
          key={`pad-${index}`}
          className="town-army-box town-army-slot town-army-slot-static town-army-slot-pad"
          aria-hidden={true}
        />
      ))}
      {trailingSlot}
    </div>
  )
}
