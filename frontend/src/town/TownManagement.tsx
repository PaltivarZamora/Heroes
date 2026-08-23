import { useEffect, useState } from 'react'
import {
  canAfford,
  deductCost,
  formatAmount,
  formatResourceLine,
  RESOURCES,
  type ResourceWallet,
} from '../hex/resources'
import {
  armyOptions,
  buildingById,
  buildingCost,
  destroyCostOf,
  effectLine,
  fetchCatalog,
  formatCost,
  genericRoot,
  genericSlotBuildings,
  heroTypeName,
  isArmySlot,
  isReservedBuildingSlot,
  isUndesignedSlot,
  nextInChain,
  undesignedBuilding,
  unitForBuilding,
  type BuildingRow,
  type ReferenceCatalog,
} from './catalog'
import {
  emptySlotArtFilename,
  slotArtFilename,
  slotArtUrl,
} from './slotArt'
import { getTownSlots, patchTownSlot, type SlotState } from './townSlots'

type TownManagementProps = {
  townName: string
  wallet: ResourceWallet
  onWalletChange: (wallet: ResourceWallet) => void
  onExit: () => void
  calendarLabel: string
  hasActedToday: boolean
  onActed: () => void
  visitingHeroName: string
}

function SlotArt({ filename }: { filename: string }) {
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    setMissing(false)
  }, [filename])
  if (missing) {
    return <span className="town-building-slot-filename">{filename}</span>
  }
  return (
    <img src={slotArtUrl(filename)} alt="" onError={() => setMissing(true)} />
  )
}

export function TownManagement({
  townName,
  wallet,
  onWalletChange,
  onExit,
  calendarLabel,
  hasActedToday,
  onActed,
  visitingHeroName,
}: TownManagementProps) {
  const [catalog, setCatalog] = useState<ReferenceCatalog | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [slots, setSlots] = useState<SlotState[]>(() => getTownSlots(townName))
  const [openSlot, setOpenSlot] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setSlots(getTownSlots(townName))
    setOpenSlot(null)
    setMessage(null)
  }, [townName])

  useEffect(() => {
    let cancelled = false
    void fetchCatalog()
      .then((data) => {
        if (!cancelled) {
          setCatalog(data)
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

  const tryPay = (cost: Record<string, number>): boolean => {
    const blocked = canAfford(wallet, cost)
    if (blocked) {
      setMessage(blocked)
      return false
    }
    onWalletChange(deductCost(wallet, cost))
    return true
  }

  const writeSlot = (id: number, next: SlotState) => {
    setSlots(patchTownSlot(townName, id - 1, next))
    setMessage(null)
  }

  const build = (id: number, building: BuildingRow) => {
    if (hasActedToday) {
      return
    }
    if (!tryPay(buildingCost(building))) {
      return
    }
    writeSlot(id, { level: 1, buildingId: building.id })
    onActed()
  }

  const upgrade = (id: number, next: BuildingRow) => {
    const current = slots[id - 1]
    if (!current || hasActedToday) {
      return
    }
    if (!tryPay(buildingCost(next))) {
      return
    }
    writeSlot(id, { level: current.level + 1, buildingId: next.id })
    onActed()
  }

  const destroy = (id: number, current: BuildingRow) => {
    if (hasActedToday) {
      return
    }
    if (!tryPay(destroyCostOf(current))) {
      return
    }
    writeSlot(id, { level: 0, buildingId: null })
    onActed()
  }

  const slotState = openSlot != null ? slots[openSlot - 1] : null

  return (
    <div
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
            <span key={resource.name}>
              {formatResourceLine(resource.name, wallet[resource.name])}
            </span>
          ))}
        </p>
        <button type="button" onClick={onExit}>
          Exit Town
        </button>
      </header>
      <div className="town-building-grid">
        {slots.map((state, index) => {
          const id = index + 1
          if (isReservedBuildingSlot(id)) {
            return (
              <div
                key={id}
                className="town-building-slot town-building-slot-reserved"
                aria-label="Slot 12 reserved"
              >
                Reserved
              </div>
            )
          }
          const building = catalog
            ? buildingById(catalog, state.buildingId)
            : null
          const placeholder = catalog
            ? undesignedBuilding(catalog, id)
            : null
          const filename =
            state.level > 0
              ? slotArtFilename(id, state.level, building?.image_path ?? null)
              : placeholder?.image_path || emptySlotArtFilename(id)
          return (
            <button
              key={id}
              type="button"
              className="town-building-slot"
              aria-label={`Slot ${id}`}
              onClick={() => {
                setOpenSlot(id)
                setMessage(null)
              }}
            >
              <SlotArt filename={filename} />
            </button>
          )
        })}
      </div>
      <div className="town-bottom-dock">
        <div className="town-reserved-corner" aria-label="Reserved">
          Reserved
        </div>
        <ArmyRows
          slots={slots}
          catalog={catalog}
          visitingHeroName={visitingHeroName}
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
          onClose={() => {
            setOpenSlot(null)
            setMessage(null)
          }}
          onBuild={(building) => build(openSlot, building)}
          onUpgrade={(next) => upgrade(openSlot, next)}
          onDestroy={(building) => destroy(openSlot, building)}
        />
      ) : null}
    </div>
  )
}

