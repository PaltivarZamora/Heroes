import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Application, Container, Graphics, Sprite, Text } from 'pixi.js'
import type { Texture } from 'pixi.js'
import type { Hex } from 'honeycomb-grid'
import { GAME_WINDOW_HEIGHT, GAME_WINDOW_WIDTH } from '../layout/stageConstants'
import { getTile, terrainFillColor } from '../hex/world'
import {
  addChunkMaskedTerrain,
  buildTerrainChunkDecors,
  loadHexTerrainTextures,
  loadTextureUrl,
  type ChunkTextureDecor,
} from '../hex/terrainTextures'
import { parseCssHexColor } from '../hex/terrainTransition'
import { loadPropTexture, layoutWorldMapPropSprite } from '../hex/propTextures'
import { strokeRoadSegments } from '../hex/roadRender'
import { heroTravelSprite, loadTravelTexture } from '../hex/heroTravelSprite'
import { findTownById } from '../session/accessors'
import { getSession, subscribe } from '../session/store'
import {
  getCachedCatalog,
  hexTerrainByName,
  mapUseTerrainImages,
  ownerTint,
  subscribeCatalog,
  type ReferenceCatalog,
} from './catalog'
import { planTownMap, type TownMapPlan } from './townMapPlan'
import {
  hexesBoundingBox,
  townHexAtPoint,
  type TownMapCell,
} from './townMapGrid'

