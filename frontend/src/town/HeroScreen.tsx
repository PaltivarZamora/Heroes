import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  ENERGY_RESOURCE_ID,
  MANA_RESOURCE_ID,
} from '../combat/abilityStatMath'
import { poolCurrent, poolMax, resourceLabel } from '../combat/heroCast'
import { GameWindowModal } from '../layout/GameWindowModal'
import { GameWindowOverlay } from '../layout/GameWindowOverlay'
import {
  heroDailyRegenEffective,
  heroPoolRegenProfile,
} from '../items/heroRegen'
import { getSession, subscribe } from '../session/store'
import {
  getCachedCatalog,
  heroEffectiveStatsForHero,
  subscribeCatalog,
} from './catalog'
import { classDisciplines } from './libraryRules'
import { HeroAbilitiesPanel } from './HeroAbilitiesPanel'
import { HeroInventory } from './HeroInventory'
import { heroAbilitiesHeader, heroPassiveDisplay } from './heroPassiveDisplay'
import { heroDisplayStats } from './statCatalog'
import { AbilityTip } from './AbilityTip'

type HeroScreenProps = {
  heroId: string
  onClose: () => void
  embedded?: boolean
}

function PoolBar({
  catalog,
  hero,
  resourceId,
  regenPerDay,
}: {
  catalog: ReturnType<typeof getCachedCatalog>
  hero: import('../session/types').Hero
  resourceId: number
  regenPerDay: number
}) {
  if (!catalog) {
    return null
  }
  const current = poolCurrent(hero, resourceId)
  const max = poolMax(catalog, hero, resourceId)
  const label = resourceLabel(catalog, resourceId)
  const kind = resourceId === ENERGY_RESOURCE_ID ? 'energy' : 'mana'
  return (
    <div className="hero-screen-pool-row">
      <div
        className="combat-hero-resource hero-screen-pool-bar"
        data-resource={kind}
        aria-label={`${label} pool`}
      >
        <span
          className="combat-hero-resource-fill"
          style={{
            width: `${
              max > 0
                ? Math.min(100, Math.max(0, (current / max) * 100))
                : 0
            }%`,
          }}
        />
        <span className="combat-hero-resource-text">
          {label} ({current} / {max})
        </span>
      </div>
      <span className="hero-screen-pool-regen">+{regenPerDay}/day</span>
    </div>
  )
}

export function HeroScreen({
  heroId,
  onClose,
  embedded = true,
}: HeroScreenProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const hero = session.heroes.find((row) => row.id === heroId) ?? null
  const disciplines =
    catalog && hero?.class_id != null ? classDisciplines(catalog, hero.class_id) : []
  const [disciplineId, setDisciplineId] = useState<number | null>(null)
  const learned = hero?.learned_abilities ?? []

  useEffect(() => {
    if (disciplines.length === 0) {
      setDisciplineId(null)
      return
    }
    if (disciplineId != null && disciplines.some((row) => row.id === disciplineId)) {
      return
    }
    setDisciplineId(disciplines[0]?.id ?? null)
  }, [disciplineId, disciplines, heroId])

  const passive = catalog && hero ? heroPassiveDisplay(catalog, hero) : ''
  const stats =
    catalog && hero ? heroEffectiveStatsForHero(catalog, hero) : null
  const statCells = catalog ? heroDisplayStats(catalog) : []
  const poolProfile =
    catalog && hero ? heroPoolRegenProfile(catalog, hero) : null
  const regen =
    catalog && hero ? heroDailyRegenEffective(catalog, hero) : null

  const body = (
    <div className="hero-screen-body" data-tip-contain>
      <section className="hero-screen-left" aria-label="Hero stats and abilities">
        <div className="hero-screen-left-top">
          <h2 className="hero-screen-section-title">Stats</h2>
          <div className="hero-stats-grid">
            {statCells.map(({ column, stat }) => {
              const tip = stat.description?.trim() ?? ''
              const label = (
                <span className="hero-stats-label">{stat.name}</span>
              )
              return (
                <div key={column} className="hero-stats-cell">
                  {tip ? (
                    <AbilityTip description={tip}>{label}</AbilityTip>
                  ) : (
                    label
                  )}
                  <span className="hero-stats-value">
                    {stats ? stats[column] : '—'}
                  </span>
                </div>
              )
            })}
          </div>
          {passive ? (
            <p className="hero-screen-passive">{passive}</p>
          ) : null}
          {poolProfile && regen ? (
            <div className="hero-screen-pools">
              {poolProfile.energy ? (
                <PoolBar
                  catalog={catalog}
                  hero={hero!}
                  resourceId={ENERGY_RESOURCE_ID}
                  regenPerDay={regen.energy}
                />
              ) : null}
              {poolProfile.mana ? (
                <PoolBar
                  catalog={catalog}
                  hero={hero!}
                  resourceId={MANA_RESOURCE_ID}
                  regenPerDay={regen.mana}
                />
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="hero-screen-left-bottom">
          <h2 className="hero-screen-section-title">
            {catalog ? heroAbilitiesHeader(catalog, hero) : 'Abilities'}
          </h2>
          {catalog ? (
            <HeroAbilitiesPanel
              catalog={catalog}
              learned={learned}
              disciplines={disciplines}
              disciplineId={disciplineId}
              onDisciplineId={setDisciplineId}
              hero={hero}
            />
          ) : null}
        </div>
      </section>
      <section className="hero-screen-right" aria-label="Inventory">
        {catalog && hero ? (
          <HeroInventory catalog={catalog} hero={hero} inCombat={false} />
        ) : null}
      </section>
    </div>
  )

  if (!embedded) {
    return (
      <div
        className="town-management hero-screen"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hero-screen-title"
        data-tip-contain
      >
        <header className="town-management-bar">
          <h1 id="hero-screen-title">{hero?.name ?? 'Hero'}</h1>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        {body}
      </div>
    )
  }

  return (
    <GameWindowOverlay className="hero-screen-embedded game-window-overlay-host">
      <GameWindowModal
        className="hero-screen-modal"
        aria-modal="true"
        aria-labelledby="hero-screen-title"
        onBackdropClick={onClose}
        data-tip-contain
      >
        <h1 id="hero-screen-title" className="hero-screen-title">
          {hero?.name ?? 'Hero'}
        </h1>
        {body}
      </GameWindowModal>
    </GameWindowOverlay>
  )
}
