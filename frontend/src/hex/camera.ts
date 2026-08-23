export const PAN_SPEED_PX_PER_SEC = 480

export function clampCamera(
  x: number,
  y: number,
  worldWidth: number,
  worldHeight: number,
  viewWidth: number,
  viewHeight: number,
): { x: number; y: number } {
  const maxX = Math.max(0, worldWidth - viewWidth)
  const maxY = Math.max(0, worldHeight - viewHeight)
  return {
    x: Math.min(maxX, Math.max(0, x)),
    y: Math.min(maxY, Math.max(0, y)),
  }
}
