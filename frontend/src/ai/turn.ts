import { requestMapMove, requestPlayHeroFlight, selectHeroOnMap, setHeroMovementRemaining, setMapCameraFollowMoves, setMapInputLocked, syncActivePlayerView } from '../hex/HexMap'
import { spendHeroInteract } from '../hex/hero'
import { hexDistance } from '../hex/pathfinding'
import {
  activePlayer,
  findChestById,
  launchHeroFlight,
  openChest,
  syncHero,
} from '../session/accessors'
import { aiChestChoice, claimChest } from '../session/chest'
import { seedStartingVision } from '../session/create'
import {
  boardBoat,
  buyBoatAtDock,
  disembarkBoat,
  findWorldDockById,
} from '../session/boat'
import {
  acceptNoticeBoardQuest,
  collectQuestReward,
  findNoticeBoardById,
} from '../session/quests'
import {
  aiRecruitFromWorldRecruits,
  findWorldRecruitsById,
} from '../session/recruits'
import { readSign } from '../session/sign'
import { getSession, updateSession } from '../session/store'
import { getCachedCatalog } from '../town/catalog'
import { decideAndApplyArmyAlloc, decideAndApplyHeroTrade } from './armyAlloc'
import { decideAndApplyLibraryLearn, decideAndApplyWorldLibraryLearn, ensurePlayerLibraryOffers } from './libraryLearn'
import { questVisitFeatureIds } from './noticeBoard'
import { appendAiTrace } from './trace'
import { decideAndApplyTownBuild } from './townBuild'
import { decideWorldMove, worldAttackPos, type WorldAttackTarget } from './worldMove'

export type AiTurnMode = 'ai' | 'ai_spectator'

const MAX_WORLD_ACTIONS = 24

export function aiTurnModeOf(player: {
  is_ai: boolean
  ai_spectator: boolean
}): AiTurnMode | null {
  if (!player.is_ai) {
    return null
  }
  return player.ai_spectator ? 'ai_spectator' : 'ai'
}

function samePos(
  a: { q: number; r: number },
  b: { q: number; r: number },
): boolean {
  return a.q === b.q && a.r === b.r
}

function applyNoticeBoardArrival(
  playerId: string,
  heroId: string,
  intent: {
    featureId: string
    purpose: 'scout_accept' | 'collect'
  },
): void {
  const session = getSession()
  const catalog = getCachedCatalog()
  const board = findNoticeBoardById(session, intent.featureId)
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!catalog || !board || !hero || hero.player_id !== playerId) {
    return
  }
  if (hexDistance(hero.position, board.position) > 1) {
    return
  }
  if (intent.purpose === 'collect') {
    let error: string | null = null
    updateSession((current) => {
      const result = collectQuestReward(
        current,
        catalog,
        intent.featureId,
        playerId,
        heroId,
      )
      error = result.error
      return result.error ? current : result.session
    })
    appendAiTrace(
      error
        ? `AI world_move — ${hero.name} collect notice board ${intent.featureId} failed: ${error}`
        : `AI world_move — ${hero.name} collects notice board ${intent.featureId}`,
    )
    return
  }
  // Always accept; never decline (BR S9-11).
  let error: string | null = null
  updateSession((current) => {
    const result = acceptNoticeBoardQuest(
      current,
      catalog,
      intent.featureId,
      playerId,
      heroId,
    )
    error = result.error
    return result.error ? current : result.session
  })
  appendAiTrace(
    error
      ? `AI world_move — ${hero.name} accept notice board ${intent.featureId} failed: ${error}`
      : `AI world_move — ${hero.name} accepts notice board ${intent.featureId}`,
  )
}

/** Visit-feature signs: approach via explore, then read (credits quest). */
function tryAiQuestSignVisit(playerId: string, heroId: string): void {
  const session = getSession()
  const catalog = getCachedCatalog()
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!catalog || !hero || hero.player_id !== playerId) {
    return
  }
  const visits = questVisitFeatureIds(session, playerId)
  for (const featureId of visits) {
    const feature = (session.features ?? []).find((row) => row.id === featureId)
    if (!feature || feature.kind !== 'sign') {
      continue
    }
    if (hexDistance(hero.position, feature.position) > 1) {
      continue
    }
    updateSession((current) => {
      const result = readSign(current, catalog, featureId, heroId)
      return result?.session ?? current
    })
    appendAiTrace(
      `AI world_move — ${hero.name} reads quest sign ${featureId}`,
    )
  }
}

