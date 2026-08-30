import { useEffect, useRef } from 'react'
import { Application, Container, Graphics, Text } from 'pixi.js'
import type { Hex } from 'honeycomb-grid'
import { clampCamera, PAN_SPEED_PX_PER_SEC } from './camera'
import {
  CLICK_PAN_THRESHOLD_PX,
  MAX_MOVEMENT_POINTS,
  MOVE_STEP_MS,
  PLAYER_1_COLOR,
  findPassableStart,
  movementSteps,
  spendHeroInteract,
  spendMovement,
  VISION_RANGE,
  type Axial,
} from './hero'
import { approachHex, hexDistance } from './pathfinding'
import { type HeroHudState } from './debug'
import {
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
import { buildWorld, fetchTestGrid, getTile, getExploredHexes, isExplored, markExplored, restoreExplored, TERRAIN_COLORS } from './world'
import type { MapObjectData, TestGridResponse } from './types'
import { mapObjectResourceId, mapObjectTownTypeId } from './types'
import { getSession, subscribe, updateSession } from '../session/store'
import { ensureStartingHeroes, hydrateMapObjects } from '../session/create'
import { HERO_ID } from '../session/types'
import { fetchCatalog, ownerTint, subscribeCatalog } from '../town/catalog'
import {
  activePlayer,
  claimMine,
  claimTown,
  collectPickup,
  findNodeAt,
  findTownAt,
  persistActiveExplored,
  syncHero,
  walletFromSession,
} from '../session/accessors'

type HexMapProps = {
  hexSize: number
  wallet: ResourceWallet
  heroName: string
  onMapInfo: (info: { width: number; height: number; seed: number }) => void
  onHeroState: (state: HeroHudState) => void
  onResources: (wallet: ResourceWallet) => void
  onTownWelcome: (townName: string, townId: string) => void
  onHeroMeet: (targetHeroId: string) => void
}

type HeroState = HeroHudState

let cachedGrid: TestGridResponse | null = null
let applyHeroMovement: ((remaining: number) => void) | null = null
let panMapToHex: ((q: number, r: number) => void) | null = null
let applyHeroMarkerLabel: ((name: string) => void) | null = null
let selectMapHero: ((id: string) => void) | null = null
let selectedMapHeroId: string | null = null
let applyHotseatView: (() => void) | null = null

export function clearCachedGrid(): void {
  cachedGrid = null
}

export function centerMapOnHex(q: number, r: number): void {
  panMapToHex?.(q, r)
}

/** Switch which hero click-to-move and the camera follow. */
export function selectHeroOnMap(id: string): void {
  selectedMapHeroId = id
  selectMapHero?.(id)
}

export function syncActivePlayerView(): void {
  applyHotseatView?.()
}

export function getSelectedMapHeroId(): string | null {
  return selectedMapHeroId
}

/** Test helper — sets remaining steps on the live hero (session + map). */
export function setHeroMovementRemaining(remaining: number): void {
  if (applyHeroMovement) {
    applyHeroMovement(remaining)
    return
  }
  updateSession((current) => {
    const hero =
      current.heroes.find((row) => row.id === selectedMapHeroId) ??
      current.heroes[0]
    if (!hero) {
      return current
    }
    return syncHero(current, hero.position, remaining, hero.id)
  })
}

function gridHasResourceIds(grid: TestGridResponse): boolean {
  const nodes = (grid.objects ?? []).filter(
    (obj) => obj.kind === 'mine' || obj.kind === 'pickup',
  )
  return (
    nodes.length === 0 ||
    nodes.every((obj) => mapObjectResourceId(obj) != null)
  )
}

/** Unexplored overlay — very dark grey, not pure black. */
const UNEXPLORED_COLOR = 0x3a3a3a

/**
 * Explored map objects to path around. Heroes are always blocked.
 * Towns and resource nodes are blocked unless they are `walkOnto`
 * (the clicked destination).
 */
function obstacleHexes(mover: Axial, walkOnto?: Axial | null): Set<string> {
  const blocked = new Set<string>()
  const ontoKey =
    walkOnto != null ? `${walkOnto.q},${walkOnto.r}` : ''
  const add = (q: number, r: number) => {
    if (q === mover.q && r === mover.r) {
      return
    }
    if (!isExplored(q, r)) {
      return
    }
    const hexKey = `${q},${r}`
    if (ontoKey && hexKey === ontoKey) {
      return
    }
    blocked.add(hexKey)
  }
  const session = getSession()
  for (const hero of session.heroes) {
    add(hero.position.q, hero.position.r)
  }
  for (const town of session.towns) {
    add(town.position.q, town.position.r)
  }
  for (const node of session.nodes) {
    if (node.kind === 'pickup' && node.collected) {
      continue
    }
    add(node.position.q, node.position.r)
  }
  return blocked
}

function heroVisibleOnMap(hero: { player_id: string; position: { q: number; r: number } }): boolean {
  const actor = activePlayer(getSession())
  if (actor && hero.player_id === actor.id) {
    return true
  }
  return isExplored(hero.position.q, hero.position.r)
}

function otherHeroAt(q: number, r: number, selfId: string) {
  return getSession().heroes.find(
    (hero) =>
      hero.id !== selfId &&
      hero.position.q === q &&
      hero.position.r === r &&
      heroVisibleOnMap(hero),
  )
}

function liveNodeAt(q: number, r: number) {
  const node = findNodeAt(getSession(), q, r)
  if (!node || (node.kind === 'pickup' && node.collected)) {
    return undefined
  }
  return node
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
  wallet,
  heroName,
  onMapInfo,
  onHeroState,
  onResources,
  onTownWelcome,
  onHeroMeet,
}: HexMapProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const tilesRef = useRef<TestGridResponse | null>(null)
  const heroRef = useRef<HeroState | null>(null)
  const walletRef = useRef<ResourceWallet>(snapshotWallet(wallet))
  const onHeroMeetRef = useRef(onHeroMeet)

  useEffect(() => {
    walletRef.current = snapshotWallet(wallet)
  }, [wallet])

  useEffect(() => {
    onHeroMeetRef.current = onHeroMeet
  }, [onHeroMeet])

  useEffect(() => {
    applyHeroMarkerLabel?.(heroName)
  }, [heroName])

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
      const colorsReady = fetchCatalog().catch(() => {})
      const needsGrid = !cachedGrid || !gridHasResourceIds(cachedGrid)
      if (needsGrid) {
        const savedSeed = getSession().game.seed
        cachedGrid = await fetchTestGrid(savedSeed > 0 ? savedSeed : undefined)
      }
      tilesRef.current = cachedGrid
      if (!tilesRef.current) {
        return
      }
      const { tiles, seed, objects } = tilesRef.current
      if (cancelled || tiles.length === 0) {
        return
      }

      const { grid, layout, width, height } = buildWorld(tiles, hexSize)
      onMapInfo({ width, height, seed })
      if (needsGrid) {
        restoreExplored(activePlayer(getSession())?.explored)
      }

      if (!heroRef.current) {
        const actor = activePlayer(getSession())
        const heroes = getSession().heroes
        const existing =
          (actor
            ? heroes.find(
                (row) =>
                  row.id === selectedMapHeroId && row.player_id === actor.id,
              ) ?? heroes.find((row) => row.player_id === actor.id)
            : null) ?? heroes[0]
        if (existing) {
          selectedMapHeroId = existing.id
          heroRef.current = {
            id: existing.id,
            q: existing.position.q,
            r: existing.position.r,
            remaining: existing.movement_remaining,
          }
        } else {
          const start = findPassableStart(grid)
          selectedMapHeroId = HERO_ID
          heroRef.current = {
            id: HERO_ID,
            q: start.q,
            r: start.r,
            remaining: MAX_MOVEMENT_POINTS,
          }
        }
      }
      const spawned = heroRef.current
      if (!spawned) {
        return
      }
      applyHeroMovement = (remaining) => {
        if (!heroRef.current) {
          return
        }
        heroRef.current.remaining = remaining
        onHeroState({
          id: heroRef.current.id,
          q: heroRef.current.q,
          r: heroRef.current.r,
          remaining: heroRef.current.remaining,
        })
        const hero = heroRef.current
        updateSession((current) =>
          syncHero(current, { q: hero.q, r: hero.r }, remaining, hero.id),
        )
      }
      updateSession((current) =>
        ensureStartingHeroes(
          hydrateMapObjects(
            { ...current, game: { ...current.game, seed } },
            objects ?? [],
          ),
          { q: spawned.q, r: spawned.r },
        ),
      )
      const after = getSession()
      const actor = activePlayer(after)
      const ownHero = actor
        ? after.heroes.find((hero) => hero.player_id === actor.id)
        : after.heroes[0]
      if (ownHero) {
        selectedMapHeroId = ownHero.id
        heroRef.current = {
          id: ownHero.id,
          q: ownHero.position.q,
          r: ownHero.position.r,
          remaining: ownHero.movement_remaining,
        }
      }
      if (!heroRef.current) {
        return
      }
      walletRef.current = walletFromSession(after)
      onHeroState({
        id: heroRef.current.id,
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
      await colorsReady
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

      const heroLayer = new Container()
      const heroMarkers = new Map<
        string,
        { view: Container; label: Text; badge: Graphics }
      >()
      world.addChild(heroLayer)
      instance.stage.addChild(world)

      const objectByKey = new Map<
        string,
        { data: MapObjectData; view: Container; badge: Graphics; label: Text }
      >()

      const paintObjectBadge = (target: Graphics, fill: number) => {
        target.clear()
        target.circle(0, 0, hexSize * 0.42)
        target.fill({ color: fill })
        target.stroke({ width: 2, color: 0x111111 })
      }

      const townFill = (playerId: string | null | undefined) =>
        ownerTint(playerId) ?? NEUTRAL_OBJECT_COLOR

      const addObjectView = (obj: MapObjectData) => {
        const sessionNow = getSession()
        const node = findNodeAt(sessionNow, obj.q, obj.r)
        if (obj.kind === 'pickup' && (obj.collected || node?.collected)) {
          return
        }
        const view = new Container()
        const objectBadge = new Graphics()
        const town = obj.kind === 'town' ? findTownAt(sessionNow, obj.q, obj.r) : undefined
        const mineOwned =
          obj.kind === 'mine' && (!!obj.claimed || node?.player_id != null)
        const fill =
          obj.kind === 'town'
            ? townFill(town?.player_id)
            : mineOwned
              ? PLAYER_1_COLOR
              : NEUTRAL_OBJECT_COLOR
        const labeledOwned = obj.kind === 'town' ? town?.player_id != null : mineOwned
        paintObjectBadge(objectBadge, fill)
        const objectLabel = new Text({
          text: obj.marker,
          style: {
            fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
            fontSize: Math.max(9, Math.round(hexSize * 0.55)),
            fontWeight: '700',
            fill: labeledOwned ? 0xffffff : 0x111111,
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
          updateSession((current) =>
            claimTown(current, q, r, {
              name: obj.name ?? undefined,
              townTypeId: mapObjectTownTypeId(obj),
            }),
          )
          const claimedTown = findTownAt(getSession(), q, r)
          paintObjectBadge(entry.badge, townFill(claimedTown?.player_id))
          entry.label.style.fill = claimedTown?.player_id != null ? '#ffffff' : '#111111'
          if (!obj.claimed && claimedTown?.player_id != null) {
            obj.claimed = true
          }
          onTownWelcome(
            claimedTown?.name ?? (obj.name?.trim() || 'Town'),
            claimedTown?.id ?? '',
          )
          return
        }

        const node = findNodeAt(getSession(), q, r)
        const resourceId = mapObjectResourceId(obj) ?? node?.resource_id
        const kind = obj.kind === 'pickup' || node?.kind === 'pickup' ? 'pickup' : obj.kind

        if (kind === 'pickup') {
          if (obj.collected || node?.collected) {
            return
          }
          if (typeof resourceId !== 'number') {
            return
          }
          obj.collected = true
          updateSession((current) =>
            collectPickup(current, q, r, resourceId, PICKUP_AMOUNT),
          )
          walletRef.current = walletFromSession(getSession())
          objectLayer.removeChild(entry.view)
          entry.view.destroy({ children: true })
          objectByKey.delete(key)
          emitResources()
          return
        }

        if (obj.kind !== 'mine' && node?.kind !== 'mine') {
          return
        }
        if (obj.claimed || node?.player_id != null) {
          if (!obj.claimed && node?.player_id != null) {
            obj.claimed = true
            paintObjectBadge(entry.badge, PLAYER_1_COLOR)
            entry.label.style.fill = '#ffffff'
          }
          return
        }
        obj.claimed = true
        updateSession((current) => claimMine(current, q, r, resourceId))
        walletRef.current = walletFromSession(getSession())
        paintObjectBadge(entry.badge, PLAYER_1_COLOR)
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
        updateSession((current) =>
          persistActiveExplored(current, getExploredHexes()),
        )
      }

      const placeHeroMarkers = () => {
        const sessionHeroes = getSession().heroes
        const counts = new Map<string, number>()
        const indexOnHex = new Map<string, number>()
        for (const hero of sessionHeroes) {
          if (!heroVisibleOnMap(hero)) {
            continue
          }
          const hexKey = `${hero.position.q},${hero.position.r}`
          const n = counts.get(hexKey) ?? 0
          indexOnHex.set(hero.id, n)
          counts.set(hexKey, n + 1)
        }
        const seen = new Set<string>()
        for (const hero of sessionHeroes) {
          seen.add(hero.id)
          let entry = heroMarkers.get(hero.id)
          if (!entry) {
            const view = new Container()
            const badge = new Graphics()
            const label = new Text({
              text: hero.name,
              style: {
                fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
                fontSize: Math.max(10, Math.round(hexSize * 0.7)),
                fontWeight: '700',
                fill: 0xffffff,
              },
              anchor: 0.5,
            })
            view.addChild(badge, label)
            heroLayer.addChild(view)
            entry = { view, label, badge }
            heroMarkers.set(hero.id, entry)
          } else {
            entry.label.text = hero.name
          }
          const visible = heroVisibleOnMap(hero)
          entry.view.visible = visible
          if (!visible) {
            continue
          }
          const selected = heroRef.current?.id === hero.id
          entry.badge.clear()
          entry.badge.circle(0, 0, hexSize * (selected ? 0.62 : 0.55))
          entry.badge.fill({
            color: ownerTint(hero.player_id) ?? NEUTRAL_OBJECT_COLOR,
          })
          entry.badge.stroke({
            width: selected ? 3 : 2,
            color: selected ? 0xffffff : 0x111111,
          })
          const hex = grid.getHex(hero.position) ?? grid.createHex(hero.position)
          const center = hexCenter(hex, offsetX, offsetY)
          const hexKey = `${hero.position.q},${hero.position.r}`
          const count = counts.get(hexKey) ?? 1
          const index = indexOnHex.get(hero.id) ?? 0
          const spread =
            count > 1 ? (index - (count - 1) / 2) * hexSize * 0.45 : 0
          entry.view.position.set(center.x + spread, center.y)
        }
        for (const [id, entry] of heroMarkers) {
          if (seen.has(id)) {
            continue
          }
          heroLayer.removeChild(entry.view)
          entry.view.destroy({ children: true })
          heroMarkers.delete(id)
        }
      }
      applyHeroMarkerLabel = () => {
        placeHeroMarkers()
      }

      const panToHex = (q: number, r: number) => {
        const hex = grid.getHex({ q, r }) ?? grid.createHex({ q, r })
        const center = hexCenter(hex, offsetX, offsetY)
        camera.x = center.x - instance.screen.width / 2
        camera.y = center.y - instance.screen.height / 2
        applyCamera()
      }
      panMapToHex = panToHex

      const followHero = () => {
        const hero = heroRef.current
        if (!hero) {
          return
        }
        panToHex(hero.q, hero.r)
      }
      const switchToMapHero = (id: string) => {
        const session = getSession()
        const actor = activePlayer(session)
        const row = session.heroes.find((hero) => hero.id === id)
        if (!row || !actor || row.player_id !== actor.id) {
          return
        }
        selectedMapHeroId = row.id
        moveGen += 1
        moving = false
        heroRef.current = {
          id: row.id,
          q: row.position.q,
          r: row.position.r,
          remaining: row.movement_remaining,
        }
        onHeroState({
          id: row.id,
          q: row.position.q,
          r: row.position.r,
          remaining: row.movement_remaining,
        })
        panToHex(row.position.q, row.position.r)
        exploreAround(heroRef.current)
        placeHeroMarkers()
      }
      selectMapHero = switchToMapHero

      applyHotseatView = () => {
        const session = getSession()
        const player = activePlayer(session)
        restoreExplored(player?.explored)
        paintFog()
        paintTexturedHexes()
        walletRef.current = walletFromSession(session)
        emitResources()
        const ownHero = player
          ? session.heroes.find((hero) => hero.player_id === player.id)
          : undefined
        if (ownHero) {
          switchToMapHero(ownHero.id)
          return
        }
        selectedMapHeroId = null
        heroRef.current = null
        placeHeroMarkers()
      }

      const paintOwnedTownColors = () => {
        const sessionNow = getSession()
        for (const entry of objectByKey.values()) {
          if (entry.data.kind !== 'town') {
            continue
          }
          const town = findTownAt(sessionNow, entry.data.q, entry.data.r)
          const fill = townFill(town?.player_id)
          paintObjectBadge(entry.badge, fill)
          entry.label.style.fill = town?.player_id != null ? '#ffffff' : '#111111'
        }
      }
      placeHeroMarkers()
      paintOwnedTownColors()
      const unsubHeroes = subscribe(() => {
        placeHeroMarkers()
        paintOwnedTownColors()
      })
      const unsubCatalog = subscribeCatalog(() => {
        placeHeroMarkers()
        paintOwnedTownColors()
      })
      signal.addEventListener('abort', unsubHeroes, { once: true })
      signal.addEventListener('abort', unsubCatalog, { once: true })
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
        const occupant = otherHeroAt(hex.q, hex.r, hero.id)
        const town = findTownAt(getSession(), hex.q, hex.r)
        const node = liveNodeAt(hex.q, hex.r)
        const walkOnto = !occupant && (town || node) ? hex : null
        const hoverBlocked = obstacleHexes(hero, walkOnto)
        const hoverKey = `${hero.q},${hero.r},${hero.remaining}->${hex.q},${hex.r}|${walkOnto ? 'on' : 'off'}|${[...hoverBlocked].sort().join(';')}`
        if (hoverKey === lastHoverKey) {
          return
        }
        lastHoverKey = hoverKey
        const dest = occupant
          ? approachHex(hero, occupant.position, hoverBlocked)
          : hex
        if (!dest || (dest.q === hero.q && dest.r === hero.r)) {
          preview.clear()
          return
        }
        const steps = movementSteps(grid, hero, dest, hero.remaining, hoverBlocked)
        if (steps.length === 0) {
          preview.clear()
          return
        }
        drawPreview(steps)
      }

      const tryMoveTo = (to: Axial, after?: () => void, walkOnto?: Axial | null) => {
        const hero = heroRef.current
        if (!hero || moving) {
          return
        }
        if (to.q === hero.q && to.r === hero.r) {
          after?.()
          return
        }
        if (hero.remaining <= 1e-9) {
          return
        }
        const steps = movementSteps(
          grid,
          hero,
          to,
          hero.remaining,
          obstacleHexes(hero, walkOnto),
        )
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
              id: heroRef.current.id,
              q: heroRef.current.q,
              r: heroRef.current.r,
              remaining: heroRef.current.remaining,
            })
            const moved = heroRef.current
            if (!moved) {
              break
            }
            updateSession((current) =>
              syncHero(
                current,
                { q: moved.q, r: moved.r },
                moved.remaining,
                moved.id,
              ),
            )
            placeHeroMarkers()
            exploreAround(heroRef.current)
            resolveHex(heroRef.current.q, heroRef.current.r)
            followHero()
            await sleep(MOVE_STEP_MS, signal)
          }
          if (gen === moveGen) {
            moving = false
            after?.()
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
        const hero = heroRef.current
        if (!hero) {
          return
        }
        const occupant = otherHeroAt(hex.q, hex.r, hero.id)
        if (occupant) {
          const meet = () => {
            const mover = heroRef.current
            const live = getSession().heroes.find((row) => row.id === occupant.id)
            if (!mover || !live) {
              return
            }
            if (hexDistance(mover, live.position) > 1) {
              return
            }
            mover.remaining = spendHeroInteract(mover.remaining)
            onHeroState({
              id: mover.id,
              q: mover.q,
              r: mover.r,
              remaining: mover.remaining,
            })
            updateSession((current) =>
              syncHero(
                current,
                { q: mover.q, r: mover.r },
                mover.remaining,
                mover.id,
              ),
            )
            onHeroMeetRef.current(occupant.id)
          }
          if (hexDistance(hero, occupant.position) <= 1) {
            meet()
            return
          }
          const dest = approachHex(
            hero,
            occupant.position,
            obstacleHexes(hero),
          )
          if (!dest) {
            return
          }
          tryMoveTo(dest, meet)
          return
        }
        const town = findTownAt(getSession(), hex.q, hex.r)
        if (town) {
          if (hero.q === town.position.q && hero.r === town.position.r) {
            resolveHex(town.position.q, town.position.r)
            return
          }
          tryMoveTo(hex, undefined, hex)
          return
        }
        const node = liveNodeAt(hex.q, hex.r)
        if (node) {
          tryMoveTo(hex, undefined, hex)
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
          if (!isArrow(event.key) || moving) {
            return
          }
          event.preventDefault()
          keys.add(event.key)
        },
        { signal, capture: true },
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
      applyHeroMovement = null
      panMapToHex = null
      applyHeroMarkerLabel = null
      selectMapHero = null
      applyHotseatView = null
      abort.abort()
      app?.destroy()
    }
  }, [hexSize, onMapInfo, onHeroState, onResources, onTownWelcome])

  return <div ref={hostRef} className="hex-map" tabIndex={0} />
}
