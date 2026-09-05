import { useEffect, useState, useSyncExternalStore } from 'react'
import { formatResourceLine, RESOURCES } from '../hex/resources'
import { humanPlayer, walletFromSession } from '../session/accessors'
import { getSession, subscribe } from '../session/store'
import { getCachedCatalog, formatHeroLevelLine, heroEffectiveStats, heroTypeName, subscribeCatalog } from './catalog'
import { classDisciplines } from './libraryRules'
import { HeroAbilitiesPanel } from './HeroAbilitiesPanel'
import { ReservedCorner } from './ReservedCorner'
import {
  GENERIC_EMPTY_ART_FILENAME,
  heroPortraitUrl,
  itemArtUrl,
} from './slotArt'

const STAT_CELLS: Array<{ key: keyof ReturnType<typeof heroEffectiveStats>; label: string }> = [
  { key: 'speed', label: 'Speed' },
  { key: 'stamina', label: 'Stamina' },
  { key: 'strength', label: 'Strength' },
  { key: 'intel', label: 'Intelligence' },
  { key: 'defense', label: 'Defense' },
  { key: 'resist', label: 'Resistance' },
  { key: 'crit_pct', label: 'Crit Chance' },
  { key: 'crit_amt', label: 'Crit Amount' },
]
const PAPERDOLL_FILE = 'paperdoll.png'
const EQUIP_SLOTS = 6
const PACK_SLOTS = 15

type HeroScreenProps = {
  heroId: string
  onClose: () => void
  onSelectHero: (heroId: string) => void
  onOpenHero?: (heroId?: string | null) => void
  onCycleTown?: () => void
}

function Face({
  filename,
  label,
  large,
}: {
  filename: string | null
  label: string
  large?: boolean
}) {
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    setMissing(false)
  }, [filename])
  if (!filename || missing) {
    return (
      <span className="town-building-slot-filename">{filename || label}</span>
    )
  }
  return (
    <img
      className={large ? 'hero-screen-portrait-img' : undefined}
      src={heroPortraitUrl(filename)}
      alt={label}
      onError={() => setMissing(true)}
    />
  )
}

function PackSlotFace() {
  const [missing, setMissing] = useState(false)
  if (missing) {
    return (
      <span className="town-building-slot-filename">
        {GENERIC_EMPTY_ART_FILENAME}
      </span>
    )
  }
  return (
    <img
      src={itemArtUrl(GENERIC_EMPTY_ART_FILENAME)}
      alt=""
      onError={() => setMissing(true)}
    />
  )
}

export function HeroScreen({
  heroId,
  onClose,
  onSelectHero,
  onOpenHero,
  onCycleTown,
}: HeroScreenProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  const catalog = useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const wallet = walletFromSession(session)
  const player = humanPlayer(session)
  const hero = session.heroes.find((row) => row.id === heroId) ?? null
  const disciplines =
    catalog && hero?.class_id != null ? classDisciplines(catalog, hero.class_id) : []
  const [disciplineId, setDisciplineId] = useState<number | null>(null)
  const [scrollsOpen, setScrollsOpen] = useState(false)
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

  useEffect(() => {
    if (!scrollsOpen) {
      return
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      setScrollsOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [scrollsOpen])

  const ownedIds = player?.hero_ids ?? []
  const portraitSlots = Array.from({ length: 14 }, (_, index) => ownedIds[index] ?? null)
  const typeName = catalog ? heroTypeName(catalog, hero?.class_id ?? null) : ''
  const abilitiesTitle = typeName ? `${typeName} Abilities` : 'Abilities'
  const level = hero?.current_level ?? 1
  const xp = hero?.current_xp ?? 0
  const identityLine = formatHeroLevelLine(
    catalog,
    hero?.name ?? 'Hero',
    level,
    xp,
  )
  const stats = catalog
    ? heroEffectiveStats(catalog, hero?.class_id ?? null, level)
    : null

  return (
    <div
      className="town-management hero-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="hero-screen-title"
    >
      <header className="town-management-bar">
        <h1 id="hero-screen-title">Hero</h1>
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
      <div className="hero-screen-body">
        <section className="hero-screen-panel hero-screen-abilities" aria-label={abilitiesTitle}>
          <div className="hero-stats-block">
            <h2>Hero Stats</h2>
            <div className="hero-stats-grid">
              {STAT_CELLS.map((cell) => (
                <div key={cell.key} className="hero-stats-cell">
                  <span className="hero-stats-label">{cell.label}</span>
                  <span className="hero-stats-value">
                    {stats ? stats[cell.key] : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <h2>{abilitiesTitle}</h2>
          {catalog ? (
            <HeroAbilitiesPanel
              catalog={catalog}
              learned={learned}
              disciplines={disciplines}
              disciplineId={disciplineId}
              onDisciplineId={setDisciplineId}
            />
          ) : null}
        </section>
        <section className="hero-screen-panel hero-screen-right" aria-label="Hero">
          <div className="hero-screen-identity">
            <h2>{identityLine}</h2>
          </div>
          <div className="hero-paperdoll-wrap" aria-hidden="true">
            <div className="hero-equip-col">
              {Array.from({ length: EQUIP_SLOTS / 2 }, (_, i) => (
                <div key={`l${i}`} className="hero-equip-slot" />
              ))}
            </div>
            <div className="hero-paperdoll">
              <Face filename={PAPERDOLL_FILE} label="paperdoll.png" large />
            </div>
            <div className="hero-equip-col">
              {Array.from({ length: EQUIP_SLOTS / 2 }, (_, i) => (
                <div key={`r${i}`} className="hero-equip-slot" />
              ))}
            </div>
          </div>
          <div className="hero-pack" aria-hidden="true">
            {Array.from({ length: PACK_SLOTS }, (_, i) => (
              <div key={i} className="hero-pack-slot">
                <PackSlotFace />
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="town-bottom-dock">
        <ReservedCorner
          onHero={() => onOpenHero?.(heroId)}
          onTown={() => onCycleTown?.()}
          onScrolls={() => setScrollsOpen(true)}
        />
        <div className="town-army-rows" aria-label="Owned heroes">
          {[0, 1].map((row) => (
            <div key={row} className="town-army-row">
              {portraitSlots.slice(row * 7, row * 7 + 7).map((id, col) => {
                if (!id) {
                  return (
                    <div
                      key={`empty-${row}-${col}`}
                      className="town-army-box town-army-portrait"
                    />
                  )
                }
                const other = session.heroes.find((rowHero) => rowHero.id === id)
                const selected = id === heroId
                return (
                  <button
                    key={id}
                    type="button"
                    className={
                      selected
                        ? 'town-army-box town-army-portrait active'
                        : 'town-army-box town-army-portrait'
                    }
                    aria-label={other?.name ?? 'Hero'}
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => onSelectHero(id)}
                  >
                    <Face
                      filename={other?.image_path ?? null}
                      label={other?.name ?? 'Hero'}
                    />
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      {scrollsOpen ? (
        <div
          className="town-management marketplace-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hero-scrolls-title"
        >
          <header className="town-management-bar">
            <h1 id="hero-scrolls-title">Scrolls</h1>
            <button type="button" onClick={() => setScrollsOpen(false)}>
              Close
            </button>
          </header>
        </div>
      ) : null}
    </div>
  )
}
