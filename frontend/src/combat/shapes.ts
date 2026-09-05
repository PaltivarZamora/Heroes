import type { Axial } from '../hex/hero'
import { hexDistance, neighborHexes } from '../hex/pathfinding'
import type { ReferenceCatalog, UnitCombatAbilities } from '../town/catalog'
import { unitById, unitAttackShape } from '../town/catalog'
import { moveStack, type CombatBattle, type CombatStack, type CombatTile } from './battle'
import { occupancyKey, stackOccupyingHex } from './occupancy'
import { isUntargetableStack, liveWallLosKeys } from './siege'

export type ShapeHit = {
  hex: Axial
  stack: CombatStack | null
  dmgPct: number
}

function keyOf(hex: Axial): string {
  return occupancyKey(hex.q, hex.r)
}

function onBoard(hex: Axial, board: ReadonlySet<string>): boolean {
  return board.has(keyOf(hex))
}

export function boardKeys(tiles: CombatTile[]): Set<string> {
  return new Set(tiles.map((tile) => occupancyKey(tile.q, tile.r)))
}

function cubeLerp(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  t: number,
) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  }
}

function cubeRound(x: number, y: number, z: number): Axial {
  let rx = Math.round(x)
  let ry = Math.round(y)
  let rz = Math.round(z)
  const dx = Math.abs(rx - x)
  const dy = Math.abs(ry - y)
  const dz = Math.abs(rz - z)
  if (dx > dy && dx > dz) {
    rx = -ry - rz
  } else if (dy > dz) {
    ry = -rx - rz
  } else {
    rz = -rx - ry
  }
  return { q: rx, r: rz }
}

export function hexLine(from: Axial, to: Axial): Axial[] {
  const n = hexDistance(from, to)
  if (n === 0) {
    return [{ q: from.q, r: from.r }]
  }
  const a = { x: from.q, y: -from.q - from.r, z: from.r }
  const b = { x: to.q, y: -to.q - to.r, z: to.r }
  const out: Axial[] = []
  for (let i = 0; i <= n; i += 1) {
    const t = i / n
    const c = cubeLerp(a, b, t)
    out.push(cubeRound(c.x, c.y, c.z))
  }
  return out
}

/**
 * Clear sight along Beam's hex-line. Barrier terrain and live
 * Wall/Shooter/Drawbridge stacks block; other units do not.
 * Endpoints (attacker and candidate) are not treated as blockers.
 */
export function hasLineOfSight(
  from: Axial,
  to: Axial,
  tiles: CombatTile[],
  stacks: CombatStack[] = [],
  catalog?: ReferenceCatalog,
): boolean {
  const line = hexLine(from, to)
  if (line.length <= 2) {
    return true
  }
  const blocked = new Set(
    tiles
      .filter((tile) => tile.blocksLos)
      .map((tile) => occupancyKey(tile.q, tile.r)),
  )
  if (catalog) {
    for (const key of liveWallLosKeys(stacks, catalog, tiles)) {
      blocked.add(key)
    }
  }
  for (let i = 1; i < line.length - 1; i += 1) {
    if (blocked.has(keyOf(line[i]!))) {
      return false
    }
  }
  return true
}

export function hexDisk(center: Axial, radius: number): Axial[] {
  const r = Math.max(0, Math.floor(radius))
  const out: Axial[] = []
  for (let dq = -r; dq <= r; dq += 1) {
    const rMin = Math.max(-r, -dq - r)
    const rMax = Math.min(r, -dq + r)
    for (let dr = rMin; dr <= rMax; dr += 1) {
      out.push({ q: center.q + dq, r: center.r + dr })
    }
  }
  return out
}

export function sharedNeighbors(a: Axial, b: Axial): Axial[] {
  const nextToA = new Set(neighborHexes(a).map(keyOf))
  return neighborHexes(b).filter((hex) => nextToA.has(keyOf(hex)))
}

/** Neighbors of `target` that are not the attacker and not shared with it. */
export function farSideNeighbors(from: Axial, target: Axial): Axial[] {
  const shared = new Set(sharedNeighbors(from, target).map(keyOf))
  const fromKey = keyOf(from)
  return neighborHexes(target).filter((hex) => {
    const key = keyOf(hex)
    return key !== fromKey && !shared.has(key)
  })
}

