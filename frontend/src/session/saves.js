async function readError(response, fallback) {
    try {
        const body = (await response.json());
        if (typeof body.error === 'string' && body.error.trim()) {
            return body.error;
        }
    }
    catch {
        // Use the fallback when the body is not JSON.
    }
    return `${fallback} (HTTP ${response.status})`;
}
async function request(input, init) {
    try {
        return await fetch(input, init);
    }
    catch {
        throw new Error('Could not reach the server.');
    }
}
export async function listSaves() {
    const response = await request('/api/saves');
    if (!response.ok) {
        throw new Error(await readError(response, 'Could not load saved games'));
    }
    const payload = (await response.json());
    if (!Array.isArray(payload)) {
        throw new Error('Could not load saved games: unexpected response');
    }
    return payload;
}
export async function fetchSave(id) {
    const response = await request(`/api/saves/${id}`);
    if (!response.ok) {
        throw new Error(await readError(response, 'Could not load that save'));
    }
    return (await response.json());
}
export async function createSave(name, seed, gameState) {
    const response = await request('/api/saves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, seed, gameState }),
    });
    if (!response.ok) {
        throw new Error(await readError(response, 'Could not save the game'));
    }
    return (await response.json());
}
export async function deleteSave(id) {
    const response = await request(`/api/saves/${id}`, { method: 'DELETE' });
    if (!response.ok) {
        throw new Error(await readError(response, 'Could not delete that save'));
    }
}
export function isGameSession(value) {
    if (value == null || typeof value !== 'object') {
        return false;
    }
    const session = value;
    return (session.game != null &&
        typeof session.game === 'object' &&
        Array.isArray(session.players) &&
        Array.isArray(session.towns) &&
        Array.isArray(session.building_states) &&
        Array.isArray(session.heroes) &&
        Array.isArray(session.units) &&
        Array.isArray(session.nodes) &&
        Array.isArray(session.mobs));
}
