import { useEffect, useRef } from 'react'
import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js'
import type { Hex } from 'honeycomb-grid'
import { clampCamera, PAN_SPEED_PX_PER_SEC } from './camera'
import {
  CLICK_PAN_THRESHOLD_PX,
  MOVE_STEP_MS,
  findPassableStart,
  formatMp,
  movementSteps,
  sailMovementSteps,
  boardBoatMovementSteps,
  resolveWorldWaypointLeg,
  spendHeroInteract,
  spendMovement,
  type Axial,
} from './hero'
import { approachHex, hexDistance, neighborHexes } from './pathfinding'
import {
  boatEnterCost,
  boatOccupiedByHero,
  canSailOnto,
  enemyBoatOccupantAt,
  findBoatAt,
  isDisembarkLandHex,
} from './boat'
import { heroTravelSprite, loadTravelTexture, preloadHeroTravelSprites, HERO_TRAVEL_FILES } from './heroTravelSprite'
import { strokeDashedPolyline, strokeRoadSegments } from './roadRender'
import { flightSegmentSteps, townCircleLapSteps } from './flight'
import {
  createWaypointPlan,
  tryAppendWaypoint,
  type WaypointPlan,
} from './waypoints'
import { type HeroHudState } from './debug'
import {
  formatAmount,
  NEUTRAL_OBJECT_COLOR,
  snapshotWallet,
  type ResourceWallet,
} from './resources'
import {
  loadHexTerrainTextures,
  loadTextureUrl,
} from './terrainTextures'
import {
  addPropSprite,
  finishWorldMapFeatureSprite,
  layoutHexFootprintSprite,
  layoutHexSprite,
  loadPropTexture,
  type PropCullBox,
} from './propTextures'
import {
  WorldChunkRenderer,
  setWorldRenderStats,
} from './worldRenderChunks'
import { loadFeatureTexture } from './featureTextures'
import {
  chestClosedImage,
  chestOpenImage,
  featureForChest,
  featureForFountain,
  featureForSign,
  featureForWorldLibrary,
  featureForWorldHanger,
  featureForWorldDock,
  featureForWorldRecruits,
  featureForNoticeBoard,
  featureForTownType,
  featureRowForMapObject,
  townBlockedHex,
  townEntryHex,
  townFootprintBottomRow,
  townFootprintOrigin,
} from './townFootprint'
import {
  hexTransitionMoveCost,
} from './terrainTransition'
import { buildWorld, fetchTestGridOnce, forEachTile, getTile, getExploredHexes, isExplored, markExplored, restoreExplored } from './world'
import { worldHoverTooltipText } from './worldTooltip'
import type { MapObjectData, TestGridResponse } from './types'
import { mapObjectResourceId, mapObjectTownTypeId } from './types'
import { getSession, subscribe, updateSession } from '../session/store'
import {
  ensureStartingHeroes,
  hydrateMapObjects,
} from '../session/create'
import {
  findMobAt,
  mobLabel,
  mobLeadStack,
  mobUnitQty,
  seedWorldMobs,
} from '../session/mobs'
import { HERO_ID } from '../session/types'
import { featureRenderScale, fetchCatalog, featureForResource, flightSpeed, getCachedCatalog, heroMovementPoints, mapShowHexesWorld, mapUseTerrainImages, ownerTint, subscribeCatalog, unitById, visionRange } from '../town/catalog'
import { unitPortraitUrl } from '../town/slotArt'
import {
  activePlayer,
  claimMine,
  claimTown,
  collectPickup,
  findChestAt,
  findFountainAt,
  findNodeAt,
  findSignAt,
  findWorldLibraryAt,
  findWorldHangerAt,
  findTownAt,
  openChest,
  persistActiveExplored,
  syncHero,
  syncHeroFlightPosition,
  finalizeHeroFlightSegment,
  townIsUndefended,
  walletFromSession,
  applyFountainVisit,
  applyHeroTownVisitUniques,
  takeArchiveLearnNotice,
  findTownById,
  type ArchiveLearnNotice,
} from '../session/accessors'
import {
  boardBoat,
  disembarkBoat,
  findWorldDockAt,
  syncHeroBoatPosition,
} from '../session/boat'
import { findWorldRecruitsAt } from '../session/recruits'
import {
  findNoticeBoardAt,
  noticeBoardTooltip,
} from '../session/quests'
import { readSign, signTooltipText } from '../session/sign'
import {
  openWorldLibraryVisit,
  worldLibraryTooltipText,
} from '../town/WorldLibrary'

type HexMapProps = {
  hexSize: number
  wallet: ResourceWallet
  heroName: string
  onMapInfo: (info: { width: number; height: number; seed: number }) => void
  onHeroState: (state: HeroHudState) => void
  onResources: (wallet: ResourceWallet) => void
  onTownWelcome: (townName: string, townId: string) => void
  /** Fountain restore popup (human only). */
  onFountainRestore?: (message: string) => void
  /** Chest XP/Loot/Leave choice (human only). */
  onChestOffer?: (offer: {
    featureId: string
    title: string
    heroId: string
  }) => void
  /** Sign read popup (human only). */
  onSignRead?: (text: string) => void
  /** World Library panel (human only). */
  onWorldLibrary?: (offer: { featureId: string; heroId: string }) => void
  /** World Hanger flight picker (human only). */
  onWorldHanger?: (offer: { featureId: string; heroId: string }) => void
  /** World Dock buy-boat popup (human only). */
  onWorldDock?: (offer: { featureId: string; heroId: string }) => void
  /** World Recruits for Hire panel (human only). */
  onWorldRecruits?: (offer: { featureId: string; heroId: string }) => void
  /** World Notice Board quest panel (human only). */
  onWorldNoticeBoard?: (offer: { featureId: string; heroId: string }) => void
  onArchiveLearn?: (notice: ArchiveLearnNotice) => void
  onHeroMeet: (targetHeroId: string) => void
  onSiegeTown: (townId: string) => void
  onMobMeet: (mobId: string) => void
  /** Debug: when false, skip terrain transition wedges (base fill only). */
  terrainWedgesEnabled?: boolean
  /** Debug: tint hexes by zone id and outline zone borders. */
  zonesDebug?: boolean
  /** Debug: highlight wall-gap hexes. */
  wallGapsDebug?: boolean
  /** Debug: planned road links before washout and orphan trim. */
  roadPlanDebug?: boolean
}

type HeroState = HeroHudState

let cachedGrid: TestGridResponse | null = null
let applyHeroMovement: ((remaining: number) => void) | null = null
let panMapToHex: ((q: number, r: number) => void) | null = null
let applyHeroMarkerLabel: ((name: string) => void) | null = null
let selectMapHero: ((id: string) => void) | null = null
let selectedMapHeroId: string | null = null
let applyHotseatView: (() => void) | null = null
/** DEV: block click-to-move / arrow pan while an AI turn is running. */
let mapInputLocked = false
/** Spectator follows the mover; plain AI does not yank the camera. */
let cameraFollowMoves = true
let requestMapMoveFn:
  | ((to: Axial, walkOnto?: Axial | null) => Promise<boolean>)
  | null = null
let playHeroFlightFn:
  | ((
      heroId: string,
    ) => Promise<{ arrivedTownId: string | null; siegeTownId: string | null }>)
  | null = null

export function setMapInputLocked(locked: boolean): void {
  mapInputLocked = locked
}

export function setMapCameraFollowMoves(follow: boolean): void {
  cameraFollowMoves = follow
}

export function requestMapMove(
  to: Axial,
  walkOnto?: Axial | null,
): Promise<boolean> {
  return requestMapMoveFn?.(to, walkOnto) ?? Promise.resolve(false)
}

/** Animate this turn's Hanger flight segment; lands / clears flight if arrived. */
export function requestPlayHeroFlight(
  heroId: string,
): Promise<{ arrivedTownId: string | null; siegeTownId: string | null }> {
  return (
    playHeroFlightFn?.(heroId) ??
    Promise.resolve({ arrivedTownId: null, siegeTownId: null })
  )
}

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

/**
 * Explored map objects to path around. Heroes are always blocked.
 * Defended enemy towns stay blocked (approach adjacent; never walk on).
 * Undefended enemy towns, own/unowned towns, resource nodes, and fountains
 * are blocked unless they are `walkOnto` (the clicked destination).
 */
function obstacleHexes(mover: Axial, walkOnto?: Axial | null): Set<string> {
  const blocked = new Set<string>()
  const ontoKey =
    walkOnto != null ? `${walkOnto.q},${walkOnto.r}` : ''
  const session = getSession()
  const self = session.heroes.find((hero) => hero.id === selectedMapHeroId)
  const playerId = self?.player_id ?? null
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
  for (const hero of session.heroes) {
    // Airborne heroes don't block ground paths.
    if (hero.flight) {
      continue
    }
    add(hero.position.q, hero.position.r)
  }
  for (const town of session.towns) {
    const entry = townEntryHex(town.position)
    const keep = townBlockedHex(town.position, town.flipped)
    // Keep hex is never walkable (asymmetric 2×1 footprint).
    if (isExplored(keep.q, keep.r) && !(keep.q === mover.q && keep.r === mover.r)) {
      blocked.add(`${keep.q},${keep.r}`)
    }
    const enemyOwned =
      town.player_id != null &&
      playerId != null &&
      town.player_id !== playerId
    if (enemyOwned && !townIsUndefended(session, town, self?.id)) {
      if (!(entry.q === mover.q && entry.r === mover.r)) {
        blocked.add(`${entry.q},${entry.r}`)
      }
      continue
    }
    add(entry.q, entry.r)
  }
  for (const node of session.nodes) {
    if (node.kind === 'pickup' && node.collected) {
      continue
    }
    add(node.position.q, node.position.r)
  }
  for (const feature of session.features ?? []) {
    // Chests are approach-only (never walkOnto); fountains allow walkOnto.
    add(feature.position.q, feature.position.r)
  }
  for (const mob of session.mobs) {
    add(mob.position.q, mob.position.r)
  }
  for (const boat of session.boats ?? []) {
    add(boat.position.q, boat.position.r)
  }
  return blocked
}

function sailDestForLandGoal(
  from: Axial,
  land: Axial,
  boatId: string,
  moverPlayerId: string,
): Axial | null {
  const session = getSession()
  let best: Axial | null = null
  let bestDist = Infinity
  for (const neighbor of neighborHexes(land)) {
    if (boatEnterCost(neighbor.q, neighbor.r) == null) {
      continue
    }
    if (!canSailOnto(session, neighbor.q, neighbor.r, boatId, moverPlayerId)) {
      continue
    }
    const dist = hexDistance(from, neighbor)
    if (dist < bestDist) {
      bestDist = dist
      best = neighbor
    }
  }
  return best
}

function zonePaintColor(index: number): number {
  const hue = (index * 137.508) % 360
  const s = 0.62
  const l = 0.52
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = hue / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) {
    r = c
    g = x
  } else if (hp < 2) {
    r = x
    g = c
  } else if (hp < 3) {
    g = c
    b = x
  } else if (hp < 4) {
    g = x
    b = c
  } else if (hp < 5) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  const m = l - c / 2
  const R = Math.round((r + m) * 255)
  const G = Math.round((g + m) * 255)
  const B = Math.round((b + m) * 255)
  return (R << 16) | (G << 8) | B
}

/** Smallest color index not used by an adjacent zone, so neighbours never match. */
function zoneColorIndex(
  zoneId: number,
  neighbors: ReadonlyMap<number, ReadonlySet<number>>,
  assigned: ReadonlyMap<number, number>,
): number {
  const used = new Set<number>()
  for (const other of neighbors.get(zoneId) ?? []) {
    const color = assigned.get(other)
    if (color != null) {
      used.add(color)
    }
  }
  let index = 0
  while (used.has(index)) {
    index++
  }
  return index
}

function edgeIsWalled(
  tile: { zoneId?: number | null; wallBorders?: number[] | null },
  other: { zoneId?: number | null; wallBorders?: number[] | null },
): boolean {
  if (tile.zoneId != null && other.wallBorders?.includes(tile.zoneId)) {
    return true
  }
  if (other.zoneId != null && tile.wallBorders?.includes(other.zoneId)) {
    return true
  }
  return false
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
      !hero.flight &&
      hero.position.q === q &&
      hero.position.r === r &&
      heroVisibleOnMap(hero),
  )
}

function visibleMobAt(q: number, r: number) {
  if (!isExplored(q, r)) {
    return undefined
  }
  return findMobAt(getSession(), q, r)
}

function enemyOwnedTownAt(q: number, r: number, selfId: string) {
  const session = getSession()
  const self = session.heroes.find((hero) => hero.id === selfId)
  if (!self) {
    return undefined
  }
  const town = findTownAt(session, q, r)
  if (!town?.player_id || town.player_id === self.player_id) {
    return undefined
  }
  return town
}

function liveNodeAt(q: number, r: number) {
  const node = findNodeAt(getSession(), q, r)
  if (!node || (node.kind === 'pickup' && node.collected)) {
    return undefined
  }
  return node
}

function liveFountainAt(q: number, r: number) {
  return findFountainAt(getSession(), q, r)
}

function liveChestAt(q: number, r: number) {
  return findChestAt(getSession(), q, r)
}

function liveSignAt(q: number, r: number) {
  return findSignAt(getSession(), q, r)
}

function liveWorldLibraryAt(q: number, r: number) {
  return findWorldLibraryAt(getSession(), q, r)
}

function liveWorldHangerAt(q: number, r: number) {
  return findWorldHangerAt(getSession(), q, r)
}

function liveWorldDockAt(q: number, r: number) {
  return findWorldDockAt(getSession(), q, r)
}

function liveWorldRecruitsAt(q: number, r: number) {
  return findWorldRecruitsAt(getSession(), q, r)
}

function liveNoticeBoardAt(q: number, r: number) {
  return findNoticeBoardAt(getSession(), q, r)
}