export function incomingDir(from: Axial, to: Axial): Axial {
  const line = hexLine(from, to)
  if (line.length < 2) {
    return { q: 1, r: 0 }
  }
  const prev = line[line.length - 2]!
  return { q: to.q - prev.q, r: to.r - prev.r }
}

/** Target + the 2 hexes neighboring both attacker and target (near side). */
export function cleaveHexes(from: Axial, target: Axial): Axial[] {
  return [{ q: target.q, r: target.r }, ...sharedNeighbors(from, target)]
}

/**
 * Straight line `rows` deep. rows:2 = first in-line hex + 3 far-side
 * neighbors (4). Each extra row adds 3 hexes from the next in-line
 * hex's far side (rows:3 = 7). Same width, longer.
 */
export function breathHexes(from: Axial, target: Axial, rows: number): Axial[] {
  const line = hexLine(from, target)
  const first = line[1]
  if (!first) {
    return []
  }
  const dir = incomingDir(from, first)
  const steps = Math.max(1, Math.floor(rows) - 1)
  const seen = new Set<string>()
  const out: Axial[] = []
  const add = (hex: Axial) => {
    const key = keyOf(hex)
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    out.push(hex)
  }
  let ref = from
  let focus = first
  for (let i = 0; i < steps; i += 1) {
    add(focus)
    for (const hex of farSideNeighbors(ref, focus)) {
      add(hex)
    }
    ref = focus
    focus = { q: focus.q + dir.q, r: focus.r + dir.r }
  }
  return out
}

function uniqueHexes(hexes: Axial[], board: ReadonlySet<string>): Axial[] {
  const seen = new Set<string>()
  const out: Axial[] = []
  for (const hex of hexes) {
    if (!onBoard(hex, board)) {
      continue
    }
    const key = keyOf(hex)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(hex)
  }
  return out
}

function actorAt(
  attacker: CombatStack,
  battle: CombatBattle,
): { attacker: CombatStack; battle: CombatBattle } {
  const next = moveStack(battle, attacker.id, attacker.q, attacker.r)
  return {
    attacker: next.stacks.find((row) => row.id === attacker.id) ?? attacker,
    battle: next,
  }
}

function occupant(
  battle: CombatBattle,
  hex: Axial,
  catalog: ReferenceCatalog,
): CombatStack | null {
  return stackOccupyingHex(battle.stacks, hex.q, hex.r, catalog)
}

function isFriendly(stack: CombatStack | null, side: CombatStack['side']): boolean {
  return stack != null && stack.side === side
}

function enemies(battle: CombatBattle, side: CombatStack['side']): CombatStack[] {
  return battle.stacks.filter((row) => row.side !== side && row.qty > 0)
}

function pickOne<T>(list: T[], random: () => number): T | null {
  if (list.length === 0) {
    return null
  }
  const i = Math.min(list.length - 1, Math.floor(random() * list.length))
  return list[i] ?? null
}

function hexHits(
  hexes: Axial[],
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  side: CombatStack['side'],
  dmgPct: number,
): ShapeHit[] {
  const hits: ShapeHit[] = []
  const seen = new Set<string>()
  for (const hex of hexes) {
    const stack = occupant(battle, hex, catalog)
    if (isFriendly(stack, side)) {
      continue
    }
    if (stack && isUntargetableStack(stack, catalog)) {
      continue
    }
    if (stack) {
      if (seen.has(stack.id)) {
        continue
      }
      seen.add(stack.id)
    }
    hits.push({ hex, stack, dmgPct })
  }
  return hits
}

function losEnemies(
  battle: CombatBattle,
  side: CombatStack['side'],
  from: Axial,
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
): CombatStack[] {
  return enemies(battle, side).filter(
    (row) =>
      !isUntargetableStack(row, catalog) &&
      hasLineOfSight(from, { q: row.q, r: row.r }, tiles, battle.stacks, catalog),
  )
}