const ARMY_QTY = 0

function garrisonArmyLabels(
  slots: SlotState[],
  catalog: ReferenceCatalog | null,
): string[] {
  return [1, 2, 3, 4, 5, 6].map((tier) => {
    const slotId = tier + 3
    const state = slots[slotId - 1]
    const building =
      catalog && state && state.level > 0
        ? buildingById(catalog, state.buildingId)
        : null
    const unit =
      catalog && building ? unitForBuilding(catalog, building.id) : null
    return building
      ? `${unit?.name ?? 'Unknown'} - ${formatAmount(ARMY_QTY)}`
      : 'Empty'
  })
}

function ArmyRows({
  slots,
  catalog,
  visitingHeroName,
}: {
  slots: SlotState[]
  catalog: ReferenceCatalog | null
  visitingHeroName: string
}) {
  return (
    <div className="town-army-rows">
      <ArmyRow
        heroLabel="Garrison"
        armyLabels={garrisonArmyLabels(slots, catalog)}
      />
      <ArmyRow
        heroLabel={visitingHeroName}
        armyLabels={['Empty', 'Empty', 'Empty', 'Empty', 'Empty', 'Empty']}
      />
    </div>
  )
}

function ArmyRow({
  heroLabel,
  armyLabels,
}: {
  heroLabel: string
  armyLabels: string[]
}) {
  return (
    <div className="town-army-row">
      <div className="town-army-box">{heroLabel}</div>
      {armyLabels.map((text, index) => (
        <div key={index} className="town-army-box">
          {text}
        </div>
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
  onClose,
  onBuild,
  onUpgrade,
  onDestroy,
}: {
  slotId: number
  slotState: SlotState
  catalog: ReferenceCatalog | null
  catalogError: string | null
  message: string | null
  hasActedToday: boolean
  onClose: () => void
  onBuild: (building: BuildingRow) => void
  onUpgrade: (next: BuildingRow) => void
  onDestroy: (building: BuildingRow) => void
}) {
  const army = isArmySlot(slotId)
  const current =
    catalog != null ? buildingById(catalog, slotState.buildingId) : null
  const next =
    catalog != null && current != null
      ? nextInChain(current, catalog, slotId)
      : null

  return (
    <div className="town-building-panel">
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
      ) : isUndesignedSlot(catalog, slotId) ? (
        <p>Not yet designed</p>
      ) : slotState.level === 0 ? (
        <EmptySlotActions
          slotId={slotId}
          army={army}
          catalog={catalog}
          hasActedToday={hasActedToday}
          onBuild={onBuild}
        />
      ) : current ? (
        <FilledSlotActions
          army={army}
          current={current}
          next={next}
          catalog={catalog}
          hasActedToday={hasActedToday}
          onUpgrade={onUpgrade}
          onDestroy={onDestroy}
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
  onBuild,
}: {
  slotId: number
  army: boolean
  catalog: ReferenceCatalog
  hasActedToday: boolean
  onBuild: (building: BuildingRow) => void
}) {
  if (army) {
    const options = armyOptions(catalog, slotId)
    if (options.length === 0) {
      return <p>No army buildings defined for this slot.</p>
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
              <p>{effectLine(building, catalog.unit)}</p>
              <p>Cost: {formatCost(buildingCost(building))}</p>
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
  const root = genericRoot(genericSlotBuildings(catalog, slotId))
  if (!root) {
    return <p>No building defined for this slot.</p>
  }
  return (
    <div className="town-building-option">
      <h3>Build {root.name}</h3>
      <p>{effectLine(root, catalog.unit)}</p>
      <p>Cost: {formatCost(buildingCost(root))}</p>
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

function FilledSlotActions({
  army,
  current,
  next,
  catalog,
  hasActedToday,
  onUpgrade,
  onDestroy,
}: {
  army: boolean
  current: BuildingRow
  next: BuildingRow | null
  catalog: ReferenceCatalog
  hasActedToday: boolean
  onUpgrade: (next: BuildingRow) => void
  onDestroy: (building: BuildingRow) => void
}) {
  const [confirmDestroy, setConfirmDestroy] = useState(false)
  const destroyCost = destroyCostOf(current)

  useEffect(() => {
    setConfirmDestroy(false)
  }, [current.id, hasActedToday])

  return (
    <div className="town-building-option">
      <h3>{current.name}</h3>
      <p>{effectLine(current, catalog.unit)}</p>
      {next ? (
        <>
          <p>
            Upgrade to {next.name}: {formatCost(buildingCost(next))}
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
      {army ? (
        confirmDestroy && !hasActedToday ? (
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
        )
      ) : null}
      <ActedLabel visible={hasActedToday} />
    </div>
  )
}
