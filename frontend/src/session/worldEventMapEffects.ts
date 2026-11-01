import { hexDistance, neighborHexes } from '../hex/pathfinding'
import type { Axial } from '../hex/hero'
import { isPassable, forEachPassableHex } from '../hex/world'
import { resourceById } from '../hex/resources'
import {
  advancedUnitFor,
  mapCfg,
  mapCfgNumber,
  sizeScale,
  unitById,
  type ReferenceCatalog,
} from '../town/catalog'
import {
  activeWorldEventForSession,
  eventRowById,
  sessionMapSizeName,
  targetDisplayName,
} from './worldEvents'
import { appendLogEntry, humanPlayers } from './gameLog'
import { logConfigWorldNotice } from './configLog'
import { syncRuntimePickups } from '../hex/HexMap'
import { appendLooseResourcePickup, rollLooseResourceQty } from './mapPickup'
import { dwellingGrowthFor, spawnWorldMobAt } from './mobs'
import {
  mobShapeKeys,
  mobWorldAnchorFits,
} from '../hex/worldMobFootprint'
import { unitFootprint } from '../town/catalog'
import type { GameSession } from './types'

function posKey(q: number, r: number): string {
  return `${q},${r}`
}

function asIntField(raw: unknown): number | null {
  if (raw == null) {
    return null
  }
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) ? n : null
}

function mapSizeName(session: GameSession, catalog: ReferenceCatalog): string {
  return sessionMapSizeName(session, catalog)
}

function resolveEventMobAdvancedPct(
  catalog: ReferenceCatalog,
  sizeName: string,
): { pct: number; missing: boolean } {
  const row = catalog.map_config.find((entry) => entry.key === 'event_mob_advanced_pct')
  if (!row || row.value == null || row.value === '') {
    return { pct: 0, missing: true }
  }
  const resolved = mapCfg(catalog, 'event_mob_advanced_pct', sizeName)
  const n = Number(resolved)
  if (!Number.isFinite(n)) {
    return { pct: 0, missing: true }
  }
  return { pct: Math.max(0, Math.min(100, n)), missing: false }
}

function mobMinTownDist(catalog: ReferenceCatalog, sizeName: string): number {
  return Math.max(
    1,
    Math.floor(mapCfgNumber(catalog, 'mob_min_town_dist', sizeName, 10)),
  )
}

type TierBand = { dist: number; tier: number }

function mobTierBands(catalog: ReferenceCatalog): TierBand[] {
  const raw = catalog.map_config.find((row) => row.key === 'mob_tier_by_dist')
    ?.value
  const bands: TierBand[] = []
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!Array.isArray(entry) || entry.length < 2) {
        continue
      }
      const dist = Math.floor(Number(entry[0]))
      const tier = Math.floor(Number(entry[1]))
      if (dist > 0 && tier > 0) {
        bands.push({ dist, tier })
      }
    }
  }
  if (bands.length === 0) {
    bands.push({ dist: 15, tier: 2 }, { dist: 30, tier: 4 }, { dist: 9999, tier: 6 })
  }
  bands.sort((a, b) => a.dist - b.dist)
  return bands
}

function tierCapForDistance(dist: number, bands: TierBand[]): number {
  let cap = 6
  for (const band of bands) {
    cap = band.tier
    if (dist <= band.dist) {
      return cap
    }
  }
  return cap
}

function townAnchorHexes(session: GameSession): Axial[] {
  const hexes: Axial[] = []
  for (const town of session.towns) {
    hexes.push(town.position)
    const dir = town.flipped ? 1 : -1
    hexes.push({ q: town.position.q + dir, r: town.position.r })
  }
  return hexes
}

function startingTownEntries(session: GameSession): Axial[] {
  const owned = session.towns.filter((town) => town.player_id != null)
  const list = owned.length > 0 ? owned : session.towns
  return list.map((town) => town.position)
}

function minHexDistance(hex: Axial, anchors: Axial[]): number {
  let best = Infinity
  for (const anchor of anchors) {
    best = Math.min(best, hexDistance(hex, anchor))
  }
  return best
}

function featureAt(session: GameSession, q: number, r: number): boolean {
  return (session.features ?? []).some(
    (row) => row.position.q === q && row.position.r === r,
  )
}

function buildOccupied(
  session: GameSession,
  catalog: ReferenceCatalog,
): Set<string> {
  const occupied = new Set<string>()
  for (const mob of session.mobs) {
    for (const key of mobShapeKeys(session, catalog, mob)) {
      occupied.add(key)
    }
  }
  for (const hero of session.heroes) {
    occupied.add(posKey(hero.position.q, hero.position.r))
  }
  for (const node of session.nodes) {
    occupied.add(posKey(node.position.q, node.position.r))
  }
  for (const town of session.towns) {
    occupied.add(posKey(town.position.q, town.position.r))
    const dir = town.flipped ? 1 : -1
    occupied.add(posKey(town.position.q + dir, town.position.r))
  }
  for (const feature of session.features ?? []) {
    occupied.add(posKey(feature.position.q, feature.position.r))
  }
  return occupied
}

