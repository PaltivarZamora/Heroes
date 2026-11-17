-- G14-4: per-unit battle move slide duration (seconds per hex on the battlefield).
-- NULL = use anim_config.battle_move_sec_per_hex. Reload Reference Data after run.
ALTER TABLE unit ADD COLUMN IF NOT EXISTS move_sec_per_hex numeric NULL;

-- Example: slow siege (Rod sets values per unit; Advanced uses its own row, no borrow).
-- UPDATE unit SET move_sec_per_hex = 0.45 WHERE id = 9;
