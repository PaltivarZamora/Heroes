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
  imageUrl,
}: {
  x: number
  y: number
  angleDeg: number
  displayHeightPx: number
  imageUrl: string | null
}) {
  if (imageUrl) {
    return (
      <img
        className="combat-battle-projectile-img"
        src={imageUrl}
        alt=""
        style={{
          position: 'absolute',
          left: x,
          top: y,
          height: displayHeightPx,
          width: 'auto',
          transform: `translate(-50%, -50%) rotate(${angleDeg}deg)`,
          transformOrigin: 'center center',
          pointerEvents: 'none',
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
        transform: `translate(-50%, -50%) rotate(${angleDeg}deg)`,
        transformOrigin: 'center center',
        background:
          'linear-gradient(90deg, transparent, rgba(255, 220, 120, 0.95), transparent)',
        pointerEvents: 'none',
      }}
    />
  )
}
