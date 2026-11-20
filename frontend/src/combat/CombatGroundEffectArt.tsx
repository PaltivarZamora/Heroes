import { useEffect, useState } from 'react'
import type { ReferenceCatalog } from '../town/catalog'
import { battleAnimSettings } from './battleAnimConfig'
import { CombatBattleShapeVisual } from './CombatBattleUnitArt'
import {
  groundEffectDisplayWidthPx,
  groundEffectIdleFrameIndex,
  groundEffectStillUrl,
  groundEffectStem,
  loadGroundEffectIdleSheet,
  warnGroundEffectArtOnce,
} from './groundEffectArt'

function GroundEffectStillImg({
  stillUrl,
  displayW,
  stem,
  label,
}: {
  stillUrl: string
  displayW: number
  stem: string | null
  label: string
}) {
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    setBroken(false)
  }, [stillUrl])
  if (broken) {
    return <CombatGroundEffectArtFallback label={label} />
  }
  return (
    <img
      className="combat-ground-effect-img"
      src={stillUrl}
      alt=""
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: displayW,
        height: 'auto',
        transform: 'translate(-50%, -100%)',
        pointerEvents: 'none',
      }}
      onError={() => {
        setBroken(true)
        if (stem) {
          warnGroundEffectArtOnce(stem, `missing still ${stillUrl}`)
        }
      }}
    />
  )
}

export function CombatGroundEffectArt({
  imagePath,
  label,
  hexPx,
  catalog,
  paintNowMs,
}: {
  imagePath: string | null
  label: string
  hexPx: number
  catalog: ReferenceCatalog | null | undefined
  paintNowMs: number
}) {
  const stem = groundEffectStem(imagePath)
  const stillUrl = groundEffectStillUrl(imagePath)
  const [idleSheet, setIdleSheet] = useState<
    import('./battleUnitSheet').BattleUnitAnimSheet | null | undefined
  >(undefined)

  useEffect(() => {
    let cancelled = false
    if (!stem) {
      setIdleSheet(null)
      return
    }
    setIdleSheet(undefined)
    void loadGroundEffectIdleSheet(stem).then((sheet) => {
      if (!cancelled) {
        setIdleSheet(sheet)
      }
    })
    return () => {
      cancelled = true
    }
  }, [stem])

  const displayW = groundEffectDisplayWidthPx(hexPx, catalog)
  const settings = battleAnimSettings(catalog)

  if (!imagePath || !stillUrl) {
    return null
  }

  if (idleSheet === undefined) {
    return null
  }

  if (idleSheet && idleSheet.frames.length > 0) {
    const idx = groundEffectIdleFrameIndex(idleSheet, settings.idleFps, paintNowMs)
    const frame = idleSheet.frames[idx] ?? idleSheet.frames[0]!
    const aspectH = frame.h * (displayW / Math.max(1, frame.w))
    return (
      <CombatBattleShapeVisual
        x={0}
        y={0}
        frame={frame}
        displayWidthPx={displayW}
        displayHeightPx={aspectH}
        angleDeg={0}
        flipY={false}
        rotate={false}
        scaleUniform
      />
    )
  }

  return (
    <GroundEffectStillImg
      stillUrl={stillUrl}
      displayW={displayW}
      stem={stem}
      label={label}
    />
  )
}

export function CombatGroundEffectArtFallback({ label }: { label: string }) {
  return (
    <span
      className="combat-ground-effect-fallback"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        transform: 'translate(-50%, -100%)',
      }}
    >
      {label}
    </span>
  )
}