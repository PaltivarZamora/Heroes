import type { GameSession } from '../session/types'
import type { ReferenceCatalog } from '../town/catalog'
import { apiItemToRolled, rollItemsFromServer } from './api'
import { giveItemToHero } from './give'
import { allocateItemUid } from './state'

export async function grantRolledItemToHero(
  session: GameSession,
  _catalog: ReferenceCatalog,
  heroId: string,
  seed: number,
): Promise<
  | { session: GameSession; ok: true }
  | { session: GameSession; ok: false; message: string }
> {
  const rolled = await rollItemsFromServer(1, seed)
  const row = rolled.items[0]
  if (!row) {
    return { session, ok: false, message: 'Roll returned no item' }
  }
  let nextSession = session
  const { session: withUid, uid } = allocateItemUid(nextSession)
  nextSession = withUid
  const item = apiItemToRolled(row, uid)
  const given = giveItemToHero(nextSession, _catalog, heroId, item)
  if (!given.ok) {
    return { session, ok: false, message: given.message }
  }
  return { session: given.session, ok: true }
}
