import { useEffect, useRef } from 'react'
import {
  Application,
  Container,
  Graphics,
  Text,
  type FederatedPointerEvent,
} from 'pixi.js'
import type { Grid, Hex } from 'honeycomb-grid'
import { activePlayer } from '../session/accessors'
import { getSession } from '../session/store'
import type { GameSession, Hero, Node } from '../session/types'
import { slotFromPlayerId } from '../session/types'
import {
  getCachedCatalog,
  mapShowHexesWorld,
  mapUseTerrainImages,
  mapViewHexPx,
  mapViewWallColor,
  ownerTint,
  propRowById,
  visionRange,
} from '../town/catalog'
import { createHexGrid } from './world'
import {
  forEachTile,
  getExploredHexes,
  getTile,
  isBridgeHex,
  isExplored,
  markExplored,
  restoreExplored,
} from './world'
import { hexDistance } from './pathfinding'
import { strokeRoadSegments } from './roadRender'
import { loadHexTerrainTextures } from './terrainTextures'
import { WorldChunkRenderer } from './worldRenderChunks'
import { clientPointInElement } from '../layout/clientPointer'
import { clampCamera, PAN_SPEED_PX_PER_SEC } from './camera'

const NEUTRAL_TINT = 0x9e9e9e
const ROAD_TAN = 0xc9a86c
const DIM_ALPHA = 0.5

type MapViewProps = {
  open: boolean
  session: GameSession
  mapWidth: number
  mapHeight: number
  mapSeed: number
  selectedHeroId: string | null
  focusHex: { q: number; r: number } | null
  terrainWedgesEnabled: boolean
  /** Debug: show full map (no fog); does not change saved exploration. */
  revealAll?: boolean
  embedded?: boolean
  onClose: () => void
  onFocusWorldHex: (q: number, r: number) => void
}

type HitMarker = {
  kind: 'town' | 'hero' | 'node'
  q: number
  r: number
  radius: number
  tooltip: string
}

function hexKey(q: number, r: number): string {
  return `${q},${r}`
}

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

function playerOwnerLabel(
  playerId: string | null | undefined,
): string {
  if (!playerId) {
    return 'Neutral'
  }
  const catalog = getCachedCatalog()
  const slot = slotFromPlayerId(playerId)
  if (slot == null || !catalog) {
    return 'Neutral'
  }
  const row = catalog.player_color.find((color) => color.id === slot)
  return row?.name?.trim() || `Player ${slot}`
}

function visibleHexSet(
  session: GameSession,
  viewerId: string,
  grid: Grid<Hex>,
): Set<string> {
  const catalog = getCachedCatalog()
  const range = visionRange(catalog)
  const out = new Set<string>()
  for (const hero of session.heroes) {
    if (hero.player_id !== viewerId || hero.flight) {
      continue
    }
    grid.forEach((hex) => {
      if (hexDistance(hero.position, hex) <= range) {
        out.add(hexKey(hex.q, hex.r))
      }
    })
  }
  return out
}

function heroShownOnMap(
  hero: Hero,
  viewerId: string,
  visible: Set<string>,
): boolean {
  if (hero.flight) {
    return false
  }
  if (hero.player_id === viewerId) {
    return true
  }
  return visible.has(hexKey(hero.position.q, hero.position.r))
}

function nodeLabel(node: Node): string {
  const catalog = getCachedCatalog()
  const res =
    catalog?.resource.find((row) => row.id === node.resource_id)?.name?.trim() ??
    'Resource'
  if (node.kind === 'mine') {
    return `${res} Mine`
  }
  return res
}

