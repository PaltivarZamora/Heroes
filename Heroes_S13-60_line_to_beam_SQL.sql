-- S13-60: Retire abilities.shape "line" → "beam"; Air Totem (56) → single ranged.
-- Hydromancer (32) & Tidal Caller (33) keep dmg_increase_per_hex / clears_ground_effect_id in JSON.
-- Reload Reference Data after COMMIT.
BEGIN;

UPDATE unit
SET abilities = jsonb_set(
  COALESCE(abilities, '{}'::jsonb),
  '{shape}',
  '"beam"'::jsonb,
  true
)
WHERE id IN (32, 33);

UPDATE unit
SET abilities = jsonb_set(
  COALESCE(abilities, '{}'::jsonb),
  '{shape}',
  '"single"'::jsonb,
  true
)
WHERE id = 56;

COMMIT;