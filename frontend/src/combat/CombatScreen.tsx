import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Application, Container, Graphics } from 'pixi.js'
import type { Hex } from 'honeycomb-grid'
import {
  ATTACKER_COL,
  COMBAT_COLUMNS,
  COMBAT_HEX_SIZE,
  COMBAT_ROWS,
  DEFENDER_COL,
  armySlotRow,
  combatEncounterSeed,
  createCombatHexGrid,
  hexFloorAnchor,
  neighborhoodTerrains,
  pickCombatTerrain,
} from './battlefield'
import {
  addMaskedTerrainHex,
  loadAllTerrainTextures,
  pickTerrainVariantIndex,
} from '../hex/terrainTextures'
import { TERRAIN_COLORS, TERRAIN_MOVE_COST } from '../hex/world'
import { MOVE_STEP_MS } from '../hex/hero'
import { ARMY_STACK_SLOTS, type Hero } from '../session/types'
import { getSession, subscribe } from '../session/store'
import {
  fetchCatalog,
  getCachedCatalog,
  subscribeCatalog,
  unitById,
} from '../town/catalog'
import { heroPortraitUrl, unitPortraitUrl } from '../town/slotArt'
import { formatAmount } from '../hex/resources'
import type { UnitStackView } from '../town/unitStack'
import {
  activeStack,
  advanceTurn,
  applyMove,
  createBattle,
  endStackTurn,
  moveStack,
  type BattleLog,
  type CombatBattle,
  type CombatSide,
  type CombatStack,
  type CombatTile,
} from './battle'
import {
  canCombatStep,
  combatStackCells,
  hexKey,
  movementLogLine,
  stackOccupyingHex,
} from './movement'
import { resolveAttack } from './attack'
import { combatHover, canStrikeThisTurn, type CombatHover } from './target'
import { CombatTargetIcon } from './CombatIcons'
import {
  commitCombatOutcome,
  defeatedSide,
  snapshotOpening,
  type CombatSummary,
  type OpeningStack,
} from './resolve'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

type CombatScreenProps = {
  attackerHeroId: string
  defenderHeroId: string
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
}

