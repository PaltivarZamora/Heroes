-- S13-13 Script B (run AFTER Rod verifies combat with Script A + new frontend).
-- Strips designed_* tag ids from unit.tags and deletes designed_* unit_tag rows.
BEGIN;

UPDATE unit u
SET tags = sub.clean
FROM (
  SELECT
    u2.id,
    COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(elem) ORDER BY elem)
        FROM (
          SELECT (jsonb_array_elements_text(COALESCE(u2.tags, '[]'::jsonb)))::int AS elem
        ) AS elems
        WHERE elem NOT IN (SELECT ut.id FROM unit_tag ut WHERE ut.value LIKE 'designed\_%')
      ),
      '[]'::jsonb
    ) AS clean
  FROM unit u2
) AS sub
WHERE u.id = sub.id
  AND COALESCE(u.tags, '[]'::jsonb) IS DISTINCT FROM sub.clean;

DELETE FROM unit_tag
WHERE value LIKE 'designed\_%';

COMMIT;

-- Check: no designed_* tag rows remain.
SELECT COUNT(*) AS remaining_designed_unit_tag_rows
FROM unit_tag
WHERE value LIKE 'designed\_%';
