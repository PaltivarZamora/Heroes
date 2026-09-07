import {
  defaultGameConfig,
  type GameConfig,
} from '../options/gameConfig'
import { DEFAULT_AI_ARCH_ID } from './types'

/** Fixed seed so Reload AI Test always starts from the same map. */
export const AI_TEST_SEED = 424242

/**
 * Repeatable 2-player sandbox: human P1 + one AI spectator hero/town, Build archetype.
 * Not a real game mode — DEV fixture for tuning traces.
 */
export function aiTestGameConfig(): GameConfig {
  const base = defaultGameConfig()
  return {
    ...base,
    playerCount: 2,
    seed: AI_TEST_SEED,
    players: [
      {
        slot: 1,
        controller: 'human',
        heroTypeId: 1,
        archId: DEFAULT_AI_ARCH_ID,
      },
      {
        slot: 2,
        controller: 'ai_spectator',
        heroTypeId: 2,
        archId: DEFAULT_AI_ARCH_ID,
      },
    ],
  }
}
