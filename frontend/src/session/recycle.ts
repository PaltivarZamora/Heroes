import {
  heroMovementPoints,
  heroResourcePools,
  type ReferenceCatalog,
} from '../town/catalog'
import { normalizeHeroInventory } from '../items/state'
import type { GameSession, Hero, HeroProgress, RecycledHeroState } from './types'
import { setPoolProgress } from './accessors'
import {
  heroPoolId,
  poolProgressKey,
} from './heroPoolKeys'

export type { RecycledHeroState } from './types'

export function snapshotRecycledHero(hero: Hero): RecycledHeroState {
  const live = normalizeHeroInventory(hero)
  return {
    class_id: live.class_id ?? 0,
    image_path: live.image_path,
    arch_id: live.arch_id,
    current_level: live.current_level,
    current_xp: live.current_xp,
    learned_abilities: [...(live.learned_abilities ?? [])],
    ability_learn_log: live.ability_learn_log
      ? live.ability_learn_log.map((row) => ({ ...row }))
      : undefined,
    equipment: { ...live.equipment },
    backpack: [...live.backpack],
  }
}

export function removeHeroFromMap(session: GameSession, hero: Hero): GameSession {
  return {
    ...session,
    units: session.units.filter((row) => row.hero_id !== hero.id),
    heroes: session.heroes.filter((row) => row.id !== hero.id),
    boats: (session.boats ?? []).filter(
      (boat) => boat.occupant_hero_id !== hero.id,
    ),
    players: session.players.map((player) =>
      player.id === hero.player_id
        ? {
            ...player,
            hero_ids: player.hero_ids.filter((id) => id !== hero.id),
          }
        : player,
    ),
  }
}

export function recycleDefeatedHero(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
  hero: Hero,
): GameSession {
  const poolId = heroPoolId(catalog, hero)
  if (poolId == null) {
    return removeHeroFromMap(session, hero)
  }
  const snapshot = snapshotRecycledHero(hero)
  const progress: HeroProgress = {
    current_level: snapshot.current_level,
    current_xp: snapshot.current_xp,
  }
  let next = removeHeroFromMap(session, hero)
  next = {
    ...next,
    recycled_heroes: {
      ...(next.recycled_heroes ?? {}),
      [poolProgressKey(poolId)]: snapshot,
    },
  }
  return setPoolProgress(next, poolId, progress)
}

export function applyRecycledHeroToNewHire(
  session: GameSession,
  catalog: ReferenceCatalog,
  poolId: number,
  pickName: string,
  base: Hero,
): Hero {
  const saved = session.recycled_heroes?.[poolProgressKey(poolId)]
  if (!saved) {
    return { ...base, pool_id: poolId }
  }
  const pools = heroResourcePools(catalog, {
    ...base,
    class_id: saved.class_id,
    current_level: saved.current_level,
    equipment: saved.equipment,
    backpack: saved.backpack,
  })
  return {
    ...base,
    pool_id: poolId,
    class_id: saved.class_id,
    image_path: saved.image_path,
    arch_id: saved.arch_id,
    current_level: saved.current_level,
    current_xp: saved.current_xp,
    learned_abilities: [...saved.learned_abilities],
    ability_learn_log: saved.ability_learn_log
      ? saved.ability_learn_log.map((row) => ({ ...row }))
      : undefined,
    equipment: { ...saved.equipment },
    backpack: [...saved.backpack],
    current_mana: pools.current_mana,
    current_energy: pools.current_energy,
    movement_remaining: heroMovementPoints(
      catalog,
      { class_id: saved.class_id, current_level: saved.current_level },
      session.game.settings.move_mode,
    ),
    flight: null,
    used_abilities_this_battle: [],
    used_abilities_today: [],
    army: {
      slot_0: pickName,
      slots_1_to_6: base.army.slots_1_to_6,
    },
  }
}

export function clearRecycledPoolId(
  session: GameSession,
  poolId: number,
): GameSession {
  const key = poolProgressKey(poolId)
  const recycled = session.recycled_heroes
  if (!recycled || !recycled[key]) {
    return session
  }
  const next = { ...recycled }
  delete next[key]
  return { ...session, recycled_heroes: next }
}