function HeroCard({ hero }: { hero: Hero | undefined }) {
  const [missing, setMissing] = useState(false)
  const filename = hero?.image_path ?? null
  useEffect(() => {
    setMissing(false)
  }, [filename])
  return (
    <div className="combat-hero-card">
      <div className="town-army-box town-army-portrait combat-hero-portrait">
        {!filename || missing ? (
          <span className="town-building-slot-filename">
            {filename || hero?.name || 'Hero'}
          </span>
        ) : (
          <img
            src={heroPortraitUrl(filename)}
            alt={hero?.name ?? 'Hero'}
            onError={() => setMissing(true)}
          />
        )}
      </div>
      <p className="combat-side-name">{hero?.name ?? 'Hero'}</p>
    </div>
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

function offsetColumns(byOffset: Map<string, Hex>): number[] {
  const cols = new Set<number>()
  for (const hex of byOffset.values()) {
    cols.add(hex.col)
  }
  return [...cols].sort((a, b) => a - b)
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

function stackViewFromCombat(
  stack: CombatStack,
  catalog: ReturnType<typeof getCachedCatalog>,
): UnitStackView {
  const unit = unitById(catalog, stack.unitId)
  return {
    empty: false,
    filename: unit?.image_path?.trim() || null,
    qty: stack.qty,
  }
}

export function CombatScreen({
  attackerHeroId,
  defenderHeroId,
  onExit,
}: CombatScreenProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const attacker = session.heroes.find((hero) => hero.id === attackerHeroId)
  const defender = session.heroes.find((hero) => hero.id === defenderHeroId)
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const reachApiRef = useRef<{ draw: (keys: string[]) => void } | null>(null)
  const activeApiRef = useRef<{ setKey: (key: string | null) => void } | null>(
    null,
  )
  const onHexClickRef = useRef<(q: number, r: number) => void>(() => {})
  const onHoverRef = useRef<(hover: CombatHover | null) => void>(() => {})
  const battleRef = useRef<CombatBattle | null>(null)
  const catalogRef = useRef(catalog)
  const logRef = useRef<BattleLog | null>(null)
  const summaryRef = useRef<CombatSummary | null>(null)
  const movingRef = useRef(false)
  const walkGenRef = useRef(0)
  const fieldRef = useRef<FieldView | null>(null)
  const [field, setField] = useState<FieldView | null>(null)
  const [battle, setBattle] = useState<CombatBattle | null>(null)
  const [log, setLog] = useState<BattleLog | null>(null)
  const [catalogReady, setCatalogReady] = useState(false)
  const [moving, setMoving] = useState(false)
  const [hoverTarget, setHoverTarget] = useState<CombatHover | null>(null)
  const [opening, setOpening] = useState<OpeningStack[]>([])
  const [summary, setSummary] = useState<CombatSummary | null>(null)
  const appliedRef = useRef(false)
  const openingRef = useRef<OpeningStack[]>([])
  battleRef.current = battle
  catalogRef.current = catalog
  logRef.current = log
  summaryRef.current = summary
  openingRef.current = opening
  movingRef.current = moving

  onHexClickRef.current = (q, r) => {
    if (log || moving || summary || !battle || !catalog || !field) {
      return
    }
    const stack = activeStack(battle)
    if (!stack || stack.hasActedThisRound) {
      return
    }
    const intent = combatHover(
      stack,
      { q, r },
      battle,
      field.tiles,
      catalog,
    )
    if (!intent) {
      return
    }
    if (intent.steps.length === 0 && intent.attackTargetId) {
      const resolved = resolveAttack(
        battle,
        stack.id,
        intent.attackTargetId,
        catalog,
      )
      if (!resolved) {
        return
      }
      setHoverTarget(null)
      setBattle(resolved.battle)
      setLog(resolved.log)
      return
    }
    const gen = (walkGenRef.current += 1)
    setMoving(true)
    setHoverTarget(null)
    reachApiRef.current?.draw([])
    void (async () => {
      let latest = battle
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
      if (intent.attackTargetId) {
        const resolved = resolveAttack(
          latest,
          stack.id,
          intent.attackTargetId,
          catalog,
        )
        if (resolved) {
          const lines = [
            ...(intent.steps.length > 0
              ? [movementLogLine(stack, catalog, intent.steps.length)]
              : []),
            ...resolved.log.lines,
          ]
          setBattle(resolved.battle)
          setLog({ lines })
        } else {
          setBattle(endStackTurn(latest, stack.id))
          setLog({
            lines: [movementLogLine(stack, catalog, intent.steps.length)],
          })
        }
      } else {
        setBattle(endStackTurn(latest, stack.id))
        setLog({
          lines: [movementLogLine(stack, catalog, intent.steps.length)],
        })
      }
      setMoving(false)
    })()
  }

  const finishCombat = (current: CombatBattle) => {
    if (appliedRef.current || !catalog) {
      return false
    }
    const result = commitCombatOutcome(
      catalog,
      attackerHeroId,
      defenderHeroId,
      current,
      openingRef.current,
    )
    if (!result) {
      return false
    }
    appliedRef.current = true
    setHoverTarget(null)
    setLog(null)
    setSummary(result)
    return true
  }

  onHoverRef.current = (hover) => {
    setHoverTarget(hover)
  }

  useEffect(() => {
    void fetchCatalog()
      .catch(() => {})
      .finally(() => setCatalogReady(true))
  }, [])

  useEffect(() => {
    if (log || summary) {
      reachApiRef.current?.draw([])
    }
  }, [log, summary])

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
    )
    const snap = snapshotOpening(created.stacks)
    setBattle(created)
    setOpening(snap)
    openingRef.current = snap
    setLog(null)
    setSummary(null)
    appliedRef.current = false
  }, [field, catalog, catalogReady, attackerHeroId, defenderHeroId])

  useEffect(() => {
    if (!battle || !catalog || !field || log || moving || summary) {
      return
    }
    if (defeatedSide(battle)) {
      return
    }
    const stack = activeStack(battle)
    if (!stack || stack.hasActedThisRound) {
      return
    }
    const speed = unitById(catalog, stack.unitId)?.speed ?? 0
    const canMove = speed > 0 && canCombatStep(stack, battle, field.tiles, catalog)
    if (canMove || canStrikeThisTurn(stack, battle, field.tiles, catalog)) {
      return
    }
    setBattle(applyMove(battle, stack.id, stack.q, stack.r))
    setLog({ lines: [movementLogLine(stack, catalog, 0)] })
  }, [battle, catalog, field, log, moving, summary])

  useEffect(() => {
    const canvasHost = canvasHostRef.current
    const current = getSession()
    const att = current.heroes.find((hero) => hero.id === attackerHeroId)
    const def = current.heroes.find((hero) => hero.id === defenderHeroId)
    if (!canvasHost || !att || !def) {
      return
    }
    let cancelled = false
    let app: Application | undefined
    const attackerPos = { ...att.position }
    const defenderPos = { ...def.position }
    const pool = neighborhoodTerrains(attackerPos, defenderPos)
    const seed = combatEncounterSeed(current.game.seed, attackerPos, defenderPos)
    const { grid, layout } = createCombatHexGrid(
      COMBAT_COLUMNS,
      COMBAT_ROWS,
      COMBAT_HEX_SIZE,
    )
    const hexPx = Math.max(16, Math.round(grid.hexPrototype.width))
    const byOffset = hexByOffset(grid)
    const cols = offsetColumns(byOffset)
    const attackerCol = cols[1] ?? ATTACKER_COL
    const defenderCol = cols[cols.length - 2] ?? DEFENDER_COL
    const markers = [
      ...markersForColumn(byOffset, attackerCol, layout.offsetX, layout.offsetY, 'atk'),
      ...markersForColumn(byOffset, defenderCol, layout.offsetX, layout.offsetY, 'def'),
    ]

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
      const texturesByTerrain = await loadAllTerrainTextures()
      if (cancelled) {
        instance.destroy()
        return
      }
      const fills = new Graphics()
      const strokes = new Graphics()
      const reach = new Graphics()
      const activeMark = new Graphics()
      const terrainLayer = new Container()
      const { offsetX, offsetY } = layout
      const tiles: CombatTile[] = []
      const anchors: HexAnchor[] = []
      const hexByKey = new Map<string, Hex>()
      grid.forEach((hex) => {
        const terrain = pickCombatTerrain(pool, seed, hex.q, hex.r)
        tiles.push({
          q: hex.q,
          r: hex.r,
          terrain,
          movementCostMultiplier: TERRAIN_MOVE_COST[terrain],
        })
        const floor = hexFloorAnchor(hex, offsetX, offsetY)
        anchors.push({ q: hex.q, r: hex.r, x: floor.x, y: floor.y })
        hexByKey.set(hexKey(hex.q, hex.r), hex)
        const poly = hex.corners.map((corner) => ({
          x: corner.x + offsetX,
          y: corner.y + offsetY,
        }))
        fills.poly(poly)
        fills.fill({ color: TERRAIN_COLORS[terrain] })
        const variants = texturesByTerrain.get(terrain)
        if (variants && variants.length > 0) {
          const variant = pickTerrainVariantIndex(seed, hex.q, hex.r, variants)
          addMaskedTerrainHex(
            terrainLayer,
            hex,
            offsetX,
            offsetY,
            variants[variant].texture,
          )
        }
        strokes.poly(poly)
        strokes.stroke({ width: 2, color: 0x111111 })
      })
      const world = new Container()
      world.addChild(fills, terrainLayer, strokes, reach, activeMark)
      instance.stage.addChild(world)

      const drawReach = (keys: string[]) => {
        reach.clear()
        for (const key of keys) {
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
        const stack = activeStack(currentBattle)
        if (!stack || stack.hasActedThisRound) {
          drawReach([])
          lastHoverKey = ''
          onHoverRef.current(null)
          return
        }
        const hoverKey = `${stack.id}:${stack.q},${stack.r}->${hex.q},${hex.r}`
        if (hoverKey === lastHoverKey) {
          return
        }
        lastHoverKey = hoverKey
        const intent = combatHover(
          stack,
          { q: hex.q, r: hex.r },
          currentBattle,
          tiles,
          currentCatalog,
        )
        drawReach(intent ? intent.steps.map((step) => hexKey(step.q, step.r)) : [])
        onHoverRef.current(intent)
      }
      const onPointerLeave = () => {
        lastHoverKey = ''
        drawReach([])
        onHoverRef.current(null)
      }
      const onPointerDown = (event: PointerEvent) => {
        const hex = hexFromPointer(event)
        if (!hex) {
          return
        }
        onHexClickRef.current(hex.q, hex.r)
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
      })

      if (cancelled) {
        canvas.removeEventListener('pointermove', onPointerMove)
        canvas.removeEventListener('pointerleave', onPointerLeave)
        canvas.removeEventListener('pointerdown', onPointerDown)
        instance.ticker.remove(pulseActive)
        reachApiRef.current = null
        activeApiRef.current = null
        instance.destroy()
      }
    })()

    return () => {
      cancelled = true
      walkGenRef.current += 1
      reachApiRef.current = null
      activeApiRef.current = null
      fieldRef.current = null
      app?.destroy()
    }
  }, [attackerHeroId, defenderHeroId])

  return (
    <div
      className="town-management combat-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="combat-screen-title"
    >
      <header className="town-management-bar">
        <h1 id="combat-screen-title">Combat</h1>
        <button
          type="button"
          onClick={() => {
            if (summary) {
              onExit()
              return
            }
            if (battle && finishCombat(battle)) {
              return
            }
            onExit()
          }}
        >
          Exit
        </button>
      </header>
      <div className="combat-body">
        <div
          className="combat-field"
          style={field ? { width: field.width } : undefined}
          aria-label={`Battlefield ${COMBAT_COLUMNS} by ${COMBAT_ROWS}`}
        >
          <div className="combat-heroes">
            <HeroCard hero={attacker} />
            <HeroCard hero={defender} />
          </div>
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
              ? battle.stacks.map((stack) => {
                  const pos = anchorAt(field.anchors, stack.q, stack.r)
                  if (!pos) {
                    return null
                  }
                  const view = stackViewFromCombat(stack, catalog)
                  const cells = catalog
                    ? combatStackCells(stack, catalog)
                    : 1
                  const width = field.hexPx * cells
                  const height = field.hexPx
                  const left =
                    cells === 2 && stack.side === 'def'
                      ? pos.x + field.hexPx / 2 - width
                      : pos.x - width / 2
                  const current = activeStack(battle)
                  const speed = unitById(catalog, stack.unitId)?.speed ?? 0
                  return (
                    <div
                      key={stack.id}
                      className="combat-stack combat-stack-on-hex"
                      data-combat-stack={stack.id}
                      data-slot={stack.slot + 1}
                      data-speed={speed}
                      data-acted={stack.hasActedThisRound ? 'true' : 'false'}
                      data-active={current?.id === stack.id ? 'true' : 'false'}
                      data-top-health={stack.topHealth}
                      style={{
                        width,
                        height,
                        left,
                        top: pos.y - height,
                      }}
                    >
                      <CombatStackArt view={view} />
                      <span className="combat-stack-qty">{formatAmount(view.qty)}</span>
                    </div>
                  )
                })
              : null}
            {field && hoverTarget && !log && !summary
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
                  const cells =
                    occupant && catalog
                      ? combatStackCells(occupant, catalog)
                      : 1
                  const width = field.hexPx * cells
                  const height = field.hexPx
                  const left =
                    cells === 2 && occupant?.side === 'def'
                      ? pos.x + field.hexPx / 2 - width
                      : pos.x - width / 2
                  return (
                    <div
                      className="combat-target-icon"
                      style={{
                        width,
                        height,
                        left,
                        top: pos.y - height,
                      }}
                    >
                      <CombatTargetIcon kind={hoverTarget.icon} />
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
          onClick={() => {
            if (!battle || !catalog) {
              setLog(null)
              return
            }
            if (finishCombat(battle)) {
              return
            }
            setLog(null)
            setBattle(advanceTurn(battle, catalog))
          }}
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
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
