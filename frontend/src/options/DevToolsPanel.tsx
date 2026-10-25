import { useState, type ReactNode } from 'react'
import {
  getSelectedMapHeroId,
  setHeroMovementRemaining,
  setMapCameraFollowMoves,
} from '../hex/HexMap'
import type { DataStatus, DebugSections } from '../hex/debug'
import type { WorldRenderStats } from '../hex/worldRenderChunks'
import { getSession, setSession, updateSession } from '../session/store'
import {
  activePlayer,
  grantBuildArmy,
  grantBuildBasicBuildings,
  grantClassAbilitiesAtTier,
  grantOpenChest,
  grantUpgradeBuildings,
  restoreAllHeroMovement,
} from '../session/accessors'
import {
  awardHeroXp,
  levelUpNoticeForAward,
  type LevelUpNotice,
} from '../session/xp'
import {
  FLAT_HERO_MOVEMENT_STEPS,
  fetchCatalog,
  getCachedCatalog,
  heroResourcePools,
  reloadReferenceData,
} from '../town/catalog'
import { LIBRARY_TIERS } from '../town/libraryRules'
import { archName } from '../ai/weights'
import type { FixedFightKind } from '../session/fixedFight'
import { DevItemsPanel } from './DevItemsPanel'

const STEPS_FLAT = FLAT_HERO_MOVEMENT_STEPS

const FALLBACK_AI_ARCHES = [
  { id: 1, name: 'Build' },
  { id: 2, name: 'Explore' },
  { id: 3, name: 'Aggressive' },
  { id: 4, name: 'Defend' },
] as const

function aiArchRows() {
  const rows = getCachedCatalog()?.ai_arch ?? []
  if (rows.length > 0) {
    return [...rows].sort((a, b) => a.id - b.id)
  }
  return FALLBACK_AI_ARCHES.map((row) => ({ id: row.id, name: row.name }))
}

function aiPlayerLabel(player: { id: string; arch_id: number }): string {
  const slot = player.id.replace(/^player-/, '')
  return `P${slot} (${archName(getCachedCatalog(), player.arch_id)})`
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback
}

type DevToggle = { enabled: boolean; onToggle: () => void }

export type DevToolsPanelProps = {
  onClose?: () => void
  sections?: DebugSections
  worldPerf?: WorldRenderStats | null
  onCopyDebug: () => void
  onSeeWorld?: () => void
  onStartFixedFight?: (kind: FixedFightKind) => void
  onLevelUpNotice?: (notice: LevelUpNotice | null) => void
  onDataStatus?: (status: DataStatus) => void
  onHudNotice?: (notice: string | null) => void
  onAddStartingUnits?: () => void
  onAddWorldMobs?: () => void
  terrainWedgesDebug?: DevToggle
  zonesDebug?: DevToggle
  wallGapsDebug?: DevToggle
  roadPlanDebug?: DevToggle
  navalMaskDebug?: DevToggle
  townHexNumbers?: DevToggle
  aiTraces?: string[]
  inCombat?: boolean
}

type DevSectionId =
  | 'towns'
  | 'heroes'
  | 'combat'
  | 'ai'
  | 'items'
  | 'overlays'
  | 'gameSetup'

function DevSection({
  sectionId,
  title,
  openSection,
  setOpenSection,
  children,
}: {
  sectionId: DevSectionId
  title: string
  openSection: DevSectionId | null
  setOpenSection: (id: DevSectionId | null) => void
  children: ReactNode
}) {
  const open = openSection === sectionId
  return (
    <details className="dev-popup-section" open={open}>
      <summary
        onClick={(event) => {
          event.preventDefault()
          setOpenSection(open ? null : sectionId)
        }}
      >
        {title}
      </summary>
      <div className="dev-popup-stack">{children}</div>
    </details>
  )
}

function DevToggleButton({
  label,
  enabled,
  onToggle,
}: {
  label: string
  enabled: boolean
  onToggle: () => void
}) {
  return (
    <button type="button" className="dev-popup-btn" onClick={onToggle}>
      {label}: {enabled ? 'On' : 'Off'}
    </button>
  )
}

