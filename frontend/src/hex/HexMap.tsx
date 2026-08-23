import { useEffect, useRef } from 'react'
import { Application, Container, Graphics, Text } from 'pixi.js'
import type { Hex } from 'honeycomb-grid'
import { clampCamera, PAN_SPEED_PX_PER_SEC } from './camera'
import {
  CLICK_PAN_THRESHOLD_PX,
  HERO_MARKER_LABEL,
  MAX_MOVEMENT_POINTS,
  MOVE_STEP_MS,
  PLAYER_1_COLOR,
  findPassableStart,
  movementSteps,
  spendMovement,
  VISION_RANGE,
  type Axial,
} from './hero'
import { hexDistance } from './pathfinding'
import { type HeroHudState } from './debug'
import {
  applyDailyTick,
  emptyWallet,
  isResourceName,
  NEUTRAL_OBJECT_COLOR,
  PICKUP_AMOUNT,
  snapshotWallet,
  type ResourceWallet,
} from './resources'
import {
  addMaskedTerrainHex,
  loadAllTerrainTextures,
  pickTerrainVariantIndex,
} from './terrainTextures'
import { buildWorld, fetchTestGrid, getTile, isExplored, markExplored, TERRAIN_COLORS } from './world'
import type { MapObjectData, TestGridResponse } from './types'

type HexMapProps = {
  hexSize: number
  onMapInfo: (info: { width: number; height: number; seed: number }) => void
  onHeroState: (state: HeroHudState) => void
  onResources: (wallet: ResourceWallet) => void
  onTownWelcome: (townName: string) => void
}

type HeroState = HeroHudState

/** Unexplored overlay — very dark grey, not pure black. */
const UNEXPLORED_COLOR = 0x3a3a3a

