import type { GameSession } from './types'

export type SaveSummary = {
  id: number
  name: string
  seed: number
  createdAt: string | null
  updatedAt: string | null
}

export type SaveDetail = SaveSummary & {
  gameState: unknown
}

type ErrorBody = {
  error?: string
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as ErrorBody
    if (typeof body.error === 'string' && body.error.trim()) {
      return body.error
    }
  } catch {
    // Use the fallback when the body is not JSON.
  }
  return `${fallback} (HTTP ${response.status})`
}

async function request(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch {
    throw new Error('Could not reach the server.')
  }
}

export async function listSaves(): Promise<SaveSummary[]> {
  const response = await request('/api/saves')
  if (!response.ok) {
    throw new Error(await readError(response, 'Could not load saved games'))
  }
  const payload = (await response.json()) as SaveSummary[]
  if (!Array.isArray(payload)) {
    throw new Error('Could not load saved games: unexpected response')
  }
  return payload
}

export async function fetchSave(id: number): Promise<SaveDetail> {
  const response = await request(`/api/saves/${id}`)
  if (!response.ok) {
    throw new Error(await readError(response, 'Could not load that save'))
  }
  return (await response.json()) as SaveDetail
}

export async function createSave(
  name: string,
  seed: number,
  gameState: GameSession,
): Promise<SaveSummary> {
  const response = await request('/api/saves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, seed, gameState }),
  })
  if (!response.ok) {
    throw new Error(await readError(response, 'Could not save the game'))
  }
  return (await response.json()) as SaveSummary
}

export async function deleteSave(id: number): Promise<void> {
  const response = await request(`/api/saves/${id}`, { method: 'DELETE' })
  if (!response.ok) {
    throw new Error(await readError(response, 'Could not delete that save'))
  }
}

export function isGameSession(value: unknown): value is GameSession {
  if (value == null || typeof value !== 'object') {
    return false
  }
  const session = value as GameSession
  return (
    session.game != null &&
    typeof session.game === 'object' &&
    Array.isArray(session.players) &&
    Array.isArray(session.towns) &&
    Array.isArray(session.building_states) &&
    Array.isArray(session.heroes) &&
    Array.isArray(session.units) &&
    Array.isArray(session.nodes) &&
    Array.isArray(session.mobs)
  )
}
