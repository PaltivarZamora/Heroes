import { useEffect, useState } from 'react'
import { formatAmount } from '../hex/resources'
import type { GameSession } from '../session/types'
import type { ReferenceCatalog } from './catalog'
import { unitPortraitUrl } from './slotArt'

export type UnitStackView = {
  empty: boolean
  filename: string | null
  qty: number
}

export function stackView(
  session: GameSession,
  stackId: string | null | undefined,
  catalog: ReferenceCatalog | null,
): UnitStackView {
  if (!stackId) {
    return { empty: true, filename: null, qty: 0 }
  }
  const stack = session.units.find((row) => row.id === stackId)
  if (!stack) {
    return { empty: true, filename: null, qty: 0 }
  }
  const unit = catalog?.unit.find((row) => row.id === stack.unit_id)
  const filename = unit?.image_path?.trim() || null
  return { empty: false, filename, qty: stack.qty }
}

export function UnitStackFace({
  filename,
  qty,
  empty,
}: UnitStackView) {
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    setMissing(false)
  }, [filename])
  if (empty) {
    return <span>Empty</span>
  }
  return (
    <span className="unit-stack-face">
      {filename && !missing ? (
        <img
          src={unitPortraitUrl(filename)}
          alt=""
          onError={() => setMissing(true)}
        />
      ) : (
        <span className="town-building-slot-filename">{filename || 'Unknown'}</span>
      )}
      <span className="unit-qty-badge">{formatAmount(qty)}</span>
    </span>
  )
}
