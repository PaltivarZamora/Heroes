import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { Application, Container, Graphics } from 'pixi.js'
import type { Hex } from 'honeycomb-grid'
import {
  ATTACKER_COL,
  ATTACKER_HERO_COL,
  COMBAT_COLUMNS,
  COMBAT_HEX_SIZE,
  COMBAT_ROWS,
  DEFENDER_COL,
  DEFENDER_HERO_COL,
  HERO_ROW,
  armySlotRow,
  combatEncounterSeed,
  createCombatHexGrid,
  hexFloorAnchor,
  neighborhoodTerrains,
  pickCombatTerrain,
  siegeMoatColForRow,
  siegeTileTerrain,
} from './battlefield'
import {
  addMaskedTerrainHex,
  loadAllTerrainTextures,
  loadTextureUrl,
  pickTerrainVariantIndex,
} from '../hex/terrainTextures'
import { terrainFillColor } from '../hex/world'
import { DebugCopyPanel } from '../hex/DebugCopyPanel'
import type { DebugSections } from '../hex/debug'
import { formatMp, MOVE_STEP_MS } from '../hex/hero'
import { axialNeighborDirs } from '../hex/pathfinding'
import { ARMY_STACK_SLOTS, type Hero } from '../session/types'
import { getSession, subscribe, updateSession } from '../session/store'
import {
  fetchCatalog,
  getCachedCatalog,
  subscribeCatalog,
  shapePulsesOnMove,
  terrainByName,
  unitAttackShape,
  unitById,
  unitIsStationary,
  unitTakesTurns,
  unitAutoTarget,
  combatEndTimerSeconds,
  combatLogTimerSeconds,
  type AbilityRow,
} from '../town/catalog'
import { heroPortraitUrl, terrainArtUrl, unitPortraitUrl } from '../town/slotArt'
import {
  TOMBSTONE_ART,
  tombstoneAt,
  tombstoneName,
  tombstoneOccupancyBodies,
} from './tombstone'
import { formatAmount } from '../hex/resources'
import type { UnitStackView } from '../town/unitStack'
import {
  activeStack,
  advanceTurn,
  applyOwnSilenceAfterTurn,
  clearFervorStreak,
  createBattle,
  endStackTurn,
  grantFervorExtraTurn,
  moveStack,
  tryFervorChain,
  type BattleLog,
  type CombatBattle,
  type CombatSide,
  type CombatStack,
  type CombatTile,
  type SiegeSetup,
  isHeroStack,
  stackCombatSpeed,
  stackMoveSpeed,
} from './battle'
import {
  canCombatStep,
  combatMovementReachable,
  combatStackCells,
  footprintSpecFor,
  groundEffectMovementBlockKeys,
  hexKey,
  landingOccupiedForMover,
  moveKindForUnit,
  movementLogLine,
  occupiedForMover,
  resolveCombatWaypointLeg,
  stackOccupyingHex,
  stopOnlyForMover,
} from './movement'
import { deathKnightShadowMoveAdjust } from './shadow'
import { tryLeaveTerrainOnMove } from './factory'
import { auraRadiusHexKeys } from './templePassive'
import { chanceRollLog } from './combatLog'
import {
  tryLeaveGroundEffectOnMoveOrigin,
  tryLeaveGroundEffectOnMoveStep,
  tryTriggerGroundEffectsOnEnter,
  fireHazardSummaryLine,
} from './groundEffect'
import { resolveAttack, pickAutoAttackTarget, heroForSide, type HitFlashColor } from './attack'
import { combatOwnerPlayer, decideCombatAction } from '../ai/combat'
import { decideHeroAbility } from '../ai/heroAbility'
import {
  applyConsumedCondition,
  confuseConditionId,
  fearConditionId,
  isConfused,
  isFeared,
  isMagicAttackSilenced,
  isPolymorphed,
  isStunned,
  pickFleeSteps,
  pickRetreatSteps,
  polymorphConditionName,
  POLYMORPH_ART_FILENAME,
  stunConditionId,
} from './condition'
import {
  resolveAbility,
  abilityAimImpactKeys,
  abilityNeedsHexTarget,
  abilityUsesLinePlacementPreview,
  abilityUsesLocalizedEmptyHexAim,
  abilityValidHexKeys,
  parseTarget,
} from './ability'
import { applyStandingHazards, type HazardTick } from './hazards'
import { applyTerrainGrowth, tryTempestStormScatter } from './confluence'
import { visibleGroundEffects } from './groundEvasion'
import { tryAutoSplitOnTurn } from './mudSplit'
import {
  actingStand,
  canStrikeThisTurn,
  combatHover,
  confusedAttackIntent,
  pointerHexZone,
  type CombatHover,
  type HexZone,
} from './target'
import {
  createWaypointPlan,
  tryAppendWaypoint,
  waypointStepKeys,
  type WaypointPlan,
} from '../hex/waypoints'
import { CombatTargetIcon } from './CombatIcons'
import { HeroAbilityPopup } from './HeroAbilityPopup'
import { StackInspectPopup } from './StackInspectPopup'
import { inspectHoverRows } from './inspect'
import { heroTooltipText } from '../town/HeroTooltip'
import {
  abilityCooldownReady,
  canAffordAbility,
  deductAbilityCost,
  markHeroActed,
  ownHeroAtHex,
  recordAbilityCast,
  type HeroCast,
} from './heroCast'
import { abilityMeetsCastGate, applyShamanBattleStartTotems } from './summon'
import {
  commitCombatOutcome,
  defeatedSide,
  snapshotOpening,
  type CombatSummary,
  type OpeningStack,
} from './resolve'
import type { LevelUpNotice } from '../session/xp'
import {
  DRAWBRIDGE_ROW_INDEX,
  isDrawbridgeOpen,
  isSiegeEngineUnit,
  isWallSegmentUnit,
  openBridgeMoatKeys,
  siegeCatapultHex,
  siegeDrawbridgeDownArt,
  siegeEngineArt,
  siegeSegmentArt,
  siegeWallHexes,
  townTypeName,
} from './siege'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

type WalkHazardAcc = {
  lines: string[]
  fireHits: number
  fireDmg: number
  fireKilled: number
  fireLabel: string
  hitKeys: string[]
}

function emptyWalkHazardAcc(): WalkHazardAcc {
  return {
    lines: [],
    fireHits: 0,
    fireDmg: 0,
    fireKilled: 0,
    fireLabel: '',
    hitKeys: [],
  }
}

function absorbWalkHazard(acc: WalkHazardAcc, tick: HazardTick): void {
  acc.lines.push(...tick.moatLines)
  acc.fireHits += tick.fireHits
  acc.fireDmg += tick.fireDamage
  acc.fireKilled += tick.fireKilled
  // Only keep a label from ticks that actually dealt Fire/Storm damage —
  // empty later steps must not overwrite Storm → "Fire".
  if (tick.fireHits > 0 && tick.fireLabel.trim()) {
    acc.fireLabel = tick.fireLabel
  }
  acc.hitKeys.push(...tick.hitKeys)
}

function walkHazardLogLines(
  acc: WalkHazardAcc,
  unitName: string,
): string[] {
  const fire = fireHazardSummaryLine(
    acc.fireHits,
    acc.fireDmg,
    acc.fireKilled,
    unitName,
    acc.fireLabel || 'Fire',
  )
  return fire ? [...acc.lines, fire] : [...acc.lines]
}

const AUTO_ACT_MS = 1500
const HIT_FLASH_MS = 450
/** Earth Spikes / paced multi-hit knockback spacing. */
const ABILITY_BEAT_MS = 500
/** app_config sentinel: no auto-dismiss (Space/Esc only). */
const POPUP_NO_AUTO_SECS = 99

type CombatScreenProps = {
  attackerHeroId: string
  defenderHeroId: string | null
  siegeTownId?: string | null
  defenderMobId?: string | null
  debugSections: DebugSections
  onExit: (levelUp?: LevelUpNotice | null) => void
}

type StackMarker = {
  key: string
  side: CombatSide
  slot: number
  x: number
  y: number
  q: number
  r: number
}

type HexAnchor = {
  q: number
  r: number
  x: number
  y: number
}

type FieldView = {
  width: number
  height: number
  hexPx: number
  markers: StackMarker[]
  anchors: HexAnchor[]
  tiles: CombatTile[]
  siege: SiegeSetup | null
  heroStarts: {
    atk?: { q: number; r: number }
    def?: { q: number; r: number }
  }
}

function CombatHoverTip({
  left,
  top,
  placeBelow,
  children,
}: {
  left: number
  top: number
  placeBelow: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const parent = el?.offsetParent
    if (!el || !(parent instanceof HTMLElement)) {
      return
    }
    const pad = 8
    el.style.setProperty('--tip-shift-x', '0px')
    const tip = el.getBoundingClientRect()
    const bound = parent.getBoundingClientRect()
    let shift = 0
    if (tip.left < bound.left + pad) {
      shift = bound.left + pad - tip.left
    } else if (tip.right > bound.right - pad) {
      shift = bound.right - pad - tip.right
    }
    el.style.setProperty('--tip-shift-x', `${shift}px`)
  }, [left, top, placeBelow, children])
  return (
    <div
      ref={ref}
      className={
        placeBelow
          ? 'combat-stack-hover-tip is-below'
          : 'combat-stack-hover-tip'
      }
      style={{ left, top }}
      aria-hidden="true"
    >
      {children}
    </div>
  )
}

function HeroHexArt({
  hero,
  acted,
}: {
  hero: Hero | undefined
  acted: boolean
}) {
  const [missing, setMissing] = useState(false)
  const filename = hero?.image_path ?? null
  useEffect(() => {
    setMissing(false)
  }, [filename])
  return (
    <>
      {!filename || missing ? (
        <span className="town-building-slot-filename">{filename || 'Hero'}</span>
      ) : (
        <img
          src={heroPortraitUrl(filename)}
          alt=""
          onError={() => setMissing(true)}
        />
      )}
      <span
        className={
          acted ? 'combat-hero-status combat-hero-status-acted' : 'combat-hero-status combat-hero-status-ready'
        }
        aria-label={acted ? 'Has acted' : 'Has not acted'}
      >
        {acted ? '✕' : '✓'}
      </span>
    </>
  )
}

function CombatStackArt({ view }: { view: UnitStackView }) {
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    setMissing(false)
  }, [view.filename])
  if (view.filename && !missing) {
    return (
      <img
        src={unitPortraitUrl(view.filename)}
        alt=""
        onError={() => setMissing(true)}
      />
    )
  }
  return (
    <span className="town-building-slot-filename">{view.filename || 'Unknown'}</span>
  )
}

function TombstoneArt() {
  const [missing, setMissing] = useState(false)
  if (missing) {
    return <span className="town-building-slot-filename">{TOMBSTONE_ART}</span>
  }
  return (
    <img
      src={unitPortraitUrl(TOMBSTONE_ART)}
      alt=""
      onError={() => setMissing(true)}
    />
  )
}

function GroundEffectArt({
  filename,
  label,
}: {
  filename: string | null
  label: string
}) {
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    setMissing(false)
  }, [filename])
  if (filename && !missing) {
    return (
      <img
        className="combat-ground-effect-img"
        src={terrainArtUrl(filename)}
        alt=""
        onError={() => setMissing(true)}
      />
    )
  }
  return <span className="combat-ground-effect-fallback">{label}</span>
}

function hexByOffset(
  grid: { forEach: (fn: (hex: Hex) => void) => void },
): Map<string, Hex> {
  const byOffset = new Map<string, Hex>()
  grid.forEach((hex) => {
    byOffset.set(`${hex.col},${hex.row}`, hex)
  })
  return byOffset
}

function markersForColumn(
  byOffset: Map<string, Hex>,
  col: number,
  offsetX: number,
  offsetY: number,
  side: CombatSide,
): StackMarker[] {
  const markers: StackMarker[] = []
  for (let slot = 0; slot < ARMY_STACK_SLOTS; slot += 1) {
    // Army slot N → fixed offset row (every other row). Do not pack toward
    // the top when earlier army slots are empty.
    const row = armySlotRow(slot)
    const hex = byOffset.get(`${col},${row}`)
    if (!hex) {
      continue
    }
    const anchor = hexFloorAnchor(hex, offsetX, offsetY)
    markers.push({
      key: `${side}-${slot}`,
      side,
      slot,
      x: anchor.x,
      y: anchor.y,
      q: hex.q,
      r: hex.r,
    })
  }
  return markers
}

function anchorAt(anchors: HexAnchor[], q: number, r: number): HexAnchor | null {
  return anchors.find((row) => row.q === q && row.r === r) ?? null
}

/** Bottom of the screen first so higher tokens overlap lower ones and keep qty visible. */
function stacksBottomUp(stacks: CombatStack[], anchors: HexAnchor[]): CombatStack[] {
  return [...stacks].sort((a, b) => {
    const ya = anchorAt(anchors, a.q, a.r)?.y ?? 0
    const yb = anchorAt(anchors, b.q, b.r)?.y ?? 0
    if (yb !== ya) {
      return yb - ya
    }
    const xa = anchorAt(anchors, a.q, a.r)?.x ?? 0
    const xb = anchorAt(anchors, b.q, b.r)?.x ?? 0
    return xa - xb
  })
}

function stackArtBox(
  pos: { x: number; y: number },
  hexPx: number,
  size: number,
  side: CombatSide,
) {
  const cells = Math.max(1, size)
  const width = hexPx * cells
  const height = hexPx
  const left =
    side === 'def' ? pos.x + hexPx / 2 - width : pos.x - hexPx / 2
  return { width, height, left, top: pos.y - height }
}

function stackViewFromCombat(
  stack: CombatStack,
  catalog: ReturnType<typeof getCachedCatalog>,
  townName?: string,
): UnitStackView {
  const unit = unitById(catalog, stack.unitId)
  const siegeArt =
    townName && isWallSegmentUnit(unit)
      ? siegeSegmentArt(townName, unit?.name ?? 'Wall', stack.qty)
      : townName && isSiegeEngineUnit(unit)
        ? siegeEngineArt(townName)
        : null
  let filename = siegeArt || unit?.image_path?.trim() || null
  if (!siegeArt && catalog) {
    if (isPolymorphed(stack, catalog)) {
      filename = POLYMORPH_ART_FILENAME
    } else if (stack.silenced) {
      const alt = unit?.image_path_alt?.trim()
      if (alt) {
        filename = alt
      }
    }
  }
  return {
    empty: false,
    filename,
    qty: stack.qty,
  }
}

function isSiegeFixtureArt(unit: ReturnType<typeof unitById>): boolean {
  return isWallSegmentUnit(unit) || isSiegeEngineUnit(unit)
}

