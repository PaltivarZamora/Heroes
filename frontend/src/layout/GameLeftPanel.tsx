import { useEffect, useRef, useState, type ReactNode, type WheelEvent } from 'react'
import { useSyncExternalStore } from 'react'
import { featureArtUrl } from '../hex/featureTextures'
import { featureForTownType } from '../hex/townFootprint'
import { AbilityTip } from '../town/AbilityTip'
import { ArmyTransfer } from '../town/ArmyTransfer'
import {
  GARRISON_ART_FILENAME,
  heroPortraitUrl,
} from '../town/slotArt'
import { garrisonTooltipText } from '../town/garrisonTooltip'
import { heroTooltipText } from '../town/HeroTooltip'
import {
  findTownById,
  humanPlayer,
  visitingHeroId,
} from '../session/accessors'
import { getSession, subscribe } from '../session/store'
import type { GameSession, Hero, Town } from '../session/types'
import type { ArmyRowSpec } from '../town/ArmyTransfer'
import { getCachedCatalog, subscribeCatalog } from '../town/catalog'
import { townTooltipText } from './townTooltip'
import {
  LEFT_PANEL_HEIGHT,
  LEFT_PANEL_WIDTH,
  LEFT_PANEL_X,
  LEFT_PANEL_Y,
  PANEL_COLS,
  PANEL_GAP,
  PANEL_ROWS,
  PANEL_SQUARE,
} from './stageConstants'

type GameLeftPanelProps = {
  activeTownId: string | null
  selectedHeroId: string | null
  townScreenOpen: boolean
  tradePartnerHeroId: string | null
  visitingHeroName: string
  hasActedToday: boolean
  readOnly: boolean
  onSelectTown: (townId: string) => void
  onSelectHero: (heroId: string) => void
  onOpenHero: () => void
  dimTowns?: boolean
  dimHeroes?: boolean
  dimArmy?: boolean
  heroStepsLabel?: string | null
}

function ScrollColumn({
  className,
  children,
  dimmed,
}: {
  className: string
  children: ReactNode
  dimmed?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const scrollBy = (delta: number) => {
    ref.current?.scrollBy({ top: delta, behavior: 'smooth' })
  }
  const onWheel = (event: WheelEvent) => {
    const el = ref.current
    if (!el) {
      return
    }
    el.scrollTop += event.deltaY
  }
  return (
    <div className={`game-panel-column ${className}${dimmed ? ' game-ui-dimmed' : ''}`}>
      <button
        type="button"
        className="game-panel-scroll-btn game-panel-scroll-btn-up"
        aria-label="Scroll up"
        onClick={() => scrollBy(-(PANEL_SQUARE + PANEL_GAP))}
      >
        ▲
      </button>
      <div ref={ref} className="game-panel-scroll" onWheel={onWheel}>
        {children}
      </div>
      <button
        type="button"
        className="game-panel-scroll-btn game-panel-scroll-btn-down"
        aria-label="Scroll down"
        onClick={() => scrollBy(PANEL_SQUARE + PANEL_GAP)}
      >
        ▼
      </button>
    </div>
  )
}

function TownTypeIcon({
  townTypeId,
  townLabel,
}: {
  townTypeId: number
  townLabel: string
}) {
  const catalog = getCachedCatalog()
  const [missing, setMissing] = useState(false)
  const feature = featureForTownType(catalog, townTypeId)
  const typeName =
    catalog?.town.find((row) => row.id === townTypeId)?.name?.trim() ?? ''
  const file =
    feature?.image_path?.trim() ||
    (typeName ? `${typeName}.png` : '')
  const src = file ? featureArtUrl(file) : null
  const triedPath = src ?? `/assets/features/${file || '?'}`

  useEffect(() => {
    setMissing(false)
  }, [townTypeId, file])

  if (!src || missing) {
    return (
      <span
        className="game-panel-town-fallback"
        title={missing ? `Missing: ${triedPath}` : townLabel}
      >
        {townLabel}
      </span>
    )
  }
  return (
    <img
      src={src}
      alt=""
      className="game-panel-town-img"
      title={triedPath}
      onError={() => setMissing(true)}
    />
  )
}

function HeroListPortrait({
  imagePath,
  name,
}: {
  imagePath: string | null
  name: string
}) {
  const [missing, setMissing] = useState(false)
  if (!imagePath || missing) {
    return <span className="game-panel-hero-fallback">{name}</span>
  }
  return (
    <img
      src={heroPortraitUrl(imagePath)}
      alt=""
      className="game-panel-hero-img"
      onError={() => setMissing(true)}
    />
  )
}

function EmptyArmyColumn() {
  return (
    <div className="game-panel-army-column game-panel-army-column-empty">
      {Array.from({ length: PANEL_ROWS }, (_, index) => (
        <div
          key={index}
          className="town-army-box town-army-slot town-army-slot-static town-army-slot-pad"
          aria-hidden={true}
        />
      ))}
    </div>
  )
}

function playerTowns(session: GameSession) {
  const player = humanPlayer(session)
  if (!player) {
    return []
  }
  const owned = new Set(player.town_ids ?? [])
  if (owned.size === 0) {
    return session.towns.filter((town) => town.player_id === player.id)
  }
  return session.towns.filter((town) => owned.has(town.id))
}

function otherHeroes(session: GameSession, activeHeroId: string | null) {
  const player = humanPlayer(session)
  if (!player) {
    return []
  }
  const roster = new Set(player.hero_ids ?? [])
  return session.heroes.filter(
    (hero) =>
      hero.player_id === player.id &&
      hero.id !== activeHeroId &&
      (roster.size === 0 || roster.has(hero.id)),
  )
}

function friendlyHeroesOnTown(session: GameSession, town: Town): Hero[] {
  const player = humanPlayer(session)
  if (!player) {
    return []
  }
  return session.heroes.filter(
    (hero) =>
      hero.player_id === player.id &&
      !hero.flight &&
      hero.position.q === town.position.q &&
      hero.position.r === town.position.r,
  )
}

function townAtHero(session: GameSession, heroId: string | null): Town | undefined {
  if (!heroId) {
    return undefined
  }
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero || hero.flight) {
    return undefined
  }
  return session.towns.find(
    (town) =>
      town.position.q === hero.position.q && town.position.r === hero.position.r,
  )
}

