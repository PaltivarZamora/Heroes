import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  formatAmount,
  formatResourceLine,
  RESOURCES,
  type ResourceWallet,
} from '../hex/resources'
import {
  armyBuildOptions,
  buildingById,
  buildingGrowth,
  constructionCost,
  destroyCostOf,
  hasPrerequisite,
  effectLine,
  fetchCatalog,
  formatCost,
  genericRoot,
  genericSlotBuildings,
  getCachedCatalog,
  heroTypeName,
  isArmySlot,
  isEmptyPlaceholderSlot,
  isLibraryBuilding,
  isMarketplaceSlot,
  isTavernBuilding,
  isUndesignedSlot,
  maxAffordableQty,
  missingArmyPrerequisiteLine,
  missingGenericPrerequisiteLine,
  nextInChain,
  scaleCost,
  subscribeCatalog,
  townLayoutError,
  townLayoutFor,
  townLayoutSlotStyle,
  unitCost,
  unitForBuilding,
  type BuildingRow,
  type HeroPoolRow,
  type ReferenceCatalog,
} from './catalog'
import {
  emptySlotArtFilename,
  GARRISON_ART_FILENAME,
  GENERIC_EMPTY_ART_FILENAME,
  heroPortraitUrl,
  slotArtFilename,
  slotArtUrl,
} from './slotArt'
import { Marketplace } from './Marketplace'
import { Library } from './Library'
import { getSession, subscribe, updateSession } from '../session/store'
import { NECROPOLIS_TOWN_TYPE_ID, type GameSession } from '../session/types'
import {
  assignHeroesFromPool,
  dropHeldArmyStack,
  findTownById,
  hireHeroFromPool,
  HIRE_HERO_GOLD_COST,
  ensureLibraryOffers,
  patchBuildingSlot,
  placeArmyStack,
  recruitToGarrison,
  returnHeldArmyStack,
  slotStatesForTown,
  spendResources,
  splitArmyStack,
  unusedHeroPool,
  visitingHeroId,
  type ArmyRowId,
  type ArmySlotRef,
} from '../session/accessors'
import type { SlotState } from './townSlots'
import { stackView, UnitStackFace, type UnitStackView } from './unitStack'
import { ReservedCorner } from './ReservedCorner'

function panelAnchorFromClick(
  event: ReactMouseEvent<HTMLButtonElement>,
  root: HTMLElement | null,
): { left: number; top: number } | null {
  if (!root) {
    return null
  }
  const box = root.getBoundingClientRect()
  const width = Math.min(520, box.width * 0.42)
  const gap = 8
  let left = event.clientX - box.left
  let top = event.clientY - box.top
  if (left + width > box.width - gap) {
    left = Math.max(gap, box.width - width - gap)
  }
  if (left < gap) {
    left = gap
  }
  if (top > box.height - 180) {
    top = Math.max(gap, box.height - 180)
  }
  if (top < gap) {
    top = gap
  }
  return { left, top }
}

type TownManagementProps = {
  townId: string
  townName: string
  wallet: ResourceWallet
  onExit: () => void
  calendarLabel: string
  hasActedToday: boolean
  onActed: () => void
  visitingHeroName: string
  selectedHeroId?: string | null
  onOpenHero?: (heroId?: string | null) => void
  onCycleTown?: () => void
}

function SlotArt({
  filename,
  unbuilt,
}: {
  filename: string
  unbuilt?: boolean
}) {
  const [missing, setMissing] = useState(false)
  const [generic, setGeneric] = useState(false)
  useEffect(() => {
    setMissing(false)
    setGeneric(false)
  }, [filename])
  if (missing) {
    return <span className="town-building-slot-filename">{filename}</span>
  }
  const src = slotArtUrl(
    unbuilt && generic ? GENERIC_EMPTY_ART_FILENAME : filename,
  )
  return (
    <img
      src={src}
      alt=""
      onError={() => {
        if (unbuilt && !generic) {
          setGeneric(true)
          return
        }
        setMissing(true)
      }}
    />
  )
}

function PortraitFace({
  label,
  filename,
}: {
  label: string
  filename: string | null
}) {
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    setMissing(false)
  }, [filename])
  if (!filename) {
    return label
  }
  if (missing) {
    return <span className="town-building-slot-filename">{filename}</span>
  }
  return (
    <img
      src={heroPortraitUrl(filename)}
      alt={label}
      onError={() => setMissing(true)}
    />
  )
}

