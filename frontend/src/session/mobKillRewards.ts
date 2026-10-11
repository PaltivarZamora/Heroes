import { slotsArmyValue } from '../ai/armyAlloc'
import { GOLD_RESOURCE_ID } from '../hex/resources'
import { apiItemToRolled, rollItemsFromServer } from '../items/api'
import { itemTemplateById } from '../items/itemCatalog'
import {
  pickWeightedRarityId,
  rarityWeightsForTier,
} from '../items/rewardRoll'
import { allocateItemUid } from '../items/state'
import type { RolledItem } from '../items/types'
import { mapCfg, unitById, unitEffectiveTier, type ReferenceCatalog } from '../town/catalog'
import type { OpeningStack } from '../combat/resolve'
import { creatureOpeningSideValue } from './mobKillValue'
import { logMobDroppedItem, logMobKillGold } from './gameLog'
import { spawnUnguardedGroundItem, tryPickupGroundItemAtHex } from './groundItem'
import { mobLabel, mobLeadStack } from './mobs'
import type { GameSession, Mob } from './types'
import { equipBestItemsForHero } from '../ai/itemEquip'

let warnedGoldPct = false
let warnedItemPct = false

function warnGoldOnce(message: string): void {
  if (!warnedGoldPct) {
    warnedGoldPct = true
    console.warn(`[mob-rewards] ${message}`)
  }
}

function warnItemOnce(message: string): void {
  if (!warnedItemPct) {
    warnedItemPct = true
    console.warn(`[mob-rewards] ${message}`)
  }
}

function parsePctRange(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length < 2) {
    return null
  }
  const lo = Number(raw[0])
  const hi = Number(raw[1])
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi < lo) {
    return null
  }
  return [lo, hi]
}

export function mobKillGoldPctRoll(
  catalog: ReferenceCatalog | null,
  rng: () => number,
): number | null {
  const raw = mapCfg(catalog, 'mob_gold_pct')
  if (raw == null) {
    warnGoldOnce('map_config.mob_gold_pct missing')
    return null
  }
  const range = parsePctRange(raw)
  if (!range) {
    warnGoldOnce('map_config.mob_gold_pct not a [lo,hi] range')
    return null
  }
  const [lo, hi] = range
  return lo + rng() * (hi - lo)
}

export function mobKillGoldAmount(armyValue: number, pct: number): number {
  if (armyValue <= 0 || pct <= 0) {
    return 0
  }
  return Math.floor((armyValue * pct) / 100)
}

export function mobMainTier(
  catalog: ReferenceCatalog,
  session: GameSession,
  mob: Mob,
): number {
  const lead = mobLeadStack(session, mob)
  if (!lead) {
    return 1
  }
  const unit = unitById(catalog, lead.unit_id)
  if (!unit) {
    return 1
  }
  return Math.max(1, Math.min(6, Math.floor(unitEffectiveTier(catalog, unit))))
}

export function mobAllowsItemDrop(mob: Mob): boolean {
  return mob.guards_loot !== true
}

export function grantMobKillGold(
  session: GameSession,
  playerId: string,
  heroId: string,
  gold: number,
): GameSession {
  if (gold <= 0) {
    return session
  }
  let next: GameSession = {
    ...session,
    players: session.players.map((player) =>
      player.id === playerId
        ? {
            ...player,
            resources: {
              ...player.resources,
              [GOLD_RESOURCE_ID]:
                (player.resources[GOLD_RESOURCE_ID] ?? 0) + gold,
            },
          }
        : player,
    ),
  }
  next = logMobKillGold(next, playerId, heroId, gold)
  return next
}

function rollMobItemPct(catalog: ReferenceCatalog | null, rng: () => number): boolean {
  const raw = mapCfg(catalog, 'mob_item_pct')
  if (raw == null) {
    warnItemOnce('map_config.mob_item_pct missing')
    return false
  }
  const pct = Number(raw)
  if (!Number.isFinite(pct) || pct <= 0) {
    return false
  }
  return rng() * 100 < pct
}

export type MobKillRewardSnapshot = {
  armyValue: number
  tier: number
  position: { q: number; r: number }
  allowsItem: boolean
  mobLabel: string
}

