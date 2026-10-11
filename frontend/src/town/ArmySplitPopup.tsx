import { useEffect, useRef, type WheelEvent } from 'react'
import { createPortal } from 'react-dom'
import { formatAmount } from '../hex/resources'
import { GameWindowModal } from '../layout/GameWindowModal'
import { GameWindowOverlay } from '../layout/GameWindowOverlay'

export function ArmySplitPopup({
  open,
  unitName,
  stackQty,
  qty,
  onQtyChange,
  onPickUp,
  onHalf,
  onEvenly,
  onCancel,
}: {
  open: boolean
  unitName: string
  stackQty: number
  qty: number
  onQtyChange: (qty: number) => void
  onPickUp: () => void
  onHalf: () => void
  onEvenly: () => void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const maxQty = Math.max(1, stackQty - 1)

  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    }
  }, [open])

  if (!open) {
    return null
  }

  const clamp = (value: number) =>
    Math.min(maxQty, Math.max(1, Math.floor(value)))

  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const delta = event.deltaY < 0 ? 1 : -1
    onQtyChange(clamp(qty + delta))
  }

  const host = document.querySelector('.game-stage')
  if (!host) {
    return null
  }

  return createPortal(
    <GameWindowOverlay>
      <GameWindowModal
        aria-label="Split stack"
        onBackdropClick={onCancel}
      >
        <div className="army-split-popup-body">
          <p className="army-split-popup-title">
            {unitName} <span>({formatAmount(stackQty)})</span>
          </p>
          <div className="army-split-popup-qty">
            <span>Qty</span>
            <button
              type="button"
              className="army-split-qty-step"
              aria-label="Decrease"
              onClick={() => onQtyChange(clamp(qty - 1))}
            >
              ▼
            </button>
            <input
              ref={inputRef}
              type="number"
              className="army-split-qty-input"
              min={1}
              max={maxQty}
              value={qty}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10)
                onQtyChange(Number.isFinite(parsed) ? clamp(parsed) : 1)
              }}
              onWheel={onWheel}
            />
            <button
              type="button"
              className="army-split-qty-step"
              aria-label="Increase"
              onClick={() => onQtyChange(clamp(qty + 1))}
            >
              ▲
            </button>
          </div>
          <div className="army-split-popup-actions">
            <button type="button" onClick={onPickUp}>Pick Up</button>
            <button type="button" onClick={onHalf}>Half</button>
            <button type="button" onClick={onEvenly}>Evenly</button>
            <button type="button" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </GameWindowModal>
    </GameWindowOverlay>,
    host,
  )
}
