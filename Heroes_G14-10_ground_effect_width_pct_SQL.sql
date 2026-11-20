-- G14-10: ground effect battlefield width (% of hex). Reload Reference Data after run.
INSERT INTO anim_config (key, value, description)
VALUES
  (
    'ground_effect_width_pct',
    '100',
    'Ground effect art width as % of one hex (uniform scale); still or Idle loop under /assets/effects/.'
  )
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description;