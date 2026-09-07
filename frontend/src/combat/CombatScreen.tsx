import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
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
  applyCombatBarriers,
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
import { MOVE_STEP_MS } from '../hex/hero'
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
  type AbilityRow,
} from '../town/catalog'
import { heroPortraitUrl, unitPortraitUrl } from '../town/slotArt'
import { formatAmount } from '../hex/resources'
import type { UnitStackView } from '../town/unitStack'
import {
  activeStack,
  advanceTurn,
  applyOwnSilenceAfterTurn,
  createBattle,
  endStackTurn,
  moveStack,
  type BattleLog,
  type CombatBattle,
  type CombatSide,
  type CombatStack,
  type CombatTile,
  type SiegeSetup,
  isHeroStack,
  stackCombatSpeed,
} from './battle'
import {
  canCombatStep,
  combatStackCells,
  hexKey,
  movementLogLine,
  stackOccupyingHex,
} from './movement'
import { resolveAttack, pickAutoAttackTarget, type HitFlashColor } from './attack'
import { combatOwnerPlayer, decideCombatAction } from '../ai/combat'
import { decideHeroAbility } from '../ai/heroAbility'
import {
  applyConsumedCondition,
  fearConditionId,
  isFeared,
  isPolymorphed,
  pickFleeSteps,
  polymorphConditionName,
  POLYMORPH_ART_FILENAME,
} from './condition'
import {
  resolveAbility,
  abilityAimImpactKeys,
  abilityNeedsHexTarget,
  abilityValidHexKeys,
  parseTarget,
} from './ability'
import { applyMoatEntryDamage } from './moat'
import {
  actingStand,
  canStrikeThisTurn,
  combatHover,
  pointerHexZone,
  type CombatHover,
  type HexZone,
} from './target'
import { CombatTargetIcon } from './CombatIcons'
import { HeroAbilityPopup } from './HeroAbilityPopup'
import { StackInspectPopup } from './StackInspectPopup'
import {
  abilityCooldownReady,
  canAffordAbility,
  deductAbilityCost,
  markHeroActed,
  ownHeroAtHex,
  recordAbilityCast,
  type HeroCast,
} from './heroCast'
import { combatDisplayLearnedIds } from '../town/libraryRules'
import { abilityMeetsCastGate } from './summon'
import {
  commitCombatOutcome,
  defeatedSide,
  snapshotOpening,
  type CombatSummary,
  type OpeningStack,
} from './resolve'
import {
  DRAWBRIDGE_ROW_INDEX,
  isDrawbridgeOpen,
  isSiegeEngineUnit,
  isWallSegmentUnit,
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

const AUTO_ACT_MS = 1500
const HIT_FLASH_MS = 450
/** Informational turn log — auto-dismiss so watching fights isn't click-to-continue. */
const LOG_AUTO_MS = 1500

type CombatScreenProps = {
  attackerHeroId: string
  defenderHeroId: string | null
  siegeTownId?: string | null
  defenderMobId?: string | null
  debugSections: DebugSections
  onCopyDebug: () => void
  onExit: () => void
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

function hexByOffset(
  grid: { forEach: (fn: (hex: Hex) => void) => void },
): Map<string, Hex> {
  const byOffset = new Map<string, Hex>()
  grid.forEach((hex) => {
    byOffset.set(`${hex.col},${hex.row}`, hex)
  })
  return byOffset
}

function columnRows(byOffset: Map<string, Hex>, col: number): number[] {
  const rows = new Set<number>()
  for (const hex of byOffset.values()) {
    if (hex.col === col) {
      rows.add(hex.row)
    }
  }
  return [...rows].sort((a, b) => a - b)
}

function markersForColumn(
  byOffset: Map<string, Hex>,
  col: number,
  offsetX: number,
  offsetY: number,
  side: CombatSide,
): StackMarker[] {
  const rows = columnRows(byOffset, col)
  const markers: StackMarker[] = []
  for (let slot = 0; slot < ARMY_STACK_SLOTS; slot += 1) {
    const row = rows[armySlotRow(slot)]
    if (row == null) {
      continue
    }
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
  onCopyDebug,
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
  const bridgeArtApiRef = useRef<{ setOpen: (open: boolean) => void } | null>(
    null,
  )
  const activeApiRef = useRef<{ setKey: (key: string | null) => void } | null>(
    null,
  )
  const onHexClickRef = useRef<(q: number, r: number, zone: HexZone) => void>(
    () => {},
  )
  const onHoverRef = useRef<(hover: CombatHover | null) => void>(() => {})
  const battleRef = useRef<CombatBattle | null>(null)
  const catalogRef = useRef(catalog)
  const logRef = useRef<BattleLog | null>(null)
  const summaryRef = useRef<CombatSummary | null>(null)
  const movingRef = useRef(false)
  const walkGenRef = useRef(0)
  const fieldRef = useRef<FieldView | null>(null)
  const presentAttackRef = useRef<
    (
      resolved: NonNullable<ReturnType<typeof resolveAttack>>,
      extraLines: string[],
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
    ) => void
  >(() => {})
  const finishHeroCastRef = useRef<
    (
      ability: AbilityRow,
      caster: Hero,
      casterSide: CombatSide,
      heroStackId: string,
      aim: { targetId: string | null; hex: { q: number; r: number } },
      holdUnitTurn?: boolean,
    ) => void
  >(() => {})
  const performCombatIntentRef = useRef<
    (intent: CombatHover, stack: CombatStack, current: CombatBattle) => boolean
  >(() => false)
  const tryAiHeroAbilityRef = useRef<() => boolean>(() => false)
  const dismissLogRef = useRef<() => void>(() => {})
  const moatStartKeyRef = useRef<string | null>(null)
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
  const [heroCast, setHeroCast] = useState<HeroCast | null>(null)
  const [inspectStackId, setInspectStackId] = useState<string | null>(null)
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

  performCombatIntentRef.current = (intent, stack, current) => {
    if (!catalog || !field) {
      return false
    }
    const fire = intent.fire || intent.afterMove === 'pulse'
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
      )
      if (!resolved) {
        return false
      }
      setHoverTarget(null)
      presentAttackRef.current(resolved, [])
      return true
    }
    if (intent.steps.length === 0) {
      setHoverTarget(null)
      presentTurnEndRef.current(current, stack.id, [
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
      for (const step of intent.steps) {
        if (walkGenRef.current !== gen) {
          return
        }
        latest = moveStack(latest, stack.id, step.q, step.r)
        setBattle(latest)
        await sleep(MOVE_STEP_MS)
      }
      if (walkGenRef.current !== gen) {
        return
      }
      setMoving(false)
      if (fire) {
        const resolved = resolveAttack(
          latest,
          stack.id,
          catalog,
          aim,
          field.tiles,
          combatHeroes,
        )
        if (resolved) {
          presentAttackRef.current(
            resolved,
            [movementLogLine(stack, catalog, intent.steps.length)],
          )
        } else {
          presentTurnEndRef.current(latest, stack.id, [
            movementLogLine(stack, catalog, intent.steps.length),
          ])
        }
      } else {
        presentTurnEndRef.current(latest, stack.id, [
          movementLogLine(stack, catalog, intent.steps.length),
        ])
      }
    })()
    return true
  }

  onHexClickRef.current = (q, r, zone) => {
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
      const valid = new Set(
        abilityValidHexKeys(catalog, ability, heroStack.side, battle, field.tiles),
      )
      if (!valid.has(hexKey(q, r))) {
        return
      }
      const occupant =
        stackOccupyingHex(battle.stacks, q, r, catalog) ??
        battle.stacks.find((row) => row.q === q && row.r === r) ??
        null
      finishHeroCastRef.current(ability, caster, heroStack.side, heroStack.id, {
        targetId: occupant && !isHeroStack(occupant) ? occupant.id : null,
        hex: { q, r },
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
      setHeroCast({ stackId: occupant.id, abilityId: null })
      return
    }
    const stack = acting
    if (
      stack &&
      !stack.hasActedThisRound &&
      !isFeared(stack, catalog) &&
      !isPolymorphed(stack, catalog)
    ) {
      const intent = combatHover(
        stack,
        { q, r },
        battle,
        field.tiles,
        catalog,
        zone,
      )
      const act =
        intent != null &&
        (intent.fire ||
          intent.afterMove === 'pulse' ||
          intent.steps.length > 0)
      if (act && intent) {
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
    setSummary(pending)
    return true
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
      const advanced = advanceTurn(current, cat)
      setBattle(advanced)
      if (advanced.roundLog && advanced.roundLog.length > 0) {
        setLog({ lines: advanced.roundLog, holdTurn: true })
        setBattle({ ...advanced, roundLog: [] })
      }
    }
  }
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
    aim: { targetId: string | null; hex: { q: number; r: number } },
    holdUnitTurn = false,
  ) => {
    if (!battle || !catalog || !field) {
      return
    }
    const heroRow = battle.stacks.find((row) => row.id === heroStackId)
    if (heroRow?.hasActedThisRound) {
      setHeroCast(null)
      return
    }
    if (!abilityMeetsCastGate(catalog, ability, battle, casterSide)) {
      setHeroCast(null)
      return
    }
    const liveCaster =
      getSession().heroes.find((row) => row.id === caster.id) ?? caster
    if (
      !canAffordAbility(liveCaster, ability) ||
      !abilityCooldownReady(liveCaster, ability)
    ) {
      setHeroCast(null)
      return
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
      setLog({
        lines: [`${ability.name} is not designed yet.`],
        holdTurn: true,
      })
      return
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
    const next = markHeroActed(resolved.battle, heroStackId)
    setBattle(next)
    applyOutcomeIfOver(next)
    if (resolved.flashes.length > 0) {
      setHitFlash({ n: Date.now(), groups: resolved.flashes })
    }
    setLog(holdUnitTurn ? { ...resolved.log, holdTurn: true } : resolved.log)
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
    finishHeroCastRef.current(
      pick.ability,
      caster,
      heroStack.side,
      heroStack.id,
      pick.aim,
      acting.id !== heroStack.id,
    )
    return true
  }

  presentTurnEndRef.current = (
    current,
    stackId,
    extraLines,
    alreadyActed = false,
    advanceIfSilent = false,
    wasteExtraTurn = false,
  ) => {
    const cat = catalogRef.current
    const tiles = field?.tiles ?? []
    if (!cat) {
      return
    }
    const tick = applyMoatEntryDamage(current, stackId, cat, tiles)
    const ended = alreadyActed
      ? tick.battle
      : endStackTurn(tick.battle, stackId, wasteExtraTurn)
    const silenced = applyOwnSilenceAfterTurn(ended, stackId, cat)
    const next = silenced.battle
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
    ]
    setBattle(next)
    applyOutcomeIfOver(next)
    if (lines.length > 0) {
      setLog({ lines })
      return
    }
    if (advanceIfSilent) {
      const advanced = advanceTurn(next, cat)
      setBattle(advanced)
      applyOutcomeIfOver(advanced)
      if (advanced.roundLog && advanced.roundLog.length > 0) {
        setLog({ lines: advanced.roundLog, holdTurn: true })
        setBattle({ ...advanced, roundLog: [] })
      }
    }
  }

  presentAttackRef.current = (resolved, extraLines) => {
    const cat = catalogRef.current
    const tiles = field?.tiles ?? []
    const actor = activeStack(resolved.battle)
    const tick =
      cat && actor
        ? applyMoatEntryDamage(resolved.battle, actor.id, cat, tiles)
        : { battle: resolved.battle, lines: [] as string[], hitKeys: [] as string[] }
    const ended = actor
      ? endStackTurn(tick.battle, actor.id)
      : tick.battle
    const silenced =
      cat && actor
        ? applyOwnSilenceAfterTurn(ended, actor.id, cat)
        : { battle: ended, line: null as string | null }
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
    ]
    setBattle(silenced.battle)
    applyOutcomeIfOver(silenced.battle)
    if (lines.length > 0) {
      setLog({ lines })
      return
    }
    if (cat) {
      const advanced = advanceTurn(silenced.battle, cat)
      setBattle(advanced)
      if (advanced.roundLog && advanced.roundLog.length > 0) {
        setLog({ lines: advanced.roundLog, holdTurn: true })
        setBattle({ ...advanced, roundLog: [] })
      }
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
    if (!log || summary) {
      return
    }
    const timer = window.setTimeout(() => {
      dismissLogRef.current()
    }, LOG_AUTO_MS)
    return () => window.clearTimeout(timer)
  }, [log, summary])

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

  useEffect(() => {
    return () => {
      walkGenRef.current += 1
    }
  }, [attackerHeroId, defenderHeroId])

  useEffect(() => {
    if (!field || !catalog || !catalogReady) {
      return
    }
    if (fieldRef.current === field) {
      return
    }
    fieldRef.current = field
    const created = createBattle(
      getSession(),
      catalog,
      attackerHeroId,
      defenderHeroId,
      field.markers,
      Math.random,
      field.siege,
      field.heroStarts,
      defenderMobId,
    )
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
    setLog(null)
    setSummary(null)
    appliedRef.current = false
    pendingSummaryRef.current = null
    moatStartKeyRef.current = null
  }, [field, catalog, catalogReady, attackerHeroId, defenderHeroId, siegeTownId, defenderMobId])

  useEffect(() => {
    if (!hitFlash) {
      return
    }
    const timer = window.setTimeout(() => setHitFlash(null), HIT_FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [hitFlash])

  useEffect(() => {
    if (!heroCast && !inspectStackId) {
      return
    }
    const onKey = (event: KeyboardEvent) => {
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
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [heroCast, inspectStackId])

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
    reachApiRef.current?.draw(
      [],
      abilityValidHexKeys(catalog, ability, heroStack.side, battle, field?.tiles),
    )
  }, [battle, catalog, heroCast])

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
    const tick = applyMoatEntryDamage(battle, stack.id, catalog, field.tiles)
    if (tick.lines.length === 0) {
      return
    }
    if (tick.hitKeys.length > 0) {
      setHitFlash({
        n: Date.now(),
        groups: [{ keys: tick.hitKeys, color: 'red' }],
      })
    }
    const next = { ...tick.battle, moatStartKey: key }
    setBattle(next)
    applyOutcomeIfOver(next)
    const still = tick.battle.stacks.find((row) => row.id === stack.id)
    setLog({
      lines: tick.lines,
      holdTurn: still != null && still.qty > 0,
    })
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
      canCombatStep(stack, battle, field.tiles, catalog)
    const playerActs =
      unitTakesTurns(unit) &&
      !unitAutoTarget(unit) &&
      !isFeared(stack, catalog) &&
      !isPolymorphed(stack, catalog) &&
      (canMove || canStrikeThisTurn(stack, battle, field.tiles, catalog))
    if (playerActs) {
      return
    }
    const timer = window.setTimeout(() => {
      if (tryAiHeroAbilityRef.current()) {
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
          for (const step of steps) {
            if (walkGenRef.current !== gen) {
              return
            }
            latest = moveStack(latest, stack.id, step.q, step.r)
            setBattle(latest)
            await sleep(MOVE_STEP_MS)
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
              movementLogLine(stack, catalog, steps.length),
            ],
            false,
            false,
            true,
          )
        })()
        return
      }
      if (stack.silenced) {
        presentTurnEndRef.current(battle, stack.id, [], false, true)
        return
      }
      if (!unitTakesTurns(unit)) {
        presentTurnEndRef.current(battle, stack.id, [], false, true)
        return
      }
      if (unitAutoTarget(unit)) {
        const target = pickAutoAttackTarget(
          stack,
          battle,
          catalog,
          field.tiles,
        )
        if (!target) {
          presentTurnEndRef.current(battle, stack.id, [], false, true)
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
          presentTurnEndRef.current(battle, stack.id, [], false, true)
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
      canCombatStep(stack, battle, field.tiles, catalog)
    const playerActs =
      unitTakesTurns(unit) &&
      !unitAutoTarget(unit) &&
      !isFeared(stack, catalog) &&
      !isPolymorphed(stack, catalog) &&
      (canMove || canStrikeThisTurn(stack, battle, field.tiles, catalog))
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
      const activeMark = new Graphics()
      const terrainLayer = new Container()
      const moatClosedLayer = new Container()
      const moatOpenLayer = new Container()
      const gateMoat = siegeLayout?.drawbridgeMoat ?? null
      const { offsetX, offsetY } = layout
      const rolled: CombatTile[] = []
      const anchors: HexAnchor[] = []
      const hexByKey = new Map<string, Hex>()
      const colByKey = new Map<string, number>()
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
        colByKey.set(hexKey(hex.q, hex.r), hex.col)
      })
      const tiles = siegeLayout
        ? rolled
        : applyCombatBarriers(
            rolled,
            colByKey,
            [attackerCol, defenderCol],
            seed,
            catalog,
          )
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
        const pulse = (Math.sin(performance.now() / 180) + 1) / 2
        activeMark.poly(
          hex.corners.map((corner) => ({
            x: corner.x + offsetX,
            y: corner.y + offsetY,
          })),
        )
        activeMark.fill({ color: 0x4dd0e1, alpha: 0.12 + 0.16 * pulse })
        activeMark.stroke({ width: 3, color: 0x4dd0e1, alpha: 0.55 + 0.4 * pulse })
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
      const onPointerMove = (event: PointerEvent) => {
        if (logRef.current || movingRef.current || summaryRef.current) {
          drawReach([])
          lastHoverKey = ''
          onHoverRef.current(null)
          return
        }
        const currentBattle = battleRef.current
        const currentCatalog = catalogRef.current
        const hex = hexFromPointer(event)
        if (!currentBattle || !currentCatalog || !hex) {
          drawReach([])
          lastHoverKey = ''
          onHoverRef.current(null)
          return
        }
        const cast = heroCastRef.current
        if (cast && cast.abilityId == null) {
          drawReach([])
          lastHoverKey = ''
          onHoverRef.current(null)
          return
        }
        if (cast?.abilityId != null) {
          const ability = currentCatalog.ability.find(
            (row) => row.id === cast.abilityId,
          )
          const heroStack = currentBattle.stacks.find(
            (row) => row.id === cast.stackId,
          )
          const hoverKey = `aim:${cast.abilityId}:${hex.q},${hex.r}`
          if (hoverKey === lastHoverKey) {
            return
          }
          lastHoverKey = hoverKey
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
            tiles,
          )
          const impact = abilityAimImpactKeys(
            currentCatalog,
            ability,
            heroStack.side,
            currentBattle,
            tiles,
            { q: hex.q, r: hex.r },
          )
          drawReach([], impact.length > 0 ? impact : valid)
          const onValid = valid.includes(hexKey(hex.q, hex.r))
          if (!onValid) {
            onHoverRef.current(null)
            return
          }
          onHoverRef.current({
            icon: parseTarget(currentCatalog, ability).spread === 'aoe'
              ? 'aoe'
              : 'magic',
            q: hex.q,
            r: hex.r,
            steps: [],
            attackTargetId: null,
            fire: true,
            afterMove: null,
            impactKeys: impact,
          })
          return
        }
        const stack = activeStack(currentBattle)
        if (
          !stack ||
          stack.hasActedThisRound ||
          isFeared(stack, currentCatalog) ||
          isPolymorphed(stack, currentCatalog)
        ) {
          drawReach([])
          lastHoverKey = ''
          onHoverRef.current(null)
          return
        }
        const zone = zoneAt(event, hex)
        const hoverKey = `${stack.id}:${stack.q},${stack.r}->${hex.q},${hex.r}:${zone}`
        if (hoverKey === lastHoverKey) {
          return
        }
        lastHoverKey = hoverKey
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
          tiles,
          currentCatalog,
          zone,
        )
        drawReach(
          intent ? intent.steps.map((step) => hexKey(step.q, step.r)) : [],
          intent?.impactKeys ?? [],
        )
        onHoverRef.current(intent)
      }
      const onPointerLeave = () => {
        lastHoverKey = ''
        onHoverRef.current(null)
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
            drawReach(
              [],
              abilityValidHexKeys(
                currentCatalog,
                ability,
                heroStack.side,
                currentBattle,
                tiles,
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
        onHexClickRef.current(hex.q, hex.r, zoneAt(event, hex))
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
        bridgeArtApiRef.current = null
        activeApiRef.current = null
        instance.destroy()
      }
    })()

    return () => {
      cancelled = true
      walkGenRef.current += 1
      reachApiRef.current = null
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
          <DebugCopyPanel onCopy={onCopyDebug} sections={debugSections} />
          <button
            type="button"
            onClick={() => {
              if (summary) {
                onExit()
                return
              }
              if (battle && finishCombat(battleRef.current ?? battle)) {
                return
              }
              onExit()
            }}
          >
            Exit
          </button>
        </div>
      </header>
      {heroCast?.abilityId != null ? (
        <p className="combat-hero-aim-hint">Select a target. Esc returns to abilities.</p>
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
              ? stacksBottomUp(battle.stacks, field.anchors).map((stack) => {
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
                })
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
                    </div>
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
          onClick={onExit}
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
                learned={combatDisplayLearnedIds(catalog, hero)}
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
                  setHeroCast({ stackId: stack.id, abilityId: ability.id })
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
            return (
              <StackInspectPopup
                catalog={catalog}
                stack={stack}
                onClose={() => setInspectStackId(null)}
              />
            )
          })()
        : null}
    </div>
  )
}