function emptyBoatAt(q: number, r: number) {
  const boat = findBoatAt(getSession(), q, r)
  if (!boat || boat.occupant_hero_id != null) {
    return undefined
  }
  return boat
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
  onFountainRestore,
  onChestOffer,
  onSignRead,
  onWorldLibrary,
  onWorldHanger,
  onWorldDock,
  onWorldRecruits,
  onWorldNoticeBoard,
  onArchiveLearn,
  onHeroMeet,
  onSiegeTown,
  onMobMeet,
  terrainWedgesEnabled = true,
  zonesDebug = false,
  wallGapsDebug = false,
  roadPlanDebug = false,
}: HexMapProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const tilesRef = useRef<TestGridResponse | null>(null)
  const heroRef = useRef<HeroState | null>(null)
  const walletRef = useRef<ResourceWallet>(snapshotWallet(wallet))
  const onHeroMeetRef = useRef(onHeroMeet)
  const onSiegeTownRef = useRef(onSiegeTown)
  const onMobMeetRef = useRef(onMobMeet)
  const terrainWedgesEnabledRef = useRef(terrainWedgesEnabled)
  const zonesDebugRef = useRef(zonesDebug)
  const wallGapsDebugRef = useRef(wallGapsDebug)
  const roadPlanDebugRef = useRef(roadPlanDebug)
  const paintZoneDebugRef = useRef<(() => void) | null>(null)
  const paintRoadPlanRef = useRef<(() => void) | null>(null)
  const rebakeTerrainRef = useRef<(() => void) | null>(null)
  const onArchiveLearnRef = useRef(onArchiveLearn)
  const onFountainRestoreRef = useRef(onFountainRestore)
  const onChestOfferRef = useRef(onChestOffer)
  const onSignReadRef = useRef(onSignRead)
  const onWorldLibraryRef = useRef(onWorldLibrary)
  const onWorldHangerRef = useRef(onWorldHanger)
  const onWorldDockRef = useRef(onWorldDock)
  const onWorldRecruitsRef = useRef(onWorldRecruits)
  const onWorldNoticeBoardRef = useRef(onWorldNoticeBoard)

  useEffect(() => {
    walletRef.current = snapshotWallet(wallet)
  }, [wallet])
  useEffect(() => {
    onArchiveLearnRef.current = onArchiveLearn
  }, [onArchiveLearn])
  useEffect(() => {
    onFountainRestoreRef.current = onFountainRestore
  }, [onFountainRestore])
  useEffect(() => {
    onChestOfferRef.current = onChestOffer
  }, [onChestOffer])
  useEffect(() => {
    onSignReadRef.current = onSignRead
  }, [onSignRead])
  useEffect(() => {
    onWorldLibraryRef.current = onWorldLibrary
  }, [onWorldLibrary])
  useEffect(() => {
    onWorldHangerRef.current = onWorldHanger
  }, [onWorldHanger])
  useEffect(() => {
    onWorldDockRef.current = onWorldDock
  }, [onWorldDock])
  useEffect(() => {
    onWorldRecruitsRef.current = onWorldRecruits
  }, [onWorldRecruits])

  useEffect(() => {
    onWorldNoticeBoardRef.current = onWorldNoticeBoard
  }, [onWorldNoticeBoard])

  useEffect(() => {
    onHeroMeetRef.current = onHeroMeet
  }, [onHeroMeet])

  useEffect(() => {
    onSiegeTownRef.current = onSiegeTown
  }, [onSiegeTown])

  useEffect(() => {
    onMobMeetRef.current = onMobMeet
  }, [onMobMeet])

  useEffect(() => {
    terrainWedgesEnabledRef.current = terrainWedgesEnabled
    rebakeTerrainRef.current?.()
  }, [terrainWedgesEnabled])

  useEffect(() => {
    zonesDebugRef.current = zonesDebug
    wallGapsDebugRef.current = wallGapsDebug
    paintZoneDebugRef.current?.()
  }, [zonesDebug, wallGapsDebug])

  useEffect(() => {
    roadPlanDebugRef.current = roadPlanDebug
    paintRoadPlanRef.current?.()
  }, [roadPlanDebug])

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
    let waypointPlan: WaypointPlan | null = null

    void (async () => {
      await fetchCatalog().catch(() => {})
      // Do not call createSessionFromConfig(defaultGameConfig) here: Start Game
      // leaves heroes/towns empty until ensureStartingHeroes below, and rewriting
      // the session would clobber the form config (manual overrides and all).
      // F5 / empty bootstrap is handled in App when the catalog loads.
      const needsGrid = !cachedGrid || !gridHasResourceIds(cachedGrid)
      if (needsGrid) {
        const savedSeed = getSession().game.seed
        const playerCount = getSession().game.settings.player_count
        const settings = getSession().game.settings
        // Prefer stored dims (new saves + legacy-compatible). Fall back to
        // map_size name so older saves still regenerate via backend fromLabel.
        const mapSizeParam =
          settings.map_width != null &&
          settings.map_height != null &&
          settings.map_width > 0 &&
          settings.map_height > 0
            ? `${settings.map_width}x${settings.map_height}`
            : settings.map_size || undefined
        const catalog = getCachedCatalog()
        const heroTypeIds = settings.hero_type_ids ?? []
        const townTypeIds = heroTypeIds.map((heroTypeId) => {
          if (heroTypeId == null || heroTypeId <= 0) {
            return 0
          }
          const type = catalog?.hero_type.find((row) => row.id === heroTypeId)
          return type != null && type.town_id > 0 ? type.town_id : 0
        })
        const townTypesParam =
          townTypeIds.length > 0 && townTypeIds.some((id) => id > 0)
            ? townTypeIds.join(',')
            : undefined
        const grid = await fetchTestGridOnce(
          savedSeed > 0 ? savedSeed : undefined,
          playerCount > 0 ? playerCount : undefined,
          mapSizeParam,
          townTypesParam,
          signal,
        )
        if (cancelled || signal.aborted) {
          return
        }
        cachedGrid = grid
      }
      tilesRef.current = cachedGrid
      if (!tilesRef.current) {
        return
      }
      const { tiles, seed, objects } = tilesRef.current
      if (cancelled || signal.aborted || tiles.length === 0) {
        return
      }

      const { grid, layout, width, height } = buildWorld(tiles, hexSize)
      onMapInfo({ width, height, seed })
      // Always rehydrate FoW from the active player — not only on fresh grid
      // fetch. A cancelled Strict Mode mount can leave cachedGrid set after
      // fetchTestGrid cleared the live Set; skipping restore then leaves fog empty.
      restoreExplored(activePlayer(getSession())?.explored)

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
            remaining: heroMovementPoints(
              getCachedCatalog(),
              null,
              getSession().game.settings.move_mode,
            ),
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
      const ownHeroes = actor
        ? after.heroes.filter((hero) => hero.player_id === actor.id)
        : after.heroes
      const ownHero =
        ownHeroes.find((hero) => hero.id === selectedMapHeroId) ?? ownHeroes[0]
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

      updateSession((current) => seedWorldMobs(current))

      const catalogAtPaint = getCachedCatalog()
      const terrainRows = catalogAtPaint?.terrain ?? []
      const useTerrainImages = mapUseTerrainImages(catalogAtPaint)
      const showHexOutlines = mapShowHexesWorld(catalogAtPaint)
      if (terrainRows.length === 0) {
        console.warn(
          '[hex] catalog.terrain is empty — restart backend so /api/reference/catalog includes terrain.',
        )
      }

      const hexTerrainTextures = await loadHexTerrainTextures(terrainRows)
      if (cancelled) {
        instance.destroy()
        return
      }

      const terrainLayer = new Container()
      const roadLayer = new Graphics()
      const fogLayer = new Container()
      const { offsetX, offsetY } = layout

      const world = new Container()
      world.addChild(terrainLayer)
      // Placeholder roads on the ground, under props/objects/fog/heroes.
      world.addChild(roadLayer)

      /** Non-blocking props — above roads, below features and all actors. */
      const groundPropLayer = new Container()
      groundPropLayer.sortableChildren = true
      world.addChild(groundPropLayer)

      // Path preview under map objects so yellow hexes don't paint over town art
      // when the route passes behind / through the keep.
      const preview = new Graphics()
      world.addChild(preview)

      /** World features (towns, mines, …) — below fog and heroLayer. */
      const artLayer = new Container()
      artLayer.sortableChildren = true
      world.addChild(artLayer)

      /** Blocking props (staging; actor pass moves them onto heroLayer). */
      const blockingPropLayer = new Container()
      blockingPropLayer.sortableChildren = true

      world.addChild(fogLayer)

      const zoneDebug = new Graphics()
      const zoneLabels = new Container()
      world.addChild(zoneDebug)
      world.addChild(zoneLabels)
      const paintZoneDebug = () => {
        zoneDebug.clear()
        for (const child of zoneLabels.removeChildren()) {
          child.destroy()
        }
        const showZones = zonesDebugRef.current
        const showGaps = wallGapsDebugRef.current
        if (!showZones && !showGaps) {
          return
        }
        const neighbors = new Map<number, Set<number>>()
        const size = new Map<number, number>()
        const centroid = new Map<number, { x: number; y: number }>()
        if (showZones) {
          forEachTile((q, r) => {
            const tile = getTile(q, r)
            const id = tile?.zoneId
            if (id == null || id <= 0) {
              return
            }
            size.set(id, (size.get(id) ?? 0) + 1)
            if (!neighbors.has(id)) {
              neighbors.set(id, new Set())
            }
            for (const n of neighborHexes({ q, r })) {
              const other = getTile(n.q, n.r)?.zoneId
              if (other != null && other > 0 && other !== id) {
                neighbors.get(id)!.add(other)
              }
            }
          })
        }
        const colorIndex = new Map<number, number>()
        const byDegree = [...size.keys()].sort((a, b) => {
          const deg = (neighbors.get(b)?.size ?? 0) - (neighbors.get(a)?.size ?? 0)
          return deg !== 0 ? deg : a - b
        })
        for (const id of byDegree) {
          colorIndex.set(id, zoneColorIndex(id, neighbors, colorIndex))
        }
        const pocketSize = new Map<number, number>()
        const pocketSum = new Map<number, { x: number; y: number }>()
        const pocketTier = new Map<number, number>()
        forEachTile((q, r) => {
          const tile = getTile(q, r)
          if (!tile) {
            return
          }
          const hex = grid.getHex({ q, r }) ?? grid.createHex({ q, r })
          const poly = hex.corners.map((corner) => ({
            x: corner.x + offsetX,
            y: corner.y + offsetY,
          }))
          if (showZones && tile.zoneId != null && tile.zoneId > 0) {
            const center = hexCenter(hex, offsetX, offsetY)
            const sum = centroid.get(tile.zoneId) ?? { x: 0, y: 0 }
            sum.x += center.x
            sum.y += center.y
            centroid.set(tile.zoneId, sum)
            zoneDebug
              .poly(poly)
              .fill({ color: zonePaintColor(colorIndex.get(tile.zoneId) ?? 0), alpha: 0.42 })
            for (const n of neighborHexes({ q, r })) {
                const other = getTile(n.q, n.r)
                if (
                  other?.zoneId == null ||
                  other.zoneId <= 0 ||
                  other.zoneId === tile.zoneId ||
                  tile.zoneId > other.zoneId
                ) {
                  continue
                }
                const otherHex = grid.getHex(n) ?? grid.createHex(n)
                const corners = poly
                const here = center
                const there = hexCenter(otherHex, offsetX, offsetY)
                const target = Math.atan2(there.y - here.y, there.x - here.x)
                let bestI = 0
                let best = Number.POSITIVE_INFINITY
                for (let i = 0; i < corners.length; i++) {
                  const a = corners[i]!
                  const b = corners[(i + 1) % corners.length]!
                  const ang = Math.atan2((a.y + b.y) / 2 - here.y, (a.x + b.x) / 2 - here.x)
                  let diff = Math.abs(ang - target)
                  if (diff > Math.PI) {
                    diff = 2 * Math.PI - diff
                  }
                  if (diff < best) {
                    best = diff
                    bestI = i
                  }
                }
                const a = corners[bestI]!
                const b = corners[(bestI + 1) % corners.length]!
                const walled = edgeIsWalled(tile, other)
                zoneDebug
                  .moveTo(a.x, a.y)
                  .lineTo(b.x, b.y)
                  .stroke({ width: 4, color: walled ? 0xe53935 : 0x111111, alpha: 1 })
            }
          }
          if ((showZones || showGaps) && tile.wallGap) {
            zoneDebug.poly(poly).fill({ color: 0xffee58, alpha: 0.92 })
          }
          if (showZones && tile.pocketId != null && tile.pocketId > 0) {
            const center = hexCenter(hex, offsetX, offsetY)
            const sum = pocketSum.get(tile.pocketId) ?? { x: 0, y: 0 }
            sum.x += center.x
            sum.y += center.y
            pocketSum.set(tile.pocketId, sum)
            pocketSize.set(tile.pocketId, (pocketSize.get(tile.pocketId) ?? 0) + 1)
            if (tile.pocketTier != null) {
              pocketTier.set(tile.pocketId, tile.pocketTier)
            }
            if (tile.pocketEntrance) {
              zoneDebug.poly(poly).fill({ color: 0xff6d00, alpha: 0.9 })
            }
            for (const n of neighborHexes({ q, r })) {
              const otherId = getTile(n.q, n.r)?.pocketId
              if (otherId === tile.pocketId) {
                continue
              }
              const otherHex = grid.getHex(n) ?? grid.createHex(n)
              const here = center
              const there = hexCenter(otherHex, offsetX, offsetY)
              const target = Math.atan2(there.y - here.y, there.x - here.x)
              let bestI = 0
              let best = Number.POSITIVE_INFINITY
              for (let i = 0; i < poly.length; i++) {
                const a = poly[i]!
                const b = poly[(i + 1) % poly.length]!
                const ang = Math.atan2((a.y + b.y) / 2 - here.y, (a.x + b.x) / 2 - here.x)
                let diff = Math.abs(ang - target)
                if (diff > Math.PI) {
                  diff = 2 * Math.PI - diff
                }
                if (diff < best) {
                  best = diff
                  bestI = i
                }
              }
              const a = poly[bestI]!
              const b = poly[(bestI + 1) % poly.length]!
              zoneDebug
                .moveTo(a.x, a.y)
                .lineTo(b.x, b.y)
                .stroke({ width: 3, color: 0x6a1b9a, alpha: 1 })
            }
          }
        })
        if (showZones) {
          for (const [id, sum] of centroid) {
            const n = size.get(id) ?? 1
            const label = new Text({
              text: `${id} · ${n}`,
              style: {
                fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
                fontSize: Math.max(11, Math.round(hexSize * 0.42)),
                fontWeight: '700',
                fill: 0x111111,
                align: 'center',
                stroke: { color: 0xffffff, width: 3 },
              },
              anchor: 0.5,
            })
            label.position.set(sum.x / n, sum.y / n)
            zoneLabels.addChild(label)
          }
          for (const [id, sum] of pocketSum) {
            const n = pocketSize.get(id) ?? 1
            const tier = pocketTier.get(id)
            const label = new Text({
              text: tier != null ? `P·T${tier}` : `P${id}`,
              style: {
                fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
                fontSize: Math.max(11, Math.round(hexSize * 0.42)),
                fontWeight: '700',
                fill: 0x4a148c,
                align: 'center',
                stroke: { color: 0xffffff, width: 3 },
              },
              anchor: 0.5,
            })
            label.position.set(sum.x / n, sum.y / n)
            zoneLabels.addChild(label)
          }
        }
        if (zoneDebug.parent) {
          zoneDebug.parent.addChild(zoneDebug)
          zoneDebug.parent.addChild(zoneLabels)
        }
      }
      paintZoneDebugRef.current = paintZoneDebug

      const roadPlanGfx = new Graphics()
      const roadPlanLabels = new Container()
      world.addChild(roadPlanGfx)
      world.addChild(roadPlanLabels)
      const paintRoadPlan = () => {
        roadPlanGfx.clear()
        for (const child of roadPlanLabels.removeChildren()) {
          child.destroy()
        }
        if (!roadPlanDebugRef.current) {
          return
        }
        const plan = tilesRef.current?.roadPlan
        if (!plan || !Array.isArray(plan.links) || plan.links.length === 0) {
          return
        }
        const washed = new Set(
          (plan.washed ?? []).map((hex) => `${hex.q},${hex.r}`),
        )
        const centerOf = (q: number, r: number) => {
          const hex = grid.getHex({ q, r }) ?? grid.createHex({ q, r })
          return hexCenter(hex, offsetX, offsetY)
        }
        const width = Math.max(1.25, hexSize * 0.055)
        const dash = Math.max(5, hexSize * 0.22)
        const gap = Math.max(3, hexSize * 0.14)
        for (const link of plan.links) {
          const hexes = link.hexes ?? []
          let run: Array<{ q: number; r: number }> = []
          let runWashed = false
          const flush = () => {
            if (run.length < 2) {
              run = []
              return
            }
            const points = run.map((hex) => centerOf(hex.q, hex.r))
            strokeDashedPolyline(
              roadPlanGfx,
              points,
              {
                width,
                color: runWashed ? 0xff6d00 : link.branch ? 0xb388ff : 0xffffff,
                alpha: 0.95,
              },
              dash,
              gap,
            )
            run = []
          }
          for (let i = 0; i < hexes.length - 1; i++) {
            const a = hexes[i]!
            const b = hexes[i + 1]!
            const segWashed =
              washed.has(`${a.q},${a.r}`) || washed.has(`${b.q},${b.r}`)
            if (run.length === 0) {
              runWashed = segWashed
              run.push(a, b)
            } else if (segWashed === runWashed) {
              run.push(b)
            } else {
              flush()
              runWashed = segWashed
              run.push(a, b)
            }
          }
          flush()
          const labelAt = (index: number, above: boolean) => {
            const hex = hexes[index]
            if (!hex) {
              return
            }
            const c = centerOf(hex.q, hex.r)
            const label = new Text({
              text: link.branch ? `→ ${link.to}` : `${link.from} → ${link.to}`,
              style: {
                fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
                fontSize: Math.max(10, Math.round(hexSize * 0.34)),
                fontWeight: '700',
                fill: 0x111111,
                align: 'center',
                stroke: { color: 0xffffff, width: 3 },
              },
              anchor: 0.5,
            })
            label.position.set(c.x, c.y + (above ? -hexSize * 0.42 : hexSize * 0.42))
            roadPlanLabels.addChild(label)
          }
          if (link.branch) {
            labelAt(0, true)
          } else {
            labelAt(0, true)
            labelAt(hexes.length - 1, false)
          }
        }
        const arm = Math.max(4, hexSize * 0.16)
        for (const hex of plan.orphans ?? []) {
          const c = centerOf(hex.q, hex.r)
          roadPlanGfx
            .moveTo(c.x - arm, c.y - arm)
            .lineTo(c.x + arm, c.y + arm)
            .moveTo(c.x - arm, c.y + arm)
            .lineTo(c.x + arm, c.y - arm)
            .stroke({ width: Math.max(2, hexSize * 0.07), color: 0x111111, alpha: 1 })
          roadPlanGfx
            .moveTo(c.x - arm, c.y - arm)
            .lineTo(c.x + arm, c.y + arm)
            .moveTo(c.x - arm, c.y + arm)
            .lineTo(c.x + arm, c.y - arm)
            .stroke({ width: Math.max(1.25, hexSize * 0.045), color: 0xffea00, alpha: 1 })
        }
        if (roadPlanGfx.parent) {
          roadPlanGfx.parent.addChild(roadPlanGfx)
          roadPlanGfx.parent.addChild(roadPlanLabels)
        }
      }
      paintRoadPlanRef.current = paintRoadPlan
      paintRoadPlan()
      signal.addEventListener(
        'abort',
        () => {
          paintZoneDebugRef.current = null
          paintRoadPlanRef.current = null
        },
        { once: true },
      )

      const heroLayer = new Container()
      heroLayer.sortableChildren = true
      const heroMarkers = new Map<
        string,
        { view: Container; label: Text; badge: Graphics; sprite: Sprite }
      >()
      const boatMarkers = new Map<
        string,
        { view: Container; badge: Graphics; sprite: Sprite }
      >()
      const travelArtByFile = new Map<string, Texture | null>()
      const travelArtLoading = new Set<string>()
      preloadHeroTravelSprites(getCachedCatalog())
      const mobMarkers = new Map<
        string,
        {
          view: Container
          badge: Graphics
          label: Text
          sprite: Sprite
          qty: Text
        }
      >()
      const unitArtByUrl = new Map<string, Texture | null>()
      const unitArtLoading = new Set<string>()
      world.addChild(heroLayer)
      instance.stage.addChild(world)

      const canvas = instance.canvas
      const tipEl = document.createElement('div')
      tipEl.className = 'world-hover-tip'
      tipEl.hidden = true
      host.replaceChildren(canvas, tipEl)
      app = instance

      const chunkRenderer = new WorldChunkRenderer({
        app: instance,
        grid,
        terrainLayer,
        fogLayer,
        groundPropLayer,
        blockingPropLayer,
        mapArtLayer: artLayer,
        offsetX,
        offsetY,
        hexSize,
        seed,
        useTerrainImages,
        showHexOutlines,
        wedgesEnabled: () => terrainWedgesEnabledRef.current,
        hexTerrainTextures,
        getCatalog: () => getCachedCatalog(),
      })
      signal.addEventListener(
        'abort',
        () => {
          chunkRenderer.destroy()
          setWorldRenderStats(null)
        },
        { once: true },
      )

      const objectByKey = new Map<
        string,
        {
          data: MapObjectData
          view: Container
          badge: Graphics
          label: Text
          sprite: Sprite
          ring: Graphics
          cullBox: PropCullBox | null
          sortY: number
        }
      >()

      const mapSceneLive = () => !cancelled && !world.destroyed

      const syncMapArtDepth = () => {
        if (!mapSceneLive()) {
          return
        }
        chunkRenderer.syncMapArtDepth(
          [...objectByKey.values()].map((entry) => ({
            container: entry.view,
            sortY: entry.sortY,
          })),
        )
      }

      const ensureFeatureEntryDraw = (entry: {
        view: Container
        badge: Graphics
        label: Text
        sprite: Sprite
        ring: Graphics
      }): boolean => {
        if (entry.view.destroyed) {
          return false
        }
        if (!entry.sprite.destroyed) {
          return true
        }
        const sprite = new Sprite()
        sprite.visible = false
        const ringIdx = entry.view.getChildIndex(entry.ring)
        entry.view.addChildAt(sprite, Math.max(0, ringIdx))
        entry.sprite = sprite
        return true
      }

      const paintObjectBadge = (target: Graphics, fill: number) => {
        target.clear()
        target.circle(0, 0, hexSize * 0.42)
        target.fill({ color: fill })
        target.stroke({ width: 2, color: 0x111111 })
      }

      /** Player-color outline; `radius` is the ring radius in world px. */
      const paintOwnershipRing = (
        target: Graphics,
        playerId: string | null | undefined,
        radius: number,
      ) => {
        target.clear()
        const tint = ownerTint(playerId)
        if (tint == null) {
          return
        }
        const r = Math.max(4, radius)
        // Same stroke for towns and nodes (capped thin outline).
        const width = 1.5
        target.circle(0, 0, r)
        target.stroke({ width, color: tint })
      }

      /** Ring large enough to encircle the 2×1 hex span and the boosted town art. */
      const townFootprintRingRadius = (
        entry: {
          data: MapObjectData
          view: Container
          sprite?: Sprite
        },
      ) => {
        const origin = townFootprintOrigin(entry.data)
        const bottom = townFootprintBottomRow(entry.data)
        const sample = grid.getHex(origin) ?? grid.createHex(origin)
        let boxW = sample.width
        if (bottom.length >= 2) {
          const centers = bottom.map((axial) => {
            const hex = grid.getHex(axial) ?? grid.createHex(axial)
            const c = hexCenter(hex, offsetX, offsetY)
            return {
              x: c.x - entry.view.position.x,
              y: c.y - entry.view.position.y,
            }
          })
          const xs = centers.map((c) => c.x)
          boxW = Math.max(...xs) - Math.min(...xs) + sample.width
        }
        const sprite = entry.sprite
        if (sprite?.visible && sprite.texture.width >= 1) {
          const drawnW = Math.abs(sprite.width)
          const drawnH = Math.abs(sprite.height)
          // Circumscribe the art once the ring is centered on it.
          return Math.max(boxW * 0.55, drawnW * 0.52, drawnH * 0.52)
        }
        return boxW * 0.55
      }

      const placeTownOwnershipRing = (
        entry: {
          data: MapObjectData
          view: Container
          ring: Graphics
          sprite?: Sprite
        },
        ownerId: string | null | undefined,
      ) => {
        townFootprintOrigin(entry.data)
        const bottom = townFootprintBottomRow(entry.data)
        const centers = bottom.map((axial) => {
          const hex = grid.getHex(axial) ?? grid.createHex(axial)
          const c = hexCenter(hex, offsetX, offsetY)
          return {
            x: c.x - entry.view.position.x,
            y: c.y - entry.view.position.y,
          }
        })
        let midX =
          centers.length >= 2
            ? (centers[0].x + centers[1].x) / 2
            : 0
        let midY =
          centers.length >= 2
            ? (centers[0].y + centers[1].y) / 2
            : (centers[0]?.y ?? 0)
        const sprite = entry.sprite
        if (sprite?.visible) {
          const w = Math.abs(sprite.width)
          const h = Math.abs(sprite.height)
          // Geometric center of the sprite (anchor is bottom-ish at 0.92).
          midX =
            sprite.position.x + (0.5 - sprite.anchor.x) * w * Math.sign(sprite.scale.x || 1)
          // Keep sits opposite the drawbridge — nudge the ring toward it.
          midX += entry.data.flipped ? w * 0.06 : -w * 0.06
          midY = sprite.position.y + (0.5 - sprite.anchor.y) * h
        }
        entry.ring.position.set(midX, midY)
        paintOwnershipRing(entry.ring, ownerId, townFootprintRingRadius(entry))
      }

      const townFill = (playerId: string | null | undefined) =>
        ownerTint(playerId) ?? NEUTRAL_OBJECT_COLOR

      const featureHexSize = (q: number, r: number) => {
        const hex = grid.getHex({ q, r }) ?? grid.createHex({ q, r })
        return { width: hex.width, height: hex.height }
      }

      const applyFeatureArt = (
        entry: {
          data: MapObjectData
          view: Container
          badge: Graphics
          label: Text
          sprite: Sprite
          ring: Graphics
          cullBox: PropCullBox | null
          sortY: number
        },
        texture: Texture | null,
        ownerId: string | null | undefined,
      ) => {
        const hasArt = texture != null && texture.width >= 1 && texture.height >= 1
        entry.sprite.visible = hasArt
        entry.badge.visible = !hasArt
        entry.label.visible = !hasArt
        if (hasArt && texture) {
          if (!ensureFeatureEntryDraw(entry)) {
            return
          }
          const catalog = getCachedCatalog()
          const sessionTown =
            entry.data.kind === 'town'
              ? findTownAt(getSession(), entry.data.q, entry.data.r)
              : undefined
          const chestSession =
            entry.data.kind === 'chest'
              ? findChestAt(getSession(), entry.data.q, entry.data.r)
              : undefined
          const featureRow = featureRowForMapObject(catalog, entry.data, {
            townTypeId:
              sessionTown?.town_type_id ?? mapObjectTownTypeId(entry.data),
            chestLevel:
              chestSession?.level ??
              (typeof entry.data.level === 'number' ? entry.data.level : 0),
          })
          const renderScale = featureRenderScale(featureRow)
          const flipped = entry.data.flipped === true

          if (entry.data.kind === 'town') {
            const origin = townFootprintOrigin(entry.data)
            const bottom = townFootprintBottomRow(entry.data)
            const viewPos = entry.view.position
            const centers = bottom.map((axial) => {
              const hex = grid.getHex(axial) ?? grid.createHex(axial)
              const c = hexCenter(hex, offsetX, offsetY)
              return {
                x: c.x - viewPos.x,
                y: c.y - viewPos.y,
              }
            })
            const sample = grid.getHex(origin) ?? grid.createHex(origin)
            layoutHexFootprintSprite(
              entry.sprite,
              texture,
              centers,
              centers,
              sample.width,
              sample.height,
            )
            // Square town art is height-limited on a wide 2×1 span — scale up
            // so the castle fills the footprint width (contain leaves it ~1 hex).
            let boxW = sample.width * 0.9
            if (centers.length >= 2) {
              const xs = centers.map((c) => c.x)
              boxW = Math.max(
                boxW,
                Math.max(...xs) - Math.min(...xs) + sample.width,
              )
            }
            const contain = Math.abs(entry.sprite.scale.x) || 1
            const coverW = (boxW * 0.98) / Math.max(1, texture.width)
            const boost = Math.max(1, coverW / contain)
            entry.sprite.scale.x *= boost
            entry.sprite.scale.y *= boost
            const cullAnchor = {
              x: entry.view.position.x + entry.sprite.position.x,
              y: entry.view.position.y + entry.sprite.position.y,
            }
            entry.cullBox = finishWorldMapFeatureSprite(
              entry.sprite,
              renderScale,
              flipped,
              cullAnchor,
              sample.width,
              centers.length > 1 ? 1.2 : 1,
            )
            entry.sortY = cullAnchor.y
            placeTownOwnershipRing(entry, ownerId)
            syncMapArtDepth()
            return
          }
          const { width, height } = featureHexSize(entry.data.q, entry.data.r)
          const mineFit = entry.data.kind === 'mine' ? 1.4 : 1
          layoutHexSprite(entry.sprite, texture, 0, 0, width, height)
          if (entry.data.kind === 'mine') {
            entry.sprite.scale.x *= mineFit
            entry.sprite.scale.y *= mineFit
            entry.sprite.y += height * 0.18
          }
          const cullAnchor = {
            x: entry.view.position.x + entry.sprite.position.x,
            y: entry.view.position.y + entry.sprite.position.y,
          }
          entry.cullBox = finishWorldMapFeatureSprite(
            entry.sprite,
            renderScale,
            flipped,
            cullAnchor,
            width,
            mineFit,
          )
          entry.sortY = cullAnchor.y
          if (entry.data.kind === 'mine') {
            paintOwnershipRing(entry.ring, ownerId, width * 0.58)
          } else {
            entry.ring.clear()
          }
          syncMapArtDepth()
          return
        }
        entry.cullBox = null
        entry.ring.clear()
        if (entry.data.kind === 'town') {
          return
        }
        const mineOwned =
          entry.data.kind === 'mine' && ownerId != null
        paintObjectBadge(
          entry.badge,
          mineOwned ? townFill(ownerId) : NEUTRAL_OBJECT_COLOR,
        )
        entry.label.style.fill = mineOwned ? '#ffffff' : '#111111'
      }

      const whenFeatureTextureLoaded = (
        promise: Promise<Texture | null>,
        onTexture: (texture: Texture | null) => void,
      ) => {
        void promise.then((texture) => {
          if (cancelled) {
            return
          }
          onTexture(texture)
        })
      }

      const loadObjectFeatureArt = (entry: {
        data: MapObjectData
        badge: Graphics
        label: Text
        sprite: Sprite
        ring: Graphics
      }) => {
        const key = `${entry.data.q},${entry.data.r}`
        if (entry.data.kind === 'town') {
          const sessionTown = findTownAt(getSession(), entry.data.q, entry.data.r)
          const typeId =
            sessionTown?.town_type_id ?? mapObjectTownTypeId(entry.data) ?? null
          const feature = featureForTownType(getCachedCatalog(), typeId)
          const imagePath =
            feature?.image_path ??
            (sessionTown
              ? `${getCachedCatalog()?.town.find((t) => t.id === typeId)?.name ?? ''}.png`
              : null)
          whenFeatureTextureLoaded(loadFeatureTexture(imagePath), (texture) => {
            const live = objectByKey.get(key)
            if (!live || live !== entry) {
              return
            }
            const owner = findTownAt(
              getSession(),
              live.data.q,
              live.data.r,
            )?.player_id
            applyFeatureArt(live, texture, owner)
          })
          return
        }
        if (entry.data.kind === 'fountain') {
          const feature = featureForFountain(getCachedCatalog())
          whenFeatureTextureLoaded(
            loadFeatureTexture(feature?.image_path ?? 'Fountain.png'),
            (texture) => {
              const live = objectByKey.get(key)
              if (!live || live !== entry) {
                return
              }
              applyFeatureArt(live, texture, null)
            },
          )
          return
        }
        if (entry.data.kind === 'chest') {
          const sessionChest = findChestAt(
            getSession(),
            entry.data.q,
            entry.data.r,
          )
          const level =
            sessionChest?.level ??
            (typeof entry.data.level === 'number' ? entry.data.level : 0)
          const catalog = getCachedCatalog()
          const imagePath = sessionChest?.open
            ? chestOpenImage(catalog, level) ??
              featureForChest(catalog, level)?.image_path
            : chestClosedImage(catalog, level) ??
              featureForChest(catalog, level)?.image_path
          whenFeatureTextureLoaded(loadFeatureTexture(imagePath), (texture) => {
            const live = objectByKey.get(key)
            if (!live || live !== entry) {
              return
            }
            applyFeatureArt(live, texture, null)
          })
          return
        }
        if (entry.data.kind === 'sign') {
          const feature = featureForSign(getCachedCatalog())
          whenFeatureTextureLoaded(
            loadFeatureTexture(feature?.image_path ?? 'Sign.png'),
            (texture) => {
              const live = objectByKey.get(key)
              if (!live || live !== entry) {
                return
              }
              applyFeatureArt(live, texture, null)
            },
          )
          return
        }
        if (entry.data.kind === 'library') {
          const feature = featureForWorldLibrary(getCachedCatalog())
          whenFeatureTextureLoaded(
            loadFeatureTexture(feature?.image_path ?? 'Library.png'),
            (texture) => {
              const live = objectByKey.get(key)
              if (!live || live !== entry) {
                return
              }
              applyFeatureArt(live, texture, null)
            },
          )
          return
        }
        if (entry.data.kind === 'hanger') {
          const feature = featureForWorldHanger(getCachedCatalog())
          whenFeatureTextureLoaded(
            loadFeatureTexture(feature?.image_path ?? 'Hanger.png'),
            (texture) => {
              const live = objectByKey.get(key)
              if (!live || live !== entry) {
                return
              }
              applyFeatureArt(live, texture, null)
            },
          )
          return
        }
        if (entry.data.kind === 'dock') {
          const feature = featureForWorldDock(getCachedCatalog())
          whenFeatureTextureLoaded(
            loadFeatureTexture(feature?.image_path ?? 'Dock.png'),
            (texture) => {
              const live = objectByKey.get(key)
              if (!live || live !== entry) {
                return
              }
              applyFeatureArt(live, texture, null)
            },
          )
          return
        }
        if (entry.data.kind === 'recruits') {
          const feature = featureForWorldRecruits(getCachedCatalog())
          whenFeatureTextureLoaded(
            loadFeatureTexture(feature?.image_path ?? 'Recruits.png'),
            (texture) => {
              const live = objectByKey.get(key)
              if (!live || live !== entry) {
                return
              }
              applyFeatureArt(live, texture, null)
            },
          )
          return
        }
        if (entry.data.kind === 'notice_board') {
          const feature = featureForNoticeBoard(getCachedCatalog())
          whenFeatureTextureLoaded(
            loadFeatureTexture(feature?.image_path ?? 'Notice_Board.png'),
            (texture) => {
              const live = objectByKey.get(key)
              if (!live || live !== entry) {
                return
              }
              applyFeatureArt(live, texture, null)
            },
          )
          return
        }
        const resourceId = mapObjectResourceId(entry.data)
        if (resourceId == null) {
          return
        }
        const kind = entry.data.kind === 'mine' ? 'mine' : 'pickup'
        const feature = featureForResource(getCachedCatalog(), resourceId, kind)
        const imagePath = feature?.image_path ?? null
        // Pickups must use loose `{Resource}.png` only — never Node art.
        // Nodes use `{Resource}_Node.png`. No cross-kind fallback on the map.
        whenFeatureTextureLoaded(loadFeatureTexture(imagePath), (texture) => {
          const live = objectByKey.get(key)
          if (!live || live !== entry) {
            return
          }
          const liveOwner =
            live.data.kind === 'mine'
              ? findNodeAt(getSession(), live.data.q, live.data.r)?.player_id
              : null
          applyFeatureArt(live, texture, liveOwner)
        })
      }

      const addObjectView = (obj: MapObjectData) => {
        const sessionNow = getSession()
        const node = findNodeAt(sessionNow, obj.q, obj.r)
        if (obj.kind === 'pickup' && (obj.collected || node?.collected)) {
          return
        }
        const view = new Container()
        const objectBadge = new Graphics()
        const objectRing = new Graphics()
        const objectSprite = new Sprite()
        objectSprite.visible = false
        const town = obj.kind === 'town' ? findTownAt(sessionNow, obj.q, obj.r) : undefined
        const mineOwned =
          obj.kind === 'mine' && (!!obj.claimed || node?.player_id != null)
        const fill =
          obj.kind === 'town'
            ? townFill(town?.player_id)
            : mineOwned
              ? townFill(node?.player_id)
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
        view.addChild(objectBadge, objectSprite, objectRing, objectLabel)
        if (obj.kind === 'town') {
          // Anchor view at left hex; sprite spans left+right (entry = obj q,r).
          const origin = townFootprintOrigin(obj)
          const leftHex = grid.getHex(origin) ?? grid.createHex(origin)
          const leftC = hexCenter(leftHex, offsetX, offsetY)
          view.position.set(leftC.x, leftC.y)
        } else {
          const hex = grid.getHex(obj) ?? grid.createHex(obj)
          const center = hexCenter(hex, offsetX, offsetY)
          view.position.set(center.x, center.y)
        }
        artLayer.addChild(view)
        const entry = {
          data: obj,
          view,
          badge: objectBadge,
          label: objectLabel,
          sprite: objectSprite,
          ring: objectRing,
          cullBox: null as PropCullBox | null,
          sortY: view.position.y,
        }
        objectByKey.set(`${obj.q},${obj.r}`, entry)
        if (
          obj.kind === 'mine' ||
          obj.kind === 'pickup' ||
          obj.kind === 'town' ||
          obj.kind === 'fountain' ||
          obj.kind === 'chest' ||
          obj.kind === 'sign' ||
          obj.kind === 'library' ||
          obj.kind === 'hanger' ||
          obj.kind === 'dock' ||
          obj.kind === 'recruits' ||
          obj.kind === 'notice_board'
        ) {
          loadObjectFeatureArt(entry)
        }
      }

      for (const obj of objects ?? []) {
        addObjectView(obj)
      }

      const emitResources = () => {
        onResources(snapshotWallet(walletRef.current))
      }

      const tryFountainRestore = (q: number, r: number) => {
        const heroId = selectedMapHeroId ?? heroRef.current?.id
        if (!heroId) {
          return
        }
        const catalog = getCachedCatalog()
        if (!catalog) {
          return
        }
        let message: string | null = null
        updateSession((current) => {
          const result = applyFountainVisit(current, catalog, heroId, q, r)
          message = result.message
          return result.session
        })
        if (message && !activePlayer(getSession())?.is_ai) {
          onFountainRestoreRef.current?.(message)
        }
      }

      const resolveHex = (q: number, r: number, opts?: { fountain?: boolean }) => {
        const key = `${q},${r}`
        const entry = objectByKey.get(key)
        if (!entry) {
          // Session fountain without a painted entry (rare) — still restore.
          if (opts?.fountain) {
            tryFountainRestore(q, r)
          }
          return
        }
        const obj = entry.data
        const heroId = selectedMapHeroId ?? heroRef.current?.id
        const hero = heroId
          ? getSession().heroes.find((row) => row.id === heroId)
          : undefined
        const moverId = hero?.player_id
        if (obj.kind === 'fountain') {
          if (opts?.fountain) {
            tryFountainRestore(q, r)
          }
          return
        }
        if (obj.kind === 'town') {
          const existing = findTownAt(getSession(), q, r)
          if (
            existing?.player_id &&
            existing.player_id !== moverId &&
            !townIsUndefended(getSession(), existing, heroId)
          ) {
            return
          }
          updateSession((current) =>
            claimTown(current, q, r, {
              name: obj.name ?? undefined,
              townTypeId: mapObjectTownTypeId(obj),
              ownerId: moverId,
            }),
          )
          const claimedTown = findTownAt(getSession(), q, r)
          const catalog = getCachedCatalog()
          if (catalog && claimedTown && heroId) {
            takeArchiveLearnNotice()
            updateSession((current) =>
              applyHeroTownVisitUniques(
                current,
                catalog,
                claimedTown.id,
                heroId,
              ),
            )
            const learned = takeArchiveLearnNotice()
            if (learned && !activePlayer(getSession())?.is_ai) {
              onArchiveLearnRef.current?.(learned)
            }
          }
          paintObjectBadge(entry.badge, townFill(claimedTown?.player_id))
          entry.label.style.fill = claimedTown?.player_id != null ? '#ffffff' : '#111111'
          if (entry.sprite.visible) {
            placeTownOwnershipRing(entry, claimedTown?.player_id)
          }
          if (!obj.claimed && claimedTown?.player_id != null) {
            obj.claimed = true
          }
          if (!activePlayer(getSession())?.is_ai) {
            onTownWelcome(
              claimedTown?.name ?? (obj.name?.trim() || 'Town'),
              claimedTown?.id ?? '',
            )
          }
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
            collectPickup(
              current,
              q,
              r,
              resourceId,
              findNodeAt(getSession(), q, r)?.qty ?? 0,
              moverId,
            ),
          )
          walletRef.current = walletFromSession(getSession())
          artLayer.removeChild(entry.view)
          entry.view.destroy({ children: true })
          objectByKey.delete(key)
          emitResources()
          return
        }

        if (obj.kind !== 'mine' && node?.kind !== 'mine') {
          return
        }
        if (node?.player_id != null && node.player_id === moverId) {
          if (!obj.claimed) {
            obj.claimed = true
            if (entry.sprite.visible) {
              paintOwnershipRing(
                entry.ring,
                node.player_id,
                featureHexSize(q, r).width * 0.58,
              )
            } else {
              paintObjectBadge(entry.badge, townFill(node.player_id))
              entry.label.style.fill = '#ffffff'
            }
          }
          return
        }
        obj.claimed = true
        updateSession((current) => claimMine(current, q, r, resourceId, moverId))
        const claimed = findNodeAt(getSession(), q, r)
        walletRef.current = walletFromSession(getSession())
        const ownerId = claimed?.player_id ?? moverId
        if (entry.sprite.visible) {
          paintOwnershipRing(
            entry.ring,
            ownerId,
            featureHexSize(q, r).width * 0.58,
          )
        } else {
          paintObjectBadge(entry.badge, townFill(ownerId))
          entry.label.style.fill = '#ffffff'
        }
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

      /**
       * World XY for cull. Heroes/mobs parented under a town for occlusion use
       * local coords — comparing those to the camera wrongly culls them off
       * (missing token at spawn / near keeps until the unit moves away).
       */
      const markerWorldXY = (view: Container): { x: number; y: number } => {
        let x = 0
        let y = 0
        let node: Container | null = view
        while (node && node !== world) {
          x += node.position.x
          y += node.position.y
          node = node.parent as Container | null
        }
        return { x, y }
      }

      const applyActorCull = () => {
        const viewW = instance.screen.width
        const viewH = instance.screen.height
        for (const entry of objectByKey.values()) {
          const onScreen = (x: number, y: number) =>
            chunkRenderer.cullWorldPoint(x, y, camera.x, camera.y, viewW, viewH)
          let render =
            entry.cullBox != null && entry.sprite.visible
              ? chunkRenderer.cullWorldBox(
                  entry.cullBox,
                  camera.x,
                  camera.y,
                  viewW,
                  viewH,
                )
              : onScreen(entry.view.position.x, entry.view.position.y)
          // Units parented under a town for occlusion must keep the town
          // rendering when the unit is in view and the keep origin is not.
          if (!render) {
            for (const child of entry.view.children) {
              if (
                child === entry.sprite ||
                child === entry.badge ||
                child === entry.label ||
                child === entry.ring
              ) {
                continue
              }
              const { x, y } = markerWorldXY(child as Container)
              if (onScreen(x, y)) {
                render = true
                break
              }
            }
          }
          entry.view.renderable = render
        }
        for (const entry of heroMarkers.values()) {
          const { x, y } = markerWorldXY(entry.view)
          entry.view.renderable = chunkRenderer.cullWorldPoint(
            x,
            y,
            camera.x,
            camera.y,
            viewW,
            viewH,
          )
        }
        for (const entry of boatMarkers.values()) {
          const { x, y } = markerWorldXY(entry.view)
          entry.view.renderable = chunkRenderer.cullWorldPoint(
            x,
            y,
            camera.x,
            camera.y,
            viewW,
            viewH,
          )
        }
        for (const entry of mobMarkers.values()) {
          const { x, y } = markerWorldXY(entry.view)
          entry.view.renderable = chunkRenderer.cullWorldPoint(
            x,
            y,
            camera.x,
            camera.y,
            viewW,
            viewH,
          )
        }
      }

      const applyCamera = () => {
        if (!mapSceneLive()) {
          return
        }
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
        chunkRenderer.updateCull(camera.x, camera.y, viewW, viewH)
        applyActorCull()
      }

      const paintRoads = () => {
        roadLayer.clear()
        // Obviously-placeholder stroke (cyan) — stand-in until Graphics art.
        // Static after generation: stroke once; fog covers unexplored segments.
        const strokeColor = 0x00e5ff
        const strokeWidth = Math.max(3, hexSize * 0.14)
        const strokeStyle = {
          width: strokeWidth,
          color: strokeColor,
          alpha: 0.9,
          join: 'round' as const,
          cap: 'round' as const,
        }
        const roadHexes: Axial[] = []
        forEachTile((q, r) => {
          if (getTile(q, r)?.hasRoad) {
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
          strokeStyle,
          (q, r) => getTile(q, r)?.roadMask,
        )
      }

      const rebakeTerrain = () => {
        if (!mapSceneLive()) {
          return
        }
        const catalog = getCachedCatalog()
        chunkRenderer.setAppearanceFlags({
          useTerrainImages: mapUseTerrainImages(catalog),
          showHexOutlines: mapShowHexesWorld(catalog),
        })
        chunkRenderer.rebakeAll()
        applyCamera()
        setWorldRenderStats(chunkRenderer.stats(world))
      }

      const exploreAround = (origin: Axial) => {
        const newly: Axial[] = []
        const range = visionRange(getCachedCatalog())
        grid.forEach((hex) => {
          if (hexDistance(origin, hex) > range) {
            return
          }
          if (!isExplored(hex.q, hex.r)) {
            newly.push({ q: hex.q, r: hex.r })
          }
          markExplored(hex.q, hex.r)
        })
        if (newly.length > 0) {
          chunkRenderer.revealHexes(newly)
          void chunkRenderer
            .addPropsForHexes(newly, loadPropTexture, addPropSprite)
            .then(() => {
              if (!cancelled) {
                syncMapArtDepth()
              }
            })
          applyCamera()
          setWorldRenderStats(chunkRenderer.stats(world))
        }
        updateSession((current) =>
          persistActiveExplored(current, getExploredHexes()),
        )
      }

      rebakeTerrainRef.current = rebakeTerrain

      // Roads once at mount; fog covers unexplored. Terrain/fog/props via chunks.
      paintRoads()
      rebakeTerrain()
      void chunkRenderer
        .rebuildAllProps(loadPropTexture, addPropSprite)
        .then(() => {
          if (!cancelled) {
            syncMapArtDepth()
          }
        })

      const ACTOR_ABOVE_NON_OVERLAP_PROP = 1_000_000

      const unitOverlapsPropCull = (
        cull: PropCullBox,
        worldX: number,
        worldY: number,
        radius: number,
      ) => {
        const { cullX: cx, cullY: cy, cullMargin: margin } = cull
        const reach = margin + radius
        return (
          worldX >= cx - reach &&
          worldX <= cx + reach &&
          worldY >= cy - reach &&
          worldY <= cy + reach
        )
      }

      const syncTownActorDepth = () => {
        if (!mapSceneLive()) {
          return
        }
        // World positions below assume markers live on heroLayer until we
        // reparent for keep occlusion.
        for (const entry of heroMarkers.values()) {
          if (entry.view.destroyed) {
            continue
          }
          if (entry.view.parent !== heroLayer) {
            heroLayer.addChild(entry.view)
          }
        }
        for (const entry of mobMarkers.values()) {
          if (entry.view.destroyed) {
            continue
          }
          if (entry.view.parent !== heroLayer) {
            heroLayer.addChild(entry.view)
          }
        }
        for (const entry of boatMarkers.values()) {
          if (entry.view.destroyed) {
            continue
          }
          if (entry.view.parent !== heroLayer) {
            heroLayer.addChild(entry.view)
          }
        }
        // Guarantee occlusion by parenting units under the town view (before the
        // sprite) when they are behind the keep. Entry/drawbridge stays a sibling
        // painted after the town so the unit stays on top. Missing hero art is
        // irrelevant — badge and sprite use the same Container.
        const townBoost = hexSize * 0.4

        type DepthItem = { view: Container; z: number }
        const backItems: DepthItem[] = []

        for (const entry of objectByKey.values()) {
          if (entry.view.destroyed) {
            continue
          }
          if (entry.data.kind !== 'town' || !entry.sprite.visible) {
            const hex =
              grid.getHex(entry.data) ?? grid.createHex(entry.data)
            const c = hexCenter(hex, offsetX, offsetY)
            const z = c.y - hexSize * 0.25
            entry.sortY = z
            backItems.push({ view: entry.view, z })
            continue
          }
          const keep = townBlockedHex(entry.data)
          const keepHex = grid.getHex(keep) ?? grid.createHex(keep)
          const kc = hexCenter(keepHex, offsetX, offsetY)
          const z = kc.y + townBoost
          entry.sortY = z
          backItems.push({ view: entry.view, z })
        }

        const townBehindWhich = (
          pos: { q: number; r: number },
          worldX: number,
          worldY: number,
        ) => {
          for (const entry of objectByKey.values()) {
            if (
              entry.view.destroyed ||
              entry.data.kind !== 'town' ||
              !entry.sprite.visible ||
              entry.sprite.destroyed
            ) {
              continue
            }
            const keep = townBlockedHex(entry.data)
            const keepHex = grid.getHex(keep) ?? grid.createHex(keep)
            const kc = hexCenter(keepHex, offsetX, offsetY)
            const entryHex =
              grid.getHex(entry.data) ?? grid.createHex(entry.data)
            const ec = hexCenter(entryHex, offsetX, offsetY)
            const sp = entry.sprite
            const groundY = entry.view.position.y + sp.position.y
            const topY = groundY - Math.abs(sp.height) * sp.anchor.y
            const midX =
              entry.view.position.x +
              sp.position.x +
              (0.5 - sp.anchor.x) *
                Math.abs(sp.width) *
                Math.sign(sp.scale.x || 1)
            const halfW = Math.max(Math.abs(sp.width) * 0.65, hexSize * 2)
            const flipped = entry.data.flipped === true

            // Entry/drawbridge stays in front. Flipped towns put that gate on
            // the left of the art; unflipped, it is on the right.
            if (entry.data.q === pos.q && entry.data.r === pos.r) {
              const onGateSide = flipped
                ? worldX <= midX + hexSize * 0.15
                : worldX >= midX - hexSize * 0.15
              const onDrawbridge =
                onGateSide && worldY >= Math.min(kc.y, ec.y) - hexSize * 0.1
              if (onDrawbridge) {
                return null
              }
            }

            // Keep side only, a short way behind the building. The gate and
            // the road leaving it are not "behind the keep".
            const keepSide = flipped ? 1 : -1
            const behind = (pos.q - keep.q) * keepSide
            const nearKeep =
              behind > 0 && behind <= 2 && pos.r <= keep.r && pos.r >= keep.r - 2
            const onFootprint =
              (pos.q === keep.q && pos.r === keep.r) ||
              (pos.q === entry.data.q && pos.r === entry.data.r)
            const underArt =
              worldY < kc.y + hexSize * 0.5 &&
              Math.abs(worldX - midX) <= halfW &&
              worldY >= topY - hexSize * 0.5
            if (nearKeep || onFootprint || underArt) {
              return entry
            }
          }
          return null
        }

        const placeUnit = (
          view: Container,
          pos: { q: number; r: number },
          worldX: number,
          worldY: number,
        ) => {
          if (view.destroyed) {
            return
          }
          const host = townBehindWhich(pos, worldX, worldY)
          if (host && !host.view.destroyed && !host.sprite.destroyed) {
            // Insert just before the town sprite so opaque castle pixels cover
            // the unit; transparent padding still shows the unit through.
            const spriteIdx = host.view.getChildIndex(host.sprite)
            host.view.addChildAt(view, Math.max(0, spriteIdx))
            view.position.set(
              worldX - host.view.position.x,
              worldY - host.view.position.y,
            )
            return
          }
          heroLayer.addChild(view)
          view.position.set(worldX, worldY)
        }

        const applyActorLayerZ = (
          view: Container,
          worldX: number,
          worldY: number,
        ) => {
          if (view.destroyed || view.parent !== heroLayer) {
            return
          }
          let z = Math.round(worldY * 1000) + ACTOR_ABOVE_NON_OVERLAP_PROP
          const radius = hexSize * 0.45
          for (const prop of chunkRenderer.blockingPropEntries()) {
            if (prop.sprite.destroyed) {
              continue
            }
            if (!unitOverlapsPropCull(prop.cull, worldX, worldY, radius)) {
              continue
            }
            const propZ = Math.round(prop.sprite.y * 1000)
            if (prop.sprite.y > worldY) {
              z = Math.min(z, propZ - 1)
            } else {
              z = Math.max(z, propZ + 1)
            }
          }
          view.zIndex = z
        }

        for (const hero of getSession().heroes) {
          const marker = heroMarkers.get(hero.id)
          if (!marker?.view.visible) {
            continue
          }
          const hex =
            grid.getHex(hero.position) ?? grid.createHex(hero.position)
          const c = hexCenter(hex, offsetX, offsetY)
          const same = getSession().heroes.filter(
            (h) =>
              heroVisibleOnMap(h) &&
              h.position.q === hero.position.q &&
              h.position.r === hero.position.r,
          )
          let spread = 0
          if (same.length > 1) {
            const index = same.findIndex((h) => h.id === hero.id)
            spread = (index - (same.length - 1) / 2) * hexSize * 0.45
          }
          placeUnit(marker.view, hero.position, c.x + spread, c.y)
        }
        for (const mob of getSession().mobs) {
          const marker = mobMarkers.get(mob.id)
          if (!marker?.view.visible) {
            continue
          }
          const hex =
            grid.getHex(mob.position) ?? grid.createHex(mob.position)
          const c = hexCenter(hex, offsetX, offsetY)
          placeUnit(marker.view, mob.position, c.x, c.y)
        }
        for (const boat of getSession().boats ?? []) {
          if (boat.occupant_hero_id != null) {
            continue
          }
          const marker = boatMarkers.get(boat.id)
          if (!marker?.view.visible || marker.view.destroyed) {
            continue
          }
          const hex =
            grid.getHex(boat.position) ?? grid.createHex(boat.position)
          const c = hexCenter(hex, offsetX, offsetY)
          placeUnit(marker.view, boat.position, c.x, c.y)
        }

        backItems.sort((a, b) => a.z - b.z)
        for (const item of backItems) {
          if (!item.view.destroyed) {
            artLayer.addChild(item.view)
          }
        }

        chunkRenderer.syncBlockingPropsToActorLayer(heroLayer)

        for (const hero of getSession().heroes) {
          const marker = heroMarkers.get(hero.id)
          if (!marker?.view.visible || marker.view.destroyed) {
            continue
          }
          const { x, y } = markerWorldXY(marker.view)
          applyActorLayerZ(marker.view, x, y)
        }
        for (const mob of getSession().mobs) {
          const marker = mobMarkers.get(mob.id)
          if (!marker?.view.visible || marker.view.destroyed) {
            continue
          }
          const { x, y } = markerWorldXY(marker.view)
          applyActorLayerZ(marker.view, x, y)
        }
        for (const boat of getSession().boats ?? []) {
          if (boat.occupant_hero_id != null) {
            continue
          }
          const marker = boatMarkers.get(boat.id)
          if (!marker?.view.visible || marker.view.destroyed) {
            continue
          }
          const { x, y } = markerWorldXY(marker.view)
          applyActorLayerZ(marker.view, x, y)
        }
        heroLayer.sortChildren()
        syncMapArtDepth()
      }

      const placeEmptyBoatMarkers = () => {
        const session = getSession()
        const token = hexSize * 0.5 * 2
        const seen = new Set<string>()
        for (const boat of session.boats ?? []) {
          if (boat.occupant_hero_id != null) {
            continue
          }
          seen.add(boat.id)
          const visible = isExplored(boat.position.q, boat.position.r)
          const file = HERO_TRAVEL_FILES.boat
          let texture: Texture | null = null
          if (travelArtByFile.has(file)) {
            texture = travelArtByFile.get(file) ?? null
          } else if (!travelArtLoading.has(file)) {
            travelArtLoading.add(file)
            void loadTravelTexture(file).then((loaded) => {
              travelArtByFile.set(file, loaded)
              travelArtLoading.delete(file)
              if (!cancelled) {
                placeEmptyBoatMarkers()
              }
            })
          }
          let entry = boatMarkers.get(boat.id)
          if (!entry) {
            const view = new Container()
            const badge = new Graphics()
            const sprite = new Sprite()
            sprite.anchor.set(0.5)
            view.addChild(badge, sprite)
            heroLayer.addChild(view)
            entry = { view, badge, sprite }
            boatMarkers.set(boat.id, entry)
          }
          entry.view.visible = visible
          if (!visible) {
            continue
          }
          const hasArt =
            texture != null && texture.width >= 1 && texture.height >= 1
          entry.sprite.visible = hasArt
          entry.badge.visible = !hasArt
          if (hasArt && texture) {
            const scale = Math.min(token / texture.width, token / texture.height)
            entry.sprite.texture = texture
            entry.sprite.scale.set(scale)
          } else {
            entry.badge.clear()
            entry.badge.circle(0, 0, hexSize * 0.35)
            entry.badge.fill({ color: NEUTRAL_OBJECT_COLOR })
            entry.badge.stroke({ width: 1, color: 0x111111 })
          }
          const hex =
            grid.getHex(boat.position) ?? grid.createHex(boat.position)
          const center = hexCenter(hex, offsetX, offsetY)
          entry.view.position.set(center.x, center.y)
        }
        for (const [id, entry] of boatMarkers) {
          if (seen.has(id)) {
            continue
          }
          entry.view.parent?.removeChild(entry.view)
          entry.view.destroy({ children: true })
          boatMarkers.delete(id)
        }
        syncTownActorDepth()
        applyActorCull()
      }

      const placeHeroMarkers = () => {
        const session = getSession()
        const sessionHeroes = session.heroes
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
          const travel = heroTravelSprite(hero, session)
          let texture: Texture | null = null
          if (travel) {
            const file = travel.file
            if (travelArtByFile.has(file)) {
              texture = travelArtByFile.get(file) ?? null
            } else if (!travelArtLoading.has(file)) {
              travelArtLoading.add(file)
              void loadTravelTexture(file).then((loaded) => {
                travelArtByFile.set(file, loaded)
                travelArtLoading.delete(file)
                if (!cancelled) {
                  placeHeroMarkers()
                }
              })
            }
          }
          let entry = heroMarkers.get(hero.id)
          if (!entry) {
            const view = new Container()
            const badge = new Graphics()
            const sprite = new Sprite()
            sprite.anchor.set(0.5)
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
            view.addChild(badge, sprite, label)
            heroLayer.addChild(view)
            entry = { view, label, badge, sprite }
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
          // Fit travel art to roughly one hex (same budget as feature tokens).
          const token = hexSize * 0.9 * 2
          const hasArt =
            texture != null && texture.width >= 1 && texture.height >= 1
          entry.sprite.visible = hasArt
          entry.badge.visible = true
          entry.label.visible = true
          const ownerColor =
            ownerTint(hero.player_id) ?? NEUTRAL_OBJECT_COLOR
          if (hasArt && texture) {
            const scale = Math.min(token / texture.width, token / texture.height)
            entry.sprite.texture = texture
            entry.sprite.scale.set(
              travel.flipX ? -Math.abs(scale) : Math.abs(scale),
              Math.abs(scale),
            )
            // Owner-coloured base under the sprite + ring for selection.
            entry.badge.clear()
            entry.badge.circle(0, hexSize * 0.12, hexSize * 0.38)
            entry.badge.fill({ color: ownerColor, alpha: 0.85 })
            entry.badge.circle(0, 0, hexSize * (selected ? 0.62 : 0.55))
            entry.badge.stroke({
              width: selected ? 3 : 2,
              color: selected ? 0xffffff : ownerColor,
            })
            entry.label.position.set(0, hexSize * 0.78)
            entry.label.style.fill = 0xffffff
          } else {
            // Missing-art fallback: original circle + name token.
            entry.badge.clear()
            entry.badge.circle(0, 0, hexSize * (selected ? 0.62 : 0.55))
            entry.badge.fill({ color: ownerColor })
            entry.badge.stroke({
              width: selected ? 3 : 2,
              color: selected ? 0xffffff : 0x111111,
            })
            entry.label.position.set(0, 0)
          }
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
          entry.view.parent?.removeChild(entry.view)
          entry.view.destroy({ children: true })
          heroMarkers.delete(id)
        }
        placeEmptyBoatMarkers()
        syncTownActorDepth()
        applyActorCull()
      }
      const placeMobMarkers = () => {
        const session = getSession()
        const catalog = getCachedCatalog()
        const token = hexSize * 0.42 * 2
        const seen = new Set<string>()
        for (const mob of session.mobs) {
          seen.add(mob.id)
          const visible = isExplored(mob.position.q, mob.position.r)
          const lead = mobLeadStack(session, mob)
          const filename = lead
            ? unitById(catalog, lead.unit_id)?.image_path?.trim() || null
            : null
          const artUrl = filename ? unitPortraitUrl(filename) : null
          let texture: Texture | null = null
          if (artUrl) {
            if (unitArtByUrl.has(artUrl)) {
              texture = unitArtByUrl.get(artUrl) ?? null
            } else if (!unitArtLoading.has(artUrl)) {
              unitArtLoading.add(artUrl)
              void loadTextureUrl(artUrl).then((loaded) => {
                unitArtByUrl.set(artUrl, loaded)
                unitArtLoading.delete(artUrl)
                if (!cancelled) {
                  placeMobMarkers()
                }
              })
            }
          }
          let entry = mobMarkers.get(mob.id)
          if (!entry) {
            const view = new Container()
            const badge = new Graphics()
            const sprite = new Sprite()
            sprite.anchor.set(0.5)
            const label = new Text({
              text: mobLabel(session, catalog, mob),
              style: {
                fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
                fontSize: Math.max(9, Math.round(hexSize * 0.55)),
                fontWeight: '700',
                fill: 0xffffff,
              },
              anchor: 0.5,
            })
            const qty = new Text({
              text: '',
              style: {
                fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
                fontSize: Math.max(8, Math.round(hexSize * 0.4)),
                fontWeight: '700',
                fill: 0xffffff,
              },
              anchor: { x: 1, y: 1 },
            })
            view.addChild(badge, sprite, label, qty)
            heroLayer.addChild(view)
            entry = { view, badge, label, sprite, qty }
            mobMarkers.set(mob.id, entry)
          } else {
            entry.label.text = mobLabel(session, catalog, mob)
          }
          entry.view.visible = visible
          if (!visible) {
            continue
          }
          const hasArt = texture != null && texture.width >= 1 && texture.height >= 1
          entry.sprite.visible = hasArt
          entry.badge.visible = !hasArt
          entry.label.visible = !hasArt
          entry.qty.visible = hasArt
          if (hasArt && texture) {
            const scale = Math.min(token / texture.width, token / texture.height)
            entry.sprite.texture = texture
            entry.sprite.scale.set(scale)
            entry.qty.text = formatAmount(
              lead ? mobUnitQty(session, mob, lead.unit_id) : 0,
            )
            entry.qty.position.set(token / 2, token / 2)
          } else {
            entry.badge.clear()
            entry.badge.circle(0, 0, hexSize * 0.42)
            entry.badge.fill({ color: NEUTRAL_OBJECT_COLOR })
            entry.badge.stroke({ width: 2, color: 0x111111 })
          }
          const hex = grid.getHex(mob.position) ?? grid.createHex(mob.position)
          const center = hexCenter(hex, offsetX, offsetY)
          entry.view.position.set(center.x, center.y)
        }
        for (const [id, entry] of mobMarkers) {
          if (seen.has(id)) {
            continue
          }
          entry.view.parent?.removeChild(entry.view)
          entry.view.destroy({ children: true })
          mobMarkers.delete(id)
        }
        syncTownActorDepth()
        applyActorCull()
      }
      applyHeroMarkerLabel = () => {
        placeHeroMarkers()
        placeMobMarkers()
        placeEmptyBoatMarkers()
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
        if (!cameraFollowMoves) {
          return
        }
        const hero = heroRef.current
        if (!hero) {
          return
        }
        panToHex(hero.q, hero.r)
      }
      const switchToMapHero = (id: string) => {
        const session = getSession()
        const actor = activePlayer(session)
        let row = session.heroes.find((hero) => hero.id === id)
        if (!row) {
          return
        }
        if (
          actor &&
          row.player_id !== actor.id &&
          !actor.hero_ids.includes(row.id)
        ) {
          return
        }
        // Circling: re-check landing on select (don't wait for next day).
        if (row.flight?.circling && !moving) {
          let arrivedTownId: string | null = null
          let siegeTownId: string | null = null
          updateSession((current) => {
            const result = finalizeHeroFlightSegment(current, id)
            arrivedTownId = result.arrivedTownId
            siegeTownId = result.siegeTownId
            return result.session
          })
          row = getSession().heroes.find((hero) => hero.id === id) ?? row
          if (siegeTownId) {
            selectedMapHeroId = row.id
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
            placeHeroMarkers()
            placeMobMarkers()
            onSiegeTownRef.current(siegeTownId)
            return
          }
          if (arrivedTownId) {
            selectedMapHeroId = row.id
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
            placeHeroMarkers()
            placeMobMarkers()
            const town = findTownById(getSession(), arrivedTownId)
            if (town && !activePlayer(getSession())?.is_ai) {
              onTownWelcome(town.name, town.id)
            }
            return
          }
          // Still blocked / circling — fall through to normal select.
        }
        selectedMapHeroId = row.id
        moveGen += 1
        moving = false
        waypointPlan = null
        preview.clear()
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
        placeMobMarkers()
      }
      selectMapHero = switchToMapHero
      if (selectedMapHeroId && selectedMapHeroId !== heroRef.current?.id) {
        switchToMapHero(selectedMapHeroId)
      }

      applyHotseatView = () => {
        const session = getSession()
        const player = activePlayer(session)
        restoreExplored(player?.explored)
        rebakeTerrain()
        void chunkRenderer
          .rebuildAllProps(loadPropTexture, addPropSprite)
          .then(() => {
            if (!cancelled) {
              syncMapArtDepth()
            }
          })
        walletRef.current = walletFromSession(session)
        emitResources()
        const ownHeroes = player
          ? session.heroes.filter((hero) => hero.player_id === player.id)
          : []
        const keep =
          ownHeroes.find((hero) => hero.id === selectedMapHeroId) ?? ownHeroes[0]
        if (keep) {
          switchToMapHero(keep.id)
          return
        }
        selectedMapHeroId = null
        heroRef.current = null
        placeHeroMarkers()
        placeMobMarkers()
      }

      const paintOwnedMarkers = () => {
        const sessionNow = getSession()
        for (const entry of objectByKey.values()) {
          if (entry.data.kind === 'town') {
            const town = findTownAt(sessionNow, entry.data.q, entry.data.r)
            if (entry.sprite.visible) {
              placeTownOwnershipRing(entry, town?.player_id)
            } else {
              paintObjectBadge(entry.badge, townFill(town?.player_id))
              entry.label.style.fill = town?.player_id != null ? '#ffffff' : '#111111'
            }
            continue
          }
          if (entry.data.kind === 'pickup') {
            continue
          }
          if (entry.data.kind !== 'mine') {
            continue
          }
          const node = findNodeAt(sessionNow, entry.data.q, entry.data.r)
          const owned = node?.player_id != null
          if (entry.sprite.visible) {
            paintOwnershipRing(
              entry.ring,
              owned ? node.player_id : null,
              featureHexSize(entry.data.q, entry.data.r).width * 0.58,
            )
            continue
          }
          paintObjectBadge(
            entry.badge,
            owned ? townFill(node.player_id) : NEUTRAL_OBJECT_COLOR,
          )
          entry.label.style.fill = owned ? '#ffffff' : '#111111'
        }
      }
      placeHeroMarkers()
      placeMobMarkers()
      paintOwnedMarkers()
      paintZoneDebug()
      const unsubHeroes = subscribe(() => {
        placeHeroMarkers()
        placeMobMarkers()
        paintOwnedMarkers()
      })
      const unsubCatalog = subscribeCatalog(() => {
        placeHeroMarkers()
        placeMobMarkers()
        for (const entry of objectByKey.values()) {
          if (
            entry.data.kind === 'mine' ||
            entry.data.kind === 'pickup' ||
            entry.data.kind === 'town' ||
            entry.data.kind === 'fountain' ||
            entry.data.kind === 'chest' ||
            entry.data.kind === 'sign' ||
            entry.data.kind === 'library' ||
            entry.data.kind === 'hanger' ||
            entry.data.kind === 'dock' ||
            entry.data.kind === 'recruits' ||
            entry.data.kind === 'notice_board'
          ) {
            loadObjectFeatureArt(entry)
          }
        }
        paintOwnedMarkers()
        // app_config flags that affect terrain appearance
        rebakeTerrain()
      })
      signal.addEventListener('abort', unsubHeroes, { once: true })
      signal.addEventListener('abort', unsubCatalog, { once: true })

      const syncChestSprites = () => {
        const chestKeys = new Set(
          (getSession().features ?? [])
            .filter((row) => row.kind === 'chest')
            .map((row) => `${row.position.q},${row.position.r}`),
        )
        for (const [key, entry] of [...objectByKey.entries()]) {
          if (entry.data.kind !== 'chest') {
            continue
          }
          if (!chestKeys.has(key)) {
            artLayer.removeChild(entry.view)
            entry.view.destroy({ children: true })
            objectByKey.delete(key)
            continue
          }
          loadObjectFeatureArt(entry)
        }
      }
      const unsubFeatures = subscribe(syncChestSprites)
      signal.addEventListener('abort', unsubFeatures, { once: true })

      if (heroRef.current) {
        exploreAround(heroRef.current)
        resolveHex(heroRef.current.q, heroRef.current.r)
      }
      followHero()
      emitResources()

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
        tipEl.hidden = true
      }

      const clearWaypoints = () => {
        waypointPlan = null
      }

      const drawPreview = (steps: Array<Hex | Axial>) => {
        preview.clear()
        for (const hex of steps) {
          const live = 'corners' in hex ? hex : grid.getHex(hex) ?? grid.createHex(hex)
          if (!live) {
            continue
          }
          preview.poly(
            live.corners.map((corner) => ({
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
        if (!hero || moving || mapInputLocked) {
          return
        }
        const hex = hexFromPointer(event)
        if (!hex || !getTile(hex.q, hex.r)) {
          clearPreview()
          tipEl.hidden = true
          return
        }
        const occupant = otherHeroAt(hex.q, hex.r, hero.id)
        const town = findTownAt(getSession(), hex.q, hex.r)
        const enemyTown = enemyOwnedTownAt(hex.q, hex.r, hero.id)
        const mob = visibleMobAt(hex.q, hex.r)
        const node = liveNodeAt(hex.q, hex.r)
        const fountain = liveFountainAt(hex.q, hex.r)
        const chest = liveChestAt(hex.q, hex.r)
        const sign = liveSignAt(hex.q, hex.r)
        const library = liveWorldLibraryAt(hex.q, hex.r)
        const hanger = liveWorldHangerAt(hex.q, hex.r)
        const dock = liveWorldDockAt(hex.q, hex.r)
        const recruits = liveWorldRecruitsAt(hex.q, hex.r)
        const noticeBoard = liveNoticeBoardAt(hex.q, hex.r)
        const emptyBoat = emptyBoatAt(hex.q, hex.r)
        const selfOnHex =
          hero.q === hex.q && hero.r === hex.r
            ? getSession().heroes.find((row) => row.id === hero.id)
            : undefined
        const actor = activePlayer(getSession())
        const catalog = getCachedCatalog()
        const tipText = worldHoverTooltipText(getSession(), catalog, {
          town: town ?? enemyTown,
          hero: occupant ?? selfOnHex,
          mob,
          node,
          fountain: fountain != null,
          chestName: chest?.name ?? null,
          signText: sign
            ? signTooltipText(sign, actor?.id)
            : null,
          libraryText:
            library && catalog
              ? worldLibraryTooltipText(library, catalog, actor?.id)
              : library
                ? 'Library'
                : null,
          hanger: hanger != null,
          dock: dock != null,
          recruits: recruits != null,
          noticeBoardText: noticeBoard
            ? noticeBoardTooltip(getSession(), noticeBoard)
            : null,
          emptyBoat: emptyBoat != null,
        })
        const wpTip =
          waypointPlan && waypointPlan.waypoints.length > 0
            ? `WP ${waypointPlan.waypoints.length} · ${formatMp(waypointPlan.remaining)} left`
            : null
        if (tipText || wpTip) {
          tipEl.hidden = false
          tipEl.textContent = [wpTip, tipText].filter(Boolean).join('\n')
          const hostBox = host.getBoundingClientRect()
          tipEl.style.left = `${event.clientX - hostBox.left + 14}px`
          tipEl.style.top = `${event.clientY - hostBox.top + 14}px`
        } else {
          tipEl.hidden = true
        }
        const undefendedEnemy =
          enemyTown != null &&
          townIsUndefended(getSession(), enemyTown, hero.id)
        const liveHero = getSession().heroes.find((row) => row.id === hero.id)
        const aboard = liveHero
          ? boatOccupiedByHero(getSession(), liveHero.id)
          : undefined
        // Click-on features are never walkOnto — approach adjacent only.
        const walkOnto =
          !aboard &&
          !occupant &&
          !mob &&
          !chest &&
          !sign &&
          !library &&
          !hanger &&
          !dock &&
          !recruits &&
          !noticeBoard
            ? emptyBoat
              ? hex
              : undefendedEnemy || (!enemyTown && (town || node || fountain))
                ? hex
                : null
            : null
        const hoverBlocked = obstacleHexes(hero, walkOnto)
        const from = waypointPlan?.end ?? hero
        const budget = waypointPlan?.remaining ?? hero.remaining
        const hoverKey = `${from.q},${from.r},${budget}->${hex.q},${hex.r}|${walkOnto ? 'on' : 'off'}|wp:${waypointPlan?.waypoints.length ?? 0}|ab:${aboard?.id ?? 'none'}|${[...hoverBlocked].sort().join(';')}`
        if (hoverKey === lastHoverKey) {
          return
        }
        lastHoverKey = hoverKey
        if (aboard) {
          const moverPlayerId = liveHero?.player_id ?? ''
          let sailDest: Axial | null = null
          if (
            isDisembarkLandHex(hex.q, hex.r) &&
            hexDistance(from, hex) <= 1
          ) {
            sailDest = hex
          } else if (boatEnterCost(hex.q, hex.r) != null) {
            sailDest = hex
          } else {
            sailDest = sailDestForLandGoal(from, hex, aboard.id, moverPlayerId)
          }
          if (!sailDest || (sailDest.q === from.q && sailDest.r === from.r)) {
            preview.clear()
            return
          }
          const sailSteps =
            isDisembarkLandHex(sailDest.q, sailDest.r) &&
            hexDistance(from, sailDest) <= 1
              ? [sailDest]
              : sailMovementSteps(
                  grid,
                  from,
                  sailDest,
                  budget,
                  getSession(),
                  aboard.id,
                  moverPlayerId,
                )
          if (sailSteps.length === 0) {
            preview.clear()
            return
          }
          drawPreview(sailSteps)
          return
        }
        const dest =
          occupant ||
          (enemyTown && !undefendedEnemy) ||
          mob ||
          chest ||
          sign ||
          library ||
          hanger ||
          dock ||
          recruits ||
          noticeBoard
            ? approachHex(
                from,
                occupant?.position ??
                  enemyTown?.position ??
                  mob?.position ??
                  chest?.position ??
                  sign?.position ??
                  library?.position ??
                  hanger?.position ??
                  dock?.position ??
                  recruits?.position ??
                  noticeBoard!.position,
                hoverBlocked,
              )
            : emptyBoat
              ? emptyBoat.position
              : hex
        if (!dest || (dest.q === from.q && dest.r === from.r)) {
          if (waypointPlan && waypointPlan.steps.length > 0) {
            drawPreview(waypointPlan.steps)
          } else {
            preview.clear()
          }
          return
        }
        const steps =
          emptyBoat && !occupant && !mob && !chest && !sign && !library && !hanger && !dock && !recruits && !noticeBoard
            ? boardBoatMovementSteps(
                grid,
                from,
                emptyBoat.position,
                budget,
                hoverBlocked,
              )
            : movementSteps(grid, from, dest, budget, hoverBlocked)
        if (steps.length === 0 && !(waypointPlan && waypointPlan.steps.length > 0)) {
          preview.clear()
          return
        }
        drawPreview([...(waypointPlan?.steps ?? []), ...steps])
      }

      const tryMoveTo = (
        to: Axial,
        after?: () => void,
        walkOnto?: Axial | null,
        precomputed?: Axial[] | null,
      ): Promise<boolean> => {
        const hero = heroRef.current
        if (!hero || moving) {
          return Promise.resolve(false)
        }
        const liveHero = getSession().heroes.find((row) => row.id === hero.id)
        if (liveHero?.flight) {
          return Promise.resolve(false)
        }
        const aboard = liveHero
          ? boatOccupiedByHero(getSession(), liveHero.id)
          : undefined
        if (aboard) {
          if (
            isDisembarkLandHex(to.q, to.r) &&
            hexDistance(hero, to) <= 1
          ) {
            updateSession((current) =>
              disembarkBoat(current, hero.id, to).session,
            )
            hero.remaining = 0
            onHeroState({
              id: hero.id,
              q: to.q,
              r: to.r,
              remaining: 0,
            })
            placeHeroMarkers()
            placeMobMarkers()
            exploreAround(hero)
            followHero()
            after?.()
            return Promise.resolve(true)
          }
          let sailTo = to
          const moverPlayerId = liveHero!.player_id
          if (boatEnterCost(to.q, to.r) == null) {
            const alt = sailDestForLandGoal(hero, to, aboard.id, moverPlayerId)
            if (!alt) {
              return Promise.resolve(false)
            }
            sailTo = alt
          } else if (
            !canSailOnto(getSession(), to.q, to.r, aboard.id, moverPlayerId)
          ) {
            return Promise.resolve(false)
          }
          if (
            sailTo.q === hero.q &&
            sailTo.r === hero.r &&
            to.q === hero.q &&
            to.r === hero.r
          ) {
            after?.()
            return Promise.resolve(true)
          }
          if (hero.remaining <= 1e-9) {
            return Promise.resolve(false)
          }
          const sailSteps =
            precomputed && precomputed.length > 0
              ? precomputed
              : sailMovementSteps(
                  grid,
                  hero,
                  sailTo,
                  hero.remaining,
                  getSession(),
                  aboard.id,
                  moverPlayerId,
                ).map((hex) => ({ q: hex.q, r: hex.r }))
          if (sailSteps.length === 0) {
            return Promise.resolve(false)
          }
          const gen = ++moveGen
          moving = true
          clearWaypoints()
          clearPreview()
          return new Promise((resolve) => {
            void (async () => {
              let finished = false
              for (const hex of sailSteps) {
                if (signal.aborted || gen !== moveGen || !heroRef.current) {
                  break
                }
                const naval = enemyBoatOccupantAt(
                  getSession(),
                  hex.q,
                  hex.r,
                  moverPlayerId,
                )
                if (naval) {
                  // Stop adjacent; combat is started by the caller (click / AI attack).
                  break
                }
                heroRef.current.q = hex.q
                heroRef.current.r = hex.r
                const cost = boatEnterCost(hex.q, hex.r)
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
                updateSession((current) =>
                  syncHeroBoatPosition(
                    current,
                    moved.id,
                    { q: moved.q, r: moved.r },
                    moved.remaining,
                  ),
                )
                placeHeroMarkers()
                placeMobMarkers()
                exploreAround(heroRef.current)
                followHero()
                await sleep(MOVE_STEP_MS, signal)
              }
              if (gen === moveGen) {
                moving = false
                after?.()
                finished = true
              }
              resolve(finished)
            })()
          })
        }
        if (to.q === hero.q && to.r === hero.r) {
          resolveHex(to.q, to.r)
          after?.()
          return Promise.resolve(true)
        }
        if (hero.remaining <= 1e-9) {
          return Promise.resolve(false)
        }
        const boardingBoat =
          walkOnto != null &&
          findBoatAt(getSession(), walkOnto.q, walkOnto.r)?.occupant_hero_id ==
            null
        const steps =
          precomputed && precomputed.length > 0
            ? precomputed
            : boardingBoat && walkOnto
              ? boardBoatMovementSteps(
                  grid,
                  hero,
                  walkOnto,
                  hero.remaining,
                  obstacleHexes(hero, walkOnto),
                ).map((hex) => ({ q: hex.q, r: hex.r }))
              : movementSteps(
                  grid,
                  hero,
                  to,
                  hero.remaining,
                  obstacleHexes(hero, walkOnto),
                ).map((hex) => ({ q: hex.q, r: hex.r }))
        if (steps.length === 0) {
          return Promise.resolve(false)
        }
        const gen = ++moveGen
        moving = true
        clearWaypoints()
        clearPreview()
        return new Promise((resolve) => {
          void (async () => {
            let finished = false
            for (const hex of steps) {
              if (signal.aborted || gen !== moveGen || !heroRef.current) {
                break
              }
              heroRef.current.q = hex.q
              heroRef.current.r = hex.r
              const cost =
                boardingBoat &&
                walkOnto &&
                hex.q === walkOnto.q &&
                hex.r === walkOnto.r
                  ? 1
                  : hexTransitionMoveCost(getCachedCatalog(), hex.q, hex.r)
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
              placeMobMarkers()
              exploreAround(heroRef.current)
              resolveHex(heroRef.current.q, heroRef.current.r, { fountain: true })
              followHero()
              await sleep(MOVE_STEP_MS, signal)
            }
            if (gen === moveGen) {
              moving = false
              after?.()
              finished = true
            }
            resolve(finished)
          })()
        })
      }
      requestMapMoveFn = (to, walkOnto) => tryMoveTo(to, undefined, walkOnto)

      playHeroFlightFn = (heroId) => {
        const live = getSession().heroes.find((row) => row.id === heroId)
        if (!live?.flight || moving) {
          return Promise.resolve({ arrivedTownId: null, siegeTownId: null })
        }
        const dest = getSession().towns.find(
          (town) => town.id === live.flight!.destination_town_id,
        )
        if (!dest) {
          return Promise.resolve({ arrivedTownId: null, siegeTownId: null })
        }
        switchToMapHero(heroId)
        const speed = flightSpeed(getCachedCatalog())
        // Circling: one full orbit around the town. En route: straight segment.
        const path = live.flight.circling
          ? townCircleLapSteps(dest.position, live.position, dest.flipped)
          : flightSegmentSteps(live.position, dest.position, speed)
        const gen = ++moveGen
        moving = true
        clearWaypoints()
        clearPreview()
        const followWas = cameraFollowMoves
        cameraFollowMoves = true

        const walkPath = async (steps: Axial[]) => {
          for (const hex of steps) {
            if (signal.aborted || gen !== moveGen || !heroRef.current) {
              return
            }
            heroRef.current.q = hex.q
            heroRef.current.r = hex.r
            heroRef.current.remaining = 0
            onHeroState({
              id: heroRef.current.id,
              q: heroRef.current.q,
              r: heroRef.current.r,
              remaining: 0,
            })
            updateSession((current) =>
              syncHeroFlightPosition(
                current,
                { q: hex.q, r: hex.r },
                heroId,
              ),
            )
            placeHeroMarkers()
            placeMobMarkers()
            followHero()
            await sleep(MOVE_STEP_MS, signal)
          }
        }

        return new Promise((resolve) => {
          void (async () => {
            await walkPath(path)
            let arrivedTownId: string | null = null
            let siegeTownId: string | null = null
            if (gen === moveGen) {
              updateSession((current) => {
                const result = finalizeHeroFlightSegment(current, heroId)
                arrivedTownId = result.arrivedTownId
                siegeTownId = result.siegeTownId
                return result.session
              })
              // Just entered circling after reaching dest — orbit once this turn.
              const after = getSession().heroes.find((h) => h.id === heroId)
              if (
                after?.flight?.circling &&
                !live.flight?.circling &&
                gen === moveGen
              ) {
                const lap = townCircleLapSteps(
                  dest.position,
                  after.position,
                  dest.flipped,
                )
                await walkPath(lap)
                if (gen === moveGen) {
                  updateSession((current) => {
                    const result = finalizeHeroFlightSegment(current, heroId)
                    arrivedTownId = result.arrivedTownId
                    siegeTownId = result.siegeTownId
                    return result.session
                  })
                }
              }
              const row = getSession().heroes.find((h) => h.id === heroId)
              if (row && heroRef.current) {
                heroRef.current.q = row.position.q
                heroRef.current.r = row.position.r
                heroRef.current.remaining = 0
                onHeroState({
                  id: row.id,
                  q: row.position.q,
                  r: row.position.r,
                  remaining: 0,
                })
                placeHeroMarkers()
                followHero()
              }
              moving = false
            }
            cameraFollowMoves = followWas
            resolve({ arrivedTownId, siegeTownId })
          })()
        })
      }

      canvas.addEventListener(
        'pointerdown',
        (event) => {
          if (event.button !== 0 || mapInputLocked) {
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
        if (wasDragging || moving || event.button !== 0 || mapInputLocked) {
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
        // Click own circling / in-flight hero (or re-click self) to select + recheck land.
        const selfRow = getSession().heroes.find((row) => row.id === hero.id)
        const allyOnHex = selfRow
          ? getSession().heroes.find(
              (row) =>
                row.player_id === selfRow.player_id &&
                row.position.q === hex.q &&
                row.position.r === hex.r,
            )
          : undefined
        if (
          allyOnHex &&
          (allyOnHex.flight != null || allyOnHex.id === hero.id)
        ) {
          switchToMapHero(allyOnHex.id)
          return
        }
        const commitViaWaypoints = (
          dest: Axial,
          after?: () => void,
          walkOnto?: Axial | null,
        ) => {
          if (!waypointPlan || waypointPlan.waypoints.length === 0) {
            clearWaypoints()
            void tryMoveTo(dest, after, walkOnto)
            return
          }
          const blocked = obstacleHexes(hero, walkOnto)
          const leg = resolveWorldWaypointLeg(
            grid,
            waypointPlan.end,
            dest,
            waypointPlan.remaining,
            blocked,
          )
          if (!leg) {
            clearWaypoints()
            void tryMoveTo(dest, after, walkOnto)
            return
          }
          void tryMoveTo(dest, after, walkOnto, [
            ...waypointPlan.steps,
            ...leg.steps,
          ])
        }
        const liveRow = getSession().heroes.find((row) => row.id === hero.id)
        const aboardNow = liveRow
          ? boatOccupiedByHero(getSession(), liveRow.id)
          : undefined
        if (aboardNow) {
          if (
            isDisembarkLandHex(hex.q, hex.r) &&
            hexDistance(hero, hex) <= 1
          ) {
            void tryMoveTo(hex, undefined, null)
            return
          }
          let sailTarget: Axial | null = null
          if (boatEnterCost(hex.q, hex.r) != null) {
            sailTarget = hex
          } else {
            sailTarget = sailDestForLandGoal(
              hero,
              hex,
              aboardNow.id,
              liveRow!.player_id,
            )
          }
          if (sailTarget) {
            void tryMoveTo(sailTarget, () => {
              const mover = heroRef.current
              if (!mover || !liveRow) {
                return
              }
              const naval = enemyBoatOccupantAt(
                getSession(),
                sailTarget.q,
                sailTarget.r,
                liveRow.player_id,
              )
              if (
                !naval ||
                hexDistance(mover, naval.hero.position) > 1
              ) {
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
              placeHeroMarkers()
              onHeroMeetRef.current(naval.hero.id)
            }, null)
          }
          return
        }
        // Shift-click: stage a waypoint on empty / walk-onto hexes only.
        if (event.shiftKey) {
          const occupantBlock = otherHeroAt(hex.q, hex.r, hero.id)
          const enemyTownBlock = enemyOwnedTownAt(hex.q, hex.r, hero.id)
          const mobBlock = visibleMobAt(hex.q, hex.r)
          if (
            occupantBlock ||
            (enemyTownBlock &&
              !townIsUndefended(getSession(), enemyTownBlock, hero.id)) ||
            mobBlock
          ) {
            return
          }
          const townHere = findTownAt(getSession(), hex.q, hex.r)
          const nodeHere = liveNodeAt(hex.q, hex.r)
          const fountainHere = liveFountainAt(hex.q, hex.r)
          const chestHere = liveChestAt(hex.q, hex.r)
          const signHere = liveSignAt(hex.q, hex.r)
          const libraryHere = liveWorldLibraryAt(hex.q, hex.r)
          const hangerHere = liveWorldHangerAt(hex.q, hex.r)
          const dockHere = liveWorldDockAt(hex.q, hex.r)
          const recruitsHere = liveWorldRecruitsAt(hex.q, hex.r)
          const noticeBoardHere = liveNoticeBoardAt(hex.q, hex.r)
          const walkOnto =
            !chestHere &&
            !signHere &&
            !libraryHere &&
            !hangerHere &&
            !dockHere &&
            !recruitsHere &&
            !noticeBoardHere &&
            (townHere || nodeHere || fountainHere)
              ? hex
              : null
          const blocked = obstacleHexes(hero, walkOnto)
          const base =
            waypointPlan &&
            waypointPlan.origin.q === hero.q &&
            waypointPlan.origin.r === hero.r
              ? waypointPlan
              : createWaypointPlan(
                  { q: hero.q, r: hero.r },
                  hero.remaining,
                )
          const next = tryAppendWaypoint(base, hex, (from, to, budget) =>
            resolveWorldWaypointLeg(grid, from, to, budget, blocked),
          )
          if (!next) {
            return
          }
          waypointPlan = next
          drawPreview(next.steps)
          tipEl.hidden = false
          tipEl.textContent = `WP ${next.waypoints.length} · ${formatMp(next.remaining)} left`
          const hostBox = host.getBoundingClientRect()
          tipEl.style.left = `${event.clientX - hostBox.left + 14}px`
          tipEl.style.top = `${event.clientY - hostBox.top + 14}px`
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
          commitViaWaypoints(dest, meet)
          return
        }
        const enemyTown = enemyOwnedTownAt(hex.q, hex.r, hero.id)
        if (enemyTown) {
          if (townIsUndefended(getSession(), enemyTown, hero.id)) {
            // Empty garrison / no defending army — walk onto the hex and claim.
            if (hero.q === enemyTown.position.q && hero.r === enemyTown.position.r) {
              resolveHex(enemyTown.position.q, enemyTown.position.r)
              return
            }
            commitViaWaypoints(hex, undefined, hex)
            return
          }
          const siege = () => {
            const mover = heroRef.current
            const live = findTownAt(getSession(), enemyTown.position.q, enemyTown.position.r)
            if (!mover || !live?.player_id) {
              return
            }
            const self = getSession().heroes.find((row) => row.id === mover.id)
            if (!self || live.player_id === self.player_id) {
              return
            }
            if (hexDistance(mover, live.position) > 1) {
              return
            }
            if (townIsUndefended(getSession(), live, mover.id)) {
              resolveHex(live.position.q, live.position.r)
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
            onSiegeTownRef.current(live.id)
          }
          if (hexDistance(hero, enemyTown.position) <= 1) {
            siege()
            return
          }
          const dest = approachHex(
            hero,
            enemyTown.position,
            obstacleHexes(hero),
          )
          if (!dest) {
            return
          }
          commitViaWaypoints(dest, siege)
          return
        }
        const mob = visibleMobAt(hex.q, hex.r)
        if (mob) {
          const fight = () => {
            const mover = heroRef.current
            const live = findMobAt(getSession(), mob.position.q, mob.position.r)
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
            onMobMeetRef.current(live.id)
          }
          if (hexDistance(hero, mob.position) <= 1) {
            fight()
            return
          }
          const dest = approachHex(hero, mob.position, obstacleHexes(hero))
          if (!dest) {
            return
          }
          commitViaWaypoints(dest, fight)
          return
        }
        const town = findTownAt(getSession(), hex.q, hex.r)
        if (town) {
          if (hero.q === town.position.q && hero.r === town.position.r) {
            resolveHex(town.position.q, town.position.r)
            return
          }
          commitViaWaypoints(hex, undefined, hex)
          return
        }
        const node = liveNodeAt(hex.q, hex.r)
        if (node) {
          commitViaWaypoints(hex, undefined, hex)
          return
        }
        const fountain = liveFountainAt(hex.q, hex.r)
        if (fountain) {
          commitViaWaypoints(hex, undefined, hex)
          return
        }
        const chest = liveChestAt(hex.q, hex.r)
        if (chest) {
          const offer = () => {
            const live = findChestAt(getSession(), chest.position.q, chest.position.r)
            if (!live) {
              return
            }
            updateSession((current) => openChest(current, live.id))
            const entry = objectByKey.get(`${live.position.q},${live.position.r}`)
            if (entry) {
              loadObjectFeatureArt(entry)
            }
            const heroId = selectedMapHeroId ?? heroRef.current?.id
            if (!heroId) {
              return
            }
            if (activePlayer(getSession())?.is_ai) {
              return
            }
            setMapInputLocked(true)
            onChestOfferRef.current?.({
              featureId: live.id,
              title: live.name,
              heroId,
            })
          }
          if (hexDistance(hero, chest.position) <= 1) {
            offer()
            return
          }
          const dest = approachHex(hero, chest.position, obstacleHexes(hero))
          if (!dest) {
            return
          }
          commitViaWaypoints(dest, offer)
          return
        }
        const sign = liveSignAt(hex.q, hex.r)
        if (sign) {
          const read = () => {
            const live = findSignAt(getSession(), sign.position.q, sign.position.r)
            if (!live) {
              return
            }
            const heroId = selectedMapHeroId ?? heroRef.current?.id
            if (!heroId) {
              return
            }
            if (activePlayer(getSession())?.is_ai) {
              return
            }
            const catalog = getCachedCatalog()
            if (!catalog) {
              return
            }
            let text: string | null = null
            updateSession((current) => {
              const result = readSign(current, catalog, live.id, heroId)
              if (!result) {
                return current
              }
              text = result.text
              return result.session
            })
            if (text) {
              onSignReadRef.current?.(text)
            }
          }
          if (hexDistance(hero, sign.position) <= 1) {
            read()
            return
          }
          const dest = approachHex(hero, sign.position, obstacleHexes(hero))
          if (!dest) {
            return
          }
          commitViaWaypoints(dest, read)
          return
        }
        const library = liveWorldLibraryAt(hex.q, hex.r)
        if (library) {
          const open = () => {
            const live = findWorldLibraryAt(
              getSession(),
              library.position.q,
              library.position.r,
            )
            if (!live) {
              return
            }
            const heroId = selectedMapHeroId ?? heroRef.current?.id
            if (!heroId) {
              return
            }
            const actor = activePlayer(getSession())
            if (!actor || actor.is_ai) {
              return
            }
            openWorldLibraryVisit(live.id, actor.id)
            setMapInputLocked(true)
            onWorldLibraryRef.current?.({
              featureId: live.id,
              heroId,
            })
          }
          if (hexDistance(hero, library.position) <= 1) {
            open()
            return
          }
          const dest = approachHex(hero, library.position, obstacleHexes(hero))
          if (!dest) {
            return
          }
          commitViaWaypoints(dest, open)
          return
        }
        const hanger = liveWorldHangerAt(hex.q, hex.r)
        if (hanger) {
          const open = () => {
            const live = findWorldHangerAt(
              getSession(),
              hanger.position.q,
              hanger.position.r,
            )
            if (!live) {
              return
            }
            const heroId = selectedMapHeroId ?? heroRef.current?.id
            if (!heroId) {
              return
            }
            const actor = activePlayer(getSession())
            if (!actor || actor.is_ai) {
              return
            }
            setMapInputLocked(true)
            onWorldHangerRef.current?.({
              featureId: live.id,
              heroId,
            })
          }
          if (hexDistance(hero, hanger.position) <= 1) {
            open()
            return
          }
          const dest = approachHex(hero, hanger.position, obstacleHexes(hero))
          if (!dest) {
            return
          }
          commitViaWaypoints(dest, open)
          return
        }
        const dock = liveWorldDockAt(hex.q, hex.r)
        if (dock) {
          const open = () => {
            const live = findWorldDockAt(
              getSession(),
              dock.position.q,
              dock.position.r,
            )
            if (!live) {
              return
            }
            const heroId = selectedMapHeroId ?? heroRef.current?.id
            if (!heroId) {
              return
            }
            const actor = activePlayer(getSession())
            if (!actor || actor.is_ai) {
              return
            }
            setMapInputLocked(true)
            onWorldDockRef.current?.({
              featureId: live.id,
              heroId,
            })
          }
          if (hexDistance(hero, dock.position) <= 1) {
            open()
            return
          }
          const dest = approachHex(hero, dock.position, obstacleHexes(hero))
          if (!dest) {
            return
          }
          commitViaWaypoints(dest, open)
          return
        }
        const recruits = liveWorldRecruitsAt(hex.q, hex.r)
        if (recruits) {
          const open = () => {
            const live = findWorldRecruitsAt(
              getSession(),
              recruits.position.q,
              recruits.position.r,
            )
            if (!live) {
              return
            }
            const heroId = selectedMapHeroId ?? heroRef.current?.id
            if (!heroId) {
              return
            }
            const actor = activePlayer(getSession())
            if (!actor || actor.is_ai) {
              return
            }
            setMapInputLocked(true)
            onWorldRecruitsRef.current?.({
              featureId: live.id,
              heroId,
            })
          }
          if (hexDistance(hero, recruits.position) <= 1) {
            open()
            return
          }
          const dest = approachHex(hero, recruits.position, obstacleHexes(hero))
          if (!dest) {
            return
          }
          commitViaWaypoints(dest, open)
          return
        }
        const noticeBoard = liveNoticeBoardAt(hex.q, hex.r)
        if (noticeBoard) {
          const open = () => {
            const live = findNoticeBoardAt(
              getSession(),
              noticeBoard.position.q,
              noticeBoard.position.r,
            )
            if (!live) {
              return
            }
            const heroId = selectedMapHeroId ?? heroRef.current?.id
            if (!heroId) {
              return
            }
            const actor = activePlayer(getSession())
            if (!actor || actor.is_ai) {
              return
            }
            setMapInputLocked(true)
            onWorldNoticeBoardRef.current?.({
              featureId: live.id,
              heroId,
            })
          }
          if (hexDistance(hero, noticeBoard.position) <= 1) {
            open()
            return
          }
          const dest = approachHex(
            hero,
            noticeBoard.position,
            obstacleHexes(hero),
          )
          if (!dest) {
            return
          }
          commitViaWaypoints(dest, open)
          return
        }
        const emptyBoat = emptyBoatAt(hex.q, hex.r)
        if (emptyBoat) {
          const board = () => {
            const heroId = selectedMapHeroId ?? heroRef.current?.id
            if (!heroId) {
              return
            }
            updateSession((current) =>
              boardBoat(current, heroId, emptyBoat.id).session,
            )
            const row = getSession().heroes.find((h) => h.id === heroId)
            if (row && heroRef.current) {
              heroRef.current.q = row.position.q
              heroRef.current.r = row.position.r
              heroRef.current.remaining = row.movement_remaining
              onHeroState({ ...heroRef.current })
            }
            placeHeroMarkers()
          }
          if (
            hero.q === emptyBoat.position.q &&
            hero.r === emptyBoat.position.r
          ) {
            board()
            return
          }
          commitViaWaypoints(emptyBoat.position, board, emptyBoat.position)
          return
        }
        commitViaWaypoints(hex)
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
          if (event.key === 'Escape' && waypointPlan) {
            event.preventDefault()
            clearWaypoints()
            clearPreview()
            tipEl.hidden = true
            return
          }
          if (!isArrow(event.key) || moving || mapInputLocked) {
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

      let perfFrame = 0
      instance.ticker.add((ticker) => {
        if (!mapSceneLive()) {
          return
        }
        chunkRenderer.noteFrame(ticker.deltaMS)
        perfFrame += 1
        if (perfFrame % 15 === 0) {
          setWorldRenderStats(chunkRenderer.stats(world))
        }
        if (moving || mapInputLocked) {
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
    })().catch((err) => {
      console.error('[hex] map init failed', err)
    })

    return () => {
      cancelled = true
      rebakeTerrainRef.current = null
      applyHeroMovement = null
      panMapToHex = null
      applyHeroMarkerLabel = null
      selectMapHero = null
      applyHotseatView = null
      requestMapMoveFn = null
      playHeroFlightFn = null
      abort.abort()
      app?.destroy()
    }
  }, [hexSize, onMapInfo, onHeroState, onResources, onTownWelcome, onFountainRestore, onChestOffer, onSignRead, onWorldLibrary, onWorldHanger, onWorldDock, onWorldRecruits, onWorldNoticeBoard])

  return <div ref={hostRef} className="hex-map" tabIndex={0} />
}
