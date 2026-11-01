-- S13-13 Script A (run BEFORE deploying kit removal).
-- Adds ability keys still injected only by designed_mud_golem kit code.
-- Safe with old frontend: duplicate skip_first_turn is harmless.
BEGIN;

UPDATE unit
SET abilities = COALESCE(abilities, '{}'::jsonb) || '{"skip_first_turn": true}'::jsonb
WHERE id = 144;

COMMIT;

-- Check: Mud Golem should split after first turn, not on spawn turn.
SELECT id, name, abilities->>'auto_split_on_turn' AS auto_split,
       abilities->>'skip_first_turn' AS skip_first
FROM unit
WHERE id = 144;
