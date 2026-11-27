-- G14-17: per-unit battlefield / world map sprite scale (% of G14-1 Stand-based scale).
-- NULL = 100. Advanced units use their own row, not the Basic partner's. Reload Reference Data after run.
ALTER TABLE unit ADD COLUMN IF NOT EXISTS sprite_scale_pct numeric NULL;

-- Example (Rod sets per creature; not required for merge):
-- UPDATE unit SET sprite_scale_pct = 75 WHERE name ILIKE '%dwarf%';