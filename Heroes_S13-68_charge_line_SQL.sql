-- S13-68 charge_line: confirm shape + no retaliation (Giant Tortoise and peers).
-- Adjust unit_id list to match Rod's catalog query.

UPDATE unit
SET ignores_retaliation = 1
WHERE id IN (48, 49)
  AND (ignores_retaliation IS NULL OR ignores_retaliation = 0);

-- Example ability row check (shape should already be charge_line in abilities JSON):
-- SELECT id, name, abilities FROM unit WHERE abilities->>'shape' = 'charge_line';