export function snapshotMobKillRewards(
  session: GameSession,
  catalog: ReferenceCatalog,
  mob: Mob,
  opening: readonly OpeningStack[],
): MobKillRewardSnapshot {
  return {
    armyValue: creatureOpeningSideValue(catalog, opening, 'def'),
    tier: mobMainTier(catalog, session, mob),
    position: { ...mob.position },
    allowsItem: mobAllowsItemDrop(mob),
    mobLabel: mobLabel(session, catalog, mob),
  }
}

export function applyMobKillGoldReward(
  session: GameSession,
  catalog: ReferenceCatalog,
  heroId: string,
  snapshot: MobKillRewardSnapshot,
  rng: () => number = Math.random,
): { session: GameSession; line: string | null } {
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!hero) {
    return { session, line: null }
  }
  const pct = mobKillGoldPctRoll(catalog, rng)
  if (pct == null) {
    return { session, line: null }
  }
  const gold = mobKillGoldAmount(snapshot.armyValue, pct)
  if (gold <= 0) {
    return { session, line: null }
  }
  const next = grantMobKillGold(session, hero.player_id, heroId, gold)
  return { session: next, line: `+${gold} gold` }
}

export async function applyMobKillItemReward(
  session: GameSession,
  catalog: ReferenceCatalog,
  heroId: string,
  snapshot: MobKillRewardSnapshot,
  rng: () => number = Math.random,
): Promise<{ session: GameSession; lines: string[] }> {
  if (!snapshot.allowsItem || !rollMobItemPct(catalog, rng)) {
    return { session, lines: [] }
  }
  const weights = rarityWeightsForTier(catalog, 'quest_item_rarity', snapshot.tier)
  if (!weights) {
    return { session, lines: [] }
  }
  const rarityId = pickWeightedRarityId(rng, weights)
  if (rarityId == null) {
    return { session, lines: [] }
  }
  const seed = Math.floor(rng() * 0x7fffffff)
  const rolled = await rollItemsFromServer(1, seed, rarityId)
  const row = rolled.items[0]
  if (!row) {
    return { session, lines: [] }
  }
  const allocated = allocateItemUid(session)
  let next = allocated.session
  const item: RolledItem = apiItemToRolled(row, allocated.uid)
  const hero = next.heroes.find((row) => row.id === heroId)
  if (!hero) {
    return { session: next, lines: [] }
  }
  const template = itemTemplateById(catalog, item.itemId)
  const flipped =
    template?.flippable === true ? rng() < 0.5 : false
  next = spawnUnguardedGroundItem(
    next,
    catalog,
    snapshot.position.q,
    snapshot.position.r,
    item,
    flipped,
  )
  next = logMobDroppedItem(
    next,
    hero.player_id,
    heroId,
    snapshot.mobLabel,
  )
  const dropLine = `The ${snapshot.mobLabel} dropped an item!`
  if (
    hero.position.q === snapshot.position.q &&
    hero.position.r === snapshot.position.r
  ) {
    const pickup = tryPickupGroundItemAtHex(
      next,
      catalog,
      snapshot.position.q,
      snapshot.position.r,
      heroId,
    )
    next = pickup.session
    const owner = next.players.find((row) => row.id === hero.player_id)
    if (owner?.is_ai) {
      next = equipBestItemsForHero(next, catalog, heroId)
    }
  }
  return {
    session: next,
    lines: [dropLine],
  }
}

/** Army value at fight start (same slots as surrender). */
export function mobArmyValueFromSession(
  session: GameSession,
  catalog: ReferenceCatalog,
  mob: Mob,
): number {
  return slotsArmyValue(session, catalog, mob.slots_1_to_6)
}

export function captureMobKillSnapshotIfLive(
  session: GameSession,
  catalog: ReferenceCatalog,
  defenderMobId: string | null | undefined,
  opening: readonly OpeningStack[],
): MobKillRewardSnapshot | null {
  if (!defenderMobId) {
    return null
  }
  const mob = session.mobs.find((row) => row.id === defenderMobId)
  if (!mob) {
    return null
  }
  return snapshotMobKillRewards(session, catalog, mob, opening)
}