export function geometricHexes(
  spec: UnitCombatAbilities,
  from: Axial,
  aim: Axial,
  battle: CombatBattle,
  board: ReadonlySet<string>,
  side: CombatStack['side'],
  tiles: CombatTile[],
  catalog: ReferenceCatalog,
): Axial[] {
  switch (spec.shape) {
    case 'cleave':
      return uniqueHexes(cleaveHexes(from, aim), board)
    case 'aoe':
      return uniqueHexes(hexDisk(aim, spec.radius), board)
    case 'pulse':
      return uniqueHexes(hexDisk(from, spec.radius), board)
    case 'beam':
      return uniqueHexes(hexLine(from, aim), board)
    case 'breath':
      return uniqueHexes(breathHexes(from, aim, spec.rows), board)
    case 'rain':
      return uniqueHexes(
        losEnemies(battle, side, from, tiles, catalog).map((row) => ({
          q: row.q,
          r: row.r,
        })),
        board,
      )
    case 'single':
    case 'chain':
      return uniqueHexes([aim], board)
    default:
      return uniqueHexes([aim], board)
  }
}

/** Red preview hexes. Empty for multi. Rain = LOS-valid enemy hexes. */
export function previewImpactKeys(
  attacker: CombatStack,
  aim: Axial,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
): string[] {
  const spec = unitAttackShape(unitById(catalog, attacker.unitId))
  if (spec.shape === 'multi') {
    return []
  }
  const acting = actorAt(attacker, battle)
  const board = boardKeys(tiles)
  const from = { q: acting.attacker.q, r: acting.attacker.r }
  const hexes = geometricHexes(
    spec,
    from,
    aim,
    acting.battle,
    board,
    acting.attacker.side,
    tiles,
    catalog,
  )
  const keys: string[] = []
  for (const hex of hexes) {
    const stack = occupant(acting.battle, hex, catalog)
    if (isFriendly(stack, acting.attacker.side)) {
      continue
    }
    if (stack && isUntargetableStack(stack, catalog)) {
      continue
    }
    keys.push(keyOf(hex))
  }
  return keys
}

export function resolveShapeHits(
  attacker: CombatStack,
  aim: Axial,
  target: CombatStack | null,
  battle: CombatBattle,
  catalog: ReferenceCatalog,
  tiles: CombatTile[],
  random: () => number,
): ShapeHit[] {
  const spec = unitAttackShape(unitById(catalog, attacker.unitId))
  const acting = actorAt(attacker, battle)
  const board = boardKeys(tiles)
  const from = { q: acting.attacker.q, r: acting.attacker.r }
  const side = acting.attacker.side
  const field = acting.battle

  if (spec.shape === 'chain') {
    const first = target
    if (
      !first ||
      first.side === side ||
      isUntargetableStack(first, catalog)
    ) {
      return []
    }
    const hits: ShapeHit[] = [
      { hex: { q: first.q, r: first.r }, stack: first, dmgPct: 100 },
    ]
    let prevId = first.id
    const total = Math.max(1, spec.jumps)
    for (let i = 1; i < total; i += 1) {
      const pool = losEnemies(field, side, from, tiles, catalog).filter(
        (row) => row.id !== prevId,
      )
      const next = pickOne(pool, random)
      if (!next) {
        break
      }
      const pct = Math.max(0, 100 - spec.falloff * i)
      hits.push({ hex: { q: next.q, r: next.r }, stack: next, dmgPct: pct })
      prevId = next.id
    }
    return hits
  }

  if (spec.shape === 'multi') {
    const pool = losEnemies(field, side, from, tiles, catalog)
    const hits: ShapeHit[] = []
    const n = Math.max(1, spec.targets)
    for (let i = 0; i < n; i += 1) {
      const next = pickOne(pool, random)
      if (!next) {
        break
      }
      hits.push({ hex: { q: next.q, r: next.r }, stack: next, dmgPct: 100 })
    }
    return hits
  }

  return hexHits(
    geometricHexes(spec, from, aim, field, board, side, tiles, catalog),
    field,
    catalog,
    side,
    100,
  )
}