function shuffleHexes(hexes: Array<{ q: number; r: number }>, random: () => number): void {
  for (let i = hexes.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const tmp = hexes[i]!
    hexes[i] = hexes[j]!
    hexes[j] = tmp
  }
}

function mobHexOk(
  session: GameSession,
  catalog: ReferenceCatalog,
  q: number,
  r: number,
  occupied: Set<string>,
  townHexes: Axial[],
  minTown: number,
  unitTier: number,
  tierBands: TierBand[],
  startTowns: Axial[],
  footprintCode: import('../combat/footprint').FootprintCode,
): boolean {
  if (featureAt(session, q, r)) {
    return false
  }
  if (minHexDistance({ q, r }, townHexes) < minTown) {
    return false
  }
  const dist = minHexDistance({ q, r }, startTowns)
  const maxTier = tierCapForDistance(dist, tierBands)
  if (unitTier > maxTier) {
    return false
  }
  if (
    !mobWorldAnchorFits(session, catalog, { q, r }, footprintCode, occupied)
  ) {
    return false
  }
  return true
}

function applyQtyPct(qty: number, pct: number): number {
  if (qty <= 0 || pct === 0) {
    return qty
  }
  if (pct <= -100) {
    return 0
  }
  const delta = Math.floor(qty * (pct / 100))
  let next = qty + delta
  if (pct > 0 && next <= qty) {
    next = qty + 1
  }
  return Math.max(0, next)
}

function pileHexesNearMine(
  session: GameSession,
  mine: Axial,
  occupied: Set<string>,
  maxRadius: number,
): Array<{ q: number; r: number; dist: number }> {
  const candidates: Array<{ q: number; r: number; dist: number }> = []
  const seen = new Set<string>()
  let frontier: Array<{ q: number; r: number; dist: number }> = [
    { q: mine.q, r: mine.r, dist: 0 },
  ]
  while (frontier.length > 0) {
    const nextFrontier: Array<{ q: number; r: number; dist: number }> = []
    for (const hex of frontier) {
      if (hex.dist > maxRadius) {
        continue
      }
      if (hex.dist > 0) {
        const key = posKey(hex.q, hex.r)
        if (
          !seen.has(key) &&
          isPassable(hex.q, hex.r) &&
          !occupied.has(key) &&
          !featureAt(session, hex.q, hex.r)
        ) {
          seen.add(key)
          candidates.push(hex)
        }
      }
      if (hex.dist >= maxRadius) {
        continue
      }
      for (const n of neighborHexes(hex)) {
        nextFrontier.push({ q: n.q, r: n.r, dist: hex.dist + 1 })
      }
    }
    frontier = nextFrontier
  }
  candidates.sort((a, b) => a.dist - b.dist || a.q - b.q || a.r - b.r)
  return candidates
}

export type WorldEventMapApplyResult = {
  session: GameSession
  summaryParts: string[]
  devNotes: string[]
}

