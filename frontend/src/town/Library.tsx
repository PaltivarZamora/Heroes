import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  formatAmount,
  formatResourceLine,
  RESOURCES,
} from '../hex/resources'
import {
  ensureLibraryOffers,
  findTownById,
  learnLibraryAbility,
  visitingHeroId,
  walletFromSession,
} from '../session/accessors'
import { getSession, subscribe, updateSession } from '../session/store'
import { getCachedCatalog, abilityTooltip, libraryGoldCost, subscribeCatalog } from './catalog'
import { AbilityTip } from './AbilityTip'
import {
  LIBRARY_TIERS,
  abilityById,
  classDisciplines,
  findOffer,
  librarySlotKind,
  townHeroClasses,
} from './libraryRules'

type LibraryProps = {
  townId: string
  slotNum: number
  onClose: () => void
}

export function Library({ townId, slotNum, onClose }: LibraryProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const town = findTownById(session, townId)
  const townTypeId = town?.town_type_id ?? 0
  const classes = catalog ? townHeroClasses(catalog, townTypeId) : []
  const visitingId = town ? visitingHeroId(session, town) : null
  const visiting = visitingId
    ? session.heroes.find((hero) => hero.id === visitingId) ?? null
    : null
  const [classId, setClassId] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (classId != null || classes.length === 0) {
      return
    }
    const preferred =
      visiting?.class_id != null &&
      classes.some((row) => row.id === visiting.class_id)
        ? visiting.class_id
        : (classes[0]?.id ?? null)
    setClassId(preferred)
  }, [classId, classes, visiting?.class_id])

  useEffect(() => {
    if (!catalog || !town) {
      return
    }
    updateSession((current) =>
      ensureLibraryOffers(current, catalog, townId, townTypeId, slotNum),
    )
  }, [catalog, town, townId, townTypeId, slotNum])

  const wallet = walletFromSession(session)
  const building = session.building_states.find(
    (row) => row.town_id === townId && row.slot_num === slotNum,
  )
  const buildingLevel = building?.level ?? 0
  const buildingName =
    catalog && building?.building_id != null
      ? (catalog.building.find((row) => row.id === building.building_id)?.name ??
        'Library')
      : 'Library'
  const offers = building?.offered_abilities ?? []
  const disciplines =
    catalog && classId != null ? classDisciplines(catalog, classId) : []
  const visitor =
    visiting != null
      ? {
          classId: visiting.class_id,
          learned: visiting.learned_abilities ?? [],
        }
      : null

  const buy = (abilityId: number) => {
    if (!catalog || visitingId == null) {
      return
    }
    let error: string | null = null
    updateSession((current) => {
      const result = learnLibraryAbility(
        current,
        catalog,
        townId,
        visitingId,
        abilityId,
      )
      error = result.error
      return result.error ? current : result.session
    })
    setMessage(error)
  }

  return (
    <div
      className="town-management library-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="library-title"
    >
      <header className="town-management-bar">
        <h1 id="library-title">Library</h1>
        <p className="town-resource-strip">
          {RESOURCES.map((resource) => (
            <span key={resource.id}>
              {formatResourceLine(resource, wallet[resource.id])}
            </span>
          ))}
        </p>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="library-body">
        {!catalog ? (
          <p>Loading…</p>
        ) : (
          <>
            <div className="library-class-tabs">
              {classes.map((klass) => (
                <button
                  key={klass.id}
                  type="button"
                  className={klass.id === classId ? 'active' : undefined}
                  onClick={() => {
                    setClassId(klass.id)
                    setMessage(null)
                  }}
                >
                  {klass.name}
                </button>
              ))}
            </div>
            <div className="library-disciplines">
              {disciplines.map((discipline) => (
                <section key={discipline.id} className="library-discipline">
                  <h2>{discipline.name}</h2>
                  <div className="library-grid">
                    {LIBRARY_TIERS.flatMap((level) => {
                      const offered = findOffer(offers, discipline.id, level)
                      const ids = [...(offered?.ability_ids ?? []), null, null].slice(
                        0,
                        2,
                      )
                      return ids.map((abilityId, index) => {
                        const ability =
                          abilityId != null && catalog
                            ? abilityById(catalog, abilityId)
                            : undefined
                        const kind = librarySlotKind(
                          buildingLevel,
                          level,
                          ability?.id ?? null,
                          visitor,
                          catalog,
                          discipline.id,
                        )
                        const cost = libraryGoldCost(catalog, level)
                        const lockedTier = kind === 'unopened' && level > 1
                        const label = lockedTier
                          ? `Upgrade ${buildingName} to access ${
                              level === 2 ? 'Advanced' : 'Expert'
                            } teachings`
                          : ability && kind !== 'unopened'
                            ? ability.name
                            : ''
                        const clickable = kind === 'buyable'
                        return (
                          <button
                            key={`${discipline.id}-${level}-${index}`}
                            type="button"
                            className={`library-slot library-slot-${kind}${
                              lockedTier ? ' library-slot-hint' : ''
                            }`}
                            disabled={!clickable}
                            onClick={() => {
                              if (ability && clickable) {
                                buy(ability.id)
                              }
                            }}
                          >
                            {ability && !lockedTier ? (
                              <AbilityTip description={abilityTooltip(catalog, ability)}>
                                {label}
                                {kind === 'buyable' ? (
                                  <span className="library-slot-cost">
                                    {formatAmount(cost)} Gold
                                  </span>
                                ) : null}
                              </AbilityTip>
                            ) : (
                              <>
                                {label}
                                {kind === 'buyable' ? (
                                  <span className="library-slot-cost">
                                    {formatAmount(cost)} Gold
                                  </span>
                                ) : null}
                              </>
                            )}
                          </button>
                        )
                      })
                    })}
                  </div>
                </section>
              ))}
            </div>
            {message ? <p className="town-building-panel-msg">{message}</p> : null}
          </>
        )}
      </div>
    </div>
  )
}