export function TownManagement({
  townId,
  townName,
  wallet,
  onExit,
  calendarLabel,
  hasActedToday,
  onActed,
  visitingHeroName,
  selectedHeroId = null,
  onOpenHero,
  onCycleTown,
}: TownManagementProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const slots = slotStatesForTown(session, townId)
  const rootRef = useRef<HTMLDivElement>(null)
  const [openSlot, setOpenSlot] = useState<number | null>(null)
  const [panelAnchor, setPanelAnchor] = useState<{ left: number; top: number } | null>(
    null,
  )
  const [marketOpen, setMarketOpen] = useState(false)
  const [librarySlot, setLibrarySlot] = useState<number | null>(null)
  const [scrollsOpen, setScrollsOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const townTypeId =
    findTownById(session, townId)?.town_type_id ?? NECROPOLIS_TOWN_TYPE_ID
  const layoutRows = catalog ? townLayoutFor(catalog, townTypeId) : []
  const layoutError = catalog ? townLayoutError(catalog, townTypeId) : null

  useEffect(() => {
    setOpenSlot(null)
    setPanelAnchor(null)
    setMarketOpen(false)
    setLibrarySlot(null)
    setScrollsOpen(false)
    setMessage(null)
  }, [townId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat) {
        return
      }
      event.preventDefault()
      if (librarySlot != null) {
        setLibrarySlot(null)
        return
      }
      if (marketOpen) {
        setMarketOpen(false)
        return
      }
      if (scrollsOpen) {
        setScrollsOpen(false)
        return
      }
      if (openSlot != null) {
        setOpenSlot(null)
        setPanelAnchor(null)
        setMessage(null)
        return
      }
      onExit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [librarySlot, marketOpen, onExit, openSlot, scrollsOpen])

  useEffect(() => {
    if (getCachedCatalog()) {
      return
    }
    let cancelled = false
    void fetchCatalog()
      .then((data) => {
        if (!cancelled) {
          updateSession((current) =>
            assignHeroesFromPool(current, data.hero_pool),
          )
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setCatalogError(
            error instanceof Error ? error.message : 'catalog request failed',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const writeSlot = (
    id: number,
    next: SlotState,
    cost: Record<number, number>,
  ): boolean => {
    let error: string | null = null
    updateSession((current) => {
      const town = findTownById(current, townId)
      if (!town) {
        error = 'This town is not in the game session.'
        return current
      }
      const spent = spendResources(current, cost)
      if (spent.error) {
        error = spent.error
        return current
      }
      return patchBuildingSlot(spent.session, town.id, id - 1, next)
    })
    if (error) {
      setMessage(error)
      return false
    }
    setMessage(null)
    return true
  }

  const builtBuildingIds = new Set(
    session.building_states
      .filter(
        (row) =>
          row.town_id === townId &&
          row.level >= 1 &&
          row.building_id != null,
      )
      .map((row) => row.building_id as number),
  )

  const build = (id: number, building: BuildingRow) => {
    if (hasActedToday || !catalog) {
      return
    }
    if (!hasPrerequisite(building, builtBuildingIds)) {
      setMessage('Requires the prerequisite building in this town.')
      return
    }
    if (
      !writeSlot(
        id,
        {
          level: 1,
          buildingId: building.id,
          recruitQty: buildingGrowth(building),
        },
        constructionCost(catalog, building),
      )
    ) {
      return
    }
    onActed()
    if (catalog && isLibraryBuilding(building)) {
      updateSession((current) =>
        ensureLibraryOffers(current, catalog, townId, townTypeId, id),
      )
    }
  }

  const upgrade = (id: number, next: BuildingRow) => {
    const current = slots[id - 1]
    if (!current || hasActedToday || !catalog) {
      return
    }
    if (!hasPrerequisite(next, builtBuildingIds)) {
      setMessage('Requires the prerequisite building in this town.')
      return
    }
    if (
      !writeSlot(
        id,
        {
          level: current.level + 1,
          buildingId: next.id,
          recruitQty: current.recruitQty,
        },
        constructionCost(catalog, next),
      )
    ) {
      return
    }
    onActed()
    if (isLibraryBuilding(next)) {
      updateSession((current) =>
        ensureLibraryOffers(current, catalog, townId, townTypeId, id),
      )
    }
  }

  const destroy = (id: number, current: BuildingRow) => {
    if (hasActedToday) {
      return
    }
    if (!writeSlot(id, { level: 0, buildingId: null, recruitQty: 0 }, destroyCostOf(current))) {
      return
    }
    onActed()
  }

  const recruit = (id: number, qty: number): boolean => {
    if (!catalog) {
      return false
    }
    let error: string | null = null
    updateSession((current) => {
      const result = recruitToGarrison(current, townId, id, qty, catalog)
      error = result.error
      return result.error ? current : result.session
    })
    if (error) {
      setMessage(error)
      return false
    }
    setMessage(null)
    return true
  }

  const hireHero = (pick: HeroPoolRow): boolean => {
    let error: string | null = null
    updateSession((current) => {
      const result = hireHeroFromPool(current, townId, pick)
      error = result.error
      return result.error ? current : result.session
    })
    if (error) {
      setMessage(error)
      return false
    }
    setMessage(null)
    return true
  }

  const slotState = openSlot != null ? slots[openSlot - 1] : null

  return (
    <div
      ref={rootRef}
      className="town-management"
      role="dialog"
      aria-modal="true"
      aria-labelledby="town-management-title"
    >
      <img
        className="town-management-skyline"
        src="/assets/towns/Necropolis_Skyline.png"
        alt=""
      />
      <header className="town-management-bar">
        <h1 id="town-management-title">{townName}</h1>
        <p className="town-calendar">{calendarLabel}</p>
        <p className="town-resource-strip">
          {RESOURCES.map((resource) => (
            <span key={resource.id}>
              {formatResourceLine(resource, wallet[resource.id])}
            </span>
          ))}
        </p>
        <button type="button" onClick={onExit}>
          Exit Town
        </button>
      </header>
      <div className="town-building-grid">
        {!catalog ? (
          <p className="town-building-layout-error">Loading buildings…</p>
        ) : layoutError ? (
          <p className="town-building-layout-error">{layoutError}</p>
        ) : (
          layoutRows.map((layout) => {
            const id = layout.slot
            const state = slots[id - 1] ?? {
              level: 0,
              buildingId: null,
              recruitQty: 0,
            }
            const building = catalog
              ? buildingById(catalog, state.buildingId)
              : null
            const emptyPlaceholder = catalog
              ? isEmptyPlaceholderSlot(catalog, id, townTypeId)
              : false
            const unbuilt = state.level <= 0
            const filename = unbuilt
              ? emptySlotArtFilename(id)
              : slotArtFilename(id, state.level, building?.image_path ?? null)
            return (
              <button
                key={id}
                type="button"
                className={
                  emptyPlaceholder && state.level <= 0
                    ? 'town-building-slot town-building-slot-empty'
                    : 'town-building-slot'
                }
                style={townLayoutSlotStyle(layout, layoutRows)}
                aria-label={`Slot ${id}`}
                onClick={(event) => {
                  setOpenSlot(id)
                  setPanelAnchor(panelAnchorFromClick(event, rootRef.current))
                  setMessage(null)
                }}
              >
                {emptyPlaceholder && state.level <= 0 ? null : (
                  <SlotArt filename={filename} unbuilt={unbuilt} />
                )}
              </button>
            )
          })
        )}
      </div>
      <div className="town-bottom-dock">
        <ReservedCorner
          onHero={() => onOpenHero?.(selectedHeroId)}
          onTown={() => onCycleTown?.()}
          onScrolls={() => setScrollsOpen(true)}
        />
        <ArmyRows
          session={session}
          townId={townId}
          catalog={catalog}
          visitingHeroName={visitingHeroName}
          selectedHeroId={selectedHeroId}
          onOpenHero={onOpenHero}
        />
      </div>
      {openSlot != null && slotState ? (
        <BuildingPanel
          slotId={openSlot}
          slotState={slotState}
          catalog={catalog}
          catalogError={catalogError}
          message={message}
          hasActedToday={hasActedToday}
          townTypeId={townTypeId}
          anchor={panelAnchor}
          onClose={() => {
            setOpenSlot(null)
            setPanelAnchor(null)
            setMessage(null)
          }}
          onBuild={(building) => build(openSlot, building)}
          onUpgrade={(next) => upgrade(openSlot, next)}
          onDestroy={(building) => destroy(openSlot, building)}
          onRecruit={(qty) => recruit(openSlot, qty)}
          garrisonOccupied={Boolean(
            (() => {
              const town = findTownById(session, townId)
              return town ? visitingHeroId(session, town) : null
            })(),
          )}
          hireCandidates={
            catalog ? unusedHeroPool(session, catalog.hero_pool) : []
          }
          onHire={(pick) => hireHero(pick)}
          wallet={wallet}
          builtBuildingIds={builtBuildingIds}
          onOpenMarket={() => {
            setOpenSlot(null)
            setPanelAnchor(null)
            setMarketOpen(true)
          }}
          onOpenLibrary={() => {
            if (openSlot != null) {
              const slot = openSlot
              setOpenSlot(null)
              setPanelAnchor(null)
              setLibrarySlot(slot)
            }
          }}
        />
      ) : null}
      {marketOpen ? (
        <Marketplace onClose={() => setMarketOpen(false)} />
      ) : null}
      {librarySlot != null ? (
        <Library
          townId={townId}
          slotNum={librarySlot}
          onClose={() => setLibrarySlot(null)}
        />
      ) : null}
      {scrollsOpen ? (
        <div
          className="town-management marketplace-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="scrolls-title"
        >
          <header className="town-management-bar">
            <h1 id="scrolls-title">Scrolls</h1>
            <button type="button" onClick={() => setScrollsOpen(false)}>
              Close
            </button>
          </header>
        </div>
      ) : null}
    </div>
  )
}

function stackLabel(
  session: GameSession,
  stackId: string | null | undefined,
  catalog: ReferenceCatalog | null,
): string {
  if (!stackId) {
    return 'Empty'
  }
  const stack = session.units.find((row) => row.id === stackId)
  if (!stack) {
    return 'Empty'
  }
  const unit = catalog?.unit.find((row) => row.id === stack.unit_id)
  return `${unit?.name ?? 'Unknown'} - ${formatAmount(stack.qty)}`
}

function rowSlotIds(
  session: GameSession,
  townId: string,
  row: ArmyRowId,
  preferredHeroId?: string | null,
): Array<string | null> {
  const town = findTownById(session, townId)
  if (!town) {
    return [null, null, null, null, null, null]
  }
  if (row === 'garrison') {
    const slots = town.garrison.slots_1_to_6
    return [0, 1, 2, 3, 4, 5].map((index) => slots[index] ?? null)
  }
  const heroId = visitingHeroId(session, town, preferredHeroId)
  const hero = heroId
    ? session.heroes.find((item) => item.id === heroId)
    : null
  const slots = hero?.army.slots_1_to_6 ?? []
  return [0, 1, 2, 3, 4, 5].map((index) => slots[index] ?? null)
}

function rowStacks(
  session: GameSession,
  townId: string,
  row: ArmyRowId,
  catalog: ReferenceCatalog | null,
  preferredHeroId?: string | null,
): UnitStackView[] {
  return rowSlotIds(session, townId, row, preferredHeroId).map((id) =>
    stackView(session, id, catalog),
  )
}

function stackAt(
  session: GameSession,
  townId: string,
  ref: ArmySlotRef,
) {
  const id = rowSlotIds(session, townId, ref.row)[ref.slot - 1]
  return id ? session.units.find((row) => row.id === id) ?? null : null
}

function slotFromPoint(x: number, y: number): ArmySlotRef | 'portrait' | null {
  const el = document.elementFromPoint(x, y)
  if (!(el instanceof Element)) {
    return null
  }
  if (el.closest('[data-portrait]')) {
    return 'portrait'
  }
  const slotEl = el.closest('[data-row][data-slot]')
  if (!(slotEl instanceof HTMLElement)) {
    return null
  }
  const row = slotEl.dataset.row
  const slot = Number(slotEl.dataset.slot)
  if ((row !== 'garrison' && row !== 'hero') || !Number.isInteger(slot)) {
    return null
  }
  return { row, slot }
}

function ArmyRows({
  session,
  townId,
  catalog,
  visitingHeroName,
  selectedHeroId = null,
  onOpenHero,
}: {
  session: GameSession
  townId: string
  catalog: ReferenceCatalog | null
  visitingHeroName: string
  selectedHeroId?: string | null
  onOpenHero?: (heroId?: string | null) => void
}) {
  const town = findTownById(session, townId)
  const visitingId = town
    ? visitingHeroId(session, town, selectedHeroId)
    : null
  const visiting = visitingId
    ? session.heroes.find((row) => row.id === visitingId) ?? null
    : null
  const [menu, setMenu] = useState<{
    slot: ArmySlotRef
    x: number
    y: number
  } | null>(null)
  const [splitSlot, setSplitSlot] = useState<ArmySlotRef | null>(null)
  const [splitText, setSplitText] = useState('1')
  const [held, setHeld] = useState<{
    stackId: string
    origin: ArmySlotRef
  } | null>(null)
  const [dragging, setDragging] = useState<ArmySlotRef | null>(null)
  const [ghost, setGhost] = useState<{
    x: number
    y: number
    text: string
  } | null>(null)
  const [armyMessage, setArmyMessage] = useState<string | null>(null)
  const heldRef = useRef(held)
  const draggingRef = useRef(dragging)
  heldRef.current = held
  draggingRef.current = dragging

  const cancelHeld = (notice: string | null) => {
    const current = heldRef.current
    if (!current) {
      return
    }
    updateSession((currentSession) =>
      returnHeldArmyStack(
        currentSession,
        townId,
        current.stackId,
        current.origin,
      ),
    )
    heldRef.current = null
    setHeld(null)
    setGhost(null)
    setArmyMessage(notice)
  }

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const currentHeld = heldRef.current
      const currentDrag = draggingRef.current
      if (!currentHeld && !currentDrag) {
        return
      }
      const text = currentHeld
        ? stackLabel(getSession(), currentHeld.stackId, catalog)
        : currentDrag
          ? stackLabel(
              getSession(),
              rowSlotIds(getSession(), townId, currentDrag.row)[
                currentDrag.slot - 1
              ],
              catalog,
            )
          : ''
      setGhost({ x: event.clientX, y: event.clientY, text })
    }
    const onUp = (event: PointerEvent) => {
      const target = slotFromPoint(event.clientX, event.clientY)
      const currentHeld = heldRef.current
      const currentDrag = draggingRef.current
      if (currentHeld) {
        if (!target || target === 'portrait') {
          cancelHeld(
            target === 'portrait'
              ? "Can't drop on the portrait."
              : 'Split stack returned to its origin.',
          )
          return
        }
        let error: string | null = null
        updateSession((currentSession) => {
          const result = dropHeldArmyStack(
            currentSession,
            townId,
            currentHeld.stackId,
            currentHeld.origin,
            target,
          )
          if (result.error) {
            error = result.error
            return returnHeldArmyStack(
              currentSession,
              townId,
              currentHeld.stackId,
              currentHeld.origin,
            )
          }
          return result.session
        })
        heldRef.current = null
        setHeld(null)
        setGhost(null)
        setArmyMessage(error)
        return
      }
      if (!currentDrag) {
        return
      }
      if (target && target !== 'portrait') {
        let error: string | null = null
        updateSession((currentSession) => {
          const result = placeArmyStack(
            currentSession,
            townId,
            currentDrag,
            target,
          )
          error = result.error
          return result.error ? currentSession : result.session
        })
        setArmyMessage(error)
      } else if (target === 'portrait') {
        setArmyMessage("Can't drop on the portrait.")
      }
      draggingRef.current = null
      setDragging(null)
      setGhost(null)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      const busy =
        heldRef.current != null ||
        draggingRef.current != null ||
        menu != null ||
        splitSlot != null
      if (!busy) {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      if (heldRef.current) {
        cancelHeld('Split stack returned to its origin.')
      }
      draggingRef.current = null
      setDragging(null)
      setGhost(null)
      setMenu(null)
      setSplitSlot(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [catalog, menu, splitSlot, townId])

  useEffect(() => {
    return () => {
      const current = heldRef.current
      if (current) {
        updateSession((currentSession) =>
          returnHeldArmyStack(
            currentSession,
            townId,
            current.stackId,
            current.origin,
          ),
        )
      }
    }
  }, [townId])

  const confirmSplit = () => {
    if (!splitSlot) {
      return
    }
    const qty = Number.parseInt(splitText, 10)
    let error: string | null = null
    let heldStackId: string | null = null
    updateSession((currentSession) => {
      const result = splitArmyStack(currentSession, townId, splitSlot, qty)
      error = result.error
      heldStackId = result.heldStackId
      return result.error ? currentSession : result.session
    })
    if (error || !heldStackId) {
      setArmyMessage(error)
      return
    }
    const nextHeld = { stackId: heldStackId, origin: splitSlot }
    heldRef.current = nextHeld
    setHeld(nextHeld)
    setSplitSlot(null)
    setMenu(null)
    setArmyMessage('Drop the split stack on a slot (Esc cancels).')
  }

  return (
    <div className="town-army-rows">
      <ArmyRow
        row="garrison"
        portraitLabel="Garrison"
        portraitFilename={GARRISON_ART_FILENAME}
        armyStacks={rowStacks(session, townId, 'garrison', catalog)}
        onSlotPointerDown={(slot, event) => {
          if (event.button !== 0 || held) {
            return
          }
          const ref: ArmySlotRef = { row: 'garrison', slot }
          if (!stackAt(session, townId, ref)) {
            return
          }
          event.preventDefault()
          draggingRef.current = ref
          setDragging(ref)
          setMenu(null)
          setArmyMessage(null)
        }}
        onSlotContextMenu={(slot, event) => {
          const ref: ArmySlotRef = { row: 'garrison', slot }
          if (held || !stackAt(session, townId, ref)) {
            return
          }
          event.preventDefault()
          setMenu({ slot: ref, x: event.clientX, y: event.clientY })
          setSplitSlot(null)
        }}
      />
      <ArmyRow
        row="hero"
        portraitLabel={visiting?.name ?? (visitingId ? visitingHeroName : 'None')}
        portraitFilename={visiting?.image_path ?? null}
        armyStacks={rowStacks(session, townId, 'hero', catalog, selectedHeroId)}
        onPortraitClick={
          visitingId && !held
            ? () => onOpenHero?.(visitingId)
            : undefined
        }
        onSlotPointerDown={(slot, event) => {
          if (event.button !== 0 || held) {
            return
          }
          const ref: ArmySlotRef = { row: 'hero', slot }
          if (!stackAt(session, townId, ref)) {
            return
          }
          event.preventDefault()
          draggingRef.current = ref
          setDragging(ref)
          setMenu(null)
          setArmyMessage(null)
        }}
        onSlotContextMenu={(slot, event) => {
          const ref: ArmySlotRef = { row: 'hero', slot }
          if (held || !stackAt(session, townId, ref)) {
            return
          }
          event.preventDefault()
          setMenu({ slot: ref, x: event.clientX, y: event.clientY })
          setSplitSlot(null)
        }}
      />
      {armyMessage ? (
        <p className="town-army-message">{armyMessage}</p>
      ) : null}
      {held ? (
        <p className="town-army-message">
          Holding {stackLabel(session, held.stackId, catalog)}
        </p>
      ) : null}
      {menu ? (
        <div
          className="town-army-menu"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            type="button"
            onClick={() => {
              setSplitSlot(menu.slot)
              setSplitText('1')
              setMenu(null)
            }}
          >
            Split
          </button>
        </div>
      ) : null}
      {splitSlot ? (
        <div className="town-army-split">
          <label className="town-recruit-qty">
            Split quantity
            <input
              type="number"
              min={1}
              max={Math.max(1, (stackAt(session, townId, splitSlot)?.qty ?? 1) - 1)}
              value={splitText}
              onChange={(event) => setSplitText(event.target.value)}
            />
          </label>
          <div className="town-recruit-actions">
            <button type="button" onClick={confirmSplit}>
              Confirm
            </button>
            <button type="button" onClick={() => setSplitSlot(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {ghost ? (
        <div
          className="town-army-ghost"
          style={{ left: ghost.x + 12, top: ghost.y + 12 }}
        >
          {ghost.text}
        </div>
      ) : null}
    </div>
  )
}

function ArmyRow({
  row,
  portraitLabel,
  portraitFilename,
  armyStacks,
  onSlotPointerDown,
  onSlotContextMenu,
  onPortraitClick,
}: {
  row: ArmyRowId
  portraitLabel: string
  portraitFilename: string | null
  armyStacks: UnitStackView[]
  onSlotPointerDown: (slot: number, event: ReactPointerEvent) => void
  onSlotContextMenu: (slot: number, event: ReactMouseEvent) => void
  onPortraitClick?: () => void
}) {
  const portrait = (
    <>
      <PortraitFace label={portraitLabel} filename={portraitFilename} />
    </>
  )
  return (
    <div className="town-army-row">
      {onPortraitClick ? (
        <button
          type="button"
          className="town-army-box town-army-portrait"
          data-portrait={row}
          aria-label={portraitLabel}
          onClick={onPortraitClick}
        >
          {portrait}
        </button>
      ) : (
        <div
          className="town-army-box town-army-portrait"
          data-portrait={row}
          aria-label={portraitLabel}
        >
          {portrait}
        </div>
      )}
      {armyStacks.map((stack, index) => (
        <button
          key={index}
          type="button"
          className="town-army-box town-army-slot"
          data-row={row}
          data-slot={index + 1}
          onPointerDown={(event) => onSlotPointerDown(index + 1, event)}
          onContextMenu={(event) => onSlotContextMenu(index + 1, event)}
        >
          <UnitStackFace {...stack} />
        </button>
      ))}
    </div>
  )
}

function BuildingPanel({
  slotId,
  slotState,
  catalog,
  catalogError,
  message,
  hasActedToday,
  townTypeId,
  wallet,
  anchor,
  onClose,
  onBuild,
  onUpgrade,
  onDestroy,
  onRecruit,
  garrisonOccupied,
  hireCandidates,
  onHire,
  builtBuildingIds,
  onOpenMarket,
  onOpenLibrary,
}: {
  slotId: number
  slotState: SlotState
  catalog: ReferenceCatalog | null
  catalogError: string | null
  message: string | null
  hasActedToday: boolean
  townTypeId: number
  wallet: ResourceWallet
  anchor: { left: number; top: number } | null
  onClose: () => void
  onBuild: (building: BuildingRow) => void
  onUpgrade: (next: BuildingRow) => void
  onDestroy: (building: BuildingRow) => void
  onRecruit: (qty: number) => boolean
  garrisonOccupied: boolean
  hireCandidates: HeroPoolRow[]
  onHire: (pick: HeroPoolRow) => boolean
  builtBuildingIds: ReadonlySet<number>
  onOpenMarket: () => void
  onOpenLibrary: () => void
}) {
  const army = isArmySlot(slotId)
  const current =
    catalog != null ? buildingById(catalog, slotState.buildingId) : null
  const nextCandidate =
    catalog != null && current != null
      ? nextInChain(current, catalog, slotId, townTypeId)
      : null
  const next =
    nextCandidate && hasPrerequisite(nextCandidate, builtBuildingIds)
      ? nextCandidate
      : null

  return (
    <div
      className="town-building-panel"
      style={
        anchor
          ? { left: anchor.left, top: anchor.top, bottom: 'auto' }
          : undefined
      }
    >
      <div className="town-building-panel-header">
        <h2>Slot {slotId}</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {catalogError ? (
        <p className="town-building-panel-msg">{catalogError}</p>
      ) : null}
      {!catalog ? (
        <p>Loading buildings…</p>
      ) : isUndesignedSlot(catalog, slotId, townTypeId) ? (
        <p>Not yet designed</p>
      ) : isEmptyPlaceholderSlot(catalog, slotId, townTypeId) ? (
        <p>Nothing built here yet.</p>
      ) : slotState.level === 0 ? (
        <EmptySlotActions
          slotId={slotId}
          army={army}
          catalog={catalog}
          hasActedToday={hasActedToday}
          townTypeId={townTypeId}
          builtBuildingIds={builtBuildingIds}
          onBuild={onBuild}
        />
      ) : current && isLibraryBuilding(current) ? (
        <LibraryFilledActions
          current={current}
          next={next}
          catalog={catalog}
          hasActedToday={hasActedToday}
          onUpgrade={onUpgrade}
          onLearn={onOpenLibrary}
        />
      ) : current ? (
        <FilledSlotActions
          army={army}
          current={current}
          next={next}
          catalog={catalog}
          hasActedToday={hasActedToday}
          recruitQty={slotState.recruitQty}
          wallet={wallet}
          onUpgrade={onUpgrade}
          onDestroy={onDestroy}
          onRecruit={onRecruit}
          garrisonOccupied={garrisonOccupied}
          hireCandidates={hireCandidates}
          onHire={onHire}
        />
      ) : (
        <p>Unknown building.</p>
      )}
      {catalog &&
      isMarketplaceSlot(catalog, slotId, townTypeId) &&
      slotState.level > 0 ? (
        <p>
          <button type="button" onClick={onOpenMarket}>
            Open Marketplace
          </button>
        </p>
      ) : null}
      {message ? <p className="town-building-panel-msg">{message}</p> : null}
    </div>
  )
}

function ActedLabel({ visible }: { visible: boolean }) {
  if (!visible) {
    return null
  }
  return <p className="town-building-acted">Already built today</p>
}

function EmptySlotActions({
  slotId,
  army,
  catalog,
  hasActedToday,
  townTypeId,
  builtBuildingIds,
  onBuild,
}: {
  slotId: number
  army: boolean
  catalog: ReferenceCatalog
  hasActedToday: boolean
  townTypeId: number
  builtBuildingIds: ReadonlySet<number>
  onBuild: (building: BuildingRow) => void
}) {
  if (army) {
    const options = armyBuildOptions(
      catalog,
      slotId,
      townTypeId,
      builtBuildingIds,
    )
    if (options.length === 0) {
      return (
        <p>
          {missingArmyPrerequisiteLine(
            catalog,
            slotId,
            townTypeId,
            builtBuildingIds,
          )}
        </p>
      )
    }
    return (
      <div className="town-building-branches">
        {options.map((building) => {
          const klass = heroTypeName(catalog, building.class_id)
          return (
            <div key={building.id} className="town-building-option">
              <h3>
                Build {building.name}
                {klass ? ` (${klass})` : ''}
              </h3>
              <p>{effectLine(building)}</p>
              <p>Cost: {formatCost(constructionCost(catalog, building))}</p>
              <button
                type="button"
                disabled={hasActedToday}
                onClick={() => onBuild(building)}
              >
                Build
              </button>
              <ActedLabel visible={hasActedToday} />
            </div>
          )
        })}
      </div>
    )
  }
  const root = genericRoot(genericSlotBuildings(catalog, slotId, townTypeId))
  if (!root) {
    return <p>No building defined for this slot.</p>
  }
  if (!hasPrerequisite(root, builtBuildingIds)) {
    return (
      <p>{missingGenericPrerequisiteLine(catalog, root, builtBuildingIds)}</p>
    )
  }
  return (
    <div className="town-building-option">
      <h3>Build {root.name}</h3>
      <p>{effectLine(root)}</p>
      <p>Cost: {formatCost(constructionCost(catalog, root))}</p>
      <button
        type="button"
        disabled={hasActedToday}
        onClick={() => onBuild(root)}
      >
        Build
      </button>
      <ActedLabel visible={hasActedToday} />
    </div>
  )
}

function LibraryFilledActions({
  current,
  next,
  catalog,
  hasActedToday,
  onUpgrade,
  onLearn,
}: {
  current: BuildingRow
  next: BuildingRow | null
  catalog: ReferenceCatalog
  hasActedToday: boolean
  onUpgrade: (next: BuildingRow) => void
  onLearn: () => void
}) {
  return (
    <div className="town-building-option">
      <h3>{current.name}</h3>
      <p>{effectLine(current)}</p>
      {next ? (
        <>
          <p>
            Upgrade to {next.name}: {formatCost(constructionCost(catalog, next))}
          </p>
          <button
            type="button"
            disabled={hasActedToday}
            onClick={() => onUpgrade(next)}
          >
            Upgrade
          </button>
          <ActedLabel visible={hasActedToday} />
        </>
      ) : null}
      <p>
        <button type="button" onClick={onLearn}>
          Learn
        </button>
      </p>
    </div>
  )
}

function FilledSlotActions({
  army,
  current,
  next,
  catalog,
  hasActedToday,
  recruitQty,
  wallet,
  onUpgrade,
  onDestroy,
  onRecruit,
  garrisonOccupied,
  hireCandidates,
  onHire,
}: {
  army: boolean
  current: BuildingRow
  next: BuildingRow | null
  catalog: ReferenceCatalog
  hasActedToday: boolean
  recruitQty: number
  wallet: ResourceWallet
  onUpgrade: (next: BuildingRow) => void
  onDestroy: (building: BuildingRow) => void
  onRecruit: (qty: number) => boolean
  garrisonOccupied: boolean
  hireCandidates: HeroPoolRow[]
  onHire: (pick: HeroPoolRow) => boolean
}) {
  const [confirmDestroy, setConfirmDestroy] = useState(false)
  const [recruiting, setRecruiting] = useState(false)
  const [hiring, setHiring] = useState(false)
  const destroyCost = destroyCostOf(current)
  const unit = army ? unitForBuilding(catalog, current.id) : null
  const perUnitCost = unitCost(unit)
  const [qtyText, setQtyText] = useState('0')

  useEffect(() => {
    setConfirmDestroy(false)
    setRecruiting(false)
    setHiring(false)
  }, [current.id, hasActedToday])

  return (
    <div className="town-building-option">
      <h3>{current.name}</h3>
      <p>{effectLine(current)}</p>
      {next ? (
        <>
          <p>
            Upgrade to {next.name}: {formatCost(constructionCost(catalog, next))}
          </p>
          <button
            type="button"
            disabled={hasActedToday}
            onClick={() => onUpgrade(next)}
          >
            Upgrade
          </button>
        </>
      ) : null}
      {isTavernBuilding(current) ? (
        <div className="town-hire">
          {garrisonOccupied ? (
            <>
              <p>A hero is visiting — cannot hire</p>
              <button type="button" disabled>
                Hire Hero
              </button>
            </>
          ) : hiring ? (
            <div className="town-hire-list">
              <p>Hire Hero: {formatCost(HIRE_HERO_GOLD_COST)}</p>
              {hireCandidates.length === 0 ? (
                <p>No unused heroes remain in the pool.</p>
              ) : (
                hireCandidates.map((pick) => (
                  <button
                    key={pick.id}
                    type="button"
                    onClick={() => {
                      if (onHire(pick)) {
                        setHiring(false)
                      }
                    }}
                  >
                    {pick.name}
                    {heroTypeName(catalog, pick.class_id)
                      ? ` (${heroTypeName(catalog, pick.class_id)})`
                      : ''}
                  </button>
                ))
              )}
              <button type="button" onClick={() => setHiring(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={hireCandidates.length === 0}
              onClick={() => setHiring(true)}
            >
              Hire Hero
            </button>
          )}
        </div>
      ) : null}
      {army ? (
        <>
          <p>{formatAmount(recruitQty)} available to recruit</p>
          {recruiting ? (
            <div className="town-recruit">
              <label className="town-recruit-qty">
                Quantity
                <input
                  type="number"
                  min={1}
                  max={recruitQty}
                  value={qtyText}
                  onChange={(event) => setQtyText(event.target.value)}
                />
              </label>
              <p>
                Cost:{' '}
                {formatCost(
                  scaleCost(perUnitCost, Math.max(1, Number.parseInt(qtyText, 10) || 1)),
                )}
              </p>
              <div className="town-recruit-actions">
                <button
                  type="button"
                  onClick={() => {
                    if (onRecruit(Number.parseInt(qtyText, 10))) {
                      setRecruiting(false)
                    }
                  }}
                >
                  Confirm
                </button>
                <button type="button" onClick={() => setRecruiting(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={recruitQty < 1 || unit == null}
              onClick={() => {
                setQtyText(
                  String(
                    Math.max(1, maxAffordableQty(wallet, perUnitCost, recruitQty)),
                  ),
                )
                setRecruiting(true)
              }}
            >
              Recruit
            </button>
          )}
          {confirmDestroy && !hasActedToday ? (
            <div className="town-building-confirm">
              <p>
                Are you sure? This will destroy {current.name} and cost{' '}
                {formatCost(destroyCost)}. This cannot be undone.
              </p>
              <div className="town-building-confirm-actions">
                <button type="button" onClick={() => onDestroy(current)}>
                  Confirm
                </button>
                <button type="button" onClick={() => setConfirmDestroy(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <p>
                Destroy: {formatCost(destroyCost)}
                {current.destroy_cost == null ? ' (placeholder TBD)' : ''}
              </p>
              <button
                type="button"
                disabled={hasActedToday}
                onClick={() => setConfirmDestroy(true)}
              >
                Destroy
              </button>
            </>
          )}
        </>
      ) : null}
      <ActedLabel visible={hasActedToday} />
    </div>
  )
}
