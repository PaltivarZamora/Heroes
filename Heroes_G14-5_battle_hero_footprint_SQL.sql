-- G14-5: hero battle mount visual footprint (not occupancy). Reload Reference Data after run.
INSERT INTO anim_config (key, value, description)
VALUES (
  'battle_hero_footprint',
  '2x2',
  'Footprint code for hero mount art in battle (e.g. 2x1, 2x2); anchor hex unchanged.'
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description;
