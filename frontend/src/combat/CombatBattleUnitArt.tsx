import type { BattleUnitFrame } from './battleUnitSheet'

function borrowGlowCssFilter(glow: { color: string; px: number }): string {
  const px = Math.max(0.5, glow.px)
  const c = glow.color
  return `drop-shadow(0 0 ${px}px ${c}) drop-shadow(0 0 ${px * 0.55}px ${c})`
}

export function CombatBattleUnitArt({
  frame,
  scale,
  footX,
  footY,
  flipX,
  motionTransform,
  transformOrigin,
  screenSpaceMotion,
  borrowGlow,
}: {
  frame: BattleUnitFrame
  scale: number
  footX: number
  footY: number
  flipX: boolean
  motionTransform?: string
  transformOrigin?: string
  /** Motion applied after facing flip (screen-space knockback, lift, tilt). */
  screenSpaceMotion?: boolean
  borrowGlow?: { color: string; px: number } | null
}) {
  const frameW = frame.w * scale
  const frameH = frame.h * scale
  const left = footX - frame.anchorX * frameW
  const top = footY - frame.anchorY * frameH
  const bgW = frame.atlasW * scale
  const bgH = frame.atlasH * scale
  const bgX = -frame.rect.x * scale
  const bgY = -frame.rect.y * scale
  const footOrigin = `${frame.anchorX * 100}% ${frame.anchorY * 100}%`
  const glowFilter = borrowGlow ? borrowGlowCssFilter(borrowGlow) : undefined
  const spriteStyle = {
    width: frameW,
    height: frameH,
    pointerEvents: 'none' as const,
    transform: flipX ? 'scaleX(-1)' : undefined,
    transformOrigin: footOrigin,
    backgroundImage: `url(${frame.atlasUrl})`,
    backgroundRepeat: 'no-repeat' as const,
    backgroundSize: `${bgW}px ${bgH}px`,
    backgroundPosition: `${bgX}px ${bgY}px`,
    imageRendering: 'pixelated' as const,
    filter: glowFilter,
  }
  if (screenSpaceMotion && motionTransform) {
    return (
      <div
        className="combat-battle-unit-sprite combat-battle-unit-sprite-screen-motion"
        style={{
          position: 'absolute',
          width: frameW,
          height: frameH,
          left,
          top,
          pointerEvents: 'none',
          transform: motionTransform,
          transformOrigin: transformOrigin ?? footOrigin,
        }}
      >
        <div className="combat-battle-unit-sprite" style={spriteStyle} />
      </div>
    )
  }
  const parts: string[] = []
  if (flipX) {
    parts.push('scaleX(-1)')
  }
  if (motionTransform) {
    parts.push(motionTransform)
  }
  return (
    <div
      className="combat-battle-unit-sprite"
      style={{
        position: 'absolute',
        width: frameW,
        height: frameH,
        left,
        top,
        pointerEvents: 'none',
        transform: parts.length > 0 ? parts.join(' ') : undefined,
        transformOrigin: transformOrigin ?? footOrigin,
        backgroundImage: spriteStyle.backgroundImage,
        backgroundRepeat: spriteStyle.backgroundRepeat,
        backgroundSize: spriteStyle.backgroundSize,
        backgroundPosition: spriteStyle.backgroundPosition,
        imageRendering: spriteStyle.imageRendering,
        filter: glowFilter,
      }}
    />
  )
}

