import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  formatAmount,
  GOLD_RESOURCE_ID,
  type ResourceWallet,
} from '../hex/resources'
import { ResourceBar } from '../hex/ResourceBar'
import {
  armyBuildOptions,
  buildingById,
  buildingGrowth,
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
  isMarketplaceBuilding,
  isTavernBuilding,
  isUndesignedSlot,
  maxAffordableQty,
  lockedArmyPrerequisiteLines,
  missingGenericPrerequisiteLine,
  nextInChain,
  scaleCost,
  subscribeCatalog,
  townLayoutError,
  unitCost,
  unitForBuilding,
  flightSpeed,
  type BuildingRow,
  type CostMap,
  type HeroPoolRow,
  type ReferenceCatalog,
} from './catalog'
import {
  townConstructionCost,
  townRecruitUnitCost,
} from './townUniques'
import { Marketplace } from './Marketplace'
import { Library } from './Library'
import { TownMapView } from './TownMapView'
import { GameWindowModal } from '../layout/GameWindowModal'
import { GameWindowOverlay } from '../layout/GameWindowOverlay'
import { getSession, subscribe, updateSession } from '../session/store'
import { NECROPOLIS_TOWN_TYPE_ID } from '../session/types'
import {
  assignHeroesFromPool,
  afterTownBuildingPlaced,
  findTownById,
  flightDestinationsFromTown,
  hireHeroFromPool,
  hireHeroCostMap,
  ensureLibraryOffers,
  launchHeroFlight,
  patchBuildingSlot,
  recruitToGarrison,
  slotStatesForTown,
  spendResources,
  takeArchiveLearnNotice,
  unusedTavernPool,
  visitingHeroId,
  type ArchiveLearnNotice,
} from '../session/accessors'
import type { SlotState } from './townSlots'

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
  onQuests?: () => void
  onArchiveLearn?: (notice: ArchiveLearnNotice) => void
  /** DEV: AI spectator looking at an AI town — no mutations. */
  readOnly?: boolean
  /** After a successful Hanger flight launch — sync map hero / camera. */
  onHeroFlew?: (heroId: string) => void
  embedded?: boolean
  /** Dev: draw town-grid hex numbers and outlines. */
  showHexNumbers?: boolean
}

