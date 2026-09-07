import { requestMapMove, selectHeroOnMap, setHeroMovementRemaining, setMapCameraFollowMoves, setMapInputLocked, syncActivePlayerView } from '../hex/HexMap'
import { spendHeroInteract } from '../hex/hero'
import { hexDistance } from '../hex/pathfinding'
import { activePlayer, syncHero } from '../session/accessors'
import { seedStartingVision } from '../session/create'
import { getSession, updateSession } from '../session/store'
import { decideAndApplyArmyAlloc, decideAndApplyHeroTrade } from './armyAlloc'
import { decideAndApplyLibraryLearn, ensurePlayerLibraryOffers } from './libraryLearn'
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
      if (!hero) {
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
            intent.kind === 'seek_library') &&
          samePos(live.position, intent.dest)
        ) {
          if (intent.kind === 'seek_library') {
            decideAndApplyLibraryLearn(actor, live)
          }
          appendAiTrace(
            `AI world_move — ${live.name} already at ${intent.dest.q},${intent.dest.r}, done moving`,
          )
          break
        }
        const beforeMp = live.movement_remaining
        const beforePos = { q: live.position.q, r: live.position.r }
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
        decideAndApplyLibraryLearn(
          activePlayer(getSession()) ?? player,
          hero,
        )
      }
    }
  }
  decideAndApplyTownBuild(activePlayer(getSession()) ?? player)
}