function tryAiHeroTrade(
  player: { id: string },
  heroId: string,
  traded: Set<string>,
): void {
  const session = getSession()
  const actor = activePlayer(session)
  if (!actor) {
    return
  }
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero) {
    return
  }
  const other = session.heroes.find(
    (row) =>
      row.id !== hero.id &&
      row.player_id === player.id &&
      hexDistance(hero.position, row.position) <= 1,
  )
  if (!other) {
    return
  }
  const key = [hero.id, other.id].sort().join('|')
  if (traded.has(key)) {
    return
  }
  traded.add(key)
  const spent = spendHeroInteract(hero.movement_remaining)
  updateSession((current) => ({
    ...current,
    heroes: current.heroes.map((row) =>
      row.id === hero.id ? { ...row, movement_remaining: spent } : row,
    ),
  }))
  setHeroMovementRemaining(spent)
  decideAndApplyHeroTrade(actor, hero, other)
}

/**
 * One locally-reasonable AI turn: army/garrison reorg if already in town,
 * then chain world moves until MP is spent (each owned hero independently),
 * then town builds including a possible tavern hire.
 * Attack intents (mobs / enemy heroes / towns) open Combat when hooked.
 * Spectator does not auto-end the turn.
 */
export async function runAiTurn(
  mode: AiTurnMode,
  hooks?: {
    engageWorldAttack?: (
      heroId: string,
      target: WorldAttackTarget,
    ) => Promise<void>
  },
): Promise<void> {
  const session = getSession()
  const player = activePlayer(session)
  if (!player?.is_ai) {
    return
  }
  setMapInputLocked(true)
  setMapCameraFollowMoves(mode === 'ai_spectator')
  updateSession(seedStartingVision)
  syncActivePlayerView()
  ensurePlayerLibraryOffers(player.id)
  const heroIds = getSession()
    .heroes.filter((row) => row.player_id === player.id)
    .map((row) => row.id)
  const traded = new Set<string>()
  if (heroIds.length === 0) {
    appendAiTrace(`AI world_move — ${player.id} has no hero`)
  } else {
    for (const heroId of heroIds) {
      const hero =
        getSession().heroes.find((row) => row.id === heroId) ?? null
      if (!hero || hero.flight) {
        continue
      }
      selectHeroOnMap(hero.id)
      decideAndApplyArmyAlloc(
        activePlayer(getSession()) ?? player,
        hero,
      )
      decideAndApplyLibraryLearn(
        activePlayer(getSession()) ?? player,
        hero,
      )
      tryAiHeroTrade(player, hero.id, traded)
      for (let n = 0; n < MAX_WORLD_ACTIONS; n += 1) {
        const live =
          getSession().heroes.find((row) => row.id === hero.id) ?? null
        if (!live || live.movement_remaining <= 1e-9) {
          break
        }
        const actor = activePlayer(getSession()) ?? player
        const intent = decideWorldMove(getSession(), actor, live)
        if (!intent) {
          break
        }
        if (
          (intent.kind === 'return' ||
            intent.kind === 'explore' ||
            intent.kind === 'seek_library' ||
            intent.kind === 'seek_hanger' ||
            intent.kind === 'seek_dock' ||
            intent.kind === 'seek_recruits' ||
            intent.kind === 'seek_notice_board' ||
            intent.kind === 'board_boat') &&
          samePos(live.position, intent.dest)
        ) {
          if (intent.kind === 'seek_library') {
            if (intent.featureId) {
              decideAndApplyWorldLibraryLearn(actor, live, intent.featureId)
            } else {
              decideAndApplyLibraryLearn(actor, live)
            }
          }
          if (intent.kind === 'seek_dock') {
            const dock = findWorldDockById(getSession(), intent.featureId)
            if (dock && hexDistance(live.position, dock.position) <= 1) {
              updateSession((current) =>
                buyBoatAtDock(current, intent.featureId, player.id).session,
              )
              appendAiTrace(
                `AI world_move — ${live.name} buys boat at dock ${intent.featureId}`,
              )
            }
          }
          if (intent.kind === 'seek_recruits') {
            const catalog = getCachedCatalog()
            const recruits = findWorldRecruitsById(
              getSession(),
              intent.featureId,
            )
            if (catalog && recruits && hexDistance(live.position, recruits.position) <= 1) {
              let recruitError: string | null = null
              let recruitQty = 0
              updateSession((current) => {
                const result = aiRecruitFromWorldRecruits(
                  current,
                  catalog,
                  intent.featureId,
                  live.id,
                )
                recruitError = result.error
                recruitQty = result.qty
                return result.session
              })
              appendAiTrace(
                recruitQty > 0
                  ? `AI world_move — ${live.name} recruits at ${intent.featureId} ×${recruitQty}`
                  : `AI world_move — ${live.name} scouts recruits ${intent.featureId}${recruitError ? ` (${recruitError})` : ''}`,
              )
            }
          }
          if (intent.kind === 'seek_notice_board') {
            applyNoticeBoardArrival(player.id, live.id, intent)
          }
          if (intent.kind === 'board_boat') {
            updateSession((current) =>
              boardBoat(current, live.id, intent.boatId).session,
            )
            appendAiTrace(
              `AI world_move — ${live.name} boards boat ${intent.boatId}`,
            )
          }
          appendAiTrace(
            `AI world_move — ${live.name} already at ${intent.dest.q},${intent.dest.r}, done moving`,
          )
          break
        }
        if (intent.kind === 'disembark') {
          updateSession((current) =>
            disembarkBoat(current, live.id, intent.dest).session,
          )
          appendAiTrace(
            `AI world_move — ${live.name} disembarks at ${intent.dest.q},${intent.dest.r}`,
          )
          break
        }
        if (intent.kind === 'sail') {
          const moved = await requestMapMove(intent.dest, null)
          if (!moved) {
            appendAiTrace(
              `AI world_move — ${live.name} sail to ${intent.dest.q},${intent.dest.r} did not run`,
            )
            break
          }
          tryAiHeroTrade(player, hero.id, traded)
          continue
        }
        if (intent.kind === 'board_boat') {
          if (!samePos(live.position, intent.dest)) {
            const moved = await requestMapMove(intent.dest, intent.dest)
            if (!moved) {
              appendAiTrace(
                `AI world_move — ${live.name} approach boat did not run`,
              )
              break
            }
          }
          const afterBoard =
            getSession().heroes.find((row) => row.id === hero.id) ?? null
          if (
            afterBoard &&
            samePos(afterBoard.position, intent.dest)
          ) {
            updateSession((current) =>
              boardBoat(current, afterBoard.id, intent.boatId).session,
            )
            appendAiTrace(
              `AI world_move — ${afterBoard.name} boards boat ${intent.boatId}`,
            )
          }
          tryAiHeroTrade(player, hero.id, traded)
          continue
        }
        if (intent.kind === 'seek_dock') {
          if (!samePos(live.position, intent.dest)) {
            const moved = await requestMapMove(intent.dest, null)
            if (!moved) {
              appendAiTrace(
                `AI world_move — ${live.name} approach dock did not run`,
              )
              break
            }
          }
          const afterDock =
            getSession().heroes.find((row) => row.id === hero.id) ?? null
          const dock = findWorldDockById(getSession(), intent.featureId)
          if (
            afterDock &&
            dock &&
            hexDistance(afterDock.position, dock.position) <= 1
          ) {
            updateSession((current) =>
              buyBoatAtDock(current, intent.featureId, player.id).session,
            )
            appendAiTrace(
              `AI world_move — ${afterDock.name} buys boat at dock ${intent.featureId}`,
            )
          }
          tryAiHeroTrade(player, hero.id, traded)
          continue
        }
        if (intent.kind === 'seek_recruits') {
          if (!samePos(live.position, intent.dest)) {
            const moved = await requestMapMove(intent.dest, null)
            if (!moved) {
              appendAiTrace(
                `AI world_move — ${live.name} approach recruits did not run`,
              )
              break
            }
          }
          const afterRecruits =
            getSession().heroes.find((row) => row.id === hero.id) ?? null
          const catalog = getCachedCatalog()
          const recruits = findWorldRecruitsById(
            getSession(),
            intent.featureId,
          )
          if (
            afterRecruits &&
            catalog &&
            recruits &&
            hexDistance(afterRecruits.position, recruits.position) <= 1
          ) {
            let recruitError: string | null = null
            let recruitQty = 0
            updateSession((current) => {
              const result = aiRecruitFromWorldRecruits(
                current,
                catalog,
                intent.featureId,
                afterRecruits.id,
              )
              recruitError = result.error
              recruitQty = result.qty
              return result.session
            })
            appendAiTrace(
              recruitQty > 0
                ? `AI world_move — ${afterRecruits.name} recruits at ${intent.featureId} ×${recruitQty}`
                : `AI world_move — ${afterRecruits.name} scouts recruits ${intent.featureId}${recruitError ? ` (${recruitError})` : ''}`,
            )
          }
          tryAiHeroTrade(player, hero.id, traded)
          continue
        }
        if (intent.kind === 'seek_notice_board') {
          if (!samePos(live.position, intent.dest)) {
            const moved = await requestMapMove(intent.dest, null)
            if (!moved) {
              appendAiTrace(
                `AI world_move — ${live.name} approach notice board did not run`,
              )
              break
            }
          }
          const afterBoard =
            getSession().heroes.find((row) => row.id === hero.id) ?? null
          if (afterBoard) {
            applyNoticeBoardArrival(player.id, afterBoard.id, intent)
          }
          tryAiHeroTrade(player, hero.id, traded)
          continue
        }
        const beforeMp = live.movement_remaining
        const beforePos = { q: live.position.q, r: live.position.r }
        if (intent.kind === 'fly') {
          let error: string | null = null
          updateSession((current) => {
            const result = launchHeroFlight(
              current,
              live.id,
              intent.townId,
            )
            error = result.error
            return result.session
          })
          if (error) {
            appendAiTrace(
              `AI world_move — ${live.name} fly to ${intent.townId} failed: ${error}`,
            )
            break
          }
          appendAiTrace(
            `AI world_move — ${live.name} launches flight to town ${intent.townId}`,
          )
          await requestPlayHeroFlight(live.id)
          break
        }
        if (intent.kind === 'attack') {
          if (!samePos(live.position, intent.dest)) {
            const moved = await requestMapMove(intent.dest, intent.dest)
            if (!moved) {
              appendAiTrace(
                `AI world_move — ${live.name} move to ${intent.dest.q},${intent.dest.r} did not run (map busy or no path)`,
              )
              break
            }
          }
          const afterFight =
            getSession().heroes.find((row) => row.id === hero.id) ?? null
          if (!afterFight) {
            break
          }
          const targetPos = worldAttackPos(getSession(), intent.target)
          if (!targetPos || hexDistance(afterFight.position, targetPos) > 1) {
            appendAiTrace(
              `AI world_move — ${afterFight.name} did not reach attack target`,
            )
            break
          }
          const spent = spendHeroInteract(afterFight.movement_remaining)
          updateSession((current) =>
            syncHero(
              current,
              afterFight.position,
              spent,
              afterFight.id,
            ),
          )
          setHeroMovementRemaining(spent)
          appendAiTrace(
            `AI world_move — ${afterFight.name} attacks ${intent.target.type}`,
          )
          if (hooks?.engageWorldAttack) {
            await hooks.engageWorldAttack(afterFight.id, intent.target)
          }
          continue
        }
        if (intent.kind === 'chest') {
          if (!samePos(live.position, intent.dest)) {
            const moved = await requestMapMove(intent.dest, null)
            if (!moved) {
              appendAiTrace(
                `AI world_move — ${live.name} approach chest did not run`,
              )
              break
            }
          }
          const after = getSession().heroes.find((row) => row.id === hero.id)
          const chest = findChestById(getSession(), intent.featureId)
          const catalog = getCachedCatalog()
          if (
            after &&
            chest &&
            catalog &&
            hexDistance(after.position, chest.position) <= 1
          ) {
            updateSession((current) => openChest(current, chest.id))
            const choice = aiChestChoice(
              getSession(),
              catalog,
              player.id,
              after.id,
            )
            updateSession((current) =>
              claimChest(current, catalog, chest.id, after.id, choice).session,
            )
            appendAiTrace(
              `AI world_move — ${after.name} takes chest ${chest.name} (${choice})`,
            )
          } else {
            appendAiTrace(
              `AI world_move — ${live.name} could not reach chest ${intent.featureId}`,
            )
          }
          tryAiHeroTrade(player, hero.id, traded)
          continue
        }
        const walkOnto = intent.kind === 'explore' ? null : intent.dest
        const moved = await requestMapMove(intent.dest, walkOnto)
        if (!moved) {
          appendAiTrace(
            `AI world_move — ${live.name} move to ${intent.dest.q},${intent.dest.r} did not run (map busy or no path)`,
          )
          break
        }
        const after = getSession().heroes.find((row) => row.id === hero.id)
        if (!after) {
          break
        }
        const stepped = !samePos(beforePos, after.position)
        const spent = beforeMp - after.movement_remaining > 1e-9
        if (!stepped && !spent && n > 0) {
          break
        }
        tryAiHeroTrade(player, hero.id, traded)
        tryAiQuestSignVisit(player.id, hero.id)
        const actorAfter = activePlayer(getSession()) ?? player
        if (intent.kind === 'seek_library' && intent.featureId) {
          decideAndApplyWorldLibraryLearn(actorAfter, hero, intent.featureId)
        } else {
          decideAndApplyLibraryLearn(actorAfter, hero)
        }
      }
    }
  }
  decideAndApplyTownBuild(activePlayer(getSession()) ?? player)
}