export function TownManagement({
  townId,
  townName,
  wallet,
  onExit,
  calendarLabel,
  hasActedToday: actedToday,
  onActed,
  visitingHeroName: _visitingHeroName,
  selectedHeroId = null,
  onOpenHero: _onOpenHero,
  onArchiveLearn,
  readOnly = false,
  onHeroFlew,
  embedded = false,
  showHexNumbers = false,
}: TownManagementProps) {
  const hasActedToday = actedToday || readOnly
  const session = useSyncExternalStore(subscribe, getSession)
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const slots = slotStatesForTown(session, townId)
  const [openSlot, setOpenSlot] = useState<number | null>(null)
  const [marketOpen, setMarketOpen] = useState(false)
  const [librarySlot, setLibrarySlot] = useState<number | null>(null)
  const [scrollsOpen, setScrollsOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const townTypeId =
    findTownById(session, townId)?.town_type_id ?? NECROPOLIS_TOWN_TYPE_ID
  const townTypeLabel =
    catalog?.town.find((row) => row.id === townTypeId)?.name ?? 'Necropolis'
  const layoutError = catalog ? townLayoutError(catalog, townTypeId) : null
  useEffect(() => {
    setOpenSlot(null)
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
      event.stopImmediatePropagation()
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
        setMessage(null)
        return
      }
      onExit()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
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
      .map((row) => Number(row.building_id))
      .filter((id) => Number.isInteger(id) && id > 0),
  )

  const closePanel = () => {
    setOpenSlot(null)
    setMessage(null)
  }

  const build = (id: number, building: BuildingRow) => {
    if (hasActedToday || !catalog) {
      return
    }
    if (!hasPrerequisite(building, builtBuildingIds)) {
      setMessage(missingGenericPrerequisiteLine(catalog, building, builtBuildingIds))
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
        townConstructionCost(session, catalog, townId, building),
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
    if (catalog) {
      takeArchiveLearnNotice()
      updateSession((current) =>
        afterTownBuildingPlaced(current, catalog, townId, building),
      )
      const learned = takeArchiveLearnNotice()
      if (learned) {
        onArchiveLearn?.(learned)
      }
    }
    closePanel()
  }

  const upgrade = (id: number, next: BuildingRow) => {
    const current = slots[id - 1]
    if (!current || hasActedToday || !catalog) {
      return
    }
    if (!hasPrerequisite(next, builtBuildingIds)) {
      setMessage(missingGenericPrerequisiteLine(catalog, next, builtBuildingIds))
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
        townConstructionCost(session, catalog, townId, next),
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
    takeArchiveLearnNotice()
    updateSession((current) =>
      afterTownBuildingPlaced(current, catalog, townId, next),
    )
    const learned = takeArchiveLearnNotice()
    if (learned) {
      onArchiveLearn?.(learned)
    }
    closePanel()
  }

  const destroy = (id: number, current: BuildingRow) => {
    if (hasActedToday) {
      return
    }
    if (!writeSlot(id, { level: 0, buildingId: null, recruitQty: 0 }, destroyCostOf(current))) {
      return
    }
    onActed()
    closePanel()
  }

  const recruit = (id: number, qty: number): boolean => {
    if (readOnly) {
      return false
    }
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
    closePanel()
    return true
  }

  const hireHero = (pick: HeroPoolRow): boolean => {
    if (readOnly) {
      return false
    }
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
    closePanel()
    return true
  }

  const slotState = openSlot != null ? slots[openSlot - 1] : null

  const openTownSlot = (slot: number) => {
    setMessage(null)
    if (!catalog) {
      setOpenSlot(slot)
      return
    }
    const state = slots[slot - 1]
    if (!state || state.level === 0) {
      setOpenSlot(slot)
      return
    }
    const current = buildingById(catalog, state.buildingId)
    if (!current) {
      setOpenSlot(slot)
      return
    }
    if (!readOnly && isMarketplaceBuilding(current)) {
      setOpenSlot(null)
      setLibrarySlot(null)
      setMarketOpen(true)
      return
    }
    if (!readOnly && isLibraryBuilding(current)) {
      const nextCandidate = nextInChain(current, catalog, slot, townTypeId)
      if (nextCandidate == null) {
        setOpenSlot(null)
        setMarketOpen(false)
        setLibrarySlot(slot)
        return
      }
    }
    setOpenSlot(slot)
  }

  return (
    <div
      className={
        embedded
          ? 'town-management game-window-embed town-management-embedded'
          : 'town-management'
      }
      role="dialog"
      aria-modal="true"
      aria-labelledby="town-management-title"
      data-tip-contain=""
    >
      <TownMapView
        townId={townId}
        showHexNumbers={showHexNumbers}
        preferredHeroId={selectedHeroId}
        onSlotClick={openTownSlot}
      />
      <header className="town-management-bar">
        <h1 id="town-management-title">
          {townName &&
          townTypeLabel &&
          townName.trim().toLowerCase() !== townTypeLabel.trim().toLowerCase()
            ? `${townTypeLabel}: ${townName}`
            : townName || townTypeLabel}
        </h1>
        {!embedded ? (
          <>
            <p className="town-calendar">{calendarLabel}</p>
            <ResourceBar wallet={wallet} className="town-resource-strip" />
          </>
        ) : null}
        <button type="button" onClick={onExit}>
          Exit Town
        </button>
      </header>
      {readOnly ? (
        <p className="town-readonly-banner">Read-only — AI spectator (DEV)</p>
      ) : null}
      {!catalog ? (
        <p className="town-building-layout-error">Loading buildings…</p>
      ) : layoutError ? (
        <p className="town-building-layout-error">{layoutError}</p>
      ) : null}
      {openSlot != null && slotState ? (
        <GameWindowOverlay>
          <GameWindowModal
            aria-labelledby="town-slot-panel-title"
            onBackdropClick={closePanel}
          >
        <BuildingPanel
          slotId={openSlot}
          slotState={slotState}
          catalog={catalog}
          catalogError={catalogError}
          message={message}
          hasActedToday={hasActedToday}
          townId={townId}
          townTypeId={townTypeId}
          onClose={closePanel}
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
            catalog ? unusedTavernPool(session, catalog, townTypeId) : []
          }
          onHire={(pick) => hireHero(pick)}
          wallet={wallet}
          builtBuildingIds={builtBuildingIds}
          visitingHeroId={
            (() => {
              const town = findTownById(session, townId)
              return town
                ? visitingHeroId(session, town, selectedHeroId)
                : null
            })()
          }
          onFlyLaunched={(heroId) => {
            onExit()
            onHeroFlew?.(heroId)
          }}
          onFlyError={(text) => setMessage(text)}
          onOpenLibrary={() => {
            if (readOnly || openSlot == null) {
              return
            }
            const slot = openSlot
            setOpenSlot(null)
            setLibrarySlot(slot)
          }}
        />
          </GameWindowModal>
        </GameWindowOverlay>
      ) : null}
      {marketOpen ? (
        embedded ? (
          <GameWindowOverlay className="town-building-screen-embedded marketplace-screen-embedded">
            <GameWindowModal
              aria-labelledby="marketplace-title"
              onBackdropClick={() => setMarketOpen(false)}
            >
              <Marketplace
                embedded
                onClose={() => setMarketOpen(false)}
              />
            </GameWindowModal>
          </GameWindowOverlay>
        ) : (
          <Marketplace onClose={() => setMarketOpen(false)} />
        )
      ) : null}
      {librarySlot != null ? (
        embedded ? (
          <GameWindowOverlay className="town-building-screen-embedded library-screen-embedded">
            <GameWindowModal
              aria-labelledby="library-title"
              onBackdropClick={() => setLibrarySlot(null)}
            >
              <Library
                embedded
                townId={townId}
                slotNum={librarySlot}
                onClose={() => setLibrarySlot(null)}
              />
            </GameWindowModal>
          </GameWindowOverlay>
        ) : (
          <Library
            townId={townId}
            slotNum={librarySlot}
            onClose={() => setLibrarySlot(null)}
          />
        )
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

function BuildingPanel({
  slotId,
  slotState,
  catalog,
  catalogError,
  message,
  hasActedToday,
  townId,
  townTypeId,
  wallet,
  onClose,
  onBuild,
  onUpgrade,
  onDestroy,
  onRecruit,
  garrisonOccupied,
  hireCandidates,
  onHire,
  builtBuildingIds,
  onOpenLibrary,
  visitingHeroId: visitorId,
  onFlyLaunched,
  onFlyError,
}: {
  slotId: number
  slotState: SlotState
  catalog: ReferenceCatalog | null
  catalogError: string | null
  message: string | null
  hasActedToday: boolean
  townId: string
  townTypeId: number
  wallet: ResourceWallet
  onClose: () => void
  onBuild: (building: BuildingRow) => void
  onUpgrade: (next: BuildingRow) => void
  onDestroy: (building: BuildingRow) => void
  onRecruit: (qty: number) => boolean
  garrisonOccupied: boolean
  hireCandidates: HeroPoolRow[]
  onHire: (pick: HeroPoolRow) => boolean
  builtBuildingIds: ReadonlySet<number>
  onOpenLibrary: () => void
  visitingHeroId: string | null
  onFlyLaunched: (heroId: string) => void
  onFlyError: (message: string) => void
}) {
  const army = isArmySlot(slotId)
  const sessionNow = getSession()
  const buildCost = (building: BuildingRow): CostMap =>
    catalog
      ? townConstructionCost(sessionNow, catalog, townId, building)
      : {}
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
  const lockedUpgradeLine =
    catalog &&
    nextCandidate &&
    !next &&
    !hasPrerequisite(nextCandidate, builtBuildingIds)
      ? missingGenericPrerequisiteLine(
          catalog,
          nextCandidate,
          builtBuildingIds,
        )
      : null

  return (
    <div className="town-building-panel town-building-panel-popup">
      <div className="town-building-panel-header">
        <h2 id="town-slot-panel-title">Slot {slotId}</h2>
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
          buildCost={buildCost}
          onBuild={onBuild}
        />
      ) : current && isLibraryBuilding(current) ? (
        <LibraryFilledActions
          current={current}
          next={next}
          catalog={catalog}
          hasActedToday={hasActedToday}
          buildCost={buildCost}
          onUpgrade={onUpgrade}
          onLearn={onOpenLibrary}
          lockedUpgradeLine={lockedUpgradeLine}
        />
      ) : current ? (
        <FilledSlotActions
          army={army}
          current={current}
          next={next}
          catalog={catalog}
          hasActedToday={hasActedToday}
          townId={townId}
          recruitQty={slotState.recruitQty}
          wallet={wallet}
          buildCost={buildCost}
          onUpgrade={onUpgrade}
          onDestroy={onDestroy}
          onRecruit={onRecruit}
          garrisonOccupied={garrisonOccupied}
          hireCandidates={hireCandidates}
          onHire={onHire}
          lockedUpgradeLine={lockedUpgradeLine}
          visitingHeroId={visitorId}
          hangerSlot={slotId === 8}
          onFlyLaunched={onFlyLaunched}
          onFlyError={onFlyError}
        />
      ) : (
        <p>Unknown building.</p>
      )}
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
  buildCost,
  onBuild,
}: {
  slotId: number
  army: boolean
  catalog: ReferenceCatalog
  hasActedToday: boolean
  townTypeId: number
  builtBuildingIds: ReadonlySet<number>
  buildCost: (building: BuildingRow) => CostMap
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
        <div className="town-building-branches">
          {lockedArmyPrerequisiteLines(
            catalog,
            slotId,
            townTypeId,
            builtBuildingIds,
          ).map((line, index) => (
            <p key={`${slotId}-lock-${index}`}>{line}</p>
          ))}
        </div>
      )
    }
    return (
      <div className="town-building-branches">
        {options.map((building) => {
          const unitName = unitForBuilding(catalog, building.id)?.name?.trim()
          const label = unitName
            ? `Build ${building.name} (${unitName}): ${formatCost(buildCost(building))}`
            : `Build ${building.name}: ${formatCost(buildCost(building))}`
          return (
            <div key={building.id} className="town-building-option">
              <p>{effectLine(building)}</p>
              <button
                type="button"
                className="town-building-action"
                disabled={hasActedToday}
                onClick={() => onBuild(building)}
              >
                {label}
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
      <p>{effectLine(root)}</p>
      <button
        type="button"
        className="town-building-action"
        disabled={hasActedToday}
        onClick={() => onBuild(root)}
      >
        Build {root.name}: {formatCost(buildCost(root))}
      </button>
      <ActedLabel visible={hasActedToday} />
    </div>
  )
}

function LibraryFilledActions({
  current,
  next,
  catalog: _catalog,
  hasActedToday,
  buildCost,
  onUpgrade,
  onLearn,
  lockedUpgradeLine,
}: {
  current: BuildingRow
  next: BuildingRow | null
  catalog: ReferenceCatalog
  hasActedToday: boolean
  buildCost: (building: BuildingRow) => CostMap
  onUpgrade: (next: BuildingRow) => void
  onLearn: () => void
  lockedUpgradeLine?: string | null
}) {
  return (
    <div className="town-building-option">
      <h3>{current.name}</h3>
      <p>{effectLine(current)}</p>
      {next ? (
        <>
          <button
            type="button"
            className="town-building-action"
            disabled={hasActedToday}
            onClick={() => onUpgrade(next)}
          >
            Upgrade to {next.name}: {formatCost(buildCost(next))}
          </button>
          <ActedLabel visible={hasActedToday} />
        </>
      ) : lockedUpgradeLine ? (
        <p>{lockedUpgradeLine}</p>
      ) : null}
      <button type="button" className="town-building-action" onClick={onLearn}>
        Learn
      </button>
    </div>
  )
}

function FilledSlotActions({
  army,
  current,
  next,
  catalog,
  hasActedToday,
  townId,
  recruitQty,
  wallet,
  buildCost,
  onUpgrade,
  onDestroy,
  onRecruit,
  garrisonOccupied,
  hireCandidates,
  onHire,
  lockedUpgradeLine,
  visitingHeroId: visitorId,
  hangerSlot,
  onFlyLaunched,
  onFlyError,
}: {
  army: boolean
  current: BuildingRow
  next: BuildingRow | null
  catalog: ReferenceCatalog
  hasActedToday: boolean
  townId: string
  recruitQty: number
  wallet: ResourceWallet
  buildCost: (building: BuildingRow) => CostMap
  onUpgrade: (next: BuildingRow) => void
  onDestroy: (building: BuildingRow) => void
  onRecruit: (qty: number) => boolean
  garrisonOccupied: boolean
  hireCandidates: HeroPoolRow[]
  onHire: (pick: HeroPoolRow) => boolean
  lockedUpgradeLine?: string | null
  visitingHeroId: string | null
  hangerSlot: boolean
  onFlyLaunched: (heroId: string) => void
  onFlyError: (message: string) => void
}) {
  const [confirmDestroy, setConfirmDestroy] = useState(false)
  const [recruiting, setRecruiting] = useState(false)
  const [hiring, setHiring] = useState(false)
  const [flying, setFlying] = useState(false)
  const [flyError, setFlyError] = useState<string | null>(null)
  const destroyCost = destroyCostOf(current)
  const unit = army ? unitForBuilding(catalog, current.id) : null
  const perUnitCost = townRecruitUnitCost(
    getSession(),
    catalog,
    townId,
    unitCost(unit),
  )
  const [qtyText, setQtyText] = useState('0')
  const sessionNow = getSession()
  const visitor = visitorId
    ? sessionNow.heroes.find((row) => row.id === visitorId)
    : null
  const canOfferFlight =
    hangerSlot &&
    visitor != null &&
    !visitor.flight &&
    visitor.player_id === findTownById(sessionNow, townId)?.player_id
  const flightDests = canOfferFlight
    ? flightDestinationsFromTown(
        sessionNow,
        catalog,
        townId,
        visitor.player_id,
        visitorId,
      )
    : []
  const goldOnHand = wallet[GOLD_RESOURCE_ID]?.stockpile ?? 0

  useEffect(() => {
    setConfirmDestroy(false)
    setRecruiting(false)
    setHiring(false)
    setFlying(false)
    setFlyError(null)
  }, [current.id, hasActedToday])

  return (
    <div className="town-building-option">
      <h3>
        {current.name}
        {unit?.name?.trim() ? ` (${unit.name.trim()})` : ''}
      </h3>
      <p>{effectLine(current)}</p>
      {canOfferFlight ? (
        <div className="town-hire">
          {flying ? (
            <div className="town-hire-list">
              <p>Fly to (gold charged at launch):</p>
              {flightDests.length === 0 ? (
                <p>No other friendly Hanger towns.</p>
              ) : (
                flightDests.map((dest) => {
                  const afford = goldOnHand >= dest.goldCost
                  const selectable = afford && !dest.blocked
                  const typeName =
                    catalog.town.find(
                      (row) => row.id === dest.town.town_type_id,
                    )?.name?.trim() || 'Town'
                  const days = Math.max(
                    1,
                    Math.ceil(dest.distance / flightSpeed(catalog)),
                  )
                  return (
                    <button
                      key={dest.town.id}
                      type="button"
                      className="town-building-action"
                      disabled={!selectable}
                      onClick={() => {
                        if (!visitorId || dest.blocked) {
                          if (dest.blocked) {
                            onFlyError('That destination is blocked.')
                          } else {
                            onFlyError('No hero is visiting this town.')
                          }
                          return
                        }
                        let error: string | null = null
                        updateSession((currentSession) => {
                          const result = launchHeroFlight(
                            currentSession,
                            visitorId,
                            dest.town.id,
                            townId,
                          )
                          error = result.error
                          return result.session
                        })
                        if (error) {
                          setFlyError(error)
                          onFlyError(error)
                          return
                        }
                        setFlying(false)
                        // Close town first; App animates flight on the world map.
                        onFlyLaunched(visitorId)
                      }}
                    >
                      {typeName}: {dest.town.name} -{' '}
                      {formatAmount(dest.goldCost)} Gold, {days}{' '}
                      {days === 1 ? 'Day' : 'Days'}
                      {dest.blocked
                        ? ' - Blocked'
                        : afford
                          ? ''
                          : ' (need gold)'}
                    </button>
                  )
                })
              )}
              {flyError ? <p className="town-building-panel-msg">{flyError}</p> : null}
              <button
                type="button"
                className="town-building-action"
                onClick={() => {
                  setFlying(false)
                  setFlyError(null)
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="town-building-action"
              onClick={() => {
                setFlyError(null)
                setFlying(true)
              }}
            >
              Fly to Hanger town…
            </button>
          )}
        </div>
      ) : null}
      {next ? (
        <button
          type="button"
          className="town-building-action"
          disabled={hasActedToday}
          onClick={() => onUpgrade(next)}
        >
          Upgrade to {next.name}: {formatCost(buildCost(next))}
        </button>
      ) : lockedUpgradeLine ? (
        <p>{lockedUpgradeLine}</p>
      ) : null}
      {isTavernBuilding(current) ? (
        <div className="town-hire">
          {garrisonOccupied ? (
            <button type="button" className="town-building-action" disabled>
              A hero is visiting — cannot hire
            </button>
          ) : hiring ? (
            <div className="town-hire-list">
              <p>Hire Hero: {formatCost(hireHeroCostMap())}</p>
              {hireCandidates.length === 0 ? (
                <p>No unused heroes remain in the pool.</p>
              ) : (
                hireCandidates.map((pick) => (
                  <button
                    key={pick.id}
                    type="button"
                    className="town-building-action"
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
              <button
                type="button"
                className="town-building-action"
                onClick={() => setHiring(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="town-building-action"
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
          {recruiting ? (
            <div className="town-recruit">
              <div className="town-recruit-row">
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
                <span className="town-recruit-cost">
                  Cost:{' '}
                  {formatCost(
                    scaleCost(
                      perUnitCost,
                      Math.max(1, Number.parseInt(qtyText, 10) || 1),
                    ),
                  )}
                </span>
              </div>
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
              className="town-building-action"
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
              {formatAmount(recruitQty)}{' '}
              {unit?.name?.trim() ? `${unit.name.trim()} ` : ''}
              to Recruit
            </button>
          )}
          {confirmDestroy && !hasActedToday ? (
            <div className="town-building-confirm town-building-destroy-gap">
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
            <button
              type="button"
              className="town-building-action town-building-destroy-gap"
              disabled={hasActedToday}
              onClick={() => setConfirmDestroy(true)}
            >
              Destroy {current.name}: {formatCost(destroyCost)}
            </button>
          )}
        </>
      ) : null}
      <ActedLabel visible={hasActedToday} />
    </div>
  )
}
