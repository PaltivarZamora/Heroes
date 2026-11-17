-- G14-7: polymorph battlefield + stack still art (town folder + stem). Reload Reference Data after run.
INSERT INTO anim_config (key, value, description)
VALUES
  (
    'polymorph_stem',
    'Polymorph_1',
    'Sprite stem for Polymorph condition art: {stem}_Stand.png and optional {stem}_Idle sheets under the polymorph town folder.'
  ),
  (
    'polymorph_town_id',
    '3',
    'Town id whose name folder under /assets/units/ holds polymorph art (e.g. 3 = Factory).'
  )
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description;