export function applyWorldEventMapEffects(
  session: GameSession,
  catalog: ReferenceCatalog,
  random: () => number,
): WorldEventMapApplyResult {
  const active = activeWorldEventForSession(session)
  const summaryParts: string[] = []
  const devNotes: string[] = []
  if (!active) {
    return { session, summaryParts, devNotes }
  }
  const row = eventRowById(catalog, active.eventId)
  if (!row) {
    return { session, summaryParts, devNotes }
  }

  let next = session
  const absoluteWeek = active.absoluteWeek
  const sizeName = mapSizeName(session, catalog)
  const month = session.game.calendar.month
  let runtimePickupsAdded = 0

  const spawnStacksRaw = asIntField(active.spawnStacks)
  if (
    spawnStacksRaw != null &&
    spawnStacksRaw > 0 &&
    active.target.kind === 'unit'
  ) {
    const baseUnit = unitById(catalog, active.target.unitId)
    if (!baseUnit) {
      devNotes.push('[event] Spawn skipped — unit target missing from catalog.')
    } else {
      const advancedRoll = resolveEventMobAdvancedPct(catalog, sizeName)
      if (advancedRoll.missing) {
        next = logConfigWorldNotice(
          next,
          'event_mob_advanced_pct',
          '[event] Missing map_config.event_mob_advanced_pct — event spawns use base units only.',
        )
      }
      const useAdvanced =
        !advancedRoll.missing &&
        advancedUnitFor(catalog, baseUnit) != null &&
        random() * 100 < advancedRoll.pct
      const spawnUnit = useAdvanced
        ? advancedUnitFor(catalog, baseUnit)!
        : baseUnit
      const weekly = dwellingGrowthFor(catalog, spawnUnit.id)
      const stackQty = Math.max(1, month * Math.max(1, weekly))
      const scale = sizeScale(catalog, sizeName)
      const want = Math.max(0, Math.round(spawnStacksRaw * scale))
      const footprintCode = unitFootprint(spawnUnit)
      const occupied = buildOccupied(next, catalog)
      const townHexes = townAnchorHexes(next)
      const startTowns = startingTownEntries(next)
      const minTown = mobMinTownDist(catalog, sizeName)
      const bands = mobTierBands(catalog)
      const unitTier = spawnUnit.tier ?? 1
      const valid: Array<{ q: number; r: number }> = []
      forEachPassableHex((q, r) => {
        if (
          mobHexOk(
            next,
            catalog,
            q,
            r,
            occupied,
            townHexes,
            minTown,
            unitTier,
            bands,
            startTowns,
            footprintCode,
          )
        ) {
          valid.push({ q, r })
        }
      })
      shuffleHexes(valid, random)
      let placed = 0
      for (const hex of valid) {
        if (placed >= want) {
          break
        }
        next = spawnWorldMobAt(
          next,
          hex.q,
          hex.r,
          spawnUnit.id,
          stackQty,
          absoluteWeek,
        )
        const spawned = next.mobs[next.mobs.length - 1]
        if (spawned) {
          for (const key of mobShapeKeys(next, catalog, spawned)) {
            occupied.add(key)
          }
        }
        placed += 1
      }
      const unitName = spawnUnit.name ?? targetDisplayName(catalog, active.target)
      if (placed > 0) {
        const line =
          placed === 1
            ? `1 ${unitName} stack appeared`
            : `${placed} ${unitName} stacks appeared`
        summaryParts.push(line)
      }
      if (placed < want) {
        devNotes.push(
          `[event] Spawn placed ${placed}/${want} ${unitName} stacks (map full).`,
        )
        for (const player of humanPlayers(next)) {
          next = appendLogEntry(next, player.id, 'world', 'world_event', {
            message: `[event] Only ${placed}/${want} event mob stacks could be placed.`,
            eventId: row.id,
          })
        }
      }
    }
  }

  const mobPct = active.existingMobPct
  if (mobPct != null && mobPct !== 0) {
    next = {
      ...next,
      units: next.units.map((stack) => {
        if (stack.mob_id == null || stack.qty <= 0) {
          return stack
        }
        return { ...stack, qty: applyQtyPct(stack.qty, mobPct) }
      }),
    }
    const sign = mobPct > 0 ? '+' : ''
    summaryParts.push(`world mobs ${sign}${mobPct}%`)
  }

  const dropsPerMine = asIntField(active.resDrops)
  if (
    dropsPerMine != null &&
    dropsPerMine > 0 &&
    active.target.kind === 'resource'
  ) {
    const resourceId = active.target.resourceId
    const mines = next.nodes.filter(
      (node) => node.kind === 'mine' && node.resource_id === resourceId,
    )
    let piles = 0
    let skippedMines = 0
    for (const mine of mines) {
      let placedForMine = 0
      for (let i = 0; i < dropsPerMine; i += 1) {
        const occupied = buildOccupied(next, catalog)
        let spots = pileHexesNearMine(next, mine.position, occupied, 1)
        if (spots.length === 0) {
          spots = pileHexesNearMine(next, mine.position, occupied, 2)
        }
        const spot = spots[0]
        if (!spot) {
          break
        }
        const qty = rollLooseResourceQty(catalog, resourceId, random)
        const placed = appendLooseResourcePickup(
          next,
          catalog,
          spot.q,
          spot.r,
          resourceId,
          qty,
          random,
        )
        next = placed.session
        runtimePickupsAdded += 1
        placedForMine += 1
        piles += 1
      }
      if (placedForMine < dropsPerMine) {
        skippedMines += 1
        const resName =
          resourceById(resourceId)?.name ?? `Resource ${resourceId}`
        devNotes.push(
          `[event] Skipped ${dropsPerMine - placedForMine} pile(s) near ${resName} mine at (${mine.position.q},${mine.position.r}).`,
        )
      }
    }
    if (piles > 0) {
      const resName = resourceById(resourceId)?.name ?? `resource ${resourceId}`
      summaryParts.push(
        piles === 1
          ? `1 ${resName} pile placed near mines`
          : `${piles} ${resName} piles placed near mines`,
      )
    }
    if (skippedMines > 0) {
      for (const player of humanPlayers(next)) {
        next = appendLogEntry(next, player.id, 'world', 'world_event', {
          message: `[event] Could not place all resource piles (${skippedMines} mine(s) lacked space).`,
          eventId: row.id,
        })
      }
    }
  }

  if (runtimePickupsAdded > 0) {
    syncRuntimePickups()
  }

  return { session: next, summaryParts, devNotes }
}
