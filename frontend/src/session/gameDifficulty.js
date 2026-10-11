import { setGameDifficultyCatalog } from '../town/catalog';
/** Parsed `game.settings.difficulty`; missing or invalid → Normal (2). */
export function difficultyIdFromSettings(settings) {
    const raw = Math.trunc(Number(settings?.difficulty));
    return raw > 0 ? raw : 2;
}
export function syncGameDifficultyFromSession(session) {
    setGameDifficultyCatalog(difficultyIdFromSettings(session.game.settings));
}
