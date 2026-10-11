import type { ReferenceCatalog } from '../town/catalog'
import type { GameSession, Hero, RecycledHeroState } from './types'
import type { HeroProgress } from './types'
const PLACEHOLDER_HERO_NAME = 'X1'

export function poolProgressKey(poolId: number): string {
  return String(Math.floor(poolId))
}

export function poolIdByName(
  catalog: ReferenceCatalog | null | undefined,
  name: string,
): number | null {
  if (!catalog || !name || name === PLACEHOLDER_HERO_NAME) {
    return null
  }
  const row = catalog.hero_pool.find((entry) => entry.name === name)
  return row?.id ?? null
}

export function heroPoolId(
  catalog: ReferenceCatalog | null | undefined,
  hero: Hero,
): number | null {
  if (typeof hero.pool_id === 'number' && hero.pool_id > 0) {
    return hero.pool_id
  }
  return poolIdByName(catalog, hero.name)
}

function isNumericPoolKey(key: string): boolean {
  return /^\d+$/.test(key.trim())
}

function migrateRecord<T>(
  catalog: ReferenceCatalog | null | undefined,
  raw: Record<string, T> | undefined,
): Record<string, T> {
  if (!raw) {
    return {}
  }
  const out: Record<string, T> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (isNumericPoolKey(key)) {
      out[key] = value
      continue
    }
    const id = poolIdByName(catalog, key)
    if (id != null) {
      const idKey = poolProgressKey(id)
      if (out[idKey] == null) {
        out[idKey] = value
      }
    }
  }
  return out
}

/** Name-keyed saves → `hero_pool.id` keys (once per load). */
export function migratePoolKeyedSession(
  session: GameSession,
  catalog: ReferenceCatalog | null | undefined,
): GameSession {
  const hero_progress = migrateRecord<HeroProgress>(
    catalog,
    session.hero_progress,
  )
  const recycled_heroes = migrateRecord<RecycledHeroState>(
    catalog,
    session.recycled_heroes,
  )
  if (
    hero_progress === session.hero_progress &&
    recycled_heroes === session.recycled_heroes
  ) {
    return session
  }
  return { ...session, hero_progress, recycled_heroes }
}

export function progressForPoolId(
  session: GameSession,
  poolId: number,
): HeroProgress | null {
  const saved = session.hero_progress?.[poolProgressKey(poolId)]
  return saved ?? null
}