export function CombatBattleProjectile({
  x,
  y,
  angleDeg,
  displayHeightPx,
  staticUrl,
  sheetFrame,
  flipY,
}: {
  x: number
  y: number
  angleDeg: number
  displayHeightPx: number
  staticUrl: string | null
  sheetFrame: BattleUnitFrame | null
  flipY: boolean
}) {
  const flipParts: string[] = ['translate(-50%, -50%)', `rotate(${angleDeg}deg)`]
  if (flipY) {
    flipParts.push('scaleY(-1)')
  }
  const transform = flipParts.join(' ')
  if (sheetFrame) {
    const frameW = sheetFrame.w * (displayHeightPx / sheetFrame.h)
    const frameH = displayHeightPx
    const left = x - sheetFrame.anchorX * frameW
    const top = y - sheetFrame.anchorY * frameH
    const bgW = sheetFrame.atlasW * (displayHeightPx / sheetFrame.h)
    const bgH = sheetFrame.atlasH * (displayHeightPx / sheetFrame.h)
    const bgX = -sheetFrame.rect.x * (displayHeightPx / sheetFrame.h)
    const bgY = -sheetFrame.rect.y * (displayHeightPx / sheetFrame.h)
    return (
      <div
        className="combat-battle-projectile-img"
        style={{
          position: 'absolute',
          left,
          top,
          width: frameW,
          height: frameH,
          transform,
          transformOrigin: `${sheetFrame.anchorX * 100}% ${sheetFrame.anchorY * 100}%`,
          pointerEvents: 'none',
          backgroundImage: `url(${sheetFrame.atlasUrl})`,
          backgroundRepeat: 'no-repeat',
          backgroundSize: `${bgW}px ${bgH}px`,
          backgroundPosition: `${bgX}px ${bgY}px`,
          imageRendering: 'pixelated',
        }}
      />
    )
  }
  if (staticUrl) {
    return (
      <img
        className="combat-battle-projectile-img"
        src={staticUrl}
        alt=""
        style={{
          position: 'absolute',
          left: x,
          top: y,
          height: displayHeightPx,
          width: 'auto',
          transform,
          transformOrigin: 'center center',
          pointerEvents: 'none',
          imageRendering: 'pixelated',
        }}
      />
    )
  }
  const streakLen = Math.max(displayHeightPx * 1.2, 24)
  return (
    <div
      className="combat-battle-projectile-streak"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: streakLen,
        height: 4,
        transform,
        transformOrigin: 'center center',
        background:
          'linear-gradient(90deg, transparent, rgba(255, 220, 120, 0.95), transparent)',
        pointerEvents: 'none',
      }}
    />
  )
}

export function CombatBattleShapeVisual({
  x,
  y,
  frame,
  displayWidthPx,
  displayHeightPx,
  angleDeg,
  flipY,
  rotate,
}: {
  x: number
  y: number
  frame: BattleUnitFrame
  displayWidthPx: number
  displayHeightPx: number
  angleDeg: number
  flipY: boolean
  rotate: boolean
}) {
  const uniformScale = Math.min(
    displayWidthPx / Math.max(1, frame.w),
    displayHeightPx / Math.max(1, frame.h),
  )
  const frameW = frame.w * uniformScale
  const frameH = frame.h * uniformScale
  const left = x - frame.anchorX * frameW
  const top = y - frame.anchorY * frameH
  const bgW = frame.atlasW * uniformScale
  const bgH = frame.atlasH * uniformScale
  const bgX = -frame.rect.x * uniformScale
  const bgY = -frame.rect.y * uniformScale
  const flipParts: string[] = []
  if (rotate) {
    flipParts.push(`rotate(${angleDeg}deg)`)
  }
  if (flipY) {
    flipParts.push('scaleY(-1)')
  }
  return (
    <div
      className="combat-battle-shape-fx"
      style={{
        position: 'absolute',
        left,
        top,
        width: frameW,
        height: frameH,
        ...(flipParts.length > 0
          ? {
              transform: flipParts.join(' '),
              transformOrigin: `${frame.anchorX * 100}% ${frame.anchorY * 100}%`,
            }
          : {}),
        pointerEvents: 'none',
        backgroundImage: `url(${frame.atlasUrl})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${bgW}px ${bgH}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        imageRendering: 'pixelated',
      }}
    />
  )
}

export function CombatBattleImpactEffect({
  x,
  y,
  frame,
  displayHeightPx,
}: {
  x: number
  y: number
  frame: BattleUnitFrame
  displayHeightPx: number
}) {
  const scale = displayHeightPx / frame.h
  const frameW = frame.w * scale
  const frameH = displayHeightPx
  const left = x - frame.anchorX * frameW
  const top = y - frame.anchorY * frameH
  const bgW = frame.atlasW * scale
  const bgH = frame.atlasH * scale
  const bgX = -frame.rect.x * scale
  const bgY = -frame.rect.y * scale
  return (
    <div
      className="combat-battle-impact-fx"
      style={{
        position: 'absolute',
        left,
        top,
        width: frameW,
        height: frameH,
        pointerEvents: 'none',
        backgroundImage: `url(${frame.atlasUrl})`,
        backgroundRepeat: 'no-repeat',
        backgroundSize: `${bgW}px ${bgH}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        imageRendering: 'pixelated',
      }}
    />
  )
}