export function DevToolsPanel({
  onCopyDebug,
  onSeeWorld,
  onClose,
  onStartFixedFight,
  onLevelUpNotice,
  onDataStatus,
  onHudNotice,
  onAddStartingUnits,
  onAddWorldMobs,
  terrainWedgesDebug,
  zonesDebug,
  wallGapsDebug,
  roadPlanDebug,
  navalMaskDebug,
  townHexNumbers,
  aiTraces = [],
  sections,
  worldPerf,
  inCombat = false,
}: DevToolsPanelProps) {
  const [reloading, setReloading] = useState(false)
  const [stepsUnlimited, setStepsUnlimited] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [openSection, setOpenSection] = useState<DevSectionId | null>(null)

  const flash = (text: string) => {
    setNotice(text)
    onHudNotice?.(text)
    window.setTimeout(() => setNotice(null), 2500)
  }

  const onReloadReference = async () => {
    if (reloading) {
      return
    }
    setReloading(true)
    try {
      const status = await reloadReferenceData()
      onDataStatus?.(status)
      await fetchCatalog()
      setSession(restoreAllHeroMovement(getSession()))
      const session = getSession()
      const selectedId = getSelectedMapHeroId()
      const liveHero =
        (selectedId
          ? session.heroes.find((row) => row.id === selectedId)
          : undefined) ?? session.heroes[0]
      if (liveHero) {
        setHeroMovementRemaining(liveHero.movement_remaining)
      }
      flash(status.ok ? 'Reference data reloaded' : 'Reload finished with errors')
    } catch (err: unknown) {
      onDataStatus?.({
        ok: false,
        tables: [],
        fetchError: errorMessage(err, 'Reference data reload failed'),
      })
    } finally {
      setReloading(false)
    }
  }

  const toggleSteps = () => {
    const unlimited = !stepsUnlimited
    setStepsUnlimited(unlimited)
    if (unlimited) {
      updateSession((current) => ({
        ...current,
        game: {
          ...current.game,
          settings: { ...current.game.settings, move_mode: 'flat_100' },
        },
        heroes: current.heroes.map((hero) => ({
          ...hero,
          movement_remaining: STEPS_FLAT,
        })),
      }))
      setHeroMovementRemaining(STEPS_FLAT)
    } else {
      updateSession((current) => ({
        ...current,
        game: {
          ...current.game,
          settings: { ...current.game.settings, move_mode: 'hero_speed' },
        },
      }))
      setSession(restoreAllHeroMovement(getSession()))
    }
    flash(unlimited ? `Steps: ${STEPS_FLAT}` : 'Steps: Hero Speed')
  }

  const aiPlayers = getSession().players.filter((player) => player.is_ai)
  const arches = aiArchRows()
  const seeAiOn =
    aiPlayers.length > 0 && aiPlayers.every((player) => player.ai_spectator)

  const setAiPlayerArch = (playerId: string, archId: number, name: string) => {
    updateSession((current) => ({
      ...current,
      players: current.players.map((player) =>
        player.id === playerId && player.is_ai
          ? { ...player, arch_id: archId }
          : player,
      ),
    }))
    const slot = playerId.replace(/^player-/, '')
    flash(`P${slot} archetype set to ${name}`)
  }

  const toggleSeeAi = () => {
    if (aiPlayers.length === 0) {
      flash('No AI players in this game')
      return
    }
    const next = !seeAiOn
    updateSession((current) => ({
      ...current,
      players: current.players.map((player) =>
        player.is_ai ? { ...player, ai_spectator: next } : player,
      ),
    }))
    const actor = activePlayer(getSession())
    if (actor?.is_ai) {
      setMapCameraFollowMoves(next)
    }
    flash(next ? 'See AI: On' : 'See AI: Off')
  }

  const fixedKinds: { kind: FixedFightKind; label: string }[] = [
    { kind: 'pit_fiends', label: 'Pit Fiends' },
    { kind: 'raise_demons', label: 'Raise Demons' },
    { kind: 'holy_wrath', label: 'Holy Wrath' },
    { kind: 'for_the_hoard', label: 'For the Hoard' },
    { kind: 'fight_yourself', label: 'Fight Yourself' },
    { kind: 'boat_vs_boat', label: 'Boat vs Boat' },
    { kind: 'boat_vs_land', label: 'Boat vs Land' },
    { kind: 'land_vs_boat', label: 'Land vs Boat' },
  ]

  const restoreHeroPools = () => {
    const catalog = getCachedCatalog()
    if (!catalog) {
      flash('Catalog not loaded')
      return
    }
    const session = getSession()
    const selectedId = getSelectedMapHeroId()
    const hero =
      (selectedId
        ? session.heroes.find((row) => row.id === selectedId)
        : undefined) ?? session.heroes[0]
    if (!hero) {
      flash('No hero to restore')
      return
    }
    const pools = heroResourcePools(catalog, hero)
    updateSession((current) => ({
      ...current,
      heroes: current.heroes.map((row) =>
        row.id === hero.id
          ? {
              ...row,
              current_mana: pools.current_mana,
              current_energy: pools.current_energy,
            }
          : row,
      ),
    }))
    flash(
      `${hero.name}: Energy ${pools.current_energy}, Mana ${pools.current_mana}`,
    )
  }

  const levelUpHero = () => {
    const catalog = getCachedCatalog()
    if (!catalog) {
      flash('Catalog not loaded')
      return
    }
    const session = getSession()
    const selectedId = getSelectedMapHeroId()
    const hero =
      (selectedId
        ? session.heroes.find((row) => row.id === selectedId)
        : undefined) ?? session.heroes[0]
    if (!hero) {
      flash('No hero to level up')
      return
    }
    let levelNotice: LevelUpNotice | null = null
    updateSession((current) => {
      const awarded = awardHeroXp(current, catalog, hero.id, 1000)
      levelNotice = levelUpNoticeForAward(catalog, awarded)
      return awarded.session
    })
    if (levelNotice) {
      onLevelUpNotice?.(levelNotice)
    }
    flash(`${hero.name} +1000 XP`)
  }

  return (
    <div className="dev-tools-panel">
      {notice ? <p className="settings-hint dev-popup-notice">{notice}</p> : null}
      <div className="dev-popup-body">
        <button
          type="button"
          className="dev-popup-btn dev-popup-btn-primary"
          disabled={reloading}
          onClick={() => void onReloadReference()}
        >
          Reload Reference Data
        </button>

        <DevSection
          sectionId="towns"
          title="Towns"
          openSection={openSection}
          setOpenSection={setOpenSection}
        >
          <button
            type="button"
            className="dev-popup-btn"
            onClick={() => {
              const result = grantBuildBasicBuildings(getSession())
              setSession(result.session)
              flash(result.notice)
            }}
          >
            Build Basic Buildings
          </button>
          <button
            type="button"
            className="dev-popup-btn"
            onClick={() => {
              const result = grantBuildArmy(getSession(), 1)
              setSession(result.session)
              flash(result.notice)
            }}
          >
            Build Army 1
          </button>
          <button
            type="button"
            className="dev-popup-btn"
            onClick={() => {
              const result = grantBuildArmy(getSession(), 2)
              setSession(result.session)
              flash(result.notice)
            }}
          >
            Build Army 2
          </button>
          <button
            type="button"
            className="dev-popup-btn"
            onClick={() => {
              const result = grantUpgradeBuildings(getSession())
              setSession(result.session)
              flash(result.notice)
            }}
          >
            Upgrade Buildings
          </button>
          <button
            type="button"
            className="dev-popup-btn"
            onClick={() => {
              updateSession(grantOpenChest)
              flash('Opened a chest: 10,000 Gold and 20 of each other resource')
            }}
          >
            Open Chest
          </button>
        </DevSection>

        <DevSection
          sectionId="heroes"
          title="Heroes"
          openSection={openSection}
          setOpenSection={setOpenSection}
        >
          <button type="button" className="dev-popup-btn" onClick={toggleSteps}>
            Steps: {stepsUnlimited ? String(STEPS_FLAT) : 'Hero Speed'}
          </button>
          <button type="button" className="dev-popup-btn" onClick={levelUpHero}>
            Level Up
          </button>
          <button
            type="button"
            className="dev-popup-btn"
            onClick={() => {
              updateSession((current) => {
                let next = current
                for (const tier of LIBRARY_TIERS) {
                  next = grantClassAbilitiesAtTier(next, tier)
                }
                return next
              })
              flash('Every hero learned all abilities from their two disciplines')
            }}
          >
            Learn
          </button>
          {onAddStartingUnits ? (
            <button
              type="button"
              className="dev-popup-btn"
              onClick={onAddStartingUnits}
            >
              Add Starting Units
            </button>
          ) : null}
          <button
            type="button"
            className="dev-popup-btn"
            onClick={restoreHeroPools}
          >
            Restore Mana &amp; Energy
          </button>
        </DevSection>

        <DevSection
          sectionId="combat"
          title="Combat"
          openSection={openSection}
          setOpenSection={setOpenSection}
        >
          {onStartFixedFight
            ? fixedKinds.map((row) => (
                <button
                  key={row.kind}
                  type="button"
                  className="dev-popup-btn"
                  onClick={() => {
                    onStartFixedFight(row.kind)
                    onClose?.()
                  }}
                >
                  Fixed Fight: {row.label}
                </button>
              ))
            : null}
          {navalMaskDebug ? (
            <DevToggleButton
              label="Naval Mask"
              enabled={navalMaskDebug.enabled}
              onToggle={navalMaskDebug.onToggle}
            />
          ) : null}
          <button
            type="button"
            className="dev-popup-btn"
            onClick={() => {
              onCopyDebug()
              flash('Debug copied')
            }}
          >
            Copy Debug
          </button>
        </DevSection>

        <DevSection
          sectionId="ai"
          title="AI"
          openSection={openSection}
          setOpenSection={setOpenSection}
        >
          <button type="button" className="dev-popup-btn" onClick={toggleSeeAi}>
            See AI: {seeAiOn ? 'On' : 'Off'}
          </button>
          {aiPlayers.length === 0 ? (
            <p className="settings-hint">No AI players</p>
          ) : (
            aiPlayers.map((player) => (
              <div key={player.id} className="dev-popup-ai-player">
                <p className="dev-popup-ai-player-label">{aiPlayerLabel(player)}</p>
                <div className="dev-popup-stack dev-popup-stack-inline">
                  {arches.map((arch) => (
                    <button
                      key={arch.id}
                      type="button"
                      className={`dev-popup-btn${
                        arch.id === player.arch_id ? ' is-active' : ''
                      }`}
                      onClick={() =>
                        setAiPlayerArch(player.id, arch.id, arch.name)
                      }
                    >
                      {arch.name}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
          {aiTraces.length > 0 ? (
            <pre className="dev-popup-pre dev-ai-traces-pre">
              {aiTraces.flatMap((block) => block.split('\n')).join('\n')}
            </pre>
          ) : null}
        </DevSection>

        <DevSection
          sectionId="items"
          title="Items"
          openSection={openSection}
          setOpenSection={setOpenSection}
        >
          <DevItemsPanel inCombat={inCombat} onNotice={flash} section="all" />
        </DevSection>

        <DevSection
          sectionId="overlays"
          title="Overlays"
          openSection={openSection}
          setOpenSection={setOpenSection}
        >
          {onSeeWorld ? (
            <button
              type="button"
              className="dev-popup-btn"
              onClick={() => {
                onSeeWorld()
                onClose?.()
              }}
            >
              See World
            </button>
          ) : null}
          {terrainWedgesDebug ? (
            <DevToggleButton
              label="Terrain Wedges"
              enabled={terrainWedgesDebug.enabled}
              onToggle={terrainWedgesDebug.onToggle}
            />
          ) : null}
          {zonesDebug ? (
            <DevToggleButton
              label="Zones"
              enabled={zonesDebug.enabled}
              onToggle={zonesDebug.onToggle}
            />
          ) : null}
          {wallGapsDebug ? (
            <DevToggleButton
              label="Wall gaps"
              enabled={wallGapsDebug.enabled}
              onToggle={wallGapsDebug.onToggle}
            />
          ) : null}
          {roadPlanDebug ? (
            <DevToggleButton
              label="Road plan"
              enabled={roadPlanDebug.enabled}
              onToggle={roadPlanDebug.onToggle}
            />
          ) : null}
          {townHexNumbers ? (
            <DevToggleButton
              label="Town hex numbers"
              enabled={townHexNumbers.enabled}
              onToggle={townHexNumbers.onToggle}
            />
          ) : null}
          {onAddWorldMobs ? (
            <button
              type="button"
              className="dev-popup-btn"
              onClick={onAddWorldMobs}
            >
              Add World Mobs to Current Map
            </button>
          ) : null}
          {worldPerf ? (
            <pre className="dev-popup-pre dev-popup-perf">
              {`FPS: ${worldPerf.fps.toFixed(0)}  frame: ${worldPerf.frameMs.toFixed(1)}ms  avg: ${worldPerf.avgFrameMs.toFixed(1)}ms
display objects: ${worldPerf.displayObjectsVisible} visible / ${worldPerf.displayObjectsTotal} total`}
            </pre>
          ) : null}
        </DevSection>

        {sections ? (
          <DevSection
            sectionId="gameSetup"
            title="Game Setup"
            openSection={openSection}
            setOpenSection={setOpenSection}
          >
            <pre className="dev-popup-pre">{sections.gameSetup}</pre>
            {sections.rest.trim() ? (
              <pre className="dev-popup-pre">{sections.rest}</pre>
            ) : null}
          </DevSection>
        ) : null}
      </div>
    </div>
  )
}
