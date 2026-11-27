-- G14-19: per-unit display strike moment (Attack clip %), independent of sound_start_pct.

ALTER TABLE unit
ADD COLUMN IF NOT EXISTS attack_strike_pct numeric NULL;

COMMENT ON COLUMN unit.attack_strike_pct IS
  '0–100: fraction into Attack sheet clip when projectiles and synced hit reactions fire; NULL uses Attack.json sound_start_pct. Advanced may inherit from Basic when Attack sheet is borrowed.';

-- Examples (tune per Attack art — palm/foreleg flash ~45–60%):
-- UPDATE unit SET attack_strike_pct = 50 WHERE id IN (44, 45);  -- Praying Mantis
-- UPDATE unit SET attack_strike_pct = 52 WHERE id IN (46, 47);  -- Chi Palmer