export function GameLeftPanel({
  activeTownId,
  selectedHeroId,
  townScreenOpen,
  tradePartnerHeroId,
  visitingHeroName,
  hasActedToday,
  readOnly,
  onSelectTown,
  onSelectHero,
  onOpenHero,
  dimTowns,
  dimHeroes,
  dimArmy,
  heroStepsLabel,
}: GameLeftPanelProps) {
  const session = useSyncExternalStore(subscribe, getSession)
  useSyncExternalStore(subscribeCatalog, getCachedCatalog)
  const catalog = getCachedCatalog()
  const towns = playerTowns(session)
  const heroes = otherHeroes(session, selectedHeroId)
  const townId = activeTownId ?? towns[0]?.id ?? ''
  const panelTown = townId ? findTownById(session, townId) : undefined
  const heroTown = townAtHero(session, selectedHeroId)
  const armyTown = townScreenOpen && panelTown
    ? panelTown
    : tradePartnerHeroId || heroTown
      ? heroTown ?? panelTown
      : undefined
  const activeHero = selectedHeroId
    ? session.heroes.find((row) => row.id === selectedHeroId) ?? null
    : null
  const selectedOnArmyTown =
    armyTown && selectedHeroId
      ? visitingHeroId(session, armyTown, selectedHeroId) === selectedHeroId
      : false
  const onTownHeroes = armyTown ? friendlyHeroesOnTown(session, armyTown) : []
  const otherOnTown =
    armyTown && selectedHeroId
      ? onTownHeroes.find((hero) => hero.id !== selectedHeroId) ?? null
      : onTownHeroes[0] ?? null
  const [col3ShowsOther, setCol3ShowsOther] = useState(false)
  useEffect(() => {
    setCol3ShowsOther(false)
  }, [townId, selectedHeroId, tradePartnerHeroId, townScreenOpen])

  const gridInnerWidth = PANEL_COLS * PANEL_SQUARE + (PANEL_COLS - 1) * PANEL_GAP
  const gridInnerHeight = PANEL_ROWS * PANEL_SQUARE + (PANEL_ROWS - 1) * PANEL_GAP

  let col3Row: ArmyRowSpec | null = null
  let col4Row: ArmyRowSpec | null = null
  const transferTownId = (armyTown?.id ?? townId) || towns[0]?.id || ''

  if (catalog && transferTownId) {
    if (tradePartnerHeroId) {
      const partner =
        session.heroes.find((row) => row.id === tradePartnerHeroId) ?? null
      if (partner) {
        col3Row = {
          row: 'hero',
          heroId: partner.id,
          portraitLabel: partner.name,
          portraitFilename: partner.image_path,
          portraitTip: heroTooltipText(catalog, partner, session),
          orientation: 'vertical',
          showPortrait: true,
          padSlotsTo: 8,
        }
      }
    } else if (townScreenOpen || heroTown) {
      const useOther =
        Boolean(otherOnTown) &&
        selectedOnArmyTown &&
        col3ShowsOther &&
        otherOnTown
      if (useOther && otherOnTown) {
        col3Row = {
          row: 'hero',
          heroId: otherOnTown.id,
          portraitLabel: otherOnTown.name,
          portraitFilename: otherOnTown.image_path,
          portraitTip: heroTooltipText(catalog, otherOnTown, session),
          orientation: 'vertical',
          showPortrait: true,
          padSlotsTo: 8,
          onPortraitClick: () => setCol3ShowsOther(false),
        }
      } else {
        col3Row = {
          row: 'garrison',
          portraitLabel: 'Garrison',
          portraitFilename: GARRISON_ART_FILENAME,
          portraitTip: garrisonTooltipText(
            catalog,
            session,
            transferTownId,
            hasActedToday,
          ),
          orientation: 'vertical',
          showPortrait: true,
          padSlotsTo: 8,
          showBuyAll: true,
          onPortraitClick:
            otherOnTown && selectedOnArmyTown
              ? () => setCol3ShowsOther(true)
              : undefined,
        }
      }
    }

    if (activeHero && selectedHeroId) {
      col4Row = {
        row: 'hero',
        heroId: selectedHeroId,
        portraitLabel: activeHero.name ?? visitingHeroName,
        portraitFilename: activeHero.image_path,
        portraitTip: heroTooltipText(catalog, activeHero, session),
        orientation: 'vertical',
        showPortrait: true,
        padSlotsTo: 8,
        onPortraitClick: onOpenHero,
        portraitOverlay: heroStepsLabel ?? undefined,
      }
    }
  }

  return (
    <aside
      className="game-left-panel"
      data-tip-contain=""
      style={{
        left: LEFT_PANEL_X,
        top: LEFT_PANEL_Y,
        width: LEFT_PANEL_WIDTH,
        height: LEFT_PANEL_HEIGHT,
      }}
    >
      <div
        className="game-left-panel-grid"
        style={{ width: gridInnerWidth, height: gridInnerHeight }}
      >
        <ScrollColumn className="game-panel-towns" dimmed={dimTowns}>
          {towns.map((row) => {
            const active = row.id === townId
            const tip = townTooltipText(catalog, session, row)
            const btn = (
              <button
                type="button"
                className={`game-panel-square${active ? ' is-active' : ''}`}
                onClick={() => onSelectTown(row.id)}
              >
                <TownTypeIcon
                  townTypeId={row.town_type_id}
                  townLabel={row.name}
                />
                <span className="game-panel-town-name">{row.name}</span>
              </button>
            )
            return (
              <AbilityTip key={row.id} description={tip} placement="portal-right">
                {btn}
              </AbilityTip>
            )
          })}
        </ScrollColumn>

        <ScrollColumn className="game-panel-heroes" dimmed={dimHeroes}>
          {heroes.map((row) => {
            const tip = catalog ? heroTooltipText(catalog, row, session) : null
            const btn = (
              <button
                type="button"
                className="game-panel-square"
                onClick={() => onSelectHero(row.id)}
              >
                <HeroListPortrait imagePath={row.image_path} name={row.name} />
                <span className="game-panel-town-name">{row.name}</span>
              </button>
            )
            return tip ? (
              <AbilityTip key={row.id} description={tip} placement="portal-right">
                {btn}
              </AbilityTip>
            ) : (
              <span key={row.id}>{btn}</span>
            )
          })}
        </ScrollColumn>

        <div
          className={`game-panel-army-dock${dimArmy || readOnly ? ' game-ui-dimmed' : ''}`}
        >
          {catalog && transferTownId && (col3Row || col4Row) ? (
            <ArmyTransfer
              session={session}
              townId={transferTownId}
              catalog={catalog}
              primaryHeroId={selectedHeroId}
              readOnly={readOnly}
              rows={[...(col3Row ? [col3Row] : []), ...(col4Row ? [col4Row] : [])]}
            />
          ) : (
            <>
              <EmptyArmyColumn />
              <EmptyArmyColumn />
            </>
          )}
        </div>
      </div>
    </aside>
  )
}
