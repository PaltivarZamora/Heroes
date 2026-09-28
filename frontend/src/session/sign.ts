import { hexDistance } from '../hex/pathfinding'
import { signTokenRadius, unitById, type ReferenceCatalog, type SignTextRow } from '../town/catalog'
import {
  findSignById,
  recordSignRead,
} from './accessors'
import type { AxialPos, GameSession, MapFeature, Mob } from './types'

export type SignReadResult = {
  session: GameSession
  text: string
}

type SignFeature = Extract<MapFeature, { kind: 'sign' }>

type TokenTarget = {
  kind: 'mob' | 'town' | 'hero' | 'feature'
  name: string
  position: AxialPos
}

const TOKEN_RE = /\{(mob|town|hero|feature|direction)\}/g

const COMPASS = [
  'north',
  'northeast',
  'east',
  'southeast',
  'south',
  'southwest',
  'west',
  'northwest',
] as const

/** Pointy-top axial → screen pixel (relative). Smaller y is screen-north. */
function axialScreen(q: number, r: number): { x: number; y: number } {
  const x = Math.sqrt(3) * (q + r / 2)
  const y = (3 / 2) * r
  return { x, y }
}

/**
 * 8-way compass from `from` toward `to` using screen angle
 * (atan2(dx, −dy): 0 = north, clockwise).
 */
export function compassDirection(from: AxialPos, to: AxialPos): string {
  const a = axialScreen(from.q, from.r)
  const b = axialScreen(to.q, to.r)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dx === 0 && dy === 0) {
    return 'north'
  }
  const angle = Math.atan2(dx, -dy)
  const sector = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8
  return COMPASS[sector]
}

function tokenRadius(catalog: ReferenceCatalog): number {
  return signTokenRadius(catalog)
}

function primaryMobUnitId(session: GameSession, mob: Mob): number | null {
  for (const id of mob.slots_1_to_6) {
    if (!id) {
      continue
    }
    const stack = session.units.find((row) => row.id === id)
    if (stack && stack.qty > 0) {
      return stack.unit_id
    }
  }
  return null
}

function featureTypeNoun(
  catalog: ReferenceCatalog,
  kind: 'fountain' | 'chest',
): string {
  const name =
    catalog.feature_type.find((row) => row.name === kind)?.name ?? kind
  return name.replace(/_/g, ' ').toLowerCase()
}

function nearestMob(
  session: GameSession,
  catalog: ReferenceCatalog,
  from: AxialPos,
  radius: number,
): TokenTarget | null {
  let best: TokenTarget | null = null
  let bestDist = Infinity
  for (const mob of session.mobs) {
    const dist = hexDistance(from, mob.position)
    if (dist > radius || dist >= bestDist) {
      continue
    }
    const unitId = primaryMobUnitId(session, mob)
    if (unitId == null) {
      continue
    }
    const name = unitById(catalog, unitId)?.name?.trim()
    if (!name) {
      continue
    }
    bestDist = dist
    best = { kind: 'mob', name, position: mob.position }
  }
  return best
}

function nearestTown(session: GameSession, from: AxialPos): TokenTarget | null {
  let best: TokenTarget | null = null
  let bestDist = Infinity
  for (const town of session.towns) {
    const dist = hexDistance(from, town.position)
    if (dist >= bestDist) {
      continue
    }
    const name = town.name?.trim()
    if (!name) {
      continue
    }
    bestDist = dist
    best = { kind: 'town', name, position: town.position }
  }
  return best
}

function nearestHero(session: GameSession, from: AxialPos): TokenTarget | null {
  let best: TokenTarget | null = null
  let bestDist = Infinity
  for (const hero of session.heroes) {
    const dist = hexDistance(from, hero.position)
    if (dist >= bestDist) {
      continue
    }
    const name = hero.name?.trim()
    if (!name) {
      continue
    }
    bestDist = dist
    best = { kind: 'hero', name, position: hero.position }
  }
  return best
}

function nearestFeature(
  session: GameSession,
  catalog: ReferenceCatalog,
  from: AxialPos,
  radius: number,
): TokenTarget | null {
  let best: TokenTarget | null = null
  let bestDist = Infinity
  for (const feature of session.features ?? []) {
    if (feature.kind !== 'fountain' && feature.kind !== 'chest') {
      continue
    }
    const dist = hexDistance(from, feature.position)
    if (dist > radius || dist >= bestDist) {
      continue
    }
    bestDist = dist
    best = {
      kind: 'feature',
      name: featureTypeNoun(catalog, feature.kind),
      position: feature.position,
    }
  }
  return best
}

