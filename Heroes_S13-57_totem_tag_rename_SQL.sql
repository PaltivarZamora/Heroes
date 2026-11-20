-- S13-57: Totem unit_tag rename (lightning_totem → air_totem, nature_totem → earth_totem).
-- Unit names/image_path for 56–57 are separate DB work. Reload Reference Data after COMMIT.
-- Rod: stage only; verify check SELECT before COMMIT.
BEGIN;

UPDATE unit_tag
SET value = 'air_totem'
WHERE lower(trim(value)) = lower('lightning_totem');

UPDATE unit_tag
SET value = 'earth_totem'
WHERE lower(trim(value)) = lower('nature_totem');

UPDATE hero_type
SET passive_stats = jsonb_set(
  passive_stats,
  '{totem_types}',
  COALESCE(
    (
      SELECT jsonb_agg(
        to_jsonb(
          CASE lower(trim(elem))
            WHEN 'lightning' THEN 'air'
            WHEN 'lightning totem' THEN 'air'
            WHEN 'nature' THEN 'earth'
            WHEN 'nature totem' THEN 'earth'
            ELSE trim(elem)
          END
        )
      )
      FROM jsonb_array_elements_text(passive_stats->'totem_types') AS elem
    ),
    '[]'::jsonb
  ),
  true
)
WHERE passive_stats->>'passive_key' = 'shaman_totems'
  AND jsonb_typeof(passive_stats->'totem_types') = 'array';

-- Rod: expect air_totem + earth_totem rows; totem_types uses air/earth (order preserved).
SELECT id, value FROM unit_tag
WHERE lower(trim(value)) IN ('air_totem', 'earth_totem', 'fire_totem')
ORDER BY value;

SELECT id, name, passive_stats->'totem_types' AS totem_types
FROM hero_type
WHERE passive_stats->>'passive_key' = 'shaman_totems';

COMMIT;