export function CombatScreen({
  attackerHeroId,
  defenderHeroId,
  siegeTownId,
  defenderMobId,
  debugSections,
  onExit,
}: CombatScreenProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const attacker = session.heroes.find((hero) => hero.id === attackerHeroId)
  const defender = defenderHeroId
    ? session.heroes.find((hero) => hero.id === defenderHeroId)
    : undefined
  const combatHeroes = { atk: attacker, def: defender }
  const siegeTown = siegeTownId
    ? session.towns.find((row) => row.id === siegeTownId)
    : undefined
  const siegeTownArtName =
    catalog && siegeTown
      ? townTypeName(catalog, siegeTown.town_type_id)
      : undefined
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const reachApiRef = useRef<{
    draw: (gold: string[], red?: string[]) => void
  } | null>(null)
  const auraApiRef = useRef<{ setKeys: (keys: string[]) => void } | null>(null)
  const bridgeArtApiRef = useRef<{ setOpen: (open: boolean) => void } | null>(
    null,
  )
  const activeApiRef = useRef<{ setKey: (key: string | null) => void } | null>(
    null,
  )
  const onHexClickRef = useRef<
    (q: number, r: number, zone: HexZone, shiftKey?: boolean) => void
  >(() => {})
  const onHoverRef = useRef<(hover: CombatHover | null) => void>(() => {})
  const battleRef = useRef<CombatBattle | null>(null)
  const catalogRef = useRef(catalog)
  const logRef = useRef<BattleLog | null>(null)
  const summaryRef = useRef<CombatSummary | null>(null)
  const movingRef = useRef(false)
  const walkGenRef = useRef(0)
  const fieldRef = useRef<FieldView | null>(null)
  const aiTurnLockedRef = useRef(false)
  const waypointPlanRef = useRef<WaypointPlan | null>(null)
  const presentAttackRef = useRef<
    (
      resolved: NonNullable<ReturnType<typeof resolveAttack>>,
      extraLines: string[],
      skipStandingHazards?: boolean,
    ) => void
  >(() => {})
  const presentTurnEndRef = useRef<
    (
      current: CombatBattle,
      stackId: string,
      extraLines: string[],
      alreadyActed?: boolean,
      advanceIfSilent?: boolean,
      wasteExtraTurn?: boolean,
      skipStandingHazards?: boolean,
    ) => void
  >(() => {})
  const finishHeroCastRef = useRef<
    (
      ability: AbilityRow,
      caster: Hero,
      casterSide: CombatSide,
      heroStackId: string,
      aim: {
        targetId: string | null
        hex: { q: number; r: number }
        lineDir?: { q: number; r: number } | null
      },
      holdUnitTurn?: boolean,
    ) => boolean
  >(() => false)
  const performCombatIntentRef = useRef<
    (intent: CombatHover, stack: CombatStack, current: CombatBattle) => boolean
  >(() => false)
  const tryAiHeroAbilityRef = useRef<() => boolean>(() => false)
  const dismissLogRef = useRef<() => void>(() => {})
  const queueBattleLogRef = useRef<(payload: BattleLog) => void>(() => {})
  const moatStartKeyRef = useRef<string | null>(null)
  const splitStartKeyRef = useRef<string | null>(null)
  const [field, setField] = useState<FieldView | null>(null)
  const [battle, setBattle] = useState<CombatBattle | null>(null)
  const [log, setLog] = useState<BattleLog | null>(null)
  const [catalogReady, setCatalogReady] = useState(false)
  const [moving, setMoving] = useState(false)
  const [hoverTarget, setHoverTarget] = useState<CombatHover | null>(null)
  const [hitFlash, setHitFlash] = useState<{
    n: number
    groups: Array<{ keys: string[]; color: HitFlashColor }>
  } | null>(null)
  const heroCastRef = useRef<HeroCast | null>(null)
  const combatHeroesRef = useRef(combatHeroes)
  const [heroCast, setHeroCast] = useState<HeroCast | null>(null)
  const [inspectStackId, setInspectStackId] = useState<string | null>(null)
  /** Living non-hero stack under the pointer (Expose / scout mouseover). */
  const [hoverInspectId, setHoverInspectId] = useState<string | null>(null)
  const onHoverInspectRef = useRef<(id: string | null) => void>(() => {})
  const [waypointPlan, setWaypointPlan] = useState<WaypointPlan | null>(null)
  const [opening, setOpening] = useState<OpeningStack[]>([])
  const [summary, setSummary] = useState<CombatSummary | null>(null)
  const pendingSummaryRef = useRef<CombatSummary | null>(null)
  const appliedRef = useRef(false)
  const openingRef = useRef<OpeningStack[]>([])
  battleRef.current = battle
  catalogRef.current = catalog
  logRef.current = log
  summaryRef.current = summary
  openingRef.current = opening
  movingRef.current = moving
  heroCastRef.current = heroCast
  combatHeroesRef.current = combatHeroes
  waypointPlanRef.current = waypointPlan
  // Keep live tiles (Void/Barricade stamps) available to the Pixi hover path —
  // that handler closes over the map-init array and must not use a stale copy.
  if (field) {
    fieldRef.current = field
  }
  {
    const acting = battle && !log && !moving && !summary ? activeStack(battle) : null
    const actingOwner = acting
      ? combatOwnerPlayer(
          acting,
          session,
          attacker,
          defender,
          siegeTown,
          defenderMobId,
        )
      : null
    aiTurnLockedRef.current = Boolean(actingOwner?.is_ai)
  }

  performCombatIntentRef.current = (intent, stack, current) => {
    if (!catalog || !field) {
      return false
    }
    const fire = intent.fire || intent.afterMove === 'pulse'
    const allowFriendly = intent.allowFriendly === true
    const prefix = intent.logPrefix ?? []
    const stand = actingStand({ q: stack.q, r: stack.r }, intent.steps)
    const aim = {
      targetId: intent.attackTargetId,
      hex:
        intent.afterMove === 'pulse'
          ? stand
          : (intent.aimHex ?? { q: intent.q, r: intent.r }),
      stand,
    }
    if (intent.steps.length === 0 && fire) {
      const resolved = resolveAttack(
        current,
        stack.id,
        catalog,
        aim,
        field.tiles,
        combatHeroes,
        Math.random,
        undefined,
        allowFriendly,
      )
      if (!resolved) {
        return false
      }
      setHoverTarget(null)
      presentAttackRef.current(resolved, prefix)
      return true
    }
    if (intent.steps.length === 0) {
      setHoverTarget(null)
      presentTurnEndRef.current(current, stack.id, [
        ...prefix,
        movementLogLine(stack, catalog, 0),
      ])
      return true
    }
    const gen = (walkGenRef.current += 1)
    setMoving(true)
    setHoverTarget(null)
    reachApiRef.current?.draw([])
    void (async () => {
      let latest = current
      const trapLines: string[] = []
      const hazardAcc = emptyWalkHazardAcc()
      const unitName = unitById(catalog, stack.unitId)?.name ?? 'Unknown'
      let stepsDone = 0
      {
        const walker = latest.stacks.find((row) => row.id === stack.id)
        if (walker) {
          // Void (no full_path): leave GE on vacated origin once per move.
          const left = tryLeaveGroundEffectOnMoveOrigin(
            latest,
            stack.id,
            catalog,
            { q: walker.q, r: walker.r },
            field.tiles,
          )
          latest = left.battle
          if (left.tiles && left.tiles !== field.tiles) {
            setField((prev) =>
              prev ? { ...prev, tiles: left.tiles! } : prev,
            )
            field.tiles.splice(0, field.tiles.length, ...left.tiles)
          }
        }
      }
      for (const step of intent.steps) {
        if (walkGenRef.current !== gen) {
          return
        }
        // Legacy terrain_type leave-behind (vacated hex before stepping away).
        {
          const walker = latest.stacks.find((row) => row.id === stack.id)
          if (walker) {
            const left = tryLeaveTerrainOnMove(
              latest,
              stack.id,
              catalog,
              field.tiles,
              { q: walker.q, r: walker.r },
            )
            latest = left.battle
            if (left.tiles !== field.tiles) {
              setField((prev) =>
                prev ? { ...prev, tiles: left.tiles } : prev,
              )
              field.tiles.splice(0, field.tiles.length, ...left.tiles)
            }
            trapLines.push(...left.lines)
          }
        }
        latest = moveStack(latest, stack.id, step.q, step.r)
        {
          // Worms/Riders (full_path): leave GE on each entered hex.
          const left = tryLeaveGroundEffectOnMoveStep(
            latest,
            stack.id,
            catalog,
            step,
            field.tiles,
          )
          latest = left.battle
          if (left.tiles && left.tiles !== field.tiles) {
            setField((prev) =>
              prev ? { ...prev, tiles: left.tiles! } : prev,
            )
            field.tiles.splice(0, field.tiles.length, ...left.tiles)
          }
        }
        stepsDone += 1
        const boom = tryTriggerGroundEffectsOnEnter(
          latest,
          stack.id,
          catalog,
          field.tiles,
          combatHeroesRef.current,
        )
        latest = boom.battle
        trapLines.push(...boom.lines)
        const hazard = applyStandingHazards(
          latest,
          stack.id,
          catalog,
          field.tiles,
          combatHeroesRef.current,
        )
        latest = hazard.battle
        absorbWalkHazard(hazardAcc, hazard)
        const flashKeys = [...boom.hitKeys, ...hazard.hitKeys]
        if (flashKeys.length > 0) {
          setHitFlash({
            n: Date.now(),
            groups: [{ keys: flashKeys, color: 'red' }],
          })
        }
        setBattle(latest)
        await sleep(MOVE_STEP_MS)
        // Mid-walk Stun (e.g. Explosive Trap): abort remaining move/attack.
        // This interrupted turn is the stun skip (consume like start-of-turn).
        const walker = latest.stacks.find((row) => row.id === stack.id)
        if (!walker || walker.qty <= 0) {
          if (walkGenRef.current !== gen) {
            return
          }
          setMoving(false)
          presentTurnEndRef.current(
            latest,
            stack.id,
            [
              ...prefix,
              ...trapLines,
              ...walkHazardLogLines(hazardAcc, unitName),
              movementLogLine(stack, catalog, stepsDone),
            ],
            false,
            false,
            false,
            true,
          )
          return
        }
        if (isStunned(walker, catalog)) {
          if (walkGenRef.current !== gen) {
            return
          }
          setMoving(false)
          const stunId = stunConditionId(catalog)
          const name = unitById(catalog, walker.unitId)?.name ?? 'Unknown'
          presentTurnEndRef.current(
            applyConsumedCondition(latest, stack.id, stunId),
            stack.id,
            [
              ...prefix,
              ...trapLines,
              ...walkHazardLogLines(hazardAcc, unitName),
              movementLogLine(stack, catalog, stepsDone),
              `${walker.qty} ${name} are stunned and can act no further.`,
            ],
            false,
            false,
            false,
            true,
          )
          return
        }
      }
      if (walkGenRef.current !== gen) {
        return
      }
      setMoving(false)
      const hazardLines = walkHazardLogLines(hazardAcc, unitName)
      // Tempest: Storm scatter only after an actual move (not in-place attacks).
      if (stepsDone > 0) {
        const scatter = tryTempestStormScatter(
          latest,
          stack.id,
          catalog,
          field.tiles,
          combatHeroes,
          Math.random,
        )
        latest = scatter.battle
        if (scatter.tiles && scatter.tiles !== field.tiles) {
          setField((prev) =>
            prev ? { ...prev, tiles: scatter.tiles! } : prev,
          )
          field.tiles.splice(0, field.tiles.length, ...scatter.tiles)
        }
        trapLines.push(...scatter.lines)
      }
      if (fire) {
        const resolved = resolveAttack(
          latest,
          stack.id,
          catalog,
          aim,
          field.tiles,
          combatHeroes,
          Math.random,
          {
            chargeHexes: stepsDone,
            chargePathOrigin: { q: stack.q, r: stack.r },
          },
          allowFriendly,
        )
        if (resolved) {
          presentAttackRef.current(
            resolved,
            [
              ...prefix,
              ...trapLines,
              ...hazardLines,
              movementLogLine(stack, catalog, stepsDone),
            ],
            true,
          )
        } else {
          presentTurnEndRef.current(
            latest,
            stack.id,
            [
              ...prefix,
              ...trapLines,
              ...hazardLines,
              movementLogLine(stack, catalog, stepsDone),
            ],
            false,
            false,
            false,
            true,
          )
        }
      } else {
        presentTurnEndRef.current(
          latest,
          stack.id,
          [
            ...prefix,
            ...trapLines,
            ...hazardLines,
            movementLogLine(stack, catalog, stepsDone),
          ],
          false,
          false,
          false,
          true,
        )
      }
    })()
    return true
  }

  onHexClickRef.current = (q, r, zone, shiftKey = false) => {
    if (log || moving || summary || !battle || !catalog || !field) {
      return
    }
    const acting = activeStack(battle)
    if (heroCast?.abilityId != null) {
      const ability = catalog.ability.find((row) => row.id === heroCast.abilityId)
      const heroStack = battle.stacks.find((row) => row.id === heroCast.stackId)
      const caster =
        heroStack?.side === 'def' ? defender : attacker
      if (!ability || !heroStack || !caster) {
        setHeroCast(null)
        return
      }
      const stats = ability.stats
      const selfTeleport = stats?.self_teleport === true
      const valid = new Set(
        abilityValidHexKeys(
          catalog,
          ability,
          heroStack.side,
          battle,
          field.tiles,
          heroCast.teleportUnitId,
        ),
      )
      if (!valid.has(hexKey(q, r))) {
        return
      }
      const occupant =
        stackOccupyingHex(battle.stacks, q, r, catalog) ??
        battle.stacks.find((row) => row.q === q && row.r === r) ??
        null
      // Shadow Step phase 1: pick friendly unit to teleport.
      if (selfTeleport && !heroCast.teleportUnitId) {
        if (
          !occupant ||
          isHeroStack(occupant) ||
          occupant.side !== heroStack.side ||
          occupant.qty <= 0
        ) {
          return
        }
        setHoverTarget(null)
        setHeroCast({
          ...heroCast,
          teleportUnitId: occupant.id,
        })
        return
      }
      finishHeroCastRef.current(ability, caster, heroStack.side, heroStack.id, {
        targetId: selfTeleport
          ? (heroCast.teleportUnitId ?? null)
          : occupant && !isHeroStack(occupant)
            ? occupant.id
            : null,
        hex: { q, r },
        lineDir:
          heroCast.lineDirIndex != null
            ? axialNeighborDirs()[heroCast.lineDirIndex % 6] ?? null
            : null,
      })
      return
    }
    if (heroCast) {
      return
    }
    if (inspectStackId) {
      return
    }
    const actingOwner = acting
      ? combatOwnerPlayer(acting, session, attacker, defender, siegeTown, defenderMobId)
      : null
    if (acting && actingOwner?.is_ai) {
      return
    }
    const occupant =
      stackOccupyingHex(battle.stacks, q, r, catalog) ??
      battle.stacks.find((row) => row.q === q && row.r === r) ??
      null
    if (
      occupant &&
      isHeroStack(occupant) &&
      acting &&
      occupant.side === acting.side
    ) {
      setHoverTarget(null)
      reachApiRef.current?.draw([])
      setWaypointPlan(null)
      setHeroCast({ stackId: occupant.id, abilityId: null })
      return
    }
    const stack = acting
    if (
      stack &&
      !stack.hasActedThisRound &&
      !stack.forcedRetreatPending &&
      !isFeared(stack, catalog) &&
      !isStunned(stack, catalog) &&
      !isConfused(stack, catalog) &&
      !isPolymorphed(stack, catalog)
    ) {
      const resolveLeg = (from: { q: number; r: number }, to: { q: number; r: number }, budget: number) => {
        const unit = unitById(catalog, stack.unitId)
        const kind = moveKindForUnit(unit, catalog)
        const tombs = tombstoneOccupancyBodies(battle.tombstones)
        // Blink: single teleport hop — only from the unit's current hex.
        if (unitAttackShape(unit).blinkMovement === true) {
          if (from.q !== stack.q || from.r !== stack.r) {
            return null
          }
          const reach = combatMovementReachable(
            stack,
            battle,
            field.tiles,
            catalog,
            deathKnightShadowMoveAdjust(
              battle,
              catalog,
              combatHeroes,
              stack.side,
              kind,
            ),
          )
          const steps = reach.get(hexKey(to.q, to.r))
          if (!steps || steps.length === 0) {
            return null
          }
          return { steps, remaining: 0 }
        }
        return resolveCombatWaypointLeg(
          from,
          to,
          budget,
          field.tiles,
          kind,
          occupiedForMover(battle.stacks, catalog, stack.id, kind),
          footprintSpecFor(stack, catalog),
          openBridgeMoatKeys(battle, catalog, field.tiles),
          stopOnlyForMover(battle, catalog, field.tiles, kind),
          landingOccupiedForMover(battle.stacks, catalog, stack.id, tombs),
          deathKnightShadowMoveAdjust(
            battle,
            catalog,
            combatHeroes,
            stack.side,
            kind,
          ),
          groundEffectMovementBlockKeys(battle),
        )
      }
      // Shift-click: stage a waypoint (no commit yet).
      if (shiftKey) {
        if (occupant && !isHeroStack(occupant)) {
          return
        }
        const fullBudget = unitIsStationary(unitById(catalog, stack.unitId))
          ? 0
          : (stackMoveSpeed(stack, catalog) ?? 0)
        const base =
          waypointPlan &&
          waypointPlan.origin.q === stack.q &&
          waypointPlan.origin.r === stack.r
            ? waypointPlan
            : createWaypointPlan({ q: stack.q, r: stack.r }, fullBudget)
        const next = tryAppendWaypoint(base, { q, r }, resolveLeg)
        if (!next) {
          return
        }
        setWaypointPlan(next)
        setHoverTarget({
          icon: 'move',
          q,
          r,
          steps: next.steps,
          attackTargetId: null,
          fire: false,
          afterMove: null,
          impactKeys: [],
          label: `WP ${next.waypoints.length} · ${formatMp(next.remaining)} left`,
        })
        reachApiRef.current?.draw(waypointStepKeys(next))
        return
      }
      // Normal click with staged waypoints: path through them, then to aim.
      if (waypointPlan && waypointPlan.waypoints.length > 0) {
        const virtual: CombatStack = {
          ...stack,
          q: waypointPlan.end.q,
          r: waypointPlan.end.r,
        }
        const intent = combatHover(
          virtual,
          { q, r },
          battle,
          field.tiles,
          catalog,
          zone,
          combatHeroes,
        )
        const act =
          intent != null &&
          (intent.fire ||
            intent.afterMove === 'pulse' ||
            intent.steps.length > 0 ||
            waypointPlan.steps.length > 0)
        if (act && intent) {
          setWaypointPlan(null)
          performCombatIntentRef.current(
            {
              ...intent,
              steps: [...waypointPlan.steps, ...intent.steps],
            },
            stack,
            battle,
          )
          return
        }
        setWaypointPlan(null)
      }
      const intent = combatHover(
        stack,
        { q, r },
        battle,
        field.tiles,
        catalog,
        zone,
        combatHeroes,
      )
      const act =
        intent != null &&
        (intent.fire ||
          intent.afterMove === 'pulse' ||
          intent.steps.length > 0)
      if (act && intent) {
        setWaypointPlan(null)
        performCombatIntentRef.current(intent, stack, battle)
        return
      }
    }
    if (occupant && !isHeroStack(occupant) && occupant.qty > 0) {
      setHoverTarget(null)
      reachApiRef.current?.draw([])
      setInspectStackId(occupant.id)
    }
  }

  const finishCombat = (current: CombatBattle) => {
    if (!catalog || !defeatedSide(current, catalog)) {
      return false
    }
    if (!appliedRef.current && catalog) {
      const result = commitCombatOutcome(
        catalog,
        attackerHeroId,
        defenderHeroId,
        current,
        openingRef.current,
        siegeTownId,
        defenderMobId,
      )
      if (result) {
        appliedRef.current = true
        pendingSummaryRef.current = result
      }
    }
    const pending = pendingSummaryRef.current
    if (!pending) {
      return false
    }
    setHoverTarget(null)
    setLog(null)
    const endSecs = combatEndTimerSeconds(catalogRef.current)
    if (endSecs === 0) {
      onExit(pending.levelUpNotice ?? null)
      return true
    }
    setSummary(pending)
    return true
  }

  const presentRoundAdvance = (advanced: CombatBattle) => {
    const groups = [
      {
        keys: advanced.roundHitKeys ?? [],
        color: 'red' as HitFlashColor,
      },
      {
        keys: advanced.roundHealKeys ?? [],
        color: 'green' as HitFlashColor,
      },
    ].filter((group) => group.keys.length > 0)
    if (groups.length > 0) {
      setHitFlash({ n: Date.now(), groups })
    }
    setBattle(advanced)
    if (advanced.roundLog && advanced.roundLog.length > 0) {
      queueBattleLogRef.current({ lines: advanced.roundLog, holdTurn: true })
      setBattle({
        ...advanced,
        roundLog: [],
        roundHitKeys: undefined,
        roundHealKeys: undefined,
      })
    }
  }

  const dismissLog = () => {
    const current = battleRef.current
    const currentLog = logRef.current
    if (!currentLog) {
      return
    }
    const cat = catalogRef.current
    if (!current || !cat) {
      setLog(null)
      return
    }
    if (finishCombat(current)) {
      return
    }
    const hold = currentLog.holdTurn === true
    setLog(null)
    if (!hold) {
      const advanced = advanceTurn(current, cat, Math.random, {
        tiles: fieldRef.current?.tiles,
        heroes: combatHeroesRef.current,
      })
      presentRoundAdvance(advanced)
    }
  }
  /** Show battle log, or skip entirely when combat_log_timer is 0. */
  const queueBattleLog = (payload: BattleLog) => {
    const skipPopup =
      payload.lines.length === 0 ||
      combatLogTimerSeconds(catalogRef.current) === 0
    if (skipPopup) {
      if (payload.lines.length === 0 && payload.holdTurn === true) {
        return
      }
      // Apply dismiss side-effects without painting the popup.
      const current = battleRef.current
      const cat = catalogRef.current
      if (!current || !cat) {
        return
      }
      if (finishCombat(current)) {
        return
      }
      if (payload.holdTurn !== true) {
        const advanced = advanceTurn(current, cat, Math.random, {
          tiles: fieldRef.current?.tiles,
          heroes: combatHeroesRef.current,
        })
        presentRoundAdvance(advanced)
      }
      return
    }
    setLog(payload)
  }
  queueBattleLogRef.current = queueBattleLog
  dismissLogRef.current = dismissLog

  const applyOutcomeIfOver = (current: CombatBattle) => {
    if (appliedRef.current || !catalog || !defeatedSide(current, catalog)) {
      return
    }
    const result = commitCombatOutcome(
      catalog,
      attackerHeroId,
      defenderHeroId,
      current,
      openingRef.current,
      siegeTownId,
      defenderMobId,
    )
    if (!result) {
      return
    }
    appliedRef.current = true
    pendingSummaryRef.current = result
  }

  const finishHeroCast = (
    ability: AbilityRow,
    caster: Hero,
    casterSide: CombatSide,
    heroStackId: string,
    aim: {
      targetId: string | null
      hex: { q: number; r: number }
      lineDir?: { q: number; r: number } | null
    },
    holdUnitTurn = false,
  ): boolean => {
    if (!battle || !catalog || !field) {
      return false
    }
    const heroRow = battle.stacks.find((row) => row.id === heroStackId)
    if (heroRow?.hasActedThisRound) {
      setHeroCast(null)
      return false
    }
    if (!abilityMeetsCastGate(catalog, ability, battle, casterSide)) {
      setHeroCast(null)
      return false
    }
    const liveCaster =
      getSession().heroes.find((row) => row.id === caster.id) ?? caster
    if (
      !canAffordAbility(liveCaster, ability) ||
      !abilityCooldownReady(liveCaster, ability)
    ) {
      setHeroCast(null)
      return false
    }
    const resolved = resolveAbility(
      battle,
      catalog,
      field.tiles,
      ability,
      caster,
      casterSide,
      aim,
      combatHeroes,
    )
    setHoverTarget(null)
    setHeroCast(null)
    reachApiRef.current?.draw([])
    if (!resolved) {
      queueBattleLog({
        lines: [`${ability.name} is not designed yet.`],
        holdTurn: true,
      })
      return false
    }
    if (resolved.noOp === true) {
      // Utility no-ops should not spend resources/cooldowns nor count as a
      // successful cast — return false so AI can proceed to the unit action
      // instead of retrying the same empty clear forever.
      setLog(null)
      setBattle(resolved.battle)
      applyOutcomeIfOver(resolved.battle)
      return false
    }
    updateSession((current) => {
      const withArmy = resolved.applySession
        ? resolved.applySession(current)
        : current
      return {
        ...withArmy,
        heroes: withArmy.heroes.map((row) =>
          row.id === caster.id
            ? recordAbilityCast(deductAbilityCost(row, ability), ability.id)
            : row,
        ),
      }
    })
    if (
      resolved.moveDelayMs != null &&
      resolved.moveDelayMs > 0 &&
      resolved.preMoveBattle
    ) {
      const gen = (walkGenRef.current += 1)
      setMoving(true)
      const moverId = aim.targetId
      // Pop out: remove from board, wait, then land at destination.
      const hidden = {
        ...resolved.preMoveBattle,
        stacks: resolved.preMoveBattle.stacks.filter((row) => row.id !== moverId),
      }
      setBattle(hidden)
      if (resolved.flashes.length > 0) {
        setHitFlash({ n: Date.now(), groups: resolved.flashes })
      }
      void (async () => {
        await sleep(resolved.moveDelayMs ?? 500)
        if (walkGenRef.current !== gen) {
          return
        }
        setMoving(false)
        const next = resolved.endsRound
          ? resolved.battle
          : markHeroActed(resolved.battle, heroStackId)
        setBattle(next)
        applyOutcomeIfOver(next)
        queueBattleLog(holdUnitTurn ? { ...resolved.log, holdTurn: true } : resolved.log)
      })()
      return true
    }
    const beats = resolved.beats
    if (beats && beats.length > 0) {
      const gen = (walkGenRef.current += 1)
      setMoving(true)
      void (async () => {
        for (const beat of beats) {
          if (walkGenRef.current !== gen) {
            return
          }
          setBattle(beat.battle)
          if (beat.flashes.length > 0) {
            setHitFlash({ n: Date.now(), groups: beat.flashes })
          }
          if (beat.lines.length > 0) {
            queueBattleLog({ lines: beat.lines, holdTurn: true })
          }
          await sleep(ABILITY_BEAT_MS)
        }
        if (walkGenRef.current !== gen) {
          return
        }
        setMoving(false)
        const next = resolved.endsRound
          ? resolved.battle
          : markHeroActed(resolved.battle, heroStackId)
        setBattle(next)
        applyOutcomeIfOver(next)
        queueBattleLog(holdUnitTurn ? { ...resolved.log, holdTurn: true } : resolved.log)
      })()
      return true
    }
    const next = resolved.endsRound
      ? resolved.battle
      : markHeroActed(resolved.battle, heroStackId)
    setBattle(next)
    if (resolved.tiles) {
      setField((prev) =>
        prev ? { ...prev, tiles: resolved.tiles! } : prev,
      )
      field.tiles.splice(0, field.tiles.length, ...resolved.tiles)
    }
    applyOutcomeIfOver(next)
    if (resolved.flashes.length > 0) {
      setHitFlash({ n: Date.now(), groups: resolved.flashes })
    }
    queueBattleLog(holdUnitTurn ? { ...resolved.log, holdTurn: true } : resolved.log)
    return true
  }
  finishHeroCastRef.current = finishHeroCast

  tryAiHeroAbilityRef.current = () => {
    if (!battle || !catalog || !field) {
      return false
    }
    const acting = activeStack(battle)
    if (!acting) {
      return false
    }
    const owner = combatOwnerPlayer(
      acting,
      session,
      attacker,
      defender,
      siegeTown,
      defenderMobId,
    )
    if (!owner?.is_ai) {
      return false
    }
    const heroStack = battle.stacks.find(
      (row) =>
        isHeroStack(row) &&
        row.side === acting.side &&
        !row.hasActedThisRound,
    )
    if (!heroStack?.heroId) {
      return false
    }
    const caster =
      getSession().heroes.find((row) => row.id === heroStack.heroId) ??
      (heroStack.side === 'atk' ? attacker : defender)
    if (!caster) {
      return false
    }
    const pick = decideHeroAbility(
      caster,
      heroStack,
      battle,
      field.tiles,
      catalog,
      owner,
      combatHeroes,
    )
    if (!pick) {
      return false
    }
    return finishHeroCastRef.current(
      pick.ability,
      caster,
      heroStack.side,
      heroStack.id,
      pick.aim,
      acting.id !== heroStack.id,
    )
  }

  presentTurnEndRef.current = (
    current,
    stackId,
    extraLines,
    alreadyActed = false,
    advanceIfSilent = false,
    wasteExtraTurn = false,
    skipStandingHazards = false,
  ) => {
    const cat = catalogRef.current
    const tiles = field?.tiles ?? []
    if (!cat) {
      return
    }
    const tick = skipStandingHazards
      ? {
          battle: current,
          lines: [] as string[],
          hitKeys: [] as string[],
        }
      : applyStandingHazards(current, stackId, cat, tiles, combatHeroesRef.current)
    const ended = alreadyActed
      ? tick.battle
      : endStackTurn(tick.battle, stackId, wasteExtraTurn)
    const silenced = applyOwnSilenceAfterTurn(ended, stackId, cat)
    let next = silenced.battle
    const actor = next.stacks.find((row) => row.id === stackId) ?? null
    const fervorLines: string[] = []
    if (!wasteExtraTurn && actor && actor.qty > 0) {
      const fervor = tryFervorChain(actor)
      if (fervor.chancePct > 0) {
        fervorLines.push(
          chanceRollLog('Fervor', fervor.chancePct, fervor.triggered, {
            action: 'to act again',
          }),
        )
        if (fervor.triggered) {
          next = grantFervorExtraTurn(next, stackId)
        } else if (actor.fervor) {
          next = clearFervorStreak(next, stackId)
        }
      } else if (actor.fervor) {
        next = clearFervorStreak(next, stackId)
      }
    } else if (actor?.fervor) {
      next = clearFervorStreak(next, stackId)
    }
    if (tick.hitKeys.length > 0) {
      setHitFlash({
        n: Date.now(),
        groups: [{ keys: tick.hitKeys, color: 'red' }],
      })
    }
    const lines = [
      ...extraLines,
      ...tick.lines,
      ...(silenced.line ? [silenced.line] : []),
      ...fervorLines,
    ]
    setBattle(next)
    applyOutcomeIfOver(next)
    if (lines.length > 0) {
      queueBattleLog({
        lines,
        holdTurn: fervorLines.length > 0,
      })
      return
    }
    if (advanceIfSilent) {
      const advanced = advanceTurn(next, cat, Math.random, {
        tiles: fieldRef.current?.tiles,
        heroes: combatHeroesRef.current,
      })
      applyOutcomeIfOver(advanced)
      presentRoundAdvance(advanced)
    }
  }

  presentAttackRef.current = (resolved, extraLines, skipStandingHazards = false) => {
    const cat = catalogRef.current
    const tiles = field?.tiles ?? []
    if (resolved.heroes) {
      const nextAtk = resolved.heroes.atk
      const nextDef = resolved.heroes.def
      updateSession((current) => ({
        ...current,
        heroes: current.heroes.map((hero) => {
          if (nextAtk && hero.id === nextAtk.id) {
            return nextAtk
          }
          if (nextDef && hero.id === nextDef.id) {
            return nextDef
          }
          return hero
        }),
      }))
    }
    const actor = activeStack(resolved.battle)
    const tick =
      cat && actor && !skipStandingHazards
        ? applyStandingHazards(
            resolved.battle,
            actor.id,
            cat,
            tiles,
            combatHeroesRef.current,
          )
        : { battle: resolved.battle, lines: [] as string[], hitKeys: [] as string[] }
    const ended = actor
      ? endStackTurn(tick.battle, actor.id)
      : tick.battle
    const silenced =
      cat && actor
        ? applyOwnSilenceAfterTurn(ended, actor.id, cat)
        : { battle: ended, line: null as string | null }
    let next = silenced.battle
    const liveActor = actor
      ? next.stacks.find((row) => row.id === actor.id) ?? null
      : null
    const fervorLines: string[] = []
    if (resolved.grantExtraTurn && liveActor && liveActor.qty > 0) {
      next = grantFervorExtraTurn(next, liveActor.id)
      // Log line already added in resolveAttack (Inquisitor Grand).
    } else if (cat && liveActor && liveActor.qty > 0) {
      const fervor = tryFervorChain(liveActor)
      if (fervor.chancePct > 0) {
        fervorLines.push(
          chanceRollLog('Fervor', fervor.chancePct, fervor.triggered, {
            action: 'to act again',
          }),
        )
        if (fervor.triggered) {
          next = grantFervorExtraTurn(next, liveActor.id)
        } else if (liveActor.fervor) {
          next = clearFervorStreak(next, liveActor.id)
        }
      } else if (liveActor.fervor) {
        next = clearFervorStreak(next, liveActor.id)
      }
    } else if (liveActor?.fervor) {
      next = clearFervorStreak(next, liveActor.id)
    }
    const groups = [
      { keys: resolved.hitKeys, color: resolved.hitColor },
      { keys: resolved.healKeys, color: 'green' as HitFlashColor },
      { keys: tick.hitKeys, color: 'red' as HitFlashColor },
    ].filter((group) => group.keys.length > 0)
    if (groups.length > 0) {
      setHitFlash({ n: Date.now(), groups })
    }
    const lines = [
      ...extraLines,
      ...resolved.log.lines,
      ...tick.lines,
      ...(silenced.line ? [silenced.line] : []),
      ...fervorLines,
    ]
    setBattle(next)
    applyOutcomeIfOver(next)
    if (lines.length > 0) {
      queueBattleLog({
        lines,
        holdTurn: fervorLines.length > 0 || resolved.grantExtraTurn === true,
      })
      return
    }
    if (cat) {
      const advanced = advanceTurn(next, cat, Math.random, {
        tiles: fieldRef.current?.tiles,
        heroes: combatHeroesRef.current,
      })
      presentRoundAdvance(advanced)
    }
  }

  useEffect(() => {
    if (battle) {
      applyOutcomeIfOver(battle)
    }
  }, [battle, catalog, attackerHeroId, defenderHeroId])

  onHoverRef.current = (hover) => {
    setHoverTarget(hover)
  }
  onHoverInspectRef.current = (id) => {
    setHoverInspectId(id)
  }

  useEffect(() => {
    void fetchCatalog()
      .catch(() => {})
      .finally(() => setCatalogReady(true))
  }, [])

  useEffect(() => {
    if (log || summary || (heroCast && heroCast.abilityId == null)) {
      reachApiRef.current?.draw([])
    }
  }, [log, summary, heroCast])

  useEffect(() => {
    if (!aiTurnLockedRef.current) {
      return
    }
    setHoverTarget(null)
    setHoverInspectId(null)
    reachApiRef.current?.draw([])
  }, [battle, log, moving, summary])

  useEffect(() => {
    if (!log || summary) {
      return
    }
    const secs = combatLogTimerSeconds(catalog)
    if (secs === 0) {
      dismissLogRef.current()
      return
    }
    if (secs >= POPUP_NO_AUTO_SECS) {
      return
    }
    const timer = window.setTimeout(() => {
      dismissLogRef.current()
    }, secs * 1000)
    return () => window.clearTimeout(timer)
  }, [log, summary, catalog])

  useEffect(() => {
    if (!summary) {
      return
    }
    const secs = combatEndTimerSeconds(catalog)
    if (secs === 0) {
      onExit(summary.levelUpNotice ?? null)
      return
    }
    if (secs >= POPUP_NO_AUTO_SECS) {
      return
    }
    const timer = window.setTimeout(() => {
      onExit(summary.levelUpNotice ?? null)
    }, secs * 1000)
    return () => window.clearTimeout(timer)
  }, [summary, catalog, onExit])

  // Space / Esc: dismiss post-turn log or post-combat summary immediately.
  useEffect(() => {
    if (!log && !summary) {
      return
    }
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' &&
        event.key !== ' ' &&
        event.code !== 'Space'
      ) {
        return
      }
      if (event.repeat) {
        return
      }
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      if (summary) {
        onExit(summary.levelUpNotice ?? null)
        return
      }
      dismissLogRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [log, summary, onExit])

  useEffect(() => {
    if (!battle || !catalog || !field) {
      bridgeArtApiRef.current?.setOpen(false)
      return
    }
    bridgeArtApiRef.current?.setOpen(
      isDrawbridgeOpen(
        battle.stacks,
        catalog,
        field.tiles,
        battle.siegeGate,
      ),
    )
  }, [battle, catalog, field])

  useEffect(() => {
    const stack =
      battle && !log && !moving && !summary ? activeStack(battle) : null
    const show = stack && !stack.hasActedThisRound
    activeApiRef.current?.setKey(
      show ? hexKey(stack.q, stack.r) : null,
    )
  }, [battle, log, moving])

  // Divine Aura Master: light-blue radius disk while the unit is acting.
  useEffect(() => {
    if (!battle || !catalog || !field || log || moving || summary) {
      auraApiRef.current?.setKeys([])
      return
    }
    const stack = activeStack(battle)
    if (!stack || stack.hasActedThisRound || isHeroStack(stack)) {
      auraApiRef.current?.setKeys([])
      return
    }
    const abilities = unitAttackShape(unitById(catalog, stack.unitId))
    const radius = abilities.auraRadius
    if (
      !abilities.auraCountsAlliesAsExtraQty ||
      radius == null ||
      radius < 1
    ) {
      auraApiRef.current?.setKeys([])
      return
    }
    auraApiRef.current?.setKeys(
      auraRadiusHexKeys({ q: stack.q, r: stack.r }, radius, field.tiles),
    )
  }, [battle, catalog, field, log, moving, summary])

  useEffect(() => {
    return () => {
      walkGenRef.current += 1
    }
  }, [attackerHeroId, defenderHeroId])

  useEffect(() => {
    if (!field || !catalog || !catalogReady) {
      return
    }
    const prev = fieldRef.current
    // Mid-combat tile patches (Barricade stamps, Void leave-behind, clears)
    // replace `field` with a new object but keep the same markers/siege/starts.
    // Remounting createBattle here looked like Forced Retreat: everyone snaps
    // back to opening hexes and the just-placed ground effect is discarded.
    if (
      prev &&
      prev.markers === field.markers &&
      prev.siege === field.siege &&
      prev.heroStarts === field.heroStarts
    ) {
      fieldRef.current = field
      return
    }
    fieldRef.current = field
    const session = getSession()
    let created = createBattle(
      session,
      catalog,
      attackerHeroId,
      defenderHeroId,
      field.markers,
      Math.random,
      field.siege,
      field.heroStarts,
      defenderMobId,
    )
    const attacker = session.heroes.find((hero) => hero.id === attackerHeroId)
    const defender = defenderHeroId
      ? session.heroes.find((hero) => hero.id === defenderHeroId)
      : undefined
    const totems = applyShamanBattleStartTotems(
      created,
      catalog,
      field.tiles,
      { atk: attacker, def: defender },
      Math.random,
    )
    created = totems.battle
    const snap = snapshotOpening(created.stacks)
    updateSession((current) => ({
      ...current,
      heroes: current.heroes.map((hero) => ({
        ...hero,
        used_abilities_this_battle: [],
      })),
    }))
    setBattle(created)
    setOpening(snap)
    openingRef.current = snap
    if (totems.lines.length > 0) {
      queueBattleLog({ lines: totems.lines })
    } else {
      setLog(null)
    }
    setSummary(null)
    appliedRef.current = false
    pendingSummaryRef.current = null
    moatStartKeyRef.current = null
    splitStartKeyRef.current = null
  }, [field, catalog, catalogReady, attackerHeroId, defenderHeroId, siegeTownId, defenderMobId])

  useEffect(() => {
    if (!hitFlash) {
      return
    }
    const timer = window.setTimeout(() => setHitFlash(null), HIT_FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [hitFlash])

  useEffect(() => {
    if (!battle) {
      setWaypointPlan(null)
      return
    }
    const acting = activeStack(battle)
    const plan = waypointPlanRef.current
    if (
      !acting ||
      (plan &&
        (plan.origin.q !== acting.q ||
          plan.origin.r !== acting.r ||
          acting.hasActedThisRound))
    ) {
      setWaypointPlan(null)
    }
  }, [battle])

  useEffect(() => {
    if (!waypointPlan) {
      return
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      setWaypointPlan(null)
      setHoverTarget(null)
      reachApiRef.current?.draw([])
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [waypointPlan])

  // Space: Pass the active unit's turn (same as clicking its own hex).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.code !== 'Space') {
        return
      }
      if (event.repeat) {
        return
      }
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      if (
        !battle ||
        !catalog ||
        log ||
        moving ||
        summary ||
        heroCast ||
        inspectStackId
      ) {
        return
      }
      if (aiTurnLockedRef.current) {
        return
      }
      const stack = activeStack(battle)
      if (!stack || stack.hasActedThisRound || isHeroStack(stack)) {
        return
      }
      if (
        stack.forcedRetreatPending ||
        isFeared(stack, catalog) ||
        isStunned(stack, catalog) ||
        isConfused(stack, catalog) ||
        isPolymorphed(stack, catalog)
      ) {
        return
      }
      const owner = combatOwnerPlayer(
        stack,
        getSession(),
        attacker,
        defender,
        siegeTown,
        defenderMobId,
      )
      if (!owner || owner.is_ai) {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      setWaypointPlan(null)
      setHoverTarget(null)
      reachApiRef.current?.draw([])
      presentTurnEndRef.current(battle, stack.id, [
        movementLogLine(stack, catalog, 0),
      ])
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [
    battle,
    catalog,
    log,
    moving,
    summary,
    heroCast,
    inspectStackId,
    attacker,
    defender,
    siegeTown,
    defenderMobId,
  ])

  useEffect(() => {
    if (!heroCast && !inspectStackId) {
      return
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'r' || event.key === 'R') {
        if (heroCast?.abilityId != null && heroCast.lineDirIndex != null) {
          event.preventDefault()
          event.stopPropagation()
          event.stopImmediatePropagation()
          setHeroCast({
            ...heroCast,
            lineDirIndex: (heroCast.lineDirIndex + 1) % 6,
          })
          return
        }
      }
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      if (heroCast?.abilityId != null) {
        setHoverTarget(null)
        setHeroCast({ stackId: heroCast.stackId, abilityId: null })
        return
      }
      if (heroCast) {
        setHoverTarget(null)
        setHeroCast(null)
        reachApiRef.current?.draw([])
        return
      }
      setInspectStackId(null)
    }
    const onWheel = (event: WheelEvent) => {
      if (heroCast?.abilityId == null || heroCast.lineDirIndex == null) {
        return
      }
      event.preventDefault()
      const delta = event.deltaY === 0 ? event.deltaX : event.deltaY
      if (delta === 0) {
        return
      }
      const step = delta > 0 ? 1 : 5
      setHeroCast({
        ...heroCast,
        lineDirIndex: (heroCast.lineDirIndex + step) % 6,
      })
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('wheel', onWheel, true)
    }
  }, [heroCast, inspectStackId])

  // Refresh Barricade preview when orientation changes without moving the mouse.
  useEffect(() => {
    if (
      !battle ||
      !catalog ||
      !field ||
      !heroCast ||
      heroCast.abilityId == null ||
      heroCast.lineDirIndex == null ||
      !hoverTarget
    ) {
      return
    }
    const ability = catalog.ability.find((row) => row.id === heroCast.abilityId)
    const heroStack = battle.stacks.find((row) => row.id === heroCast.stackId)
    if (!ability || !heroStack || !abilityUsesLinePlacementPreview(ability)) {
      return
    }
    const caster = heroForSide(heroStack.side, combatHeroes)
    const lineDir = axialNeighborDirs()[heroCast.lineDirIndex % 6] ?? null
    const impact = abilityAimImpactKeys(
      catalog,
      ability,
      heroStack.side,
      battle,
      field.tiles,
      { q: hoverTarget.q, r: hoverTarget.r },
      caster,
      lineDir,
    )
    reachApiRef.current?.draw([], impact)
  }, [
    battle,
    catalog,
    field,
    heroCast,
    hoverTarget,
    combatHeroes,
  ])

  useEffect(() => {
    if (!inspectStackId || !battle) {
      return
    }
    const live = battle.stacks.find((row) => row.id === inspectStackId)
    if (!live || live.qty <= 0) {
      setInspectStackId(null)
    }
  }, [battle, inspectStackId])

  useEffect(() => {
    if (!battle || !catalog || !heroCast || heroCast.abilityId == null) {
      return
    }
    const ability = catalog.ability.find((row) => row.id === heroCast.abilityId)
    const heroStack = battle.stacks.find((row) => row.id === heroCast.stackId)
    if (!ability || !heroStack) {
      return
    }
    // AOE / trap: every (valid) hex is clickable, but painting that set red
    // flashes the whole field until hover supplies the real radius.
    if (
      parseTarget(catalog, ability).spread === 'aoe' ||
      abilityUsesLocalizedEmptyHexAim(ability)
    ) {
      reachApiRef.current?.draw([])
      return
    }
    reachApiRef.current?.draw(
      [],
      abilityValidHexKeys(
        catalog,
        ability,
        heroStack.side,
        battle,
        field?.tiles,
        heroCast.teleportUnitId,
      ),
    )
  }, [battle, catalog, field?.tiles, heroCast])

  useEffect(() => {
    if (!battle || !catalog || !field || log || moving || summary) {
      return
    }
    if (defeatedSide(battle, catalog)) {
      return
    }
    const stack = activeStack(battle)
    if (!stack || stack.hasActedThisRound) {
      return
    }
    const key = `${battle.round}:${stack.id}`
    if (
      moatStartKeyRef.current === key ||
      battle.moatStartKey === key
    ) {
      return
    }
    moatStartKeyRef.current = key
    const tick = applyStandingHazards(
      battle,
      stack.id,
      catalog,
      field.tiles,
      combatHeroesRef.current,
    )
    const growth = applyTerrainGrowth(
      tick.battle,
      stack.id,
      catalog,
      field.tiles,
    )
    const lines = [...tick.lines, ...growth.lines]
    if (lines.length === 0) {
      return
    }
    if (tick.hitKeys.length > 0) {
      setHitFlash({
        n: Date.now(),
        groups: [{ keys: tick.hitKeys, color: 'red' }],
      })
    }
    const next = { ...growth.battle, moatStartKey: key }
    setBattle(next)
    applyOutcomeIfOver(next)
    const still = growth.battle.stacks.find((row) => row.id === stack.id)
    queueBattleLog({
      lines,
      holdTurn: still != null && still.qty > 0,
    })
  }, [battle, catalog, field, log, moving, summary])

  useEffect(() => {
    if (!battle || !catalog || !field || log || moving || summary) {
      return
    }
    if (defeatedSide(battle, catalog)) {
      return
    }
    const stack = activeStack(battle)
    if (!stack || stack.hasActedThisRound) {
      return
    }
    const key = `${battle.round}:${stack.id}`
    if (splitStartKeyRef.current === key) {
      return
    }
    splitStartKeyRef.current = key
    const split = tryAutoSplitOnTurn(battle, catalog, field.tiles, stack.id)
    if (!split) {
      return
    }
    setBattle(split.battle)
    if (split.lines.length > 0) {
      queueBattleLog({ lines: split.lines, holdTurn: true })
    }
  }, [battle, catalog, field, log, moving, summary])

  useEffect(() => {
    if (!battle || !catalog || !field || log || moving || summary || heroCast || inspectStackId) {
      return
    }
    if (defeatedSide(battle, catalog)) {
      return
    }
    const stack = activeStack(battle)
    if (!stack || stack.hasActedThisRound) {
      return
    }
    const unit = unitById(catalog, stack.unitId)
    const speed = stackCombatSpeed(stack, catalog) ?? 0
    const canMove =
      !unitIsStationary(unit) &&
      speed > 0 &&
      canCombatStep(
        stack,
        battle,
        field.tiles,
        catalog,
        deathKnightShadowMoveAdjust(
          battle,
          catalog,
          combatHeroes,
          stack.side,
          moveKindForUnit(unitById(catalog, stack.unitId), catalog),
        ),
      )
    const playerActs =
      unitTakesTurns(unit) &&
      !unitAutoTarget(unit) &&
      !stack.forcedRetreatPending &&
      !isFeared(stack, catalog) &&
      !isStunned(stack, catalog) &&
      !isConfused(stack, catalog) &&
      !isPolymorphed(stack, catalog) &&
      (canMove || canStrikeThisTurn(stack, battle, field.tiles, catalog, combatHeroes))
    if (playerActs) {
      return
    }
    const timer = window.setTimeout(() => {
      if (tryAiHeroAbilityRef.current()) {
        return
      }
      if (stack.forcedRetreatPending) {
        const name = unit?.name ?? 'Unknown'
        const cleared: CombatBattle = {
          ...battle,
          stacks: battle.stacks.map((row) =>
            row.id === stack.id
              ? { ...row, forcedRetreatPending: undefined }
              : row,
          ),
        }
        const steps = pickRetreatSteps(stack, cleared, catalog, field.tiles)
        if (steps.length === 0) {
          presentTurnEndRef.current(
            cleared,
            stack.id,
            [`${stack.qty} ${name} cannot retreat farther.`],
            false,
            true,
            true,
          )
          return
        }
        const gen = (walkGenRef.current += 1)
        setMoving(true)
        void (async () => {
          let latest = cleared
          const trapLines: string[] = []
          const hazardAcc = emptyWalkHazardAcc()
          let stepsDone = 0
          {
            const walker = latest.stacks.find((row) => row.id === stack.id)
            if (walker) {
              const left = tryLeaveGroundEffectOnMoveOrigin(
                latest,
                stack.id,
                catalog,
                { q: walker.q, r: walker.r },
                field.tiles,
              )
              latest = left.battle
              if (left.tiles && left.tiles !== field.tiles) {
                setField((prev) =>
                  prev ? { ...prev, tiles: left.tiles! } : prev,
                )
                field.tiles.splice(0, field.tiles.length, ...left.tiles)
              }
            }
          }
          for (const step of steps) {
            if (walkGenRef.current !== gen) {
              return
            }
            {
              const walker = latest.stacks.find((row) => row.id === stack.id)
              if (walker) {
                const left = tryLeaveTerrainOnMove(
                  latest,
                  stack.id,
                  catalog,
                  field.tiles,
                  { q: walker.q, r: walker.r },
                )
                latest = left.battle
                if (left.tiles !== field.tiles) {
                  setField((prev) =>
                    prev ? { ...prev, tiles: left.tiles } : prev,
                  )
                  field.tiles.splice(0, field.tiles.length, ...left.tiles)
                }
                trapLines.push(...left.lines)
              }
            }
            latest = moveStack(latest, stack.id, step.q, step.r)
            {
              const left = tryLeaveGroundEffectOnMoveStep(
                latest,
                stack.id,
                catalog,
                step,
                field.tiles,
              )
              latest = left.battle
              if (left.tiles && left.tiles !== field.tiles) {
                setField((prev) =>
                  prev ? { ...prev, tiles: left.tiles! } : prev,
                )
                field.tiles.splice(0, field.tiles.length, ...left.tiles)
              }
            }
            stepsDone += 1
            const boom = tryTriggerGroundEffectsOnEnter(
              latest,
              stack.id,
              catalog,
              field.tiles,
              combatHeroesRef.current,
            )
            latest = boom.battle
            trapLines.push(...boom.lines)
            const hazard = applyStandingHazards(
              latest,
              stack.id,
              catalog,
              field.tiles,
              combatHeroesRef.current,
            )
            latest = hazard.battle
            absorbWalkHazard(hazardAcc, hazard)
            const flashKeys = [...boom.hitKeys, ...hazard.hitKeys]
            if (flashKeys.length > 0) {
              setHitFlash({
                n: Date.now(),
                groups: [{ keys: flashKeys, color: 'red' }],
              })
            }
            setBattle(latest)
            await sleep(MOVE_STEP_MS)
            const walker = latest.stacks.find((row) => row.id === stack.id)
            if (!walker || walker.qty <= 0) {
              if (walkGenRef.current !== gen) {
                return
              }
              setMoving(false)
              presentTurnEndRef.current(
                latest,
                stack.id,
                [
                  `${stack.qty} ${name} are forced to retreat.`,
                  ...trapLines,
                  ...walkHazardLogLines(hazardAcc, name),
                  movementLogLine(stack, catalog, stepsDone),
                ],
                false,
                false,
                true,
                true,
              )
              return
            }
            if (isStunned(walker, catalog)) {
              if (walkGenRef.current !== gen) {
                return
              }
              setMoving(false)
              const stunId = stunConditionId(catalog)
              presentTurnEndRef.current(
                applyConsumedCondition(latest, stack.id, stunId),
                stack.id,
                [
                  `${stack.qty} ${name} are forced to retreat.`,
                  ...trapLines,
                  ...walkHazardLogLines(hazardAcc, name),
                  movementLogLine(stack, catalog, stepsDone),
                  `${walker.qty} ${name} are stunned and can act no further.`,
                ],
                false,
                false,
                true,
                true,
              )
              return
            }
          }
          if (walkGenRef.current !== gen) {
            return
          }
          setMoving(false)
          presentTurnEndRef.current(
            latest,
            stack.id,
            [
              `${stack.qty} ${name} are forced to retreat.`,
              ...trapLines,
              ...walkHazardLogLines(hazardAcc, name),
              movementLogLine(stack, catalog, stepsDone),
            ],
            false,
            false,
            true,
            true,
          )
        })()
        return
      }
      if (isPolymorphed(stack, catalog)) {
        const name = unit?.name ?? 'Unknown'
        const label = polymorphConditionName(catalog)
        presentTurnEndRef.current(
          battle,
          stack.id,
          [`${stack.qty} ${name} skip this turn (${label}).`],
          false,
          false,
          true,
        )
        return
      }
      if (isStunned(stack, catalog)) {
        const name = unit?.name ?? 'Unknown'
        const stunId = stunConditionId(catalog)
        presentTurnEndRef.current(
          applyConsumedCondition(battle, stack.id, stunId),
          stack.id,
          [`${stack.qty} ${name} are stunned and skip this turn.`],
          false,
          false,
          true,
        )
        return
      }
      if (isConfused(stack, catalog)) {
        const name = unit?.name ?? 'Unknown'
        const confuseId = confuseConditionId(catalog)
        const cleared = applyConsumedCondition(battle, stack.id, confuseId)
        if (isMagicAttackSilenced(stack, catalog)) {
          presentTurnEndRef.current(
            cleared,
            stack.id,
            [
              `${stack.qty} ${name} are silenced and cannot use Magic attacks.`,
            ],
            false,
            true,
            true,
          )
          return
        }
        const intent = confusedAttackIntent(stack, cleared, catalog, field.tiles)
        if (!intent) {
          presentTurnEndRef.current(
            cleared,
            stack.id,
            [`${stack.qty} ${name} are confused but cannot attack.`],
            false,
            true,
            true,
          )
          return
        }
        const victim =
          (intent.attackTargetId
            ? cleared.stacks.find((row) => row.id === intent.attackTargetId)
            : null) ?? null
        const victimLabel = victim
          ? `${victim.qty} ${unitById(catalog, victim.unitId)?.name ?? 'Unknown'}`
          : 'a nearby unit'
        const started = performCombatIntentRef.current(
          {
            ...intent,
            logPrefix: [
              `${stack.qty} ${name} attack ${victimLabel} in confusion!`,
            ],
          },
          stack,
          cleared,
        )
        if (!started) {
          presentTurnEndRef.current(
            cleared,
            stack.id,
            [`${stack.qty} ${name} are confused but cannot attack.`],
            false,
            true,
            true,
          )
        }
        return
      }
      if (isFeared(stack, catalog)) {
        const name = unit?.name ?? 'Unknown'
        const fearId = fearConditionId(catalog)
        const steps = pickFleeSteps(
          stack,
          battle,
          catalog,
          field.tiles,
        )
        if (steps.length === 0) {
          presentTurnEndRef.current(
            applyConsumedCondition(battle, stack.id, fearId),
            stack.id,
            [`${stack.qty} ${name} cannot flee.`],
            false,
            true,
            true,
          )
          return
        }
        const gen = (walkGenRef.current += 1)
        setMoving(true)
        void (async () => {
          let latest = battle
          const trapLines: string[] = []
          const hazardAcc = emptyWalkHazardAcc()
          let stepsDone = 0
          {
            const walker = latest.stacks.find((row) => row.id === stack.id)
            if (walker) {
              const left = tryLeaveGroundEffectOnMoveOrigin(
                latest,
                stack.id,
                catalog,
                { q: walker.q, r: walker.r },
                field.tiles,
              )
              latest = left.battle
              if (left.tiles && left.tiles !== field.tiles) {
                setField((prev) =>
                  prev ? { ...prev, tiles: left.tiles! } : prev,
                )
                field.tiles.splice(0, field.tiles.length, ...left.tiles)
              }
            }
          }
          for (const step of steps) {
            if (walkGenRef.current !== gen) {
              return
            }
            {
              const walker = latest.stacks.find((row) => row.id === stack.id)
              if (walker) {
                const left = tryLeaveTerrainOnMove(
                  latest,
                  stack.id,
                  catalog,
                  field.tiles,
                  { q: walker.q, r: walker.r },
                )
                latest = left.battle
                if (left.tiles !== field.tiles) {
                  setField((prev) =>
                    prev ? { ...prev, tiles: left.tiles } : prev,
                  )
                  field.tiles.splice(0, field.tiles.length, ...left.tiles)
                }
                trapLines.push(...left.lines)
              }
            }
            latest = moveStack(latest, stack.id, step.q, step.r)
            {
              const left = tryLeaveGroundEffectOnMoveStep(
                latest,
                stack.id,
                catalog,
                step,
                field.tiles,
              )
              latest = left.battle
              if (left.tiles && left.tiles !== field.tiles) {
                setField((prev) =>
                  prev ? { ...prev, tiles: left.tiles! } : prev,
                )
                field.tiles.splice(0, field.tiles.length, ...left.tiles)
              }
            }
            stepsDone += 1
            const boom = tryTriggerGroundEffectsOnEnter(
              latest,
              stack.id,
              catalog,
              field.tiles,
              combatHeroesRef.current,
            )
            latest = boom.battle
            trapLines.push(...boom.lines)
            const hazard = applyStandingHazards(
              latest,
              stack.id,
              catalog,
              field.tiles,
              combatHeroesRef.current,
            )
            latest = hazard.battle
            absorbWalkHazard(hazardAcc, hazard)
            const flashKeys = [...boom.hitKeys, ...hazard.hitKeys]
            if (flashKeys.length > 0) {
              setHitFlash({
                n: Date.now(),
                groups: [{ keys: flashKeys, color: 'red' }],
              })
            }
            setBattle(latest)
            await sleep(MOVE_STEP_MS)
            const walker = latest.stacks.find((row) => row.id === stack.id)
            if (!walker || walker.qty <= 0) {
              if (walkGenRef.current !== gen) {
                return
              }
              setMoving(false)
              presentTurnEndRef.current(
                applyConsumedCondition(latest, stack.id, fearId),
                stack.id,
                [
                  `${stack.qty} ${name} flee in terror.`,
                  ...trapLines,
                  ...walkHazardLogLines(hazardAcc, name),
                  movementLogLine(stack, catalog, stepsDone),
                ],
                false,
                false,
                true,
                true,
              )
              return
            }
            if (isStunned(walker, catalog)) {
              if (walkGenRef.current !== gen) {
                return
              }
              setMoving(false)
              const stunId = stunConditionId(catalog)
              presentTurnEndRef.current(
                applyConsumedCondition(
                  applyConsumedCondition(latest, stack.id, fearId),
                  stack.id,
                  stunId,
                ),
                stack.id,
                [
                  `${stack.qty} ${name} flee in terror.`,
                  ...trapLines,
                  ...walkHazardLogLines(hazardAcc, name),
                  movementLogLine(stack, catalog, stepsDone),
                  `${walker.qty} ${name} are stunned and can act no further.`,
                ],
                false,
                false,
                true,
                true,
              )
              return
            }
          }
          if (walkGenRef.current !== gen) {
            return
          }
          setMoving(false)
          presentTurnEndRef.current(
            applyConsumedCondition(latest, stack.id, fearId),
            stack.id,
            [
              `${stack.qty} ${name} flee in terror.`,
              ...trapLines,
              ...walkHazardLogLines(hazardAcc, name),
              movementLogLine(stack, catalog, stepsDone),
            ],
            false,
            false,
            true,
            true,
          )
        })()
        return
      }
      if (!unitTakesTurns(unit)) {
        presentTurnEndRef.current(battle, stack.id, [], false, true)
        return
      }
      if (unitAutoTarget(unit)) {
        const name = unit?.name ?? 'Unknown'
        if (isMagicAttackSilenced(stack, catalog)) {
          presentTurnEndRef.current(
            battle,
            stack.id,
            [
              `${stack.qty} ${name} are silenced and cannot use Magic attacks.`,
            ],
            false,
            true,
          )
          return
        }
        const target = pickAutoAttackTarget(
          stack,
          battle,
          catalog,
          field.tiles,
        )
        if (!target) {
          presentTurnEndRef.current(
            battle,
            stack.id,
            [`${stack.qty} ${name} find no target in range.`],
            false,
            true,
          )
          return
        }
        const resolved = resolveAttack(
          battle,
          stack.id,
          catalog,
          {
            targetId: target.id,
            hex: { q: target.q, r: target.r },
            stand: { q: stack.q, r: stack.r },
          },
          field.tiles,
          combatHeroes,
        )
        if (!resolved) {
          presentTurnEndRef.current(
            battle,
            stack.id,
            [`${stack.qty} ${name} cannot attack.`],
            false,
            true,
          )
          return
        }
        // Guard empty attack logs so auto-fire never silently skips the popup.
        if (resolved.log.lines.length === 0) {
          presentAttackRef.current(
            {
              ...resolved,
              log: {
                lines: [`${stack.qty} ${name} attack but hit nothing.`],
              },
            },
            [],
          )
          return
        }
        presentAttackRef.current(resolved, [])
        return
      }
      const spec = unitAttackShape(unitById(catalog, stack.unitId))
      if (shapePulsesOnMove(spec.shape)) {
        const resolved = resolveAttack(
          battle,
          stack.id,
          catalog,
          { targetId: null, hex: { q: stack.q, r: stack.r }, stand: { q: stack.q, r: stack.r } },
          field.tiles,
          combatHeroes,
        )
        if (resolved) {
          presentAttackRef.current(resolved, [
            movementLogLine(stack, catalog, 0),
          ])
          return
        }
      }
      presentTurnEndRef.current(battle, stack.id, [
        movementLogLine(stack, catalog, 0),
      ])
    }, AUTO_ACT_MS)
    return () => window.clearTimeout(timer)
  }, [battle, catalog, field, log, moving, summary, heroCast, inspectStackId])

  useEffect(() => {
    if (!battle || !catalog || !field || log || moving || summary || heroCast || inspectStackId) {
      return
    }
    if (defeatedSide(battle, catalog)) {
      return
    }
    const stack = activeStack(battle)
    if (!stack || stack.hasActedThisRound) {
      return
    }
    const owner = combatOwnerPlayer(
      stack,
      session,
      attacker,
      defender,
      siegeTown,
      defenderMobId,
    )
    if (!owner?.is_ai) {
      return
    }
    const unit = unitById(catalog, stack.unitId)
    const speed = stackCombatSpeed(stack, catalog) ?? 0
    const canMove =
      !unitIsStationary(unit) &&
      speed > 0 &&
      canCombatStep(
        stack,
        battle,
        field.tiles,
        catalog,
        deathKnightShadowMoveAdjust(
          battle,
          catalog,
          combatHeroes,
          stack.side,
          moveKindForUnit(unitById(catalog, stack.unitId), catalog),
        ),
      )
    const playerActs =
      unitTakesTurns(unit) &&
      !unitAutoTarget(unit) &&
      !stack.forcedRetreatPending &&
      !isFeared(stack, catalog) &&
      !isStunned(stack, catalog) &&
      !isConfused(stack, catalog) &&
      !isPolymorphed(stack, catalog) &&
      (canMove || canStrikeThisTurn(stack, battle, field.tiles, catalog, combatHeroes))
    if (!playerActs) {
      return
    }
    const sideHero = stack.side === 'atk' ? attacker : defender
    const timer = window.setTimeout(() => {
      if (tryAiHeroAbilityRef.current()) {
        return
      }
      const intent = decideCombatAction(
        stack,
        battle,
        field.tiles,
        catalog,
        owner,
        sideHero,
        combatHeroes,
      )
      if (!intent) {
        presentTurnEndRef.current(battle, stack.id, [
          movementLogLine(stack, catalog, 0),
        ])
        return
      }
      const started = performCombatIntentRef.current(intent, stack, battle)
      if (!started) {
        presentTurnEndRef.current(battle, stack.id, [
          movementLogLine(stack, catalog, 0),
        ])
      }
    }, AUTO_ACT_MS)
    return () => window.clearTimeout(timer)
  }, [
    battle,
    catalog,
    field,
    log,
    moving,
    summary,
    heroCast,
    inspectStackId,
    session,
    attacker,
    defender,
    siegeTown,
    defenderMobId,
  ])

  useEffect(() => {
    const canvasHost = canvasHostRef.current
    const current = getSession()
    const att = current.heroes.find((hero) => hero.id === attackerHeroId)
    const def = defenderHeroId
      ? current.heroes.find((hero) => hero.id === defenderHeroId)
      : undefined
    const siege = siegeTownId
      ? current.towns.find((row) => row.id === siegeTownId)
      : undefined
    const mob = defenderMobId
      ? current.mobs.find((row) => row.id === defenderMobId)
      : undefined
    if (!canvasHost || !att || !catalog) {
      return
    }
    if (!siege && !def && !mob) {
      return
    }
    let cancelled = false
    let app: Application | undefined
    const attackerPos = { ...att.position }
    const defenderPos = siege
      ? { ...siege.position }
      : def
        ? { ...def.position }
        : { ...mob!.position }
    const pool = neighborhoodTerrains(attackerPos, defenderPos)
    const seed = combatEncounterSeed(current.game.seed, attackerPos, defenderPos)
    const { grid, layout } = createCombatHexGrid(
      COMBAT_COLUMNS,
      COMBAT_ROWS,
      COMBAT_HEX_SIZE,
    )
    const hexPx = Math.max(16, Math.round(grid.hexPrototype.width))
    const byOffset = hexByOffset(grid)
    const attackerCol = ATTACKER_COL
    const defenderCol = DEFENDER_COL
    const markers = [
      ...markersForColumn(byOffset, attackerCol, layout.offsetX, layout.offsetY, 'atk'),
      ...markersForColumn(byOffset, defenderCol, layout.offsetX, layout.offsetY, 'def'),
    ]
    const atkHeroHex = byOffset.get(`${ATTACKER_HERO_COL},${HERO_ROW}`)
    const defHeroHex = byOffset.get(`${DEFENDER_HERO_COL},${HERO_ROW}`)
    const heroStarts = {
      atk: atkHeroHex ? { q: atkHeroHex.q, r: atkHeroHex.r } : undefined,
      def: defHeroHex ? { q: defHeroHex.q, r: defHeroHex.r } : undefined,
    }
    const catapult = siegeCatapultHex(byOffset)
    const wallHexes = siege ? siegeWallHexes(byOffset) : []
    const drawbridgeRow = DRAWBRIDGE_ROW_INDEX
    const drawbridge = wallHexes[drawbridgeRow] ?? null
    const moatHex =
      drawbridgeRow >= 0
        ? (byOffset.get(
            `${siegeMoatColForRow(drawbridgeRow)},${drawbridgeRow}`,
          ) ?? null)
        : null
    const siegeLayout: SiegeSetup | null = siege
      ? {
          townId: siege.id,
          wallHexes,
          catapult,
          drawbridge,
          drawbridgeMoat: moatHex
            ? { q: moatHex.q, r: moatHex.r }
            : null,
        }
      : null

    void (async () => {
      const instance = new Application()
      await instance.init({
        background: 0x1a1a1a,
        width: layout.canvasWidth,
        height: layout.canvasHeight,
        antialias: true,
      })
      if (cancelled) {
        instance.destroy()
        return
      }
      app = instance
      canvasHost.replaceChildren(instance.canvas)
      const texturesByTerrain = await loadAllTerrainTextures(catalog.terrain_type)
      const townName = siege
        ? townTypeName(catalog, siege.town_type_id)
        : 'Necropolis'
      const downTex = siegeLayout?.drawbridgeMoat
        ? await loadTextureUrl(
            unitPortraitUrl(siegeDrawbridgeDownArt(townName)),
            true,
          )
        : null
      if (cancelled) {
        instance.destroy()
        return
      }
      const fills = new Graphics()
      const strokes = new Graphics()
      const reach = new Graphics()
      const auraMark = new Graphics()
      const activeMark = new Graphics()
      const terrainLayer = new Container()
      const moatClosedLayer = new Container()
      const moatOpenLayer = new Container()
      const gateMoat = siegeLayout?.drawbridgeMoat ?? null
      const { offsetX, offsetY } = layout
      const rolled: CombatTile[] = []
      const anchors: HexAnchor[] = []
      const hexByKey = new Map<string, Hex>()
      grid.forEach((hex) => {
        const sampled = pickCombatTerrain(pool, seed, hex.q, hex.r, catalog)
        const terrain = siegeLayout
          ? siegeTileTerrain(hex.col, hex.row, sampled)
          : sampled
        const spec = terrainByName(catalog, terrain)
        rolled.push({
          q: hex.q,
          r: hex.r,
          col: hex.col,
          row: hex.row,
          terrain,
          movementCostMultiplier: spec?.move_cost ?? null,
          blocked: spec?.is_blocked ?? true,
          blocksLos: spec?.blocks_los ?? false,
        })
        const floor = hexFloorAnchor(hex, offsetX, offsetY)
        anchors.push({ q: hex.q, r: hex.r, x: floor.x, y: floor.y })
        hexByKey.set(hexKey(hex.q, hex.r), hex)
      })
      const tiles = rolled
      for (const tile of tiles) {
        const hex = hexByKey.get(hexKey(tile.q, tile.r))
        if (!hex) {
          continue
        }
        const poly = hex.corners.map((corner) => ({
          x: corner.x + offsetX,
          y: corner.y + offsetY,
        }))
        const variants =
          texturesByTerrain.get(tile.terrain) ??
          texturesByTerrain.get(tile.terrain.replaceAll(' ', '_'))
        const isMoat =
          tile.terrain.replaceAll(' ', '_').toLowerCase() === 'moat'
        const hasTex = variants != null && variants.length > 0
        if (!isMoat || !hasTex) {
          fills.poly(poly)
          fills.fill({ color: terrainFillColor(tile.terrain) })
        }
        if (hasTex && variants) {
          const variant = pickTerrainVariantIndex(
            seed,
            tile.q,
            tile.r,
            variants,
          )
          const chosen = variants[variant]
          if (chosen) {
            const isGateMoat =
              gateMoat != null &&
              tile.q === gateMoat.q &&
              tile.r === gateMoat.r
            addMaskedTerrainHex(
              isGateMoat ? moatClosedLayer : terrainLayer,
              hex,
              offsetX,
              offsetY,
              chosen.texture,
              isMoat ? 'contain' : 'cover',
            )
          }
        }
        strokes.poly(poly)
        strokes.stroke({ width: 2, color: 0x111111 })
      }
      if (downTex && gateMoat) {
        const moatHex = hexByKey.get(hexKey(gateMoat.q, gateMoat.r))
        if (moatHex) {
          addMaskedTerrainHex(
            moatOpenLayer,
            moatHex,
            offsetX,
            offsetY,
            downTex,
            'contain',
          )
        }
      }
      moatOpenLayer.visible = false
      const canSwapBridge = moatOpenLayer.children.length > 0
      bridgeArtApiRef.current = {
        setOpen(open: boolean) {
          if (!canSwapBridge) {
            return
          }
          moatClosedLayer.visible = !open
          moatOpenLayer.visible = open
        },
      }
      const world = new Container()
      world.addChild(
        fills,
        terrainLayer,
        moatClosedLayer,
        moatOpenLayer,
        strokes,
        auraMark,
        reach,
        activeMark,
      )
      instance.stage.addChild(world)

      const drawReach = (goldKeys: string[], redKeys: string[] = []) => {
        reach.clear()
        for (const key of goldKeys) {
          const hex = hexByKey.get(key)
          if (!hex) {
            continue
          }
          reach.poly(
            hex.corners.map((corner) => ({
              x: corner.x + offsetX,
              y: corner.y + offsetY,
            })),
          )
          reach.fill({ color: 0xffeb3b, alpha: 0.38 })
          reach.stroke({ width: 2, color: 0xfbc02d })
        }
        for (const key of redKeys) {
          const hex = hexByKey.get(key)
          if (!hex) {
            continue
          }
          reach.poly(
            hex.corners.map((corner) => ({
              x: corner.x + offsetX,
              y: corner.y + offsetY,
            })),
          )
          reach.fill({ color: 0xe53935, alpha: 0.4 })
          reach.stroke({ width: 2, color: 0xc62828 })
        }
      }
      reachApiRef.current = { draw: drawReach }

      let auraHexKeys: string[] = []
      const drawAura = () => {
        auraMark.clear()
        for (const key of auraHexKeys) {
          const hex = hexByKey.get(key)
          if (!hex) {
            continue
          }
          auraMark.poly(
            hex.corners.map((corner) => ({
              x: corner.x + offsetX,
              y: corner.y + offsetY,
            })),
          )
          // Light-blue radius preview (same pattern as gold/red reach fills).
          auraMark.fill({ color: 0x81d4fa, alpha: 0.32 })
          auraMark.stroke({ width: 2, color: 0x4fc3f7 })
        }
      }
      auraApiRef.current = {
        setKeys(keys) {
          auraHexKeys = keys
          drawAura()
        },
      }

      let activeHexKey: string | null = null
      activeApiRef.current = {
        setKey(next) {
          activeHexKey = next
        },
      }
      const pulseActive = () => {
        activeMark.clear()
        if (!activeHexKey) {
          return
        }
        const hex = hexByKey.get(activeHexKey)
        if (!hex) {
          return
        }
        const pulse = (Math.sin(performance.now() / 140) + 1) / 2
        activeMark.poly(
          hex.corners.map((corner) => ({
            x: corner.x + offsetX,
            y: corner.y + offsetY,
          })),
        )
        // Darker blue + thicker stroke so the active unit is easy to spot.
        activeMark.fill({ color: 0x1565c0, alpha: 0.1 + 0.22 * pulse })
        activeMark.stroke({
          width: 5,
          color: 0x0d47a1,
          alpha: 0.7 + 0.3 * pulse,
        })
      }
      instance.ticker.add(pulseActive)

      const canvas = instance.canvas
      canvas.style.cursor = 'pointer'
      const hexFromPointer = (event: PointerEvent) => {
        const bounds = canvas.getBoundingClientRect()
        return grid.pointToHex(
          {
            x: event.clientX - bounds.left - offsetX,
            y: event.clientY - bounds.top - offsetY,
          },
          { allowOutside: false },
        )
      }
      const zoneAt = (event: PointerEvent, hex: Hex): HexZone => {
        const bounds = canvas.getBoundingClientRect()
        const corners = hex.corners
        let cx = 0
        let cy = 0
        for (const corner of corners) {
          cx += corner.x
          cy += corner.y
        }
        const n = Math.max(1, corners.length)
        return pointerHexZone(
          event.clientX - bounds.left - offsetX - cx / n,
          event.clientY - bounds.top - offsetY - cy / n,
          COMBAT_HEX_SIZE,
        )
      }
      let lastHoverKey = ''
      const clearHover = () => {
        drawReach([])
        lastHoverKey = ''
        onHoverRef.current(null)
        onHoverInspectRef.current(null)
      }
      /** Live combat tiles (Void/Barricade stamps), not the frozen map-init copy. */
      const liveTiles = () => fieldRef.current?.tiles ?? tiles
      const setInspectHoverAt = (
        currentBattle: CombatBattle,
        currentCatalog: NonNullable<typeof catalogRef.current>,
        hex: { q: number; r: number },
      ) => {
        const occupant = stackOccupyingHex(
          currentBattle.stacks,
          hex.q,
          hex.r,
          currentCatalog,
        )
        if (occupant && occupant.qty > 0) {
          onHoverInspectRef.current(occupant.id)
        } else {
          onHoverInspectRef.current(null)
        }
      }
      const onPointerMove = (event: PointerEvent) => {
        if (logRef.current || movingRef.current || summaryRef.current) {
          clearHover()
          return
        }
        if (aiTurnLockedRef.current) {
          clearHover()
          return
        }
        const currentBattle = battleRef.current
        const currentCatalog = catalogRef.current
        const hex = hexFromPointer(event)
        if (!currentBattle || !currentCatalog || !hex) {
          clearHover()
          return
        }
        const cast = heroCastRef.current
        if (cast && cast.abilityId == null) {
          clearHover()
          return
        }
        if (cast?.abilityId != null) {
          const ability = currentCatalog.ability.find(
            (row) => row.id === cast.abilityId,
          )
          const heroStack = currentBattle.stacks.find(
            (row) => row.id === cast.stackId,
          )
          const hoverKey = `aim:${cast.abilityId}:${cast.teleportUnitId ?? ''}:${cast.lineDirIndex ?? ''}:${hex.q},${hex.r}`
          if (hoverKey === lastHoverKey) {
            return
          }
          lastHoverKey = hoverKey
          setInspectHoverAt(currentBattle, currentCatalog, hex)
          if (!ability || !heroStack) {
            drawReach([])
            onHoverRef.current(null)
            return
          }
          const valid = abilityValidHexKeys(
            currentCatalog,
            ability,
            heroStack.side,
            currentBattle,
            liveTiles(),
            cast.teleportUnitId,
          )
          const caster = heroForSide(heroStack.side, combatHeroesRef.current)
          const lineDir =
            cast.lineDirIndex != null
              ? axialNeighborDirs()[cast.lineDirIndex % 6] ?? null
              : null
          const impact = abilityAimImpactKeys(
            currentCatalog,
            ability,
            heroStack.side,
            currentBattle,
            liveTiles(),
            { q: hex.q, r: hex.r },
            caster,
            lineDir,
          )
          const aoeAim =
            parseTarget(currentCatalog, ability).spread === 'aoe' ||
            abilityUsesLocalizedEmptyHexAim(ability) ||
            abilityUsesLinePlacementPreview(ability)
          // Never fall back to all-valid-tiles red for AOE / trap aim (that
          // flashes the field). Preview is the localized radius disk only.
          drawReach([], aoeAim ? impact : impact.length > 0 ? impact : valid)
          const onValid = valid.includes(hexKey(hex.q, hex.r))
          if (!onValid) {
            onHoverRef.current(null)
            return
          }
          const tomb = tombstoneAt(currentBattle, hex.q, hex.r)
          onHoverRef.current({
            icon: aoeAim ? 'aoe' : 'magic',
            q: hex.q,
            r: hex.r,
            steps: [],
            attackTargetId: null,
            fire: true,
            afterMove: null,
            impactKeys: impact,
            label: tomb ? tombstoneName(currentCatalog, tomb) : undefined,
          })
          return
        }
        const stack = activeStack(currentBattle)
        if (
          !stack ||
          stack.hasActedThisRound ||
          stack.forcedRetreatPending ||
          isFeared(stack, currentCatalog) ||
          isStunned(stack, currentCatalog) ||
          isConfused(stack, currentCatalog) ||
          isPolymorphed(stack, currentCatalog)
        ) {
          drawReach([])
          setInspectHoverAt(currentBattle, currentCatalog, hex)
          const tomb = tombstoneAt(currentBattle, hex.q, hex.r)
          const tombKey = tomb
            ? `tomb:${tomb.id}:${hex.q},${hex.r}`
            : `idle:${hex.q},${hex.r}`
          if (tombKey === lastHoverKey) {
            return
          }
          lastHoverKey = tombKey
          onHoverRef.current(
            tomb
              ? {
                  icon: 'invalid',
                  q: hex.q,
                  r: hex.r,
                  steps: [],
                  attackTargetId: null,
                  fire: false,
                  afterMove: null,
                  impactKeys: [],
                  label: tombstoneName(currentCatalog, tomb),
                }
              : null,
          )
          return
        }
        const zone = zoneAt(event, hex)
        const hoverKey = `${stack.id}:${stack.q},${stack.r}->${hex.q},${hex.r}:${zone}`
        if (hoverKey === lastHoverKey) {
          return
        }
        lastHoverKey = hoverKey
        setInspectHoverAt(currentBattle, currentCatalog, hex)
        const heroStack = ownHeroAtHex(
          currentBattle,
          currentCatalog,
          hex.q,
          hex.r,
          stack.side,
        )
        if (heroStack) {
          drawReach([])
          onHoverRef.current({
            icon: 'hero',
            q: hex.q,
            r: hex.r,
            steps: [],
            attackTargetId: null,
            fire: false,
            afterMove: null,
            impactKeys: [],
          })
          return
        }
        const intent = combatHover(
          stack,
          { q: hex.q, r: hex.r },
          currentBattle,
          liveTiles(),
          currentCatalog,
          zone,
          combatHeroesRef.current,
        )
        const plan = waypointPlanRef.current
        const planKeys = waypointStepKeys(plan)
        const hoverSteps = intent?.steps ?? []
        // Preview from last waypoint when a plan is staged.
        const previewFromPlan =
          plan && plan.waypoints.length > 0
            ? (() => {
                const virtual = {
                  ...stack,
                  q: plan.end.q,
                  r: plan.end.r,
                }
                return combatHover(
                  virtual,
                  { q: hex.q, r: hex.r },
                  currentBattle,
                  liveTiles(),
                  currentCatalog,
                  zone,
                  combatHeroesRef.current,
                )
              })()
            : null
        const preview = previewFromPlan ?? intent
        const gold = [
          ...planKeys,
          ...(preview?.steps ?? hoverSteps).map((step) =>
            hexKey(step.q, step.r),
          ),
        ]
        drawReach(gold, preview?.impactKeys ?? [])
        if (preview || plan) {
          onHoverRef.current(
            preview
              ? {
                  ...preview,
                  steps: [...(plan?.steps ?? []), ...preview.steps],
                  label:
                    plan && plan.waypoints.length > 0
                      ? `WP ${plan.waypoints.length} · ${formatMp(plan.remaining)} left${
                          preview.label ? ` · ${preview.label}` : ''
                        }`
                      : preview.label,
                }
              : {
                  icon: 'move',
                  q: hex.q,
                  r: hex.r,
                  steps: plan?.steps ?? [],
                  attackTargetId: null,
                  fire: false,
                  afterMove: null,
                  impactKeys: [],
                  label: plan
                    ? `WP ${plan.waypoints.length} · ${formatMp(plan.remaining)} left`
                    : undefined,
                },
          )
          return
        }
        const tomb = tombstoneAt(currentBattle, hex.q, hex.r)
        if (tomb) {
          onHoverRef.current({
            icon: 'invalid',
            q: hex.q,
            r: hex.r,
            steps: [],
            attackTargetId: null,
            fire: false,
            afterMove: null,
            impactKeys: [],
            label: tombstoneName(currentCatalog, tomb),
          })
          return
        }
        onHoverRef.current(null)
      }
      const onPointerLeave = () => {
        lastHoverKey = ''
        onHoverRef.current(null)
        onHoverInspectRef.current(null)
        const cast = heroCastRef.current
        const currentBattle = battleRef.current
        const currentCatalog = catalogRef.current
        if (cast?.abilityId != null && currentBattle && currentCatalog) {
          const ability = currentCatalog.ability.find(
            (row) => row.id === cast.abilityId,
          )
          const heroStack = currentBattle.stacks.find(
            (row) => row.id === cast.stackId,
          )
          if (ability && heroStack) {
            if (
              parseTarget(currentCatalog, ability).spread === 'aoe' ||
              abilityUsesLocalizedEmptyHexAim(ability)
            ) {
              drawReach([])
              return
            }
            drawReach(
              [],
              abilityValidHexKeys(
                currentCatalog,
                ability,
                heroStack.side,
                currentBattle,
                liveTiles(),
              ),
            )
            return
          }
        }
        drawReach([])
      }
      const onPointerDown = (event: PointerEvent) => {
        const hex = hexFromPointer(event)
        if (!hex) {
          return
        }
        onHexClickRef.current(hex.q, hex.r, zoneAt(event, hex), event.shiftKey)
      }
      canvas.addEventListener('pointermove', onPointerMove)
      canvas.addEventListener('pointerleave', onPointerLeave)
      canvas.addEventListener('pointerdown', onPointerDown)

      setField({
        width: layout.canvasWidth,
        height: layout.canvasHeight,
        hexPx,
        markers,
        anchors,
        tiles,
        siege: siegeLayout,
        heroStarts,
      })

      if (cancelled) {
        canvas.removeEventListener('pointermove', onPointerMove)
        canvas.removeEventListener('pointerleave', onPointerLeave)
        canvas.removeEventListener('pointerdown', onPointerDown)
        instance.ticker.remove(pulseActive)
        reachApiRef.current = null
        auraApiRef.current = null
        bridgeArtApiRef.current = null
        activeApiRef.current = null
        instance.destroy()
      }
    })()

    return () => {
      cancelled = true
      walkGenRef.current += 1
      reachApiRef.current = null
      auraApiRef.current = null
      bridgeArtApiRef.current = null
      activeApiRef.current = null
      fieldRef.current = null
      app?.destroy()
    }
  }, [attackerHeroId, defenderHeroId, siegeTownId, defenderMobId, catalog])

  return (
    <div
      className="town-management combat-screen"
      data-hero-cast={heroCast ? 'true' : undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby="combat-screen-title"
    >
      <header className="town-management-bar">
        <h1 id="combat-screen-title">Combat</h1>
        <div className="combat-debug-end">
          <DebugCopyPanel sections={debugSections} />
          <button
            type="button"
            onClick={() => {
              if (summary) {
                onExit(summary.levelUpNotice ?? null)
                return
              }
              if (battle && finishCombat(battleRef.current ?? battle)) {
                return
              }
              onExit(null)
            }}
          >
            Exit
          </button>
        </div>
      </header>
      {heroCast?.abilityId != null ? (
        <p className="combat-hero-aim-hint">
          {heroCast.lineDirIndex != null
            ? 'Click to place. R or scroll to rotate orientation. Esc returns to abilities.'
            : 'Select a target. Esc returns to abilities.'}
        </p>
      ) : null}
      <div className="combat-body">
        <div
          className="combat-field"
          style={field ? { width: field.width } : undefined}
          aria-label={`Battlefield ${COMBAT_COLUMNS} by ${COMBAT_ROWS}`}
        >
          <div
            className="combat-hexes"
            style={
              field
                ? { width: field.width, height: field.height }
                : undefined
            }
          >
            <div ref={canvasHostRef} className="combat-field-canvas" />
            {field && battle
              ? (() => {
                  const atkSample =
                    battle.stacks.find((row) => row.side === 'atk') ?? null
                  const defSample =
                    battle.stacks.find((row) => row.side === 'def') ?? null
                  const atkPlayer = atkSample
                    ? combatOwnerPlayer(
                        atkSample,
                        session,
                        attacker,
                        defender,
                        siegeTown,
                        defenderMobId,
                      )
                    : null
                  const defPlayer = defSample
                    ? combatOwnerPlayer(
                        defSample,
                        session,
                        attacker,
                        defender,
                        siegeTown,
                        defenderMobId,
                      )
                    : null
                  let viewerSide: CombatSide = 'atk'
                  if (atkPlayer && !atkPlayer.is_ai && defPlayer && !defPlayer.is_ai) {
                    viewerSide = activeStack(battle)?.side ?? 'atk'
                  } else if (
                    defPlayer &&
                    !defPlayer.is_ai &&
                    (!atkPlayer || atkPlayer.is_ai)
                  ) {
                    viewerSide = 'def'
                  }
                  const zones = visibleGroundEffects(battle, viewerSide)
                  const renderZones = (layer: 'below_units' | 'above_units') =>
                    zones
                      .filter((zone) => (zone.layer ?? 'below_units') === layer)
                      .flatMap((zone) =>
                        zone.hexKeys.map((key) => {
                          const [qs, rs] = key.split(',')
                          const pos = anchorAt(
                            field.anchors,
                            Number(qs),
                            Number(rs),
                          )
                          if (!pos) {
                            return null
                          }
                          const layerClass =
                            layer === 'above_units'
                              ? ' combat-ground-effect-above'
                              : ' combat-ground-effect-below'
                          const hiddenClass = zone.hidden
                            ? ' combat-ground-effect-hidden'
                            : ''
                          return (
                            <div
                              key={`ge:${layer}:${zone.id}:${key}`}
                              className={`combat-ground-effect${layerClass}${hiddenClass}`}
                              data-ground-effect={zone.templateId}
                              title={zone.name}
                              style={{
                                width: field.hexPx,
                                height: field.hexPx,
                                left: pos.x - field.hexPx / 2,
                                top: pos.y - field.hexPx,
                              }}
                            >
                              <GroundEffectArt
                                filename={zone.imagePath}
                                label={zone.name}
                              />
                            </div>
                          )
                        }),
                      )
                  return (
                    <>
                      {renderZones('below_units')}
                      {(battle.terrainPatches ?? []).map((patch) => {
                        const pos = anchorAt(field.anchors, patch.q, patch.r)
                        if (!pos) {
                          return null
                        }
                        return (
                          <div
                            key={`tp:${patch.q},${patch.r},${patch.terrainTypeId}`}
                            className="combat-ground-effect combat-ground-effect-below"
                            data-terrain-patch={patch.terrainTypeId}
                            title={patch.name}
                            style={{
                              width: field.hexPx,
                              height: field.hexPx,
                              left: pos.x - field.hexPx / 2,
                              top: pos.y - field.hexPx,
                            }}
                          >
                            <GroundEffectArt
                              filename={patch.imagePath}
                              label={patch.name}
                            />
                          </div>
                        )
                      })}
                      {stacksBottomUp(battle.stacks, field.anchors).map((stack) => {
                  const pos = anchorAt(field.anchors, stack.q, stack.r)
                  if (!pos) {
                    return null
                  }
                  const hero = isHeroStack(stack)
                    ? session.heroes.find((row) => row.id === stack.heroId)
                    : undefined
                  const view = hero
                    ? null
                    : stackViewFromCombat(stack, catalog, siegeTownArtName)
                  const box = stackArtBox(
                    pos,
                    field.hexPx,
                    catalog ? combatStackCells(stack, catalog) : 1,
                    stack.side,
                  )
                  const unit = hero ? null : unitById(catalog, stack.unitId)
                  const fixture = isSiegeFixtureArt(unit)
                  const current = activeStack(battle)
                  const speed = catalog
                    ? (stackCombatSpeed(stack, catalog) ?? 0)
                    : 0
                  return (
                    <div
                      key={stack.id}
                      className={
                        fixture
                          ? 'combat-stack combat-stack-on-hex combat-stack-fixture'
                          : 'combat-stack combat-stack-on-hex'
                      }
                      data-combat-stack={stack.id}
                      data-slot={isHeroStack(stack) ? undefined : stack.slot + 1}
                      data-speed={isHeroStack(stack) ? undefined : speed}
                      data-hero={isHeroStack(stack) ? 'true' : undefined}
                      data-acted={stack.hasActedThisRound ? 'true' : 'false'}
                      data-active={current?.id === stack.id ? 'true' : 'false'}
                      data-top-health={
                        isHeroStack(stack) ? undefined : stack.topHealth
                      }
                      style={{
                        width: box.width,
                        height: box.height,
                        left: box.left,
                        top: box.top,
                      }}
                    >
                      {hero || isHeroStack(stack) ? (
                        <HeroHexArt
                          hero={hero}
                          acted={stack.hasActedThisRound}
                        />
                      ) : (
                        <>
                          <CombatStackArt view={view!} />
                          <span className="combat-stack-qty">
                            {formatAmount(view!.qty)}
                          </span>
                        </>
                      )}
                    </div>
                  )
                      })}
                      {(battle.tombstones ?? []).map((tomb) => {
                  const pos = anchorAt(field.anchors, tomb.q, tomb.r)
                  if (!pos) {
                    return null
                  }
                  const box = stackArtBox(pos, field.hexPx, 1, tomb.side)
                  return (
                    <div
                      key={`tomb:${tomb.id}`}
                      className="combat-stack combat-stack-on-hex combat-tombstone"
                      data-tombstone={tomb.id}
                      style={{
                        width: box.width,
                        height: box.height,
                        left: box.left,
                        top: box.top,
                      }}
                    >
                      <TombstoneArt />
                    </div>
                  )
                      })}
                      {renderZones('above_units')}
                    </>
                  )
                })()
              : null}
            {field && hitFlash
              ? hitFlash.groups.flatMap((group) =>
                  [...new Set(group.keys)].map((key) => {
                  const [qs, rs] = key.split(',')
                  const pos = anchorAt(field.anchors, Number(qs), Number(rs))
                  if (!pos) {
                    return null
                  }
                  return (
                    <div
                      key={`${hitFlash.n}:${group.color}:${key}`}
                      className={`combat-hit-flash combat-hit-flash-${group.color}`}
                      style={{
                        width: field.hexPx,
                        height: field.hexPx,
                        left: pos.x - field.hexPx / 2,
                        top: pos.y - field.hexPx,
                      }}
                    />
                  )
                }),
                )
              : null}
            {field && hoverTarget && !log && !summary && heroCast?.abilityId !== null
              ? (() => {
                  const pos = anchorAt(field.anchors, hoverTarget.q, hoverTarget.r)
                  if (!pos) {
                    return null
                  }
                  const occupant = catalog
                    ? stackOccupyingHex(
                        battle?.stacks ?? [],
                        hoverTarget.q,
                        hoverTarget.r,
                        catalog,
                      )
                    : battle?.stacks.find(
                        (row) =>
                          row.q === hoverTarget.q && row.r === hoverTarget.r,
                      )
                  const box = stackArtBox(
                    pos,
                    field.hexPx,
                    occupant && catalog
                      ? combatStackCells(occupant, catalog)
                      : 1,
                    occupant?.side ?? 'atk',
                  )
                  return (
                    <div
                      className="combat-target-icon"
                      style={{
                        width: box.width,
                        height: box.height,
                        left: box.left,
                        top: box.top,
                      }}
                    >
                      <CombatTargetIcon
                        kind={hoverTarget.icon}
                        arrowDeg={hoverTarget.arrowDeg}
                      />
                      {hoverTarget.label ? (
                        <span className="combat-target-label">
                          {hoverTarget.label}
                        </span>
                      ) : null}
                    </div>
                  )
                })()
              : null}
            {catalog &&
            battle &&
            field &&
            hoverInspectId &&
            !inspectStackId &&
            !log &&
            !summary
              ? (() => {
                  const stack = battle.stacks.find(
                    (row) => row.id === hoverInspectId,
                  )
                  if (!stack || stack.qty <= 0) {
                    return null
                  }
                  const pos = anchorAt(field.anchors, stack.q, stack.r)
                  if (!pos) {
                    return null
                  }
                  if (isHeroStack(stack)) {
                    const hero =
                      session.heroes.find((row) => row.id === stack.heroId) ??
                      (stack.side === 'atk' ? attacker : defender) ??
                      null
                    if (!hero) {
                      return null
                    }
                    const tipText = heroTooltipText(catalog, hero, session)
                    const box = stackArtBox(pos, field.hexPx, 1, stack.side)
                    const tipEstimatePx = 10 + tipText.split('\n').length * 17
                    const placeBelow = box.top - 4 - tipEstimatePx < 0
                    return (
                      <CombatHoverTip
                        left={box.left + box.width / 2}
                        top={
                          placeBelow
                            ? box.top + box.height + 4
                            : box.top - 4
                        }
                        placeBelow={placeBelow}
                      >
                        {tipText.split('\n').map((line, index) => (
                          <div
                            key={`${index}:${line}`}
                            className="combat-stack-hover-row"
                          >
                            <span>{line || '\u00a0'}</span>
                          </div>
                        ))}
                      </CombatHoverTip>
                    )
                  }
                  const atkSample =
                    battle.stacks.find((row) => row.side === 'atk') ?? null
                  const defSample =
                    battle.stacks.find((row) => row.side === 'def') ?? null
                  const atkPlayer = atkSample
                    ? combatOwnerPlayer(
                        atkSample,
                        session,
                        attacker,
                        defender,
                        siegeTown,
                        defenderMobId,
                      )
                    : null
                  const defPlayer = defSample
                    ? combatOwnerPlayer(
                        defSample,
                        session,
                        attacker,
                        defender,
                        siegeTown,
                        defenderMobId,
                      )
                    : null
                  const acting = activeStack(battle)
                  let viewerSide: CombatSide = 'atk'
                  if (atkPlayer && !atkPlayer.is_ai && defPlayer && !defPlayer.is_ai) {
                    viewerSide = acting?.side ?? 'atk'
                  } else if (
                    defPlayer &&
                    !defPlayer.is_ai &&
                    (!atkPlayer || atkPlayer.is_ai)
                  ) {
                    viewerSide = 'def'
                  }
                  const rows = inspectHoverRows(
                    stack,
                    catalog,
                    viewerSide,
                    battle,
                    combatHeroes,
                  )
                  const box = stackArtBox(
                    pos,
                    field.hexPx,
                    combatStackCells(stack, catalog),
                    stack.side,
                  )
                  const tipEstimatePx = 10 + rows.length * 17
                  const placeBelow = box.top - 4 - tipEstimatePx < 0
                  return (
                    <CombatHoverTip
                      left={box.left + box.width / 2}
                      top={
                        placeBelow
                          ? box.top + box.height + 4
                          : box.top - 4
                      }
                      placeBelow={placeBelow}
                    >
                      {rows.map((row) => (
                        <div
                          key={`${row.label}:${row.value}`}
                          className="combat-stack-hover-row"
                        >
                          <span>{row.label}</span>
                          {row.value ? <span>{row.value}</span> : null}
                        </div>
                      ))}
                    </CombatHoverTip>
                  )
                })()
              : null}
          </div>
        </div>
      </div>
      {log && !summary ? (
        <div
          className="date-notice"
          role="dialog"
          aria-label="Battle log"
          onClick={() => dismissLogRef.current()}
        >
          <div className="date-notice-card">
            {log.lines.map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </div>
        </div>
      ) : null}
      {summary ? (
        <div
          className="date-notice"
          role="dialog"
          aria-label="Combat summary"
          onClick={() => onExit(summary.levelUpNotice ?? null)}
        >
          <div className="date-notice-card combat-summary-card">
            <div className="combat-summary-side">
              <h2>
                Player {summary.loserPlayer} - {summary.loserHeroName} LOST
              </h2>
              {summary.loserLosses.map((line, index) => (
                <p key={`lose-${index}`}>
                  Lost {line.qty} {line.unitName}
                </p>
              ))}
            </div>
            <div className="combat-summary-side">
              <h2>
                Player {summary.winnerPlayer} - {summary.winnerHeroName} WON
              </h2>
              {summary.winnerLosses.map((line, index) => (
                <p key={`win-${index}`}>
                  Lost {line.qty} {line.unitName}
                </p>
              ))}
              {summary.winnerGains.map((line, index) => (
                <p key={`gain-${index}`}>
                  Gained {line.qty} {line.unitName}
                </p>
              ))}
              {summary.xpLines.map((line, index) => (
                <p key={`xp-${index}`}>{line}</p>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {catalog && battle && heroCast && heroCast.abilityId == null
        ? (() => {
            const stack = battle.stacks.find((row) => row.id === heroCast.stackId)
            const hero = stack?.heroId
              ? session.heroes.find((row) => row.id === stack.heroId)
              : undefined
            if (!stack || !hero) {
              return null
            }
            return (
              <HeroAbilityPopup
                catalog={catalog}
                hero={hero}
                learned={hero.learned_abilities ?? []}
                canCast={!stack.hasActedThisRound}
                battle={battle}
                casterSide={stack.side}
                onCancel={() => {
                  setHeroCast(null)
                  setHoverTarget(null)
                  reachApiRef.current?.draw([])
                }}
                onChoose={(ability) => {
                  if (
                    stack.hasActedThisRound ||
                    !canAffordAbility(hero, ability) ||
                    !abilityCooldownReady(hero, ability) ||
                    !abilityMeetsCastGate(catalog, ability, battle, stack.side)
                  ) {
                    return
                  }
                  if (!abilityNeedsHexTarget(catalog, ability)) {
                    finishHeroCast(ability, hero, stack.side, stack.id, {
                      targetId: null,
                      hex: { q: stack.q, r: stack.r },
                    })
                    return
                  }
                  setHoverTarget(null)
                  setHeroCast({
                    stackId: stack.id,
                    abilityId: ability.id,
                    ...(abilityUsesLinePlacementPreview(ability)
                      ? { lineDirIndex: 0 }
                      : {}),
                  })
                }}
              />
            )
          })()
        : null}
      {catalog && battle && inspectStackId
        ? (() => {
            const stack = battle.stacks.find((row) => row.id === inspectStackId)
            if (!stack || stack.qty <= 0) {
              return null
            }
            const atkSample =
              battle.stacks.find((row) => row.side === 'atk') ?? null
            const defSample =
              battle.stacks.find((row) => row.side === 'def') ?? null
            const atkPlayer = atkSample
              ? combatOwnerPlayer(
                  atkSample,
                  session,
                  attacker,
                  defender,
                  siegeTown,
                  defenderMobId,
                )
              : null
            const defPlayer = defSample
              ? combatOwnerPlayer(
                  defSample,
                  session,
                  attacker,
                  defender,
                  siegeTown,
                  defenderMobId,
                )
              : null
            const acting = activeStack(battle)
            let viewerSide: CombatSide = 'atk'
            if (atkPlayer && !atkPlayer.is_ai && defPlayer && !defPlayer.is_ai) {
              viewerSide = acting?.side ?? 'atk'
            } else if (
              defPlayer &&
              !defPlayer.is_ai &&
              (!atkPlayer || atkPlayer.is_ai)
            ) {
              viewerSide = 'def'
            }
            return (
              <StackInspectPopup
                catalog={catalog}
                stack={stack}
                viewerSide={viewerSide}
                battle={battle}
                heroes={combatHeroes}
                onClose={() => setInspectStackId(null)}
              />
            )
          })()
        : null}
    </div>
  )
}
