-- S13-58: battle-only summons (temporary tag on totems + Tower summons).
-- Tag row may already exist; this merges onto units 55–57, 230, 231. Reload Reference Data after COMMIT.
BEGIN;

INSERT INTO unit_tag (value)
SELECT v FROM (VALUES ('temporary')) AS t(v)
WHERE NOT EXISTS (SELECT 1 FROM unit_tag ut WHERE lower(ut.value) = lower(t.v));

UPDATE unit
SET tags = (
  SELECT COALESCE(jsonb_agg(DISTINCT elem ORDER BY elem), '[]'::jsonb)
  FROM (
    SELECT jsonb_array_elements_text(COALESCE(unit.tags, '[]'::jsonb))::int AS elem
    UNION
    SELECT ut.id FROM unit_tag ut WHERE lower(ut.value) = lower('temporary')
  ) s
)
WHERE id IN (55, 56, 57, 230, 231)
   OR lower(trim(name)) IN (
     lower('Fire Totem'),
     lower('Air Totem'),
     lower('Earth Totem'),
     lower('Animated Weapon'),
     lower('Arcane Illusion')
   );

SELECT u.id, u.name,
  (SELECT string_agg(ut2.value, ', ' ORDER BY ut2.value)
   FROM unit_tag ut2
   WHERE ut2.id = ANY(
     SELECT jsonb_array_elements_text(COALESCE(u.tags, '[]'::jsonb))::int
   )) AS unit_tags
FROM unit u
WHERE u.id IN (55, 56, 57, 230, 231)
ORDER BY u.id;

COMMIT;