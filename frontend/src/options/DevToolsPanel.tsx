import { useState } from 'react'
import {
  getSelectedMapHeroId,
  setHeroMovementRemaining,
  setMapCameraFollowMoves,
} from '../hex/HexMap'
import type { DataStatus } from '../hex/debug'
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

type DevToolsPanelProps = {
  onCopyDebug: () => void
  onSeeWorld?: () => void
  onClose?: () => void
  onStartFixedFight?: (kind: FixedFightKind) => void
  onLevelUpNotice?: (notice: LevelUpNotice | null) => void
  onDataStatus?: (status: DataStatus) => void
  onHudNotice?: (notice: string | null) => void
  inCombat?: boolean
}

export function DevToolsPanel({
  onCopyDebug,
  onSeeWorld,
  onClose,
  onStartFixedFight,
  onLevelUpNotice,
  onDataStatus,
  onHudNotice,
  inCombat = false,
}: DevToolsPanelProps) {
  const [reloading, setReloading] = useState(false)
  const [stepsUnlimited, setStepsUnlimited] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

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

  return (
    <div className="dev-tools-panel">
      {notice ? <p className="settings-hint">{notice}</p> : null}
      <div className="dev-tools-panel-actions">
        {onSeeWorld ? (
          <button type="button" onClick={() => { onSeeWorld(); onClose?.() }}>
            See World
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            updateSession(grantOpenChest)
            flash('Opened a chest: 10,000 Gold and 20 of each other resource')
          }}
        >
          Open Chest
        </button>
        <button
          type="button"
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
        <button
          type="button"
          onClick={() => {
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
          }}
        >
          Level Up
        </button>
        <button type="button" onClick={toggleSteps}>
          Steps: {stepsUnlimited ? String(STEPS_FLAT) : 'Hero Speed'}
        </button>
        <button
          type="button"
          onClick={() => {
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
          }}
        >
          Restore
        </button>
        {onStartFixedFight ? (
          <details className="dev-fixed-fight">
            <summary>Fixed Fight</summary>
            {fixedKinds.map((row) => (
              <button
                key={row.kind}
                type="button"
                onClick={() => {
                  onStartFixedFight(row.kind)
                  onClose?.()
                }}
              >
                {row.label}
              </button>
            ))}
          </details>
        ) : null}
        <button type="button" onClick={toggleSeeAi}>
          See AI: {seeAiOn ? 'On' : 'Off'}
        </button>
        <details className="dev-ai-arch">
          <summary>Set AI Archetype</summary>
          {aiPlayers.length === 0 ? (
            <p className="settings-hint">No AI players</p>
          ) : (
            aiPlayers.map((player) => (
              <div key={player.id}>
                <p>{aiPlayerLabel(player)}</p>
                {arches.map((arch) => (
                  <button
                    key={arch.id}
                    type="button"
                    className={
                      arch.id === player.arch_id ? 'is-active' : undefined
                    }
                    onClick={() =>
                      setAiPlayerArch(player.id, arch.id, arch.name)
                    }
                  >
                    {arch.name}
                  </button>
                ))}
              </div>
            ))
          )}
        </details>
        <button
          type="button"
          disabled={reloading}
          onClick={() => void onReloadReference()}
        >
          Reload Reference Data
        </button>
        <button
          type="button"
          onClick={() => {
            onCopyDebug()
            flash('Debug copied')
          }}
        >
          Copy Debug
        </button>
      </div>
      <DevItemsPanel inCombat={inCombat} onNotice={flash} />
    </div>
  )
}