function cellSpan(cell: TownMapCell): { width: number; height: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const corner of cell.corners) {
    minX = Math.min(minX, corner.x)
    maxX = Math.max(maxX, corner.x)
    minY = Math.min(minY, corner.y)
    maxY = Math.max(maxY, corner.y)
  }
  return {
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

const SIGN_ALPHA = 0.4
const ROAD_COLOR = 0x00e5ff

type TipState = { text: string; x: number; y: number }

type TownMapViewProps = {
  townId: string
  showHexNumbers: boolean
  preferredHeroId?: string | null
  onSlotClick: (slot: number) => void
}

function expandPoly(
  corners: ReadonlyArray<{ x: number; y: number }>,
  px: number,
): Array<{ x: number; y: number }> {
  let cx = 0
  let cy = 0
  for (const corner of corners) {
    cx += corner.x
    cy += corner.y
  }
  cx /= corners.length || 1
  cy /= corners.length || 1
  return corners.map((corner) => {
    const dx = corner.x - cx
    const dy = corner.y - cy
    const len = Math.hypot(dx, dy) || 1
    return { x: corner.x + (dx / len) * px, y: corner.y + (dy / len) * px }
  })
}

function stagePoint(
  event: PointerEvent,
  host: HTMLElement,
): { x: number; y: number } {
  const box = host.getBoundingClientRect()
  return {
    x: ((event.clientX - box.left) / Math.max(1, box.width)) * GAME_WINDOW_WIDTH,
    y: ((event.clientY - box.top) / Math.max(1, box.height)) * GAME_WINDOW_HEIGHT,
  }
}

function drawFittedPicture(
  parent: Container,
  texture: Texture | null,
  fallback: string,
  box: { minX: number; minY: number; maxX: number; maxY: number },
  opts: {
    scale: number
    dx: number
    dy: number
    flipX: boolean
    dimmed: boolean
  },
) {
  const boxW = Math.max(1, box.maxX - box.minX)
  const boxH = Math.max(1, box.maxY - box.minY)
  const x = (box.minX + box.maxX) / 2 + opts.dx
  const y = box.maxY + opts.dy
  const z = Math.round(box.maxY * 1000)
  if (texture && texture.width >= 1 && texture.height >= 1) {
    const fit =
      Math.min(boxW / texture.width, boxH / texture.height) * opts.scale
    const sprite = new Sprite(texture)
    sprite.anchor.set(0.5, 1)
    sprite.position.set(x, y)
    sprite.scale.set(
      opts.flipX ? -Math.abs(fit) : Math.abs(fit),
      Math.abs(fit),
    )
    sprite.alpha = opts.dimmed ? SIGN_ALPHA : 1
    sprite.zIndex = z
    parent.addChild(sprite)
    return
  }
  const label = new Text({
    text: fallback,
    style: {
      fontFamily: "ui-monospace, 'Cascadia Code', Consolas, monospace",
      fontSize: 13,
      fill: 0xf4f4f4,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: Math.max(48, boxW - 8),
    },
    anchor: { x: 0.5, y: 1 },
  })
  label.position.set(x, y)
  label.alpha = opts.dimmed ? SIGN_ALPHA : 1
  label.zIndex = z
  parent.addChild(label)
}

type TownMapPixiRuntime = {
  app: Application
  terrainLayer: Container
  roadLayer: Graphics
  structureLayer: Container
  propLayer: Container
  heroLayer: Container
  debugLayer: Container
  lastBaseKey: string
}

async function paintTownMapBase(
  rt: TownMapPixiRuntime,
  shown: TownMapPlan,
  cat: ReferenceCatalog,
  mapSeed: number,
): Promise<void> {
  rt.terrainLayer.removeChildren()
  rt.roadLayer.clear()
  rt.heroLayer.removeChildren()

  const useImages = mapUseTerrainImages(cat)
  const textures = useImages
    ? await loadHexTerrainTextures(cat.terrain)
    : new Map<string, Texture>()
  const terrainRow = hexTerrainByName(cat, shown.terrainName)
  const fill = terrainRow
    ? parseCssHexColor(terrainRow.color)
    : terrainFillColor(shown.terrainName)
  const members = shown.grid.cells.map((cell) => ({
    q: cell.q,
    r: cell.r,
    hex: { corners: cell.corners } as Hex,
  }))
  const decors = useImages
    ? buildTerrainChunkDecors(
        members,
        () => shown.terrainName,
        () => 1,
        (name) =>
          textures.get(name) ?? textures.get(name.replaceAll(' ', '_')),
        0,
        0,
        mapSeed,
      )
    : new Map<string, ChunkTextureDecor>()
  let decor = decors.values().next().value as ChunkTextureDecor | undefined
  if (decor && shown.flipped) {
    decor = { ...decor, scaleX: -decor.scaleX }
  }
  for (const cell of shown.grid.cells) {
    const poly = expandPoly(cell.corners, 2)
    if (decor) {
      addChunkMaskedTerrain(rt.terrainLayer, poly, decor)
    } else {
      const g = new Graphics()
      g.poly(poly)
      g.fill({ color: fill })
      rt.terrainLayer.addChild(g)
    }
  }

  const axial = new Map<string, TownMapCell>()
  for (const cell of shown.grid.cells) {
    axial.set(`${cell.q},${cell.r}`, cell)
  }
  strokeRoadSegments(
    rt.roadLayer,
    shown.road
      .map((n) => shown.grid.byNumber.get(n))
      .filter((cell): cell is TownMapCell => cell != null)
      .map((cell) => ({ q: cell.q, r: cell.r })),
    (q, r) => axial.get(`${q},${r}`)?.center ?? null,
    {
      width: Math.max(3, 42 * 0.14),
      color: ROAD_COLOR,
      alpha: 0.9,
      join: 'round',
      cap: 'round',
    },
  )

  const token = 42 * 1.8
  for (let i = 0; i < shown.heroes.length; i += 1) {
    const hero = shown.heroes[i]!
    const hexN = shown.heroHexes[i] ?? 0
    const cell = shown.grid.byNumber.get(hexN)
    if (!cell) {
      continue
    }
    const travel = heroTravelSprite(hero, getSession())
    const texture = await loadTravelTexture(travel.file)
    const view = new Container()
    view.zIndex = Math.round(cell.center.y * 1000)
    const same = shown.heroHexes.filter((n) => n === hexN).length
    const index =
      shown.heroHexes.slice(0, i + 1).filter((n) => n === hexN).length - 1
    const spread = same > 1 ? (index - (same - 1) / 2) * 18 : 0
    view.position.set(cell.center.x + spread, cell.center.y)
    if (texture && texture.width >= 1) {
      const scale = Math.min(token / texture.width, token / texture.height)
      const sprite = new Sprite(texture)
      sprite.anchor.set(0.5, 0.5)
      sprite.scale.set(travel.flipX ? -scale : scale, scale)
      view.addChild(sprite)
    } else {
      const badge = new Graphics()
      badge.circle(0, 0, 18)
      badge.fill({ color: ownerTint(hero.player_id) ?? 0xc4a574 })
      view.addChild(badge)
    }
    const name = new Text({
      text: hero.name,
      style: {
        fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
        fontSize: 14,
        fontWeight: '700',
        fill: 0xffffff,
        stroke: { color: 0x111111, width: 3 },
      },
      anchor: 0.5,
    })
    name.position.set(0, 28)
    view.addChild(name)
    rt.heroLayer.addChild(view)
  }
}

async function paintTownMapProps(
  rt: TownMapPixiRuntime,
  shown: TownMapPlan,
  mapSeed: number,
): Promise<void> {
  rt.propLayer.removeChildren()
  for (const prop of shown.props) {
    const cell = shown.grid.byNumber.get(prop.hex)
    if (!cell) {
      continue
    }
    const texture = await loadPropTexture(prop.fileName, prop.variant)
    if (!texture) {
      continue
    }
    const { width, height } = cellSpan(cell)
    const sprite = new Sprite()
    rt.propLayer.addChild(sprite)
    layoutWorldMapPropSprite(
      sprite,
      texture,
      cell.center.x,
      cell.center.y,
      width,
      height,
      {
        renderScale: prop.renderScale,
        wall: false,
        mapSeed,
        q: cell.q,
        r: cell.r,
        flipped: prop.flipped,
      },
    )
    if (shown.flipped) {
      sprite.scale.x = -Math.abs(sprite.scale.x)
    }
    sprite.zIndex = Math.round(sprite.y * 1000)
  }
  rt.propLayer.sortChildren()
}

async function paintTownMapStructures(
  rt: TownMapPixiRuntime,
  shown: TownMapPlan,
  artCache: Map<string, Texture | null>,
): Promise<void> {
  rt.structureLayer.removeChildren()
  const urls = new Set<string>()
  for (const slot of shown.slots) {
    if (slot.artUrl) {
      urls.add(slot.artUrl)
    }
  }
  await Promise.all(
    [...urls].map(async (url) => {
      if (!artCache.has(url)) {
        artCache.set(url, await loadTextureUrl(url))
      }
    }),
  )
  for (const slot of shown.slots) {
    const hexes = slot.built
      ? slot.pictureHexes
      : slot.signHex != null
        ? [slot.signHex]
        : []
    const box = hexesBoundingBox(shown.grid, hexes)
    if (!box) {
      continue
    }
    drawFittedPicture(
      rt.structureLayer,
      slot.artUrl ? (artCache.get(slot.artUrl) ?? null) : null,
      slot.artLabel,
      box,
      {
        scale: slot.built ? slot.scale : 1,
        dx: slot.built ? slot.dx : 0,
        dy: slot.built ? slot.dy : 0,
        flipX: shown.flipped,
        dimmed: slot.dimmed,
      },
    )
  }
}

function paintTownMapDebug(
  rt: TownMapPixiRuntime,
  shown: TownMapPlan,
  showHexNumbers: boolean,
): void {
  rt.debugLayer.removeChildren()
  if (!showHexNumbers) {
    return
  }
  const stats = shown.propStats
  const summary = new Text({
    text: `Props: ${stats.eligibleTypes} eligible types for ${stats.terrainName}, ${stats.placed} placed`,
    style: {
      fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
      fontSize: 14,
      fontWeight: '600',
      fill: 0xffffff,
      stroke: { color: 0x111111, width: 3 },
    },
  })
  summary.position.set(16, 56)
  rt.debugLayer.addChild(summary)

  for (const cell of shown.grid.cells) {
    const outline = new Graphics()
    outline.poly(cell.corners)
    outline.stroke({ width: 1, color: 0xffee88, alpha: 0.95 })
    rt.debugLayer.addChild(outline)
    const label = new Text({
      text: String(cell.n),
      style: {
        fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
        fontSize: 12,
        fontWeight: '700',
        fill: 0xffffff,
        stroke: { color: 0x111111, width: 3 },
      },
      anchor: 0.5,
    })
    label.position.set(cell.center.x, cell.center.y)
    rt.debugLayer.addChild(label)
  }
}

export function TownMapView({
  townId,
  showHexNumbers,
  preferredHeroId = null,
  onSlotClick,
}: TownMapViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const onSlotClickRef = useRef(onSlotClick)
  onSlotClickRef.current = onSlotClick
  const session = useSyncExternalStore(subscribe, getSession)
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const [tip, setTip] = useState<TipState | null>(null)
  const town = findTownById(session, townId)
  const terrainName =
    (town ? getTile(town.position.q, town.position.r)?.terrain?.trim() : '') ||
    'Grass'
  const plan =
    town && catalog
      ? planTownMap(session, catalog, town, terrainName, preferredHeroId)
      : null
  const planRef = useRef<TownMapPlan | null>(plan)
  planRef.current = plan
  const pixiRef = useRef<TownMapPixiRuntime | null>(null)
  const artCacheRef = useRef(new Map<string, Texture | null>())
  const paintGenRef = useRef(0)
  const showHexNumbersRef = useRef(showHexNumbers)
  showHexNumbersRef.current = showHexNumbers

  const baseDrawKey = plan
    ? JSON.stringify({
        townId,
        flipped: plan.flipped,
        terrainName,
        seed: session.game?.seed ?? 0,
        images: catalog ? mapUseTerrainImages(catalog) : false,
        entry: plan.entry,
        road: plan.road,
        heroes: plan.heroes.map((hero) => [
          hero.id,
          hero.class_id,
          hero.name,
          hero.travel_facing ?? '',
          hero.player_id,
        ]),
        heroHexes: plan.heroHexes,
        props: plan.props,
      })
    : `${townId}:empty`

  const structureDrawKey = plan
    ? JSON.stringify(
        plan.slots.map((slot) => [
          slot.slot,
          slot.built,
          slot.artUrl,
          slot.dimmed,
          slot.scale,
          slot.dx,
          slot.dy,
          slot.pictureHexes,
          slot.signHex,
        ]),
      )
    : ''

  const baseDrawKeyRef = useRef(baseDrawKey)
  baseDrawKeyRef.current = baseDrawKey
  const structureDrawKeyRef = useRef(structureDrawKey)
  structureDrawKeyRef.current = structureDrawKey

  const runPaintRef = useRef<() => void>(() => {})
  runPaintRef.current = () => {
    const rt = pixiRef.current
    const shown = planRef.current
    const cat = getCachedCatalog()
    if (!rt || !shown || !cat) {
      return
    }
    const baseKey = baseDrawKeyRef.current
    const gen = ++paintGenRef.current
    void (async () => {
      try {
        const mapSeed = getSession().game?.seed ?? 0
        if (rt.lastBaseKey !== baseKey) {
          await paintTownMapBase(rt, shown, cat, mapSeed >>> 0)
          if (gen !== paintGenRef.current) {
            return
          }
          rt.lastBaseKey = baseKey
        }
        await paintTownMapStructures(rt, shown, artCacheRef.current)
        if (gen !== paintGenRef.current) {
          return
        }
        await paintTownMapProps(rt, shown, mapSeed >>> 0)
        if (gen !== paintGenRef.current) {
          return
        }
        paintTownMapDebug(rt, shown, showHexNumbersRef.current)
      } catch (error) {
        console.error('[town map] Pixi draw failed', error)
      }
    })()
  }

  useEffect(() => {
    runPaintRef.current()
  }, [baseDrawKey, structureDrawKey, showHexNumbers])

  useEffect(() => {
    const host = hostRef.current
    const canvasHost = canvasRef.current
    if (!host || !canvasHost || !catalog) {
      return
    }
    let cancelled = false

    const slotAt = (x: number, y: number) => {
      const live = planRef.current
      if (!live) {
        return null
      }
      const cell = townHexAtPoint(live.grid, x, y)
      if (!cell) {
        return null
      }
      const slotId = live.hexSlot.get(cell.n)
      if (slotId == null) {
        return null
      }
      return live.slots.find((row) => row.slot === slotId) ?? null
    }

    const onPointerMove = (event: PointerEvent) => {
      const point = stagePoint(event, host)
      const slot = slotAt(point.x, point.y)
      const canvas = canvasHost.querySelector('canvas')
      if (canvas) {
        canvas.style.cursor = slot ? 'pointer' : 'default'
      }
      if (!slot) {
        setTip(null)
        return
      }
      setTip({
        text: slot.tip,
        x: point.x + 14,
        y: point.y + 14,
      })
    }
    const onPointerLeave = () => setTip(null)
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return
      }
      const point = stagePoint(event, host)
      const slot = slotAt(point.x, point.y)
      if (!slot) {
        return
      }
      onSlotClickRef.current(slot.slot)
    }

    void (async () => {
      const instance = new Application()
      await instance.init({
        background: 0x1a1a1a,
        width: GAME_WINDOW_WIDTH,
        height: GAME_WINDOW_HEIGHT,
        antialias: true,
        resolution: 1,
        autoDensity: true,
      })
      if (cancelled) {
        instance.destroy()
        return
      }
      canvasHost.replaceChildren(instance.canvas)
      const root = new Container()
      instance.stage.addChild(root)
      const terrainLayer = new Container()
      const roadLayer = new Graphics()
      const structureLayer = new Container()
      structureLayer.sortableChildren = true
      const propLayer = new Container()
      propLayer.sortableChildren = true
      const heroLayer = new Container()
      heroLayer.sortableChildren = true
      const debugLayer = new Container()
      root.addChild(
        terrainLayer,
        roadLayer,
        structureLayer,
        propLayer,
        heroLayer,
        debugLayer,
      )
      pixiRef.current = {
        app: instance,
        terrainLayer,
        roadLayer,
        structureLayer,
        propLayer,
        heroLayer,
        debugLayer,
        lastBaseKey: '',
      }
      runPaintRef.current()
    })()

    host.addEventListener('pointermove', onPointerMove)
    host.addEventListener('pointerleave', onPointerLeave)
    host.addEventListener('pointerdown', onPointerDown)
    return () => {
      cancelled = true
      paintGenRef.current += 1
      setTip(null)
      host.removeEventListener('pointermove', onPointerMove)
      host.removeEventListener('pointerleave', onPointerLeave)
      host.removeEventListener('pointerdown', onPointerDown)
      const pixiApp = pixiRef.current?.app
      if (pixiApp) {
        pixiApp.canvas.remove()
        pixiApp.destroy(false, { children: true })
      }
      pixiRef.current = null
      canvasHost.replaceChildren()
    }
  }, [townId, catalog])

  return (
    <div
      ref={hostRef}
      className="town-map-host"
      data-town-map=""
      data-town-flipped={plan?.flipped ? 'true' : 'false'}
      data-terrain={terrainName}
      data-empty-footprint-slots={plan?.emptyFootprintSlots.join(',') ?? ''}
      data-unplaced-slots={plan?.unplacedSlots.join(',') ?? ''}
    >
      <div ref={canvasRef} className="town-map-canvas" />
      {catalog && townId && !plan ? (
        <p className="town-building-layout-error town-map-fallback">
          {town
            ? 'Town map could not be built — check the browser console.'
            : 'Town data is missing from this session.'}
        </p>
      ) : null}
      {tip ? (
        <div
          className="world-hover-tip town-map-tip"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.text}
        </div>
      ) : null}
    </div>
  )
}
