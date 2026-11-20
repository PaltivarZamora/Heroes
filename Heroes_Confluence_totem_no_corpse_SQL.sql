-- Confluence Generation (#16): totems vanish on wipe (no tombstone / hex block).
-- Rule: unit_tag no_corpse → skull die_fallback_effects only, then hex free.
-- Rod: Reload Reference Data after run.
BEGIN;

INSERT INTO unit_tag (value)
SELECT v FROM (VALUES ('no_corpse')) AS t(v)
WHERE NOT EXISTS (SELECT 1 FROM unit_tag ut WHERE lower(ut.value) = lower(t.v));

UPDATE unit
SET tags = (
  SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb)
  FROM (
    SELECT jsonb_array_elements_text(COALESCE(unit.tags, '[]'::jsonb))::int AS elem
    UNION
    SELECT ut.id FROM unit_tag ut WHERE lower(ut.value) = lower('no_corpse')
  ) s
)
WHERE id IN (55, 56, 57)
   OR lower(trim(name)) IN (
     lower('Fire Totem'),
     lower('Air Totem'),
     lower('Earth Totem')
   );

COMMIT;