export function MapView({
  open,
  session: _session,
  mapWidth,
  mapHeight,
  mapSeed,
  selectedHeroId,
  focusHex,
  terrainWedgesEnabled,
  revealAll = false,
  embedded = false,
  onClose,
  onFocusWorldHex,
}: MapViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const selectedHeroRef = useRef(selectedHeroId)
  selectedHeroRef.current = selectedHeroId
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const onFocusWorldHexRef = useRef(onFocusWorldHex)
  onFocusWorldHexRef.current = onFocusWorldHex
  const focusHexRef = useRef(focusHex)
  focusHexRef.current = focusHex

  useEffect(() => {
    if (!open || !hostRef.current) {
      return
    }
    const exploredBeforeMapView = getExploredHexes()
    const host = hostRef.current
    const tipEl = tipRef.current
    let cancelled = false
    let app: Application | null = null
    let chunkRenderer: WorldChunkRenderer | null = null
    let pan = { x: 0, y: 0 }
    let dragging = false
    let dragStart = { x: 0, y: 0, panX: 0, panY: 0 }
    let dragMoved = false
    const keys = new Set<string>()
    let markers: HitMarker[] = []
    let raf = 0
    let lastFrame = performance.now()

    const catalog = getCachedCatalog()
    const hexPx = mapViewHexPx(catalog)
    const { grid, layout } = createHexGrid(mapWidth, mapHeight, hexPx)
    const { offsetX, offsetY } = layout
    const mapW = layout.canvasWidth
    const mapH = layout.canvasHeight

    const world = new Container()
    const terrainLayer = new Container()
    const wallLayer = new Graphics()
    const roadLayer = new Graphics()
    const dimLayer = new Graphics()
    const markerLayer = new Container()
    world.addChild(terrainLayer, wallLayer, roadLayer, dimLayer, markerLayer)

    const clampPan = () => {
      const viewW = app?.screen.width ?? 0
      const viewH = app?.screen.height ?? 0
      const next = clampCamera(-pan.x, -pan.y, mapW, mapH, viewW, viewH)
      pan.x = -next.x
      pan.y = -next.y
      world.position.set(pan.x, pan.y)
    }

    const centerOnHex = (q: number, r: number) => {
      const hex = grid.getHex({ q, r }) ?? grid.createHex({ q, r })
      const c = hexCenter(hex, offsetX, offsetY)
      const viewW = app?.screen.width ?? 0
      const viewH = app?.screen.height ?? 0
      pan.x = viewW / 2 - c.x
      pan.y = viewH / 2 - c.y
      clampPan()
    }

    const paintWalls = () => {
      wallLayer.clear()
      const wallColor = mapViewWallColor(catalog)
      forEachTile((q, r) => {
        if (!isExplored(q, r)) {
          return
        }
        const tile = getTile(q, r)
        const row = propRowById(catalog, tile?.propId ?? null)
        if (row?.wall !== true) {
          return
        }
        const hex = grid.getHex({ q, r })
        if (!hex) {
          return
        }
        wallLayer.poly(
          hex.corners.map((corner) => ({
            x: corner.x + offsetX,
            y: corner.y + offsetY,
          })),
        )
        wallLayer.fill({ color: wallColor, alpha: 1 })
      })
    }

    const paintRoads = () => {
      roadLayer.clear()
      const roadHexes: Array<{ q: number; r: number }> = []
      forEachTile((q, r) => {
        if (isExplored(q, r) && getTile(q, r)?.hasRoad) {
          roadHexes.push({ q, r })
        }
      })
      strokeRoadSegments(
        roadLayer,
        roadHexes,
        (q, r) => {
          const hex = grid.getHex({ q, r })
          if (!hex) {
            return null
          }
          return hexCenter(hex, offsetX, offsetY)
        },
        {
          width: Math.max(1, hexPx * 0.14),
          color: ROAD_TAN,
          alpha: 0.95,
          join: 'round',
          cap: 'round',
        },
        (q, r) => getTile(q, r)?.roadMask,
      )
      forEachTile((q, r) => {
        if (!isExplored(q, r) || !isBridgeHex(q, r)) {
          return
        }
        const hex = grid.getHex({ q, r })
        if (!hex) {
          return
        }
        const c = hexCenter(hex, offsetX, offsetY)
        roadLayer.moveTo(c.x - hexPx * 0.35, c.y)
        roadLayer.lineTo(c.x + hexPx * 0.35, c.y)
      })
      roadLayer.stroke({
        width: Math.max(1, hexPx * 0.12),
        color: ROAD_TAN,
        alpha: 0.95,
      })
    }

    const paintDim = () => {
      dimLayer.clear()
      if (revealAll) {
        return
      }
      const live = getSession()
      const viewer =
        activePlayer(live)?.id ?? live.players[0]?.id ?? ''
      const visible = visibleHexSet(live, viewer, grid)
      forEachTile((q, r) => {
        if (!isExplored(q, r)) {
          return
        }
        if (visible.has(hexKey(q, r))) {
          return
        }
        const hex = grid.getHex({ q, r })
        if (!hex) {
          return
        }
        dimLayer.poly(
          hex.corners.map((corner) => ({
            x: corner.x + offsetX,
            y: corner.y + offsetY,
          })),
        )
        dimLayer.fill({ color: 0x000000, alpha: DIM_ALPHA })
      })
    }

    const paintMarkers = () => {
      markerLayer.removeChildren()
      markers = []
      const live = getSession()
      const viewer =
        activePlayer(live)?.id ?? live.players[0]?.id ?? ''
      const visible = visibleHexSet(live, viewer, grid)
      const pickHeroId = selectedHeroRef.current
      const fontFamily = "system-ui, 'Segoe UI', Roboto, sans-serif"
      const addText = (
        text: string,
        x: number,
        y: number,
        fill: number,
        fontSize: number,
        hit: HitMarker,
        ring?: boolean,
      ) => {
        const outline = new Text({
          text,
          style: {
            fontFamily,
            fontSize,
            fontWeight: '700',
            fill: 0x000000,
            stroke: { color: 0x000000, width: 4 },
          },
          anchor: 0.5,
        })
        outline.position.set(x, y)
        const label = new Text({
          text,
          style: {
            fontFamily,
            fontSize,
            fontWeight: '700',
            fill,
          },
          anchor: 0.5,
        })
        label.position.set(x, y)
        markerLayer.addChild(outline, label)
        if (ring) {
          const g = new Graphics()
          g.circle(x, y, fontSize * 0.85)
          g.stroke({ width: 2, color: 0xffffff })
          markerLayer.addChild(g)
        }
        markers.push(hit)
      }

      for (const town of live.towns) {
        if (!isExplored(town.position.q, town.position.r)) {
          continue
        }
        const hex = grid.getHex(town.position) ?? grid.createHex(town.position)
        const c = hexCenter(hex, offsetX, offsetY)
        const tint = ownerTint(town.player_id) ?? NEUTRAL_TINT
        const owner = playerOwnerLabel(town.player_id)
        addText(
          'T',
          c.x,
          c.y,
          tint,
          Math.max(12, Math.round(hexPx * 1.6)),
          {
            kind: 'town',
            q: town.position.q,
            r: town.position.r,
            radius: hexPx * 0.9,
            tooltip: `${town.name} (${owner})`,
          },
        )
      }

      for (const node of live.nodes) {
        if (!node.player_id || node.collected) {
          continue
        }
        if (!isExplored(node.position.q, node.position.r)) {
          continue
        }
        const hex = grid.getHex(node.position) ?? grid.createHex(node.position)
        const c = hexCenter(hex, offsetX, offsetY)
        const tint = ownerTint(node.player_id) ?? NEUTRAL_TINT
        const owner = playerOwnerLabel(node.player_id)
        const g = new Graphics()
        g.circle(c.x, c.y, Math.max(3, hexPx * 0.3))
        g.fill({ color: tint })
        markerLayer.addChild(g)
        markers.push({
          kind: 'node',
          q: node.position.q,
          r: node.position.r,
          radius: hexPx * 0.45,
          tooltip: `${nodeLabel(node)} (${owner})`,
        })
      }

      for (const hero of live.heroes) {
        const showHero =
          revealAll && !hero.flight
            ? true
            : heroShownOnMap(hero, viewer, visible)
        if (!showHero) {
          continue
        }
        const hex = grid.getHex(hero.position) ?? grid.createHex(hero.position)
        const c = hexCenter(hex, offsetX, offsetY)
        const tint = ownerTint(hero.player_id) ?? NEUTRAL_TINT
        const owner = playerOwnerLabel(hero.player_id)
        addText(
          'H',
          c.x,
          c.y,
          tint,
          Math.max(10, Math.round(hexPx * 1.2)),
          {
            kind: 'hero',
            q: hero.position.q,
            r: hero.position.r,
            radius: hexPx * 0.75,
            tooltip: `${hero.name} (${owner})`,
          },
          hero.id === pickHeroId,
        )
      }
    }

    const applyActivePlayerExplored = () => {
      if (revealAll) {
        forEachTile((q, r) => markExplored(q, r))
        return
      }
      const live = getSession()
      restoreExplored(activePlayer(live)?.explored)
    }

    const paintOverlays = () => {
      paintWalls()
      paintRoads()
      paintDim()
      paintMarkers()
    }

    const bakeExploredIncremental = async () => {
      if (!chunkRenderer) {
        return
      }
      applyActivePlayerExplored()
      const hexes: Array<{ q: number; r: number }> = []
      forEachTile((q, r) => {
        if (isExplored(q, r)) {
          hexes.push({ q, r })
        }
      })
      const batchSize = 192
      for (let i = 0; i < hexes.length; i += batchSize) {
        if (cancelled) {
          return
        }
        chunkRenderer.revealHexes(hexes.slice(i, i + batchSize))
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve())
        })
      }
      if (!cancelled) {
        paintOverlays()
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      keys.add(event.key)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      keys.delete(event.key)
    }

    const pointerToWorld = (event: FederatedPointerEvent) => {
      if (!app) {
        return { x: 0, y: 0 }
      }
      const p = clientPointInElement(app.canvas, event.clientX, event.clientY)
      return { x: p.x - pan.x, y: p.y - pan.y }
    }

    const pickMarker = (wx: number, wy: number): HitMarker | null => {
      let best: HitMarker | null = null
      let bestD = Infinity
      for (const m of markers) {
        const hex = grid.getHex({ q: m.q, r: m.r })
        if (!hex) {
          continue
        }
        const c = hexCenter(hex, offsetX, offsetY)
        const d = Math.hypot(c.x - wx, c.y - wy)
        if (d <= m.radius && d < bestD) {
          bestD = d
          best = m
        }
      }
      return best
    }

    void (async () => {
      const instance = new Application()
      await instance.init({
        resizeTo: host,
        background: '#000000',
        antialias: true,
      })
      if (cancelled) {
        instance.destroy()
        return
      }
      app = instance
      host.replaceChildren(instance.canvas)
      if (tipEl) {
        host.appendChild(tipEl)
      }
      instance.stage.addChild(world)

      const terrainRows = catalog?.terrain ?? []
      const hexTerrainTextures = await loadHexTerrainTextures(terrainRows)
      if (cancelled) {
        return
      }
      const fogLayer = new Container()
      const groundPropLayer = new Container()
      const blockingPropLayer = new Container()
      const mapArtLayer = new Container()
      chunkRenderer = new WorldChunkRenderer({
        app: instance,
        grid,
        terrainLayer,
        fogLayer,
        groundPropLayer,
        blockingPropLayer,
        mapArtLayer,
        offsetX,
        offsetY,
        hexSize: hexPx,
        seed: mapSeed,
        useTerrainImages: mapUseTerrainImages(catalog),
        showHexOutlines: mapShowHexesWorld(catalog),
        wedgesEnabled: () => terrainWedgesEnabled,
        hexTerrainTextures,
        getCatalog: () => getCachedCatalog(),
      })

      const start = focusHexRef.current ?? { q: 0, r: 0 }
      centerOnHex(start.q, start.r)
      await bakeExploredIncremental()
      if (cancelled) {
        return
      }

      const onPointerDown = (event: FederatedPointerEvent) => {
        if (event.button !== 0) {
          return
        }
        dragging = true
        dragMoved = false
        dragStart = {
          x: event.global.x,
          y: event.global.y,
          panX: pan.x,
          panY: pan.y,
        }
      }
      const onPointerMove = (event: FederatedPointerEvent) => {
        const local = pointerToWorld(event)
        const hit = pickMarker(local.x, local.y)
        if (tipEl) {
          if (hit) {
            tipEl.textContent = hit.tooltip
            tipEl.hidden = false
            tipEl.style.left = `${event.clientX - host.getBoundingClientRect().left + 12}px`
            tipEl.style.top = `${event.clientY - host.getBoundingClientRect().top + 12}px`
          } else {
            tipEl.hidden = true
          }
        }
        if (!dragging) {
          return
        }
        const dx = event.global.x - dragStart.x
        const dy = event.global.y - dragStart.y
        if (Math.hypot(dx, dy) > 4) {
          dragMoved = true
        }
        pan.x = dragStart.panX + dx
        pan.y = dragStart.panY + dy
        clampPan()
      }
      const onPointerUp = (event: FederatedPointerEvent) => {
        if (!dragging) {
          return
        }
        dragging = false
        if (dragMoved) {
          return
        }
        const local = pointerToWorld(event)
        const hit = pickMarker(local.x, local.y)
        if (hit) {
          return
        }
        const hex = grid.pointToHex(
          { x: local.x - offsetX, y: local.y - offsetY },
          { allowOutside: false },
        )
        if (!hex || (!revealAll && !isExplored(hex.q, hex.r))) {
          return
        }
        onFocusWorldHexRef.current(hex.q, hex.r)
      }

      instance.stage.eventMode = 'static'
      instance.stage.hitArea = instance.screen
      instance.stage.on('pointerdown', onPointerDown)
      instance.stage.on('pointermove', onPointerMove)
      instance.stage.on('pointerup', onPointerUp)
      instance.stage.on('pointerupoutside', onPointerUp)

      window.addEventListener('keydown', onKeyDown, true)
      window.addEventListener('keyup', onKeyUp, true)

      const tick = () => {
        if (cancelled) {
          return
        }
        const now = performance.now()
        const dt = Math.min(0.05, (now - lastFrame) / 1000)
        lastFrame = now
        let dx = 0
        let dy = 0
        if (keys.has('ArrowLeft')) {
          dx += 1
        }
        if (keys.has('ArrowRight')) {
          dx -= 1
        }
        if (keys.has('ArrowUp')) {
          dy += 1
        }
        if (keys.has('ArrowDown')) {
          dy -= 1
        }
        if (dx !== 0 || dy !== 0) {
          const len = Math.hypot(dx, dy) || 1
          pan.x += (dx / len) * PAN_SPEED_PX_PER_SEC * dt
          pan.y += (dy / len) * PAN_SPEED_PX_PER_SEC * dt
          clampPan()
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    })()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      chunkRenderer?.destroy()
      if (app) {
        app.canvas.remove()
        app.destroy(false)
      }
      host.replaceChildren()
      restoreExplored(exploredBeforeMapView)
    }
  }, [open, mapWidth, mapHeight, mapSeed, terrainWedgesEnabled, revealAll])

  if (!open) {
    return null
  }

  return (
    <div
      className={
        embedded
          ? 'map-view-overlay map-view-embedded'
          : 'map-view-overlay'
      }
      role="dialog"
      aria-label={revealAll ? 'Map view (full world)' : 'Map view'}
    >
      <div ref={hostRef} className="map-view-host" />
      <div ref={tipRef} className="world-hover-tip" hidden />
    </div>
  )
}
