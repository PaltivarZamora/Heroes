-- G14-24 mid-battle appear (Rod): anim_config timings + unit styles for blockers.
-- Columns appear_style, appear_effect on unit; anim_config keys per ticket.

INSERT INTO anim_config (key, value, label) VALUES
  ('appear_stagger_sec', '0.12', 'Seconds between concurrent mid-battle spawns'),
  ('appear_rise_sec', '0.35', 'Rise-from-ground duration (seconds)'),
  ('appear_rain_hex_per_sec', '6', 'Rain fall speed (hexes per second)')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, label = EXCLUDED.label;

-- Earth Spike / Ice Shard fixtures (adjust ids if catalog differs)
UPDATE unit SET appear_style = 'rise', appear_effect = NULL
WHERE id = 142 OR name ILIKE '%earth%spike%' AND stationary = true;

UPDATE unit SET appear_style = 'rain', appear_effect = NULL
WHERE id = 143 OR name ILIKE '%ice%shard%' AND stationary = true;