import { useEffect, useMemo, useState } from 'react'
import { formatAmount } from '../hex/resources'
import type { GameSession } from '../session/types'
import {
  townNameForUnit,
  unitById,
  type ReferenceCatalog,
} from './catalog'
import {
  advBorrowGlowCssFilter,
  flushAdvancedBorrowDevLog,
  noteAdvancedPictureBorrow,
  unitStaticArtCandidates,
} from './unitArtFallback'
import { isUnitPictureUrlKnownFailed, markUnitPictureUrlFailed } from './unitPictureTexture'
import { unitStaticPictureUrls } from './slotArt'

export type UnitStackView = {
  empty: boolean
  filename: string | null
  qty: number
  townName?: string | null
  unitId?: number
  /** When true, use filename/townName instead of unitId art lookup (e.g. polymorph Stand). */
  preferFilename?: boolean
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
  return {
    empty: false,
    filename,
    qty: stack.qty,
    townName: townNameForUnit(catalog, unit ?? null),
    unitId: stack.unit_id,
  }
}

/** Static unit still with town-folder-first URL fallback (no flat-fallback warning). */
export function UnitStaticArtImg({
  filename,
  townName,
  catalog,
  unitId,
  glowScale = 1,
  className,
  preferFilename = false,
}: {
  filename: string | null
  townName?: string | null
  catalog?: ReferenceCatalog | null
  unitId?: number
  glowScale?: number
  className?: string
  preferFilename?: boolean
}) {
  const unit = unitId != null ? unitById(catalog ?? null, unitId) : null
  const candidates = useMemo(() => {
    if (!catalog) {
      return []
    }
    let raw: Array<{ url: string; glow: boolean }> = []
    if (preferFilename && filename) {
      raw = unitStaticPictureUrls(filename, townName).map((url) => ({
        url,
        glow: false as const,
      }))
    } else if (unit) {
      raw = unitStaticArtCandidates(catalog, unit)
    } else if (filename) {
      raw = unitStaticPictureUrls(filename, townName).map((url) => ({
        url,
        glow: false as const,
      }))
    }
    return raw.filter((row) => !isUnitPictureUrlKnownFailed(row.url))
  }, [catalog, unit, filename, townName, preferFilename])
  const [index, setIndex] = useState(0)
  useEffect(() => {
    setIndex(0)
  }, [filename, townName, unitId, catalog, preferFilename])
  if (!catalog) {
    return <span className="unit-stack-art-pending" aria-hidden="true" />
  }
  if (!filename || candidates.length === 0) {
    return (
      <span className="town-building-slot-filename unit-art-placeholder">
        {filename || 'Unknown'}
      </span>
    )
  }
  if (index >= candidates.length) {
    return (
      <span className="town-building-slot-filename unit-art-placeholder">
        {filename}
      </span>
    )
  }
  const candidate = candidates[index]!
  const imgClass = [className, 'unit-art-flippable'].filter(Boolean).join(' ')
  const glowFilter =
    candidate.glow && catalog
      ? advBorrowGlowCssFilter(catalog, glowScale)
      : undefined
  return (
    <img
      className={imgClass}
      src={candidate.url}
      alt=""
      style={glowFilter ? { filter: glowFilter } : undefined}
      onLoad={() => {
        if (candidate.glow && unit && catalog) {
          noteAdvancedPictureBorrow(unit.id)
          flushAdvancedBorrowDevLog(catalog, unit)
        }
      }}
      onError={() => {
        markUnitPictureUrlFailed(candidate.url)
        setIndex((i) => i + 1)
      }}
    />
  )
}

export function UnitStackFace({
  filename,
  qty,
  empty,
  townName,
  unitId,
  catalog,
  preferFilename,
}: UnitStackView & { catalog?: ReferenceCatalog | null }) {
  if (empty) {
    return <span>Empty</span>
  }
  return (
    <span className="unit-stack-face">
      <UnitStaticArtImg
        filename={filename}
        townName={townName}
        catalog={catalog}
        unitId={unitId}
        preferFilename={preferFilename}
      />
      <span className="unit-qty-badge">{formatAmount(qty)}</span>
    </span>
  )
}
