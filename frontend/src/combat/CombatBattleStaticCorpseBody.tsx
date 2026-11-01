import { useEffect, useState } from 'react'
import { advBorrowGlowCssFilter } from '../town/unitArtFallback'
import type { ReferenceCatalog } from '../town/catalog'
import type { BattleAnimSettings } from './battleAnimConfig'
import { corpseStaticImageScale } from './combatCorpsePaint'
import type { FootprintCode } from './footprint'
import type { CombatSide } from './battle'
import {
  resolveUnitCorpsePicture,
  type UnitCorpsePictureResolved,
} from '../town/unitCorpsePicture'

export function CombatBattleStaticCorpseBody({
  unitId,
  unitDisplayName,
  catalog,
  hexPx,
  footprint,
  side,
  settings,
  url: urlOverride,
  glow,
  footX,
  footY,
  flipX,
}: {
  unitId: number
  unitDisplayName: string
  catalog: ReferenceCatalog
  hexPx: number
  footprint: FootprintCode
  side: CombatSide
  settings: BattleAnimSettings
  url?: string
  glow?: boolean
  footX: number
  footY: number
  flipX: boolean
}) {
  const [resolved, setResolved] = useState<UnitCorpsePictureResolved | null>(
    urlOverride
      ? {
          kind: 'body',
          url: urlOverride,
          glow: glow === true,
          source: 'own',
          fileLabel: '',
        }
      : null,
  )
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    if (urlOverride) {
      return
    }
    let cancelled = false
    const unit = catalog.unit.find((row) => row.id === unitId)
    if (!unit) {
      return
    }
    void resolveUnitCorpsePicture(unitId, catalog, unit, unitDisplayName).then(
      (row) => {
        if (!cancelled) {
          setResolved(row)
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [catalog, unitDisplayName, unitId, urlOverride])

  useEffect(() => {
    setNatural(null)
  }, [resolved?.kind === 'body' ? resolved.url : ''])

  if (!resolved || resolved.kind !== 'body') {
    return null
  }

  const natW = natural?.w ?? 200
  const natH = natural?.h ?? 200
  const scale = corpseStaticImageScale(
    hexPx,
    footprint,
    side,
    natW,
    settings,
  )
  const frameW = natW * scale
  const frameH = natH * scale
  const anchorX = 0.5
  const anchorY = 1
  const left = footX - anchorX * frameW
  const top = footY - anchorY * frameH
  const glowFilter =
    resolved.glow && catalog
      ? advBorrowGlowCssFilter(catalog, scale)
      : undefined

  return (
    <img
      className="combat-battle-corpse-body-img"
      src={resolved.url}
      alt=""
      draggable={false}
      style={{
        position: 'absolute',
        left,
        top,
        width: frameW,
        height: frameH,
        objectFit: 'contain',
        objectPosition: 'bottom center',
        pointerEvents: 'none',
        transform: flipX ? 'scaleX(-1)' : undefined,
        transformOrigin: `${anchorX * 100}% ${anchorY * 100}%`,
        filter: glowFilter,
        imageRendering: 'pixelated',
      }}
      onLoad={(event) => {
        const img = event.currentTarget
        if (img.naturalWidth >= 1 && img.naturalHeight >= 1) {
          setNatural({ w: img.naturalWidth, h: img.naturalHeight })
        }
      }}
    />
  )
}
