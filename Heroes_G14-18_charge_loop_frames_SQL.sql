-- G14-18: charge_line Attack wind-up / spin loop / recover (display only).
-- Example for Giant Tortoise line — adjust frame indices to match each unit's Attack.json.

ALTER TABLE unit
ADD COLUMN IF NOT EXISTS charge_loop_frames jsonb NULL;

COMMENT ON COLUMN unit.charge_loop_frames IS
  'Attack sheet 0-based [loop_start, loop_end] for charge_line travel spin; NULL = legacy single Attack clip.';

-- Example (verify frame count in Attack.json before applying):
-- UPDATE unit SET charge_loop_frames = '[14, 21]'::jsonb WHERE id IN (48, 49);