function namedTargetsInTemplate(
  template: string,
  session: GameSession,
  catalog: ReferenceCatalog,
  from: AxialPos,
): Map<string, TokenTarget | null> {
  const radius = tokenRadius(catalog)
  const needed = new Set<string>()
  for (const match of template.matchAll(TOKEN_RE)) {
    needed.add(match[1])
  }
  const out = new Map<string, TokenTarget | null>()
  if (needed.has('mob') || needed.has('direction')) {
    out.set('mob', nearestMob(session, catalog, from, radius))
  }
  if (needed.has('town') || needed.has('direction')) {
    out.set('town', nearestTown(session, from))
  }
  if (needed.has('hero') || needed.has('direction')) {
    out.set('hero', nearestHero(session, from))
  }
  if (needed.has('feature') || needed.has('direction')) {
    out.set('feature', nearestFeature(session, catalog, from, radius))
  }
  return out
}

/**
 * Direction points at the first named target token in the template
 * (`{mob}` / `{town}` / `{hero}` / `{feature}`). `{direction}` alone cannot
 * resolve.
 */
function directionTarget(
  template: string,
  targets: Map<string, TokenTarget | null>,
): TokenTarget | null {
  for (const match of template.matchAll(TOKEN_RE)) {
    const kind = match[1]
    if (kind === 'direction') {
      continue
    }
    const hit = targets.get(kind)
    if (hit) {
      return hit
    }
    return null
  }
  return null
}

function tryFillTokens(
  template: string,
  session: GameSession,
  catalog: ReferenceCatalog,
  from: AxialPos,
): string | null {
  if (!template.includes('{')) {
    return template
  }
  const targets = namedTargetsInTemplate(template, session, catalog, from)
  let direction: string | null = null
  if (template.includes('{direction}')) {
    const dest = directionTarget(template, targets)
    if (!dest) {
      return null
    }
    direction = compassDirection(from, dest.position)
  }
  const values: Record<string, string> = {}
  for (const kind of ['mob', 'town', 'hero', 'feature'] as const) {
    if (!template.includes(`{${kind}}`)) {
      continue
    }
    const hit = targets.get(kind)
    if (!hit) {
      return null
    }
    values[kind] = hit.name
  }
  if (direction != null) {
    values.direction = direction
  }
  return template.replace(TOKEN_RE, (_full, kind: string) => values[kind] ?? '')
}

function weightedPick(rows: SignTextRow[]): SignTextRow | null {
  if (rows.length === 0) {
    return null
  }
  let sum = 0
  for (const row of rows) {
    sum += Math.max(1, row.weight)
  }
  let roll = Math.floor(Math.random() * Math.max(1, sum))
  for (const row of rows) {
    roll -= Math.max(1, row.weight)
    if (roll < 0) {
      return row
    }
  }
  return rows[rows.length - 1] ?? null
}

function resolveGeneric(
  session: GameSession,
  catalog: ReferenceCatalog,
  from: AxialPos,
): string {
  const generics = catalog.sign_text.filter((row) => row.category === 'generic')
  // Prefer token-free lines so fallback never blank/raw.
  const plain = generics.filter((row) => !row.text.includes('{'))
  const pool = plain.length > 0 ? plain : generics
  for (let attempt = 0; attempt < 8; attempt++) {
    const pick = weightedPick(pool)
    if (!pick) {
      break
    }
    const filled = tryFillTokens(pick.text, session, catalog, from)
    if (filled != null && filled.length > 0 && !filled.includes('{')) {
      return filled
    }
  }
  return 'You are here.'
}

function templateForSign(
  sign: SignFeature,
  catalog: ReferenceCatalog,
): string | null {
  const custom = sign.custom_text?.trim()
  if (custom) {
    return custom
  }
  const row = catalog.sign_text.find((entry) => entry.id === sign.sign_text_id)
  return row?.text ?? null
}

/**
 * Resolve and record a sign read for the hero's owning player (BR S9-4).
 * Reading is free and repeatable; the sign stays on the map.
 */
export function readSign(
  session: GameSession,
  catalog: ReferenceCatalog,
  featureId: string,
  heroId: string,
): SignReadResult | null {
  const sign = findSignById(session, featureId)
  const hero = session.heroes.find((row) => row.id === heroId)
  if (!sign || !hero) {
    return null
  }
  const template = templateForSign(sign, catalog)
  let text =
    template != null
      ? tryFillTokens(template, session, catalog, sign.position)
      : null
  if (text == null || text.includes('{')) {
    text = resolveGeneric(session, catalog, sign.position)
  }
  return {
    session: recordSignRead(session, featureId, hero.player_id, text),
    text,
  }
}

/** Tooltip label for the active player: unread → "Sign"; else last resolved. */
export function signTooltipText(
  sign: SignFeature,
  playerId: string | null | undefined,
): string {
  if (!playerId) {
    return 'Sign'
  }
  const last = sign.last_text_by_player[playerId]
  return last?.trim() ? last : 'Sign'
}
