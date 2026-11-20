import { appendBattleAnimCombatLog } from './battleAnimLogBridge'

const STALL_MS = 5000

type Timeline = { token: number; name: string; stackId: string }

let tokenSeq = 0
const timelines: Timeline[] = []
let movingNoted = false
let movingBy = 'unset'

let timer: ReturnType<typeof setTimeout> | null = null
let watchGen = 0

/** Dev trace only. Does not change whether movement or the turn proceeds. */
export function noteBattleMoving(next: boolean, by: string): void {
  movingNoted = next
  movingBy = by
}

export function beginBattleTimeline(name: string, stackId: string): number {
  const token = ++tokenSeq
  timelines.push({ token, name, stackId })
  return token
}

export function endBattleTimeline(token: number): void {
  const idx = timelines.findIndex((row) => row.token === token)
  if (idx >= 0) {
    timelines.splice(idx, 1)
  }
}

export function battleMovingTrace(): { moving: boolean; by: string } {
  return { moving: movingNoted, by: movingBy }
}

export function battlePendingTimelines(): { name: string; stackId: string }[] {
  return timelines.map((row) => ({ name: row.name, stackId: row.stackId }))
}

export function disarmBattleTurnWatch(): void {
  watchGen += 1
  if (timer != null) {
    clearTimeout(timer)
    timer = null
  }
}

/**
 * If `stillBlocked` is still true after 5s, write one Dev line, then again
 * at most every 5s until it clears or the watch is replaced.
 */
export function armBattleStallWatch(
  kind: 'presentation' | 'turn',
  stillBlocked: () => boolean,
  detail: () => string,
): void {
  disarmBattleTurnWatch()
  const gen = watchGen
  const tick = () => {
    if (gen !== watchGen) {
      return
    }
    if (!stillBlocked()) {
      if (gen === watchGen) {
        timer = null
      }
      return
    }
    const pending = battlePendingTimelines()
    const trace = battleMovingTrace()
    appendBattleAnimCombatLog(
      `[Dev] Turn stall 5s (${kind}): lastSetMoving=${trace.moving} by ${trace.by}; pending=${
        pending.length > 0
          ? pending.map((row) => `${row.name}:${row.stackId}`).join(', ')
          : 'none'
      }; ${detail()}`,
    )
    timer = setTimeout(tick, STALL_MS)
  }
  timer = setTimeout(tick, STALL_MS)
}
