import { useState, useSyncExternalStore } from 'react'
import { formatAmount } from '../hex/resources'
import {
  findWorldLibraryById,
  learnWorldLibraryAbility,
  recordWorldLibraryVisit,
} from '../session/accessors'
import { getSession, subscribe, updateSession } from '../session/store'
import { getCachedCatalog, libraryGoldCost, subscribeCatalog } from './catalog'
import { abilityTooltip } from './abilityTooltip'
import { AbilityTip } from './AbilityTip'
import {
  abilityById,
  worldLibrarySlotKind,
} from './libraryRules'

type WorldLibraryProps = {
  featureId: string
  heroId: string
  onClose: () => void
}

/**
 * World-map Library shop (BR S9-5). Compact panel with rolled ability slots.
 */
export function WorldLibrary({ featureId, heroId, onClose }: WorldLibraryProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const feature = findWorldLibraryById(session, featureId)
  const hero = session.heroes.find((row) => row.id === heroId) ?? null
  const [message, setMessage] = useState<string | null>(null)

  const visitor =
    hero != null
      ? {
          classId: hero.class_id,
          learned: hero.learned_abilities ?? [],
        }
      : null

  const abilities =
    catalog && feature
      ? feature.ability_ids
          .map((id) => abilityById(catalog, id))
          .filter((row): row is NonNullable<typeof row> => row != null)
          .slice()
          .sort(
            (a, b) =>
              a.level_id - b.level_id ||
              a.discipline_id - b.discipline_id ||
              a.id - b.id,
          )
      : []

  const buy = (abilityId: number) => {
    if (!catalog || !hero) {
      return
    }
    let error: string | null = null
    updateSession((current) => {
      const result = learnWorldLibraryAbility(
        current,
        catalog,
        featureId,
        hero.id,
        abilityId,
      )
      error = result.error
      return result.error ? current : result.session
    })
    setMessage(error)
  }

  return (
    <div
      className="date-notice"
      role="dialog"
      aria-modal="true"
      aria-labelledby="world-library-title"
      onClick={onClose}
    >
      <div
        className="date-notice-card world-panel-card"
        data-tip-contain=""
        onClick={(event) => event.stopPropagation()}
      >
        <h1 id="world-library-title">Library</h1>
        {!catalog || !feature ? (
          <p>Loading…</p>
        ) : (
          <>
            <div className="library-grid library-grid-world world-panel-library">
              {abilities.map((ability) => {
                const discipline =
                  catalog.discipline.find(
                    (row) => row.id === ability.discipline_id,
                  )?.name ?? 'Discipline'
                const kind = worldLibrarySlotKind(
                  ability.id,
                  visitor,
                  catalog,
                  ability.discipline_id,
                )
                const cost = libraryGoldCost(catalog, ability.level_id)
                const label = `${discipline}: ${ability.name}`
                const clickable = kind === 'buyable'
                return (
                  <button
                    key={ability.id}
                    type="button"
                    className={`library-slot library-slot-${kind}`}
                    disabled={!clickable}
                    onClick={() => {
                      if (clickable) {
                        buy(ability.id)
                      }
                    }}
                  >
                    <AbilityTip
                      description={abilityTooltip(catalog, ability, hero)}
                    >
                      {label}
                      {kind === 'buyable' ? (
                        <span className="library-slot-cost">
                          {formatAmount(cost)} Gold
                        </span>
                      ) : null}
                    </AbilityTip>
                  </button>
                )
              })}
            </div>
            {message ? <p className="world-panel-error">{message}</p> : null}
            <button type="button" className="date-notice-ok" onClick={onClose}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/** Mark visit when the panel opens (for map tooltip). */
export function openWorldLibraryVisit(
  featureId: string,
  playerId: string,
): void {
  updateSession((current) =>
    recordWorldLibraryVisit(current, featureId, playerId),
  )
}

/** Map hover: unread → "Library"; else one `Discipline: Ability` line each. */
export function worldLibraryTooltipText(
  feature: {
    ability_ids: number[]
    visited_by_player: Record<string, boolean>
  },
  catalog: NonNullable<ReturnType<typeof getCachedCatalog>>,
  playerId: string | null | undefined,
): string {
  if (!playerId || !feature.visited_by_player[playerId]) {
    return 'Library'
  }
  const lines: string[] = []
  const abilities = feature.ability_ids
    .map((id) => abilityById(catalog, id))
    .filter((row): row is NonNullable<typeof row> => row != null)
    .slice()
    .sort(
      (a, b) =>
        a.level_id - b.level_id ||
        a.discipline_id - b.discipline_id ||
        a.id - b.id,
    )
  for (const ability of abilities) {
    const discipline =
      catalog.discipline.find((row) => row.id === ability.discipline_id)
        ?.name ?? 'Discipline'
    lines.push(`${discipline}: ${ability.name}`)
  }
  return lines.length > 0 ? lines.join('\n') : 'Library'
}
