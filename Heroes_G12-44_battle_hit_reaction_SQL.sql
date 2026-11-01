-- G12-44: directional procedural Hit levers (Reload Reference Data after run)
CREATE TABLE IF NOT EXISTS battle_hit_reaction (
  direction text PRIMARY KEY,
  knockback_min numeric NOT NULL,
  knockback_max numeric NOT NULL,
  squash_min numeric NOT NULL,
  squash_max numeric NOT NULL,
  lift_min numeric NOT NULL,
  lift_max numeric NOT NULL,
  tilt_min numeric NOT NULL,
  tilt_max numeric NOT NULL,
  tilt_pivot text NOT NULL CHECK (tilt_pivot IN ('feet', 'centre')),
  description text
);

INSERT INTO battle_hit_reaction (
  direction,
  knockback_min,
  knockback_max,
  squash_min,
  squash_max,
  lift_min,
  lift_max,
  tilt_min,
  tilt_max,
  tilt_pivot,
  description
) VALUES
  ('level', 8, 12, 0, 3, 0, 0, 4, 6, 'feet', 'Same-height melee / shallow angle'),
  ('above', 6, 10, 0, 2, 2, 6, 5, 8, 'feet', 'Hit from above (>30° up)'),
  ('below', 8, 14, 1, 4, 0, 2, -2, 4, 'centre', 'Hit from below (>30° down)')
ON CONFLICT (direction) DO UPDATE SET
  knockback_min = EXCLUDED.knockback_min,
  knockback_max = EXCLUDED.knockback_max,
  squash_min = EXCLUDED.squash_min,
  squash_max = EXCLUDED.squash_max,
  lift_min = EXCLUDED.lift_min,
  lift_max = EXCLUDED.lift_max,
  tilt_min = EXCLUDED.tilt_min,
  tilt_max = EXCLUDED.tilt_max,
  tilt_pivot = EXCLUDED.tilt_pivot,
  description = EXCLUDED.description;

DELETE FROM app_config WHERE key IN (
  'battle_hit_knockback_min_pct',
  'battle_hit_knockback_max_pct',
  'battle_hit_tilt_min_deg',
  'battle_hit_tilt_max_deg',
  'battle_hit_stretch_pct'
);