function hexCenter(hex: Hex, offsetX: number, offsetY: number) {
  const corners = hex.corners
  let x = 0
  let y = 0
  for (const corner of corners) {
    x += corner.x
    y += corner.y
  }
  const n = corners.length
  return { x: x / n + offsetX, y: y / n + offsetY }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = window.setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

export function HexMap({
  hexSize,
  onMapInfo,
  onHeroState,
  onResources,
  onTownWelcome,
}: HexMapProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const tilesRef = useRef<TestGridResponse | null>(null)
  const heroRef = useRef<HeroState | null>(null)
  const walletRef = useRef<ResourceWallet>(emptyWallet())

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    let cancelled = false
    let app: Application | undefined
    const abort = new AbortController()
    const { signal } = abort
    let moveGen = 0
    let moving = false

    void (async () => {
      if (!tilesRef.current) {
        tilesRef.current = await fetchTestGrid()
      }
      const { tiles, seed, objects } = tilesRef.current
      if (cancelled || tiles.length === 0) {
        return
      }

      const { grid, layout, width, height } = buildWorld(tiles, hexSize)
      onMapInfo({ width, height, seed })

      if (!heroRef.current) {
        const start = findPassableStart(grid)
        heroRef.current = {
          q: start.q,
          r: start.r,
          remaining: MAX_MOVEMENT_POINTS,
        }
      }
      onHeroState({
        q: heroRef.current.q,
        r: heroRef.current.r,
        remaining: heroRef.current.remaining,
      })

      const instance = new Application()
      await instance.init({
        background: 0x1a1a1a,
        resizeTo: host,
        antialias: true,
      })

      if (cancelled) {
        instance.destroy()
        return
      }

      const texturesByTerrain = await loadAllTerrainTextures()
      if (cancelled) {
        instance.destroy()
        return
      }

      const fills = new Graphics()
      const strokes = new Graphics()
      const terrainLayer = new Container()
      const { offsetX, offsetY } = layout

      grid.forEach((hex) => {
        const tile = getTile(hex.q, hex.r)
        if (!tile) {
          return
        }
        if (texturesByTerrain.get(tile.terrain)) {
          return
        }
        const poly = hex.corners.map((corner) => ({
          x: corner.x + offsetX,
          y: corner.y + offsetY,
        }))
        fills.poly(poly)
        fills.fill({ color: TERRAIN_COLORS[tile.terrain] })
        strokes.poly(poly)
        strokes.stroke({ width: 1.5, color: 0x111111 })
      })

      const world = new Container()
      world.addChild(fills, strokes, terrainLayer)

      const objectLayer = new Container()
      world.addChild(objectLayer)

      const fog = new Graphics()
      world.addChild(fog)

      const preview = new Graphics()
      world.addChild(preview)

      const marker = new Container()
      const badge = new Graphics()
      badge.circle(0, 0, hexSize * 0.55)
      badge.fill({ color: PLAYER_1_COLOR })
      badge.stroke({ width: 2, color: 0x111111 })
      const label = new Text({
        text: HERO_MARKER_LABEL,
        style: {
          fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
          fontSize: Math.max(10, Math.round(hexSize * 0.7)),
          fontWeight: '700',
          fill: 0xffffff,
        },
        anchor: 0.5,
      })
      marker.addChild(badge, label)
      world.addChild(marker)
      instance.stage.addChild(world)

      const objectByKey = new Map<
        string,
        { data: MapObjectData; view: Container; badge: Graphics; label: Text }
      >()

      const paintObjectBadge = (target: Graphics, claimed: boolean) => {
        target.clear()
        target.circle(0, 0, hexSize * 0.42)
        target.fill({ color: claimed ? PLAYER_1_COLOR : NEUTRAL_OBJECT_COLOR })
        target.stroke({ width: 2, color: 0x111111 })
      }

      const addObjectView = (obj: MapObjectData) => {
        if (obj.kind === 'pickup' && obj.collected) {
          return
        }
        const view = new Container()
        const objectBadge = new Graphics()
        const owned =
          (obj.kind === 'mine' || obj.kind === 'town') && !!obj.claimed
        paintObjectBadge(objectBadge, owned)
        const objectLabel = new Text({
          text: obj.marker,
          style: {
            fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
            fontSize: Math.max(9, Math.round(hexSize * 0.55)),
            fontWeight: '700',
            fill: owned ? 0xffffff : 0x111111,
          },
          anchor: 0.5,
        })
        view.addChild(objectBadge, objectLabel)
        const hex = grid.getHex(obj) ?? grid.createHex(obj)
        const center = hexCenter(hex, offsetX, offsetY)
        view.position.set(center.x, center.y)
        objectLayer.addChild(view)
        objectByKey.set(`${obj.q},${obj.r}`, {
          data: obj,
          view,
          badge: objectBadge,
          label: objectLabel,
        })
      }

      for (const obj of objects ?? []) {
        addObjectView(obj)
      }

      const emitResources = () => {
        onResources(snapshotWallet(walletRef.current))
      }

      const resolveHex = (q: number, r: number) => {
        const key = `${q},${r}`
        const entry = objectByKey.get(key)
        if (!entry) {
          return
        }
        const obj = entry.data
        if (obj.kind === 'town') {
          if (!obj.claimed) {
            obj.claimed = true
            paintObjectBadge(entry.badge, true)
            entry.label.style.fill = '#ffffff'
          }
          onTownWelcome(obj.name?.trim() || 'Town')
          return
        }
        if (!isResourceName(entry.data.resource)) {
          return
        }
        const resource = entry.data.resource
        if (obj.kind === 'pickup') {
          if (obj.collected) {
            return
          }
          obj.collected = true
          walletRef.current[resource].stockpile += PICKUP_AMOUNT
          objectLayer.removeChild(entry.view)
          entry.view.destroy({ children: true })
          objectByKey.delete(key)
          emitResources()
          return
        }
        if (obj.claimed) {
          return
        }
        obj.claimed = true
        walletRef.current[resource].claimedMines += 1
        paintObjectBadge(entry.badge, true)
        entry.label.style.fill = '#ffffff'
        emitResources()
      }

      const camera = { x: 0, y: 0 }
      const keys = new Set<string>()
      let dragging = false
      let pointerDown = false
      let lastPointerX = 0
      let lastPointerY = 0
      let downX = 0
      let downY = 0

      const applyCamera = () => {
        const viewW = instance.screen.width
        const viewH = instance.screen.height
        const next = clampCamera(
          camera.x,
          camera.y,
          layout.canvasWidth,
          layout.canvasHeight,
          viewW,
          viewH,
        )
        camera.x = next.x
        camera.y = next.y
        world.position.set(-camera.x, -camera.y)
      }

      const paintFog = () => {
        fog.clear()
        grid.forEach((hex) => {
          if (isExplored(hex.q, hex.r)) {
            return
          }
          fog.poly(
            hex.corners.map((corner) => ({
              x: corner.x + offsetX,
              y: corner.y + offsetY,
            })),
          )
          fog.fill({ color: UNEXPLORED_COLOR })
          fog.stroke({ width: 1.5, color: 0x2a2a2a })
        })
      }

      const paintTexturedHexes = () => {
        for (const child of terrainLayer.removeChildren()) {
          child.destroy({ children: true })
        }
        grid.forEach((hex) => {
          if (!isExplored(hex.q, hex.r)) {
            return
          }
          const tile = getTile(hex.q, hex.r)
          if (!tile) {
            return
          }
          const variants = texturesByTerrain.get(tile.terrain)
          if (!variants) {
            return
          }
          const variant = pickTerrainVariantIndex(seed, hex.q, hex.r, variants)
          addMaskedTerrainHex(
            terrainLayer,
            hex,
            offsetX,
            offsetY,
            variants[variant].texture,
          )
        })
      }

      const exploreAround = (origin: Axial) => {
        grid.forEach((hex) => {
          if (hexDistance(origin, hex) <= VISION_RANGE) {
            markExplored(hex.q, hex.r)
          }
        })
        paintFog()
        paintTexturedHexes()
      }

      const placeMarker = () => {
        const hero = heroRef.current
        if (!hero) {
          return
        }
        const hex = grid.getHex(hero) ?? grid.createHex(hero)
        const center = hexCenter(hex, offsetX, offsetY)
        marker.position.set(center.x, center.y)
      }

      const followHero = () => {
        const hero = heroRef.current
        if (!hero) {
          return
        }
        const hex = grid.getHex(hero) ?? grid.createHex(hero)
        const center = hexCenter(hex, offsetX, offsetY)
        camera.x = center.x - instance.screen.width / 2
        camera.y = center.y - instance.screen.height / 2
        applyCamera()
      }

      placeMarker()
      if (heroRef.current) {
        exploreAround(heroRef.current)
        resolveHex(heroRef.current.q, heroRef.current.r)
      }
      followHero()
      emitResources()

      const canvas = instance.canvas
      let lastHoverKey = ''

      const hexFromPointer = (event: PointerEvent) => {
        const bounds = canvas.getBoundingClientRect()
        return grid.pointToHex(
          {
            x: event.clientX - bounds.left + camera.x - offsetX,
            y: event.clientY - bounds.top + camera.y - offsetY,
          },
          { allowOutside: false },
        )
      }

      const clearPreview = () => {
        preview.clear()
        lastHoverKey = ''
      }

      const drawPreview = (steps: Hex[]) => {
        preview.clear()
        for (const hex of steps) {
          preview.poly(
            hex.corners.map((corner) => ({
              x: corner.x + offsetX,
              y: corner.y + offsetY,
            })),
          )
          preview.fill({ color: 0xffeb3b, alpha: 0.38 })
          preview.stroke({ width: 2, color: 0xfbc02d })
        }
      }

      const updatePreview = (event: PointerEvent) => {
        const hero = heroRef.current
        if (!hero || moving) {
          return
        }
        const hex = hexFromPointer(event)
        if (!hex || !getTile(hex.q, hex.r)) {
          clearPreview()
          return
        }
        const hoverKey = `${hero.q},${hero.r},${hero.remaining}->${hex.q},${hex.r}`
        if (hoverKey === lastHoverKey) {
          return
        }
        lastHoverKey = hoverKey
        const steps = movementSteps(grid, hero, hex, hero.remaining)
        if (steps.length === 0) {
          preview.clear()
          return
        }
        drawPreview(steps)
      }

      const tryMoveTo = (to: Axial) => {
        const hero = heroRef.current
        if (!hero || moving || hero.remaining <= 1e-9) {
          return
        }
        const steps = movementSteps(grid, hero, to, hero.remaining)
        if (steps.length === 0) {
          return
        }
        const gen = ++moveGen
        moving = true
        clearPreview()
        void (async () => {
          for (const hex of steps) {
            if (signal.aborted || gen !== moveGen || !heroRef.current) {
              break
            }
            heroRef.current.q = hex.q
            heroRef.current.r = hex.r
            const cost = getTile(hex.q, hex.r)?.movementCostMultiplier
            if (cost == null) {
              break
            }
            heroRef.current.remaining = spendMovement(
              heroRef.current.remaining,
              cost,
            )
            onHeroState({
              q: heroRef.current.q,
              r: heroRef.current.r,
              remaining: heroRef.current.remaining,
            })
            placeMarker()
            exploreAround(heroRef.current)
            resolveHex(heroRef.current.q, heroRef.current.r)
            followHero()
            await sleep(MOVE_STEP_MS, signal)
          }
          if (gen === moveGen) {
            moving = false
          }
        })()
      }

      canvas.addEventListener(
        'pointerdown',
        (event) => {
          if (event.button !== 0) {
            return
          }
          pointerDown = true
          dragging = false
          downX = event.clientX
          downY = event.clientY
          lastPointerX = event.clientX
          lastPointerY = event.clientY
          canvas.setPointerCapture(event.pointerId)
        },
        { signal },
      )
      canvas.addEventListener(
        'pointermove',
        (event) => {
          if (!pointerDown) {
            updatePreview(event)
            return
          }
          if (moving) {
            return
          }
          if (!dragging) {
            const dist = Math.hypot(event.clientX - downX, event.clientY - downY)
            if (dist < CLICK_PAN_THRESHOLD_PX) {
              return
            }
            dragging = true
            clearPreview()
            host.classList.add('is-panning')
          }
          camera.x -= event.clientX - lastPointerX
          camera.y -= event.clientY - lastPointerY
          lastPointerX = event.clientX
          lastPointerY = event.clientY
          applyCamera()
        },
        { signal },
      )
      const stopPointer = (event: PointerEvent) => {
        if (!pointerDown) {
          return
        }
        pointerDown = false
        const wasDragging = dragging
        dragging = false
        host.classList.remove('is-panning')
        if (wasDragging || moving || event.button !== 0) {
          return
        }
        const hex = hexFromPointer(event)
        if (!hex || !getTile(hex.q, hex.r)) {
          return
        }
        tryMoveTo(hex)
      }
      canvas.addEventListener('pointerup', stopPointer, { signal })
      canvas.addEventListener('pointerleave', clearPreview, { signal })
      canvas.addEventListener('pointercancel', stopPointer, { signal })
      canvas.addEventListener(
        'wheel',
        (event) => {
          event.preventDefault()
        },
        { signal, passive: false },
      )

      const isArrow = (key: string) =>
        key === 'ArrowUp' ||
        key === 'ArrowDown' ||
        key === 'ArrowLeft' ||
        key === 'ArrowRight'

      window.addEventListener(
        'keydown',
        (event) => {
          if (event.code === 'Space') {
            event.preventDefault()
            if (event.repeat || !heroRef.current) {
              return
            }
            moveGen += 1
            moving = false
            heroRef.current.remaining = MAX_MOVEMENT_POINTS
            onHeroState({
              q: heroRef.current.q,
              r: heroRef.current.r,
              remaining: heroRef.current.remaining,
            })
            applyDailyTick(walletRef.current)
            emitResources()
            return
          }
          if (!isArrow(event.key) || moving) {
            return
          }
          event.preventDefault()
          keys.add(event.key)
        },
        { signal },
      )
      window.addEventListener(
        'keyup',
        (event) => {
          keys.delete(event.key)
        },
        { signal },
      )

      instance.ticker.add((ticker) => {
        if (moving) {
          return
        }
        const dt = ticker.deltaMS / 1000
        let dx = 0
        let dy = 0
        if (keys.has('ArrowLeft')) {
          dx -= 1
        }
        if (keys.has('ArrowRight')) {
          dx += 1
        }
        if (keys.has('ArrowUp')) {
          dy -= 1
        }
        if (keys.has('ArrowDown')) {
          dy += 1
        }
        if (dx === 0 && dy === 0) {
          return
        }
        const length = Math.hypot(dx, dy)
        camera.x += (dx / length) * PAN_SPEED_PX_PER_SEC * dt
        camera.y += (dy / length) * PAN_SPEED_PX_PER_SEC * dt
        applyCamera()
      })

      const resizeObserver = new ResizeObserver(() => {
        applyCamera()
      })
      resizeObserver.observe(host)
      signal.addEventListener('abort', () => {
        resizeObserver.disconnect()
      })

      host.replaceChildren(canvas)
      app = instance
    })()

    return () => {
      cancelled = true
      abort.abort()
      app?.destroy()
    }
  }, [hexSize, onMapInfo, onHeroState, onResources, onTownWelcome])

  return <div ref={hostRef} className="hex-map" tabIndex={0} />
}
